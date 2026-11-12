import os
import requests

MODELS_DIR = "models"
os.makedirs(MODELS_DIR, exist_ok=True)

models = {
    "face_detection_yunet_2023mar.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "face_recognition_sface_2021dec.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
}

for filename, url in models.items():
    filepath = os.path.join(MODELS_DIR, filename)
    if not os.path.exists(filepath):
        print(f"Downloading {filename}...")
        resp = requests.get(url, allow_redirects=True, stream=True)
        resp.raise_for_status()
        with open(filepath, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        print(f"Downloaded {filename} ({os.path.getsize(filepath)} bytes)")
    else:
        print(f"{filename} already exists ({os.path.getsize(filepath)} bytes)")
