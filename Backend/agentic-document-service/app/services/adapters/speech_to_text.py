"""
Google Cloud Speech-to-Text adapter.

**Primary path — Speech-to-Text v2** (``google.cloud.speech_v2``):
- ``batch_recognize`` for ``gs://`` audio (long files, up to multi-hour jobs).
- Implicit recognizer ``projects/{project}/locations/{location}/recognizers/_``
  (``SPEECH_RECOGNIZER_LOCATION``, default ``us-central1`` — Chirp is not available at ``global``).
- Model from ``SPEECH_V2_MODEL`` (default ``chirp``).
- Speaker diarization, automatic punctuation, ``en-IN`` + ``hi-IN``.

**Fallback — v1** (``google.cloud.speech``): ``long_running_recognize`` /
``recognize`` with ``latest_long`` / ``latest_short`` if v2 is disabled or fails.

Rate-limit: semaphore on *submissions* only; LRO wait does not hold a slot.
"""
from __future__ import annotations

import base64
import json
import logging
import random
import re
import threading
import time
from typing import Any

logger = logging.getLogger("agentic_document_service.speech_to_text")

# ── MIME-type helpers ────────────────────────────────────────────────────────

AUDIO_MIME_TYPES: dict[str, str] = {
    "audio/wav": "LINEAR16",
    "audio/x-wav": "LINEAR16",
    "audio/wave": "LINEAR16",
    "audio/flac": "FLAC",
    "audio/x-flac": "FLAC",
    "audio/mp3": "MP3",
    "audio/mpeg": "MP3",
    "audio/ogg": "OGG_OPUS",
    "audio/ogg; codecs=opus": "OGG_OPUS",
    "audio/webm": "WEBM_OPUS",
    "audio/webm; codecs=opus": "WEBM_OPUS",
    "audio/mp4": "MP4_AUDIO",
    "audio/x-m4a": "MP4_AUDIO",
    "audio/m4a": "MP4_AUDIO",
    "video/mp4": "MP4_AUDIO",
    "video/webm": "WEBM_OPUS",
    "video/quicktime": "MP4_AUDIO",
    "video/x-msvideo": "MP3",
    "video/mpeg": "MP3",
    "video/mp2t": "MP3",
    "audio/aac": "MP3",
    "audio/amr": "AMR",
    "audio/amr-wb": "AMR_WB",
}

AUDIO_EXTENSIONS: set[str] = {
    ".wav", ".wave", ".flac", ".mp3", ".ogg", ".opus",
    ".webm", ".mp4", ".m4a", ".aac", ".amr", ".mov", ".avi", ".mpeg", ".mpg", ".ts",
}

GEMINI_PRIMARY_AUDIO_MIME_TYPES: set[str] = {
    "audio/wav",
    "audio/mp3",
    "audio/aac",
    "audio/flac",
    "audio/ogg",
    "audio/mpeg",
}

_SYNC_SIZE_LIMIT = 10 * 1024 * 1024  # 10 MB


def is_audio_mime(mime_type: str) -> bool:
    if not mime_type:
        return False
    return mime_type.lower().split(";")[0].strip() in AUDIO_MIME_TYPES


def is_audio_filename(filename: str) -> bool:
    if not filename:
        return False
    import os
    return os.path.splitext(filename.lower())[1] in AUDIO_EXTENSIONS


def _encoding_for_mime(mime_type: str) -> str:
    raw = mime_type.lower().split(";")[0].strip()
    return AUDIO_MIME_TYPES.get(raw, "ENCODING_UNSPECIFIED")


def resolve_media_mime_type(mime_type: str | None, filename: str | None = None) -> str:
    raw = str(mime_type or "").lower().split(";")[0].strip()
    if raw in AUDIO_MIME_TYPES:
        return raw

    import os

    ext = os.path.splitext(str(filename or "").lower())[1]
    by_ext = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".wave": "audio/wav",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg",
        ".webm": "video/webm",
        ".mp4": "video/mp4",
        ".m4a": "audio/m4a",
        ".aac": "audio/aac",
        ".amr": "audio/amr",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".mpeg": "video/mpeg",
        ".mpg": "video/mpeg",
        ".ts": "video/mp2t",
    }
    return by_ext.get(ext, raw or "application/octet-stream")


def is_gemini_primary_audio_mime(mime_type: str | None, filename: str | None = None) -> bool:
    raw = resolve_media_mime_type(mime_type, filename)
    return raw in GEMINI_PRIMARY_AUDIO_MIME_TYPES


# ── Rate-limit guard ─────────────────────────────────────────────────────────

def _build_semaphore() -> threading.Semaphore:
    import os
    try:
        n = int(os.environ.get("STT_MAX_CONCURRENT", "3"))
    except ValueError:
        n = 3
    return threading.Semaphore(max(1, n))


# One semaphore per process — gates concurrent STT *submissions* only.
_STT_SEMAPHORE: threading.Semaphore = _build_semaphore()

_MAX_RETRIES = 5
_BASE_DELAY_S = 2.0
_MAX_DELAY_S = 60.0


def _submit_with_retry(fn: Any, *args: Any, **kwargs: Any) -> Any:
    """
    Call fn() under the STT semaphore with exponential back-off on
    ResourceExhausted / ServiceUnavailable.

    Acquires the semaphore, attempts the call, and retries (outside the
    semaphore) when the API signals rate-limit or transient failure.
    The semaphore is released before the sleep so other threads can proceed.
    """
    from google.api_core.exceptions import ResourceExhausted, ServiceUnavailable  # type: ignore

    delay = _BASE_DELAY_S
    for attempt in range(1, _MAX_RETRIES + 1):
        _STT_SEMAPHORE.acquire()
        try:
            return fn(*args, **kwargs)
        except (ResourceExhausted, ServiceUnavailable) as exc:
            _STT_SEMAPHORE.release()
            if attempt == _MAX_RETRIES:
                logger.error(
                    "[SpeechToText] Rate limit hit — max retries (%d) exceeded: %s",
                    _MAX_RETRIES, exc,
                )
                raise
            jitter = random.uniform(0, delay * 0.3)
            wait = min(delay + jitter, _MAX_DELAY_S)
            logger.warning(
                "[SpeechToText] Rate limited (attempt %d/%d) — retrying in %.1fs: %s",
                attempt, _MAX_RETRIES, wait, exc,
            )
            time.sleep(wait)
            delay = min(delay * 2, _MAX_DELAY_S)
        except Exception:
            _STT_SEMAPHORE.release()
            raise
        else:
            _STT_SEMAPHORE.release()


