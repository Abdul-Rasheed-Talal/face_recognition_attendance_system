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
from backend.app.cv.detector import YuNetFaceDetector
from backend.app.cv.recognizer import SFaceFeatureExtractor
from backend.app.cv.matcher import FaceMatcher

logger = logging.getLogger(__name__)


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
        4. Validates minimum dimensions and blur score.
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
        detections = self.detector.detect(frame)
        if len(detections) == 0:
            return False, "No face detected in enrollment image. Please ensure good lighting and front-facing pose.", None

        if len(detections) > 1:
            return False, f"Multiple faces ({len(detections)}) detected. Enrollment image must contain only the student.", None

        detected = detections[0]
        if not detected.is_valid_quality:
            return False, f"Face quality rejected: {detected.rejection_reason}", None

        # Align and extract embedding
        try:
            aligned = self.recognizer.align_and_crop(frame, detected)
            embedding = self.recognizer.extract_embedding(aligned)
        except Exception as e:
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

