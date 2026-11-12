"""
Student Face Enrollment & Biometric Template Management Service.
Validates enrollment facial imagery, enforces single-face isolation, extracts embeddings,
and synchronously updates the in-memory gallery.
"""

import logging
from typing import Tuple, Optional, List
import cv2
import numpy as np
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.entities import Student, FaceTemplate, AuditLog
from backend.app.cv.types import DetectedFace
from backend.app.cv.detector import YuNetFaceDetector
from backend.app.cv.recognizer import SFaceFeatureExtractor
from backend.app.cv.matcher import FaceMatcher

logger = logging.getLogger(__name__)


def select_primary_enrollment_face(
    detections: List[DetectedFace],
    min_confidence: float = 0.50,
    min_size_px: int = 25,
) -> Tuple[Optional[DetectedFace], Optional[str]]:
    """
    Intelligently identifies and isolates the primary student face from candidate detections:
    1. Filters out small artifacts (< min_size_px) and low-confidence detections (< min_confidence).
    2. Merges overlapping bounding box proposals for the same face (IoU > 0.30).
    3. If there is a dominant portrait subject face (occupies >= 3x the area of any minor background artifact),
       automatically selects the dominant face.
    4. Only rejects if multiple genuine, competing, prominent faces exist (e.g. group photos).
    """
    if not detections:
        return None, "No face detected in enrollment image. Please ensure good lighting and front-facing pose."

    # 1. Filter out tiny artifacts and low-confidence false positives
    valid_candidates: List[DetectedFace] = [
        d for d in detections
        if d.bbox[2] >= min_size_px and d.bbox[3] >= min_size_px and d.confidence >= min_confidence
    ]

    if not valid_candidates:
        highest_conf = max(detections, key=lambda d: d.confidence)
        if highest_conf.confidence < 0.40:
            return None, f"Detected face confidence too low ({highest_conf.confidence:.2f}). Please face the camera directly."
        valid_candidates = [highest_conf]

    # 2. Deduplicate overlapping bounding boxes (NMS)
    valid_candidates.sort(key=lambda d: d.confidence, reverse=True)
    deduplicated: List[DetectedFace] = []

    for cand in valid_candidates:
        is_duplicate = False
        for kept in deduplicated:
            xa1, ya1, wa, ha = cand.bbox
            xb1, yb1, wb, hb = kept.bbox
            inter_x1 = max(xa1, xb1)
            inter_y1 = max(ya1, yb1)
            inter_x2 = min(xa1 + wa, xb1 + wb)
            inter_y2 = min(ya1 + ha, yb1 + hb)
            inter_w = max(0, inter_x2 - inter_x1)
            inter_h = max(0, inter_y2 - inter_y1)
            inter_area = inter_w * inter_h
            union_area = float(wa * ha + wb * hb - inter_area)
            iou = inter_area / union_area if union_area > 0 else 0.0

            if iou > 0.30:
                is_duplicate = True
                break
        if not is_duplicate:
            deduplicated.append(cand)

    # 3. If exactly 1 distinct face remains, return it
    if len(deduplicated) == 1:
        return deduplicated[0], None

    # 4. Check for dominant portrait subject face (area = w * h)
    deduplicated.sort(key=lambda d: d.bbox[2] * d.bbox[3], reverse=True)
    primary = deduplicated[0]
    primary_area = primary.bbox[2] * primary.bbox[3]

    competing_faces = []
    for other in deduplicated[1:]:
        other_area = other.bbox[2] * other.bbox[3]
        # A face is considered a competing subject if it occupies at least 25% of the primary face area
        # and has confidence >= 0.60
        if other_area >= 0.25 * primary_area and other.confidence >= 0.60:
            competing_faces.append(other)

    if competing_faces:
        return None, (
            f"Multiple distinct faces ({len(competing_faces) + 1}) detected in image. "
            f"Please upload a portrait containing only the student."
        )

    logger.info(
        f"Selected dominant portrait face {primary.bbox} (conf: {primary.confidence:.2f}, "
        f"area: {primary_area}px) suppressing {len(deduplicated) - 1} background detections."
    )
    return primary, None


