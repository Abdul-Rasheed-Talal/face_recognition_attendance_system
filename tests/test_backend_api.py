"""
Backend REST API Integration Tests.
Validates authentication, student management, session lookup, manual attendance,
duplicate prevention, and statistics reporting.
"""

import pytest
from httpx import AsyncClient, ASGITransport

from backend.main import app, seed_initial_fixtures
from backend.app.core.database import init_db


@pytest.fixture
def anyio_backend():
    return "asyncio"


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

        # 2. Get active session to find class_id and department_id
        sess_resp = await client.get("/api/v1/sessions", headers=headers)
        assert sess_resp.status_code == 200
        sessions = sess_resp.json()
        assert len(sessions) > 0
        active_sess = sessions[0]
        session_id = active_sess["id"]

        # 3. Check manual attendance creation
        man_att = await client.post(
            "/api/v1/attendance/manual",
            headers=headers,
            json={
                "session_id": session_id,
                "student_id": "test-student-id-123",
                "status": "PRESENT",
                "notes": "Test manual verification",
            }
        )
        assert man_att.status_code == 200
        rec = man_att.json()
        assert rec["status"] == "PRESENT"
        assert rec["session_id"] == session_id

        # 4. Check duplicate override updates record rather than failing or duplicating
        man_att_override = await client.post(
            "/api/v1/attendance/manual",
            headers=headers,
            json={
                "session_id": session_id,
                "student_id": "test-student-id-123",
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
                "roll_number": "TEST-DEL-01",
                "full_name": "Temporary Test Student",
                "email": "temp.test@college.edu",
                "department_id": "CS",
                "class_id": "BS CS 2023",
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

