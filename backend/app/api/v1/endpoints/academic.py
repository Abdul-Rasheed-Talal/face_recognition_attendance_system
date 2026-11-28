"""
Academic Year Rollover (Class Promotion) & Bulk CIT Student JSON Import Endpoints.
Handles:
- Annual promotion: CIT 3rd Year -> GRADUATED (pass out & removed from active matcher),
  CIT 2nd Year -> CIT 3rd Year, CIT 1st Year -> CIT 2nd Year
- Optional weekly timetable reset for the new academic year
- Importing registered CIT students from JSON file upload or the 'Registered CIT Students' folder,
  and splitting combined students.json into per-class files (cit_1st_year.json, cit_2nd_year.json, cit_3rd_year.json)
"""

import json
import os
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, update, delete, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.database import get_db
from backend.app.models.entities import (
    Department,
    ClassGroup,
    Student,
    FaceTemplate,
    TimetableSlot,
    AuditLog,
    User,
)
from backend.app.api.v1.deps import require_teacher_or_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/academic", tags=["CIT Academic Year & Student Import"])

REGISTERED_STUDENTS_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", "Registered CIT Students")
)


class RolloverRequest(BaseModel):
    academic_year_label: str = "New Academic Year"
    clear_weekly_timetable: bool = False


class ClassCountSummary(BaseModel):
    class_id: str
    class_name: str
    active_students: int
    face_enrolled: int


class AcademicSummaryOut(BaseModel):
    classes: List[ClassCountSummary]
    total_active_students: int
    total_face_enrolled: int
    total_graduated: int
    weekly_timetable_slots: int
    folder_json_files: List[str]


def _normalize_class_key(raw: str) -> Optional[str]:
    """Maps flexible class labels ('1', '1st', 'CIT 1st Year', 'First Year', etc.) to canonical CIT class names."""
    if not raw:
        return None
    s = str(raw).strip().lower()
    if any(k in s for k in ["1st", "first", "year 1", "cit-1", "cit 1", "cit1"]) or s == "1":
        return "CIT 1st Year"
    if any(k in s for k in ["2nd", "second", "year 2", "cit-2", "cit 2", "cit2"]) or s == "2":
        return "CIT 2nd Year"
    if any(k in s for k in ["3rd", "third", "year 3", "cit-3", "cit 3", "cit3"]) or s == "3":
        return "CIT 3rd Year"
    return None


def _extract_student_records(data: Any, default_class: Optional[str] = None) -> List[Dict[str, str]]:
    """
    Flexibly parses student JSON in any of these formats:
    1. List of objects: [{"name": "...", "roll_no": "...", "class": "CIT 1st Year"}, ...]
    2. Dict keyed by class name: {"CIT 1st Year": [{"name": "...", "roll_no": "..."}], ...}
    3. Dict with "students" key: {"students": [...]}
    """
    records: List[Dict[str, str]] = []

    def _parse_item(item: Dict[str, Any], cls_hint: Optional[str]) -> Optional[Dict[str, str]]:
        if not isinstance(item, dict):
            return None
        name = (
            item.get("full_name")
            or item.get("name")
            or item.get("student_name")
            or item.get("Name")
            or item.get("Full Name")
            or ""
        )
        roll = (
            item.get("roll_number")
            or item.get("roll_no")
            or item.get("rollNo")
            or item.get("roll")
            or item.get("Roll No")
            or item.get("Roll Number")
            or item.get("id")
            or ""
        )
        cls_raw = (
            item.get("class")
            or item.get("class_name")
            or item.get("year")
            or item.get("Class")
            or cls_hint
            or default_class
            or ""
        )
        name_str = str(name).strip()
        roll_str = str(roll).strip()
        if not name_str or not roll_str:
            return None
        canonical_cls = _normalize_class_key(cls_raw) or default_class or "CIT 1st Year"
        return {
            "full_name": name_str,
            "roll_number": roll_str,
            "class_name": canonical_cls,
        }

    if isinstance(data, list):
        for item in data:
            parsed = _parse_item(item, default_class)
            if parsed:
                records.append(parsed)
    elif isinstance(data, dict):
        if "students" in data and isinstance(data["students"], list):
            for item in data["students"]:
                parsed = _parse_item(item, default_class)
                if parsed:
                    records.append(parsed)
        else:
            for k, v in data.items():
                if isinstance(v, list):
                    cls_hint = _normalize_class_key(k) or default_class
                    for item in v:
                        parsed = _parse_item(item, cls_hint)
                        if parsed:
                            records.append(parsed)

    return records


