from __future__ import annotations

from typing import Any


def require_non_empty(value: str, name: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        raise ValueError(f"{name} is required")
    return cleaned


def normalize_case_file_context(value: Any) -> list[dict[str, Any]]:
    """Normalize API case context, including the manual-mode plain-text payload."""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        return [{"name": "Manual case facts", "content": text, "snippet": text}]

    if not isinstance(value, list):
        return []

    return [dict(item) for item in value if isinstance(item, dict)]


