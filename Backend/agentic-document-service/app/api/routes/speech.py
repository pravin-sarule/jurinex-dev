"""
Speech-to-text for microphone input (Google Cloud STT — not LLM transcription).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core.config import get_settings
from app.services.adapters.speech_to_text import transcribe_audio_bytes

router = APIRouter(tags=["speech"])
logger = logging.getLogger("agentic_document_service.speech")

_MAX_BYTES = 10 * 1024 * 1024  # sync STT limit


@router.post("/api/v1/speech/transcribe")
async def transcribe_microphone_audio(
    file: UploadFile = File(..., description="Recorded audio (webm, wav, mp3, etc.)"),
) -> dict[str, str]:
    """
    Transcribe a short microphone recording using Google Cloud Speech-to-Text.
    Returns the user's spoken words verbatim for editing before chat submit.
    """
    settings = get_settings()
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio payload.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio exceeds {_MAX_BYTES // (1024 * 1024)} MB sync limit.",
        )

    mime = (file.content_type or "audio/webm").split(";")[0].strip().lower()
    lang = (settings.speech_to_text_language_code or "en-IN").strip()
    alt = (settings.speech_to_text_alternative_language_code or "hi-IN").strip()
    alts = [alt] if alt and alt != lang else None

    try:
        text = transcribe_audio_bytes(
            raw,
            mime,
            language_code=lang,
            alternative_language_codes=alts,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Microphone transcription failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Speech recognition is temporarily unavailable.",
        ) from exc

    transcript = (text or "").strip()
    if not transcript:
        raise HTTPException(
            status_code=422,
            detail="No speech detected. Please try again.",
        )

    logger.info("Microphone transcribed %d bytes → %d chars", len(raw), len(transcript))
    return {"transcript": transcript}
