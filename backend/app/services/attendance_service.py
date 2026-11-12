"""
Attendance Business Logic & Session Validation Engine.
Evaluates student eligibility, session timeframes, late grace thresholds, and duplicate prevention.
"""

from datetime import datetime, timezone, timedelta
import logging
from typing import Optional, List, Dict, Any
from sqlalchemy import select, and_, func
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
    async def get_active_session_for_lab(
        db: AsyncSession, laboratory_id: Optional[str] = None
    ) -> Optional[LabSession]:
        """
        Finds currently active session.
        Matches by status='ACTIVE' or current UTC time within (start_time, end_time).
        """
        now = datetime.now(timezone.utc)
        query = select(LabSession).where(
            and_(
                LabSession.status.in_(["ACTIVE", "SCHEDULED"]),
                LabSession.start_time <= now,
                LabSession.end_time >= now,
            )
        )
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
        1. Identifies the active lab session.
        2. Validates student eligibility and enrollment in the class.
        3. Prevents duplicate attendance.
        4. Calculates 'PRESENT' vs 'LATE' based on session start time and grace minutes.
        5. Persists the record atomically and broadcasts via WebSocket.
        """
        active_session = await AttendanceService.get_active_session_for_lab(db, laboratory_id)
        if active_session is None:
            logger.info(f"Attendance candidate for student {event.student_id} received, but no active lab session found.")
            return None

        # Verify student exists and is active
        student_res = await db.execute(select(Student).where(Student.id == event.student_id))
        student = student_res.scalars().first()
        if student is None or student.status != "ACTIVE":
            logger.warning(f"Student {event.student_id} is inactive or not found.")
            return None

        # Check eligibility: verify student belongs to the class scheduled for this session
        if student.class_id != active_session.class_id:
            logger.warning(
                f"Student {student.full_name} ({student.roll_number}) belongs to class {student.class_id}, "
                f"not scheduled class {active_session.class_id} for this session."
            )
            # Depending on institutional rules, we could either reject or flag guest attendance
            return None

        # Check existing attendance record (atomic duplicate prevention)
        existing_res = await db.execute(
            select(AttendanceRecord).where(
                and_(
                    AttendanceRecord.session_id == active_session.id,
                    AttendanceRecord.student_id == student.id,
                )
            )
        )
        existing = existing_res.scalars().first()
        if existing is not None:
            logger.info(f"Student {student.roll_number} already recorded for session {active_session.id}.")
            return existing

        # Determine PRESENT vs LATE status
        crossing_dt = event.crossing_timestamp
        late_cutoff = active_session.start_time + timedelta(minutes=active_session.late_grace_minutes)

        if crossing_dt <= late_cutoff:
            status = "PRESENT"
        else:
            status = "LATE"

        # Create record
        record = AttendanceRecord(
            session_id=active_session.id,
            student_id=student.id,
            timestamp=crossing_dt,
            status=status,
            confidence_score=event.confidence,
            verification_method="AUTO_FACE",
            notes=f"Auto verified by YuNet+SFace on Track #{event.track_id}",
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)

        logger.info(
            f"RECORDED ATTENDANCE: {student.full_name} ({student.roll_number}) "
            f"marked {status} for Session {active_session.id} (conf: {event.confidence:.3f})"
        )

        # Broadcast event to live WebSocket clients
        await ws_manager.broadcast_json({
            "type": "ATTENDANCE_RECORDED",
            "record_id": record.id,
            "student_id": student.id,
            "student_name": student.full_name,
            "roll_number": student.roll_number,
            "session_id": active_session.id,
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
