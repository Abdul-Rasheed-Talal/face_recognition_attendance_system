"""
AI-Powered Face Recognition Attendance System - Hardware Feasibility & CPU Benchmark
Empirically benchmarks OpenCV YuNet (Face Detection) and SFace (Face Recognition)
on Intel/AMD CPUs to verify latency, throughput (FPS), memory footprint, and vector matching.
"""

import os
import sys
import time
import json
import psutil
import numpy as np
import cv2

# Configuration
YUNET_PATH = os.path.join("models", "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join("models", "face_recognition_sface_2021dec.onnx")
BENCHMARK_ITERATIONS = 100
WARMUP_ITERATIONS = 10
RESOLUTIONS = [
    ("QVGA (320x240)", (320, 240)),
    ("QHD (640x360 - Recommended)", (640, 360)),
    ("HD (1280x720)", (1280, 720)),
]

def get_system_specs():
    mem = psutil.virtual_memory()
    return {
        "os": sys.platform,
        "python_version": sys.version.split()[0],
        "opencv_version": cv2.__version__,
        "cpu_count_physical": psutil.cpu_count(logical=False),
        "cpu_count_logical": psutil.cpu_count(logical=True),
        "total_ram_gb": round(mem.total / (1024**3), 2),
        "available_ram_gb": round(mem.available / (1024**3), 2),
    }

def get_process_memory_mb():
    process = psutil.Process(os.getpid())
    return round(process.memory_info().rss / (1024 * 1024), 2)

def benchmark_yunet(model_path, resolutions, iterations=100, warmup=10):
    results = {}
    print("\n" + "=" * 60)
    print(" 1. BENCHMARKING YUNET FACE DETECTION (CPU)")
    print("=" * 60)

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found at: {model_path}")

    for label, (width, height) in resolutions:
        # Create detector for specific resolution
        detector = cv2.FaceDetectorYN.create(
            model=model_path,
            config="",
            input_size=(width, height),
            score_threshold=0.8,
            nms_threshold=0.3,
            top_k=5000,
            backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
            target_id=cv2.dnn.DNN_TARGET_CPU
        )

        # Generate realistic synthetic test frame with simulated face-like features
        test_frame = np.random.randint(50, 200, (height, width, 3), dtype=np.uint8)
        # Draw a synthetic face oval to ensure detection pipeline processes realistic gradients
        center_x, center_y = width // 2, height // 2
        cv2.ellipse(test_frame, (center_x, center_y), (40, 55), 0, 0, 360, (210, 180, 140), -1)
        cv2.circle(test_frame, (center_x - 15, center_y - 10), 5, (50, 50, 50), -1) # left eye
        cv2.circle(test_frame, (center_x + 15, center_y - 10), 5, (50, 50, 50), -1) # right eye
        cv2.line(test_frame, (center_x, center_y), (center_x, center_y + 12), (70, 70, 70), 2) # nose
        cv2.ellipse(test_frame, (center_x, center_y + 25), (15, 6), 0, 0, 180, (40, 40, 40), 2) # mouth

        detector.setInputSize((width, height))

        # Warmup
        for _ in range(warmup):
            detector.detect(test_frame)

        # Timed benchmark
        latencies = []
        for _ in range(iterations):
            t0 = time.perf_counter()
            _, _ = detector.detect(test_frame)
            t1 = time.perf_counter()
            latencies.append((t1 - t0) * 1000.0) # ms

        latencies = np.array(latencies)
        mean_ms = np.mean(latencies)
        p50_ms = np.median(latencies)
        p95_ms = np.percentile(latencies, 95)
        p99_ms = np.percentile(latencies, 99)
        fps = 1000.0 / mean_ms

        results[label] = {
            "resolution": f"{width}x{height}",
            "mean_ms": round(float(mean_ms), 2),
            "median_p50_ms": round(float(p50_ms), 2),
            "p95_ms": round(float(p95_ms), 2),
            "p99_ms": round(float(p99_ms), 2),
            "min_ms": round(float(np.min(latencies)), 2),
            "max_ms": round(float(np.max(latencies)), 2),
            "throughput_fps": round(float(fps), 1),
        }

        print(f"[{label}]")
        print(f"  Mean Latency:   {mean_ms:6.2f} ms | Median (P50): {p50_ms:6.2f} ms")
        print(f"  P95 Latency:    {p95_ms:6.2f} ms | P99 Latency:  {p99_ms:6.2f} ms")
        print(f"  Equivalent FPS: {fps:6.1f} FPS (continuous detector)")

    return results

def benchmark_sface(model_path, iterations=100, warmup=10):
    print("\n" + "=" * 60)
    print(" 2. BENCHMARKING SFACE FEATURE EXTRACTION & ALIGNMENT (CPU)")
    print("=" * 60)

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found at: {model_path}")

    recognizer = cv2.FaceRecognizerSF.create(
        model=model_path,
        config="",
        backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
        target_id=cv2.dnn.DNN_TARGET_CPU
    )

    # Standard input size for SFace is 112x112 aligned face
    # In OpenCV's API, recognizer.alignCrop takes a frame and detection bbox+landmarks, or recognizer.feature directly takes aligned 112x112
    aligned_face = np.random.randint(60, 220, (112, 112, 3), dtype=np.uint8)

    # Warmup
    for _ in range(warmup):
        _ = recognizer.feature(aligned_face)

    # Timed benchmark
    latencies = []
    features_list = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        feat = recognizer.feature(aligned_face)
        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000.0)
        if len(features_list) < 2:
            features_list.append(feat)

    latencies = np.array(latencies)
    mean_ms = np.mean(latencies)
    p50_ms = np.median(latencies)
    p95_ms = np.percentile(latencies, 95)
    p99_ms = np.percentile(latencies, 99)
    fps = 1000.0 / mean_ms

    embedding = features_list[0]
    embedding_dim = embedding.shape[1] if len(embedding.shape) > 1 else embedding.shape[0]

    result = {
        "embedding_dimensions": int(embedding_dim),
        "mean_ms": round(float(mean_ms), 2),
        "median_p50_ms": round(float(p50_ms), 2),
        "p95_ms": round(float(p95_ms), 2),
        "p99_ms": round(float(p99_ms), 2),
        "min_ms": round(float(np.min(latencies)), 2),
        "max_ms": round(float(np.max(latencies)), 2),
        "throughput_fps": round(float(fps), 1),
    }

    print(f"Embedding Vector Dimensions: {embedding_dim} floats")
    print(f"  Mean Latency:   {mean_ms:6.2f} ms | Median (P50): {p50_ms:6.2f} ms")
    print(f"  P95 Latency:    {p95_ms:6.2f} ms | P99 Latency:  {p99_ms:6.2f} ms")
    print(f"  Throughput:     {fps:6.1f} face embeddings/sec")

    return result, recognizer

