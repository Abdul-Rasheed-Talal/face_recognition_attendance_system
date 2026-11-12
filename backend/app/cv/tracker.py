"""
Multi-Face Object Tracker with Centroid and IoU Association.
Maintains persistent track IDs, movement trajectories, and suppression of stationary loitering.
"""

import time
import logging
from typing import List, Dict, Tuple, Optional
import numpy as np

from backend.app.cv.types import DetectedFace, TrackedFace, FacialLandmarks

logger = logging.getLogger(__name__)


def calculate_iou(box_a: Tuple[int, int, int, int], box_b: Tuple[int, int, int, int]) -> float:
    """Calculates Intersection over Union (IoU) between two bounding boxes (x, y, w, h)."""
    xa1, ya1, wa, ha = box_a
    xb1, yb1, wb, hb = box_b
    xa2, ya2 = xa1 + wa, ya1 + ha
    xb2, yb2 = xb1 + wb, yb1 + hb

    inter_x1 = max(xa1, xb1)
    inter_y1 = max(ya1, yb1)
    inter_x2 = min(xa2, xb2)
    inter_y2 = min(ya2, yb2)

    inter_w = max(0, inter_x2 - inter_x1)
    inter_h = max(0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = wa * ha
    area_b = wb * hb
    union_area = float(area_a + area_b - inter_area)

    if union_area <= 0:
        return 0.0
    return inter_area / union_area


class FaceTracker:
    """
    Lightweight, CPU-friendly multi-face tracker.
    Maintains track IDs, trajectories, and temporal smoothing across consecutive frames.
    """

    def __init__(
        self,
        max_missed_frames: int = 5,
        min_iou_match: float = 0.25,
        max_centroid_distance_px: float = 120.0,
        trajectory_history_len: int = 25,
    ):
        self.max_missed_frames = max_missed_frames
        self.min_iou_match = min_iou_match
        self.max_centroid_distance_px = max_centroid_distance_px
        self.trajectory_history_len = trajectory_history_len

        self.next_track_id: int = 1
        self.active_tracks: Dict[int, TrackedFace] = {}

    def update(self, detected_faces: List[DetectedFace], current_timestamp: Optional[float] = None) -> List[TrackedFace]:
        """
        Updates active tracks with newly detected faces.
        Returns the list of active tracked faces in the current frame.
        """
        now = current_timestamp if current_timestamp is not None else time.time()

        # Filter only valid quality detections for tracking association
        valid_detections = [f for f in detected_faces if f.is_valid_quality]

        if len(self.active_tracks) == 0:
            for det in valid_detections:
                self._spawn_track(det, now)
            return list(self.active_tracks.values())

        if len(valid_detections) == 0:
            # Mark all active tracks as missed
            to_remove = []
            for track_id, track in self.active_tracks.items():
                track.frames_missed += 1
                if track.frames_missed > self.max_missed_frames:
                    to_remove.append(track_id)
            for track_id in to_remove:
                del self.active_tracks[track_id]
            return list(self.active_tracks.values())

        # Build association cost matrix
        track_ids = list(self.active_tracks.keys())
        cost_matrix = np.zeros((len(track_ids), len(valid_detections)), dtype=np.float32)

        for i, tid in enumerate(track_ids):
            track = self.active_tracks[tid]
            tx, ty = track.trajectory[-1]
            for j, det in enumerate(valid_detections):
                dx, dy = det.centroid
                dist = np.hypot(tx - dx, ty - dy)
                iou = calculate_iou(track.current_bbox, det.bbox)

                # Matching metric: weighted combination of IoU and spatial distance
                if dist > self.max_centroid_distance_px or iou < self.min_iou_match:
                    cost_matrix[i, j] = 9999.0
                else:
                    cost_matrix[i, j] = (1.0 - iou) + (dist / self.max_centroid_distance_px)

        # Greedy bipartite matching
        matched_tracks = set()
        matched_detections = set()

        # Sort all pairs by ascending cost
        flat_indices = np.argsort(cost_matrix, axis=None)
        for idx in flat_indices:
            i = idx // len(valid_detections)
            j = idx % len(valid_detections)
            if cost_matrix[i, j] >= 9999.0:
                break
            if i in matched_tracks or j in matched_detections:
                continue

            tid = track_ids[i]
            det = valid_detections[j]
            self._update_track(tid, det, now)
            matched_tracks.add(i)
            matched_detections.add(j)

        # Missed tracks
        to_remove = []
        for i, tid in enumerate(track_ids):
            if i not in matched_tracks:
                track = self.active_tracks[tid]
                track.frames_missed += 1
                if track.frames_missed > self.max_missed_frames:
                    to_remove.append(tid)

        for tid in to_remove:
            del self.active_tracks[tid]

        # New detections spawn new tracks
        for j, det in enumerate(valid_detections):
            if j not in matched_detections:
                self._spawn_track(det, now)

        return list(self.active_tracks.values())

    def _spawn_track(self, det: DetectedFace, timestamp: float) -> None:
        tid = self.next_track_id
        self.next_track_id += 1
        new_track = TrackedFace(
            track_id=tid,
            current_bbox=det.bbox,
            landmarks=det.landmarks,
            trajectory=[det.centroid],
            first_seen_timestamp=timestamp,
            last_seen_timestamp=timestamp,
            frames_tracked=1,
            frames_missed=0,
        )
        self.active_tracks[tid] = new_track

    def _update_track(self, track_id: int, det: DetectedFace, timestamp: float) -> None:
        track = self.active_tracks[track_id]
        track.current_bbox = det.bbox
        track.landmarks = det.landmarks
        track.trajectory.append(det.centroid)
        if len(track.trajectory) > self.trajectory_history_len:
            track.trajectory.pop(0)
        track.last_seen_timestamp = timestamp
        track.frames_tracked += 1
        track.frames_missed = 0

