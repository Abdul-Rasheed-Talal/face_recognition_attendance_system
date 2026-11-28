"""
Backend REST API Integration Tests.
Validates authentication, student management, session lookup, manual attendance,
duplicate prevention, and statistics reporting.
"""

import random
import uuid

import pytest
from httpx import AsyncClient, ASGITransport

from backend.main import app, seed_initial_fixtures
from backend.app.core.database import init_db


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _uniq(prefix: str) -> str:
    """Unique roll numbers / dates per run: the test DB is the real
    SQLite file, so a second run must not collide with the first."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


@pytest.mark.anyio
async def test_health_check():
    await init_db()
    await seed_initial_fixtures()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "HEALTHY"


@pytest.mark.anyio
async def test_auth_and_login_flow():
    await init_db()
    await seed_initial_fixtures()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Invalid login
        bad_login = await client.post("/api/v1/auth/login", json={
            "email": "admin@college.edu",
            "password": "WrongPassword!"
        })
        assert bad_login.status_code == 401

        # Valid login
        good_login = await client.post("/api/v1/auth/login", json={
            "email": "admin@college.edu",
            "password": "AdminPass123!"
        })
        assert good_login.status_code == 200
        token_data = good_login.json()
        assert "access_token" in token_data
        assert token_data["role"] == "ADMIN"
        token = token_data["access_token"]

        # Verify /auth/me with token
        headers = {"Authorization": f"Bearer {token}"}
        me_resp = await client.get("/api/v1/auth/me", headers=headers)
        assert me_resp.status_code == 200
        assert me_resp.json()["email"] == "admin@college.edu"


@pytest.mark.anyio
async def test_student_crud_and_attendance():
    await init_db()
    await seed_initial_fixtures()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Login as admin
        login = await client.post("/api/v1/auth/login", json={
            "email": "admin@college.edu",
            "password": "AdminPass123!"
        })
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Get the seeded session and the real DAE CIT department/class
        sess_resp = await client.get("/api/v1/sessions", headers=headers)
        assert sess_resp.status_code == 200
        sessions = sess_resp.json()
        assert len(sessions) > 0
        active_sess = sessions[0]
        session_id = active_sess["id"]

        depts = (await client.get("/api/v1/students/departments", headers=headers)).json()
        classes = (await client.get("/api/v1/students/classes", headers=headers)).json()
        assert len(depts) > 0 and len(classes) > 0
        # Pick the real DAE CIT class by name (a DB seeded before the
        # fix may still hold the old BS CS dummy alongside it).
        dae_classes = [c for c in classes if "CIT" in c["name"]]
        assert dae_classes, "Seed must contain CIT classes, not the old BS CS dummy"
        dept_id = depts[0]["id"]
        class_id = dae_classes[0]["id"]

        # 2b. Unknown department/class must 400, not silently fall back
        bad_dept = await client.post(
            "/api/v1/students", headers=headers,
            json={"roll_number": "BAD-01", "full_name": "Bad Dept", "email": "bad@college.edu",
                  "department_id": "no-such-dept", "class_id": class_id},
        )
        assert bad_dept.status_code == 400
        bad_class = await client.post(
            "/api/v1/students", headers=headers,
            json={"roll_number": "BAD-02", "full_name": "Bad Class", "email": "bad2@college.edu",
                  "department_id": dept_id, "class_id": "no-such-class"},
        )
        assert bad_class.status_code == 400

        # 2c. Create a real student to use for manual attendance
        stu_resp = await client.post(
            "/api/v1/students", headers=headers,
            json={"roll_number": _uniq("TEST-ATT"), "full_name": "Attendance Test Student",
                  "email": "att.test@college.edu", "department_id": dept_id, "class_id": class_id},
        )
        assert stu_resp.status_code == 201
        student_id = stu_resp.json()["id"]

        # 3. Check manual attendance creation (real student + session)
        man_att = await client.post(
            "/api/v1/attendance/manual",
            headers=headers,
            json={
                "session_id": session_id,
                "student_id": student_id,
                "status": "PRESENT",
                "notes": "Test manual verification",
            }
        )
        assert man_att.status_code == 200
        rec = man_att.json()
        assert rec["status"] == "PRESENT"
        assert rec["session_id"] == session_id

        # 3b. Invalid status and unknown session/student must be rejected
        bad_status = await client.post(
            "/api/v1/attendance/manual", headers=headers,
            json={"session_id": session_id, "student_id": student_id, "status": "WHATEVER"},
        )
        assert bad_status.status_code == 400
        bad_session = await client.post(
            "/api/v1/attendance/manual", headers=headers,
            json={"session_id": "no-such-session", "student_id": student_id, "status": "PRESENT"},
        )
        assert bad_session.status_code == 404
        bad_student = await client.post(
            "/api/v1/attendance/manual", headers=headers,
            json={"session_id": session_id, "student_id": "no-such-student", "status": "PRESENT"},
        )
        assert bad_student.status_code == 404

        # 4. Check duplicate override updates record rather than failing or duplicating
        man_att_override = await client.post(
            "/api/v1/attendance/manual",
            headers=headers,
            json={
                "session_id": session_id,
                "student_id": student_id,
                "status": "EXCUSED",
                "notes": "Changed to excused",
            }
        )
        assert man_att_override.status_code == 200
        rec_updated = man_att_override.json()
        assert rec_updated["status"] == "EXCUSED"
        assert rec_updated["id"] == rec["id"]  # Same record updated!

        # 5. Verify dashboard statistics endpoint
        stats_resp = await client.get("/api/v1/reports/statistics")
        assert stats_resp.status_code == 200
        stats = stats_resp.json()
        assert "overall_attendance_pct" in stats
        assert "camera_health" in stats

        # 6. Test student creation and permanent deletion
        new_stu_resp = await client.post(
            "/api/v1/students",
            headers=headers,
            json={
                "roll_number": _uniq("TEST-DEL"),
                "full_name": "Temporary Test Student",
                "email": "temp.test@college.edu",
                "department_id": dept_id,
                "class_id": class_id,
            }
        )
        assert new_stu_resp.status_code == 201
        temp_id = new_stu_resp.json()["id"]

        del_resp = await client.delete(f"/api/v1/students/{temp_id}", headers=headers)
        assert del_resp.status_code == 200
        assert del_resp.json()["success"] is True

        # Verify student is gone
        get_gone = await client.get(f"/api/v1/students/{temp_id}", headers=headers)
        assert get_gone.status_code == 404


@pytest.mark.anyio
async def test_session_creation_validation():
    """Session creation must reject bad FKs, end <= start, and overlaps."""
    await init_db()
    await seed_initial_fixtures()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login = await client.post("/api/v1/auth/login", json={
            "email": "admin@college.edu", "password": "AdminPass123!"
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        subjects = (await client.get("/api/v1/sessions/subjects", headers=headers)).json()
        labs = (await client.get("/api/v1/sessions/laboratories", headers=headers)).json()
        classes = (await client.get("/api/v1/students/classes", headers=headers)).json()
        assert subjects and labs and classes
        dae_classes = [c for c in classes if "CIT" in c["name"]]
        assert dae_classes
        day = f"2030-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}"
        base = {
            "subject_id": subjects[0]["id"],
            "laboratory_id": labs[0]["id"],
            "class_id": dae_classes[0]["id"],
            "start_time": f"{day}T09:00:00Z",
            "end_time": f"{day}T10:00:00Z",
            "late_grace_minutes": 15,
        }

        # Unknown laboratory (400: FK validation is a client error here,
        # same as the student endpoints)
        bad_lab = await client.post("/api/v1/sessions", headers=headers,
                                    json={**base, "laboratory_id": "no-such-lab"})
        assert bad_lab.status_code == 400

        # End before start
        bad_time = await client.post("/api/v1/sessions", headers=headers,
                                     json={**base, "end_time": f"{day}T08:00:00Z"})
        assert bad_time.status_code == 400

        # Valid session, then an overlapping one for the same class + lab
        ok = await client.post("/api/v1/sessions", headers=headers, json=base)
        assert ok.status_code == 201
        overlap = await client.post("/api/v1/sessions", headers=headers,
                                    json={**base, "start_time": f"{day}T09:30:00Z",
                                          "end_time": f"{day}T10:30:00Z"})
        assert overlap.status_code == 400


@pytest.mark.anyio
async def test_corrections_review_flow():
    """A correction can be submitted for a student and then approved once."""
    await init_db()
    await seed_initial_fixtures()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login = await client.post("/api/v1/auth/login", json={
            "email": "admin@college.edu", "password": "AdminPass123!"
        })
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        depts = (await client.get("/api/v1/students/departments", headers=headers)).json()
        classes = (await client.get("/api/v1/students/classes", headers=headers)).json()
        sessions = (await client.get("/api/v1/sessions", headers=headers)).json()
        dae_classes = [c for c in classes if "CIT" in c["name"]]
        assert dae_classes
        stu = (await client.post("/api/v1/students", headers=headers, json={
            "roll_number": _uniq("TEST-CORR"), "full_name": "Correction Test",
            "email": "corr.test@college.edu",
            "department_id": depts[0]["id"], "class_id": dae_classes[0]["id"],
        })).json()

        corr = await client.post("/api/v1/reports/corrections", headers=headers, json={
            "session_id": sessions[0]["id"],
            "reason": "I was present but marked absent.",
            "student_id": stu["id"],
        })
        assert corr.status_code == 200
        corr_id = corr.json()["id"]
        assert corr.json()["status"] == "PENDING"

        review = await client.post(f"/api/v1/reports/corrections/{corr_id}/review",
                                   headers=headers, json={"decision": "APPROVED", "note": "Verified with teacher."})
        assert review.status_code == 200
        assert review.json()["status"] == "APPROVED"
        assert review.json()["reviewed_at"] is not None

        # A second review must fail — the request is already decided
        again = await client.post(f"/api/v1/reports/corrections/{corr_id}/review",
                                  headers=headers, json={"decision": "REJECTED"})
        assert again.status_code == 400

        # An invalid decision must fail
        bad = await client.post(f"/api/v1/reports/corrections/{corr_id}/review",
                                headers=headers, json={"decision": "MAYBE"})
        assert bad.status_code == 400

