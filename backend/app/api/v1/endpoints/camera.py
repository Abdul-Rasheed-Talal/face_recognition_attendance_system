"""
Camera Stream and Telemetry Endpoints.
"""

import time
import asyncio
from fastapi import APIRouter, HTTPException, status, Request, Response
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
    """Yields multipart MJPEG frames with explicit Content-Length for browser streaming."""
    while True:
        frame_bytes = engine.get_annotated_frame_jpeg()
        if frame_bytes is not None:
            length = str(len(frame_bytes)).encode("ascii")
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + length + b"\r\n\r\n"
                + frame_bytes + b"\r\n"
            )
        time.sleep(0.067)  # ~15 FPS visual preview to conserve CPU


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
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate, pre-check=0, post-check=0, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "Connection": "close",
    }
    return StreamingResponse(
        generate_mjpeg_stream(engine),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers=headers,
    )


@router.get("/snapshot")
async def get_camera_snapshot(request: Request):
    """Returns the latest single annotated JPEG frame for frame-polling fallbacks."""
    engine = request.app.state.recognition_engine
    if not engine:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Recognition engine is not running.",
        )
    frame_bytes = engine.get_annotated_frame_jpeg()
    if frame_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No frame available yet.",
        )
    return Response(
        content=frame_bytes,
        media_type="image/jpeg",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )

