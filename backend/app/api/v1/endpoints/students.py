"""
Student Management Endpoints.
Supports student directory listing, department & class lookups, and student registration.
"""

from typing import List, Optional
import io
import csv
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, Query, Request
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.database import get_db
from backend.app.models.entities import (
    Student,
    Department,
    ClassGroup,
    FaceTemplate,
    AttendanceRecord,
    AttendanceCorrectionRequest,
    AuditLog,
    User,
)
from backend.app.schemas.domain import (
    StudentCreate,
    StudentUpdate,
    StudentOut,
    DepartmentOut,
    ClassOut,
)
from backend.app.api.v1.deps import (
    require_teacher_or_admin,
    require_admin,
    get_current_user_optional,
)

router = APIRouter(prefix="/students", tags=["Students"])


@router.get("/departments", response_model=List[DepartmentOut])
async def list_departments(db: AsyncSession = Depends(get_db)):
    """Lists all academic departments."""
    res = await db.execute(select(Department).order_by(Department.name))
    return res.scalars().all()


@router.get("/classes", response_model=List[ClassOut])
async def list_classes(
    department_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Lists class sections, optionally filtered by department."""
    query = select(ClassGroup).order_by(ClassGroup.name)
    if department_id:
        query = query.where(ClassGroup.department_id == department_id)
    res = await db.execute(query)
    return res.scalars().all()


@router.get("", response_model=List[StudentOut])
async def list_students(
    department_id: Optional[str] = Query(None),
    class_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """
    Lists students with optional department, class, and name filtering.
    Allows authenticated teachers/admins for full roster or student portal search.
    """
    query = select(Student).options(selectinload(Student.face_templates))

    if department_id:
        query = query.where(Student.department_id == department_id)
    if class_id:
        query = query.where(Student.class_id == class_id)
    if status_filter:
        query = query.where(Student.status == status_filter)
    if search:
        search_filter = f"%{search}%"
        query = query.where(
            (Student.full_name.ilike(search_filter)) | (Student.roll_number.ilike(search_filter))
        )

    res = await db.execute(query.order_by(Student.roll_number))
    students = res.scalars().all()

    output = []
    for s in students:
        has_face = any(t.is_active for t in s.face_templates)
        output.append(
            StudentOut(
                id=s.id,
                roll_number=s.roll_number,
                full_name=s.full_name,
                email=s.email,
                department_id=s.department_id,
                class_id=s.class_id,
                status=s.status,
                is_face_enrolled=has_face,
                created_at=s.created_at,
            )
        )
    return output


@router.post("", response_model=StudentOut, status_code=status.HTTP_201_CREATED)
async def create_student(
    student_in: StudentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_teacher_or_admin),
):
    """
    Enrolls a new student profile.
    Accessible to authorized Teachers and Administrators.
    Automatically resolves department and class foreign keys.
    """
    # Check roll number or email uniqueness
    existing_res = await db.execute(
        select(Student).where(
            (Student.roll_number == student_in.roll_number) | (Student.email == student_in.email)
        )
    )
    if existing_res.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Student with Roll Number '{student_in.roll_number}' or Email '{student_in.email}' already exists.",
        )

    # Resolve department foreign key
    dept_res = await db.execute(
        select(Department).where(
            (Department.id == student_in.department_id) | (Department.code == student_in.department_id)
        )
    )
    dept_obj = dept_res.scalars().first()
    if dept_obj:
        target_dept_id = dept_obj.id
    else:
        # Fallback to default department if available
        first_dept = (await db.execute(select(Department))).scalars().first()
        if not first_dept:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No academic departments found. Please configure a department first.",
            )
        target_dept_id = first_dept.id

    # Resolve class foreign key
    class_res = await db.execute(
        select(ClassGroup).where(
            (ClassGroup.id == student_in.class_id) | (ClassGroup.name == student_in.class_id)
        )
    )
    class_obj = class_res.scalars().first()
    if class_obj:
        target_class_id = class_obj.id
    else:
        # Fallback to default class if available
        first_class = (await db.execute(select(ClassGroup))).scalars().first()
        if not first_class:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No classes found. Please configure a class section first.",
            )
        target_class_id = first_class.id

    student = Student(
        roll_number=student_in.roll_number.strip(),
        full_name=student_in.full_name.strip(),
        email=student_in.email.strip(),
        department_id=target_dept_id,
        class_id=target_class_id,
        status="ACTIVE",
    )
    db.add(student)

    # Log audit entry
    audit = AuditLog(
        user_id=user.id,
        action="REGISTER_STUDENT",
        entity_type="students",
        entity_id=student.id,
        details_json=f'{{"roll_number": "{student.roll_number}", "full_name": "{student.full_name}"}}',
    )
    db.add(audit)

    await db.commit()
    await db.refresh(student)

    return StudentOut(
        id=student.id,
        roll_number=student.roll_number,
        full_name=student.full_name,
        email=student.email,
        department_id=student.department_id,
        class_id=student.class_id,
        status=student.status,
        is_face_enrolled=False,
        created_at=student.created_at,
    )


@router.get("/{student_id}", response_model=StudentOut)
async def get_student(
    student_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Retrieves student details."""
    res = await db.execute(
        select(Student)
        .options(selectinload(Student.face_templates))
        .where(Student.id == student_id)
    )
    s = res.scalars().first()
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found.")

    has_face = any(t.is_active for t in s.face_templates)
    return StudentOut(
        id=s.id,
        roll_number=s.roll_number,
        full_name=s.full_name,
        email=s.email,
        department_id=s.department_id,
        class_id=s.class_id,
        status=s.status,
        is_face_enrolled=has_face,
        created_at=s.created_at,
    )


@router.put("/{student_id}", response_model=StudentOut)
async def update_student(
    student_id: str,
    update_data: StudentUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_teacher_or_admin),
):
    """Updates student information (accessible to Teachers and Admins)."""
    res = await db.execute(
        select(Student)
        .options(selectinload(Student.face_templates))
        .where(Student.id == student_id)
    )
    s = res.scalars().first()
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found.")

    if update_data.full_name is not None:
        s.full_name = update_data.full_name.strip()
    if update_data.email is not None:
        s.email = update_data.email.strip()
    if update_data.department_id is not None:
        s.department_id = update_data.department_id
    if update_data.class_id is not None:
        s.class_id = update_data.class_id
    if update_data.status is not None:
        s.status = update_data.status

    # Audit log
    audit = AuditLog(
        user_id=user.id,
        action="UPDATE_STUDENT",
        entity_type="students",
        entity_id=s.id,
        details_json=f'{{"roll_number": "{s.roll_number}"}}',
    )
    db.add(audit)

    await db.commit()
    await db.refresh(s)

    has_face = any(t.is_active for t in s.face_templates)
    return StudentOut(
        id=s.id,
        roll_number=s.roll_number,
        full_name=s.full_name,
        email=s.email,
        department_id=s.department_id,
        class_id=s.class_id,
        status=s.status,
        is_face_enrolled=has_face,
        created_at=s.created_at,
    )


