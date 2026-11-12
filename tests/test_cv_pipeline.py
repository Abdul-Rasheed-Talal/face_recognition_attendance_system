"""
Unit and Integration Tests for the Laboratory Face Recognition CV Pipeline.
Validates YuNet detection quality, SORT/Centroid tracking, line crossing,
SFace embedding extraction, cosine gallery matching, and multi-frame confirmation.
"""

import os
import time
import pytest
import numpy as np

from backend.app.cv.types import DetectedFace, FacialLandmarks, RecognitionMatch, TrackedFace
from backend.app.cv.detector import YuNetFaceDetector
from backend.app.cv.tracker import FaceTracker, calculate_iou
from backend.app.cv.line_gate import DirectionalLineGate, segments_intersect
from backend.app.cv.recognizer import SFaceFeatureExtractor
from backend.app.cv.matcher import FaceMatcher
from backend.app.cv.confirmation import MultiFrameConfirmationEngine

YUNET_PATH = os.path.join("models", "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join("models", "face_recognition_sface_2021dec.onnx")


def create_dummy_landmarks() -> FacialLandmarks:
    return FacialLandmarks(
        right_eye=(38.0, 42.0),
        left_eye=(74.0, 42.0),
        nose_tip=(56.0, 62.0),
        mouth_right=(42.0, 85.0),
        mouth_left=(70.0, 85.0),
    )


def test_iou_calculation():
    box1 = (10, 10, 50, 50)
    box2 = (10, 10, 50, 50)
    assert calculate_iou(box1, box2) == 1.0

    box3 = (100, 100, 50, 50)
    assert calculate_iou(box1, box3) == 0.0

    box4 = (35, 10, 50, 50)  # 50% overlap horizontally
    iou = calculate_iou(box1, box4)
    assert 0.2 < iou < 0.5


def test_line_crossing_math():
    # Vertical line from (50, 0) to (50, 100)
    p1 = (50.0, 0.0)
    p2 = (50.0, 100.0)

    # Segment crossing through from left (10, 50) to right (90, 50)
    p3 = (10.0, 50.0)
    p4 = (90.0, 50.0)
    assert segments_intersect(p1, p2, p3, p4) is True

    # Segment parallel not crossing
    p5 = (10.0, 10.0)
    p6 = (10.0, 90.0)
    assert segments_intersect(p1, p2, p5, p6) is False


def test_directional_line_gate():
    # Doorway horizontal line at y=0.5 (relative coordinates)
    # Entry direction: top (y=0.2) to bottom (y=0.8) -> inward normal (0, 1)
    gate = DirectionalLineGate(
        line_start=(0.0, 0.5),
        line_end=(1.0, 0.5),
        inward_normal=(0.0, 1.0),
        min_trajectory_points=2,
    )

    track = TrackedFace(
        track_id=1,
        current_bbox=(200, 300, 60, 60),
        landmarks=create_dummy_landmarks(),
        trajectory=[(320.0, 100.0), (320.0, 150.0), (320.0, 220.0)], # Moving top to bottom (y: 100 -> 220 across y=180 at 360h)
    )

    crossed, direction = gate.evaluate_crossing(track, frame_width=640, frame_height=360)
    assert crossed is True
    assert direction == "IN"

    # Test reverse direction (exiting)
    track_exit = TrackedFace(
        track_id=2,
        current_bbox=(200, 100, 60, 60),
        landmarks=create_dummy_landmarks(),
        trajectory=[(320.0, 220.0), (320.0, 150.0), (320.0, 100.0)], # Moving bottom to top
    )
    crossed_exit, direction_exit = gate.evaluate_crossing(track_exit, frame_width=640, frame_height=360)
    assert direction_exit == "OUT"
    assert track_exit.has_crossed_entry_line is False


def test_face_tracker_lifecycle():
    tracker = FaceTracker(max_missed_frames=2, min_iou_match=0.2)

    landmarks = create_dummy_landmarks()
    raw_output = np.zeros(15, dtype=np.float32)

    det1 = DetectedFace(
        bbox=(100, 100, 60, 60),
        confidence=0.92,
        landmarks=landmarks,
        raw_yunet_output=raw_output,
        blur_score=120.0,
        is_valid_quality=True,
    )

    # Frame 1: spawn track
    tracks = tracker.update([det1], current_timestamp=1.0)
    assert len(tracks) == 1
    assert tracks[0].track_id == 1
    assert tracks[0].frames_tracked == 1

    # Frame 2: same face moved slightly
    det1_moved = DetectedFace(
        bbox=(105, 105, 60, 60),
        confidence=0.94,
        landmarks=landmarks,
        raw_yunet_output=raw_output,
        blur_score=115.0,
        is_valid_quality=True,
    )
    tracks = tracker.update([det1_moved], current_timestamp=1.3)
    assert len(tracks) == 1
    assert tracks[0].track_id == 1
    assert tracks[0].frames_tracked == 2
    assert len(tracks[0].trajectory) == 2

    # Frame 3: face disappears
    tracks = tracker.update([], current_timestamp=1.6)
    assert len(tracks) == 1
    assert tracks[0].frames_missed == 1

    # Frame 4: face still gone
    tracks = tracker.update([], current_timestamp=1.9)
    assert len(tracks) == 1
    assert tracks[0].frames_missed == 2

    # Frame 5: exceeds max_missed_frames (2), should deregister
    tracks = tracker.update([], current_timestamp=2.2)
    assert len(tracks) == 0


def test_matcher_confidence_and_ambiguity():
    matcher = FaceMatcher(similarity_threshold=0.363, ambiguity_margin=0.080)

    # Enrolled Student 1
    v1 = np.zeros(128, dtype=np.float32)
    v1[0] = 1.0  # Unit vector along axis 0
    matcher.enroll_student("s1", "CS-001", "Alice Smith", v1)

    # Enrolled Student 2
    v2 = np.zeros(128, dtype=np.float32)
    v2[1] = 1.0  # Unit vector along axis 1
    matcher.enroll_student("s2", "CS-002", "Bob Jones", v2)

    # Match test 1: Exact match with Alice
    probe_alice = v1.copy()
    match = matcher.match(probe_alice)
    assert match.status_label == "CONFIRMED"
    assert match.student_id == "s1"
    assert match.similarity_score >= 0.99
    assert match.is_confident_match is True

    # Match test 2: Ambiguous probe equidistant between Alice and Bob
    probe_ambig = (v1 + v2) / np.linalg.norm(v1 + v2)
    match_ambig = matcher.match(probe_ambig)
    # Cosine score is 0.707 for both, margin is 0.0 -> AMBIGUOUS
    assert match_ambig.status_label == "AMBIGUOUS"
    assert match_ambig.is_ambiguous is True
    assert match_ambig.is_confident_match is False

    # Match test 3: Unknown identity orthogonal to both
    probe_unknown = np.zeros(128, dtype=np.float32)
    probe_unknown[50] = 1.0
    match_unknown = matcher.match(probe_unknown)
    assert match_unknown.status_label == "UNKNOWN"
    assert match_unknown.is_confident_match is False


def test_multi_frame_confirmation_engine():
    engine = MultiFrameConfirmationEngine(
        required_confirmations=3,
        window_size=5,
        identity_cooldown_sec=100.0,
    )

    track = TrackedFace(
        track_id=10,
        current_bbox=(100, 100, 60, 60),
        landmarks=create_dummy_landmarks(),
        has_crossed_entry_line=True,  # Student crossed entrance
    )

    alice_match = RecognitionMatch(
        student_id="s1",
        student_name="Alice Smith",
        roll_number="CS-001",
        similarity_score=0.88,
        second_best_score=0.40,
        margin=0.48,
        is_confident_match=True,
        is_ambiguous=False,
        status_label="CONFIRMED",
    )

    # Frame 1: 1st observation -> None (needs 3)
    event = engine.record_observation(track, alice_match, current_timestamp=1000.0)
    assert event is None

    # Frame 2: 2nd observation -> None
    event = engine.record_observation(track, alice_match, current_timestamp=1000.3)
    assert event is None

    # Frame 3: 3rd observation -> Confirmed event emitted!
    event = engine.record_observation(track, alice_match, current_timestamp=1000.6)
    assert event is not None
    assert event.student_id == "s1"
    assert event.student_name == "Alice Smith"
    assert event.roll_number == "CS-001"
    assert event.track_id == 10
    assert track.is_attendance_recorded is True

    # Frame 4: 4th observation for same track -> None (already recorded)
    event_again = engine.record_observation(track, alice_match, current_timestamp=1000.9)
    assert event_again is None

    # New track with same student inside cooldown window -> None (cooldown active!)
    track2 = TrackedFace(
        track_id=11,
        current_bbox=(110, 110, 60, 60),
        landmarks=create_dummy_landmarks(),
        has_crossed_entry_line=True,
    )
    _ = engine.record_observation(track2, alice_match, current_timestamp=1010.0)
    _ = engine.record_observation(track2, alice_match, current_timestamp=1010.3)
    event_cooldown = engine.record_observation(track2, alice_match, current_timestamp=1010.6)
    assert event_cooldown is None
