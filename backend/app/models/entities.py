"""
SQLAlchemy Relational Database Models for the Laboratory Attendance System.
Enforces relational integrity, foreign key cascades, and unique composite constraints.
"""

import uuid
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    Text,
    LargeBinary,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship

from backend.app.core.database import Base


def generate_uuid() -> str:
    return str(uuid.uuid4())


def get_utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Department(Base):
    __tablename__ = "departments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    code = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), default=get_utc_now)

    classes = relationship("ClassGroup", back_populates="department", cascade="all, delete-orphan")
    subjects = relationship("Subject", back_populates="department", cascade="all, delete-orphan")
    students = relationship("Student", back_populates="department")


class ClassGroup(Base):
    __tablename__ = "classes"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    department_id = Column(String(36), ForeignKey("departments.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(50), nullable=False)  # e.g. "BS CS 2023"
    year = Column(String(20), nullable=False)  # e.g. "3rd Year"
    semester = Column(String(20), nullable=False)  # e.g. "6th Semester"
    section = Column(String(10), nullable=False)  # e.g. "A"

    department = relationship("Department", back_populates="classes")
    students = relationship("Student", back_populates="class_group")
    sessions = relationship("LabSession", back_populates="class_group")


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    department_id = Column(String(36), ForeignKey("departments.id", ondelete="CASCADE"), nullable=False)
    code = Column(String(20), nullable=False, index=True)
    name = Column(String(100), nullable=False)

    department = relationship("Department", back_populates="subjects")
    sessions = relationship("LabSession", back_populates="subject")


class Laboratory(Base):
    __tablename__ = "laboratories"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(100), nullable=False)
    room_number = Column(String(30), unique=True, nullable=False)
    building = Column(String(50), nullable=False)
    capacity = Column(Integer, default=40)

    cameras = relationship("CameraDevice", back_populates="laboratory")
    sessions = relationship("LabSession", back_populates="laboratory")


class CameraDevice(Base):
    __tablename__ = "camera_devices"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    laboratory_id = Column(String(36), ForeignKey("laboratories.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    rtsp_url = Column(String(255), nullable=False)
    ip_address = Column(String(50), nullable=True)
    port = Column(Integer, default=554)
    status = Column(String(20), default="OFFLINE")  # CONNECTED, RECONNECTING, OFFLINE
    last_seen = Column(DateTime(timezone=True), nullable=True)
    entry_zone_config_json = Column(Text, nullable=True)

    laboratory = relationship("Laboratory", back_populates="cameras")


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(120), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)
    role = Column(String(20), default="TEACHER")  # ADMIN, TEACHER, OPERATOR
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=get_utc_now)

    sessions = relationship("LabSession", back_populates="teacher")


class Student(Base):
    __tablename__ = "students"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    roll_number = Column(String(30), unique=True, nullable=False, index=True)
    full_name = Column(String(100), nullable=False)
    email = Column(String(120), unique=True, nullable=False, index=True)
    department_id = Column(String(36), ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False)
    class_id = Column(String(36), ForeignKey("classes.id", ondelete="RESTRICT"), nullable=False)
    status = Column(String(20), default="ACTIVE")  # ACTIVE, INACTIVE, GRADUATED
    created_at = Column(DateTime(timezone=True), default=get_utc_now)

    department = relationship("Department", back_populates="students")
    class_group = relationship("ClassGroup", back_populates="students")
    face_templates = relationship("FaceTemplate", back_populates="student", cascade="all, delete-orphan")
    attendance_records = relationship("AttendanceRecord", back_populates="student")
    correction_requests = relationship("AttendanceCorrectionRequest", back_populates="student")


class FaceTemplate(Base):
    __tablename__ = "face_templates"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    student_id = Column(String(36), ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    embedding_bytes = Column(LargeBinary, nullable=False)  # 128 floats * 4 bytes = 512 bytes
    model_name = Column(String(50), default="sface_2021dec")
    quality_score = Column(Float, default=1.0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=get_utc_now)

    student = relationship("Student", back_populates="face_templates")


class LabSession(Base):
    __tablename__ = "lab_sessions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    subject_id = Column(String(36), ForeignKey("subjects.id", ondelete="RESTRICT"), nullable=False)
    laboratory_id = Column(String(36), ForeignKey("laboratories.id", ondelete="RESTRICT"), nullable=False)
    teacher_id = Column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    class_id = Column(String(36), ForeignKey("classes.id", ondelete="RESTRICT"), nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=False)
    late_grace_minutes = Column(Integer, default=15)
    status = Column(String(20), default="SCHEDULED")  # SCHEDULED, ACTIVE, COMPLETED, CANCELLED

    subject = relationship("Subject", back_populates="sessions")
    laboratory = relationship("Laboratory", back_populates="sessions")
    teacher = relationship("User", back_populates="sessions")
    class_group = relationship("ClassGroup", back_populates="sessions")
    attendance_records = relationship("AttendanceRecord", back_populates="session", cascade="all, delete-orphan")


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(36), ForeignKey("lab_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id = Column(String(36), ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), default=get_utc_now, nullable=False)
    status = Column(String(20), nullable=False)  # PRESENT, LATE, ABSENT, EXCUSED, MANUAL_CORRECTION
    confidence_score = Column(Float, nullable=True)
    verification_method = Column(String(30), default="AUTO_FACE")  # AUTO_FACE, MANUAL_OVERRIDE, TEACHER_APP
    verified_by_user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notes = Column(Text, nullable=True)

    # Database-level unique constraint preventing duplicate attendance records
    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="uq_session_student_attendance"),
        Index("idx_attendance_session_status", "session_id", "status"),
    )

    session = relationship("LabSession", back_populates="attendance_records")
    student = relationship("Student", back_populates="attendance_records")
    verified_by = relationship("User")


class AttendanceCorrectionRequest(Base):
    __tablename__ = "attendance_correction_requests"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    student_id = Column(String(36), ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    session_id = Column(String(36), ForeignKey("lab_sessions.id", ondelete="CASCADE"), nullable=False)
    attendance_record_id = Column(String(36), ForeignKey("attendance_records.id", ondelete="SET NULL"), nullable=True)
    reason = Column(Text, nullable=False)
    status = Column(String(20), default="PENDING")  # PENDING, APPROVED, REJECTED
    reviewed_by_user_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=get_utc_now)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    student = relationship("Student", back_populates="correction_requests")
    session = relationship("LabSession")
    reviewed_by = relationship("User")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), nullable=True, index=True)
    action = Column(String(50), nullable=False)  # CREATE, UPDATE, DELETE, MANUAL_OVERRIDE, EXPORT
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(String(36), nullable=True)
    details_json = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    timestamp = Column(DateTime(timezone=True), default=get_utc_now)

