"""
Threaded, Non-Blocking Video Stream Reader for RTSP IP Cameras, Webcams, and File Sources.
Implements a latest-frame single-slot ring buffer with automatic reconnection and watchdog telemetry.
"""

import os
import time
import logging
import threading
from typing import Optional, Tuple, Union
import cv2
import numpy as np

from backend.app.cv.types import CameraHealthStatus

logger = logging.getLogger(__name__)


class VideoStreamReader:
    """
    Continuous video ingestion worker running in a dedicated thread.
    Guarantees zero-backlog latest-frame delivery and graceful reconnection.
    """

    def __init__(
        self,
        source: Union[str, int] = 0,
        reconnect_interval_sec: float = 3.0,
        watchdog_timeout_sec: float = 3.5,
        rtsp_transport: str = "tcp",
        buffer_size: int = 1,
    ):
        self.source = source
        self.reconnect_interval_sec = reconnect_interval_sec
        self.watchdog_timeout_sec = watchdog_timeout_sec
        self.rtsp_transport = rtsp_transport
        self.buffer_size = buffer_size

        # Thread synchronization
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

        # Frame buffers & telemetry
        self._latest_frame: Optional[np.ndarray] = None
        self._last_frame_timestamp: float = 0.0
        self._is_connected: bool = False
        self._reconnect_attempts: int = 0
        self._dropped_frames_count: int = 0
        self._ingestion_fps: float = 0.0
        self._last_error_message: Optional[str] = None

        # Frame rate calculation
        self._frame_counter: int = 0
        self._fps_window_start: float = time.time()

    def start(self) -> "VideoStreamReader":
        """Start the background ingestion thread."""
        if self._thread is not None and self._thread.is_alive():
            logger.warning("VideoStreamReader is already running.")
            return self

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._worker_loop, daemon=True, name="VideoStreamReaderThread")
        self._thread.start()
        logger.info(f"VideoStreamReader started for source: {self.source}")
        return self

    def stop(self, timeout: float = 2.0) -> None:
        """Gracefully stop the ingestion thread."""
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        self._thread = None
        self._is_connected = False
        logger.info(f"VideoStreamReader stopped for source: {self.source}")

    def update_source(self, new_source: Union[str, int]) -> None:
        """
        Dynamically update the camera source and trigger seamless reconnection.
        """
        logger.info(f"Switching video source from {self.source} to {new_source}")
        was_running = self._thread is not None and self._thread.is_alive()
        if was_running:
            self.stop()
        
        with self._lock:
            self.source = new_source
            self._latest_frame = None
            self._is_connected = False
            self._reconnect_attempts = 0
            self._last_error_message = None

        if was_running:
            self.start()

    @classmethod
    def probe_source(
        cls,
        source: Union[str, int],
        timeout_sec: float = 4.0,
        rtsp_transport: str = "tcp",
    ) -> Tuple[bool, str, Optional[Tuple[int, int]]]:
        """
        Safely probes whether a video source (RTSP URL or webcam index) is accessible.
        Returns: (success: bool, message: str, resolution: Optional[(width, height)])
        """
        if isinstance(source, str) and source.startswith("rtsp://"):
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                f"rtsp_transport;{rtsp_transport}|fflags;nobuffer|max_delay;500000|stimeout;4000000"
            )
            cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
        else:
            src = int(source) if isinstance(source, str) and source.isdigit() else source
            cap = cv2.VideoCapture(src)

        try:
            t0 = time.time()
            while time.time() - t0 < timeout_sec:
                if cap.isOpened():
                    ret, frame = cap.read()
                    if ret and frame is not None:
                        h, w = frame.shape[:2]
                        return True, f"Successfully connected ({w}x{h})", (w, h)
                time.sleep(0.2)
            return False, f"Connection timed out after {timeout_sec}s or unauthorized", None
        except Exception as e:
            return False, f"Connection error: {str(e)}", None
        finally:
            cap.release()

    def get_latest_frame(self) -> Tuple[bool, Optional[np.ndarray], float]:
        """
        Thread-safe retrieval of the most recent video frame.
        Returns:
            (has_frame, frame_bgr, timestamp)
        """
        with self._lock:
            if self._latest_frame is None:
                return False, None, 0.0
            return True, self._latest_frame.copy(), self._last_frame_timestamp

    def get_health_status(self) -> CameraHealthStatus:
        """Returns snapshot telemetry of the camera connection and reader state."""
        with self._lock:
            # Check watchdog
            is_alive = self._is_connected
            if is_alive and (time.time() - self._last_frame_timestamp > self.watchdog_timeout_sec):
                is_alive = False

            return CameraHealthStatus(
                camera_source=str(self.source),
                is_connected=is_alive,
                reconnect_attempts=self._reconnect_attempts,
                ingestion_fps=round(self._ingestion_fps, 1),
                dropped_frames_count=self._dropped_frames_count,
                last_frame_timestamp=self._last_frame_timestamp,
                last_error_message=self._last_error_message,
            )

    def _configure_capture(self) -> cv2.VideoCapture:
        """Initialize OpenCV VideoCapture with low-latency and TCP options."""
        # Enforce TCP transport for RTSP streams to eliminate UDP packet tearing
        if isinstance(self.source, str) and self.source.startswith("rtsp://"):
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                f"rtsp_transport;{self.rtsp_transport}|fflags;nobuffer|max_delay;500000|stimeout;5000000"
            )
            cap = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)
        else:
            # Local webcam or video file
            src = int(self.source) if isinstance(self.source, str) and self.source.isdigit() else self.source
            cap = cv2.VideoCapture(src)

        # Set buffer size to 1 to enforce latest-frame delivery
        cap.set(cv2.CAP_PROP_BUFFERSIZE, self.buffer_size)
        return cap

    def _worker_loop(self) -> None:
        """Core loop handling capture, grab/retrieve decimation, and auto-reconnection."""
        while not self._stop_event.is_set():
            logger.info(f"Attempting camera connection: {self.source}")
            cap = None
            try:
                cap = self._configure_capture()
                if not cap.isOpened():
                    raise RuntimeError(f"Failed to open video source: {self.source}")

                with self._lock:
                    self._is_connected = True
                    self._last_error_message = None

                logger.info(f"Camera connected successfully: {self.source}")
                self._last_frame_timestamp = time.time()
                self._fps_window_start = time.time()
                self._frame_counter = 0

                while not self._stop_event.is_set():
                    # Fast grab decodes video headers without full pixel rasterization
                    grabbed = cap.grab()
                    now = time.time()

                    if not grabbed:
                        with self._lock:
                            self._dropped_frames_count += 1
                        # If no frame for watchdog timeout, trigger reconnection
                        if now - self._last_frame_timestamp > self.watchdog_timeout_sec:
                            raise TimeoutError(f"Camera stream watchdog timeout ({self.watchdog_timeout_sec}s with no frames)")
                        time.sleep(0.01)
                        continue

                    # Retrieve latest decoded BGR frame
                    ret, frame = cap.retrieve()
                    if not ret or frame is None:
                        continue

                    # Store atomically
                    with self._lock:
                        self._latest_frame = frame
                        self._last_frame_timestamp = now
                        self._frame_counter += 1

                        # Periodic FPS update
                        elapsed = now - self._fps_window_start
                        if elapsed >= 1.0:
                            self._ingestion_fps = self._frame_counter / elapsed
                            self._frame_counter = 0
                            self._fps_window_start = now

            except Exception as e:
                with self._lock:
                    self._is_connected = False
                    self._reconnect_attempts += 1
                    self._last_error_message = str(e)
                    self._ingestion_fps = 0.0

                logger.warning(f"Camera stream error: {e}. Reconnecting in {self.reconnect_interval_sec}s...")
                time.sleep(self.reconnect_interval_sec)

            finally:
                if cap is not None:
                    cap.release()

        with self._lock:
            self._is_connected = False

