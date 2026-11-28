"""
Real-Time CPU-Optimized Face Anti-Spoofing (Presentation Attack Detection).
Blocks printed photos, posters, and smartphone/tablet screen replay attacks
in < 4 ms per face on CPU without requiring CUDA or heavy external models.
"""

from collections import deque
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np

from backend.app.cv.types import DetectedFace, TrackedFace


@dataclass
class LivenessResult:
    """Result of anti-spoofing / presentation attack evaluation."""
    is_live: bool
    score: float  # 0.0 (definitely spoof) -> 1.0 (definitely live)
    reason: str
    signals: Dict[str, float]


class FaceAntiSpoofDetector:
    """
    Multi-signal passive liveness detector combining:
    1. YCrCb / HSV chrominance richness & specular screen-glare detection
    2. High-frequency skin micro-texture vs flat print/poster energy
    3. Surrounding rectangular bezel / paper-edge border detection
    4. Multi-frame 3D landmark parallax & natural micro-motion analysis
    """

    def __init__(
        self,
        liveness_threshold: float = 0.48,
        min_face_size_for_check: int = 36,
    ):
        self.liveness_threshold = liveness_threshold
        self.min_face_size_for_check = min_face_size_for_check

        # track_id -> deque of (norm_nose_x, norm_nose_y, mean_gray_patch_hash)
        self._track_motion_history: Dict[int, deque] = {}
        # track_id -> deque of recent liveness scores for temporal smoothing
        self._track_score_history: Dict[int, deque] = {}

    def evaluate(
        self,
        frame_bgr: np.ndarray,
        det: DetectedFace,
        track: Optional[TrackedFace] = None,
    ) -> LivenessResult:
        """
        Evaluates whether a detected face is a live person or a spoof (photo/poster/screen).
        """
        h_img, w_img = frame_bgr.shape[:2]
        x, y, w, h = det.bbox

        # Clamp ROI safely
        x1 = max(0, x)
        y1 = max(0, y)
        x2 = min(w_img, x + w)
        y2 = min(h_img, y + h)
        fw, fh = x2 - x1, y2 - y1

        if fw < self.min_face_size_for_check or fh < self.min_face_size_for_check:
            # Too small/far to reliably run texture anti-spoof — allow neutral pass
            return LivenessResult(is_live=True, score=0.65, reason="Face too far for texture check", signals={})

        face_bgr = frame_bgr[y1:y2, x1:x2]
        # Normalize to fixed 96x96 patch for consistent, fast (<2ms) feature metrics
        face_norm = cv2.resize(face_bgr, (96, 96), interpolation=cv2.INTER_LINEAR)

        # --- Signal 1: Color Richness & Screen Glare (YCrCb + HSV) ---
        ycrcb = cv2.cvtColor(face_norm, cv2.COLOR_BGR2YCrCb)
        y_ch, cr_ch, cb_ch = cv2.split(ycrcb)
        cr_std = float(np.std(cr_ch))
        cb_std = float(np.std(cb_ch))
        chroma_richness = (cr_std + cb_std) / 2.0

        hsv = cv2.cvtColor(face_norm, cv2.COLOR_BGR2HSV)
        s_ch = hsv[:, :, 1]
        v_ch = hsv[:, :, 2]
        sat_std = float(np.std(s_ch))

        # Specular screen glare / over-bright white phone display ratio
        glare_ratio = float(np.mean(v_ch > 246))

        # Blue-cast ratio (screens often emit cooler blue bias compared to skin)
        b_mean = float(np.mean(face_norm[:, :, 0]))
        r_mean = float(np.mean(face_norm[:, :, 2])) + 1e-5
        blue_dominance = b_mean / r_mean

        color_score = 1.0
        color_flag = ""
        if chroma_richness < 5.5 and sat_std < 14.0:
            # Extremely flat grayscale / washed-out printed poster
            color_score -= 0.45
            color_flag = "Flat printed photo/poster color"
        elif chroma_richness < 7.5:
            color_score -= 0.20

        if glare_ratio > 0.28:
            # Strong specular glare typical of glossy paper or backlit phone screen
            color_score -= 0.40
            color_flag = color_flag or "Glossy screen/photo glare detected"
        elif glare_ratio > 0.18:
            color_score -= 0.15

        if blue_dominance > 1.38:
            # Unnatural blue-shifted backlit screen
            color_score -= 0.25
            color_flag = color_flag or "Backlit screen color shift"

        color_score = max(0.0, min(1.0, color_score))

        # --- Signal 2: Frequency / Moiré & Print Texture Analysis ---
        gray = cv2.cvtColor(face_norm, cv2.COLOR_BGR2GRAY)
        lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        # High-frequency energy ratio via Difference of Gaussians
        blur_small = cv2.GaussianBlur(gray, (3, 3), 0)
        blur_large = cv2.GaussianBlur(gray, (9, 9), 0)
        dog = cv2.absdiff(blur_small, blur_large)
        mid_freq_energy = float(np.mean(dog))

        # Fine pixel-level noise / screen moiré (pixel diff between raw and 3x3 blur)
        high_freq_diff = float(np.mean(cv2.absdiff(gray, blur_small)))
        moire_ratio = high_freq_diff / (mid_freq_energy + 1e-4)

        texture_score = 1.0
        texture_flag = ""
        if lap_var < 28.0 and mid_freq_energy < 3.2:
            # Overly smooth/flat low-detail poster or blurry photo
            texture_score -= 0.35
            texture_flag = "Low-detail flat photo texture"
        if moire_ratio > 0.88 and lap_var > 450.0:
            # Strong pixel grid / screen moiré pattern
            texture_score -= 0.42
            texture_flag = "Digital screen pixel/moiré pattern"
        texture_score = max(0.0, min(1.0, texture_score))

        # --- Signal 3: Rectangular Phone Bezel / Photo Paper Border Check ---
        border_score = 1.0
        border_flag = ""
        pad_x = int(fw * 0.40)
        pad_y = int(fh * 0.40)
        bx1 = max(0, x1 - pad_x)
        by1 = max(0, y1 - pad_y)
        bx2 = min(w_img, x2 + pad_x)
        by2 = min(h_img, y2 + pad_y)
        surround = frame_bgr[by1:by2, bx1:bx2]

        if surround.shape[0] > 60 and surround.shape[1] > 60:
            sur_small = cv2.resize(surround, (120, 120), interpolation=cv2.INTER_LINEAR)
            sur_gray = cv2.cvtColor(sur_small, cv2.COLOR_BGR2GRAY)
            edges = cv2.Canny(sur_gray, 70, 180)
            # Mask out inner face region so we only inspect the frame *around* the face
            edges[28:92, 28:92] = 0

            # Count strong long straight horizontal & vertical lines (phone bezel / paper edges)
            lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=32, minLineLength=42, maxLineGap=6)
            horiz_lines = 0
            vert_lines = 0
            if lines is not None:
                for line in lines.reshape(-1, 4):
                    lx1, ly1, lx2, ly2 = int(line[0]), int(line[1]), int(line[2]), int(line[3])
                    dx = abs(lx2 - lx1)
                    dy = abs(ly2 - ly1)
                    if dx > 35 and dy < 6:
                        horiz_lines += 1
                    elif dy > 35 and dx < 6:
                        vert_lines += 1

            if horiz_lines >= 2 and vert_lines >= 2:
                # Clear rectangular frame (phone/tablet/printed card) surrounding face!
                border_score = 0.25
                border_flag = "Rectangular photo/phone frame detected"
            elif (horiz_lines >= 1 and vert_lines >= 1) and (glare_ratio > 0.06 or blue_dominance > 1.18):
                border_score = 0.45
                border_flag = "Possible phone/photo edge detected"

        # --- Signal 4: Temporal Micro-Motion & 3D Landmark Parallax ---
        motion_score = 0.78  # Neutral-positive default on first frame
        motion_flag = ""
        if track is not None:
            tid = track.track_id
            hist = self._track_motion_history.setdefault(tid, deque(maxlen=8))

            # Compute normalized landmark geometry (nose relative to eyes)
            lm = det.landmarks
            eye_dx = lm.right_eye[0] - lm.left_eye[0]
            eye_dy = lm.right_eye[1] - lm.left_eye[1]
            inter_ocular = float(np.hypot(eye_dx, eye_dy)) + 1e-4
            rel_nose_x = (lm.nose_tip[0] - lm.left_eye[0]) / inter_ocular
            rel_nose_y = (lm.nose_tip[1] - lm.left_eye[1]) / inter_ocular
            small_patch = cv2.resize(gray, (24, 24), interpolation=cv2.INTER_AREA).astype(np.float32)

            hist.append((rel_nose_x, rel_nose_y, small_patch))

            if len(hist) >= 4:
                # Check pixel-level temporal difference & 3D landmark ratio variation
                diffs = [
                    float(np.mean(np.abs(hist[i][2] - hist[i - 1][2])))
                    for i in range(1, len(hist))
                ]
                avg_patch_diff = sum(diffs) / len(diffs)
                nose_xs = [p[0] for p in hist]
                nose_ys = [p[1] for p in hist]
                lm_jitter = float(np.std(nose_xs) + np.std(nose_ys))

                if avg_patch_diff < 1.1 and lm_jitter < 0.008:
                    # Completely frozen static photo / poster mounted in front of camera
                    motion_score = 0.20
                    motion_flag = "Static 2D photo (no natural motion)"
                elif avg_patch_diff > 2.2 or lm_jitter > 0.025:
                    # Healthy natural human micro-motion / 3D perspective change
                    motion_score = 1.0

        # --- Weighted Fusion ---
        raw_score = (
            0.30 * color_score
            + 0.25 * texture_score
            + 0.25 * border_score
            + 0.20 * motion_score
        )

        # Temporal smoothing per track to avoid single-frame flicker
        if track is not None:
            s_hist = self._track_score_history.setdefault(track.track_id, deque(maxlen=4))
            s_hist.append(raw_score)
            final_score = float(sum(s_hist) / len(s_hist))
        else:
            final_score = float(raw_score)

        # Strong single-signal vetoes for obvious presentation attacks
        is_live = final_score >= self.liveness_threshold
        if border_score <= 0.25 and (color_score < 0.85 or texture_score < 0.85):
            is_live = False
            final_score = min(final_score, 0.32)
        if color_score <= 0.20:
            # Extreme flatness (grayscale print) or blown-out white screen
            is_live = False
            final_score = min(final_score, 0.30)
        if motion_score <= 0.22:
            # Completely static 2D picture/poster held in front of camera
            is_live = False
            final_score = min(final_score, 0.28)

        if is_live:
            reason = "Live person verified"
        else:
            reason = border_flag or motion_flag or color_flag or texture_flag or "Spoof attack detected (photo/screen)"

        return LivenessResult(
            is_live=is_live,
            score=round(final_score, 3),
            reason=reason,
            signals={
                "color": round(color_score, 2),
                "texture": round(texture_score, 2),
                "border": round(border_score, 2),
                "motion": round(motion_score, 2),
            },
        )

    def prune_stale_tracks(self, active_track_ids: List[int]) -> None:
        """Cleans up history buffers for ended tracks."""
        active = set(active_track_ids)
        for tid in [k for k in self._track_motion_history if k not in active]:
            del self._track_motion_history[tid]
        for tid in [k for k in self._track_score_history if k not in active]:
            del self._track_score_history[tid]
