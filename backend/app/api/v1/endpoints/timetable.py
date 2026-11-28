"""
CIT Computer Lab Timetable & Daily Schedule Management API.
Supports:
- Weekly recurring lab timetable for CIT 1st Year, CIT 2nd Year, CIT 3rd Year
- Automatic daily session generation from the weekly timetable (in Asia/Karachi local time)
- Rescheduling classes (new time, substitute teacher, reason)
- Cancelling classes when a teacher is absent (or restoring cancelled classes)
- Adding one-off extra / makeup lab classes
"""

from datetime import datetime, date, time as dt_time, timezone, timedelta
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.config import settings
from backend.app.core.database import get_db
from backend.app.models.entities import (
    TimetableSlot,
    LabSession,
    ClassGroup,
    Subject,
    Laboratory,
    User,
)
from backend.app.api.v1.deps import require_teacher_or_admin

router = APIRouter(prefix="/timetable", tags=["CIT Lab Timetable"])

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ------------------------------------------------------------------------------
# Pydantic Schemas
# ------------------------------------------------------------------------------

class TimetableSlotCreate(BaseModel):
    day_of_week: int = Field(..., ge=0, le=6, description="0=Monday .. 5=Saturday, 6=Sunday")
    class_id: str
    subject_name: str = Field(..., min_length=1, max_length=120)
    teacher_name: str = Field(default="", max_length=100)
    start_time_str: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    end_time_str: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    late_grace_minutes: int = Field(default=15, ge=0, le=120)


class TimetableSlotUpdate(BaseModel):
    day_of_week: Optional[int] = Field(default=None, ge=0, le=6)
    class_id: Optional[str] = None
    subject_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    teacher_name: Optional[str] = Field(default=None, max_length=100)
    start_time_str: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end_time_str: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    late_grace_minutes: Optional[int] = Field(default=None, ge=0, le=120)
    is_active: Optional[bool] = None


class TimetableSlotOut(BaseModel):
    id: str
    day_of_week: int
    day_name: str
    class_id: str
    class_name: str
    subject_name: str
    teacher_name: str
    start_time_str: str
    end_time_str: str
    late_grace_minutes: int
    is_active: bool


class DailySessionOut(BaseModel):
    id: str
    timetable_slot_id: Optional[str] = None
    class_id: str
    class_name: str
    subject_name: str
    teacher_name: str
    start_time: datetime
    end_time: datetime
    start_time_local: str
    end_time_local: str
    late_grace_minutes: int
    status: str  # SCHEDULED, ACTIVE, RESCHEDULED, CANCELLED, COMPLETED
    status_note: Optional[str] = None
    is_live_now: bool = False


class ExtraSessionCreate(BaseModel):
    target_date: Optional[str] = None  # YYYY-MM-DD in local timezone; defaults to today
    class_id: str
    subject_name: str = Field(..., min_length=1, max_length=120)
    teacher_name: str = Field(default="", max_length=100)
    start_time_str: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    end_time_str: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    late_grace_minutes: int = Field(default=15, ge=0, le=120)
    status_note: Optional[str] = "Extra / Makeup Lab Class"


class RescheduleRequest(BaseModel):
    target_date: Optional[str] = None  # YYYY-MM-DD (optional: move to another day)
    start_time_str: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    end_time_str: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    teacher_name: Optional[str] = None
    subject_name: Optional[str] = None
    class_id: Optional[str] = None
    late_grace_minutes: Optional[int] = Field(default=None, ge=0, le=120)
    reason: str = Field(default="Rescheduled due to teacher unavailability", max_length=250)


class CancelSessionRequest(BaseModel):
    reason: str = Field(default="Teacher absent — lab class cancelled", max_length=250)


# ------------------------------------------------------------------------------
# Helpers: Local Timezone Conversion & Daily Session Sync
# ------------------------------------------------------------------------------

def _parse_hhmm(hhmm: str) -> dt_time:
    parts = hhmm.strip().split(":")
    return dt_time(int(parts[0]), int(parts[1]))