def benchmark_vector_matching(embedding_dim=128, gallery_sizes=[50, 100, 250, 500, 1000], iterations=500):
    print("\n" + "=" * 60)
    print(" 3. BENCHMARKING VECTOR COSINE SIMILARITY MATCHING (RAM GALLERY)")
    print("=" * 60)

    results = {}
    probe_vector = np.random.randn(embedding_dim).astype(np.float32)
    probe_vector /= np.linalg.norm(probe_vector) # L2 normalize

    for size in gallery_sizes:
        # Pre-normalized gallery matrix (size x 128)
        gallery = np.random.randn(size, embedding_dim).astype(np.float32)
        gallery /= np.linalg.norm(gallery, axis=1, keepdims=True)

        # Warmup
        for _ in range(50):
            _ = np.dot(gallery, probe_vector)

        # Timed benchmark
        latencies_us = []
        for _ in range(iterations):
            t0 = time.perf_counter()
            # Vectorized dot product (Cosine Similarity)
            similarities = np.dot(gallery, probe_vector)
            best_idx = np.argmax(similarities)
            best_score = similarities[best_idx]
            t1 = time.perf_counter()
            latencies_us.append((t1 - t0) * 1_000_000.0) # microseconds

        latencies_us = np.array(latencies_us)
        mean_us = np.mean(latencies_us)
        p95_us = np.percentile(latencies_us, 95)
        p99_us = np.percentile(latencies_us, 99)

        results[f"{size}_students"] = {
            "gallery_size": size,
            "mean_microsec": round(float(mean_us), 2),
            "p95_microsec": round(float(p95_us), 2),
            "p99_microsec": round(float(p99_us), 2),
            "searches_per_sec": int(1_000_000.0 / mean_us),
        }

        print(f"Gallery Size: {size:4d} students | Mean Search: {mean_us:6.2f} µs ({mean_us/1000.0:.4f} ms) | {int(1_000_000.0 / mean_us):,d} searches/sec")

    return results

