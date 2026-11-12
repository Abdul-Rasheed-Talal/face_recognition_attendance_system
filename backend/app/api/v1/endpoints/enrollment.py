"""
Face Enrollment and Biometric Template Endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, Request
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.database import get_db
from backend.app.models.entities import Student, FaceTemplate, User, AuditLog
from backend.app.schemas.domain import EnrollmentStatusOut
from backend.app.api.v1.deps import require_teacher_or_admin, require_admin

router = APIRouter(prefix="/enrollment", tags=["Biometric Enrollment"])


@router.get("/{student_id}/status", response_model=EnrollmentStatusOut)
async def get_enrollment_status(
    student_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Retrieves biometric template enrollment status for a student."""
    res = await db.execute(
        select(Student)
        .options(selectinload(Student.face_templates))
        .where(Student.id == student_id)
    )
    student = res.scalars().first()
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found.")

    active_templates = [t for t in student.face_templates if t.is_active]
    is_enrolled = len(active_templates) > 0
    latest = active_templates[-1] if is_enrolled else None

    return EnrollmentStatusOut(
        student_id=student.id,
        roll_number=student.roll_number,
        full_name=student.full_name,
        is_enrolled=is_enrolled,
        template_count=len(active_templates),
        quality_score=latest.quality_score if latest else None,
        enrolled_at=latest.created_at if latest else None,
    )


@router.post("/{student_id}")
async def enroll_face(
    student_id: str,
    request: Request,
    image: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """
    Enrolls a student's facial image into biometric templates.
    Requires exactly one frontal face in clear focus.
    """
    enrollment_service = request.app.state.enrollment_service
    if not enrollment_service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Face enrollment service is not initialized.",
        )

    image_bytes = await image.read()
    if len(image_bytes) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty image payload.")

    success, message, template = await enrollment_service.enroll_from_image_bytes(
        db=db,
        student_id=student_id,
        image_bytes=image_bytes,
        admin_user_id=admin.id,
    )

    if not success:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=message)

    return {
        "success": True,
        "message": message,
        "template_id": template.id,
        "quality_score": template.quality_score,
    }


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_face_templates(
    student_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Deletes all biometric templates for a student."""
    res = await db.execute(
        select(FaceTemplate).where(FaceTemplate.student_id == student_id)
    )
    templates = res.scalars().all()
    for t in templates:
        await db.delete(t)

    # Remove from active memory gallery
    matcher = request.app.state.matcher
    if matcher:
        matcher.remove_student(student_id)

    # Audit log
    audit = AuditLog(
        user_id=admin.id,
        action="DELETE_BIOMETRIC_TEMPLATES",
        entity_type="face_templates",
        entity_id=student_id,
        details_json=f'{{"student_id": "{student_id}", "deleted_count": {len(templates)}}}',
    )
    db.add(audit)
    await db.commit()
    return None
