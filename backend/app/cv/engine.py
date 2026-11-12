"""
Unified Computer Vision Recognition & Ingestion Engine.
Connects the stream reader, detector, tracker, line gate, aligner, recognizer, matcher,
and confirmation state machine into an autonomous, non-blocking edge worker.
"""

import time
import logging
import threading
from typing import Callable, Optional, List, Dict, Any, Tuple
import cv2
import numpy as np

from backend.app.cv.types import (
    DetectedFace,
    TrackedFace,
    RecognitionMatch,
    AttendanceCandidateEvent,
    CameraHealthStatus,
)
from backend.app.cv.rtsp_reader import VideoStreamReader
from backend.app.cv.detector import YuNetFaceDetector
from backend.app.cv.tracker import FaceTracker
from backend.app.cv.line_gate import DirectionalLineGate
from backend.app.cv.recognizer import SFaceFeatureExtractor
from backend.app.cv.matcher import FaceMatcher
from backend.app.cv.confirmation import MultiFrameConfirmationEngine

logger = logging.getLogger(__name__)


class VisionRecognitionEngine:
    """
    Core production orchestrator for the laboratory entrance pipeline.
    Runs video acquisition and recognition asynchronously, isolating inference from API latency.
    """

    def __init__(
        self,
        reader: VideoStreamReader,
        detector: YuNetFaceDetector,
        recognizer: SFaceFeatureExtractor,
        matcher: FaceMatcher,
        tracker: Optional[FaceTracker] = None,
        line_gate: Optional[DirectionalLineGate] = None,
        confirmation_engine: Optional[MultiFrameConfirmationEngine] = None,
        processing_fps: float = 3.33,  # Evaluate ~3.3 frames per second on CPU
        processing_scale: Tuple[int, int] = (640, 360),
        camera_id: str = "CAM_LAB_01",
        on_attendance_event: Optional[Callable[[AttendanceCandidateEvent], None]] = None,
    ):
        self.reader = reader
        self.detector = detector
        self.recognizer = recognizer
        self.matcher = matcher
        self.tracker = tracker or FaceTracker()
        self.line_gate = line_gate or DirectionalLineGate()
        self.confirmation_engine = confirmation_engine or MultiFrameConfirmationEngine()

        self.processing_fps = processing_fps
        self.processing_scale = processing_scale
        self.camera_id = camera_id
        self.on_attendance_event = on_attendance_event

        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

        # Telemetry & annotated visual feed for live monitoring
        self._latest_annotated_frame: Optional[np.ndarray] = None
        self._current_tracked_faces: List[TrackedFace] = []
        self._latest_matches: Dict[int, RecognitionMatch] = {}
        self._pipeline_latency_ms: float = 0.0

    def start(self) -> "VisionRecognitionEngine":
        """Start both the stream reader and the recognition loop."""
        self.reader.start()
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._pipeline_worker, daemon=True, name="RecognitionEngineThread")
        self._thread.start()
        logger.info(f"VisionRecognitionEngine started at {self.processing_fps} FPS target on CPU")
        return self

    def stop(self, timeout: float = 2.0) -> None:
        """Stop the recognition worker and stream reader."""
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        self._thread = None
        self.reader.stop()
        logger.info("VisionRecognitionEngine stopped.")

    def get_annotated_frame_jpeg(self) -> Optional[bytes]:
        """Returns the most recent annotated frame encoded as JPEG for web streaming."""
        with self._lock:
            if self._latest_annotated_frame is None:
                return None
            ret, buf = cv2.imencode(".jpg", self._latest_annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if not ret:
                return None
            return buf.tobytes()

    def get_health_status(self) -> Dict[str, Any]:
        """Provides combined telemetry of the camera and inference worker."""
        cam_health = self.reader.get_health_status()
        with self._lock:
            return {
                "camera_connected": cam_health.is_connected,
                "camera_source": cam_health.camera_source,
                "ingestion_fps": cam_health.ingestion_fps,
                "processing_fps": self.processing_fps,
                "reconnect_attempts": cam_health.reconnect_attempts,
                "dropped_frames": cam_health.dropped_frames_count,
                "pipeline_latency_ms": round(self._pipeline_latency_ms, 2),
                "enrolled_students_in_gallery": self.matcher.enrolled_count,
                "active_tracks_count": len(self._current_tracked_faces),
                "last_error": cam_health.last_error_message,
            }

    def _pipeline_worker(self) -> None:
        """Core loop executing detection, tracking, alignment, recognition, and line-crossing."""
        frame_interval_sec = 1.0 / self.processing_fps

        while not self._stop_event.is_set():
            loop_start = time.perf_counter()

            has_frame, frame, timestamp = self.reader.get_latest_frame()
            if not has_frame or frame is None:
                time.sleep(0.05)
                continue

            t0 = time.perf_counter()

            # 1. Resize to optimal processing resolution (640x360) for fast CPU inference
            proc_w, proc_h = self.processing_scale
            orig_h, orig_w = frame.shape[:2]
            scaled_frame = cv2.resize(frame, (proc_w, proc_h), interpolation=cv2.INTER_LINEAR)

            # 2. Detect faces with YuNet
            detections = self.detector.detect(scaled_frame)

            # 3. Update multi-object tracker
            tracked_faces = self.tracker.update(detections, timestamp)

            # 4. Process each tracked face
            current_frame_matches: Dict[int, RecognitionMatch] = {}

            for track in tracked_faces:
                # 4a. Evaluate entrance line crossing
                self.line_gate.evaluate_crossing(track, proc_w, proc_h, timestamp)

                # 4b. Find matching detection for this track to extract embedding
                matched_det = None
                for det in detections:
                    if det.is_valid_quality and det.bbox == track.current_bbox:
                        matched_det = det
                        break

                if matched_det is not None:
                    try:
                        # 4c. 5-point alignment and SFace feature extraction
                        aligned = self.recognizer.align_and_crop(scaled_frame, matched_det)
                        embedding = self.recognizer.extract_embedding(aligned)

                        # 4d. Vectorized cosine similarity match
                        match_res = self.matcher.match(embedding)
                        current_frame_matches[track.track_id] = match_res

                        # 4e. Feed into multi-frame confirmation engine
                        attendance_event = self.confirmation_engine.record_observation(
                            track=track,
                            match=match_res,
                            camera_id=self.camera_id,
                            current_timestamp=timestamp,
                        )

                        # 4f. Dispatch attendance event if verified
                        if attendance_event is not None and self.on_attendance_event is not None:
                            try:
                                self.on_attendance_event(attendance_event)
                            except Exception as cb_err:
                                logger.error(f"Error in on_attendance_event callback: {cb_err}")

                    except Exception as det_err:
                        logger.debug(f"Feature extraction error on track #{track.track_id}: {det_err}")

            # 5. Prune stale observations
            active_ids = [t.track_id for t in tracked_faces]
            self.confirmation_engine.prune_stale_tracks(active_ids)

            # 6. Render visual annotations for live dashboard monitoring
            annotated = self._render_annotations(
                scaled_frame, tracked_faces, current_frame_matches, proc_w, proc_h
            )

            t1 = time.perf_counter()
            latency = (t1 - t0) * 1000.0

            with self._lock:
                self._latest_annotated_frame = annotated
                self._current_tracked_faces = tracked_faces
                self._latest_matches = current_frame_matches
                self._pipeline_latency_ms = latency

            # Throttle loop to target processing FPS
            elapsed = time.perf_counter() - loop_start
            sleep_time = max(0.005, frame_interval_sec - elapsed)
            time.sleep(sleep_time)

    def _render_annotations(
        self,
        frame: np.ndarray,
        tracks: List[TrackedFace],
        matches: Dict[int, RecognitionMatch],
        w: int,
        h: int,
    ) -> np.ndarray:
        """Draws visual overlays (entrance gate, track trajectories, bounding boxes, identity tags)."""
        canvas = frame.copy()

        # Draw virtual entrance boundary line
        p1, p2 = self.line_gate.get_absolute_gate(w, h)
        p1_i = (int(p1[0]), int(p1[1]))
        p2_i = (int(p2[0]), int(p2[1]))
        cv2.line(canvas, p1_i, p2_i, (0, 165, 255), 2, cv2.LINE_AA)
        cv2.putText(canvas, "LAB ENTRANCE GATE", (p1_i[0] + 5, p1_i[1] - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 165, 255), 1, cv2.LINE_AA)

        # Draw each tracked face
        for track in tracks:
            bx, by, bw, bh = track.current_bbox
            match = matches.get(track.track_id)

            # Determine color scheme: Green = Attended/Confirmed, Orange = Processing/Crossing, Red = Unknown
            if track.is_attendance_recorded:
                color = (0, 255, 0) # Green
                tag = f"ATTENDED: {track.confirmed_identity_id}"
            elif match and match.is_confident_match:
                color = (255, 200, 0) # Cyan/Yellow
                tag = f"{match.student_name} ({match.similarity_score:.2f})"
            elif match and match.is_ambiguous:
                color = (0, 140, 255) # Orange
                tag = f"AMBIGUOUS ({match.similarity_score:.2f})"
            else:
                color = (0, 0, 255) # Red
                tag = f"Track #{track.track_id} (Evaluating)"

            # Bounding box
            cv2.rectangle(canvas, (bx, by), (bx + bw, by + bh), color, 2)

            # Trajectory polyline
            if len(track.trajectory) > 1:
                pts = np.array(track.trajectory, dtype=np.int32).reshape((-1, 1, 2))
                cv2.polylines(canvas, [pts], False, (255, 255, 255), 1, cv2.LINE_AA)

            # Label banner
            cv2.rectangle(canvas, (bx, max(0, by - 22)), (bx + bw, by), color, -1)
            cv2.putText(canvas, tag, (bx + 3, max(14, by - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.40, (0, 0, 0), 1, cv2.LINE_AA)

        return canvas

