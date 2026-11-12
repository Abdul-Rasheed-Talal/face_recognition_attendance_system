"""
Camera Stream and Telemetry Endpoints.
"""

from typing import List, Optional
import time
import asyncio
import urllib.parse
from fastapi import APIRouter, HTTPException, status, Request, Response, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.v1.deps import require_teacher_or_admin
from backend.app.core.database import get_db
from backend.app.models.entities import CameraDevice, Laboratory
from backend.app.schemas.domain import (
    CameraConfigUpdate,
    CameraTestResult,
    CameraDeviceCreate,
    CameraDeviceUpdate,
    CameraDeviceOut,
)
from backend.app.cv.rtsp_reader import VideoStreamReader

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


# ------------------------------------------------------------------------------
# Multi-Camera Management Endpoints
# ------------------------------------------------------------------------------

@router.get("/devices", response_model=List[CameraDeviceOut])
async def list_camera_devices(
    db: AsyncSession = Depends(get_db),
    request: Request = None,
):
    """Lists all registered IP cameras with their active and connection states."""
    res = await db.execute(select(CameraDevice).order_by(CameraDevice.created_at.desc()))
    cameras = res.scalars().all()
    
    # Sync live status from running reader
    reader = getattr(request.app.state, "reader", None) if request else None
    active_source = str(reader.source) if reader else None
    
    out = []
    for c in cameras:
        is_cur = False
        if active_source and (c.rtsp_url == active_source or active_source.endswith(c.rtsp_url.split("@")[-1])):
            is_cur = True
        out.append(
            CameraDeviceOut(
                id=c.id,
                name=c.name,
                rtsp_url=c.rtsp_url,
                ip_address=c.ip_address,
                port=c.port or 554,
                status="CONNECTED" if (is_cur and reader and reader._is_connected) else c.status,
                is_active=is_cur or (c.is_active or False),
                laboratory_id=c.laboratory_id,
                last_seen=c.last_seen,
                created_at=c.created_at,
            )
        )
    return out


@router.post("/devices", response_model=CameraDeviceOut, status_code=status.HTTP_201_CREATED)
async def create_camera_device(
    payload: CameraDeviceCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_teacher_or_admin),
):
    """Registers a new IP camera device into the system."""
    # Resolve RTSP URL
    if payload.source_type == "hikvision":
        ip = payload.ip_address or "192.168.1.218"
        port = payload.port or 554
        user_enc = urllib.parse.quote(payload.username or "admin", safe="")
        pwd_enc = urllib.parse.quote(payload.password or "", safe="")
        channel = payload.stream_channel or 101
        rtsp_url = f"rtsp://{user_enc}:{pwd_enc}@{ip}:{port}/Streaming/Channels/{channel}"
    elif payload.source_type == "webcam":
        rtsp_url = str(payload.webcam_index if payload.webcam_index is not None else 0)
    else:
        if not payload.rtsp_url:
            raise HTTPException(status_code=400, detail="RTSP URL is required for custom RTSP camera")
        rtsp_url = payload.rtsp_url.strip()

    # Get laboratory
    lab_id = payload.laboratory_id
    if not lab_id:
        first_lab = (await db.execute(select(Laboratory))).scalars().first()
        if first_lab:
            lab_id = first_lab.id

    # Check if first camera
    existing_count = (await db.execute(select(CameraDevice))).scalars().all()
    make_active = len(existing_count) == 0

    camera = CameraDevice(
        name=payload.name.strip(),
        rtsp_url=rtsp_url,
        ip_address=payload.ip_address,
        port=payload.port or 554,
        status="OFFLINE",
        laboratory_id=lab_id,
        is_active=make_active,
    )
    db.add(camera)
    await db.commit()
    await db.refresh(camera)

    # If first camera or user wants it active, switch reader
    if make_active:
        reader = getattr(request.app.state, "reader", None)
        if reader:
            reader.update_source(rtsp_url)

    return CameraDeviceOut(
        id=camera.id,
        name=camera.name,
        rtsp_url=camera.rtsp_url,
        ip_address=camera.ip_address,
        port=camera.port,
        status=camera.status,
        is_active=camera.is_active,
        laboratory_id=camera.laboratory_id,
        last_seen=camera.last_seen,
        created_at=camera.created_at,
    )