async def _get_cit_dept_and_classes(db: AsyncSession):
    dept = (await db.execute(select(Department).where(Department.code == "CIT"))).scalars().first()
    if not dept:
        dept = (await db.execute(select(Department).limit(1))).scalars().first()

    classes_res = await db.execute(
        select(ClassGroup).where(ClassGroup.department_id == dept.id).order_by(ClassGroup.name.asc())
    )
    classes = classes_res.scalars().all()
    by_name = {c.name: c for c in classes}
    return dept, classes, by_name


@router.get("/summary", response_model=AcademicSummaryOut)
async def get_academic_summary(db: AsyncSession = Depends(get_db)):
    """Returns student counts per CIT class, graduated count, and available JSON files in Registered CIT Students folder."""
    _, classes, _ = await _get_cit_dept_and_classes(db)

    class_summaries: List[ClassCountSummary] = []
    total_active = 0
    total_enrolled = 0

    for c in classes:
        active_cnt = (
            await db.execute(
                select(func.count(Student.id)).where(
                    and_(Student.class_id == c.id, Student.status == "ACTIVE")
                )
            )
        ).scalar() or 0

        enrolled_cnt = (
            await db.execute(
                select(func.count(func.distinct(FaceTemplate.student_id)))
                .join(Student, Student.id == FaceTemplate.student_id)
                .where(
                    and_(
                        Student.class_id == c.id,
                        Student.status == "ACTIVE",
                        FaceTemplate.is_active == True,
                    )
                )
            )
        ).scalar() or 0

        class_summaries.append(
            ClassCountSummary(
                class_id=c.id,
                class_name=c.name,
                active_students=active_cnt,
                face_enrolled=enrolled_cnt,
            )
        )
        total_active += active_cnt
        total_enrolled += enrolled_cnt

    grad_cnt = (
        await db.execute(select(func.count(Student.id)).where(Student.status == "GRADUATED"))
    ).scalar() or 0

    slot_cnt = (
        await db.execute(select(func.count(TimetableSlot.id)).where(TimetableSlot.is_active == True))
    ).scalar() or 0

    folder_files: List[str] = []
    if os.path.isdir(REGISTERED_STUDENTS_DIR):
        folder_files = sorted(
            f for f in os.listdir(REGISTERED_STUDENTS_DIR) if f.lower().endswith(".json")
        )

    return AcademicSummaryOut(
        classes=class_summaries,
        total_active_students=total_active,
        total_face_enrolled=total_enrolled,
        total_graduated=grad_cnt,
        weekly_timetable_slots=slot_cnt,
        folder_json_files=folder_files,
    )