# ── Credentials ──────────────────────────────────────────────────────────────

_SPEECH_SCOPE = "https://www.googleapis.com/auth/cloud-platform"


def _load_credentials() -> Any:
    """Return Google credentials (service account or ADC)."""
    from google.oauth2 import service_account  # type: ignore

    from app.core.config import get_settings

    settings = get_settings()
    key_b64 = settings.gcs_key_base64
    if key_b64:
        try:
            key_json = base64.b64decode(key_b64).decode("utf-8")
            creds_dict = json.loads(key_json)
            return service_account.Credentials.from_service_account_info(
                creds_dict,
                scopes=[_SPEECH_SCOPE],
            )
        except Exception as exc:
            logger.warning("[SpeechToText] Service account load failed: %s", exc)

    try:
        import google.auth  # type: ignore

        credentials, _ = google.auth.default(scopes=[_SPEECH_SCOPE])
        return credentials
    except Exception as exc:
        raise RuntimeError(
            "Speech-to-Text requires GCS_KEY_BASE64 with a service account JSON, "
            "or Application Default Credentials."
        ) from exc


def _make_client() -> Any:
    """Return a google.cloud.speech.SpeechClient (v1)."""
    from google.cloud import speech  # type: ignore

    credentials = _load_credentials()
    return speech.SpeechClient(credentials=credentials)


def _speech_v2_endpoint_for_location(location: str) -> str | None:
    """Non-global locations must use a regional Speech v2 endpoint."""
    loc = (location or "global").strip().lower()
    if not loc or loc == "global":
        return None
    return f"{loc}-speech.googleapis.com"


def _effective_v2_recognizer_location(settings: Any) -> str:
    """
    Chirp-class models are not available at ``global``. Default region for Chirp is
    ``us-central1`` (GA). Override with ``SPEECH_RECOGNIZER_LOCATION``.
    """
    loc = (getattr(settings, "speech_recognizer_location", None) or "us-central1").strip()
    model = (getattr(settings, "speech_v2_model", None) or "chirp_2").strip().lower()
    if loc.lower() == "global" and (not model or model.startswith("chirp")):
        logger.info(
            "[SpeechToText] Chirp models are not available at location 'global'; "
            "using us-central1. Set SPEECH_RECOGNIZER_LOCATION to override.",
        )
        return "us-central1"
    return loc or "us-central1"


def _v2_batch_model_location_attempts(settings: Any) -> list[tuple[str, str]]:
    """
    Ordered (model, location) pairs for batch_recognize. User settings first, then fallbacks
    when API returns *model does not exist in location*.
    """
    user_model = (getattr(settings, "speech_v2_model", None) or "chirp_2").strip() or "chirp_2"
    user_loc = _effective_v2_recognizer_location(settings)
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []

    def add(m: str, loc: str) -> None:
        key = (m.strip(), loc.strip())
        if key not in seen:
            seen.add(key)
            out.append(key)

    add(user_model, user_loc)
    for m, loc in (
        ("chirp_2", "us-central1"),
        ("chirp_3", "us-central1"),
        ("chirp_2", "europe-west4"),
    ):
        add(m, loc)
    return out


