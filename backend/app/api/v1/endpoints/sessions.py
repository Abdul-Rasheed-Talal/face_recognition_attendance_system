"""
Laboratory Sessions API Endpoints.
"""

from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.database import get_db
from backend.app.models.entities import LabSession, Subject, Laboratory, User, ClassGroup, Department
from backend.app.schemas.domain import (
    SessionCreate,
    SessionOut,
    SubjectCreate,
    SubjectOut,
    LaboratoryCreate,
    LaboratoryOut,
)
from backend.app.api.v1.deps import require_teacher_or_admin

router = APIRouter(prefix="/sessions", tags=["Lab Sessions"])


@router.get("/subjects", response_model=List[SubjectOut])
async def list_subjects(db: AsyncSession = Depends(get_db)):
    """Lists all academic subjects for timetable scheduling."""
    res = await db.execute(select(Subject).order_by(Subject.name))
    return res.scalars().all()


@router.post("/subjects", response_model=SubjectOut, status_code=status.HTTP_201_CREATED)
async def create_subject(
    subject_in: SubjectCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Creates a subject. The department must exist."""
    dept_obj = (await db.execute(select(Department).where(Department.id == subject_in.department_id))).scalars().first()
    if not dept_obj:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Department '{subject_in.department_id}' does not exist.")
    subject = Subject(department_id=dept_obj.id, code=subject_in.code.strip(), name=subject_in.name.strip())
    db.add(subject)
    await db.commit()
    await db.refresh(subject)
    return subject


@router.get("/laboratories", response_model=List[LaboratoryOut])
async def list_laboratories(db: AsyncSession = Depends(get_db)):
    """Lists laboratories (the gate lab is the one sessions run in)."""
    res = await db.execute(select(Laboratory).order_by(Laboratory.name))
    return res.scalars().all()


@router.post("/laboratories", response_model=LaboratoryOut, status_code=status.HTTP_201_CREATED)
async def create_laboratory(
    lab_in: LaboratoryCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Creates a laboratory. Room numbers are unique."""
    existing = (await db.execute(select(Laboratory).where(Laboratory.room_number == lab_in.room_number.strip()))).scalars().first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Laboratory room '{lab_in.room_number}' already exists.")
    lab = Laboratory(
        name=lab_in.name.strip(),
        room_number=lab_in.room_number.strip(),
        building=lab_in.building.strip(),
        capacity=lab_in.capacity,
    )
    db.add(lab)
    await db.commit()
    await db.refresh(lab)
    return lab


@router.get("", response_model=List[SessionOut])
async def list_sessions(
    laboratory_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    class_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Lists laboratory sessions."""
    query = (
        select(LabSession)
        .options(
            selectinload(LabSession.subject),
            selectinload(LabSession.laboratory),
            selectinload(LabSession.teacher),
            selectinload(LabSession.class_group),
        )
        .order_by(LabSession.start_time.asc())
    )

    if laboratory_id:
        query = query.where(LabSession.laboratory_id == laboratory_id)
    if status_filter:
        query = query.where(LabSession.status == status_filter)
    if class_id:
        query = query.where(LabSession.class_id == class_id)

    res = await db.execute(query)
    sessions = res.scalars().all()

    output = []
    for s in sessions:
        output.append(
            SessionOut(
                id=s.id,
                subject_name=s.subject.name if s.subject else "Unknown Subject",
                subject_code=s.subject.code if s.subject else "N/A",
                laboratory_name=s.laboratory.name if s.laboratory else "Gate / Laboratory",
                room_number=s.laboratory.room_number if s.laboratory else "N/A",
                teacher_name=s.teacher.full_name if s.teacher else "Teacher",
                class_name=s.class_group.name if s.class_group else "Class",
                start_time=s.start_time,
                end_time=s.end_time,
                late_grace_minutes=s.late_grace_minutes,
                status=s.status,
            )
        )
    return output


@router.get("/active", response_model=Optional[SessionOut])
async def get_active_session(
    laboratory_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Retrieves currently active laboratory session."""
    now = datetime.now(timezone.utc)
    query = (
        select(LabSession)
        .options(
            selectinload(LabSession.subject),
            selectinload(LabSession.laboratory),
            selectinload(LabSession.teacher),
            selectinload(LabSession.class_group),
        )
        .where(
            and_(
                LabSession.status.in_(["ACTIVE", "SCHEDULED"]),
                LabSession.start_time <= now,
                LabSession.end_time >= now,
            )
        )
    )
    if laboratory_id:
        query = query.where(LabSession.laboratory_id == laboratory_id)

    res = await db.execute(query)
    s = res.scalars().first()

    if not s:
        # Check if any session is explicitly flagged ACTIVE
        q_act = (
            select(LabSession)
            .options(
                selectinload(LabSession.subject),
                selectinload(LabSession.laboratory),
                selectinload(LabSession.teacher),
                selectinload(LabSession.class_group),
            )
            .where(LabSession.status == "ACTIVE")
        )
        if laboratory_id:
            q_act = q_act.where(LabSession.laboratory_id == laboratory_id)
        res_act = await db.execute(q_act)
        s = res_act.scalars().first()

    if not s:
        return None

    return SessionOut(
        id=s.id,
        subject_name=s.subject.name if s.subject else "Unknown Subject",
        subject_code=s.subject.code if s.subject else "N/A",
        laboratory_name=s.laboratory.name if s.laboratory else "Unknown Lab",
        room_number=s.laboratory.room_number if s.laboratory else "N/A",
        teacher_name=s.teacher.full_name if s.teacher else "Unknown Teacher",
        class_name=s.class_group.name if s.class_group else "Unknown Class",
        start_time=s.start_time,
        end_time=s.end_time,
        late_grace_minutes=s.late_grace_minutes,
        status=s.status,
    )


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    session_in: SessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_teacher_or_admin),
):
    """Schedules a new lab session. Every referenced row must exist,
    the session must end after it starts, and it must not overlap an
    existing session for the same class in the same lab."""
    if session_in.start_time >= session_in.end_time:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session end_time must be after start_time.")
    for model, value, label in (
        (Subject, session_in.subject_id, "Subject"),
        (Laboratory, session_in.laboratory_id, "Laboratory"),
        (ClassGroup, session_in.class_id, "Class"),
    ):
        exists = (await db.execute(select(model).where(model.id == value))).scalars().first()
        if not exists:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{label} '{value}' does not exist.")
    teacher_id = session_in.teacher_id or current_user.id
    teacher = (await db.execute(select(User).where(User.id == teacher_id))).scalars().first()
    if not teacher:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Teacher '{teacher_id}' does not exist.")
    overlap = (await db.execute(
        select(LabSession).where(
            and_(
                LabSession.class_id == session_in.class_id,
                LabSession.laboratory_id == session_in.laboratory_id,
                LabSession.status.in_(["SCHEDULED", "ACTIVE"]),
                LabSession.start_time < session_in.end_time,
                LabSession.end_time > session_in.start_time,
            )
        )
    )).scalars().first()
    if overlap:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This class already has a session in this lab overlapping the requested time.",
        )

    new_session = LabSession(
        subject_id=session_in.subject_id,
        laboratory_id=session_in.laboratory_id,
        teacher_id=teacher_id,
        class_id=session_in.class_id,
        start_time=session_in.start_time,
        end_time=session_in.end_time,
        late_grace_minutes=session_in.late_grace_minutes,
        status="SCHEDULED",
    )
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)

    # Reload relationships
    res = await db.execute(
        select(LabSession)
        .options(
            selectinload(LabSession.subject),
            selectinload(LabSession.laboratory),
            selectinload(LabSession.teacher),
            selectinload(LabSession.class_group),
        )
        .where(LabSession.id == new_session.id)
    )
    s = res.scalars().first()

    return SessionOut(
        id=s.id,
        subject_name=s.subject.name if s.subject else "Unknown Subject",
        subject_code=s.subject.code if s.subject else "N/A",
        laboratory_name=s.laboratory.name if s.laboratory else "Unknown Lab",
        room_number=s.laboratory.room_number if s.laboratory else "N/A",
        teacher_name=s.teacher.full_name if s.teacher else "Unknown Teacher",
        class_name=s.class_group.name if s.class_group else "Unknown Class",
        start_time=s.start_time,
        end_time=s.end_time,
        late_grace_minutes=s.late_grace_minutes,
        status=s.status,
    )