@router.post("/rollover")
async def perform_academic_year_rollover(
    payload: RolloverRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_teacher_or_admin),
):
    """
    Executes the annual CIT academic year promotion atomically:
    1. CIT 3rd Year -> GRADUATED (pass out; face templates deactivated & removed from live camera gallery)
    2. CIT 2nd Year -> Promoted to CIT 3rd Year (retains face templates)
    3. CIT 1st Year -> Promoted to CIT 2nd Year (retains face templates)
    4. CIT 1st Year is now empty and ready for new batch enrollment.
    5. Optionally clears the weekly timetable for the new year.
    """
    _, _, by_name = await _get_cit_dept_and_classes(db)
    c1 = by_name.get("CIT 1st Year")
    c2 = by_name.get("CIT 2nd Year")
    c3 = by_name.get("CIT 3rd Year")
    if not (c1 and c2 and c3):
        raise HTTPException(
            status_code=500,
            detail="CIT 1st Year, CIT 2nd Year, and CIT 3rd Year classes must exist before rollover.",
        )

    # 1. Graduate active 3rd Year students
    grad_students = (
        await db.execute(
            select(Student).where(and_(Student.class_id == c3.id, Student.status == "ACTIVE"))
        )
    ).scalars().all()
    grad_ids = [s.id for s in grad_students]

    if grad_ids:
        await db.execute(
            update(Student).where(Student.id.in_(grad_ids)).values(status="GRADUATED")
        )
        await db.execute(
            update(FaceTemplate).where(FaceTemplate.student_id.in_(grad_ids)).values(is_active=False)
        )
        matcher = getattr(request.app.state, "matcher", None)
        if matcher:
            for sid in grad_ids:
                matcher.remove_student(sid)

    # 2. Promote active 2nd Year -> 3rd Year
    sec_students = (
        await db.execute(
            select(Student).where(and_(Student.class_id == c2.id, Student.status == "ACTIVE"))
        )
    ).scalars().all()
    sec_ids = [s.id for s in sec_students]
    if sec_ids:
        await db.execute(
            update(Student).where(Student.id.in_(sec_ids)).values(class_id=c3.id)
        )

    # 3. Promote active 1st Year -> 2nd Year
    first_students = (
        await db.execute(
            select(Student).where(and_(Student.class_id == c1.id, Student.status == "ACTIVE"))
        )
    ).scalars().all()
    first_ids = [s.id for s in first_students]
    if first_ids:
        await db.execute(
            update(Student).where(Student.id.in_(first_ids)).values(class_id=c2.id)
        )

    # 4. Optionally reset weekly timetable
    cleared_slots = 0
    if payload.clear_weekly_timetable:
        res_del = await db.execute(delete(TimetableSlot))
        cleared_slots = res_del.rowcount or 0

    # 5. Audit log
    db.add(
        AuditLog(
            user_id=user.id,
            action="ACADEMIC_YEAR_ROLLOVER",
            entity_type="classes",
            details_json=json.dumps({
                "label": payload.academic_year_label,
                "graduated_3rd_year": len(grad_ids),
                "promoted_2nd_to_3rd": len(sec_ids),
                "promoted_1st_to_2nd": len(first_ids),
                "cleared_timetable_slots": cleared_slots,
            }),
        )
    )
    await db.commit()

    return {
        "success": True,
        "message": (
            f"Academic Year Rollover complete: {len(grad_ids)} passed out (Graduated), "
            f"{len(sec_ids)} promoted to CIT 3rd Year, {len(first_ids)} promoted to CIT 2nd Year. "
            f"CIT 1st Year is ready for new enrollment."
        ),
        "graduated_count": len(grad_ids),
        "promoted_to_3rd_count": len(sec_ids),
        "promoted_to_2nd_count": len(first_ids),
        "cleared_timetable_slots": cleared_slots,
    }


async def _import_records_into_db(
    db: AsyncSession, records: List[Dict[str, str]]
) -> Dict[str, Any]:
    dept, _, by_name = await _get_cit_dept_and_classes(db)
    if not dept:
        raise HTTPException(status_code=500, detail="CIT Department not configured.")

    existing_rolls_res = await db.execute(select(Student.roll_number))
    existing_rolls = {r.strip().lower() for r in existing_rolls_res.scalars().all()}

    imported = 0
    skipped = 0
    per_class_counts: Dict[str, int] = {"CIT 1st Year": 0, "CIT 2nd Year": 0, "CIT 3rd Year": 0}

    for rec in records:
        roll = rec["roll_number"].strip()
        name = rec["full_name"].strip()
        cls_name = rec["class_name"]
        cls_obj = by_name.get(cls_name)
        if not cls_obj:
            skipped += 1
            continue
        if roll.lower() in existing_rolls:
            skipped += 1
            continue

        db.add(
            Student(
                roll_number=roll,
                full_name=name,
                email=None,
                department_id=dept.id,
                class_id=cls_obj.id,
                status="ACTIVE",
            )
        )
        existing_rolls.add(roll.lower())
        imported += 1
        per_class_counts[cls_name] = per_class_counts.get(cls_name, 0) + 1

    await db.commit()
    return {
        "success": True,
        "imported": imported,
        "skipped_duplicates": skipped,
        "per_class": per_class_counts,
    }


