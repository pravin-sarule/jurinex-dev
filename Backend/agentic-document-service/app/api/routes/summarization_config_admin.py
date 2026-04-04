"""Admin hooks for summarization_chat_config cache (pick up DB edits immediately)."""
from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, status

from app.core.config import get_settings
from app.services.llm_chat_config import invalidate_summarization_chat_config_cache

router = APIRouter(tags=["summarization-config"])


@router.post(
    "/api/admin/summarization-chat-config/invalidate-cache",
    summary="Drop cached summarization_chat_config (and model catalog) so the next request reloads from DB",
)
def post_invalidate_summarization_config_cache(
    x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> dict[str, bool | str]:
    settings = get_settings()
    expected = (settings.summarization_config_admin_key or "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Endpoint disabled (set SUMMARIZATION_CONFIG_ADMIN_KEY to enable).",
        )
    got = (x_admin_key or "").strip()
    if got != expected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid admin key.")
    invalidate_summarization_chat_config_cache()
    return {"ok": True, "message": "summarization_chat_config cache cleared"}
