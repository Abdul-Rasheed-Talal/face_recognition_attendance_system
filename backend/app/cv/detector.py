"""
Face Detection and Quality Assessment Engine using OpenCV YuNet (ONNX CPU).
Filters out low-quality, blurry, or undersized face candidates before tracking and recognition.
"""

import os
import logging
from typing import List, Tuple, Optional
import cv2
import numpy as np

from backend.app.cv.types import DetectedFace, FacialLandmarks

logger = logging.getLogger(__name__)


class YuNetFaceDetector:
    """
    OpenCV YuNet face detector optimized for CPU execution.
    Computes bounding boxes, 5-point facial landmarks, and blur quality scores.
    """

    def __init__(
        self,
        model_path: str,
        confidence_threshold: float = 0.85,
        nms_threshold: float = 0.30,
        min_face_width: int = 60,
        laplacian_blur_threshold: float = 60.0,
        top_k: int = 5000,
    ):
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"YuNet ONNX model not found at: {model_path}")

        self.model_path = model_path
        self.confidence_threshold = confidence_threshold
        self.nms_threshold = nms_threshold
        self.min_face_width = min_face_width
        self.laplacian_blur_threshold = laplacian_blur_threshold
        self.top_k = top_k

        # Initialize detector with default resolution
        self.current_input_size = (640, 360)
        self.detector = cv2.FaceDetectorYN.create(
            model=self.model_path,
            config="",
            input_size=self.current_input_size,
            score_threshold=self.confidence_threshold,
            nms_threshold=self.nms_threshold,
            top_k=self.top_k,
            backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
            target_id=cv2.dnn.DNN_TARGET_CPU,
        )
        logger.info(f"YuNet detector initialized from {model_path} on CPU")

    def _ensure_input_size(self, width: int, height: int) -> None:
        """Dynamically update detector input size if frame dimensions change."""
        if self.current_input_size != (width, height):
            self.detector.setInputSize((width, height))
            self.current_input_size = (width, height)

    @staticmethod
    def calculate_blur_score(face_crop: np.ndarray) -> float:
        """
        Calculates the Laplacian variance of the face crop.
        Lower values (<60) indicate severe motion blur or out-of-focus capture.
        """
        if face_crop.size == 0 or face_crop.shape[0] < 10 or face_crop.shape[1] < 10:
            return 0.0
        gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY) if len(face_crop.shape) == 3 else face_crop
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())

    def detect(self, frame: np.ndarray) -> List[DetectedFace]:
        """
        Detects faces in the given BGR frame and applies quality filtering.
        Returns a list of DetectedFace objects.
        """
        if frame is None or frame.size == 0:
            return []

        h, w = frame.shape[:2]
        self._ensure_input_size(w, h)

        # YuNet detection: returns (status, detections)
        # Each detection row: [x, y, w, h, x_re, y_re, x_le, y_le, x_nt, y_nt, x_rc, y_rc, x_lc, y_lc, score]
        status, detections = self.detector.detect(frame)
        if status == 0 or detections is None or len(detections) == 0:
            return []

        results: List[DetectedFace] = []

        for det in detections:
            bbox_x = max(0, int(det[0]))
            bbox_y = max(0, int(det[1]))
            bbox_w = min(w - bbox_x, int(det[2]))
            bbox_h = min(h - bbox_y, int(det[3]))
            score = float(det[14])

            # Extract 5 landmarks
            landmarks = FacialLandmarks(
                right_eye=(float(det[4]), float(det[5])),
                left_eye=(float(det[6]), float(det[7])),
                nose_tip=(float(det[8]), float(det[9])),
                mouth_right=(float(det[10]), float(det[11])),
                mouth_left=(float(det[12]), float(det[13])),
            )

            # Crop face region for blur assessment
            face_crop = frame[bbox_y : bbox_y + bbox_h, bbox_x : bbox_x + bbox_w]
            blur_score = self.calculate_blur_score(face_crop)

            # Quality validation
            is_valid = True
            rejection_reason = None

            if bbox_w < self.min_face_width or bbox_h < self.min_face_width:
                is_valid = False
                rejection_reason = f"Face too small: {bbox_w}x{bbox_h}px (min: {self.min_face_width}px)"
            elif score < self.confidence_threshold:
                is_valid = False
                rejection_reason = f"Confidence too low: {score:.2f} (threshold: {self.confidence_threshold})"
            elif blur_score < self.laplacian_blur_threshold:
                is_valid = False
                rejection_reason = f"Motion blur detected: laplacian {blur_score:.1f} < {self.laplacian_blur_threshold}"

            detected = DetectedFace(
                bbox=(bbox_x, bbox_y, bbox_w, bbox_h),
                confidence=score,
                landmarks=landmarks,
                raw_yunet_output=det,
                blur_score=blur_score,
                is_valid_quality=is_valid,
                rejection_reason=rejection_reason,
            )
            results.append(detected)

        return results