@router.post("/import-from-folder")
async def import_from_registered_folder(
    split_files: bool = Query(True, description="Split combined students.json into per-class JSON files"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """
    Imports CIT students from JSON files in the 'Registered CIT Students' folder.
    If students.json exists and split_files=True, splits it into cit_1st_year.json,
    cit_2nd_year.json, and cit_3rd_year.json automatically.
    """
    if not os.path.isdir(REGISTERED_STUDENTS_DIR):
        raise HTTPException(status_code=404, detail="Folder 'Registered CIT Students' not found.")

    json_files = sorted(f for f in os.listdir(REGISTERED_STUDENTS_DIR) if f.lower().endswith(".json"))
    if not json_files:
        raise HTTPException(
            status_code=404,
            detail="No JSON files found in 'Registered CIT Students' folder. Please place students.json there.",
        )

    all_records: List[Dict[str, str]] = []
    for fname in json_files:
        fpath = os.path.join(REGISTERED_STUDENTS_DIR, fname)
        default_cls = _normalize_class_key(fname)
        try:
            with open(fpath, "r", encoding="utf-8") as fp:
                raw = json.load(fp)
            all_records.extend(_extract_student_records(raw, default_class=default_cls))
        except Exception as e:
            logger.error(f"Failed parsing {fname}: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to parse {fname}: {str(e)}")

    # Optionally split combined students.json into separate per-class JSON files
    split_created: List[str] = []
    if split_files and "students.json" in [f.lower() for f in json_files] and all_records:
        grouped: Dict[str, List[Dict[str, str]]] = {
            "cit_1st_year.json": [],
            "cit_2nd_year.json": [],
            "cit_3rd_year.json": [],
        }
        map_file = {
            "CIT 1st Year": "cit_1st_year.json",
            "CIT 2nd Year": "cit_2nd_year.json",
            "CIT 3rd Year": "cit_3rd_year.json",
        }
        seen = set()
        for r in all_records:
            key = r["roll_number"].lower()
            if key in seen:
                continue
            seen.add(key)
            target_f = map_file.get(r["class_name"])
            if target_f:
                grouped[target_f].append({"roll_number": r["roll_number"], "full_name": r["full_name"]})

        for fname, items in grouped.items():
            if items:
                out_path = os.path.join(REGISTERED_STUDENTS_DIR, fname)
                with open(out_path, "w", encoding="utf-8") as fp:
                    json.dump(items, fp, indent=2, ensure_ascii=False)
                split_created.append(fname)

    result = await _import_records_into_db(db, all_records)
    result["files_processed"] = json_files
    result["split_files_created"] = split_created
    return result


@router.post("/import-json")
async def import_uploaded_json(
    file: UploadFile = File(...),
    default_class_name: Optional[str] = Query(None, description="Fallback class if JSON items omit class field"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_teacher_or_admin),
):
    """Imports CIT students from an uploaded JSON file."""
    content = await file.read()
    try:
        raw = json.loads(content.decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON file: {str(e)}")

    default_cls = _normalize_class_key(default_class_name or file.filename or "")
    records = _extract_student_records(raw, default_class=default_cls)
    if not records:
        raise HTTPException(
            status_code=400,
            detail="No valid student records found in JSON. Expected objects with 'name' and 'roll_no' (or 'full_name' and 'roll_number').",
        )
    return await _import_records_into_db(db, records)
