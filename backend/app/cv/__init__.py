"""
Computer Vision pipeline package.
"""

from backend.app.cv.types import (
    DetectedFace,
    TrackedFace,
    RecognitionMatch,
    AttendanceCandidateEvent,
    CameraHealthStatus,
    FacialLandmarks,
)
from backend.app.cv.rtsp_reader import VideoStreamReader
from backend.app.cv.detector import YuNetFaceDetector
from backend.app.cv.tracker import FaceTracker
from backend.app.cv.line_gate import DirectionalLineGate
from backend.app.cv.recognizer import SFaceFeatureExtractor
from backend.app.cv.matcher import FaceMatcher
from backend.app.cv.confirmation import MultiFrameConfirmationEngine
from backend.app.cv.engine import VisionRecognitionEngine

__all__ = [
    "DetectedFace",
    "TrackedFace",
    "RecognitionMatch",
    "AttendanceCandidateEvent",
    "CameraHealthStatus",
    "FacialLandmarks",
    "VideoStreamReader",
    "YuNetFaceDetector",
    "FaceTracker",
    "DirectionalLineGate",
    "SFaceFeatureExtractor",
    "FaceMatcher",
    "MultiFrameConfirmationEngine",
    "VisionRecognitionEngine",
]

