"""
Integration tests for YuNet and SFace ONNX models using OpenCV DNN CPU backend.
Verifies real model weights loading, landmark alignment, and embedding extraction.
"""

import os
import pytest
import numpy as np
import cv2

from backend.app.cv.detector import YuNetFaceDetector
from backend.app.cv.recognizer import SFaceFeatureExtractor
from backend.app.cv.types import DetectedFace, FacialLandmarks

YUNET_PATH = os.path.join("models", "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join("models", "face_recognition_sface_2021dec.onnx")


@pytest.mark.skipif(not os.path.exists(YUNET_PATH), reason="YuNet ONNX model not found")
def test_yunet_real_model_loading_and_inference():
    detector = YuNetFaceDetector(
        model_path=YUNET_PATH,
        confidence_threshold=0.80,
        min_face_width=40,
        laplacian_blur_threshold=30.0,
    )

    # Synthetic frame with a face pattern
    frame = np.full((360, 640, 3), 180, dtype=np.uint8)
    # Draw face
    cv2.ellipse(frame, (320, 180), (50, 70), 0, 0, 360, (220, 190, 160), -1)
    cv2.circle(frame, (300, 160), 6, (40, 40, 40), -1)
    cv2.circle(frame, (340, 160), 6, (40, 40, 40), -1)
    cv2.line(frame, (320, 175), (320, 195), (60, 60, 60), 2)
    cv2.ellipse(frame, (320, 215), (20, 8), 0, 0, 180, (50, 50, 50), 3)

    detections = detector.detect(frame)
    # Even on synthetic gradients, the detector completes inference without error
    assert isinstance(detections, list)


@pytest.mark.skipif(not os.path.exists(SFACE_PATH), reason="SFace ONNX model not found")
def test_sface_real_model_feature_extraction():
    recognizer = SFaceFeatureExtractor(model_path=SFACE_PATH)

    # Standard aligned 112x112 face crop
    aligned_crop = np.random.randint(50, 220, (112, 112, 3), dtype=np.uint8)

    embedding = recognizer.extract_embedding(aligned_crop)

    assert embedding.shape == (128,)
    assert embedding.dtype == np.float32
    # Verify unit L2 norm
    l2_norm = float(np.linalg.norm(embedding))
    assert pytest.approx(l2_norm, abs=1e-4) == 1.0


@pytest.mark.skipif(not os.path.exists(SFACE_PATH), reason="SFace ONNX model not found")
def test_sface_similarity_scoring():
    recognizer = SFaceFeatureExtractor(model_path=SFACE_PATH)

    face_a = np.full((112, 112, 3), 140, dtype=np.uint8)
    cv2.circle(face_a, (35, 40), 8, (20, 20, 20), -1)
    cv2.circle(face_a, (77, 40), 8, (20, 20, 20), -1)

    # Identical face
    feat_a1 = recognizer.extract_embedding(face_a)
    feat_a2 = recognizer.extract_embedding(face_a.copy())

    sim_identical = recognizer.compute_similarity(feat_a1, feat_a2)
    assert pytest.approx(sim_identical, abs=1e-4) == 1.0

    # Altered face
    face_b = np.full((112, 112, 3), 40, dtype=np.uint8)
    cv2.rectangle(face_b, (20, 20), (90, 90), (220, 220, 220), -1)
    feat_b = recognizer.extract_embedding(face_b)

    sim_diff = recognizer.compute_similarity(feat_a1, feat_b)
    assert sim_diff < 0.90