def _local_to_utc(d: date, hhmm: str) -> datetime:
    tz = ZoneInfo(settings.TIMEZONE)
    t = _parse_hhmm(hhmm)
    local_dt = datetime(d.year, d.month, d.day, t.hour, t.minute, 0, tzinfo=tz)
    return local_dt.astimezone(timezone.utc)


def _utc_to_local_hhmm(dt: datetime) -> str:
    tz = ZoneInfo(settings.TIMEZONE)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).strftime("%H:%M")


async def _get_default_lab_subject_operator(db: AsyncSession):
    lab = (await db.execute(select(Laboratory).limit(1))).scalars().first()
    subj = (await db.execute(select(Subject).limit(1))).scalars().first()
    op = (await db.execute(select(User).limit(1))).scalars().first()
    return lab, subj, op


async def sync_sessions_for_date(db: AsyncSession, target_date: Optional[date] = None) -> List[LabSession]:
    """
    Ensures every active weekly TimetableSlot for target_date's day_of_week has a
    corresponding LabSession row for that date. Existing sessions (including cancelled
    or rescheduled ones) are preserved untouched.
    """
    tz = ZoneInfo(settings.TIMEZONE)
    if target_date is None:
        target_date = datetime.now(tz).date()

    day_start_utc = datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0, tzinfo=tz).astimezone(timezone.utc)
    day_end_utc = day_start_utc + timedelta(days=1)

    # Fetch weekly slots for this day of week
    dow = target_date.weekday()  # 0=Mon .. 6=Sun
    slots_res = await db.execute(
        select(TimetableSlot)
        .where(
            and_(
                TimetableSlot.day_of_week == dow,
                TimetableSlot.is_active == True,
            )
        )
        .order_by(TimetableSlot.start_time_str.asc())
    )
    slots = slots_res.scalars().all()

    # Fetch already-created sessions for this date
    existing_res = await db.execute(
        select(LabSession)
        .where(
            and_(
                LabSession.start_time >= day_start_utc,
                LabSession.start_time < day_end_utc,
            )
        )
    )
    existing_sessions = existing_res.scalars().all()
    existing_slot_ids = {s.timetable_slot_id for s in existing_sessions if s.timetable_slot_id}

    lab, subj, op = await _get_default_lab_subject_operator(db)
    created_any = False

    if lab and subj and op:
        for slot in slots:
            if slot.id in existing_slot_ids:
                continue
            start_utc = _local_to_utc(target_date, slot.start_time_str)
            end_utc = _local_to_utc(target_date, slot.end_time_str)
            if end_utc <= start_utc:
                continue
            db.add(
                LabSession(
                    subject_id=subj.id,
                    laboratory_id=lab.id,
                    teacher_id=op.id,
                    class_id=slot.class_id,
                    start_time=start_utc,
                    end_time=end_utc,
                    late_grace_minutes=slot.late_grace_minutes,
                    status="SCHEDULED",
                    timetable_slot_id=slot.id,
                    subject_title=slot.subject_name,
                    teacher_display_name=slot.teacher_name,
                )
            )
            created_any = True

    if created_any:
        await db.commit()

    # Return fresh list with relationships
    final_res = await db.execute(
        select(LabSession)
        .options(
            selectinload(LabSession.class_group),
            selectinload(LabSession.subject),
            selectinload(LabSession.teacher),
        )
        .where(
            and_(
                LabSession.start_time >= day_start_utc,
                LabSession.start_time < day_end_utc,
            )
        )
        .order_by(LabSession.start_time.asc())
    )
    return list(final_res.scalars().all())