@router.delete("/{student_id}")
async def delete_student(
    student_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_teacher_or_admin),
):
    """
    Permanently deletes a student record.
    Removes biometric templates from database and in-memory matcher gallery,
    cleans up associated attendance records, and logs the action in audit trail.
    """
    res = await db.execute(select(Student).where(Student.id == student_id))
    s = res.scalars().first()
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found.")

    student_name = s.full_name
    student_roll = s.roll_number

    # 1. Remove from in-memory FaceMatcher gallery immediately
    matcher = getattr(request.app.state, "matcher", None)
    if matcher:
        matcher.remove_student(student_id)

    # 2. Delete related records in database
    await db.execute(delete(FaceTemplate).where(FaceTemplate.student_id == student_id))
    await db.execute(delete(AttendanceRecord).where(AttendanceRecord.student_id == student_id))
    await db.execute(delete(AttendanceCorrectionRequest).where(AttendanceCorrectionRequest.student_id == student_id))
    await db.delete(s)

    # 3. Audit trail log
    audit = AuditLog(
        user_id=user.id,
        action="DELETE_STUDENT",
        entity_type="students",
        entity_id=student_id,
        details_json=f'{{"roll_number": "{student_roll}", "full_name": "{student_name}"}}',
    )
    db.add(audit)

    await db.commit()
    return {"success": True, "message": f"Student '{student_name}' ({student_roll}) permanently deleted."}
