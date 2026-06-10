"""Per-request context for the authenticated user (used for shared token pool logging)."""
from __future__ import annotations

import contextvars

current_user_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_user_id", default=None
)