def _serialize_daily_session(s: LabSession) -> DailySessionOut:
    now = datetime.now(timezone.utc)
    st = s.start_time if s.start_time.tzinfo else s.start_time.replace(tzinfo=timezone.utc)
    et = s.end_time if s.end_time.tzinfo else s.end_time.replace(tzinfo=timezone.utc)
    is_live = s.status in ("SCHEDULED", "ACTIVE", "RESCHEDULED") and (st - timedelta(minutes=15) <= now <= et)

    return DailySessionOut(
        id=s.id,
        timetable_slot_id=s.timetable_slot_id,
        class_id=s.class_id,
        class_name=s.class_group.name if s.class_group else "CIT Class",
        subject_name=s.subject_title or (s.subject.name if s.subject else "Computer Lab"),
        teacher_name=s.teacher_display_name or (s.teacher.full_name if s.teacher else ""),
        start_time=st,
        end_time=et,
        start_time_local=_utc_to_local_hhmm(st),
        end_time_local=_utc_to_local_hhmm(et),
        late_grace_minutes=s.late_grace_minutes,
        status=s.status,
        status_note=s.status_note,
        is_live_now=is_live,
    )


# ------------------------------------------------------------------------------
# Weekly Master Timetable Endpoints
# ------------------------------------------------------------------------------

