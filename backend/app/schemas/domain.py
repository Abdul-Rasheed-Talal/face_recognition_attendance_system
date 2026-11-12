"""
Pydantic Schemas for API Requests, Responses, and DTOs.
Updated for Pydantic v2 with ConfigDict.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr, Field, ConfigDict


# ------------------------------------------------------------------------------
# Auth Schemas
# ------------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    full_name: str
    user_id: str


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str = "TEACHER"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


# ------------------------------------------------------------------------------
# Student & Enrollment Schemas
# ------------------------------------------------------------------------------

class StudentCreate(BaseModel):
    roll_number: str
    full_name: str
    email: EmailStr
    department_id: str
    class_id: str


class StudentUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    department_id: Optional[str] = None
    class_id: Optional[str] = None
    status: Optional[str] = None


class StudentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    roll_number: str
    full_name: str
    email: str
    department_id: str
    class_id: str
    status: str
    is_face_enrolled: bool = False
    created_at: datetime


class EnrollmentStatusOut(BaseModel):
    student_id: str
    roll_number: str
    full_name: str
    is_enrolled: bool
    template_count: int
    quality_score: Optional[float] = None
    enrolled_at: Optional[datetime] = None


# ------------------------------------------------------------------------------
# Department, Class & Session Schemas
# ------------------------------------------------------------------------------

class DepartmentCreate(BaseModel):
    code: str
    name: str


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: str


class ClassCreate(BaseModel):
    department_id: str
    name: str
    year: str
    semester: str
    section: str


class ClassOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    department_id: str
    name: str
    year: str
    semester: str
    section: str


class SubjectCreate(BaseModel):
    department_id: str
    code: str
    name: str


class SubjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    department_id: str
    code: str
    name: str


class LaboratoryCreate(BaseModel):
    name: str
    room_number: str
    building: str
    capacity: int = 40


class LaboratoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    room_number: str
    building: str
    capacity: int


class SessionCreate(BaseModel):
    subject_id: str
    laboratory_id: str
    class_id: str
    teacher_id: Optional[str] = None
    start_time: datetime
    end_time: datetime
    late_grace_minutes: int = 15


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    subject_name: str
    subject_code: str
    laboratory_name: str
    room_number: str
    teacher_name: str
    class_name: str
    start_time: datetime
    end_time: datetime
    late_grace_minutes: int
    status: str


# ------------------------------------------------------------------------------
# Attendance Schemas
# ------------------------------------------------------------------------------

class AttendanceRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    student_id: str
    student_name: str
    roll_number: str
    timestamp: datetime
    status: str  # PRESENT, LATE, ABSENT, EXCUSED, MANUAL_CORRECTION
    confidence_score: Optional[float] = None
    verification_method: str
    notes: Optional[str] = None


class ManualAttendanceCreate(BaseModel):
    session_id: str
    student_id: str
    status: str = "PRESENT"
    notes: Optional[str] = "Manual entry by teacher"


class AttendanceRecordUpdate(BaseModel):
    status: str
    notes: Optional[str] = None


class LiveAttendanceEventOut(BaseModel):
    type: str = "ATTENDANCE_RECORDED"
    record_id: str
    student_id: str
    student_name: str
    roll_number: str
    session_id: str
    status: str
    confidence: float
    timestamp: datetime


# ------------------------------------------------------------------------------
# Dashboard & Camera Schemas
# ------------------------------------------------------------------------------

class DashboardStatisticsOut(BaseModel):
    total_students: int
    present_today: int
    late_today: int
    absent_today: int
    overall_attendance_pct: float
    active_session: Optional[Dict[str, Any]] = None
    camera_health: Dict[str, Any]


class CorrectionRequestCreate(BaseModel):
    session_id: str
    reason: str


class CorrectionRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    student_id: str
    student_name: str
    roll_number: str
    session_id: str
    reason: str
    status: str
    created_at: datetime
    reviewed_at: Optional[datetime] = None
