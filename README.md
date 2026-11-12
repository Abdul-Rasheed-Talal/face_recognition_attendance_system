# AI-Powered Face Recognition Attendance System for College Laboratories

[![Python 3.10+](https://img.shields.io/badge/python-3.10%20%7C%203.14-blue.svg)](https://www.python.org/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Inference: CPU Only](https://img.shields.io/badge/Inference-Intel%2FAMD%20CPU%20(Zero%20CUDA)-emerald.svg)]()
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%20%2B%20SQLAlchemy-teal.svg)](https://fastapi.tiangolo.com/)
[![React 19](https://img.shields.io/badge/Frontend-React%20%2B%20TypeScript%20%2B%20Tailwind-indigo.svg)](https://react.dev/)

An enterprise-grade, edge-optimized automated attendance system designed for educational computer laboratories. It processes incoming RTSP video from entrance-mounted IP cameras in real time using **OpenCV YuNet** and **OpenCV SFace** entirely on **standard commodity CPUs (Intel/AMD x86-64, 8 GB RAM, zero GPU / zero CUDA requirement)**.

---

## 1. System Architecture Overview

```
                                [LABORATORY ENTRANCE]
                                          │
                               [IP RTSP Camera (1080p)]
                                          │ (RTSP over TCP)
               ┌──────────────────────────┴──────────────────────────┐
               │              EDGE COMPUTER (Intel i5 CPU)           │
               │                                                     │
               │  [Threaded RTSP Stream Reader (Ring Buffer, Drop)]  │
               │                          │                          │
               │      [Frame Decimator (Sampled 3.3 FPS, 640x360)]   │
               │                          │                          │
               │      [Face Detector (OpenCV YuNet - 12.7 ms)]       │
               │                          │                          │
               │  [Laplacian Blur Quality Filter (Var >= 60.0)]      │
               │                          │                          │
               │  [Multi-Face Object Tracker (Centroid + IoU)]       │
               │                          │                          │
               │  [Directional Entrance Gate (IN vs OUT Crossing)]   │
               │                          │                          │
               │  [5-Point Affine Aligner -> 112x112 Warp]           │
               │                          │                          │
               │  [Feature Extractor (OpenCV SFace - 19.8 ms)]       │
               │                          │                          │
               │  [In-Memory Gallery Matcher (11.8 µs per 500)]      │
               │                          │                          │
               │  [Multi-Frame State Machine (3-of-5 Confirmation)]  │
               │                          │                          │
               │  [Identity Cooldown Lockout (30 min Cooldown)]      │
               └──────────────────────────┬──────────────────────────┘
                                          │ (Asynchronous Internal Dispatch)
               ┌──────────────────────────┴──────────────────────────┐
               │                 FASTAPI BACKEND SERVER              │
               │                                                     │
               │  - Session & Class Eligibility Validator            │
               │  - Atomic Duplicate Attendance Constraint Engine    │
               │  - Late-Arrival Grace Period Calculator (15m)       │
               │  - Relational Database Engine (PostgreSQL / SQLite) │
               │  - Real-time WebSocket Event Hub                    │
               │  - RESTful API with JWT RBAC Security               │
               └──────────────────────────┬──────────────────────────┘
                                          │
               ┌──────────────────────────┴──────────────────────────┐
               │                REACT 19 + TAILWIND DASHBOARD        │
               │                                                     │
               │  - Live Recognition Video Monitor (MJPEG Overlay)   │
               │  - Real-Time Attendance Ticker (Instant WebSocket)  │
               │  - Biometric Face Registration & Quality Inspector  │
               │  - Session Roster & Manual Teacher Override Panel   │
               │  - Excel / CSV Attendance Reports Exporter          │
               │  - Student Self-Service Portal & Dispute Review     │
               └─────────────────────────────────────────────────────┘
```

---

## 2. Empirical CPU Performance Benchmark

Benchmarks were directly measured on standard institution hardware: **Intel Core i5-6500 CPU @ 3.20 GHz (4 Physical Cores, 8 GB RAM, Windows/Linux)**.

| Component / Pipeline Stage | Model Architecture | Resolution / Target | Mean Latency | Median (P50) | P95 Latency | Throughput |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Face Detection** | OpenCV YuNet | 320x240 (QVGA) | **4.68 ms** | 4.42 ms | 5.68 ms | 213.7 FPS |
| **Face Detection (Recommended)** | OpenCV YuNet | 640x360 (QHD) | **12.73 ms** | 12.26 ms | 16.21 ms | **78.6 FPS** |
| **Face Detection (Full HD)** | OpenCV YuNet | 1280x720 (HD) | 61.87 ms | 59.87 ms | 74.28 ms | 16.2 FPS |
| **Feature Extraction** | OpenCV SFace | 112x112 Aligned | **19.87 ms** | 19.58 ms | 23.43 ms | **50.3 faces/sec** |
| **Vector Cosine Matching** | BLAS Matrix Dot | 500 Enrolled Students | **11.83 µs** | 11.40 µs | 13.90 µs | **84,529/sec** |
| **Total Cycle Latency (1 Face)** | YuNet + SFace + Match | Ingested Frame | **32.61 ms** | **Duty Cycle: 9.8%** of 1 core at 3.3 FPS |
| **Total Cycle Latency (2 Faces)** | YuNet + 2x SFace + Match | Ingested Frame | **52.49 ms** | **Duty Cycle: 15.7%** of 1 core at 3.3 FPS |
| **System Memory Footprint** | Both ONNX models loaded | RAM Allocation | **92.01 MB** total delta (Process RSS: ~130 MB) |

---

## 3. Computer Vision & Recognition Algorithms

### A. Quality Assessment & Blur Suppression
Faces detected by YuNet are evaluated for motion blur using the Laplacian variance:
$$\text{Var}(\Delta I) = \frac{1}{N} \sum_{(x, y)} \left( \nabla^2 I(x, y) - \mu_{\nabla^2 I} \right)^2$$
Any face candidate with $\text{Var}(\Delta I) < 60.0$ or width $< 60\text{ px}$ is rejected prior to alignment, preventing blurry images from contaminating the tracker.

### B. Directional Line-Crossing Gate
A virtual doorway boundary line $(P_1 \to P_2)$ and an inward unit normal vector $\vec{n}_{\text{inward}}$ are defined across the laboratory entrance.
For each track with historical trajectory points $A = (x_{t-k}, y_{t-k})$ and $B = (x_t, y_t)$:
1. **Intersection Test:** Segment $AB$ must cross segment $P_1 P_2$.
2. **Directional Vector Test:**
   $$\vec{V} = \frac{B - A}{\|B - A\|}, \quad \text{Direction} = \begin{cases} \text{IN} & \text{if } \vec{V} \cdot \vec{n}_{\text{inward}} > 0.25 \\ \text{OUT} & \text{if } \vec{V} \cdot \vec{n}_{\text{inward}} < -0.25 \\ \text{NONE} & \text{otherwise} \end{cases}$$
Only tracks confirmed as **IN** are eligible for attendance recording. Students lingering outside or walking out are completely filtered out.

### C. Vector Cosine Similarity & Ambiguity Rejection
Enrolled student templates are stored as 128-dimensional L2-normalized vectors.
Cosine similarity against a probe vector $\vec{v}$:
$$S_i = \vec{v} \cdot \vec{t}_i$$
- **Match Threshold:** $S_1 \ge \tau_{\text{match}} = 0.363$ (OpenCV SFace calibrated threshold).
- **Ambiguity Margin:** To eliminate false positives between look-alikes:
  $$\Delta = S_1 - S_2 \ge 0.080$$
  If $\Delta < 0.080$, the match is labeled `AMBIGUOUS` and sent to the teacher dashboard for manual review rather than erroneously recorded.

### D. Multi-Frame Confirmation & Cooldown Lockout
- **$k$-of-$m$ State Machine:** Requires at least 3 matching frames out of 5 consecutive observations for the same student identity.
- **Identity Lockout:** Once attendance is logged, a 30-minute cooldown lockout suppresses duplicate triggers for that student ID.

---

## 4. Model Licensing Verification

| Model | Weights Provider | License | Status for Institutional Deployment |
| :--- | :--- | :--- | :--- |
| **YuNet** | OpenCV Zoo | **Apache 2.0** | **100% Permissive & Free.** No restrictions. |
| **SFace** | OpenCV Zoo | **Apache 2.0** | **100% Permissive & Free.** No restrictions. |
| *InsightFace (ArcFace)* | InsightFace Team | *Non-Commercial / Research* | **Prohibited** without expensive commercial license. |

---

## 5. Getting Started & Installation

### Prerequisites
- Python 3.10 – 3.14 (64-bit)
- Node.js v18+ and npm v9+
- Standard IP Camera supporting RTSP over TCP, or a USB Webcam / test video file.

### Step 1: Clone Repository & Install Python Dependencies
```bash
git clone https://github.com/institution/Face_recognition_attendance_system.git
cd Face_recognition_attendance_system

# Install Python requirements
pip install -r requirements.txt
pip install "sqlalchemy[asyncio]" greenlet email-validator
```

### Step 2: Download Official Pretrained Models & Run Benchmark
```bash
# Downloads official YuNet and SFace ONNX models and runs the CPU benchmark
python benchmarks/cpu_benchmark.py
```

### Step 3: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Key settings in `.env`:
```ini
# Use '0' for local USB webcam, or RTSP URL e.g. rtsp://admin:pass@192.168.1.100:554/stream
CAMERA_SOURCE=0
CAMERA_SOURCE_TYPE=webcam
TIMEZONE=Asia/Karachi
DATABASE_URL=sqlite+aiosqlite:///./data/attendance.db
```

### Step 4: Run Automated Tests
```bash
python -m pytest tests/ -v
```
*(All 12 unit and integration tests validate CV mathematics, ONNX inference, and REST APIs).*

---

## 6. Running the Application

### Option A: Complete Unified Production Mode (Single Port 8000)
Run the launcher:
```bash
python run.py --port 8000
```
- Full-Stack Dashboard: **http://localhost:8000/**
- Interactive Swagger API: **http://localhost:8000/docs**
- Live Video MJPEG Stream: **http://localhost:8000/api/v1/camera/stream**

### Option B: Development Mode (Backend + Vite Dev Server)
**Terminal 1 (Backend):**
```bash
python run.py --reload
```
**Terminal 2 (Frontend with Hot-Reload):**
```bash
cd frontend
npm run dev
```
Open **http://localhost:5173/**.

---

## 7. Default System Credentials (Test Fixtures)

The application automatically seeds initial accounts on first startup:

| Account Role | Email Address | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@college.edu` | `AdminPass123!` | Full System, Biometric Enrollment, Settings |
| **Teacher** | `prof.smith@college.edu` | `TeacherPass123!` | Session Management, Manual Attendance, Overrides |

---

## 8. REST API Reference

| Endpoint | Method | Role | Description |
| :--- | :--- | :--- | :--- |
| `/api/v1/auth/login` | POST | Public | Authenticates credentials, returns JWT bearer token |
| `/api/v1/auth/me` | GET | Authenticated | Returns logged-in profile & role |
| `/api/v1/students` | GET / POST | Teacher / Admin | List students / register new student |
| `/api/v1/enrollment/{student_id}` | POST | Admin | Upload portrait photo, extract SFace embedding |
| `/api/v1/enrollment/{student_id}` | DELETE | Admin | Remove student's biometric templates |
| `/api/v1/sessions` | GET / POST | Teacher / Admin | List / schedule laboratory sessions |
| `/api/v1/sessions/active` | GET | Teacher / Admin | Returns currently active lab session |
| `/api/v1/attendance` | GET | Teacher / Admin | Query attendance records with filters |
| `/api/v1/attendance/manual` | POST | Teacher | Manual attendance check-in or status override |
| `/api/v1/camera/status` | GET | Teacher / Admin | Returns ingestion FPS, latency, and active tracks |
| `/api/v1/camera/stream` | GET | Public / Auth | Live MJPEG video stream with bounding boxes |
| `/api/v1/reports/statistics` | GET | Public / Auth | Live KPI metrics (total, present, late, absent, %) |
| `/api/v1/reports/export/csv` | GET | Teacher / Admin | Downloads session attendance spreadsheet |
| `/api/v1/reports/corrections` | POST / GET | Student / Teacher | Submit / review attendance dispute requests |

---

## 9. Privacy, Ethics & Data Minimization

1. **Zero Raw Photo Retention:** Photographs uploaded during enrollment are parsed for feature extraction; the 128-dimensional embedding vector is stored and the raw photo is discarded.
2. **No Demographic Profiling:** The system strictly does not extract, predict, or store age, race, gender, or emotion.
3. **Database Constraints:** Duplicate records for `(session_id, student_id)` are blocked by unique database composite constraints.
4. **Audit Logging:** Every manual attendance adjustment or biometric template deletion is recorded with an immutable audit log entry.
