"""
Application Configuration Settings.
Loads environment variables using Pydantic Settings.
"""

from typing import List, Union
from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    # Application
    APP_NAME: str = "College Lab Face Recognition Attendance System"
    APP_ENV: str = "development"
    DEBUG: bool = True
    SECRET_KEY: str = "institution-production-secret-key-replace-in-env-32-chars-min"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 12  # 12 hours

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
    ]

    # Institutional Timezone
    TIMEZONE: str = "Asia/Karachi"

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/attendance.db"
    DB_ECHO: bool = False

    # Models & CV
    YUNET_MODEL_PATH: str = "./models/face_detection_yunet_2023mar.onnx"
    SFACE_MODEL_PATH: str = "./models/face_recognition_sface_2021dec.onnx"
    CV_DETECTION_CONFIDENCE_THRESHOLD: float = 0.50  # 0.50 enables reliable detection of far persons
    CV_NMS_THRESHOLD: float = 0.30
    CV_MIN_FACE_WIDTH: int = 14                      # 14px threshold captures faces at 3.5 - 5 meters
    CV_LAPLACIAN_BLUR_THRESHOLD: float = 0.5         # Prevents false blur rejection on smooth portrait faces
    CV_COSINE_SIMILARITY_THRESHOLD: float = 0.363
    CV_AMBIGUITY_MARGIN: float = 0.080
    CV_MULTI_FRAME_CONFIRMATION_COUNT: int = 3
    CV_MULTI_FRAME_WINDOW_SIZE: int = 5
    CV_TRACK_COOLDOWN_SECONDS: float = 1800.0
    CV_REQUIRE_LINE_CROSSING: bool = False  # False: confirms upon 3-of-5 face matches; True: additionally requires virtual doorway crossing

    # Camera & Doorway Gate
    CAMERA_SOURCE: Union[str, int] = "0"
    CAMERA_SOURCE_TYPE: str = "webcam"  # webcam, rtsp, hikvision, or file
    CAMERA_RTSP_TRANSPORT: str = "tcp"
    CAMERA_FPS: int = 25
    CV_PROCESSING_FPS: float = 3.33
    CV_PROCESSING_WIDTH: int = 960
    CV_PROCESSING_HEIGHT: int = 540
    CAMERA_WIDTH: int = 1280
    CAMERA_HEIGHT: int = 720
    CAMERA_RECONNECT_INTERVAL_SECONDS: float = 3.0

    # Dedicated Hikvision IP Camera Configuration
    HIKVISION_IP: str = "192.168.1.218"
    HIKVISION_PORT: int = 554
    HIKVISION_USERNAME: str = "admin"
    HIKVISION_PASSWORD: str = ""
    HIKVISION_STREAM_CHANNEL: int = 101  # 101 = Main Stream (High Res / 1080p), 102 = Sub Stream (Faster / Lower CPU)

    @property
    def effective_camera_source(self) -> Union[str, int]:
        """
        Calculates the active camera source. If CAMERA_SOURCE_TYPE is 'hikvision'
        or if HIKVISION_PASSWORD is provided and CAMERA_SOURCE is '0',
        safely URL-encodes credentials and formats the Hikvision RTSP URL.
        """
        import urllib.parse
        if self.CAMERA_SOURCE_TYPE == "hikvision" or (self.HIKVISION_PASSWORD and str(self.CAMERA_SOURCE) == "0"):
            user_enc = urllib.parse.quote(self.HIKVISION_USERNAME, safe="")
            pwd_enc = urllib.parse.quote(self.HIKVISION_PASSWORD, safe="")
            return f"rtsp://{user_enc}:{pwd_enc}@{self.HIKVISION_IP}:{self.HIKVISION_PORT}/Streaming/Channels/{self.HIKVISION_STREAM_CHANNEL}"
        
        src = str(self.CAMERA_SOURCE)
        if src.isdigit():
            return int(src)
        return src

    ENTRY_LINE_START_X: float = 0.10
    ENTRY_LINE_START_Y: float = 0.55
    ENTRY_LINE_END_X: float = 0.90
    ENTRY_LINE_END_Y: float = 0.55
    ENTRY_DIRECTION_NORMAL_X: float = 0.0
    ENTRY_DIRECTION_NORMAL_Y: float = 1.0

    # Business Rules
    DEFAULT_LATE_GRACE_MINUTES: int = 15
    AUTO_CLOSE_SESSION_HOURS: int = 4


settings = Settings()

