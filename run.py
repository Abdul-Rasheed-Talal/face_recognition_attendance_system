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

    # Verify models
    yunet_path = os.path.join("models", "face_detection_yunet_2023mar.onnx")
    sface_path = os.path.join("models", "face_recognition_sface_2021dec.onnx")

    if not os.path.exists(yunet_path) or not os.path.exists(sface_path):
        print("[ERROR] Required ONNX models missing from models/ directory.")
        print("Please run benchmarks/cpu_benchmark.py or download YuNet and SFace models.")
        sys.exit(1)

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

