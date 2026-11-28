"""
Dashboard Analytics, Reporting & Attendance Correction Endpoints.
"""

from typing import List, Optional
import io
import csv
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from fastapi.responses import Response
from sqlalchemy import select, and_, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.config import settings
from backend.app.core.database import get_db
from backend.app.models.entities import (
    Student,
    ClassGroup,
    AttendanceRecord,
    LabSession,
    AttendanceCorrectionRequest,
    ArchivedTestRecord,
    User,
)
from backend.app.schemas.domain import (
    DashboardStatisticsOut,
    CorrectionRequestCreate,
    CorrectionRequestOut,
    CorrectionReview,
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

    # "Today" in the institution's timezone (Asia/Karachi), not UTC:
    # with UTC, an evening lab counted on the wrong day (5 h offset).
    # Timestamps are stored in UTC, so convert the PKT day boundaries.
    pkt = ZoneInfo(settings.TIMEZONE)
    now_pkt = datetime.now(pkt)
    today_start_pkt = now_pkt.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end_pkt = today_start_pkt + timedelta(days=1)
    today_start = today_start_pkt.astimezone(timezone.utc)
    today_end = today_end_pkt.astimezone(timezone.utc)

    # Today's records
    records_res = await db.execute(
        select(AttendanceRecord.status, func.count(AttendanceRecord.id))
        .where(
            and_(
                AttendanceRecord.timestamp >= today_start,
                AttendanceRecord.timestamp < today_end,
            )
        )
        .group_by(AttendanceRecord.status)
    )
    counts = dict(records_res.all())

    present_today = counts.get("PRESENT", 0)
    late_today = counts.get("LATE", 0)
    total_attended = present_today + late_today

    # Absent = students who had a session today but were not recorded.
    # The old formula (total students - attended) counted every student
    # with no session today as absent.
    session_classes_res = await db.execute(
        select(LabSession.class_id).where(
            and_(
                LabSession.start_time >= today_start,
                LabSession.start_time < today_end,
                LabSession.status != "CANCELLED",
            )
        ).distinct()
    )
    class_ids_today = [row[0] for row in session_classes_res.all()]
    if class_ids_today:
        eligible_res = await db.execute(
            select(func.count(Student.id)).where(
                and_(Student.status == "ACTIVE", Student.class_id.in_(class_ids_today))
            )
        )
        eligible_today = eligible_res.scalar() or 0
    else:
        eligible_today = 0
    absent_today = max(0, eligible_today - total_attended)

    pct = round((total_attended / eligible_today * 100.0), 1) if eligible_today > 0 else 0.0

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
    """Allows a student or teacher to submit an attendance dispute/correction request.
    Students have no User accounts, so the old email-mapping always 400'd
    for them. A teacher may now submit on a student's behalf by passing
    student_id; otherwise the student is still looked up by the user's
    email, as before."""
    if request_in.student_id:
        res_s = await db.execute(select(Student).where(Student.id == request_in.student_id))
        student = res_s.scalars().first()
        if not student:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Student '{request_in.student_id}' does not exist.")
    else:
        res_s = await db.execute(select(Student).where(Student.email == current_user.email))
        student = res_s.scalars().first()
        if not student:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current user is not mapped to an active student record. Ask a teacher to submit the correction with the student's roll number.",
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


@router.post("/corrections/{correction_id}/review", response_model=CorrectionRequestOut)
async def review_correction_request(
    correction_id: str,
    review_in: CorrectionReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher_or_admin),
):
    """Approves or rejects a pending correction request. Previously there
    was no endpoint at all — reviewed_by / reviewed_at were never written,
    so teachers could not resolve the disputes the portal invites students
    to file. Approving records the decision; the actual attendance change
    (if any) is made with the manual-override flow, which is audited."""
    decision = review_in.decision.strip().upper()
    if decision not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="decision must be APPROVED or REJECTED.")
    corr = (await db.execute(
        select(AttendanceCorrectionRequest)
        .options(selectinload(AttendanceCorrectionRequest.student))
        .where(AttendanceCorrectionRequest.id == correction_id)
    )).scalars().first()
    if not corr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Correction request not found.")
    if corr.status != "PENDING":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Correction request was already {corr.status}.")
    corr.status = decision
    corr.reviewed_by_user_id = current_user.id
    corr.reviewed_at = datetime.now(timezone.utc)
    if review_in.note:
        corr.reason = f"{corr.reason}\n[Teacher note: {review_in.note}]"
    await db.commit()
    await db.refresh(corr)
    return CorrectionRequestOut(
        id=corr.id,
        student_id=corr.student_id,
        student_name=corr.student.full_name if corr.student else "Unknown",
        roll_number=corr.student.roll_number if corr.student else "N/A",
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


# ------------------------------------------------------------------------------
# Production Analytics, Daily/Monthly Register & Test Archive Reset
# ------------------------------------------------------------------------------

def _fmt_12h(dt_utc: datetime, tz: ZoneInfo) -> str:
    if dt_utc.tzinfo is None:
        dt_utc = dt_utc.replace(tzinfo=timezone.utc)
    return dt_utc.astimezone(tz).strftime("%I:%M %p").lstrip("0")


@router.get("/analytics")
async def get_attendance_analytics(
    period: str = Query("today", description="today | current_month | previous_month | month | date"),
    month: Optional[str] = Query(None, description="YYYY-MM when period=month"),
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD when period=date"),
    class_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Comprehensive daily / monthly attendance analytics across CIT 1st, 2nd & 3rd Year.
    Computes exact Present, Late, and Absent counts per class, per day, per lecture,
    and per student (every student in a scheduled non-cancelled class without a record
    is counted as ABSENT for that lecture).
    """
    tz = ZoneInfo(settings.TIMEZONE)
    now_local = datetime.now(tz)
    now_utc = datetime.now(timezone.utc)

    # Resolve local date range [start_local, end_local)
    if period == "today":
        start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        end_local = start_local + timedelta(days=1)
        period_label = f"Today ({start_local.strftime('%b %d, %Y')})"
    elif period == "date" and target_date:
        d = datetime.strptime(target_date, "%Y-%m-%d").replace(tzinfo=tz)
        start_local = d
        end_local = d + timedelta(days=1)
        period_label = d.strftime("%b %d, %Y")
    elif period == "previous_month":
        first_this = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        last_prev = first_this - timedelta(days=1)
        start_local = last_prev.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end_local = first_this
        period_label = start_local.strftime("%B %Y")
    elif period == "month" and month:
        y, m = map(int, month.split("-"))
        start_local = datetime(y, m, 1, 0, 0, 0, tzinfo=tz)
        if m == 12:
            end_local = datetime(y + 1, 1, 1, 0, 0, 0, tzinfo=tz)
        else:
            end_local = datetime(y, m + 1, 1, 0, 0, 0, tzinfo=tz)
        period_label = start_local.strftime("%B %Y")
    else:  # current_month
        start_local = now_local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if start_local.month == 12:
            end_local = start_local.replace(year=start_local.year + 1, month=1)
        else:
            end_local = start_local.replace(month=start_local.month + 1)
        period_label = start_local.strftime("%B %Y")

    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)

    # Ensure today's sessions are synced if today falls in the range
    if start_utc <= now_utc < end_utc:
        from backend.app.api.v1.endpoints.timetable import sync_sessions_for_date
        await sync_sessions_for_date(db)

    # 1. Fetch all classes & active students
    classes = (await db.execute(select(ClassGroup).order_by(ClassGroup.name.asc()))).scalars().all()
    class_map = {c.id: c.name for c in classes}

    st_query = select(Student).where(Student.status == "ACTIVE").order_by(Student.roll_number.asc())
    if class_id:
        st_query = st_query.where(Student.class_id == class_id)
    students = (await db.execute(st_query)).scalars().all()
    students_by_class: dict[str, list[Student]] = {}
    for st in students:
        students_by_class.setdefault(st.class_id, []).append(st)

    # 2. Fetch non-cancelled sessions in [start_utc, end_utc)
    sess_query = (
        select(LabSession)
        .options(
            selectinload(LabSession.subject),
            selectinload(LabSession.class_group),
            selectinload(LabSession.teacher),
        )
        .where(
            and_(
                LabSession.start_time >= start_utc,
                LabSession.start_time < end_utc,
                LabSession.status != "CANCELLED",
            )
        )
        .order_by(LabSession.start_time.asc())
    )
    if class_id:
        sess_query = sess_query.where(LabSession.class_id == class_id)
    sessions = (await db.execute(sess_query)).scalars().all()

    # Only evaluate sessions that have started (or already have records) for absent calculation
    session_ids = [s.id for s in sessions]
    att_map: dict[tuple[str, str], AttendanceRecord] = {}
    if session_ids:
        att_rows = (
            await db.execute(
                select(AttendanceRecord).where(AttendanceRecord.session_id.in_(session_ids))
            )
        ).scalars().all()
        for r in att_rows:
            att_map[(r.session_id, r.student_id)] = r

    # 3. Aggregate per-class, per-day, per-lecture, and per-student
    by_class_agg = {
        c.id: {
            "class_id": c.id,
            "class_name": c.name,
            "lectures": 0,
            "present": 0,
            "late": 0,
            "absent": 0,
            "attendance_pct": 0.0,
        }
        for c in classes
        if not class_id or c.id == class_id
    }
    daily_agg: dict[str, dict] = {}
    lectures_out = []
    student_agg = {
        st.id: {
            "student_id": st.id,
            "roll_number": st.roll_number,
            "full_name": st.full_name,
            "class_id": st.class_id,
            "class_name": class_map.get(st.class_id, "CIT Class"),
            "total_lectures": 0,
            "present": 0,
            "late": 0,
            "absent": 0,
            "attendance_pct": 0.0,
            "history": [],
        }
        for st in students
    }

    total_present = 0
    total_late = 0
    total_absent = 0
    counted_lectures = 0

    for s in sessions:
        st_utc = s.start_time if s.start_time.tzinfo else s.start_time.replace(tzinfo=timezone.utc)
        et_utc = s.end_time if s.end_time.tzinfo else s.end_time.replace(tzinfo=timezone.utc)
        st_local = st_utc.astimezone(tz)
        date_str = st_local.strftime("%Y-%m-%d")
        date_label = st_local.strftime("%b %d")
        subj_name = s.subject_title or (s.subject.name if s.subject else "Computer Lab")
        teacher_name = s.teacher_display_name or (s.teacher.full_name if s.teacher else "")
        cls_name = s.class_group.name if s.class_group else class_map.get(s.class_id, "CIT Class")
        time_range_12h = f"{_fmt_12h(st_utc, tz)} - {_fmt_12h(et_utc, tz)}"

        cls_students = students_by_class.get(s.class_id, [])
        has_started = st_utc <= now_utc

        lec_present = 0
        lec_late = 0
        lec_absent = 0

        if has_started:
            counted_lectures += 1
            if s.class_id in by_class_agg:
                by_class_agg[s.class_id]["lectures"] += 1

            for st in cls_students:
                rec = att_map.get((s.id, st.id))
                if rec:
                    if rec.status == "PRESENT" or rec.status == "EXCUSED" or rec.status == "MANUAL_CORRECTION":
                        status_val = rec.status
                        lec_present += 1
                        student_agg[st.id]["present"] += 1
                    elif rec.status == "LATE":
                        status_val = "LATE"
                        lec_late += 1
                        student_agg[st.id]["late"] += 1
                    else:
                        status_val = "ABSENT"
                        lec_absent += 1
                        student_agg[st.id]["absent"] += 1
                    entry_str = _fmt_12h(rec.timestamp, tz)
                else:
                    status_val = "ABSENT"
                    lec_absent += 1
                    student_agg[st.id]["absent"] += 1
                    entry_str = None

                student_agg[st.id]["total_lectures"] += 1
                student_agg[st.id]["history"].append({
                    "session_id": s.id,
                    "date": date_str,
                    "subject_name": subj_name,
                    "time_12h": time_range_12h,
                    "entry_time_12h": entry_str,
                    "status": status_val,
                })

            total_present += lec_present
            total_late += lec_late
            total_absent += lec_absent

            if s.class_id in by_class_agg:
                by_class_agg[s.class_id]["present"] += lec_present
                by_class_agg[s.class_id]["late"] += lec_late
                by_class_agg[s.class_id]["absent"] += lec_absent

            d_entry = daily_agg.setdefault(date_str, {
                "date": date_str,
                "label": date_label,
                "present": 0,
                "late": 0,
                "absent": 0,
                "attendance_pct": 0.0,
            })
            d_entry["present"] += lec_present
            d_entry["late"] += lec_late
            d_entry["absent"] += lec_absent

        lectures_out.append({
            "session_id": s.id,
            "date": date_str,
            "class_id": s.class_id,
            "class_name": cls_name,
            "subject_name": subj_name,
            "teacher_name": teacher_name,
            "time_12h": time_range_12h,
            "status": s.status if has_started else "UPCOMING",
            "present": lec_present,
            "late": lec_late,
            "absent": lec_absent,
            "total_students": len(cls_students),
        })

    # Compute percentages cleanly
    for item in by_class_agg.values():
        denom = item["present"] + item["late"] + item["absent"]
        item["attendance_pct"] = round(((item["present"] + item["late"]) / denom * 100.0), 1) if denom > 0 else 0.0

    daily_trend = []
    for d_key in sorted(daily_agg.keys()):
        d_item = daily_agg[d_key]
        denom = d_item["present"] + d_item["late"] + d_item["absent"]
        d_item["attendance_pct"] = round(((d_item["present"] + d_item["late"]) / denom * 100.0), 1) if denom > 0 else 0.0
        daily_trend.append(d_item)

    student_register = []
    for st_item in student_agg.values():
        denom = st_item["total_lectures"]
        st_item["attendance_pct"] = round(((st_item["present"] + st_item["late"]) / denom * 100.0), 1) if denom > 0 else 0.0
        student_register.append(st_item)

    grand_denom = total_present + total_late + total_absent
    overall_pct = round(((total_present + total_late) / grand_denom * 100.0), 1) if grand_denom > 0 else 0.0

    return {
        "period": period,
        "period_label": period_label,
        "summary": {
            "total_lectures": counted_lectures,
            "scheduled_lectures": len(sessions),
            "present": total_present,
            "late": total_late,
            "absent": total_absent,
            "attendance_pct": overall_pct,
        },
        "by_class": list(by_class_agg.values()),
        "daily_trend": daily_trend,
        "lectures": lectures_out,
        "student_register": student_register,
    }


@router.post("/archive-test-records")
async def archive_test_records_and_reset(
    request: Request,
    batch_name: Optional[str] = Query(None, description="Label for archived test records batch"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """
    Production Deployment Reset:
    1. Archives ALL current attendance_records into archived_test_records (preserving test history).
    2. Clears active attendance_records so production starts 100% fresh.
    3. Resets in-memory camera identity cooldowns so students can be scanned immediately.
    """
    tz = ZoneInfo(settings.TIMEZONE)
    now_local = datetime.now(tz)
    label = (batch_name or "").strip() or f"Pre-Production Test Records ({now_local.strftime('%b %d, %Y %I:%M %p')})"

    rows = (
        await db.execute(
            select(AttendanceRecord)
            .options(
                selectinload(AttendanceRecord.student).selectinload(Student.class_group),
                selectinload(AttendanceRecord.session).selectinload(LabSession.subject),
                selectinload(AttendanceRecord.session).selectinload(LabSession.class_group),
            )
            .order_by(AttendanceRecord.timestamp.asc())
        )
    ).scalars().all()

    archived_count = 0
    for r in rows:
        ts_utc = r.timestamp if r.timestamp.tzinfo else r.timestamp.replace(tzinfo=timezone.utc)
        session_date = ts_utc.astimezone(tz).strftime("%Y-%m-%d")
        cls_name = (
            r.session.class_group.name if (r.session and r.session.class_group)
            else (r.student.class_group.name if (r.student and r.student.class_group) else "CIT Class")
        )
        subj_name = (
            r.session.subject_title if (r.session and r.session.subject_title)
            else (r.session.subject.name if (r.session and r.session.subject) else "Computer Lab")
        )
        teacher_name = r.session.teacher_display_name if r.session else ""
        db.add(
            ArchivedTestRecord(
                archive_batch_name=label,
                session_date=session_date,
                class_name=cls_name,
                subject_name=subj_name,
                teacher_name=teacher_name or "",
                roll_number=r.student.roll_number if r.student else "N/A",
                student_name=r.student.full_name if r.student else "Unknown",
                status=r.status,
                entry_time=ts_utc,
                verification_method=r.verification_method,
                notes=r.notes,
            )
        )
        archived_count += 1

    await db.execute(delete(AttendanceRecord))

    # Also mark already-started/past pre-production sessions as CANCELLED so
    # they do not count students as ABSENT after a fresh production reset
    # (while keeping their timetable_slot_id rows so today's past slots are
    # not auto-recreated by sync_sessions_for_date).
    now_utc = datetime.now(timezone.utc)
    past_sessions = (
        await db.execute(
            select(LabSession).where(
                and_(
                    LabSession.start_time <= now_utc,
                    LabSession.status != "CANCELLED",
                )
            )
        )
    ).scalars().all()
    for ps in past_sessions:
        ps.status = "CANCELLED"
        ps.status_note = f"Reset for production ({label})"

    await db.commit()

    # Clear live recognition cooldowns so students can immediately be marked fresh
    engine = getattr(request.app.state, "recognition_engine", None)
    if engine and getattr(engine, "confirmation_engine", None):
        engine.confirmation_engine._identity_cooldowns.clear()

    return {
        "success": True,
        "archived_count": archived_count,
        "batch_name": label,
        "message": (
            f"Archived {archived_count} test record(s) into '{label}' and cleared live attendance for fresh production start."
        ),
    }


@router.get("/test-archives")
async def list_archived_test_records(db: AsyncSession = Depends(get_db)):
    """Returns all archived pre-production test attendance records."""
    tz = ZoneInfo(settings.TIMEZONE)
    rows = (
        await db.execute(
            select(ArchivedTestRecord).order_by(ArchivedTestRecord.archived_at.desc(), ArchivedTestRecord.entry_time.desc())
        )
    ).scalars().all()

    return [
        {
            "id": r.id,
            "archive_batch_name": r.archive_batch_name,
            "archived_at": (r.archived_at if r.archived_at.tzinfo else r.archived_at.replace(tzinfo=timezone.utc)).isoformat(),
            "session_date": r.session_date,
            "class_name": r.class_name,
            "subject_name": r.subject_name,
            "teacher_name": r.teacher_name or "",
            "roll_number": r.roll_number,
            "student_name": r.student_name,
            "status": r.status,
            "entry_time_12h": _fmt_12h(r.entry_time, tz),
            "verification_method": r.verification_method or "",
            "notes": r.notes or "",
        }
        for r in rows
    ]


@router.get("/projector-live")
async def get_projector_live_display(db: AsyncSession = Depends(get_db)):
    """
    Dedicated real-time payload for the second-screen / projector display.
    Shows ONLY today's Computer Lab-1 attendance:
    - Auto-switches to the active lecture (with back-to-back carry-forward)
    - Returns full lists of Present, Late, and Absent student names & roll numbers
    - Returns teacher name, class name, room name (Computer Lab-1), 12h time, and today's schedule strip.
    """
    tz = ZoneInfo(settings.TIMEZONE)
    now_local = datetime.now(tz)
    now_utc = datetime.now(timezone.utc)

    from backend.app.api.v1.endpoints.timetable import sync_sessions_for_date
    today_sessions = await sync_sessions_for_date(db)

    # Filter out cancelled sessions for active detection, keep all for schedule strip
    active_session = None
    next_session = None
    schedule_strip = []

    for s in today_sessions:
        st_utc = s.start_time if s.start_time.tzinfo else s.start_time.replace(tzinfo=timezone.utc)
        et_utc = s.end_time if s.end_time.tzinfo else s.end_time.replace(tzinfo=timezone.utc)
        subj_name = s.subject_title or (s.subject.name if s.subject else "Computer Lab")
        teacher_name = s.teacher_display_name or (s.teacher.full_name if s.teacher else "")
        cls_name = s.class_group.name if s.class_group else "CIT Class"
        time_12h = f"{_fmt_12h(st_utc, tz)} - {_fmt_12h(et_utc, tz)}"

        is_cancelled = s.status == "CANCELLED"
        is_live = (not is_cancelled) and (st_utc - timedelta(minutes=15) <= now_utc <= et_utc)
        is_past = et_utc < now_utc
        is_upcoming = (not is_cancelled) and (st_utc > now_utc + timedelta(minutes=15))

        if is_live and active_session is None:
            active_session = s
        elif (not is_cancelled) and (st_utc > now_utc) and next_session is None and s != active_session:
            next_session = s

        schedule_strip.append({
            "session_id": s.id,
            "class_name": cls_name,
            "subject_name": subj_name,
            "teacher_name": teacher_name,
            "time_12h": time_12h,
            "state": "CANCELLED" if is_cancelled else ("LIVE" if is_live else ("COMPLETED" if is_past else "UPCOMING")),
        })

    # Also check if any session was manually forced ACTIVE
    if active_session is None:
        for s in today_sessions:
            if s.status == "ACTIVE":
                active_session = s
                break

    current_payload = None
    if active_session is not None:
        st_utc = active_session.start_time if active_session.start_time.tzinfo else active_session.start_time.replace(tzinfo=timezone.utc)
        et_utc = active_session.end_time if active_session.end_time.tzinfo else active_session.end_time.replace(tzinfo=timezone.utc)

        # Auto-carry forward if consecutive lecture has started
        if now_utc >= st_utc:
            await AttendanceService.carry_forward_from_previous_session(db, active_session)

        # Fetch all active students in this lecture's class
        cls_students = (
            await db.execute(
                select(Student)
                .where(and_(Student.class_id == active_session.class_id, Student.status == "ACTIVE"))
                .order_by(Student.roll_number.asc())
            )
        ).scalars().all()

        # Fetch attendance records for this session
        att_rows = (
            await db.execute(
                select(AttendanceRecord).where(AttendanceRecord.session_id == active_session.id)
            )
        ).scalars().all()
        att_by_student = {r.student_id: r for r in att_rows}

        present_list = []
        late_list = []
        absent_list = []

        for st in cls_students:
            rec = att_by_student.get(st.id)
            if rec and rec.status in ("PRESENT", "EXCUSED", "MANUAL_CORRECTION"):
                present_list.append({
                    "student_id": st.id,
                    "roll_number": st.roll_number,
                    "full_name": st.full_name,
                    "entry_time_12h": _fmt_12h(rec.timestamp, tz),
                    "verification_method": rec.verification_method,
                })
            elif rec and rec.status == "LATE":
                late_list.append({
                    "student_id": st.id,
                    "roll_number": st.roll_number,
                    "full_name": st.full_name,
                    "entry_time_12h": _fmt_12h(rec.timestamp, tz),
                    "verification_method": rec.verification_method,
                })
            else:
                absent_list.append({
                    "student_id": st.id,
                    "roll_number": st.roll_number,
                    "full_name": st.full_name,
                })

        total_cls = len(cls_students)
        attended = len(present_list) + len(late_list)
        pct = round((attended / total_cls * 100.0), 1) if total_cls > 0 else 0.0

        # Compute lecture progress percentage (0 - 100)
        total_sec = max(1.0, (et_utc - st_utc).total_seconds())
        elapsed_sec = max(0.0, min(total_sec, (now_utc - st_utc).total_seconds()))
        progress_pct = round((elapsed_sec / total_sec) * 100.0, 1)

        current_payload = {
            "session_id": active_session.id,
            "class_name": active_session.class_group.name if active_session.class_group else "CIT Class",
            "subject_name": active_session.subject_title or (active_session.subject.name if active_session.subject else "Computer Lab"),
            "teacher_name": active_session.teacher_display_name or (active_session.teacher.full_name if active_session.teacher else "Lab Instructor"),
            "room_name": "Computer Lab-1",
            "time_12h": f"{_fmt_12h(st_utc, tz)} – {_fmt_12h(et_utc, tz)}",
            "late_grace_minutes": active_session.late_grace_minutes,
            "status": active_session.status,
            "status_note": active_session.status_note,
            "progress_pct": progress_pct,
            "total_students": total_cls,
            "present_count": len(present_list),
            "late_count": len(late_list),
            "absent_count": len(absent_list),
            "attendance_pct": pct,
            "present_students": present_list,
            "late_students": late_list,
            "absent_students": absent_list,
        }

    next_payload = None
    if next_session is not None:
        nst = next_session.start_time if next_session.start_time.tzinfo else next_session.start_time.replace(tzinfo=timezone.utc)
        net = next_session.end_time if next_session.end_time.tzinfo else next_session.end_time.replace(tzinfo=timezone.utc)
        next_payload = {
            "class_name": next_session.class_group.name if next_session.class_group else "CIT Class",
            "subject_name": next_session.subject_title or (next_session.subject.name if next_session.subject else "Computer Lab"),
            "teacher_name": next_session.teacher_display_name or (next_session.teacher.full_name if next_session.teacher else ""),
            "room_name": "Computer Lab-1",
            "time_12h": f"{_fmt_12h(nst, tz)} – {_fmt_12h(net, tz)}",
        }

    return {
        "today_date_label": now_local.strftime("%A, %B %d, %Y"),
        "room_name": "Computer Lab-1",
        "current_lecture": current_payload,
        "next_lecture": next_payload,
        "today_schedule": schedule_strip,
    }


