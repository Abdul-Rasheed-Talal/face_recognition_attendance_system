"""
Attendance Business Logic & Session Validation Engine.
Evaluates student eligibility, session timeframes, late grace thresholds, and duplicate prevention.
"""

from datetime import datetime, timezone, timedelta
import logging
from typing import Optional, List, Dict, Any
from fastapi import HTTPException
from sqlalchemy import select, and_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.models.entities import (
    LabSession,
    Student,
    AttendanceRecord,
    AuditLog,
)
from backend.app.cv.types import AttendanceCandidateEvent
from backend.app.websocket.connection_manager import ws_manager

logger = logging.getLogger(__name__)


class AttendanceService:
    """Core attendance business engine executing session rules and persistence."""

    # Statuses a manual attendance entry may carry.
    VALID_MANUAL_STATUSES = {"PRESENT", "LATE", "ABSENT", "EXCUSED", "MANUAL_CORRECTION"}

    @staticmethod
    async def auto_close_expired_sessions(db: AsyncSession, now: Optional[datetime] = None) -> int:
        """Marks sessions COMPLETED once they ended more than
        AUTO_CLOSE_SESSION_HOURS ago. Previously this setting existed in
        config but was never used, so a stale ACTIVE session stayed open
        forever and absorbed students from the wrong class."""
        now = now or datetime.now(timezone.utc)
        cutoff = now - timedelta(hours=settings.AUTO_CLOSE_SESSION_HOURS)
        res = await db.execute(
            select(LabSession).where(
                and_(
                    LabSession.status.in_(["ACTIVE", "SCHEDULED", "RESCHEDULED"]),
                    LabSession.end_time < cutoff,
                )
            )
        )
        expired = res.scalars().all()
        for session in expired:
            session.status = "COMPLETED"
        if expired:
            await db.commit()
            logger.info(f"Auto-closed {len(expired)} expired session(s).")
        return len(expired)

    @staticmethod
    async def get_active_session_for_student(
        db: AsyncSession, student: Student, current_time: Optional[datetime] = None
    ) -> Optional[LabSession]:
        """
        Resolves the timetable session for a specific student. Strict:
        the session must be for the student's own class, status ACTIVE or
        SCHEDULED, and the current time must be inside the entry window
        (up to 45 mins before start, up to 10 mins after end). The old
        fallbacks are gone — one returned any ACTIVE session for the class
        regardless of time, the other returned any ACTIVE session at all,
        so a DAE CIT 1st-year student could be marked in a 3rd-year class.
        """
        now = current_time or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        # Auto-sync today's weekly timetable slots into LabSession rows
        from backend.app.api.v1.endpoints.timetable import sync_sessions_for_date
        await sync_sessions_for_date(db)
        await AttendanceService.auto_close_expired_sessions(db, now)

        # IMPORTANT: Do timedelta arithmetic on Python `now`, NOT on SQLite column
        # `LabSession.start_time` (SQLite cannot subtract timedelta from TEXT datetimes).
        query = (
            select(LabSession)
            .where(
                and_(
                    LabSession.class_id == student.class_id,
                    LabSession.status.in_(["ACTIVE", "SCHEDULED", "RESCHEDULED"]),
                    LabSession.start_time <= now + timedelta(minutes=45),
                    LabSession.end_time >= now - timedelta(minutes=10),
                )
            )
            .order_by(LabSession.start_time.asc())
        )
        res = await db.execute(query)
        return res.scalars().first()

    @staticmethod
    async def carry_forward_from_previous_session(
        db: AsyncSession,
        target_session: LabSession,
        max_gap_minutes: int = 15,
    ) -> int:
        """
        Handles back-to-back lectures for the SAME CIT class in Computer Lab-1
        (when Teacher 1 leaves and Teacher 2 starts the next lecture while students
        remain seated in the lab without re-entering through the gate).

        Finds an immediately preceding session for the same class whose end_time is
        within `max_gap_minutes` of `target_session.start_time` (ignoring breaks > 15m
        and cancelled sessions) and copies all PRESENT/LATE students as PRESENT
        (verification_method='CARRIED_FORWARD'), skipping anyone already recorded.
        """
        if target_session.status == "CANCELLED":
            return 0

        st = (
            target_session.start_time
            if target_session.start_time.tzinfo
            else target_session.start_time.replace(tzinfo=timezone.utc)
        )
        window_start = st - timedelta(minutes=max_gap_minutes)
        window_end = st + timedelta(minutes=5)

        prev_res = await db.execute(
            select(LabSession)
            .options(selectinload(LabSession.subject))
            .where(
                and_(
                    LabSession.id != target_session.id,
                    LabSession.class_id == target_session.class_id,
                    LabSession.status != "CANCELLED",
                    LabSession.end_time >= window_start,
                    LabSession.end_time <= window_end,
                )
            )
            .order_by(LabSession.end_time.desc())
        )
        prev_session = prev_res.scalars().first()
        if prev_session is None:
            return 0

        # Fetch PRESENT/LATE students from the previous consecutive lecture
        prev_att_res = await db.execute(
            select(AttendanceRecord).where(
                and_(
                    AttendanceRecord.session_id == prev_session.id,
                    AttendanceRecord.status.in_(["PRESENT", "LATE"]),
                )
            )
        )
        prev_records = prev_att_res.scalars().all()
        if not prev_records:
            return 0

        # Check who already has a record in target_session (idempotent)
        existing_res = await db.execute(
            select(AttendanceRecord.student_id).where(
                AttendanceRecord.session_id == target_session.id
            )
        )
        already_recorded = set(existing_res.scalars().all())

        prev_title = prev_session.subject_title or (prev_session.subject.name if prev_session.subject else "previous lecture")
        now_utc = datetime.now(timezone.utc)
        created = 0

        for rec in prev_records:
            if rec.student_id in already_recorded:
                continue
            db.add(
                AttendanceRecord(
                    session_id=target_session.id,
                    student_id=rec.student_id,
                    timestamp=now_utc,
                    status="PRESENT",
                    confidence_score=rec.confidence_score,
                    verification_method="CARRIED_FORWARD",
                    notes=f"Auto-carried forward from consecutive lab lecture ({prev_title})",
                )
            )
            created += 1

        if created > 0:
            await db.commit()
            logger.info(
                f"CARRY-FORWARD: Carried {created} student(s) from '{prev_title}' into consecutive session {target_session.id}."
            )
        return created

    @staticmethod
    async def get_active_session_for_lab(
        db: AsyncSession, laboratory_id: Optional[str] = None
    ) -> Optional[LabSession]:
        """
        Finds currently active session across the timetable for dashboard display.
        Also auto-carries forward attendance when a back-to-back same-class lecture begins.
        """
        now = datetime.now(timezone.utc)
        from backend.app.api.v1.endpoints.timetable import sync_sessions_for_date
        await sync_sessions_for_date(db)
        # Close sessions that ended hours ago so the ACTIVE fallback below
        # cannot resurrect a stale one.
        await AttendanceService.auto_close_expired_sessions(db, now)
        query = select(LabSession).where(
            and_(
                LabSession.status.in_(["ACTIVE", "SCHEDULED", "RESCHEDULED"]),
                LabSession.start_time <= now + timedelta(minutes=15),
                LabSession.end_time >= now,
            )
        ).order_by(LabSession.start_time.asc())
        if laboratory_id:
            query = query.where(LabSession.laboratory_id == laboratory_id)

        result = await db.execute(query)
        session = result.scalars().first()

        # Auto-carry forward once the consecutive session has actually started
        if session is not None:
            st = session.start_time if session.start_time.tzinfo else session.start_time.replace(tzinfo=timezone.utc)
            if now >= st:
                await AttendanceService.carry_forward_from_previous_session(db, session)

        # If no strict time match, check if any session is explicitly flagged ACTIVE
        if session is None:
            query_active = select(LabSession).where(LabSession.status == "ACTIVE")
            if laboratory_id:
                query_active = query_active.where(LabSession.laboratory_id == laboratory_id)
            res_active = await db.execute(query_active)
            session = res_active.scalars().first()

        return session

    @staticmethod
    async def process_candidate_event(
        db: AsyncSession,
        event: AttendanceCandidateEvent,
        laboratory_id: Optional[str] = None,
    ) -> Optional[AttendanceRecord]:
        """
        Processes an incoming candidate event from the CV vision engine:
        1. Identifies the student and their enrolled class.
        2. Intelligently matches against today's class Timetable schedule.
        3. Prevents duplicate attendance for the session.
        4. Calculates 'PRESENT' vs 'LATE' based on scheduled start time and grace minutes.
        5. Persists the record atomically and broadcasts via WebSocket.
        """
        # 1. Verify student exists and is active, loading class relationship
        student_res = await db.execute(
            select(Student)
            .options(selectinload(Student.class_group))
            .where(Student.id == event.student_id)
        )
        student = student_res.scalars().first()
        if student is None or student.status != "ACTIVE":
            logger.warning(f"Student {event.student_id} is inactive or not found.")
            return None

        # 2. Find matching timetable session for this student's class
        crossing_dt = event.crossing_timestamp
        active_session = await AttendanceService.get_active_session_for_student(
            db, student, crossing_dt
        )

        if active_session is None:
            class_name = student.class_group.name if student.class_group else "Unknown Class"
            logger.info(
                f"Student {student.full_name} ({student.roll_number}) entered gate, but no scheduled class found in timetable for {class_name} at this time."
            )
            await ws_manager.broadcast_json({
                "type": "ATTENDANCE_NOTICE",
                "student_id": student.id,
                "student_name": student.full_name,
                "roll_number": student.roll_number,
                "class_name": class_name,
                "message": f"Detected {student.full_name} ({student.roll_number}), but no class is scheduled right now.",
                "timestamp": crossing_dt.isoformat(),
            })
            return None

        # Reload session relationships for complete broadcast data
        session_res = await db.execute(
            select(LabSession)
            .options(selectinload(LabSession.subject), selectinload(LabSession.class_group))
            .where(LabSession.id == active_session.id)
        )
        loaded_session = session_res.scalars().first() or active_session

        # 3. Check existing attendance record (atomic duplicate prevention)
        existing_res = await db.execute(
            select(AttendanceRecord).where(
                and_(
                    AttendanceRecord.session_id == loaded_session.id,
                    AttendanceRecord.student_id == student.id,
                )
            )
        )
        existing = existing_res.scalars().first()
        if existing is not None:
            logger.info(f"Student {student.roll_number} already recorded for session {loaded_session.id}. Suppressing duplicate.")
            return existing

        # 4. Determine PRESENT vs LATE status (normalize naive SQLite UTC datetimes safely)
        if crossing_dt.tzinfo is None:
            crossing_dt = crossing_dt.replace(tzinfo=timezone.utc)
        sess_start_utc = (
            loaded_session.start_time
            if loaded_session.start_time.tzinfo is not None
            else loaded_session.start_time.replace(tzinfo=timezone.utc)
        )
        late_cutoff = sess_start_utc + timedelta(minutes=loaded_session.late_grace_minutes)

        if crossing_dt <= late_cutoff:
            status = "PRESENT"
        else:
            status = "LATE"

        # 5. Create record. The select-then-insert duplicate check above
        # races when two candidate events for the same student arrive at
        # once (group arrival): both pass the check and one hits the
        # uq_session_student_attendance constraint. That used to raise an
        # unhandled IntegrityError in the background task; now it is
        # treated as already-recorded.
        record = AttendanceRecord(
            session_id=loaded_session.id,
            student_id=student.id,
            timestamp=crossing_dt,
            status=status,
            confidence_score=event.confidence,
            verification_method="AUTO_FACE",
            notes=f"Auto verified by YuNet+SFace on Gate Track #{event.track_id}",
        )
        db.add(record)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            logger.info(f"Duplicate attendance insert for {student.roll_number} in session {loaded_session.id} — returning the existing record.")
            existing_res = await db.execute(
                select(AttendanceRecord).where(
                    and_(
                        AttendanceRecord.session_id == loaded_session.id,
                        AttendanceRecord.student_id == student.id,
                    )
                )
            )
            return existing_res.scalars().first()
        await db.refresh(record)

        subject_title = loaded_session.subject_title or (loaded_session.subject.name if loaded_session.subject else "Computer Lab")
        class_label = loaded_session.class_group.name if loaded_session.class_group else (student.class_group.name if student.class_group else "Section")

        logger.info(
            f"RECORDED ATTENDANCE: {student.full_name} ({student.roll_number}) "
            f"marked {status} for {subject_title} ({class_label}) [conf: {event.confidence:.3f}]"
        )

        # 6. Broadcast event to live WebSocket clients
        await ws_manager.broadcast_json({
            "type": "ATTENDANCE_RECORDED",
            "record_id": record.id,
            "student_id": student.id,
            "student_name": student.full_name,
            "roll_number": student.roll_number,
            "class_name": class_label,
            "subject_name": subject_title,
            "session_id": loaded_session.id,
            "status": status,
            "confidence": event.confidence,
            "timestamp": record.timestamp.isoformat(),
        })

        return record

    @staticmethod
    async def record_manual_override(
        db: AsyncSession,
        session_id: str,
        student_id: str,
        status: str,
        teacher_id: str,
        notes: Optional[str] = None,
    ) -> AttendanceRecord:
        """Allows a teacher to manually record or override an attendance status.
        Validates everything the old version did not: the session and the
        student must exist, and the status must be a known enum value —
        previously any string (and any fake student id) returned 200."""
        if status not in AttendanceService.VALID_MANUAL_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{status}'. Use one of: {', '.join(sorted(AttendanceService.VALID_MANUAL_STATUSES))}.",
            )
        session = (await db.execute(select(LabSession).where(LabSession.id == session_id))).scalars().first()
        if not session:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' does not exist.")
        student = (await db.execute(select(Student).where(Student.id == student_id))).scalars().first()
        if not student:
            raise HTTPException(status_code=404, detail=f"Student '{student_id}' does not exist.")
        existing_res = await db.execute(
            select(AttendanceRecord).where(
                and_(
                    AttendanceRecord.session_id == session_id,
                    AttendanceRecord.student_id == student_id,
                )
            )
        )
        record = existing_res.scalars().first()
        now = datetime.now(timezone.utc)

        if record is not None:
            old_status = record.status
            record.status = status
            record.verification_method = "MANUAL_OVERRIDE"
            record.verified_by_user_id = teacher_id
            record.notes = notes or f"Manual override by teacher: {old_status} -> {status}"
        else:
            record = AttendanceRecord(
                session_id=session_id,
                student_id=student_id,
                timestamp=now,
                status=status,
                confidence_score=1.0,
                verification_method="MANUAL_OVERRIDE",
                verified_by_user_id=teacher_id,
                notes=notes or "Manually entered by teacher",
            )
            db.add(record)

        # Audit log entry
        audit = AuditLog(
            user_id=teacher_id,
            action="MANUAL_ATTENDANCE_OVERRIDE",
            entity_type="attendance_records",
            entity_id=record.id,
            details_json=f'{{"session_id": "{session_id}", "student_id": "{student_id}", "status": "{status}"}}',
        )
        db.add(audit)
        await db.commit()
        await db.refresh(record)

        return record

