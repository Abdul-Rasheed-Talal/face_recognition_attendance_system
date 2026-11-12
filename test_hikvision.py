import cv2
import os
import sys
import time

def test_rtsp_url(url, timeout_sec=5):
    print(f"\n--- Testing RTSP URL: {url} ---")
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|max_delay;500000"
    
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    
    t0 = time.time()
    opened = False
    
    while time.time() - t0 < timeout_sec:
        if cap.isOpened():
            opened = True
            break
        time.sleep(0.5)
        
    if not opened:
        print(f"Failed to open: {url}")
        cap.release()
        return False
        
    ret, frame = cap.read()
    if ret and frame is not None:
        h, w, c = frame.shape
        print(f"SUCCESS! Received frame from {url}: shape={w}x{h}, channels={c}")
        cap.release()
        return True
    else:
        print(f"Stream opened but failed to read frame.")
        cap.release()
        return False

if __name__ == "__main__":
    candidates = [
        "rtsp://192.168.1.218:554/Streaming/Channels/101",
        "rtsp://192.168.1.218:554/Streaming/Channels/102",
        "rtsp://192.168.1.218:554/h264/ch1/main/av_stream",
        "rtsp://192.168.1.218:554/h264/ch1/sub/av_stream",
        "rtsp://192.168.1.218:554/live",
    ]
    
    # Also check if username/password were passed as args
    if len(sys.argv) >= 3:
        user = sys.argv[1]
        pwd = sys.argv[2]
        candidates = [
            f"rtsp://{user}:{pwd}@192.168.1.218:554/Streaming/Channels/101",
            f"rtsp://{user}:{pwd}@192.168.1.218:554/Streaming/Channels/102",
            f"rtsp://{user}:{pwd}@192.168.1.218:554/h264/ch1/main/av_stream",
            f"rtsp://{user}:{pwd}@192.168.1.218:554/h264/ch1/sub/av_stream",
        ]
    
    working_url = None
    for cand in candidates:
        if test_rtsp_url(cand, timeout_sec=4):
            working_url = cand
            break
            
    if working_url:
        print(f"\n[FOUND WORKING STREAM]: {working_url}")
    else:
        print("\nNo unauthenticated stream succeeded.")

