from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import tempfile
import uuid
from collections.abc import AsyncIterator
from typing import Any

from app.core.config import get_settings
from app.services.gcs_service import mime_from_path
from app.services.llm_config_service import resolve_vertex_model_id
from app.services.llm_usage_service import log_llm_usage

logger = logging.getLogger(__name__)

# Aliases: DB-stored legacy names → canonical Vertex model names
_MODEL_ALIASES: dict[str, str] = {
    "gemini-pro-2.5": "gemini-2.5-pro",
    "gemini-flash-2.5": "gemini-2.5-flash",
    "gemini-flash-lite-2.5": "gemini-2.5-flash-lite",
    "gemini-pro-latest": "gemini-2.5-flash",
    "gemini-pro": "gemini-2.5-flash",
    "gemini-flash-lite": "gemini-2.5-flash-lite",
    # versioned aliases that don't exist in the API — normalize to the stable name
    "gemini-2.5-flash-001": "gemini-2.5-flash",
    "gemini-2.0-flash-001": "gemini-2.0-flash",
    "gemini-2.0-flash-lite-001": "gemini-2.0-flash-lite",
}

MODEL_FALLBACKS: dict[str, list[str]] = {
    "gemini-flash-lite-latest": ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash-lite"],
    "gemini-flash-lite": ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash-lite"],
    "gemini-pro-latest": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-pro": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.0-flash-lite": ["gemini-2.0-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash"],
    "gemini-2.0-flash-lite-001": ["gemini-2.0-flash-lite", "gemini-2.5-flash-lite", "gemini-2.5-flash"],
    "gemini-2.0-flash": ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.0-flash-001": ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.5-flash-lite": ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
    "gemini-2.5-flash": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.5-flash-001": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
    "gemini-2.5-pro": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
}

_genai_client = None
_vertex_genai_client = None
_adk_adc_file: str | None = None


def _get_client():
    global _genai_client
    if _genai_client is not None:
        return _genai_client
    from google import genai

    settings = get_settings()
    if settings.gemini_api_key:
        _genai_client = genai.Client(api_key=settings.gemini_api_key)
    else:
        _genai_client = genai.Client(
            vertexai=True,
            project=settings.gcloud_project_id,
            location=settings.gcp_location,
        )
    return _genai_client


def _get_vertex_client():
    """Vertex client for gs:// file parts (API key cannot read private GCS URIs)."""
    global _vertex_genai_client
    if _vertex_genai_client is not None:
        return _vertex_genai_client
    from google import genai

    from app.services.gcs_service import get_service_account_credentials

    settings = get_settings()
    project = (settings.gcloud_project_id or "").strip()
    if not project:
        raise RuntimeError("GCLOUD_PROJECT_ID is required for GCS-backed Gemini calls")
    kwargs: dict[str, Any] = {
        "vertexai": True,
        "project": project,
        "location": settings.gcp_location,
    }
    creds = get_service_account_credentials()
    if creds is not None:
        kwargs["credentials"] = creds
    _vertex_genai_client = genai.Client(**kwargs)
    return _vertex_genai_client


def _ensure_adk_google_client_env() -> None:
    """Expose existing service credentials in the env shape ADK's GoogleLLM reads."""
    global _adk_adc_file
    settings = get_settings()

    if settings.gemini_api_key:
        os.environ.setdefault("GEMINI_API_KEY", settings.gemini_api_key)
        return

    project = (settings.gcloud_project_id or "").strip()
    if not project:
        return

    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "true")
    os.environ.setdefault("GOOGLE_CLOUD_PROJECT", project)
    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", settings.gcp_location or "us-central1")

    if settings.gcs_key_base64 and not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        if _adk_adc_file is None:
            try:
                decoded = base64.b64decode(settings.gcs_key_base64).decode("utf-8")
                json.loads(decoded)
                fd, path = tempfile.mkstemp(prefix="adk-google-adc-", suffix=".json")
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    f.write(decoded)
                _adk_adc_file = path
            except Exception as exc:
                logger.warning("Could not prepare ADK Google credentials file: %s", exc)
        if _adk_adc_file:
            os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", _adk_adc_file)


def _normalize_model(name: str) -> str:
    stripped = name.strip().removeprefix("models/")
    key = stripped.lower()
    return _MODEL_ALIASES.get(key, _MODEL_ALIASES.get(stripped, stripped))


def build_model_list(llm_config: dict[str, Any], override: str | None = None) -> list[str]:
    raw_primary = (
        override
        or resolve_vertex_model_id(llm_config)
        or llm_config.get("llm_model")
        or get_settings().adk_model
        or "gemini-2.5-pro"
    ).strip()
    primary = _normalize_model(raw_primary)
    seen: set[str] = set()
    result: list[str] = []

    def _add(m: str) -> None:
        n = _normalize_model(m)
        if n and n not in seen:
            seen.add(n)
            result.append(n)

    _add(primary)
    for m in MODEL_FALLBACKS.get(primary, MODEL_FALLBACKS.get(primary.lower(), [])):
        _add(m)
    # Always have safe fallbacks at the end
    _add("gemini-2.5-flash-lite")
    _add("gemini-2.5-flash")
    return result


