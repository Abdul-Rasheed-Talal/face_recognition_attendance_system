"""
Unified Computer Vision Recognition, Anti-Spoofing & Decoupled 30 FPS Streaming Engine.
Connects the stream reader, YuNet detector, tracker, passive anti-spoofing liveness check,
line gate, SFace aligner/recognizer, matcher, and confirmation state machine into an
autonomous, non-blocking edge worker.
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
)
from backend.app.cv.rtsp_reader import VideoStreamReader
from backend.app.cv.detector import YuNetFaceDetector
from backend.app.cv.tracker import FaceTracker
from backend.app.cv.line_gate import DirectionalLineGate
from backend.app.cv.recognizer import SFaceFeatureExtractor
from backend.app.cv.matcher import FaceMatcher
from backend.app.cv.confirmation import MultiFrameConfirmationEngine
from backend.app.cv.antispoof import FaceAntiSpoofDetector, LivenessResult

logger = logging.getLogger(__name__)


class VisionRecognitionEngine:
    """
    Core production orchestrator for the CIT Computer Lab entrance pipeline.
    - Video display stream runs decoupled at full camera FPS (25-30 FPS, zero lag).
    - AI recognition + anti-spoofing runs independently on CPU at ~10 FPS (<0.4s confirmation).
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
        antispoof: Optional[FaceAntiSpoofDetector] = None,
        processing_fps: float = 10.0,
        processing_scale: Tuple[int, int] = (640, 360),
        camera_id: str = "CAM_GATE_01",
        require_line_crossing: bool = False,
        recognition_every_n_frames: int = 1,
        on_attendance_event: Optional[Callable[[AttendanceCandidateEvent], None]] = None,
        on_spoof_event: Optional[Callable[[Dict[str, Any]], None]] = None,
    ):
        self.reader = reader
        self.detector = detector
        self.recognizer = recognizer
        self.matcher = matcher
        self.tracker = tracker or FaceTracker()
        self.line_gate = line_gate or DirectionalLineGate()
        self.confirmation_engine = confirmation_engine or MultiFrameConfirmationEngine()
        self.antispoof = antispoof or FaceAntiSpoofDetector()

        self.processing_fps = processing_fps
        self.processing_scale = processing_scale
        self.camera_id = camera_id
        self.require_line_crossing = require_line_crossing
        self.on_attendance_event = on_attendance_event
        self.on_spoof_event = on_spoof_event

        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._encode_lock = threading.Lock()

        # AI state shared with the 30 FPS display overlay
        self._current_tracked_faces: List[TrackedFace] = []
        self._latest_matches: Dict[int, RecognitionMatch] = {}
        self._latest_liveness: Dict[int, LivenessResult] = {}
        self._pipeline_latency_ms: float = 0.0
        self._spoof_alert_cooldown: Dict[int, float] = {}
        self._spoof_blocked_count: int = 0

        # Per-frame-sequence JPEG cache (ensures each camera frame is encoded at most once)
        self._cached_annotated_seq: int = -1
        self._cached_annotated_jpeg: Optional[bytes] = None
        self._cached_raw_seq: int = -1
        self._cached_raw_jpeg: Optional[bytes] = None
        self._placeholder_jpeg: Optional[bytes] = None

    def start(self) -> "VisionRecognitionEngine":
        """Start both the stream reader and the recognition loop."""
        self.reader.start()
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._pipeline_worker, daemon=True, name="RecognitionEngineThread")
        self._thread.start()
        logger.info(f"VisionRecognitionEngine started (AI={self.processing_fps} FPS, Anti-Spoof=ON, Display=Full Camera FPS)")
        return self

    def stop(self, timeout: float = 2.0) -> None:
        """Stop the recognition worker and stream reader."""
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        self._thread = None
        self.reader.stop()
        logger.info("VisionRecognitionEngine stopped.")

    def _get_placeholder_jpeg(self) -> bytes:
        if self._placeholder_jpeg is None:
            blank = np.full((360, 640, 3), 245, dtype=np.uint8)
            cv2.putText(
                blank,
                "Connecting to Gate Camera...",
                (155, 185),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.70,
                (100, 100, 100),
                2,
                cv2.LINE_AA,
            )
            _, buf = cv2.imencode(".jpg", blank, [cv2.IMWRITE_JPEG_QUALITY, 75])
            self._placeholder_jpeg = buf.tobytes()
        return self._placeholder_jpeg

    def get_next_annotated_jpeg(self, last_seq: int, timeout: float = 0.25) -> Tuple[int, bytes]:
        """
        Event-driven 25-30 FPS annotated stream frame producer.
        Decoupled from AI inference: overlays the latest tracks/liveness tags on every
        newly arriving camera frame in < 2 ms, cached by frame sequence number.
        """
        new_seq, frame = self.reader.wait_for_new_frame(last_seq, timeout=timeout)
        if frame is None:
            return new_seq, self._cached_annotated_jpeg or self._get_placeholder_jpeg()

        with self._encode_lock:
            if new_seq == self._cached_annotated_seq and self._cached_annotated_jpeg is not None:
                return new_seq, self._cached_annotated_jpeg

            proc_w, proc_h = self.processing_scale
            if frame.shape[1] != proc_w or frame.shape[0] != proc_h:
                display_frame = cv2.resize(frame, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
            else:
                display_frame = frame

            with self._lock:
                tracks = list(self._current_tracked_faces)
                matches = dict(self._latest_matches)
                liveness_map = dict(self._latest_liveness)

            annotated = self._render_annotations(display_frame, tracks, matches, liveness_map, proc_w, proc_h)
            ret, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 74])
            if ret:
                jpeg_bytes = buf.tobytes()
                self._cached_annotated_seq = new_seq
                self._cached_annotated_jpeg = jpeg_bytes
                return new_seq, jpeg_bytes

        return new_seq, self._cached_annotated_jpeg or self._get_placeholder_jpeg()

    def get_next_raw_jpeg(self, last_seq: int, timeout: float = 0.25) -> Tuple[int, bytes]:
        """
        Event-driven 25-30 FPS clean unannotated stream for the Live Student Photo Capture modal.
        Zero bounding boxes, zero lag.
        """
        new_seq, frame = self.reader.wait_for_new_frame(last_seq, timeout=timeout)
        if frame is None:
            return new_seq, self._cached_raw_jpeg or self._get_placeholder_jpeg()

        with self._encode_lock:
            if new_seq == self._cached_raw_seq and self._cached_raw_jpeg is not None:
                return new_seq, self._cached_raw_jpeg

            proc_w, proc_h = self.processing_scale
            if frame.shape[1] != proc_w or frame.shape[0] != proc_h:
                display_frame = cv2.resize(frame, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
            else:
                display_frame = frame

            ret, buf = cv2.imencode(".jpg", display_frame, [cv2.IMWRITE_JPEG_QUALITY, 78])
            if ret:
                jpeg_bytes = buf.tobytes()
                self._cached_raw_seq = new_seq
                self._cached_raw_jpeg = jpeg_bytes
                return new_seq, jpeg_bytes

        return new_seq, self._cached_raw_jpeg or self._get_placeholder_jpeg()

    def get_annotated_frame_jpeg(self) -> Optional[bytes]:
        """Returns latest single annotated JPEG frame (for snapshot fallback)."""
        _, jpeg = self.get_next_annotated_jpeg(-1, timeout=0.05)
        return jpeg

    def get_raw_frame_jpeg(self) -> Optional[bytes]:
        """
        Retrieves the latest clean, unannotated full-resolution camera frame as JPEG.
        Used for high-quality student biometric face enrollment photo capture.
        """
        has_frame, frame, _ = self.reader.get_latest_frame()
        if has_frame and frame is not None:
            ret, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            if ret:
                return buf.tobytes()
        return None

    def get_health_status(self) -> Dict[str, Any]:
        """Provides combined telemetry of the camera, anti-spoofing, and inference worker."""
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
                "spoof_blocked_count": self._spoof_blocked_count,
                "last_error": cam_health.last_error_message,
            }

    def _pipeline_worker(self) -> None:
        """Core AI loop executing detection, tracking, anti-spoofing, recognition, and confirmation."""
        frame_interval_sec = 1.0 / self.processing_fps
        last_processed_ts = 0.0

        while not self._stop_event.is_set():
            loop_start = time.perf_counter()

            has_frame, frame, timestamp = self.reader.get_latest_frame()
            if not has_frame or frame is None or timestamp == last_processed_ts:
                time.sleep(0.02)
                continue
            last_processed_ts = timestamp

            t0 = time.perf_counter()

            # 1. Resize to optimal processing resolution (640x360) for fast CPU inference
            proc_w, proc_h = self.processing_scale
            orig_h, orig_w = frame.shape[:2]
            if orig_w != proc_w or orig_h != proc_h:
                scaled_frame = cv2.resize(frame, (proc_w, proc_h), interpolation=cv2.INTER_LINEAR)
            else:
                scaled_frame = frame

            # 2. Detect faces with YuNet
            detections = self.detector.detect(scaled_frame)

            # 3. Update multi-object tracker
            tracked_faces = self.tracker.update(detections, timestamp)

            # 4. Process each tracked face (Anti-Spoofing -> Recognition -> Confirmation)
            current_frame_matches: Dict[int, RecognitionMatch] = {}
            current_frame_liveness: Dict[int, LivenessResult] = {}

            for track in tracked_faces:
                self.line_gate.evaluate_crossing(track, proc_w, proc_h, timestamp)

                matched_det = None
                for det in detections:
                    if det.is_valid_quality and det.bbox == track.current_bbox:
                        matched_det = det
                        break

                if matched_det is not None:
                    try:
                        # 4a. Passive Anti-Spoofing (blocks printed photos, posters, phone screens)
                        liveness = self.antispoof.evaluate(scaled_frame, matched_det, track)
                        current_frame_liveness[track.track_id] = liveness

                        if not liveness.is_live:
                            last_alert = self._spoof_alert_cooldown.get(track.track_id, 0.0)
                            if timestamp - last_alert > 4.0:
                                self._spoof_alert_cooldown[track.track_id] = timestamp
                                with self._lock:
                                    self._spoof_blocked_count += 1
                                logger.warning(
                                    f"SPOOF BLOCKED on Track #{track.track_id}: {liveness.reason} "
                                    f"(score={liveness.score:.2f}, signals={liveness.signals})"
                                )
                                if self.on_spoof_event is not None:
                                    try:
                                        self.on_spoof_event({
                                            "type": "SPOOF_ALERT",
                                            "track_id": track.track_id,
                                            "reason": liveness.reason,
                                            "liveness_score": liveness.score,
                                            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(timestamp)),
                                        })
                                    except Exception as cb_err:
                                        logger.debug(f"Spoof callback error: {cb_err}")
                            # Never mark attendance for a spoofed face
                            continue

                        # 4b. High-resolution face alignment for sharp SFace embedding
                        scale_x = orig_w / float(proc_w)
                        scale_y = orig_h / float(proc_h)
                        scaled_yunet_output = matched_det.raw_yunet_output.copy()
                        scaled_yunet_output[[0, 2, 4, 6, 8, 10, 12]] *= scale_x
                        scaled_yunet_output[[1, 3, 5, 7, 9, 11, 13]] *= scale_y

                        try:
                            aligned = self.recognizer.align_crop_raw(frame, scaled_yunet_output)
                            if aligned is None or aligned.shape[:2] != (112, 112):
                                aligned = self.recognizer.align_and_crop(scaled_frame, matched_det)
                        except Exception:
                            aligned = self.recognizer.align_and_crop(scaled_frame, matched_det)

                        embedding = self.recognizer.extract_embedding(aligned)

                        # 4c. Cosine similarity match
                        match_res = self.matcher.match(embedding)
                        current_frame_matches[track.track_id] = match_res

                        # 4d. Multi-frame confirmation
                        attendance_event = self.confirmation_engine.record_observation(
                            track=track,
                            match=match_res,
                            camera_id=self.camera_id,
                            current_timestamp=timestamp,
                        )

                        # 4e. Dispatch verified attendance event
                        if attendance_event is not None and self.on_attendance_event is not None:
                            try:
                                self.on_attendance_event(attendance_event)
                            except Exception as cb_err:
                                logger.error(f"Error in on_attendance_event callback: {cb_err}")

                    except Exception as det_err:
                        logger.debug(f"Feature extraction error on track #{track.track_id}: {det_err}")

            # 5. Prune stale track states
            active_ids = [t.track_id for t in tracked_faces]
            self.confirmation_engine.prune_stale_tracks(active_ids)
            self.antispoof.prune_stale_tracks(active_ids)
            for tid in [k for k in self._spoof_alert_cooldown if k not in set(active_ids)]:
                del self._spoof_alert_cooldown[tid]

            t1 = time.perf_counter()
            latency = (t1 - t0) * 1000.0

            with self._lock:
                self._current_tracked_faces = tracked_faces
                self._latest_matches = current_frame_matches
                self._latest_liveness = current_frame_liveness
                self._pipeline_latency_ms = latency

            elapsed = time.perf_counter() - loop_start
            sleep_time = max(0.005, frame_interval_sec - elapsed)
            time.sleep(sleep_time)

    def _render_annotations(
        self,
        frame: np.ndarray,
        tracks: List[TrackedFace],
        matches: Dict[int, RecognitionMatch],
        liveness_map: Dict[int, LivenessResult],
        w: int,
        h: int,
    ) -> np.ndarray:
        """Fast lightweight overlay (<0.3ms) drawing bounding boxes, verified tags, and spoof warnings."""
        canvas = frame.copy()

        if self.require_line_crossing:
            p1, p2 = self.line_gate.get_absolute_gate(w, h)
            p1_i = (int(p1[0]), int(p1[1]))
            p2_i = (int(p2[0]), int(p2[1]))
            cv2.line(canvas, p1_i, p2_i, (0, 165, 255), 2, cv2.LINE_AA)
            cv2.putText(canvas, "ENTRANCE GATE", (p1_i[0] + 5, p1_i[1] - 8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 165, 255), 1, cv2.LINE_AA)

        for track in tracks:
            bx, by, bw, bh = track.current_bbox
            match = matches.get(track.track_id)
            live = liveness_map.get(track.track_id)

            if live is not None and not live.is_live:
                color = (40, 40, 235)  # Red BGR for Spoof Blocked
                tag = f"SPOOF BLOCKED: Photo/Screen"
            elif track.is_attendance_recorded:
                color = (80, 195, 45)  # Emerald Green BGR
                tag = f"ATTENDED: {track.confirmed_identity_name or track.confirmed_identity_id}"
            elif match and match.is_confident_match:
                color = (70, 175, 40)
                tag = f"{match.student_name} ({match.similarity_score:.2f})"
            elif match and match.is_ambiguous:
                color = (20, 160, 240)  # Amber BGR
                tag = f"Verifying..."
            else:
                color = (150, 150, 150)  # Subtle Neutral Gray
                tag = f"Face #{track.track_id}"

            cv2.rectangle(canvas, (bx, by), (bx + bw, by + bh), color, 2)
            label_w = max(bw, len(tag) * 7 + 10)
            cv2.rectangle(canvas, (bx, max(0, by - 22)), (min(w, bx + label_w), by), color, -1)
            cv2.putText(canvas, tag, (bx + 4, max(15, by - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)

        return canvas
