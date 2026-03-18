"""
Deterministic preprocessing helpers for section drafting.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _collapse_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _dedupe_adjacent_words(value: str) -> str:
    if not value:
        return ""
    return re.sub(r"\b(\w+)(\s+\1\b)+", r"\1", value, flags=re.IGNORECASE)


def clean_suffix(value: Any, word: str) -> str:
    text = _collapse_spaces(_safe_text(value))
    if not text:
        return ""
    text = re.sub(rf"\b{re.escape(word)}\b", "", text, flags=re.IGNORECASE)
    return _collapse_spaces(_dedupe_adjacent_words(text))


def normalize_location(value: Any) -> str:
    text = _collapse_spaces(_safe_text(value))
    if not text:
        return ""
    text = re.sub(r"Village\s*/\s*Taluka\s*/\s*District", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*/\s*", ", ", text)
    parts = [part.strip(" ,") for part in text.split(",")]
    parts = [part for part in parts if part]
    return ", ".join(parts)


def normalize_field_values(fields: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {}
    for key, raw_value in (fields or {}).items():
        if isinstance(raw_value, str):
            value = _collapse_spaces(_dedupe_adjacent_words(raw_value))
        else:
            value = raw_value

        token = str(key or "").strip().lower()
        if isinstance(value, str):
            if token.endswith("wing") or token == "wing":
                value = clean_suffix(value, "wing")
            elif token.endswith("floor") or token == "floor":
                value = clean_suffix(value, "floor")
            elif "location" in token:
                value = normalize_location(value)
            elif token in {"address", "village", "taluka", "district", "city"}:
                value = value.replace(" / ", ", ").replace("/", ", ")
                value = _collapse_spaces(value)
        normalized[key] = value
    return normalized


def build_address(fields: Optional[Dict[str, Any]]) -> str:
    fields = fields or {}
    ordered_keys = [
        "flat_no",
        "flat_number",
        "wing",
        "floor",
        "society_name",
        "building_name",
        "plot_no",
        "plot_number",
        "area",
        "location",
        "city",
        "district",
        "state",
        "pincode",
        "pin_code",
    ]
    labels = {
        "flat_no": "Flat No.",
        "flat_number": "Flat No.",
        "plot_no": "Plot No.",
        "plot_number": "Plot No.",
    }

    parts: List[str] = []
    seen = set()
    for key in ordered_keys:
        value = _collapse_spaces(_safe_text(fields.get(key)))
        if not value:
            continue
        labeled = f"{labels[key]} {value}" if key in labels else value
        normalized = labeled.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        parts.append(labeled)
    return ", ".join(parts)


def _normalized_matchable_values(field_values: Dict[str, Any]) -> List[str]:
    matchable: List[str] = []
    for value in field_values.values():
        text = _collapse_spaces(_safe_text(value)).lower()
        if len(text) >= 4:
            matchable.append(text)
    return matchable


def filter_redundant_chunks(chunks: Optional[List[Dict[str, Any]]], field_values: Dict[str, Any]) -> List[Dict[str, Any]]:
    filtered: List[Dict[str, Any]] = []
    seen_chunk_text = set()
    values = _normalized_matchable_values(field_values)

    for chunk in chunks or []:
        text = _collapse_spaces(_safe_text(chunk.get("content") or chunk.get("text")))
        if not text:
            continue
        lowered = text.lower()
        if lowered in seen_chunk_text:
            continue
        seen_chunk_text.add(lowered)

        overlap_count = sum(1 for value in values if value and value in lowered)
        # Short chunks that just mirror field data add duplication pressure to the drafter.
        if overlap_count >= 2 and len(text) <= 450:
            continue

        filtered.append(chunk)
    return filtered


def build_rag_context(chunks: Optional[List[Dict[str, Any]]]) -> str:
    parts: List[str] = []
    for chunk in chunks or []:
        content = _collapse_spaces(_safe_text(chunk.get("content") or chunk.get("text")))
        if not content:
            continue
        source = _safe_text(chunk.get("heading")) or _safe_text(chunk.get("file_name")) or _safe_text(chunk.get("source"))
        page = _safe_text(chunk.get("page_start") or chunk.get("page"))
        prefix = ""
        if source:
            prefix = f"[Source: {source}] "
        elif page:
            prefix = f"[Page {page}] "
        parts.append(f"{prefix}{content}")
    return "\n\n---\n\n".join(parts)


def format_field_values_for_prompt(field_values: Dict[str, Any]) -> str:
    lines: List[str] = []
    for key in sorted(field_values.keys()):
        value = field_values.get(key)
        text = _safe_text(value)
        if text:
            lines.append(f"{key}: {text}")
    return "\n".join(lines)


def preprocess_drafting_inputs(
    raw_fields: Optional[Dict[str, Any]],
    rag_chunks: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    normalized_fields = normalize_field_values(raw_fields or {})
    final_address = build_address(normalized_fields)
    if final_address:
        normalized_fields["final_address"] = final_address
    filtered_chunks = filter_redundant_chunks(rag_chunks or [], normalized_fields)
    return {
        "field_values": normalized_fields,
        "final_address": final_address,
        "filtered_chunks": filtered_chunks,
        "rag_context": build_rag_context(filtered_chunks),
        "field_values_text": format_field_values_for_prompt(normalized_fields),
    }