def _build_generation_config(llm_config: dict[str, Any]) -> dict[str, Any]:
    cap = int(llm_config.get("max_output_tokens_cap") or 65536)
    mot = int(llm_config.get("max_output_tokens") or 65536)
    return {
        "max_output_tokens": min(max(1, mot), cap),
        "temperature": float(llm_config.get("model_temperature") or 0.7),
    }


def _inline_file_parts(gcs_uris: list[str]) -> list[Any]:
    """Download GCS objects and build inline parts (fallback when Vertex URI fetch fails)."""
    from google.genai import types as gt

    from app.services.gcs_service import download_object_buffer, parse_gcs_uri

    parts = []
    for uri in gcs_uris:
        parsed = parse_gcs_uri(uri)
        if not parsed:
            continue
        bucket, path = parsed
        data = download_object_buffer(bucket, path)
        parts.append(gt.Part.from_bytes(data=data, mime_type=mime_from_path(path)))
    return parts


def _extract_stream_payload(chunk: Any) -> tuple[str, str]:
    answer = ""
    thought = ""
    text_attr = getattr(chunk, "text", None)
    if callable(text_attr):
        try:
            text_attr = text_attr()
        except Exception:
            text_attr = ""
    if isinstance(text_attr, str) and text_attr:
        answer = text_attr

    candidates = getattr(chunk, "candidates", None) or []
    if candidates:
        cand = candidates[0]
        delta = getattr(cand, "delta", None)
        if delta is not None:
            parts = getattr(getattr(delta, "content", None), "parts", None) or []
        else:
            parts = getattr(getattr(cand, "content", None), "parts", None) or []
        for part in parts:
            t = getattr(part, "text", None) or ""
            if getattr(part, "thought", False):
                thought += t
            else:
                answer += t
    return answer, thought


def _aggregate_candidate_text(chunk: Any) -> str:
    answer, thought = _extract_stream_payload(chunk)
    if answer.strip():
        if thought.strip() and len(thought) > len(answer) * 2 and len(thought) > 400:
            return f"{answer}\n\n{thought}"
        return answer
    return thought


def _append_stream_piece(current: str, piece: str) -> tuple[str, str]:
    """Append a stream piece; return (new_full, delta_to_emit). Handles cumulative chunks."""
    if not piece:
        return current, ""
    if not current:
        return piece, piece
    if piece == current:
        return current, ""
    if piece.startswith(current):
        delta = piece[len(current) :]
        return current + delta, delta
    if current.endswith(piece) or piece in current:
        return current, ""
    return current + piece, piece


def _stream_tail_delta(streamed: str, last_chunk: Any) -> tuple[str, str]:
    """Return (full_text, delta) when the final chunk holds text the stream skipped."""
    if last_chunk is None:
        return streamed, ""
    agg = _aggregate_candidate_text(last_chunk)
    if len(agg) <= len(streamed):
        return streamed, ""
    return agg, agg[len(streamed) :]