@router.put("/devices/{camera_id}", response_model=CameraDeviceOut)
async def update_camera_device(
    camera_id: str,
    payload: CameraDeviceUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_teacher_or_admin),
):
    """Updates an existing camera device configuration."""
    camera = (await db.execute(select(CameraDevice).where(CameraDevice.id == camera_id))).scalars().first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera device not found.")

    if payload.name is not None:
        camera.name = payload.name.strip()
    if payload.rtsp_url is not None:
        camera.rtsp_url = payload.rtsp_url.strip()
    if payload.ip_address is not None:
        camera.ip_address = payload.ip_address.strip()
    if payload.port is not None:
        camera.port = payload.port
    if payload.status is not None:
        camera.status = payload.status
    if payload.laboratory_id is not None:
        camera.laboratory_id = payload.laboratory_id

    await db.commit()
    await db.refresh(camera)

    return CameraDeviceOut(
        id=camera.id,
        name=camera.name,
        rtsp_url=camera.rtsp_url,
        ip_address=camera.ip_address,
        port=camera.port,
        status=camera.status,
        is_active=camera.is_active,
        laboratory_id=camera.laboratory_id,
        last_seen=camera.last_seen,
        created_at=camera.created_at,
    )


@router.delete("/devices/{camera_id}")
async def delete_camera_device(
    camera_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_teacher_or_admin),
):
    """Deletes a camera device from the system."""
    camera = (await db.execute(select(CameraDevice).where(CameraDevice.id == camera_id))).scalars().first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera device not found.")

    await db.delete(camera)
    await db.commit()
    return {"success": True, "message": f"Camera '{camera.name}' deleted successfully."}


@router.post("/devices/{camera_id}/activate")
async def activate_camera_device(
    camera_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_teacher_or_admin),
):
    """Switches the live AI recognition engine to ingest from this specific camera."""
    cameras = (await db.execute(select(CameraDevice))).scalars().all()
    target_cam = None
    for c in cameras:
        if c.id == camera_id:
            c.is_active = True
            c.status = "CONNECTED"
            target_cam = c
        else:
            c.is_active = False

    if not target_cam:
        raise HTTPException(status_code=404, detail="Camera device not found.")

    await db.commit()

    reader = getattr(request.app.state, "reader", None)
    if reader:
        reader.update_source(target_cam.rtsp_url)

    return {
        "success": True,
        "message": f"Camera '{target_cam.name}' activated for live recognition ingestion.",
        "active_source": target_cam.rtsp_url.split("@")[-1] if "@" in target_cam.rtsp_url else target_cam.rtsp_url,
    }


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


def _build_source_from_config(config: CameraConfigUpdate) -> str | int:
    """Helper to convert CameraConfigUpdate into a clean video source string or int."""
    if config.source_type == "hikvision":
        ip = config.hikvision_ip or "192.168.1.218"
        port = config.hikvision_port or 554
        user = urllib.parse.quote(config.hikvision_username or "admin", safe="")
        pwd = urllib.parse.quote(config.hikvision_password or "", safe="")
        channel = config.hikvision_stream or 101
        return f"rtsp://{user}:{pwd}@{ip}:{port}/Streaming/Channels/{channel}"
    elif config.source_type == "rtsp":
        if not config.rtsp_url:
            raise HTTPException(status_code=400, detail="rtsp_url is required for rtsp source type")
        return config.rtsp_url.strip()
    elif config.source_type == "webcam":
        return config.webcam_index if config.webcam_index is not None else 0
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported source type: {config.source_type}")


@router.post("/test", response_model=CameraTestResult)
async def test_camera_connection(config: CameraConfigUpdate):
    """
    Non-blocking endpoint to probe whether given camera credentials or RTSP stream work.
    """
    target_source = _build_source_from_config(config)
    loop = asyncio.get_running_loop()
    
    # Run OpenCV probe in default thread pool to avoid blocking async event loop
    success, msg, res = await loop.run_in_executor(
        None, VideoStreamReader.probe_source, target_source
    )
    
    # Mask password for display
    display_source = str(target_source)
    if "@" in display_source and ":" in display_source:
        parts = display_source.split("@")
        cred_part = parts[0]
        prefix = cred_part.split("://")[0]
        display_source = f"{prefix}://***:***@{parts[1]}"
        
    return CameraTestResult(
        success=success,
        message=msg,
        tested_source=display_source,
        resolution=f"{res[0]}x{res[1]}" if res else None
    )


@router.post("/configure")
async def configure_camera(config: CameraConfigUpdate, request: Request):
    """
    Updates the active camera ingestion source dynamically on the running server.
    """
    reader = request.app.state.reader
    if not reader:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stream reader is not initialized.",
        )
        
    target_source = _build_source_from_config(config)
    reader.update_source(target_source)
    
    return {
        "success": True,
        "message": "Camera source updated and reconnection initiated.",
        "active_source": str(target_source).split("@")[-1] if "@" in str(target_source) else str(target_source)
    }


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
        time.sleep(0.04)  # ~25 FPS real-time fluid video preview


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

