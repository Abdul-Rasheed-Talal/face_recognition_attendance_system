"""
Data structures and domain types for the Computer Vision pipeline.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Tuple, Optional, Dict, Any
import numpy as np


@dataclass
class FacialLandmarks:
    """5 canonical facial landmarks: right eye, left eye, nose tip, right mouth, left mouth."""
    right_eye: Tuple[float, float]
    left_eye: Tuple[float, float]
    nose_tip: Tuple[float, float]
    mouth_right: Tuple[float, float]
    mouth_left: Tuple[float, float]

    def to_array(self) -> np.ndarray:
        return np.array([
            self.right_eye,
            self.left_eye,
            self.nose_tip,
            self.mouth_right,
            self.mouth_left
        ], dtype=np.float32)


@dataclass
class DetectedFace:
    """Raw face detection output from YuNet before tracking and identification."""
    bbox: Tuple[int, int, int, int]  # (x, y, width, height)
    confidence: float
    landmarks: FacialLandmarks
    raw_yunet_output: np.ndarray
    blur_score: float  # Laplacian variance
    is_valid_quality: bool = True
    rejection_reason: Optional[str] = None

    @property
    def centroid(self) -> Tuple[float, float]:
        x, y, w, h = self.bbox
        return (x + w / 2.0, y + h / 2.0)

    @property
    def area(self) -> int:
        return self.bbox[2] * self.bbox[3]


@dataclass
class TrackedFace:
    """Persistent face track across consecutive camera frames."""
    track_id: int
    current_bbox: Tuple[int, int, int, int]
    landmarks: FacialLandmarks
    trajectory: List[Tuple[float, float]] = field(default_factory=list)  # [(x, y), ...]
    first_seen_timestamp: float = 0.0
    last_seen_timestamp: float = 0.0
    frames_tracked: int = 1
    frames_missed: int = 0
    has_crossed_entry_line: bool = False
    crossing_timestamp: Optional[float] = None
    crossing_direction: Optional[str] = None  # "IN", "OUT", or "NONE"
    confirmed_identity_id: Optional[str] = None
    confirmed_confidence: Optional[float] = None
    is_attendance_recorded: bool = False
    lockout_until_timestamp: float = 0.0


@dataclass
class RecognitionMatch:
    """Result of embedding comparison against enrolled student gallery."""
    student_id: Optional[str]
    student_name: Optional[str]
    roll_number: Optional[str]
    similarity_score: float
    second_best_score: float = 0.0
    margin: float = 0.0
    is_confident_match: bool = False
    is_ambiguous: bool = False
    status_label: str = "UNKNOWN"  # "CONFIRMED", "AMBIGUOUS", "UNKNOWN"


@dataclass
class AttendanceCandidateEvent:
    """High-level event emitted when a student has qualified through detection, tracking, line-crossing, and recognition."""
    student_id: str
    roll_number: str
    student_name: str
    confidence: float
    track_id: int
    crossing_timestamp: datetime
    camera_id: str
    is_suspicious_liveness: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CameraHealthStatus:
    """Operational telemetry of the video ingestion reader."""
    camera_source: str
    is_connected: bool
    reconnect_attempts: int
    ingestion_fps: float
    dropped_frames_count: int
    last_frame_timestamp: float
    last_error_message: Optional[str] = None