@router.get("/slots", response_model=List[TimetableSlotOut])
async def list_weekly_slots(
    day_of_week: Optional[int] = Query(None, ge=0, le=6),
    class_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Lists all recurring weekly Computer Lab timetable slots."""
    query = (
        select(TimetableSlot)
        .options(selectinload(TimetableSlot.class_group))
        .order_by(TimetableSlot.day_of_week.asc(), TimetableSlot.start_time_str.asc())
    )
    if day_of_week is not None:
        query = query.where(TimetableSlot.day_of_week == day_of_week)
    if class_id:
        query = query.where(TimetableSlot.class_id == class_id)

    res = await db.execute(query)
    slots = res.scalars().all()
    return [
        TimetableSlotOut(
            id=sl.id,
            day_of_week=sl.day_of_week,
            day_name=DAY_NAMES[sl.day_of_week],
            class_id=sl.class_id,
            class_name=sl.class_group.name if sl.class_group else "CIT Class",
            subject_name=sl.subject_name,
            teacher_name=sl.teacher_name or "",
            start_time_str=sl.start_time_str,
            end_time_str=sl.end_time_str,
            late_grace_minutes=sl.late_grace_minutes,
            is_active=sl.is_active,
        )
        for sl in slots
    ]


@router.post("/slots", response_model=TimetableSlotOut, status_code=status.HTTP_201_CREATED)
async def create_weekly_slot(
    payload: TimetableSlotCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Adds a recurring weekly Computer Lab slot to the master timetable."""
    if _parse_hhmm(payload.end_time_str) <= _parse_hhmm(payload.start_time_str):
        raise HTTPException(status_code=400, detail="End time must be after start time.")

    cls_obj = (await db.execute(select(ClassGroup).where(ClassGroup.id == payload.class_id))).scalars().first()
    if not cls_obj:
        raise HTTPException(status_code=404, detail="Selected CIT class not found.")

    slot = TimetableSlot(
        day_of_week=payload.day_of_week,
        class_id=payload.class_id,
        subject_name=payload.subject_name.strip(),
        teacher_name=payload.teacher_name.strip(),
        start_time_str=payload.start_time_str,
        end_time_str=payload.end_time_str,
        late_grace_minutes=payload.late_grace_minutes,
        is_active=True,
    )
    db.add(slot)
    await db.commit()
    await db.refresh(slot)

    # If this slot is for today's day of week, immediately sync today's sessions
    tz = ZoneInfo(settings.TIMEZONE)
    if payload.day_of_week == datetime.now(tz).weekday():
        await sync_sessions_for_date(db)

    return TimetableSlotOut(
        id=slot.id,
        day_of_week=slot.day_of_week,
        day_name=DAY_NAMES[slot.day_of_week],
        class_id=slot.class_id,
        class_name=cls_obj.name,
        subject_name=slot.subject_name,
        teacher_name=slot.teacher_name,
        start_time_str=slot.start_time_str,
        end_time_str=slot.end_time_str,
        late_grace_minutes=slot.late_grace_minutes,
        is_active=slot.is_active,
    )


@router.put("/slots/{slot_id}", response_model=TimetableSlotOut)
async def update_weekly_slot(
    slot_id: str,
    payload: TimetableSlotUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Alters an existing weekly timetable slot."""
    res = await db.execute(
        select(TimetableSlot)
        .options(selectinload(TimetableSlot.class_group))
        .where(TimetableSlot.id == slot_id)
    )
    slot = res.scalars().first()
    if not slot:
        raise HTTPException(status_code=404, detail="Timetable slot not found.")

    if payload.day_of_week is not None:
        slot.day_of_week = payload.day_of_week
    if payload.class_id is not None:
        slot.class_id = payload.class_id
    if payload.subject_name is not None:
        slot.subject_name = payload.subject_name.strip()
    if payload.teacher_name is not None:
        slot.teacher_name = payload.teacher_name.strip()
    if payload.start_time_str is not None:
        slot.start_time_str = payload.start_time_str
    if payload.end_time_str is not None:
        slot.end_time_str = payload.end_time_str
    if payload.late_grace_minutes is not None:
        slot.late_grace_minutes = payload.late_grace_minutes
    if payload.is_active is not None:
        slot.is_active = payload.is_active

    if _parse_hhmm(slot.end_time_str) <= _parse_hhmm(slot.start_time_str):
        raise HTTPException(status_code=400, detail="End time must be after start time.")

    await db.commit()
    await db.refresh(slot)

    cls_obj = (await db.execute(select(ClassGroup).where(ClassGroup.id == slot.class_id))).scalars().first()
    return TimetableSlotOut(
        id=slot.id,
        day_of_week=slot.day_of_week,
        day_name=DAY_NAMES[slot.day_of_week],
        class_id=slot.class_id,
        class_name=cls_obj.name if cls_obj else "CIT Class",
        subject_name=slot.subject_name,
        teacher_name=slot.teacher_name or "",
        start_time_str=slot.start_time_str,
        end_time_str=slot.end_time_str,
        late_grace_minutes=slot.late_grace_minutes,
        is_active=slot.is_active,
    )


@router.delete("/slots/{slot_id}")
async def delete_weekly_slot(
    slot_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Removes a slot from the weekly master timetable."""
    res = await db.execute(select(TimetableSlot).where(TimetableSlot.id == slot_id))
    slot = res.scalars().first()
    if not slot:
        raise HTTPException(status_code=404, detail="Timetable slot not found.")
    await db.delete(slot)
    await db.commit()
    return {"success": True, "message": "Weekly timetable slot removed."}


# ------------------------------------------------------------------------------
# Daily Schedule, Rescheduling & Teacher Absence Endpoints
# ------------------------------------------------------------------------------

@router.get("/today", response_model=List[DailySessionOut])
async def get_daily_schedule(
    target_date: Optional[str] = Query(None, description="YYYY-MM-DD in local timezone"),
    db: AsyncSession = Depends(get_db),
):
    """
    Auto-syncs and returns all Computer Lab sessions for the given date (defaults to Today).
    """
    d: Optional[date] = None
    if target_date:
        try:
            d = date.fromisoformat(target_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    sessions = await sync_sessions_for_date(db, d)
    return [_serialize_daily_session(s) for s in sessions]


@router.post("/today/extra", response_model=DailySessionOut, status_code=status.HTTP_201_CREATED)
async def create_extra_session(
    payload: ExtraSessionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Adds a one-off extra / makeup lab class for a specific day without altering the weekly timetable."""
    tz = ZoneInfo(settings.TIMEZONE)
    d = date.fromisoformat(payload.target_date) if payload.target_date else datetime.now(tz).date()

    start_utc = _local_to_utc(d, payload.start_time_str)
    end_utc = _local_to_utc(d, payload.end_time_str)
    if end_utc <= start_utc:
        raise HTTPException(status_code=400, detail="End time must be after start time.")

    lab, subj, op = await _get_default_lab_subject_operator(db)
    if not (lab and subj and op):
        raise HTTPException(status_code=500, detail="CIT Lab configuration not initialized.")

    new_sess = LabSession(
        subject_id=subj.id,
        laboratory_id=lab.id,
        teacher_id=op.id,
        class_id=payload.class_id,
        start_time=start_utc,
        end_time=end_utc,
        late_grace_minutes=payload.late_grace_minutes,
        status="SCHEDULED",
        subject_title=payload.subject_name.strip(),
        teacher_display_name=payload.teacher_name.strip(),
        status_note=payload.status_note or "Extra Lab Class",
    )
    db.add(new_sess)
    await db.commit()

    res = await db.execute(
        select(LabSession)
        .options(selectinload(LabSession.class_group), selectinload(LabSession.subject), selectinload(LabSession.teacher))
        .where(LabSession.id == new_sess.id)
    )
    return _serialize_daily_session(res.scalars().first())


@router.put("/sessions/{session_id}/reschedule", response_model=DailySessionOut)
async def reschedule_session(
    session_id: str,
    payload: RescheduleRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """
    Reschedules a specific day's lab session (e.g. teacher absent / time shifted / substitute teacher).
    Marks status as RESCHEDULED so the entrance camera marks attendance at the new time.
    """
    res = await db.execute(
        select(LabSession)
        .options(selectinload(LabSession.class_group), selectinload(LabSession.subject), selectinload(LabSession.teacher))
        .where(LabSession.id == session_id)
    )
    s = res.scalars().first()
    if not s:
        raise HTTPException(status_code=404, detail="Lab session not found.")

    tz = ZoneInfo(settings.TIMEZONE)
    if payload.target_date:
        d = date.fromisoformat(payload.target_date)
    else:
        st_utc = s.start_time if s.start_time.tzinfo else s.start_time.replace(tzinfo=timezone.utc)
        d = st_utc.astimezone(tz).date()

    new_start = _local_to_utc(d, payload.start_time_str)
    new_end = _local_to_utc(d, payload.end_time_str)
    if new_end <= new_start:
        raise HTTPException(status_code=400, detail="End time must be after start time.")

    s.start_time = new_start
    s.end_time = new_end
    if payload.teacher_name is not None:
        s.teacher_display_name = payload.teacher_name.strip()
    if payload.subject_name is not None:
        s.subject_title = payload.subject_name.strip()
    if payload.class_id is not None:
        s.class_id = payload.class_id
    if payload.late_grace_minutes is not None:
        s.late_grace_minutes = payload.late_grace_minutes
    s.status = "RESCHEDULED"
    s.status_note = payload.reason

    await db.commit()
    res2 = await db.execute(
        select(LabSession)
        .options(selectinload(LabSession.class_group), selectinload(LabSession.subject), selectinload(LabSession.teacher))
        .where(LabSession.id == s.id)
    )
    return _serialize_daily_session(res2.scalars().first())


@router.put("/sessions/{session_id}/cancel", response_model=DailySessionOut)
async def cancel_session(
    session_id: str,
    payload: CancelSessionRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Marks a lab session as CANCELLED (e.g. teacher absent). Camera will not mark attendance for it."""
    res = await db.execute(
        select(LabSession)
        .options(selectinload(LabSession.class_group), selectinload(LabSession.subject), selectinload(LabSession.teacher))
        .where(LabSession.id == session_id)
    )
    s = res.scalars().first()
    if not s:
        raise HTTPException(status_code=404, detail="Lab session not found.")

    s.status = "CANCELLED"
    s.status_note = payload.reason
    await db.commit()
    await db.refresh(s)
    return _serialize_daily_session(s)


@router.put("/sessions/{session_id}/restore", response_model=DailySessionOut)
async def restore_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Restores a previously cancelled session back to SCHEDULED."""
    res = await db.execute(
        select(LabSession)
        .options(selectinload(LabSession.class_group), selectinload(LabSession.subject), selectinload(LabSession.teacher))
        .where(LabSession.id == session_id)
    )
    s = res.scalars().first()
    if not s:
        raise HTTPException(status_code=404, detail="Lab session not found.")

    s.status = "SCHEDULED"
    s.status_note = None
    await db.commit()
    await db.refresh(s)
    return _serialize_daily_session(s)
