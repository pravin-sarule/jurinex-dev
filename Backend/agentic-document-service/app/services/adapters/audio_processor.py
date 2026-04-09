"""
AudioProcessor — isolated audio transcription + RAG-ready sliding-window chunking.

Design goals
────────────
• Completely isolated from the PDF/Docx OCR path; only invoked for audio MIME types.
• Transcription is delegated to ``speech_to_text.transcribe()`` which **prefers**
  Gemini 2.5 Flash with the ``gs://`` URI (Vertex AI), then Google Speech-to-Text,
  then Gemini recovery paths — so chunking always receives a full transcript when
  the APIs succeed.
• Sliding-window chunking: 750-char window, 75-char overlap (10%), deduplicates
  identical adjacent windows so repetitive noise ("ah ah ah …") doesn't pollute the
  index. The pipeline then embeds and stores chunks like other documents.

Usage (from pipeline_service.py):
    from app.services.adapters.audio_processor import AudioProcessor
    ap = AudioProcessor()
    transcript = ap.transcribe(gs_uri, mime_type, progress_callback=cb, filename=name)
    chunks = ap.chunk(transcript)           # list[AudioChunk]
    # map chunks → ChunkSection for embedding
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

logger = logging.getLogger("agentic_document_service.audio_processor")

# ── Defaults ──────────────────────────────────────────────────────────────────

# Sliding-window parameters (characters, not tokens).
# 750-char window ≈ 500–1 000 word-level tokens for typical speech at 5 chars/word.
_WINDOW_CHARS = 750
_OVERLAP_RATIO = 0.10  # 10% → 75-char overlap, 675-char step


# ── Data types ────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class AudioChunk:
    """One sliding-window chunk produced from an audio transcript."""
    index: int
    text: str
    heading: str
    char_start: int
    char_end: int


# ── AudioProcessor ────────────────────────────────────────────────────────────

class AudioProcessor:
    """
    Isolated audio-processing pipeline for the RAG ingestion workflow.

    Thread-safe: the instance holds no mutable state — all work happens in
    the method bodies, delegating to the thread-safe ``speech_to_text`` module.
    """

    def __init__(
        self,
        window_chars: int = _WINDOW_CHARS,
        overlap_ratio: float = _OVERLAP_RATIO,
        min_quality_chars: int = 50,
    ) -> None:
        self._window = max(200, window_chars)
        self._overlap = max(0, int(self._window * overlap_ratio))
        self._step = max(1, self._window - self._overlap)
        # Kept for backward compatibility; transcription quality is handled in
        # ``speech_to_text.transcribe()``.
        self._min_quality = min_quality_chars

    # ── Public API ─────────────────────────────────────────────────────────

    def transcribe(
        self,
        gs_uri: str,
        mime_type: str,
        *,
        progress_callback=None,
        filename: str = "",
    ) -> str:
        """
        Transcribe audio at *gs_uri* via ``speech_to_text.transcribe()``.

        Downloads bytes from GCS for STT sync paths and inline-Gemini fallbacks;
        the primary path sends the ``gs://`` URI to Gemini 2.5 Flash without
        loading large files into the client.

        Returns the transcript string (may be empty on hard failure; does not raise).
        """
        from app.services.adapters import speech_to_text as stt
        from app.services.adapters.gcs import download_bytes

        logger.info("[AudioProcessor] transcribe — uri=%s mime=%s", gs_uri, mime_type)

        try:
            audio_bytes = download_bytes(gs_uri)
            logger.info("[AudioProcessor] downloaded %d bytes from GCS", len(audio_bytes))
        except Exception as exc:
            logger.error("[AudioProcessor] GCS download failed for %s: %s", gs_uri, exc)
            return ""

        try:
            stt_text = stt.transcribe(
                gs_uri,
                audio_bytes,
                mime_type,
                progress_callback=progress_callback,
                filename=filename,
            )
            logger.info(
                "[AudioProcessor] transcription done — %d chars for %s",
                len((stt_text or "").strip()),
                gs_uri,
            )
            return (stt_text or "").strip()
        except Exception as exc:
            logger.error("[AudioProcessor] transcribe failed for %s: %s", gs_uri, exc)
            return ""

    def chunk(self, transcript: str) -> list[AudioChunk]:
        """
        Apply a sliding-window chunking strategy to the transcript.

        Parameters
        ──────────
        • window  = ``self._window`` characters  (default 750)
        • overlap = ``self._overlap`` characters  (default 75 = 10 %)
        • step    = window − overlap              (default 675)

        Identical adjacent windows are deduplicated so repeated noise or filler
        phrases do not create redundant index entries.

        Returns an ordered list of :class:`AudioChunk` objects.  For very short
        transcripts (< window) a single chunk covering the full text is returned.
        """
        text = (transcript or "").strip()
        if not text:
            return []

        chunks: list[AudioChunk] = []
        seen: set[str] = set()
        idx = 0
        pos = 0

        while pos < len(text):
            end = min(pos + self._window, len(text))
            window_text = text[pos:end].strip()

            if window_text:
                dedup_key = window_text.lower()
                if dedup_key not in seen:
                    seen.add(dedup_key)
                    chunks.append(
                        AudioChunk(
                            index=idx,
                            text=window_text,
                            heading=f"Audio Segment {idx + 1}",
                            char_start=pos,
                            char_end=end,
                        )
                    )
                    idx += 1

            pos += self._step

        logger.info(
            "[AudioProcessor] sliding-window chunking — transcript=%d chars "
            "window=%d overlap=%d step=%d → %d chunks",
            len(text),
            self._window,
            self._overlap,
            self._step,
            len(chunks),
        )
        return chunks