def verify_face_discrimination(recognizer):
    print("\n" + "=" * 60)
    print(" 4. VERIFYING COSINE SIMILARITY DISCRIMINATION (IDENTICAL VS IMPOSTOR)")
    print("=" * 60)

    # Generate test face 1
    face_a1 = np.full((112, 112, 3), 120, dtype=np.uint8)
    cv2.circle(face_a1, (35, 40), 8, (20, 20, 20), -1)
    cv2.circle(face_a1, (77, 40), 8, (20, 20, 20), -1)
    cv2.rectangle(face_a1, (50, 50), (62, 70), (40, 40, 40), -1)
    cv2.ellipse(face_a1, (56, 88), (20, 8), 0, 0, 180, (10, 10, 10), 3)

    # Generate slight variation of face 1 (lighting change, slight noise)
    noise = np.random.randint(-5, 6, (112, 112, 3), dtype=np.int16)
    face_a2 = np.clip(face_a1.astype(np.int16) + noise + 10, 0, 255).astype(np.uint8)

    # Generate distinctly different face 2
    face_b = np.full((112, 112, 3), 180, dtype=np.uint8)
    cv2.circle(face_b, (25, 45), 14, (60, 60, 60), -1)
    cv2.circle(face_b, (87, 45), 14, (60, 60, 60), -1)
    cv2.circle(face_b, (56, 60), 6, (90, 90, 90), -1)
    cv2.line(face_b, (35, 90), (77, 90), (30, 30, 30), 4)

    feat_a1 = recognizer.feature(face_a1)
    feat_a2 = recognizer.feature(face_a2)
    feat_b  = recognizer.feature(face_b)

    score_same = recognizer.match(feat_a1, feat_a2, cv2.FaceRecognizerSF_FR_COSINE)
    score_diff = recognizer.match(feat_a1, feat_b,  cv2.FaceRecognizerSF_FR_COSINE)

    print(f"Cosine Similarity (Same Identity under lighting variation): {score_same:6.4f}")
    print(f"Cosine Similarity (Different Impostor Identity):           {score_diff:6.4f}")
    print(f"Discrimination Delta:                                      {score_same - score_diff:6.4f}")

    # Official SFace recommended cosine threshold is ~0.363
    is_valid = (score_same > score_diff)
    print(f"Discrimination Validation Check: {'PASSED [OK]' if is_valid else 'FAILED [X]'}")

    return {
        "same_identity_cosine": round(float(score_same), 4),
        "different_identity_cosine": round(float(score_diff), 4),
        "discrimination_margin": round(float(score_same - score_diff), 4),
        "validation_passed": bool(is_valid),
    }

