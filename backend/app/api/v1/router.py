"""
API v1 Central Router.
"""

from fastapi import APIRouter

from backend.app.api.v1.endpoints import (
    auth,
    students,
    enrollment,
    sessions,
    attendance,
    camera,
    reports,
)

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router)
api_router.include_router(students.router)
api_router.include_router(enrollment.router)
api_router.include_router(sessions.router)
api_router.include_router(attendance.router)
api_router.include_router(camera.router)
api_router.include_router(reports.router)
