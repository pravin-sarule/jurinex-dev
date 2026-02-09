"""State management for the orchestrator."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class DocumentState:
    """Single source of truth for document lifecycle state."""

    ingested: bool = False
    embedded: bool = False
    drafted: bool = False
    validated: bool = False
    completed: bool = False

    raw_text: Optional[str] = None
    file_id: Optional[str] = None  # Set by ingestion; used to link uploaded file to draft
    chunks: List[str] = field(default_factory=list)
    embeddings: List[List[float]] = field(default_factory=list)
    draft: Optional[str] = None
    validation_issues: List[str] = field(default_factory=list)
    final_document: Optional[str] = None

    def snapshot(self) -> Dict[str, Any]:
        """Return a serializable snapshot for debugging and logging."""
        return {
            "flags": {
                "ingested": self.ingested,
                "embedded": self.embedded,
                "drafted": self.drafted,
                "validated": self.validated,
                "completed": self.completed,
            },
            "raw_text": self.raw_text,
            "file_id": self.file_id,
            "chunks_count": len(self.chunks),
            "embeddings_count": len(self.embeddings),
            "draft_present": self.draft is not None,
            "validation_issues": list(self.validation_issues),
            "final_document_present": self.final_document is not None,
        }


class StateManager:
    """Encapsulates safe updates to document state."""

    def __init__(self) -> None:
        self._state = DocumentState()

    @property
    def state(self) -> DocumentState:
        return self._state

    def set_ingestion(self, raw_text: str, file_id: Optional[str] = None) -> None:
        self._state.raw_text = raw_text
        if file_id is not None:
            self._state.file_id = str(file_id)
        self._state.ingested = True

    def set_embeddings(self, chunks: List[str], embeddings: List[List[float]]) -> None:
        self._state.chunks = chunks
        self._state.embeddings = embeddings
        self._state.embedded = True

    def set_draft(self, draft: str) -> None:
        self._state.draft = draft
        self._state.drafted = True

    def set_validation(self, issues: List[str]) -> None:
        self._state.validation_issues = issues
        self._state.validated = len(issues) == 0

    def set_final_document(self, document: str) -> None:
        self._state.final_document = document
        self._state.completed = True

    def reset_validation(self) -> None:
        """Clear validation state before re-drafting."""
        self._state.validation_issues = []
        self._state.validated = False
