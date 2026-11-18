"""
Attendance Business Logic & Session Validation Engine.
Evaluates student eligibility, session timeframes, late grace thresholds, and duplicate prevention.
"""

from datetime import datetime, timezone, timedelta
import logging
from typing import Optional, List, Dict, Any
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

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

    @staticmethod
    async def get_active_session_for_student(
        db: AsyncSession, student: Student, current_time: Optional[datetime] = None
    ) -> Optional[LabSession]:
        """
        Intelligently resolves the active timetable session for a specific student.
        Matches scheduled sessions for the student's class section within the allowable entry window
        (allows entering up to 45 mins before class start, up to class end time).
        """
        now = current_time or datetime.now(timezone.utc)

        # 1. Look for a scheduled/active session specifically for the student's class
        query = (
            select(LabSession)
            .where(
                and_(
                    LabSession.class_id == student.class_id,
                    LabSession.status.in_(["ACTIVE", "SCHEDULED"]),
                    LabSession.start_time - timedelta(minutes=45) <= now,
                    LabSession.end_time >= now - timedelta(minutes=10),
                )
            )
            .order_by(LabSession.start_time.asc())
        )
        res = await db.execute(query)
        session = res.scalars().first()
        if session:
            return session

        # 2. Fallback: check if an explicitly active session is open for this student's class
        query_fallback = (
            select(LabSession)
            .where(
                and_(
                    LabSession.class_id == student.class_id,
                    LabSession.status == "ACTIVE",
                )
            )
        )
        res_fb = await db.execute(query_fallback)
        session = res_fb.scalars().first()
        if session:
            return session

        # 3. Fallback: check if any generic session is currently marked ACTIVE
        query_any_active = (
            select(LabSession)
            .where(LabSession.status == "ACTIVE")
            .order_by(LabSession.start_time.desc())
        )
        res_any = await db.execute(query_any_active)
        return res_any.scalars().first()

    @staticmethod
    async def get_active_session_for_lab(
        db: AsyncSession, laboratory_id: Optional[str] = None
    ) -> Optional[LabSession]:
        """
        Finds currently active session across the timetable for dashboard display.
        Matches by status='ACTIVE' or current UTC time within (start_time, end_time).
        """
        now = datetime.now(timezone.utc)
        query = select(LabSession).where(
            and_(
                LabSession.status.in_(["ACTIVE", "SCHEDULED"]),
                LabSession.start_time - timedelta(minutes=15) <= now,
                LabSession.end_time >= now,
            )
        ).order_by(LabSession.start_time.asc())
        if laboratory_id:
            query = query.where(LabSession.laboratory_id == laboratory_id)

        result = await db.execute(query)
        session = result.scalars().first()

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

        # 4. Determine PRESENT vs LATE status
        late_cutoff = loaded_session.start_time + timedelta(minutes=loaded_session.late_grace_minutes)

        if crossing_dt <= late_cutoff:
            status = "PRESENT"
        else:
            status = "LATE"

        # 5. Create record
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
        await db.commit()
        await db.refresh(record)

        subject_title = loaded_session.subject.name if loaded_session.subject else "Class Period"
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
        """Allows a teacher to manually record or override an attendance status."""
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

