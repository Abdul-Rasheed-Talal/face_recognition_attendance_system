"""
Virtual Entrance Line-Crossing and Directional Entry Detector.
Verifies whether a tracked student is entering the laboratory, exiting, or passing outside.
"""

import time
import logging
from typing import Tuple, Optional, List
import numpy as np

from backend.app.cv.types import TrackedFace

logger = logging.getLogger(__name__)


def ccw(a: Tuple[float, float], b: Tuple[float, float], c: Tuple[float, float]) -> bool:
    """Tests if 3 points are in counterclockwise order."""
    return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])


def segments_intersect(
    p1: Tuple[float, float], p2: Tuple[float, float],
    p3: Tuple[float, float], p4: Tuple[float, float]
) -> bool:
    """Checks whether line segment (p1, p2) intersects with line segment (p3, p4)."""
    return (ccw(p1, p3, p4) != ccw(p2, p3, p4)) and (ccw(p1, p2, p3) != ccw(p1, p2, p4))


class DirectionalLineGate:
    """
    Virtual boundary gate positioned at the laboratory doorway threshold.
    Validates directional movement vectors: IN (entering), OUT (exiting), NONE (loitering).
    """

    def __init__(
        self,
        line_start: Tuple[float, float] = (0.10, 0.55),  # Normalized (x, y) 0.0 - 1.0
        line_end: Tuple[float, float] = (0.90, 0.55),
        inward_normal: Tuple[float, float] = (0.0, 1.0), # Direction pointing into the lab
        min_trajectory_points: int = 3,
    ):
        self.norm_line_start = line_start
        self.norm_line_end = line_end
        self.inward_normal = np.array(inward_normal, dtype=np.float32)
        norm_len = np.linalg.norm(self.inward_normal)
        if norm_len > 0:
            self.inward_normal /= norm_len
        self.min_trajectory_points = min_trajectory_points

    def get_absolute_gate(self, frame_width: int, frame_height: int) -> Tuple[Tuple[float, float], Tuple[float, float]]:
        """Returns pixel coordinates of the entrance line for a given frame dimension."""
        p1 = (self.norm_line_start[0] * frame_width, self.norm_line_start[1] * frame_height)
        p2 = (self.norm_line_end[0] * frame_width, self.norm_line_end[1] * frame_height)
        return p1, p2

    def evaluate_crossing(
        self,
        track: TrackedFace,
        frame_width: int,
        frame_height: int,
        current_timestamp: Optional[float] = None
    ) -> Tuple[bool, str]:
        """
        Evaluates whether the track's trajectory has crossed the entrance line.
        Returns:
            (has_crossed, direction) where direction is "IN", "OUT", or "NONE"
        """
        now = current_timestamp if current_timestamp is not None else time.time()

        if len(track.trajectory) < self.min_trajectory_points:
            return False, "NONE"

        gate_p1, gate_p2 = self.get_absolute_gate(frame_width, frame_height)

        # Check trajectory segments against the gate line
        # Check from earliest historical point to current point
        curr_pt = track.trajectory[-1]
        
        # Test crossing across recent trajectory window
        lookback = min(len(track.trajectory), 8)
        start_pt = track.trajectory[-lookback]

        intersects = segments_intersect(start_pt, curr_pt, gate_p1, gate_p2)
        if not intersects:
            return False, "NONE"

        # Trajectory vector
        traj_vector = np.array([curr_pt[0] - start_pt[0], curr_pt[1] - start_pt[1]], dtype=np.float32)
        v_len = np.linalg.norm(traj_vector)
        if v_len < 1e-4:
            return False, "NONE"
        traj_vector /= v_len

        # Directional dot product with inward normal
        dot = float(np.dot(traj_vector, self.inward_normal))

        if dot > 0.25:  # Moving inward towards laboratory
            direction = "IN"
        elif dot < -0.25:  # Moving outward away from laboratory
            direction = "OUT"
        else:
            direction = "NONE"  # Lateral movement across door

        # Update track state if entering
        if direction == "IN" and not track.has_crossed_entry_line:
            track.has_crossed_entry_line = True
            track.crossing_direction = "IN"
            track.crossing_timestamp = now
            logger.info(f"Track #{track.track_id} validated ENTRY into laboratory (dot={dot:.2f})")

        return track.has_crossed_entry_line, direction
