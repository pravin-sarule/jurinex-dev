import json
from typing import Any


def loads_lenient(raw: str) -> Any | None:
    """
    Parse JSON from an LLM response, tolerating ```json code fences and any prose
    around the object. Returns None if nothing parseable is found.
    """
    s = (raw or "").strip()
    if s.startswith("```"):
        inner = s[3:]
        if inner[:4].lower() == "json":
            inner = inner[4:]
        inner = inner.rsplit("```", 1)[0]
        s = inner.strip()
    try:
        return json.loads(s)
    except Exception:
        pass
    # Fall back to the outermost {...} span.
    start, end = s.find("{"), s.rfind("}")
    if 0 <= start < end:
        try:
            return json.loads(s[start:end + 1])
        except Exception:
            pass
    return None