@router.put("/{session_id}", response_model=SessionOut)
async def update_session_status(
    session_id: str,
    status_update: Optional[str] = Query(None),
    late_grace_minutes: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Updates session status (e.g. ACTIVE, COMPLETED, CANCELLED) or grace period."""
    res = await db.execute(
        select(LabSession)
        .options(
            selectinload(LabSession.subject),
            selectinload(LabSession.laboratory),
            selectinload(LabSession.teacher),
            selectinload(LabSession.class_group),
        )
        .where(LabSession.id == session_id)
    )
    s = res.scalars().first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found.")

    if status_update:
        if status_update not in ("SCHEDULED", "ACTIVE", "COMPLETED", "CANCELLED"):
            raise HTTPException(status_code=400, detail=f"Invalid status '{status_update}'. Use SCHEDULED, ACTIVE, COMPLETED or CANCELLED.")
        s.status = status_update
    if late_grace_minutes is not None:
        if late_grace_minutes < 0:
            raise HTTPException(status_code=400, detail="late_grace_minutes must be 0 or more.")
        s.late_grace_minutes = late_grace_minutes

    await db.commit()
    await db.refresh(s)

    return SessionOut(
        id=s.id,
        subject_name=s.subject.name if s.subject else "Unknown Subject",
        subject_code=s.subject.code if s.subject else "N/A",
        laboratory_name=s.laboratory.name if s.laboratory else "Unknown Lab",
        room_number=s.laboratory.room_number if s.laboratory else "N/A",
        teacher_name=s.teacher.full_name if s.teacher else "Unknown Teacher",
        class_name=s.class_group.name if s.class_group else "Unknown Class",
        start_time=s.start_time,
        end_time=s.end_time,
        late_grace_minutes=s.late_grace_minutes,
        status=s.status,
    )


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Deletes a session from the timetable."""
    res = await db.execute(select(LabSession).where(LabSession.id == session_id))
    s = res.scalars().first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found.")

    await db.delete(s)
    await db.commit()
    return {"success": True, "message": "Class session deleted from timetable."}

