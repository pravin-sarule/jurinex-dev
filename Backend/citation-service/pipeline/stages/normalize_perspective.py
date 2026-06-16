from core.constants import PERSPECTIVE_ALIASES, SUPPORTED_PERSPECTIVES


def run(value: str | None) -> str:
    normalized = (value or "neutral").strip().lower().replace("-", "_")
    normalized = PERSPECTIVE_ALIASES.get(normalized, normalized)
    if normalized not in SUPPORTED_PERSPECTIVES:
        raise ValueError(f"Unsupported perspective: {value}")
    return normalized
