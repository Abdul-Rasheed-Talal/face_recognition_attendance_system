"""
Main FastAPI Application Entry Point.
Initializes database schema, seed fixtures, computer vision inference engine, and WebSocket gateway.
"""

import os
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from datetime import datetime, timezone, timedelta

from backend.app.core.config import settings
from backend.app.core.database import init_db, AsyncSessionLocal, engine
from backend.app.core.security import hash_password
from backend.app.models.entities import (
    User,
    Department,
    ClassGroup,
    Subject,
    Laboratory,
    CameraDevice,
    LabSession,
)
from backend.app.cv import (
    YuNetFaceDetector,
    SFaceFeatureExtractor,
    FaceMatcher,
    FaceTracker,
    DirectionalLineGate,
    MultiFrameConfirmationEngine,
    VideoStreamReader,
    VisionRecognitionEngine,
    AttendanceCandidateEvent,
)
from backend.app.services.enrollment_service import FaceEnrollmentService
from backend.app.services.attendance_service import AttendanceService
from backend.app.websocket.connection_manager import ws_manager
from backend.app.api.v1.router import api_router

# Setup structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("fras_backend")


async def seed_initial_fixtures():
    """Seeds default institutional data if database is empty."""
    async with AsyncSessionLocal() as db:
        # Check if users exist
        user_res = await db.execute(select(User))
        if user_res.scalars().first() is None:
            logger.info("Database empty: seeding initial institutional fixtures...")
            
            # Default Admin
            admin = User(
                email="admin@college.edu",
                password_hash=hash_password("AdminPass123!"),
                full_name="System Administrator",
                role="ADMIN",
                is_active=True,
            )
            # Default Teacher
            teacher = User(
                email="prof.smith@college.edu",
                password_hash=hash_password("TeacherPass123!"),
                full_name="Prof. John Smith",
                role="TEACHER",
                is_active=True,
            )
            db.add_all([admin, teacher])
            await db.flush()

            # Department & real classes (DAE CIT — the BS CS 2023 class that
            # used to be seeded here was a dummy and is gone).
            dept = Department(code="CIT", name="Computer Information Technology (DAE CIT)")
            db.add(dept)
            await db.flush()

            class_groups = []
            for year, semester in (
                ("1st Year", "1st Semester"),
                ("2nd Year", "3rd Semester"),
                ("3rd Year", "5th Semester"),
            ):
                class_grp = ClassGroup(
                    department_id=dept.id,
                    name=f"DAE CIT {year}",
                    year=year,
                    semester=semester,
                    section="A",
                )
                db.add(class_grp)
                class_groups.append(class_grp)
            await db.flush()

            # Subject & Lab (the lab whose gate the camera sits above)
            subject = Subject(
                department_id=dept.id,
                code="CIT-LAB",
                name="Computer Applications Lab",
            )
            lab = Laboratory(
                name="DAE CIT Laboratory",
                room_number="LAB-CIT-01",
                building="Main Block",
                capacity=40,
            )
            db.add_all([subject, lab])
            await db.flush()

            # Camera device
            cam = CameraDevice(
                laboratory_id=lab.id,
                name="Lab Gate Camera",
                rtsp_url=str(settings.effective_camera_source),
                status="OFFLINE",
            )
            db.add(cam)

            # One SCHEDULED session for DAE CIT 1st Year so the timetable
            # is not empty on a fresh install. It is SCHEDULED, not ACTIVE:
            # the old seed created an ACTIVE session spanning now +/- 2 h on
            # every fresh DB, and the session matcher would happily absorb
            # students from the wrong class into it.
            now = datetime.now(timezone.utc)
            session = LabSession(
                subject_id=subject.id,
                laboratory_id=lab.id,
                teacher_id=teacher.id,
                class_id=class_groups[0].id,
                start_time=now - timedelta(minutes=10),
                end_time=now + timedelta(hours=2),
                late_grace_minutes=15,
                status="SCHEDULED",
            )
            db.add(session)

            await db.commit()
            logger.info("Initial institutional fixtures created successfully.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: initialize DB, CV inference pipeline, and background workers."""
    logger.info("Initializing Face Recognition Attendance Backend...")

    # 1. Initialize DB schema
    await init_db()
    await seed_initial_fixtures()

    # 2. Fail fast with an actionable message if the ONNX models are
    # missing (they are gitignored, so a fresh clone has none). The
    # launcher run.py downloads them automatically; running uvicorn
    # directly used to die later with a bare FileNotFoundError.
    for _model_path in (settings.YUNET_MODEL_PATH, settings.SFACE_MODEL_PATH):
        if not os.path.exists(_model_path):
            raise RuntimeError(
                f"ONNX model not found: {_model_path}. "
                "Run `python download_models.py` once (needs internet), "
                "or start the app with `python run.py`, which downloads "
                "missing models automatically."
            )

    # 3. Initialize CV components
    detector = YuNetFaceDetector(
        model_path=settings.YUNET_MODEL_PATH,
        confidence_threshold=settings.CV_DETECTION_CONFIDENCE_THRESHOLD,
        nms_threshold=settings.CV_NMS_THRESHOLD,
        min_face_width=settings.CV_MIN_FACE_WIDTH,
        laplacian_blur_threshold=settings.CV_LAPLACIAN_BLUR_THRESHOLD,
    )
    recognizer = SFaceFeatureExtractor(model_path=settings.SFACE_MODEL_PATH)
    matcher = FaceMatcher(
        similarity_threshold=settings.CV_COSINE_SIMILARITY_THRESHOLD,
        ambiguity_margin=settings.CV_AMBIGUITY_MARGIN,
    )
    tracker = FaceTracker()
    line_gate = DirectionalLineGate(
        line_start=(settings.ENTRY_LINE_START_X, settings.ENTRY_LINE_START_Y),
        line_end=(settings.ENTRY_LINE_END_X, settings.ENTRY_LINE_END_Y),
        inward_normal=(settings.ENTRY_DIRECTION_NORMAL_X, settings.ENTRY_DIRECTION_NORMAL_Y),
    )
    confirmation_engine = MultiFrameConfirmationEngine(
        required_confirmations=settings.CV_MULTI_FRAME_CONFIRMATION_COUNT,
        window_size=settings.CV_MULTI_FRAME_WINDOW_SIZE,
        identity_cooldown_sec=settings.CV_TRACK_COOLDOWN_SECONDS,
        require_line_crossing=settings.CV_REQUIRE_LINE_CROSSING,
    )

    # 4. Initialize video reader
    cam_source = settings.effective_camera_source
    async with AsyncSessionLocal() as db_session:
        active_device = (await db_session.execute(
            select(CameraDevice).where(CameraDevice.is_active == True)
        )).scalars().first()
        if active_device and active_device.rtsp_url != "0":
            cam_source = active_device.rtsp_url
        elif str(settings.effective_camera_source) != "0":
            cam_source = settings.effective_camera_source
            if active_device:
                active_device.name = "Hikvision Entrance Camera"
                active_device.rtsp_url = str(settings.effective_camera_source)
                active_device.ip_address = settings.HIKVISION_IP
                await db_session.commit()

    reader = VideoStreamReader(
        source=cam_source,
        reconnect_interval_sec=settings.CAMERA_RECONNECT_INTERVAL_SECONDS,
        rtsp_transport=settings.CAMERA_RTSP_TRANSPORT,
    )

    # 5. Asynchronous event dispatcher callback
    main_loop = asyncio.get_running_loop()

    def on_attendance_candidate(event: AttendanceCandidateEvent):
        """Dispatches verified CV event into async database persistence."""
        async def _persist():
            async with AsyncSessionLocal() as db:
                await AttendanceService.process_candidate_event(db, event)
        asyncio.run_coroutine_threadsafe(_persist(), main_loop)

    # 6. Build recognition engine
    engine_cv = VisionRecognitionEngine(
        reader=reader,
        detector=detector,
        recognizer=recognizer,
        matcher=matcher,
        tracker=tracker,
        line_gate=line_gate,
        confirmation_engine=confirmation_engine,
        processing_fps=settings.CV_PROCESSING_FPS,
        processing_scale=(settings.CV_PROCESSING_WIDTH, settings.CV_PROCESSING_HEIGHT),
        require_line_crossing=settings.CV_REQUIRE_LINE_CROSSING,
        recognition_every_n_frames=settings.CV_RECOGNITION_EVERY_N_FRAMES,
        on_attendance_event=on_attendance_candidate,
    )

    # 7. Initialize enrollment service with dedicated CV models to eliminate any thread contention with the video loop
    enroll_detector = YuNetFaceDetector(
        model_path=settings.YUNET_MODEL_PATH,
        confidence_threshold=0.50,
        nms_threshold=settings.CV_NMS_THRESHOLD,
        min_face_width=25,
        laplacian_blur_threshold=0.3,
    )
    enroll_recognizer = SFaceFeatureExtractor(model_path=settings.SFACE_MODEL_PATH)
    enrollment_service = FaceEnrollmentService(enroll_detector, enroll_recognizer, matcher)
    async with AsyncSessionLocal() as db:
        await enrollment_service.load_all_active_templates_to_gallery(db)

    # Store references on app state for dependency access
    app.state.detector = detector
    app.state.recognizer = recognizer
    app.state.matcher = matcher
    app.state.reader = reader
    app.state.recognition_engine = engine_cv
    app.state.enrollment_service = enrollment_service

    # Start the continuous vision worker
    engine_cv.start()
    logger.info("Recognition engine and RTSP ingestion running.")

    yield

    # Shutdown
    logger.info("Stopping vision recognition engine and camera worker...")
    engine_cv.stop()
    await engine.dispose()
    logger.info("Backend shutdown complete.")


app = FastAPI(
    title=settings.APP_NAME,
    description="Production-Grade Real-Time AI Face Recognition Attendance System for College Labs",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount REST API
app.include_router(api_router)


@app.get("/health")
async def health_check():
    """Liveness probe."""
    return {"status": "HEALTHY", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.websocket("/ws/attendance")
async def websocket_attendance_endpoint(websocket: WebSocket):
    """Real-time live WebSocket feed for attendance dashboard notifications."""
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep-alive ping/pong
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


# Mount benchmarks directory if present
benchmarks_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "benchmarks")
if os.path.exists(benchmarks_dir):
    app.mount("/benchmarks", StaticFiles(directory=benchmarks_dir), name="benchmarks")

# Mount built production frontend if present
frontend_dist = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend_spa")



if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=settings.HOST, port=settings.PORT, reload=False)
