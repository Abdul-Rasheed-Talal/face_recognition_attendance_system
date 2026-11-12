"""
Face Alignment and Feature Extraction Engine using OpenCV SFace (ONNX CPU).
Warp-aligns cropped faces to canonical 112x112 coordinates and produces 128-d L2-normalized feature embeddings.
"""

import os
import logging
from typing import Tuple, Optional
import cv2
import numpy as np

from backend.app.cv.types import DetectedFace, FacialLandmarks

logger = logging.getLogger(__name__)


class SFaceFeatureExtractor:
    """
    OpenCV SFace feature extractor running on CPU.
    Performs 5-point landmark affine alignment and generates 128-d embeddings.
    """

    def __init__(self, model_path: str):
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"SFace ONNX model not found at: {model_path}")

        self.model_path = model_path
        self.recognizer = cv2.FaceRecognizerSF.create(
            model=self.model_path,
            config="",
            backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
            target_id=cv2.dnn.DNN_TARGET_CPU,
        )
        logger.info(f"SFace feature extractor initialized from {model_path} on CPU")

    def align_and_crop(self, frame: np.ndarray, detected_face: DetectedFace) -> np.ndarray:
        """
        Aligns the detected face using its 5 facial landmarks and warps to canonical 112x112.
        """
        if frame is None or frame.size == 0:
            raise ValueError("Invalid frame supplied for face alignment")

        # OpenCV FaceRecognizerSF.alignCrop accepts the raw YuNet output array
        # or we can pass the raw detection row directly:
        raw_det = detected_face.raw_yunet_output
        aligned = self.recognizer.alignCrop(frame, raw_det)
        return aligned

    def extract_embedding(self, aligned_face: np.ndarray) -> np.ndarray:
        """
        Extracts 128-dimensional L2-normalized feature embedding from an aligned 112x112 face.
        """
        if aligned_face is None or aligned_face.shape[:2] != (112, 112):
            raise ValueError(f"Input face must be aligned 112x112, got shape {aligned_face.shape if aligned_face is not None else None}")

        # SFace feature extraction: returns (1, 128) float32
        raw_feature = self.recognizer.feature(aligned_face)
        feature = raw_feature.flatten().astype(np.float32)

        # Ensure unit L2 normalization for exact cosine dot-product equality
        norm = np.linalg.norm(feature)
        if norm > 1e-6:
            feature /= norm

        return feature

    def compute_similarity(self, embedding_a: np.ndarray, embedding_b: np.ndarray) -> float:
        """
        Computes cosine similarity between two 128-d embeddings.
        Values range from -1.0 to 1.0 (typical match threshold ~0.363).
        """
        return float(np.dot(embedding_a, embedding_b))