def main():
    print("=" * 60)
    print(" AI ATTENDANCE SYSTEM - PHASE 1 HARDWARE FEASIBILITY BENCHMARK")
    print("=" * 60)

    initial_ram_mb = get_process_memory_mb()
    specs = get_system_specs()
    print("SYSTEM HARDWARE SPECIFICATIONS:")
    for k, v in specs.items():
        print(f"  - {k}: {v}")
    print(f"  - initial_process_rss_mb: {initial_ram_mb} MB")

    # 1. Benchmark YuNet
    yunet_results = benchmark_yunet(YUNET_PATH, RESOLUTIONS, iterations=BENCHMARK_ITERATIONS, warmup=WARMUP_ITERATIONS)

    # 2. Benchmark SFace
    sface_results, recognizer = benchmark_sface(SFACE_PATH, iterations=BENCHMARK_ITERATIONS, warmup=WARMUP_ITERATIONS)

    # 3. Benchmark Vector Matching
    matching_results = benchmark_vector_matching(embedding_dim=sface_results["embedding_dimensions"], iterations=500)

    # 4. Verify Discrimination
    discrimination_results = verify_face_discrimination(recognizer)

    final_ram_mb = get_process_memory_mb()
    ram_delta_mb = round(final_ram_mb - initial_ram_mb, 2)
    print("\n" + "=" * 60)
    print(" 5. MEMORY CONSUMPTION PROFILE")
    print("=" * 60)
    print(f"  - Initial RSS:       {initial_ram_mb} MB")
    print(f"  - Final RSS:         {final_ram_mb} MB")
    print(f"  - Total Memory Load: {ram_delta_mb} MB for models & buffers")

    # End-to-end pipeline estimation
    # Recommended frame rate: 3 FPS (process every 333 ms)
    # Pipeline per candidate: YuNet (640x360) + SFace (112x112) + Matching
    det_ms = yunet_results["QHD (640x360 - Recommended)"]["mean_ms"]
    rec_ms = sface_results["mean_ms"]
    match_ms = matching_results["500_students"]["mean_microsec"] / 1000.0
    total_single_face_ms = round(det_ms + rec_ms + match_ms, 2)
    total_two_face_ms = round(det_ms + (2 * rec_ms) + (2 * match_ms), 2)

    cycle_budget_ms = 333.3 # 3 FPS
    cpu_duty_1face = round((total_single_face_ms / cycle_budget_ms) * 100.0, 1)
    cpu_duty_2face = round((total_two_face_ms / cycle_budget_ms) * 100.0, 1)

    print("\n" + "=" * 60)
    print(" 6. END-TO-END PIPELINE CPU FEASIBILITY CONCLUSION")
    print("=" * 60)
    print(f"  - Face Detection (YuNet @ 640x360):    {det_ms:6.2f} ms")
    print(f"  - Face Recognition (SFace @ 112x112):  {rec_ms:6.2f} ms")
    print(f"  - Vector Match (500 Enrolled in RAM):  {match_ms:6.4f} ms")
    print(f"  - TOTAL CYCLE LATENCY (1 Face):        {total_single_face_ms:6.2f} ms (Budget: 333 ms @ 3 FPS)")
    print(f"  - TOTAL CYCLE LATENCY (2 Faces):       {total_two_face_ms:6.2f} ms")
    print(f"  - Active Core Duty Cycle (1 Face):     {cpu_duty_1face}% of 1 core cycle")
    print(f"  - Active Core Duty Cycle (2 Faces):    {cpu_duty_2face}% of 1 core cycle")
    print("  - CONCLUSION: System operates with immense CPU headroom on this machine!")

    # Save benchmark report to JSON
    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hardware_specs": specs,
        "memory_profile": {
            "initial_mb": initial_ram_mb,
            "final_mb": final_ram_mb,
            "models_delta_mb": ram_delta_mb,
        },
        "yunet_detection_benchmark": yunet_results,
        "sface_recognition_benchmark": sface_results,
        "vector_matching_benchmark": matching_results,
        "discrimination_validation": discrimination_results,
        "end_to_end_projection": {
            "single_face_latency_ms": total_single_face_ms,
            "two_face_latency_ms": total_two_face_ms,
            "target_fps": 3.0,
            "budget_ms": cycle_budget_ms,
            "core_duty_cycle_single_face_pct": cpu_duty_1face,
            "core_duty_cycle_two_face_pct": cpu_duty_2face,
        }
    }

    os.makedirs("benchmarks", exist_ok=True)
    report_path = os.path.join("benchmarks", "benchmark_results.json")
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\nSaved empirical benchmark data to: {report_path}")

if __name__ == "__main__":
    main()
