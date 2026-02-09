"""Chunking for ingestion. Mirrors document-service chunkingService (recursive/semantic)."""

from __future__ import annotations

from typing import Any, Dict, List


def estimate_token_count(text: str) -> int:
    if not text:
        return 0
    return (len(text) + 3) // 4


def _merge_small_chunks(chunks: List[str], min_size: int = 300) -> List[str]:
    merged: List[str] = []
    buffer = ""
    for ch in chunks:
        if len(buffer) + len(ch) < min_size:
            buffer += ch + " "
        else:
            if buffer.strip():
                merged.append(buffer.strip())
                buffer = ""
            merged.append(ch.strip())
    if buffer.strip():
        merged.append(buffer.strip())
    return merged


def _recursive_split(
    text: str,
    chunk_size: int,
    chunk_overlap: int,
    separators: List[str],
) -> List[str]:
    """Split text by separators into chunks of ~chunk_size with overlap."""
    if not text or not text.strip():
        return []
    if len(text) <= chunk_size:
        return [text.strip()] if text.strip() else []

    step = max(1, chunk_size - chunk_overlap)
    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        segment = text[start:end]
        # Try to break at last separator
        if end < len(text):
            for sep in separators:
                last_sep = segment.rfind(sep)
                if last_sep > chunk_size // 2:
                    segment = segment[: last_sep + len(sep)]
                    end = start + last_sep + len(sep)
                    break
        chunks.append(segment.strip())
        start = start + len(segment) if len(segment) > 0 else start + step
    return [c for c in chunks if c]


def chunk_structured_content(
    structured_content: List[Dict[str, Any]],
    chunk_size: int = 1200,
    chunk_overlap: int = 150,
    method: str = "optimized_recursive",
) -> List[Dict[str, Any]]:
    """
    Chunk document content. structured_content: list of {text, page_start, page_end, heading}.
    Returns list of {content, metadata: {page_start, page_end, heading, chunk_method}, token_count}.
    Mirrors chunkingService.chunkDocument with recursive/optimized_recursive.
    """
    format_chunk = lambda content, meta: {
        "content": content,
        "metadata": meta,
        "token_count": estimate_token_count(content),
    }

    all_chunks: List[Dict[str, Any]] = []
    separators = ["\n\n", ". ", "; ", "\n", " ", ""]

    for block in structured_content:
        text = (block.get("text") or "").strip()
        if not text:
            continue
        page_start = block.get("page_start")
        page_end = block.get("page_end")
        heading = block.get("heading")

        if method in ("recursive", "optimized_recursive"):
            raw = _recursive_split(text, chunk_size, chunk_overlap, separators)
            merged = _merge_small_chunks(raw)
            for i, content in enumerate(merged):
                meta = {
                    "page_start": page_start,
                    "page_end": page_end,
                    "heading": heading,
                    "chunk_method": "recursive",
                    "chunk_index": i + 1,
                }
                all_chunks.append(format_chunk(content, meta))
        else:
            meta = {
                "page_start": page_start,
                "page_end": page_end,
                "heading": heading,
                "chunk_method": "structural",
            }
            all_chunks.append(format_chunk(text, meta))

    return all_chunks
