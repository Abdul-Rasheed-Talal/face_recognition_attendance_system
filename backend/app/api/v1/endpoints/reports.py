"""
Dashboard Analytics, Reporting & Attendance Correction Endpoints.
"""

from typing import List, Optional
import io
import csv
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import Response
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.database import get_db
from backend.app.models.entities import (
    Student,
    AttendanceRecord,
    LabSession,
    AttendanceCorrectionRequest,
    User,
)
from backend.app.schemas.domain import (
    DashboardStatisticsOut,
    CorrectionRequestCreate,
    CorrectionRequestOut,
)
from backend.app.services.attendance_service import AttendanceService
from backend.app.api.v1.deps import require_teacher_or_admin, get_current_user

router = APIRouter(prefix="/reports", tags=["Analytics & Reports"])


@router.get("/statistics", response_model=DashboardStatisticsOut)
async def get_dashboard_statistics(request: Request, db: AsyncSession = Depends(get_db)):
    """Computes live institutional attendance KPIs and camera telemetry."""
    # Count total active students
    total_res = await db.execute(
        select(func.count(Student.id)).where(Student.status == "ACTIVE")
    )
    total_students = total_res.scalar() or 0

    # Today's boundaries (UTC)
    now = datetime.now(timezone.utc)
    today_start = datetime(now.year, now.month, now.day, 0, 0, 0, tzinfo=timezone.utc)
    today_end = datetime(now.year, now.month, now.day, 23, 59, 59, tzinfo=timezone.utc)

    # Today's records
    records_res = await db.execute(
        select(AttendanceRecord.status, func.count(AttendanceRecord.id))
        .where(
            and_(
                AttendanceRecord.timestamp >= today_start,
                AttendanceRecord.timestamp <= today_end,
            )
        )
        .group_by(AttendanceRecord.status)
    )
    counts = dict(records_res.all())

    present_today = counts.get("PRESENT", 0)
    late_today = counts.get("LATE", 0)
    total_attended = present_today + late_today
    absent_today = max(0, total_students - total_attended)

    pct = round((total_attended / total_students * 100.0), 1) if total_students > 0 else 0.0

    # Active session details
    active_sess = await AttendanceService.get_active_session_for_lab(db)
    active_sess_data = None
    if active_sess:
        active_sess_data = {
            "session_id": active_sess.id,
            "status": active_sess.status,
            "start_time": active_sess.start_time.isoformat(),
            "end_time": active_sess.end_time.isoformat(),
        }

    # Camera telemetry
    engine = getattr(request.app.state, "recognition_engine", None)
    cam_health = engine.get_health_status() if engine else {"camera_connected": False}

    return DashboardStatisticsOut(
        total_students=total_students,
        present_today=present_today,
        late_today=late_today,
        absent_today=absent_today,
        overall_attendance_pct=pct,
        active_session=active_sess_data,
        camera_health=cam_health,
    )


@router.get("/export/csv")
async def export_attendance_csv(
    session_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Exports attendance records to a downloadable CSV file."""
    query = (
        select(AttendanceRecord)
        .options(
            selectinload(AttendanceRecord.student),
            selectinload(AttendanceRecord.session),
        )
        .order_by(AttendanceRecord.timestamp.asc())
    )
    if session_id:
        query = query.where(AttendanceRecord.session_id == session_id)

    res = await db.execute(query)
    records = res.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Record ID",
        "Roll Number",
        "Student Name",
        "Session ID",
        "Status",
        "Timestamp (UTC)",
        "Confidence",
        "Method",
        "Notes"
    ])

    for r in records:
        writer.writerow([
            r.id,
            r.student.roll_number if r.student else "N/A",
            r.student.full_name if r.student else "N/A",
            r.session_id,
            r.status,
            r.timestamp.isoformat(),
            f"{r.confidence_score:.3f}" if r.confidence_score else "N/A",
            r.verification_method,
            r.notes or "",
        ])

    csv_data = output.getvalue()
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=attendance_export.csv"},
    )


@router.post("/corrections", response_model=CorrectionRequestOut)
async def submit_attendance_correction(
    request_in: CorrectionRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Allows a student or teacher to submit an attendance dispute/correction request."""
    # Find matching student for user
    res_s = await db.execute(select(Student).where(Student.email == current_user.email))
    student = res_s.scalars().first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current user is not mapped to an active student record.",
        )

    corr = AttendanceCorrectionRequest(
        student_id=student.id,
        session_id=request_in.session_id,
        reason=request_in.reason,
        status="PENDING",
    )
    db.add(corr)
    await db.commit()
    await db.refresh(corr)

    return CorrectionRequestOut(
        id=corr.id,
        student_id=student.id,
        student_name=student.full_name,
        roll_number=student.roll_number,
        session_id=corr.session_id,
        reason=corr.reason,
        status=corr.status,
        created_at=corr.created_at,
        reviewed_at=corr.reviewed_at,
    )


@router.get("/corrections", response_model=List[CorrectionRequestOut])
async def list_correction_requests(
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Lists student attendance dispute correction requests."""
    query = (
        select(AttendanceCorrectionRequest)
        .options(selectinload(AttendanceCorrectionRequest.student))
        .order_by(AttendanceCorrectionRequest.created_at.desc())
    )
    if status_filter:
        query = query.where(AttendanceCorrectionRequest.status == status_filter)

    res = await db.execute(query)
    rows = res.scalars().all()

    output = []
    for c in rows:
        output.append(
            CorrectionRequestOut(
                id=c.id,
                student_id=c.student_id,
                student_name=c.student.full_name if c.student else "Unknown",
                roll_number=c.student.roll_number if c.student else "N/A",
                session_id=c.session_id,
                reason=c.reason,
                status=c.status,
                created_at=c.created_at,
                reviewed_at=c.reviewed_at,
            )
        )
    return output
