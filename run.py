"""
AI-Powered Face Recognition Attendance System - Main Launcher.
Validates dependencies and model files, then boots the FastAPI application with live SPA.
"""

import os
import sys
import argparse
import uvicorn

def main():
    parser = argparse.ArgumentParser(description="AI Face Recognition Attendance System")
    parser.add_argument("--host", default="0.0.0.0", help="Host address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default: 8000)")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")
    args = parser.parse_args()

    # Verify models — download them automatically if missing. The ONNX
    # models are gitignored, so a fresh clone has none; previously the
    # launcher just exited here and the README never said where to get
    # them from in the quick-start.
    yunet_path = os.path.join("models", "face_detection_yunet_2023mar.onnx")
    sface_path = os.path.join("models", "face_recognition_sface_2021dec.onnx")

    if not os.path.exists(yunet_path) or not os.path.exists(sface_path):
        print("[INFO] ONNX models missing — downloading them now (one-time, ~1 MB total)...")
        print("[INFO] Source: github.com/opencv/opencv_zoo (Apache 2.0).")
        import subprocess

        result = subprocess.run([sys.executable, "download_models.py"])
        if result.returncode != 0 or not os.path.exists(yunet_path) or not os.path.exists(sface_path):
            print("[ERROR] Could not download the ONNX models.")
            print("Check your internet connection, then run manually:")
            print("    python download_models.py")
            print("and make sure these files exist:")
            print(f"    {yunet_path}")
            print(f"    {sface_path}")
            sys.exit(1)
        print("[INFO] Models downloaded.")

    print("=" * 65)
    print(" AI FACE RECOGNITION ATTENDANCE SYSTEM (COLLEGE LABORATORIES)")
    print("=" * 65)
    print(f" * Backend API:       http://localhost:{args.port}/api/v1")
    print(f" * Interactive Docs:  http://localhost:{args.port}/docs")
    print(f" * Full-Stack UI:     http://localhost:{args.port}/")
    print(f" * Inference Engine:  OpenCV YuNet + SFace (ONNX CPU)")
    print(f" * Target Machine:    Intel/AMD CPU (Zero CUDA Dependency)")
    print("=" * 65)

    uvicorn.run("backend.main:app", host=args.host, port=args.port, reload=args.reload)

if __name__ == "__main__":
    main()

