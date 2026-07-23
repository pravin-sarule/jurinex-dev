"""Per-request context for the authenticated user (used for shared token pool logging)."""
from __future__ import annotations

import contextvars

current_user_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_user_id", default=None
)

# Free-tier model override (e.g. a DeepSeek model id) decided centrally by
# payment-service and threaded in by the payment-token middleware. None for paid
# users, in which case every LLM call keeps its configured Gemini/Claude model.
current_model_override: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_model_override", default=None
)