class FaceEnrollmentService:
    """Handles enrollment validation, embedding persistence, and gallery updates."""

    def __init__(
        self,
        detector: YuNetFaceDetector,
        recognizer: SFaceFeatureExtractor,
        matcher: FaceMatcher,
    ):
        self.detector = detector
        self.recognizer = recognizer
        self.matcher = matcher

    async def enroll_from_image_bytes(
        self,
        db: AsyncSession,
        student_id: str,
        image_bytes: bytes,
        admin_user_id: Optional[str] = None,
    ) -> Tuple[bool, str, Optional[FaceTemplate]]:
        """
        Enrolls a student's face from raw JPEG/PNG image bytes:
        1. Decodes image array.
        2. Detects faces via YuNet.
        3. Enforces exactly ONE face in the enrollment portrait.
        4. Validates minimum dimensions and blur score (lenient for smooth portrait photos).
        5. Aligns and extracts 128-d SFace embedding.
        6. Persists template in database.
        7. Hot-updates the in-memory FaceMatcher gallery.
        """
        # Verify student exists
        student_res = await db.execute(select(Student).where(Student.id == student_id))
        student = student_res.scalars().first()
        if student is None:
            return False, f"Student ID '{student_id}' does not exist.", None

        # Decode image
        np_arr = np.frombuffer(image_bytes, np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if frame is None or frame.size == 0:
            return False, "Failed to decode image. Invalid image format.", None

        # Detect faces
        try:
            raw_detections = self.detector.detect(frame)
        except Exception as det_err:
            logger.error(f"Detection error during enrollment: {det_err}", exc_info=True)
            return False, f"Face detection error: {str(det_err)}", None

        logger.info(
            f"Enrollment detections for {student.full_name}: "
            f"{[(d.bbox, round(d.confidence, 2)) for d in raw_detections]}"
        )

        detected, err_msg = select_primary_enrollment_face(raw_detections)
        if detected is None:
            return False, err_msg or "Failed to detect a valid face in enrollment photo.", None

        # Reject only completely blank or unreadable images
        if detected.blur_score < 0.4:
            return False, f"Image is extremely blurred or unreadable (score: {detected.blur_score:.2f}). Please upload a sharper photo.", None

        # Align and extract embedding
        try:
            aligned = self.recognizer.align_and_crop(frame, detected)
            embedding = self.recognizer.extract_embedding(aligned)
        except Exception as e:
            logger.error(f"Feature extraction error: {e}", exc_info=True)
            return False, f"Feature extraction failed: {str(e)}", None

        # Deactivate any previous templates for this student to maintain 1 primary template
        prev_templates_res = await db.execute(
            select(FaceTemplate).where(
                and_(FaceTemplate.student_id == student.id, FaceTemplate.is_active == True)
            )
        )
        for prev in prev_templates_res.scalars().all():
            prev.is_active = False

        # Store new template
        template = FaceTemplate(
            student_id=student.id,
            embedding_bytes=embedding.tobytes(),
            model_name="sface_2021dec",
            quality_score=float(detected.blur_score),
            is_active=True,
        )
        db.add(template)
        await db.flush()  # Ensures template.id is generated before audit log insertion

        # Audit log
        audit = AuditLog(
            user_id=admin_user_id,
            action="ENROLL_FACE_TEMPLATE",
            entity_type="face_templates",
            entity_id=template.id,
            details_json=f'{{"student_id": "{student.id}", "roll_number": "{student.roll_number}"}}',
        )
        db.add(audit)
        await db.commit()
        await db.refresh(template)

        # Hot-update in-memory matcher gallery
        self.matcher.enroll_student(
            student_id=student.id,
            roll_number=student.roll_number,
            full_name=student.full_name,
            embedding=embedding,
        )

        logger.info(f"Successfully enrolled face template for {student.full_name} ({student.roll_number})")
        return True, "Face enrollment successful.", template

    async def load_all_active_templates_to_gallery(self, db: AsyncSession) -> int:
        """Loads all active face templates from DB into the in-memory gallery on startup."""
        query = (
            select(FaceTemplate, Student)
            .join(Student, FaceTemplate.student_id == Student.id)
            .where(and_(FaceTemplate.is_active == True, Student.status == "ACTIVE"))
        )
        res = await db.execute(query)
        rows = res.all()

        loaded_count = 0
        for template, student in rows:
            embedding = np.frombuffer(template.embedding_bytes, dtype=np.float32)
            self.matcher.enroll_student(
                student_id=student.id,
                roll_number=student.roll_number,
                full_name=student.full_name,
                embedding=embedding,
            )
            loaded_count += 1

        logger.info(f"Loaded {loaded_count} student face templates into in-memory gallery.")
        return loaded_count
