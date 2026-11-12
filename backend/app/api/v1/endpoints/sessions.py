"""
Laboratory Sessions API Endpoints.
"""

from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.database import get_db
from backend.app.models.entities import LabSession, Subject, Laboratory, User, ClassGroup
from backend.app.schemas.domain import SessionCreate, SessionOut
from backend.app.api.v1.deps import require_teacher_or_admin

router = APIRouter(prefix="/sessions", tags=["Lab Sessions"])


@router.get("", response_model=List[SessionOut])
async def list_sessions(
    laboratory_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
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
        .order_by(LabSession.start_time.desc())
    )

    if laboratory_id:
        query = query.where(LabSession.laboratory_id == laboratory_id)
    if status_filter:
        query = query.where(LabSession.status == status_filter)

    res = await db.execute(query)
    sessions = res.scalars().all()

    output = []
    for s in sessions:
        output.append(
            SessionOut(
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
    """Schedules a new lab session."""
    teacher_id = session_in.teacher_id or current_user.id

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