def _is_v2_model_location_retryable(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "invalid_argument" in msg or "400" in msg


def _is_recognizer_not_found(exc: BaseException) -> bool:
    """
    Return True when GCP cannot find the named recognizer (404 / NOT_FOUND).

    This distinguishes a missing recognizer (permanent, switch to implicit ``_``)
    from a rate-limit or transient error (should be retried, not fallen back from).
    """
    msg = str(exc).lower()
    return (
        "404" in msg
        or "not found" in msg
        or "recognizer not found" in msg
        or "resource not found" in msg
    )


def _effective_v2_recognizer_id(settings: Any) -> str:
    """Return the configured named recognizer ID, or empty string for implicit wildcard."""
    return (getattr(settings, "speech_v2_recognizer_id", None) or "").strip()


def _make_client_v2(*, location: str | None = None) -> Any:
    """Return a google.cloud.speech_v2.SpeechClient (regional endpoint when needed)."""
    from google.api_core import client_options as client_options_lib  # type: ignore
    from google.cloud.speech_v2 import SpeechClient  # type: ignore

    from app.core.config import get_settings

    loc = (location or _effective_v2_recognizer_location(get_settings())).strip()
    endpoint = _speech_v2_endpoint_for_location(loc)
    credentials = _load_credentials()
    if endpoint:
        opts = client_options_lib.ClientOptions(api_endpoint=endpoint)
        return SpeechClient(credentials=credentials, client_options=opts)
    return SpeechClient(credentials=credentials)


def _v2_language_codes(
    language_code: str,
    alternative_language_codes: list[str] | None,
    *,
    alt_default: str,
) -> list[str]:
    """Primary first, then alternatives (BCP-47), no duplicates."""
    primary = (language_code or "en-IN").strip() or "en-IN"
    alts = (
        [x.strip() for x in alternative_language_codes if x and x.strip() != primary]
        if alternative_language_codes is not None
        else []
    )
    if not alts and alt_default and alt_default.strip() != primary:
        alts = [alt_default.strip()]
    out: list[str] = [primary]
    for a in alts:
        if a not in out:
            out.append(a)
    return out


def _build_v2_recognition_config(
    cs: Any,
    *,
    model: str,
    language_codes: list[str],
) -> Any:
    """RecognitionConfig for Chirp batch/sync with diarization + punctuation."""
    return cs.RecognitionConfig(
        auto_decoding_config=cs.AutoDetectDecodingConfig(),
        model=model,
        language_codes=language_codes,
        features=cs.RecognitionFeatures(
            enable_automatic_punctuation=True,
            enable_word_time_offsets=True,
            diarization_config=cs.SpeakerDiarizationConfig(
                min_speaker_count=2,
                max_speaker_count=8,
            ),
        ),
    )


def _format_v2_words(words: list[Any]) -> str:
    """Join WordInfo list with speaker_label (v2) into labelled lines."""
    lines: list[str] = []
    current_speaker: str | None = None
    buf: list[str] = []

    for w in words:
        label = (getattr(w, "speaker_label", None) or "").strip() or "?"
        word = (getattr(w, "word", "") or "").strip()
        if not word:
            continue
        if current_speaker is None:
            current_speaker = label
            buf = [word]
        elif label != current_speaker:
            lines.append(f"[Speaker {current_speaker}]: {' '.join(buf)}")
            current_speaker = label
            buf = [word]
        else:
            buf.append(word)

    if buf and current_speaker is not None:
        lines.append(f"[Speaker {current_speaker}]: {' '.join(buf)}")

    return "\n\n".join(lines)


def _transcript_from_v2_speech_results(results: list[Any]) -> str:
    """Flatten SpeechRecognitionResult list (v2 Recognize / batch inline)."""
    chunks: list[str] = []
    for res in results:
        alts = list(getattr(res, "alternatives", None) or [])
        if not alts:
            continue
        top = alts[0]
        words = list(getattr(top, "words", None) or [])
        if words:
            formatted = _format_v2_words(words)
            if formatted.strip():
                chunks.append(formatted.strip())
                continue
        tr = (getattr(top, "transcript", None) or "").strip()
        if tr:
            chunks.append(tr)
    return "\n\n".join(chunks).strip()


def _transcript_from_v2_batch_response(response: Any) -> str:
    """Parse BatchRecognizeResponse from batch_recognize LRO."""
    if response is None:
        return ""
    results_map = getattr(response, "results", None) or {}
    if not results_map:
        return ""
    parts: list[str] = []
    for _uri, file_result in results_map.items():
        err = getattr(file_result, "error", None)
        if err is not None and int(getattr(err, "code", 0) or 0) != 0:
            msg = getattr(err, "message", "") or str(err)
            logger.warning("[SpeechToText] v2 batch file error: %s", msg[:500])
            continue
        inline = getattr(file_result, "inline_result", None)
        transcript_container = None
        if inline is not None:
            transcript_container = getattr(inline, "transcript", None)
        if transcript_container is None:
            transcript_container = getattr(file_result, "transcript", None)
        if transcript_container is None:
            continue
        inner = list(getattr(transcript_container, "results", None) or [])
        text = _transcript_from_v2_speech_results(inner)
        if text:
            parts.append(text)
    return "\n\n".join(parts).strip()


def _build_recognition_config(
    speech_module: Any,
    *,
    encoding_name: str,
    language_code: str,
    alts: list[str],
    model: str,
    sample_rate_hertz: int | None = None,
) -> Any:
    """Build a RecognitionConfig proto, optionally with sample rate."""
    kwargs: dict[str, Any] = dict(
        encoding=getattr(
            speech_module.RecognitionConfig.AudioEncoding,
            encoding_name,
            speech_module.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED,
        ),
        language_code=language_code,
        alternative_language_codes=alts,
        enable_automatic_punctuation=True,
        model=model,
        use_enhanced=False,
        enable_word_time_offsets=True,
        diarization_config=speech_module.SpeakerDiarizationConfig(
            enable_speaker_diarization=True,
            min_speaker_count=2,
            max_speaker_count=6,
        ),
    )
    if sample_rate_hertz:
        kwargs["sample_rate_hertz"] = sample_rate_hertz
    return speech_module.RecognitionConfig(**kwargs)


# ── Transcript formatting ────────────────────────────────────────────────────

def _format_with_diarization(result: Any) -> str:
    """Build a speaker-labelled transcript from the last result's words."""
    words = getattr(result, "words", None) or []
    if not words:
        alts = getattr(result, "alternatives", [])
        return alts[0].transcript.strip() if alts else ""

    lines: list[str] = []
    current_speaker: str | None = None
    buf: list[str] = []

    for w in words:
        label = str(getattr(w, "speaker_tag", "") or "?")
        word = (getattr(w, "word", "") or "").strip()
        if not word:
            continue
        if current_speaker is None:
            current_speaker = label
            buf = [word]
        elif label != current_speaker:
            lines.append(f"[Speaker {current_speaker}]: {' '.join(buf)}")
            current_speaker = label
            buf = [word]
        else:
            buf.append(word)

    if buf and current_speaker is not None:
        lines.append(f"[Speaker {current_speaker}]: {' '.join(buf)}")

    return "\n\n".join(lines)


def _transcript_from_response(response: Any) -> str:
    """Extract full transcript from a v1 RecognizeResponse / LRO result."""
    results = list(response.results or [])
    if not results:
        return ""

    # Diarization info lives on the *last* result in v1
    diarized = _format_with_diarization(results[-1])
    if diarized:
        return diarized

    # Fallback: concatenate top alternatives across all results
    chunks: list[str] = []
    for res in results:
        alts = list(getattr(res, "alternatives", []))
        if alts and (alts[0].transcript or "").strip():
            chunks.append(alts[0].transcript.strip())
    return "\n\n".join(chunks)


_SPEAKER_LINE_RE = re.compile(
    r"^\s*(?:\[\s*)?(speaker)\s*([0-9A-Za-z_-]+)(?:\s*\])?\s*[:\-]\s*(.+?)\s*$",
    re.IGNORECASE,
)


def _normalize_speaker_labels(text: str) -> str:
    """
    Normalize common speaker label variants into:
    ``[Speaker N]: utterance``.

    This keeps downstream retrieval and QA speaker-diarization behavior stable
    across STT and Gemini transcription paths.
    """
    raw = (text or "").strip()
    if not raw:
        return ""
    out_lines: list[str] = []
    for line in raw.splitlines():
        match = _SPEAKER_LINE_RE.match(line)
        if not match:
            out_lines.append(line.rstrip())
            continue
        speaker_id = match.group(2).strip()
        utterance = match.group(3).strip()
        out_lines.append(f"[Speaker {speaker_id}]: {utterance}")
    return "\n".join(out_lines).strip()


# ── Core transcription functions ─────────────────────────────────────────────

def transcribe_audio_bytes(
    audio_bytes: bytes,
    mime_type: str,
    *,
    sample_rate_hertz: int | None = None,
    language_code: str = "en-IN",
    alternative_language_codes: list[str] | None = None,
) -> str:
    """
    Transcribe ≤10 MB audio bytes via ``speech:recognize`` (latest_short).

    Rate-limited: acquires the global STT semaphore and retries on 429/503.
    """
    from google.cloud import speech  # type: ignore
    from app.core.config import get_settings

    if len(audio_bytes) > _SYNC_SIZE_LIMIT:
        raise ValueError(
            f"Audio payload {len(audio_bytes)} bytes exceeds the 10 MB sync limit. "
            "Use transcribe_audio_from_gcs() for large files."
        )

    settings = get_settings()
    if getattr(settings, "speech_use_v2", True) and (settings.google_cloud_project or "").strip():
        try:
            return transcribe_bytes_v2(
                audio_bytes,
                mime_type,
                language_code=language_code,
                alternative_language_codes=alternative_language_codes,
            )
        except Exception as exc:
            logger.warning("[SpeechToText] v2 recognize failed — falling back to v1 sync: %s", exc)

    alt = (settings.speech_to_text_alternative_language_code or "hi-IN").strip()
    alts = (
        [x for x in alternative_language_codes if x != language_code]
        if alternative_language_codes is not None
        else ([alt] if alt != language_code else [])
    )

    config = _build_recognition_config(
        speech,
        encoding_name=_encoding_for_mime(mime_type),
        language_code=language_code,
        alts=alts,
        model="latest_short",
        sample_rate_hertz=sample_rate_hertz,
    )
    audio = speech.RecognitionAudio(content=audio_bytes)
    client = _make_client()

    logger.info(
        "[SpeechToText] recognize — %d bytes lang=%s concurrent_slots=%d/%s",
        len(audio_bytes), language_code,
        _STT_SEMAPHORE._value,  # type: ignore[attr-defined]
        _STT_SEMAPHORE._initial_value if hasattr(_STT_SEMAPHORE, "_initial_value") else "?",  # type: ignore[attr-defined]
    )
    response = _submit_with_retry(client.recognize, config=config, audio=audio)
    text = _transcript_from_response(response)
    logger.info("[SpeechToText] recognize done — %d chars", len(text))
    return text


def _poll_lro_progress(
    operation: Any,
    progress_callback: Any,
    stop_event: threading.Event,
    *,
    poll_interval: float = 5.0,
    progress_lo: float = 20.0,
    progress_hi: float = 75.0,
    max_wait_seconds: float = 28800.0,
) -> None:
    """
    Background thread: poll GCP LRO metadata.progress_percent and map it to
    the [progress_lo, progress_hi] display range, then call progress_callback.

    Speech often omits ``progress_percent``; in that case we advance smoothly
    using elapsed time vs *max_wait_seconds* so long jobs do not appear stuck.

    Runs until stop_event is set (set by the main thread after result arrives).
    """
    start = time.monotonic()
    last_gcp = -1
    last_sent = -1.0
    span = max(120.0, float(max_wait_seconds) * 0.92)

    while not stop_event.wait(timeout=poll_interval):
        try:
            meta = operation.metadata
            gcp_pct = int(getattr(meta, "progress_percent", 0) or 0)
            if gcp_pct > 0:
                if gcp_pct != last_gcp:
                    last_gcp = gcp_pct
                    mapped = progress_lo + (gcp_pct / 100.0) * (progress_hi - progress_lo)
                else:
                    continue
            else:
                elapsed = time.monotonic() - start
                frac = min(1.0, elapsed / span)
                mapped = progress_lo + frac * (progress_hi - progress_lo)

            mapped = min(mapped, progress_hi - 0.05)
            if last_sent < 0 or abs(mapped - last_sent) >= 0.25:
                last_sent = mapped
                progress_callback(round(mapped, 1))
                logger.debug(
                    "[SpeechToText] LRO progress gcp=%s → display=%.1f%%",
                    gcp_pct if gcp_pct > 0 else f"time({time.monotonic() - start:.0f}s)",
                    mapped,
                )
        except Exception:
            pass  # metadata may be unavailable transiently — keep polling


def transcribe_bytes_v2(
    audio_bytes: bytes,
    _mime_type: str,
    *,
    language_code: str = "en-IN",
    alternative_language_codes: list[str] | None = None,
) -> str:
    """
    Sync v2 ``recognize`` for small inline payloads (≤ ~10 MB).

    Attempt order
    ─────────────
    1. Named recognizer (``speech_v2_recognizer_id``, e.g. ``chirp-transcriber``)
       at ``us-central1`` using the ``recognize`` RPC.
    2. Fallback: implicit wildcard ``_`` recognizer, iterating over
       ``_v2_batch_model_location_attempts`` pairs so alternative regions/models
       are tried automatically when the primary location lacks the requested model.
    """
    from google.cloud.speech_v2 import SpeechClient  # type: ignore
    from google.cloud.speech_v2.types import cloud_speech as cs  # type: ignore

    from app.core.config import get_settings

    settings = get_settings()
    project = (settings.google_cloud_project or "").strip()
    if not project:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is required for Speech-to-Text v2")

    langs = _v2_language_codes(
        language_code,
        alternative_language_codes,
        alt_default=settings.speech_to_text_alternative_language_code or "hi-IN",
    )

    # ── Phase 1: named recognizer (chirp-transcriber @ us-central1) ──────────
    recognizer_id = _effective_v2_recognizer_id(settings)
    if recognizer_id:
        named_loc = "us-central1"
        named_recognizer = SpeechClient.recognizer_path(project, named_loc, recognizer_id)
        try:
            cfg = _build_v2_recognition_config(cs, model="chirp_2", language_codes=langs)
            client = _make_client_v2(location=named_loc)
            req = cs.RecognizeRequest(
                recognizer=named_recognizer,
                config=cfg,
                content=audio_bytes,
            )
            logger.info(
                "[SpeechToText] v2 recognize (named) recognizer=%s langs=%s bytes=%d",
                named_recognizer,
                langs,
                len(audio_bytes),
            )
            resp = _submit_with_retry(client.recognize, request=req)
            text = _transcript_from_v2_speech_results(list(resp.results or []))
            logger.info(
                "[SpeechToText] v2 recognize (named) done recognizer=%s chars=%d",
                recognizer_id,
                len(text),
            )
            return text
        except Exception as exc:
            if _is_recognizer_not_found(exc):
                logger.warning(
                    "[SpeechToText] Named recognizer '%s' not found (404) — "
                    "falling back to implicit '_' recognizer. "
                    "Create it with: gcloud alpha speech recognizers create %s "
                    "--location=us-central1 --model=chirp_2",
                    recognizer_id,
                    recognizer_id,
                )
            else:
                logger.warning(
                    "[SpeechToText] Named recognizer '%s' failed: %s — "
                    "falling back to implicit '_' recognizer",
                    recognizer_id,
                    exc,
                )

    # ── Phase 2: implicit wildcard recognizer with model/location loop ────────
    last_exc: BaseException | None = None
    for model, loc in _v2_batch_model_location_attempts(settings):
        try:
            cfg = _build_v2_recognition_config(cs, model=model, language_codes=langs)
            recognizer = SpeechClient.recognizer_path(project, loc, "_")
            client = _make_client_v2(location=loc)
            req = cs.RecognizeRequest(recognizer=recognizer, config=cfg, content=audio_bytes)
            resp = _submit_with_retry(client.recognize, request=req)
            return _transcript_from_v2_speech_results(list(resp.results or []))
        except Exception as exc:
            last_exc = exc
            if _is_v2_model_location_retryable(exc):
                logger.warning(
                    "[SpeechToText] v2 recognize (implicit) model=%s location=%s failed: %s",
                    model,
                    loc,
                    exc,
                )
                continue
            raise
    if last_exc:
        raise last_exc
    return ""


def _run_batch_recognize_lro(
    client: Any,
    req: Any,
    *,
    result_timeout: int,
    progress_callback: Any,
    label: str,
) -> Any:
    """
    Submit a ``batch_recognize`` request, start the progress-poll thread, wait
    for the LRO to finish, then signal the UI that transcription is done.

    Returns the raw ``BatchRecognizeResponse``.
    """
    operation = _submit_with_retry(client.batch_recognize, request=req)

    stop_event = threading.Event()
    poll_thread: threading.Thread | None = None
    if progress_callback is not None:
        poll_thread = threading.Thread(
            target=_poll_lro_progress,
            kwargs={
                "operation": operation,
                "progress_callback": progress_callback,
                "stop_event": stop_event,
                "max_wait_seconds": float(result_timeout),
            },
            daemon=True,
            name=f"stt-v2-batch-{label}",
        )
        poll_thread.start()

    try:
        response = operation.result(timeout=result_timeout)
        # Push progress to 75% so the UI exits the "stuck at ~20%" state.
        # Without this, the time-based LRO smoother barely moves for short files
        # (span defaults to 26 496 s; a 60-second file only reaches ~20.1%).
        # folder_service subsequently sets progress to 80% → 100%.
        if progress_callback is not None:
            try:
                progress_callback(75.0)
            except Exception:
                pass
        return response
    finally:
        stop_event.set()
        if poll_thread is not None:
            poll_thread.join(timeout=5)


def transcribe_gcs_v2_batch(
    gs_uri: str,
    *,
    language_code: str = "en-IN",
    alternative_language_codes: list[str] | None = None,
    timeout_seconds: int = 28800,
    progress_callback: Any = None,
    recognition_output_config: Any | None = None,
) -> str:
    """
    Speech-to-Text v2 ``batch_recognize`` for ``gs://`` objects (long audio).

    Attempt order
    ─────────────
    1. **Named recognizer** (``speech_v2_recognizer_id``, default ``chirp-transcriber``)
       at ``us-central1`` using the full resource path:
       ``projects/{project}/locations/us-central1/recognizers/chirp-transcriber``
       This is the GCP-recommended path for pre-provisioned Chirp 2 recognizers
       and matches the recognizer you created in the GCP Console.

    2. **Fallback — implicit ``_`` recognizer** iterating ``_v2_batch_model_location_attempts``
       (chirp_2 → chirp_3, us-central1 → europe-west4).  Activated only when the
       named recognizer returns 404 / NOT_FOUND or another hard failure.

    Both paths use ``operation.result(timeout=result_timeout)`` to wait for the
    LRO and call ``progress_callback(75.0)`` on completion so the UI advances
    past the stuck-at-20% symptom caused by GCP's sparse LRO metadata.
    """
    from google.cloud.speech_v2 import SpeechClient  # type: ignore
    from google.cloud.speech_v2.types import cloud_speech as cs  # type: ignore

    from app.core.config import get_settings

    settings = get_settings()
    project = (settings.google_cloud_project or "").strip()
    if not project:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is required for Speech-to-Text v2")

    langs = _v2_language_codes(
        language_code,
        alternative_language_codes,
        alt_default=settings.speech_to_text_alternative_language_code or "hi-IN",
    )

    out_cfg = recognition_output_config
    if out_cfg is None:
        out_cfg = cs.RecognitionOutputConfig(inline_response_config=cs.InlineOutputConfig())

    result_timeout = max(600, int(timeout_seconds))

    # ── Phase 1: named recognizer (chirp-transcriber @ us-central1) ──────────
    recognizer_id = _effective_v2_recognizer_id(settings)
    if recognizer_id:
        named_loc = "us-central1"
        named_recognizer = SpeechClient.recognizer_path(project, named_loc, recognizer_id)
        try:
            # The named recognizer already encodes model=chirp_2; passing it
            # explicitly in RecognitionConfig is allowed and acts as a per-request
            # override / confirmation — no conflict with the recognizer's own config.
            cfg = _build_v2_recognition_config(cs, model="chirp_2", language_codes=langs)
            req = cs.BatchRecognizeRequest(
                recognizer=named_recognizer,
                config=cfg,
                files=[cs.BatchRecognizeFileMetadata(uri=gs_uri)],
                recognition_output_config=out_cfg,
            )
            client = _make_client_v2(location=named_loc)
            logger.info(
                "[SpeechToText] v2 batch_recognize (named) submitting "
                "recognizer=%s uri=%s langs=%s timeout=%ss",
                named_recognizer,
                gs_uri,
                langs,
                result_timeout,
            )
            response = _run_batch_recognize_lro(
                client,
                req,
                result_timeout=result_timeout,
                progress_callback=progress_callback,
                label=gs_uri[-24:],
            )
            text = _transcript_from_v2_batch_response(response)
            logger.info(
                "[SpeechToText] v2 batch_recognize (named) done "
                "recognizer=%s uri=%s chars=%d",
                recognizer_id,
                gs_uri,
                len(text),
            )
            return text
        except Exception as exc:
            if _is_recognizer_not_found(exc):
                logger.warning(
                    "[SpeechToText] Named recognizer '%s' not found (404) — "
                    "falling back to implicit '_' recognizer loop. "
                    "Verify it exists: gcloud alpha speech recognizers describe %s "
                    "--location=us-central1 --project=%s",
                    recognizer_id,
                    recognizer_id,
                    project,
                )
            else:
                logger.warning(
                    "[SpeechToText] Named recognizer '%s' failed: %s — "
                    "falling back to implicit '_' recognizer loop",
                    recognizer_id,
                    exc,
                )

    # ── Phase 2: implicit wildcard recognizer with model/location loop ────────
    last_exc: BaseException | None = None

    for model, loc in _v2_batch_model_location_attempts(settings):
        try:
            cfg = _build_v2_recognition_config(cs, model=model, language_codes=langs)
            recognizer = SpeechClient.recognizer_path(project, loc, "_")
            req = cs.BatchRecognizeRequest(
                recognizer=recognizer,
                config=cfg,
                files=[cs.BatchRecognizeFileMetadata(uri=gs_uri)],
                recognition_output_config=out_cfg,
            )
            client = _make_client_v2(location=loc)
            logger.info(
                "[SpeechToText] v2 batch_recognize (implicit) submitting "
                "uri=%s model=%s location=%s langs=%s timeout=%ss",
                gs_uri,
                model,
                loc,
                langs,
                result_timeout,
            )
            response = _run_batch_recognize_lro(
                client,
                req,
                result_timeout=result_timeout,
                progress_callback=progress_callback,
                label=gs_uri[-24:],
            )
            text = _transcript_from_v2_batch_response(response)
            logger.info(
                "[SpeechToText] v2 batch_recognize (implicit) done "
                "uri=%s model=%s location=%s chars=%d",
                gs_uri,
                model,
                loc,
                len(text),
            )
            return text
        except Exception as exc:
            last_exc = exc
            if _is_v2_model_location_retryable(exc):
                logger.warning(
                    "[SpeechToText] v2 batch_recognize (implicit) model=%s location=%s failed: %s",
                    model,
                    loc,
                    exc,
                )
                continue
            raise

    if last_exc:
        raise last_exc
    return ""


def transcribe_audio_from_gcs(
    gs_uri: str,
    mime_type: str,
    *,
    sample_rate_hertz: int | None = None,
    language_code: str = "en-IN",
    alternative_language_codes: list[str] | None = None,
    timeout_seconds: int = 28800,
    progress_callback: Any = None,
    recognition_output_config: Any | None = None,
    **_kwargs: Any,
) -> str:
    """
    Transcribe GCS audio: **v2 batch_recognize (Chirp)** when enabled, else v1 LRO.

    Rate-limit strategy
    ───────────────────
    The semaphore is held only during the *submission* of the LRO request.
    Once Google accepts the job the semaphore is released, allowing other
    threads to submit their own jobs in parallel.  The result poll
    (operation.result) runs concurrently without consuming a slot.

    Retries the submission itself (not the poll) on ResourceExhausted / 503.

    Progress reporting
    ──────────────────
    If ``progress_callback(pct: float)`` is provided, a background thread
    polls GCP's LRO metadata every 5 s and maps GCP's 0-100% to the
    display range 20-75%.  The main thread then calls the callback with
    100% after the result arrives.
    """
    from google.cloud import speech  # type: ignore
    from app.core.config import get_settings

    settings = get_settings()

    if getattr(settings, "speech_use_v2", True) and (settings.google_cloud_project or "").strip():
        try:
            return transcribe_gcs_v2_batch(
                gs_uri,
                language_code=language_code,
                alternative_language_codes=alternative_language_codes,
                timeout_seconds=timeout_seconds,
                progress_callback=progress_callback,
                recognition_output_config=recognition_output_config,
            )
        except Exception as exc:
            logger.warning(
                "[SpeechToText] v2 batch_recognize failed — falling back to v1 LRO: %s",
                exc,
            )

    alt = (settings.speech_to_text_alternative_language_code or "hi-IN").strip()
    alts = (
        [x for x in alternative_language_codes if x != language_code]
        if alternative_language_codes is not None
        else ([alt] if alt != language_code else [])
    )

    config = _build_recognition_config(
        speech,
        encoding_name=_encoding_for_mime(mime_type),
        language_code=language_code,
        alts=alts,
        model="latest_long",
        sample_rate_hertz=sample_rate_hertz,
    )
    audio = speech.RecognitionAudio(uri=gs_uri)
    client = _make_client()

    result_timeout = max(1000, int(timeout_seconds or settings.speech_to_text_timeout_seconds))

    logger.info(
        "[SpeechToText] longrunningrecognize submitting uri=%s lang=%s timeout=%ss",
        gs_uri, language_code, result_timeout,
    )

    # Submit under rate-limit guard — semaphore released once job is accepted
    operation = _submit_with_retry(client.long_running_recognize, config=config, audio=audio)

    logger.info(
        "[SpeechToText] longrunningrecognize submitted — polling uri=%s (semaphore released)",
        gs_uri,
    )

    # Start background progress-polling thread if caller provided a callback
    stop_event = threading.Event()
    poll_thread: threading.Thread | None = None
    if progress_callback is not None:
        poll_thread = threading.Thread(
            target=_poll_lro_progress,
            kwargs={
                "operation": operation,
                "progress_callback": progress_callback,
                "stop_event": stop_event,
                "max_wait_seconds": float(result_timeout),
            },
            daemon=True,
            name=f"stt-progress-{gs_uri[-20:]}",
        )
        poll_thread.start()

    try:
        # Poll without holding a semaphore slot — GCP processes server-side
        response = operation.result(timeout=result_timeout)
        # Push progress to 75% so the UI exits the "stuck at 20%" state.
        # The outer folder_service will subsequently set it to 80% → 100%.
        if progress_callback is not None:
            try:
                progress_callback(75.0)
            except Exception:
                pass
    finally:
        stop_event.set()
        if poll_thread is not None:
            poll_thread.join(timeout=5)

    text = _transcript_from_response(response)

    if not text.strip():
        logger.warning("[SpeechToText] empty transcript uri=%s", gs_uri)

    logger.info("[SpeechToText] longrunningrecognize done uri=%s chars=%d", gs_uri, len(text))
    return text


# ── Gemini multimodal fallback ───────────────────────────────────────────────

_GEMINI_AUDIO_PROMPT_TEMPLATE = (
    "You are an expert audio transcription assistant for a legal document system.\n\n"
    "Audio file: {filename}\n\n"
    "Listen to this audio carefully and provide a COMPLETE and ACCURATE transcription.\n\n"
    "Rules:\n"
    "- SPEECH (legal hearing, interview, conversation): transcribe every word spoken exactly. "
    "  Label each speaker as [Speaker 1], [Speaker 2], etc.\n"
    "- MUSIC / SINGING (Bollywood, classical, folk, Hinglish songs): transcribe ALL LYRICS "
    "  line by line in the original language. Add a header with song title, language and a "
    "  one-line description.\n"
    "- MIXED (speech + music): transcribe both, label sections clearly.\n"
    "- INAUDIBLE / NOISE: state 'Inaudible audio — [describe what is heard]'.\n"
    "Do NOT summarise. Provide the full verbatim content.\n"
    "Output only the transcription — no extra commentary."
)

# gemini-2.5-flash is the primary model for audio (best accuracy, native audio support).
# ``transcribe()`` tries this **first** via GCS URI (Vertex), then Speech-to-Text if needed.
_GEMINI_PRIMARY_MODEL = "gemini-2.5-flash"
# Full chain for recovery when STT is poor or primary Gemini fails mid-pipeline.
_GEMINI_AUDIO_MODELS = [
    _GEMINI_PRIMARY_MODEL,
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash-lite",
]


def _is_low_quality(text: str) -> bool:
    """Return True when the transcript is sparse / repetitive (STT failed meaningfully)."""
    stripped = text.strip()
    if not stripped or len(stripped) < 30:
        return True
    tokens = stripped.lower().split()
    if not tokens:
        return True
    unique = set(tokens)
    # Mostly repeated single tokens → likely music noise / filler ("ah", "oh")
    repetition_ratio = len(unique) / len(tokens)
    if repetition_ratio < 0.25 and len(unique) <= 5:
        return True
    if len(tokens) > 40 and len(unique) <= 3:
        return True
    filler = {"ah", "aah", "uh", "um", "hmm", "oh"}
    filler_hits = sum(1 for t in tokens if t.strip(".,!?") in filler)
    if len(tokens) >= 20 and filler_hits / len(tokens) > 0.55:
        return True
    return False


def _transcribe_gcs_with_gemini(
    gs_uri: str,
    mime_type: str,
    filename: str = "",
    *,
    model_names: list[str] | None = None,
) -> str:
    """
    Send a GCS URI **directly** to Gemini via the Vertex AI backend.

    Why GCS URI instead of inline bytes
    ─────────────────────────────────────
    • No 20 MB inline limit — works for multi-hour legal recordings.
    • Audio never loaded into process memory; GCP streams it server-side.
    • Vertex AI's ``gemini-2.5-flash`` has native audio-input support, so the
      model processes the raw waveform rather than a compressed transcript.

    Authentication
    ─────────────────────────────────────
    Uses the same GCS service-account credentials as the rest of the service
    (``GCS_KEY_BASE64`` or Application Default Credentials).  Requires
    ``GOOGLE_CLOUD_PROJECT`` to be set — no separate Vertex AI key needed.

    Models
    ──────
    If ``model_names`` is omitted, tries each entry in ``_GEMINI_AUDIO_MODELS``.
    Pass ``model_names=[_GEMINI_PRIMARY_MODEL]`` (``gemini-2.5-flash``) for the
    first pass in ``transcribe()``.
    """
    try:
        from google import genai  # type: ignore
        from google.genai import types as gtypes  # type: ignore
        from app.core.config import get_settings

        settings = get_settings()
        project = (settings.google_cloud_project or "").strip()
        if not project:
            logger.debug(
                "[SpeechToText] Gemini GCS-URI path skipped — "
                "GOOGLE_CLOUD_PROJECT not configured"
            )
            return ""

        # Load service-account or ADC credentials (same as STT / GCS).
        credentials = None
        try:
            credentials = _load_credentials()
        except Exception as cred_exc:
            logger.debug(
                "[SpeechToText] Gemini GCS-URI credential load warning: %s", cred_exc
            )

        client_kwargs: dict[str, Any] = {
            "vertexai": True,
            "project": project,
            "location": "us-central1",
        }
        if credentials is not None:
            client_kwargs["credentials"] = credentials

        client = genai.Client(**client_kwargs)
        prompt = _GEMINI_AUDIO_PROMPT_TEMPLATE.format(filename=filename or "unknown")

        models = model_names if model_names is not None else list(_GEMINI_AUDIO_MODELS)
        if not models:
            return ""

        last_exc: Exception | None = None
        for model_name in models:
            try:
                logger.info(
                    "[SpeechToText] Gemini GCS-URI transcription — "
                    "model=%s uri=%s mime=%s",
                    model_name,
                    gs_uri,
                    mime_type,
                )
                response = client.models.generate_content(
                    model=model_name,
                    contents=[
                        # Pass the GCS URI directly — no download needed.
                        gtypes.Part.from_uri(file_uri=gs_uri, mime_type=mime_type),
                        gtypes.Part.from_text(text=prompt),
                    ],
                )
                text = (response.text or "").strip()
                if text:
                    logger.info(
                        "[SpeechToText] Gemini GCS-URI done model=%s chars=%d",
                        model_name,
                        len(text),
                    )
                    return text
            except Exception as exc:
                logger.warning(
                    "[SpeechToText] Gemini GCS-URI model=%s failed: %s",
                    model_name,
                    exc,
                )
                last_exc = exc

        if last_exc:
            logger.warning(
                "[SpeechToText] All Gemini GCS-URI models failed — "
                "will try inline-bytes path next"
            )
        return ""

    except Exception as exc:
        logger.warning(
            "[SpeechToText] Gemini GCS-URI path unavailable: %s", exc
        )
        return ""


def _transcribe_with_gemini(audio_bytes: bytes, mime_type: str, filename: str = "") -> str:
    """
    Use Gemini multimodal to transcribe audio via **inline bytes** (≤ 20 MB).

    This is the secondary Gemini path — called only when the GCS-URI path
    (``_transcribe_gcs_with_gemini``) fails or is unavailable.  Handles speech,
    music, Hindi/Hinglish content that Google STT degrades on.
    """
    try:
        from google import genai  # type: ignore
        from google.genai import types as gtypes  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            logger.warning("[SpeechToText] GEMINI_API_KEY not set — inline Gemini fallback unavailable")
            return ""

        if len(audio_bytes) > 20 * 1024 * 1024:
            logger.warning(
                "[SpeechToText] Audio %d bytes > 20 MB inline limit — "
                "skipping inline Gemini path (GCS-URI path should have run first)",
                len(audio_bytes),
            )
            return ""

        client = genai.Client(api_key=api_key)
        prompt = _GEMINI_AUDIO_PROMPT_TEMPLATE.format(filename=filename or "unknown")

        last_exc: Exception | None = None
        for model_name in _GEMINI_AUDIO_MODELS:
            try:
                logger.info(
                    "[SpeechToText] Gemini inline fallback model=%s bytes=%d file=%s",
                    model_name,
                    len(audio_bytes),
                    filename,
                )
                response = client.models.generate_content(
                    model=model_name,
                    contents=[
                        gtypes.Part.from_bytes(data=audio_bytes, mime_type=mime_type),
                        gtypes.Part.from_text(text=prompt),
                    ],
                )
                text = (response.text or "").strip()
                if text:
                    logger.info(
                        "[SpeechToText] Gemini inline done model=%s chars=%d",
                        model_name,
                        len(text),
                    )
                    return text
            except Exception as exc:
                logger.warning(
                    "[SpeechToText] Gemini inline model=%s failed: %s", model_name, exc
                )
                last_exc = exc

        if last_exc:
            logger.error("[SpeechToText] All Gemini inline models failed: %s", last_exc)
        return ""

    except Exception as exc:
        logger.warning("[SpeechToText] Gemini inline fallback unavailable: %s", exc)
        return ""


# ── Public entry point ───────────────────────────────────────────────────────

def transcribe(
    gs_uri: str,
    audio_bytes: bytes,
    mime_type: str,
    *,
    progress_callback: Any = None,
    filename: str = "",
    skip_gemini_primary: bool = False,
) -> str:
    """
    Audio transcription for ingestion:

    1. **Primary** — ``gemini-2.5-flash`` via Vertex with ``gs://`` URI. Any non-empty
       transcript is returned; Speech-to-Text runs only when this fails (empty output
       or API error).
    2. **STT** — sync / long-running / v2 batch when step 1 did not produce text.
    3. **Recovery** — if STT output is low quality, retry Gemini (all models) and
       inline bytes (API key, ≤ 20 MB).

    MP3 always uses long-running / batch paths for STT (sync MP3 is unreliable).
    ``progress_callback`` is forwarded to GCS STT LRO polling only.
    """
    encoding = _encoding_for_mime(mime_type)
    long_form = len(audio_bytes) > _SYNC_SIZE_LIMIT
    sync_allowed = (not long_form) and encoding != "MP3"

    attempts: list[tuple[str, list[str]]] = [
        ("en-IN", ["hi-IN"]),
        ("hi-IN", ["en-IN", "en-US"]),
    ]

    prefer_gemini_primary = is_gemini_primary_audio_mime(mime_type, filename)

    if not skip_gemini_primary and prefer_gemini_primary:
        # ── Primary: Gemini 2.5 Flash + gs:// URI — STT only if this returns empty or errors ──
        try:
            gemini_primary = _transcribe_gcs_with_gemini(
                gs_uri,
                mime_type,
                filename=filename,
                model_names=[_GEMINI_PRIMARY_MODEL],
            )
            gp = (gemini_primary or "").strip()
            if gp:
                logger.info(
                    "[SpeechToText] Gemini 2.5 Flash (GCS URI) primary — %d chars (STT skipped)",
                    len(gp),
                )
                return _normalize_speaker_labels(gp)
            logger.info(
                "[SpeechToText] Gemini 2.5 Flash (GCS URI) returned empty — using Speech-to-Text",
            )
        except Exception as exc:
            logger.warning(
                "[SpeechToText] Gemini 2.5 Flash (GCS URI) primary failed — Speech-to-Text next: %s",
                exc,
            )
    elif not skip_gemini_primary:
        logger.info(
            "[SpeechToText] Gemini primary disabled for mime=%s file=%s; using Speech-to-Text first",
            mime_type,
            filename,
        )

    stt_text = ""

    if sync_allowed:
        for lang, alts in attempts:
            try:
                text = transcribe_audio_bytes(
                    audio_bytes,
                    mime_type,
                    language_code=lang,
                    alternative_language_codes=alts,
                )
                if text and not _is_low_quality(text):
                    return _normalize_speaker_labels(text)
                if text:
                    stt_text = stt_text or text  # keep as fallback
            except Exception as exc:
                logger.warning("[SpeechToText] sync attempt lang=%s failed: %s", lang, exc)

    try:
        from app.core.config import get_settings
        st_timeout = max(1000, int(get_settings().speech_to_text_timeout_seconds or 28800))
    except Exception:
        st_timeout = 28800

    for lang, alts in attempts:
        text = transcribe_audio_from_gcs(
            gs_uri,
            mime_type,
            language_code=lang,
            alternative_language_codes=alts,
            timeout_seconds=st_timeout,
            progress_callback=progress_callback,
        )
        if text and not _is_low_quality(text):
            return _normalize_speaker_labels(text)
        if text:
            stt_text = stt_text or text  # keep as fallback

    # ── Gemini fallback ──────────────────────────────────────────────────────
    # STT produced nothing or low-quality output (music/noise/mixed language).
    #
    # Two-stage Gemini strategy (both use gemini-2.5-flash as primary model):
    #
    # Stage 1 — GCS URI path (Vertex AI, no size limit)
    #   Send the gs:// URI directly so Gemini processes the audio server-side.
    #   Works for files of any size; requires GOOGLE_CLOUD_PROJECT + credentials.
    #
    # Stage 2 — Inline bytes path (Gemini API key, ≤ 20 MB)
    #   Used when Stage 1 is unavailable (no project configured, Vertex AI error,
    #   or the caller only has a GEMINI_API_KEY without full GCP credentials).
    if _is_low_quality(stt_text):
        logger.info(
            "[SpeechToText] STT quality low (%d chars) — "
            "trying Gemini 2.5 Flash fallback (GCS-URI → inline)",
            len(stt_text),
        )

        # Stage 1: GCS URI via Vertex AI — preferred, no size limit.
        gemini_text = _transcribe_gcs_with_gemini(gs_uri, mime_type, filename=filename)
        if gemini_text and not _is_low_quality(gemini_text):
            logger.info(
                "[SpeechToText] Gemini GCS-URI path succeeded — %d chars", len(gemini_text)
            )
            return _normalize_speaker_labels(gemini_text)

        # Stage 2: Inline bytes via API key — fallback for ≤ 20 MB files.
        if not gemini_text or _is_low_quality(gemini_text):
            inline_text = _transcribe_with_gemini(audio_bytes, mime_type, filename=filename)
            if inline_text:
                # Prefer inline result if it produced more content than GCS path.
                if len(inline_text) > len(gemini_text or ""):
                    gemini_text = inline_text

        if gemini_text and not _is_low_quality(gemini_text):
            return _normalize_speaker_labels(gemini_text)
        # Return whatever Gemini produced (even low quality) over STT noise.
        if gemini_text:
            return _normalize_speaker_labels(gemini_text)

    return _normalize_speaker_labels(stt_text)
