"""
Student Management Endpoints.
"""

from typing import List, Optional
import io
import csv
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.app.core.database import get_db
from backend.app.models.entities import Student, Department, ClassGroup, FaceTemplate, AuditLog, User
from backend.app.schemas.domain import StudentCreate, StudentUpdate, StudentOut
from backend.app.api.v1.deps import require_teacher_or_admin, require_admin

router = APIRouter(prefix="/students", tags=["Students"])


@router.get("", response_model=List[StudentOut])
async def list_students(
    department_id: Optional[str] = Query(None),
    class_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Lists students with optional department, class, and name filtering."""
    query = select(Student).options(selectinload(Student.face_templates))

    if department_id:
        query = query.where(Student.department_id == department_id)
    if class_id:
        query = query.where(Student.class_id == class_id)
    if status:
        query = query.where(Student.status == status)
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
    admin: User = Depends(require_admin),
):
    """Enrolls a new student profile."""
    # Check roll number uniqueness
    existing_res = await db.execute(
        select(Student).where(
            (Student.roll_number == student_in.roll_number) | (Student.email == student_in.email)
        )
    )
    if existing_res.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student with this Roll Number or Email already exists.",
        )

    student = Student(
        roll_number=student_in.roll_number,
        full_name=student_in.full_name,
        email=student_in.email,
        department_id=student_in.department_id,
        class_id=student_in.class_id,
        status="ACTIVE",
    )
    db.add(student)
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
    admin: User = Depends(require_admin),
):
    """Updates student information."""
    res = await db.execute(
        select(Student)
        .options(selectinload(Student.face_templates))
        .where(Student.id == student_id)
    )
    s = res.scalars().first()
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found.")

    if update_data.full_name is not None:
        s.full_name = update_data.full_name
    if update_data.email is not None:
        s.email = update_data.email
    if update_data.department_id is not None:
        s.department_id = update_data.department_id
    if update_data.class_id is not None:
        s.class_id = update_data.class_id
    if update_data.status is not None:
        s.status = update_data.status

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


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_student(
    student_id: str,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Soft deletes or deactivates student record."""
    res = await db.execute(select(Student).where(Student.id == student_id))
    s = res.scalars().first()
    if not s:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found.")

    s.status = "INACTIVE"
    await db.commit()
    return None
