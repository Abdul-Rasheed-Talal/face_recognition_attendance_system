"""
In-Memory Vector Gallery and Cosine Similarity Matching Engine.
Performs vectorized BLAS dot products, ambiguity margin evaluation, and unknown face rejection.
"""

import logging
from typing import Dict, List, Optional, Tuple, Any
import numpy as np

from backend.app.cv.types import RecognitionMatch

logger = logging.getLogger(__name__)


class StudentTemplate:
    """Enrolled student metadata and precomputed normalized embedding."""
    def __init__(self, student_id: str, roll_number: str, full_name: str, embedding: np.ndarray):
        self.student_id = student_id
        self.roll_number = roll_number
        self.full_name = full_name
        self.embedding = embedding.flatten().astype(np.float32)
        norm = np.linalg.norm(self.embedding)
        if norm > 1e-6:
            self.embedding /= norm


class FaceMatcher:
    """
    In-memory gallery matcher.
    Maintains a contiguous matrix of enrolled student embeddings for sub-millisecond search.
    """

    def __init__(
        self,
        similarity_threshold: float = 0.363,  # Official SFace cosine threshold
        ambiguity_margin: float = 0.080,      # Required separation between 1st and 2nd best matches
    ):
        self.similarity_threshold = similarity_threshold
        self.ambiguity_margin = ambiguity_margin

        self._templates: Dict[str, StudentTemplate] = {}
        self._gallery_ids: List[str] = []
        self._gallery_matrix: Optional[np.ndarray] = None  # Shape: (N, 128)

    @property
    def enrolled_count(self) -> int:
        return len(self._templates)

    def enroll_student(self, student_id: str, roll_number: str, full_name: str, embedding: np.ndarray) -> None:
        """Enrolls or updates a student's facial template in the in-memory gallery."""
        template = StudentTemplate(student_id, roll_number, full_name, embedding)
        self._templates[student_id] = template
        self._rebuild_matrix()
        logger.info(f"Enrolled student: {full_name} ({roll_number}). Total gallery size: {len(self._templates)}")

    def remove_student(self, student_id: str) -> bool:
        """Removes a student template from the gallery."""
        if student_id in self._templates:
            del self._templates[student_id]
            self._rebuild_matrix()
            logger.info(f"Removed student ID {student_id} from gallery. New size: {len(self._templates)}")
            return True
        return False

    def clear(self) -> None:
        """Clears all enrolled templates."""
        self._templates.clear()
        self._gallery_ids.clear()
        self._gallery_matrix = None

    def _rebuild_matrix(self) -> None:
        """Reconstructs the contiguous NumPy matrix for vectorized BLAS search."""
        if not self._templates:
            self._gallery_ids = []
            self._gallery_matrix = None
            return

        self._gallery_ids = list(self._templates.keys())
        embeddings = [self._templates[sid].embedding for sid in self._gallery_ids]
        self._gallery_matrix = np.vstack(embeddings).astype(np.float32)

    def match(self, probe_embedding: np.ndarray) -> RecognitionMatch:
        """
        Matches a probe embedding against the enrolled gallery.
        Returns a structured RecognitionMatch with status CONFIRMED, AMBIGUOUS, or UNKNOWN.
        """
        if self._gallery_matrix is None or len(self._gallery_ids) == 0:
            return RecognitionMatch(
                student_id=None,
                student_name=None,
                roll_number=None,
                similarity_score=0.0,
                status_label="NO_ENROLLED_STUDENTS"
            )

        probe = probe_embedding.flatten().astype(np.float32)
        norm = np.linalg.norm(probe)
        if norm > 1e-6:
            probe /= norm

        # Vectorized cosine similarity dot-product: (N, 128) • (128,) -> (N,)
        similarities = np.dot(self._gallery_matrix, probe)

        # Sort top indices
        if len(similarities) == 1:
            best_idx = 0
            best_score = float(similarities[0])
            second_score = 0.0
            margin = best_score
        else:
            sorted_indices = np.argsort(similarities)[::-1]
            best_idx = int(sorted_indices[0])
            second_idx = int(sorted_indices[1])
            best_score = float(similarities[best_idx])
            second_score = float(similarities[second_idx])
            margin = best_score - second_score

        best_student_id = self._gallery_ids[best_idx]
        template = self._templates[best_student_id]

        # Decision boundaries
        if best_score < self.similarity_threshold:
            return RecognitionMatch(
                student_id=None,
                student_name=None,
                roll_number=None,
                similarity_score=best_score,
                second_best_score=second_score,
                margin=margin,
                is_confident_match=False,
                is_ambiguous=False,
                status_label="UNKNOWN"
            )

        if margin < self.ambiguity_margin:
            return RecognitionMatch(
                student_id=template.student_id,
                student_name=template.full_name,
                roll_number=template.roll_number,
                similarity_score=best_score,
                second_best_score=second_score,
                margin=margin,
                is_confident_match=False,
                is_ambiguous=True,
                status_label="AMBIGUOUS"
            )

        return RecognitionMatch(
            student_id=template.student_id,
            student_name=template.full_name,
            roll_number=template.roll_number,
            similarity_score=best_score,
            second_best_score=second_score,
            margin=margin,
            is_confident_match=True,
            is_ambiguous=False,
            status_label="CONFIRMED"
        )
