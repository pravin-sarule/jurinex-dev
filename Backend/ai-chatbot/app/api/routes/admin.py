"""
Admin endpoints for reading and updating chatbot_config at runtime.
Changes take effect immediately (config cache is invalidated on update).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.models import ConfigResponse, ConfigUpdateRequest
from app.services.chatbot import invalidate_config_cache, load_chatbot_config
from app.services.db import get_db_connection, is_db_available

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/config", response_model=ConfigResponse, summary="Get active chatbot config")
def get_config() -> ConfigResponse:
    cfg = load_chatbot_config()
    return ConfigResponse(
        config_key="default",
        model_text=cfg.model_text,
        model_audio=cfg.model_audio,
        max_tokens=cfg.max_tokens,
        temperature=cfg.temperature,
        top_p=cfg.top_p,
        top_k_results=cfg.top_k_results,
        voice_name=cfg.voice_name,
        language_code=cfg.language_code,
        speaking_rate=cfg.speaking_rate,
        pitch=cfg.pitch,
        volume_gain_db=cfg.volume_gain_db,
        system_prompt=cfg.system_prompt,
        audio_system_prompt=cfg.audio_system_prompt,
    )


@router.put("/config", response_model=ConfigResponse, summary="Update chatbot config")
def update_config(request: ConfigUpdateRequest) -> ConfigResponse:
    if not is_db_available():
        raise HTTPException(status_code=503, detail="Database not available")

    updates = {k: v for k, v in request.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided to update")

    set_clause = ", ".join(f"{col} = %s" for col in updates)
    values = list(updates.values())

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE chatbot_config SET {set_clause}, updated_at = NOW() "
                f"WHERE config_key = 'default'",
                values,
            )
        conn.commit()

    invalidate_config_cache()
    return get_config()
