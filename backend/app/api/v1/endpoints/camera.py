"""
Camera Stream and Telemetry Endpoints.
"""

import time
import asyncio
from fastapi import APIRouter, HTTPException, status, Request
from fastapi.responses import StreamingResponse

from backend.app.api.v1.deps import require_teacher_or_admin

router = APIRouter(prefix="/camera", tags=["Camera Integration"])


@router.get("/status")
async def get_camera_status(request: Request):
    """Retrieves operational telemetry of camera ingestion and recognition engine."""
    engine = request.app.state.recognition_engine
    if not engine:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Recognition engine is not running.",
        )
    return engine.get_health_status()


@router.post("/reconnect")
async def reconnect_camera(request: Request):
    """Triggers an immediate camera reconnect cycle."""
    reader = request.app.state.reader
    if not reader:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stream reader is not initialized.",
        )
    # Restart reader
    reader.stop()
    reader.start()
    return {"success": True, "message": "Camera reconnection triggered."}


def generate_mjpeg_stream(engine):
    """Yields multipart MJPEG frames for browser video streaming."""
    while True:
        frame_bytes = engine.get_annotated_frame_jpeg()
        if frame_bytes is not None:
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
            )
        time.sleep(0.1)  # ~10 FPS visual preview to conserve CPU


@router.get("/stream")
async def live_camera_mjpeg_stream(request: Request):
    """
    Live MJPEG stream with detection bounding boxes, tracking trajectories,
    and entry boundary overlays for dashboard monitoring.
    """
    engine = request.app.state.recognition_engine
    if not engine:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Recognition engine is not running.",
        )
    return StreamingResponse(
        generate_mjpeg_stream(engine),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )
