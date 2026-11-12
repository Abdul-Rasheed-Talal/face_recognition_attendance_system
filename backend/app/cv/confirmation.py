"""
Multi-Frame Evidence Accumulator, Confirmation State Machine, and Identity Cooldown Manager.
Guarantees that attendance is never triggered by a single transient or noisy frame.
"""

from collections import deque
from datetime import datetime, timezone
import logging
import time
from typing import Dict, List, Optional, Tuple

from backend.app.cv.types import AttendanceCandidateEvent, RecognitionMatch, TrackedFace

logger = logging.getLogger(__name__)


class MultiFrameConfirmationEngine:
    """
    Maintains a sliding observation buffer for each active track.
    Applies k-of-m evidence accumulation before confirming attendance eligibility.
    """

    def __init__(
        self,
        required_confirmations: int = 3,
        window_size: int = 5,
        identity_cooldown_sec: float = 1800.0,  # 30 minutes cooldown per student
    ):
        self.required_confirmations = required_confirmations
        self.window_size = window_size
        self.identity_cooldown_sec = identity_cooldown_sec

        # track_id -> deque of recent RecognitionMatch objects
        self._track_observations: Dict[int, deque] = {}

        # student_id -> last_attendance_timestamp
        self._identity_cooldowns: Dict[str, float] = {}

    def record_observation(
        self,
        track: TrackedFace,
        match: RecognitionMatch,
        camera_id: str = "CAM_LAB_01",
        current_timestamp: Optional[float] = None,
    ) -> Optional[AttendanceCandidateEvent]:
        """
        Records an identification observation for an active track.
        If track has crossed the entry line and achieves k-of-m matching criteria,
        and is not in cooldown, emits an AttendanceCandidateEvent.
        """
        now = current_timestamp if current_timestamp is not None else time.time()

        tid = track.track_id
        if tid not in self._track_observations:
            self._track_observations[tid] = deque(maxlen=self.window_size)

        self._track_observations[tid].append(match)

        # Do not confirm if track already had attendance recorded in this camera session
        if track.is_attendance_recorded:
            return None

        # Verify entry line has been crossed (Directional Entry Validation)
        if not track.has_crossed_entry_line:
            return None

        # Inspect observations in sliding window
        obs_list = list(self._track_observations[tid])
        confirmed_matches = [
            m for m in obs_list if m.is_confident_match and m.student_id is not None
        ]

        if len(confirmed_matches) < self.required_confirmations:
            return None

        # Count occurrences of the dominant student_id
        counts: Dict[str, List[RecognitionMatch]] = {}
        for m in confirmed_matches:
            sid = m.student_id  # type: ignore
            counts.setdefault(sid, []).append(m)

        dominant_sid, dominant_matches = max(
            counts.items(), key=lambda item: len(item[1])
        )

        if len(dominant_matches) < self.required_confirmations:
            return None

        # Check identity cooldown (prevents repeated firing for same student)
        last_recorded = self._identity_cooldowns.get(dominant_sid, 0.0)
        if now - last_recorded < self.identity_cooldown_sec:
            logger.info(
                f"Student {dominant_sid} confirmed for Track #{tid}, but within cooldown ({int(now - last_recorded)}s < {self.identity_cooldown_sec}s). Suppressing duplicate."
            )
            track.is_attendance_recorded = True
            return None

        # Compute average confidence across confirming observations
        avg_confidence = float(
            sum(m.similarity_score for m in dominant_matches)
            / len(dominant_matches)
        )
        sample_match = dominant_matches[0]

        # Mark track and student as recorded
        track.is_attendance_recorded = True
        track.confirmed_identity_id = dominant_sid
        track.confirmed_confidence = avg_confidence
        self._identity_cooldowns[dominant_sid] = now

        logger.info(
            f"MULTI-FRAME CONFIRMED: Student {sample_match.student_name} ({sample_match.roll_number}) "
            f"on Track #{tid} with {len(dominant_matches)}/{len(obs_list)} frames (conf: {avg_confidence:.3f})"
        )

        dt_event = datetime.fromtimestamp(now, tz=timezone.utc)
        return AttendanceCandidateEvent(
            student_id=dominant_sid,
            roll_number=sample_match.roll_number or "",
            student_name=sample_match.student_name or "",
            confidence=avg_confidence,
            track_id=tid,
            crossing_timestamp=dt_event,
            camera_id=camera_id,
            is_suspicious_liveness=False,
            metadata={
                "confirming_frames_count": len(dominant_matches),
                "window_size": len(obs_list),
                "margin": sample_match.margin,
            },
        )

    def prune_stale_tracks(self, active_track_ids: List[int]) -> None:
        """Removes observations for tracks that have terminated."""
        active_set = set(active_track_ids)
        stale_tids = [
            tid for tid in self._track_observations if tid not in active_set
        ]
        for tid in stale_tids:
            del self._track_observations[tid]

    def clear_cooldown(self, student_id: str) -> None:
        """Manually reset cooldown for a student."""
        if student_id in self._identity_cooldowns:
            del self._identity_cooldowns[student_id]