def _normalize_usage(chunk: Any, streamed_len: int = 0) -> dict[str, Any]:
    um = getattr(chunk, "usage_metadata", None)
    prompt = int(getattr(um, "prompt_token_count", 0) or 0) if um else 0
    candidates = int(getattr(um, "candidates_token_count", 0) or 0) if um else 0
    total = int(getattr(um, "total_token_count", 0) or 0) if um else 0
    if not total and (prompt or candidates):
        total = prompt + candidates
    if not total and streamed_len > 0:
        total = max(1, streamed_len // 4)
        candidates = total
    finish = None
    cands = getattr(chunk, "candidates", None)
    if cands:
        finish = getattr(cands[0], "finish_reason", None)
    return {
        "inputTokens": prompt,
        "outputTokens": candidates or total,
        "totalTokens": total or max(1, prompt + candidates),
        "finishReason": str(finish) if finish else None,
        "outputTruncated": str(finish) == "MAX_TOKENS",
    }


async def _stream_sync_iter(sync_iter, metadata: dict[str, Any], endpoint: str) -> AsyncIterator[dict[str, Any]]:
    loop = asyncio.get_event_loop()
    last_chunk = None
    streamed = ""

    def _next():
        try:
            return next(sync_iter)
        except StopIteration:
            return None

    while True:
        chunk = await loop.run_in_executor(None, _next)
        if chunk is None:
            break
        last_chunk = chunk
        answer, thought = _extract_stream_payload(chunk)
        if thought:
            yield {"type": "thought", "text": thought}
        if answer:
            streamed, delta = _append_stream_piece(streamed, answer)
            if delta:
                yield {"type": "chunk", "text": delta}
        elif thought and not streamed.strip():
            streamed, delta = _append_stream_piece(streamed, thought)
            if delta:
                yield {"type": "chunk", "text": delta}
                logger.warning("Stream chunk had only thought text; using as visible answer.")

    streamed, tail = _stream_tail_delta(streamed, last_chunk)
    if tail:
        yield {"type": "chunk", "text": tail}
        logger.warning("Flushed %s chars from final candidate (stream missed tail).", len(tail))

    if last_chunk is not None:
        usage = _normalize_usage(last_chunk, len(streamed))
        usage["modelName"] = metadata.get("modelName")
        if metadata.get("userId"):
            await log_llm_usage(
                user_id=int(metadata["userId"]),
                model_name=usage.get("modelName") or get_settings().adk_model or "gemini-2.5-pro",
                input_tokens=usage["inputTokens"],
                output_tokens=usage["outputTokens"],
                total_tokens=usage["totalTokens"],
                endpoint=endpoint,
                file_id=metadata.get("fileId"),
                session_id=metadata.get("sessionId"),
            )
        yield {"type": "usage", **usage}


async def stream_llm_with_gcs(
    *,
    question: str,
    gcs_uris: list[str],
    llm_config: dict[str, Any],
    system_instruction: str,
    model_name: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream document Q&A with inline GCS file parts (non-cache fallback)."""
    from google.genai import types as gt

    meta = metadata or {}
    file_parts = _inline_file_parts(gcs_uris)
    if not file_parts:
        yield {"type": "error", "message": "Could not load document content for processing"}
        return

    gen_cfg = _build_generation_config(llm_config)
    contents = [gt.Content(role="user", parts=[*file_parts, gt.Part(text=question)])]
    config = gt.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=gen_cfg["temperature"],
        max_output_tokens=gen_cfg["max_output_tokens"],
    )
    client = _get_vertex_client()
    endpoint = meta.get("endpoint", "/api/chat/ask/stream")
    last_err: Exception | None = None

    for model in build_model_list(llm_config, model_name):
        try:
            meta["modelName"] = model

            def _open_stream():
                return client.models.generate_content_stream(model=model, contents=contents, config=config)

            loop = asyncio.get_event_loop()
            sync_iter = await loop.run_in_executor(None, _open_stream)
            async for ev in _stream_sync_iter(sync_iter, meta, endpoint):
                yield ev
            return
        except Exception as exc:
            last_err = exc
            logger.warning("Document model %s failed: %s", model, exc)

    yield {"type": "error", "message": f"All document models failed: {last_err}"}


async def stream_llm_general(
    *,
    prompt_text: str,
    llm_config: dict[str, Any],
    system_instruction: str,
    model_name: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    from google.genai import types as gt

    meta = metadata or {}
    client = _get_client()
    gen_cfg = _build_generation_config(llm_config)
    config = gt.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=gen_cfg["temperature"],
        max_output_tokens=gen_cfg["max_output_tokens"],
    )
    contents = [gt.Content(role="user", parts=[gt.Part(text=prompt_text)])]

    last_err = None
    for model in build_model_list(llm_config, model_name):
        try:
            meta["modelName"] = model
            stream = client.models.generate_content_stream(model=model, contents=contents, config=config)
            async for ev in _stream_sync_iter(
                iter(stream), meta, meta.get("endpoint", "/api/chat/ask/general/stream")
            ):
                yield ev
            return
        except Exception as exc:
            last_err = exc
            logger.warning("General model %s failed: %s", model, exc)
    raise RuntimeError(f"All general models failed: {last_err}")


def _run_count_tokens(client: Any, model: str, parts: list[Any]) -> Any:
    from google.genai import types as gt

    return client.models.count_tokens(model=model, contents=[gt.Content(role="user", parts=parts)])


async def count_tokens_from_gcs(gcs_uris: list[str], model_name: str | None = None) -> dict[str, Any]:
    """Count tokens for GCS files via Vertex (download inline — avoids URI fetch issues)."""
    model = model_name or resolve_vertex_model_id({"llm_model": get_settings().adk_model}) or get_settings().adk_model or "gemini-2.5-pro"
    inline = _inline_file_parts(gcs_uris)
    if not inline:
        return {"totalTokens": 0, "promptTokenCount": 0}

    loop = asyncio.get_event_loop()
    client = _get_vertex_client()
    result = await loop.run_in_executor(None, lambda: _run_count_tokens(client, model, inline))
    total = int(getattr(result, "total_tokens", 0) or getattr(result, "total_token_count", 0) or 0)
    return {"totalTokens": total, "promptTokenCount": total}
