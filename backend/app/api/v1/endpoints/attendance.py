"""
Attendance Management & Record Query Endpoints.
"""

from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.database import get_db
from backend.app.models.entities import AttendanceRecord, Student, LabSession, User
from backend.app.schemas.domain import (
    AttendanceRecordOut,
    ManualAttendanceCreate,
    AttendanceRecordUpdate,
)
from backend.app.services.attendance_service import AttendanceService
from backend.app.api.v1.deps import require_teacher_or_admin, get_current_user

router = APIRouter(prefix="/attendance", tags=["Attendance"])


@router.get("", response_model=List[AttendanceRecordOut])
async def list_attendance(
    session_id: Optional[str] = Query(None),
    student_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Lists attendance records with session, student, and status filters."""
    query = (
        select(AttendanceRecord)
        .options(selectinload(AttendanceRecord.student))
        .order_by(AttendanceRecord.timestamp.desc())
    )

    if session_id:
        query = query.where(AttendanceRecord.session_id == session_id)
    if student_id:
        query = query.where(AttendanceRecord.student_id == student_id)
    if status_filter:
        query = query.where(AttendanceRecord.status == status_filter)

    res = await db.execute(query)
    records = res.scalars().all()

    output = []
    for r in records:
        output.append(
            AttendanceRecordOut(
                id=r.id,
                session_id=r.session_id,
                student_id=r.student_id,
                student_name=r.student.full_name if r.student else "Unknown",
                roll_number=r.student.roll_number if r.student else "N/A",
                timestamp=r.timestamp,
                status=r.status,
                confidence_score=r.confidence_score,
                verification_method=r.verification_method,
                notes=r.notes,
            )
        )
    return output


@router.get("/session/{session_id}", response_model=List[AttendanceRecordOut])
async def get_session_attendance(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Retrieves all attendance records for a specific lab session."""
    res = await db.execute(
        select(AttendanceRecord)
        .options(selectinload(AttendanceRecord.student))
        .where(AttendanceRecord.session_id == session_id)
        .order_by(AttendanceRecord.timestamp.asc())
    )
    records = res.scalars().all()

    output = []
    for r in records:
        output.append(
            AttendanceRecordOut(
                id=r.id,
                session_id=r.session_id,
                student_id=r.student_id,
                student_name=r.student.full_name if r.student else "Unknown",
                roll_number=r.student.roll_number if r.student else "N/A",
                timestamp=r.timestamp,
                status=r.status,
                confidence_score=r.confidence_score,
                verification_method=r.verification_method,
                notes=r.notes,
            )
        )
    return output


@router.get("/student/{student_id}", response_model=List[AttendanceRecordOut])
async def get_student_attendance_history(
    student_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Retrieves full attendance history for a student."""
    res = await db.execute(
        select(AttendanceRecord)
        .options(selectinload(AttendanceRecord.student))
        .where(AttendanceRecord.student_id == student_id)
        .order_by(AttendanceRecord.timestamp.desc())
    )
    records = res.scalars().all()

    output = []
    for r in records:
        output.append(
            AttendanceRecordOut(
                id=r.id,
                session_id=r.session_id,
                student_id=r.student_id,
                student_name=r.student.full_name if r.student else "Unknown",
                roll_number=r.student.roll_number if r.student else "N/A",
                timestamp=r.timestamp,
                status=r.status,
                confidence_score=r.confidence_score,
                verification_method=r.verification_method,
                notes=r.notes,
            )
        )
    return output


@router.post("/manual", response_model=AttendanceRecordOut)
async def record_manual_attendance(
    manual_in: ManualAttendanceCreate,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(require_teacher_or_admin),
):
    """Allows a teacher to manually record or override student attendance."""
    record = await AttendanceService.record_manual_override(
        db=db,
        session_id=manual_in.session_id,
        student_id=manual_in.student_id,
        status=manual_in.status,
        teacher_id=teacher.id,
        notes=manual_in.notes,
    )

    res = await db.execute(
        select(AttendanceRecord)
        .options(selectinload(AttendanceRecord.student))
        .where(AttendanceRecord.id == record.id)
    )
    r = res.scalars().first()

    return AttendanceRecordOut(
        id=r.id,
        session_id=r.session_id,
        student_id=r.student_id,
        student_name=r.student.full_name if r.student else "Unknown",
        roll_number=r.student.roll_number if r.student else "N/A",
        timestamp=r.timestamp,
        status=r.status,
        confidence_score=r.confidence_score,
        verification_method=r.verification_method,
        notes=r.notes,
    )


@router.patch("/{record_id}", response_model=AttendanceRecordOut)
async def update_attendance_status(
    record_id: str,
    update_in: AttendanceRecordUpdate,
    db: AsyncSession = Depends(get_db),
    teacher: User = Depends(require_teacher_or_admin),
):
    """Updates status of an existing attendance record (e.g. EXCUSED or CORRECTION)."""
    res = await db.execute(
        select(AttendanceRecord)
        .options(selectinload(AttendanceRecord.student))
        .where(AttendanceRecord.id == record_id)
    )
    r = res.scalars().first()
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found.")

    r.status = update_in.status
    if update_in.notes:
        r.notes = update_in.notes
    r.verified_by_user_id = teacher.id

    await db.commit()
    await db.refresh(r)

    return AttendanceRecordOut(
        id=r.id,
        session_id=r.session_id,
        student_id=r.student_id,
        student_name=r.student.full_name if r.student else "Unknown",
        roll_number=r.student.roll_number if r.student else "N/A",
        timestamp=r.timestamp,
        status=r.status,
        confidence_score=r.confidence_score,
        verification_method=r.verification_method,
        notes=r.notes,
    )

