from __future__ import annotations

import threading
from datetime import UTC, datetime
from typing import Any


class CaseDraftService:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._drafts: dict[str, dict[str, Any]] = {}

    def save_draft(self, user_id: str, draft_data: Any, last_step: str | int | None) -> dict[str, Any]:
        with self._lock:
            now = datetime.now(tz=UTC).isoformat()
            self._drafts[user_id] = {
                "user_id": str(user_id),
                "draft_data": draft_data,
                "last_step": last_step,
                "updated_at": now,
                "created_at": self._drafts.get(user_id, {}).get("created_at", now),
            }
            return self._drafts[user_id]

    def get_draft(self, user_id: str) -> dict[str, Any] | None:
        with self._lock:
            draft = self._drafts.get(str(user_id))
            return dict(draft) if draft else None

    def delete_draft(self, user_id: str) -> dict[str, Any]:
        with self._lock:
            existed = self._drafts.pop(str(user_id), None)
        return {"success": True, "deleted": bool(existed)}
