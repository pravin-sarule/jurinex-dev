"""
Structured-case service.

Calls DeepSeek (OpenAI-compatible) with `response_format={"type": "json_object"}`
and a strict system prompt, then coerces the result into the `StructuredCase`
schema. Robust to the common failure modes (code-fence wrappers, leading/trailing
commentary, partial JSON) via a layered fallback parser. Never raises on bad model
output — returns a best-effort `StructuredCase` plus the raw text for the frontend
to fall back to markdown rendering.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from app.schemas.structured_case import (
    ActSection,
    AmountComponent,
    DateEvent,
    Party,
    StructuredCase,
    SummarizeResponse,
)

logger = logging.getLogger("agentic_document_service.structured_case")

# Default model — matches the rest of the service (no chain-of-thought leakage).
_DEFAULT_MODEL = "deepseek-v4-flash"
_MAX_TOKENS = 6000


# ─────────────────────────────────────────────────────────────────────────────
# THE EXACT PROMPT sent to DeepSeek (system turn). Kept as a module constant so it
# can be imported/tested and reused elsewhere.
# ─────────────────────────────────────────────────────────────────────────────

STRUCTURED_CASE_SYSTEM_PROMPT = """\
You are a senior Indian legal analyst. You read legal case material and return a \
SINGLE structured JSON object. You never add commentary.

OUTPUT RULES (ZERO TOLERANCE):
- Return ONLY one valid JSON object. No prose, no markdown, no code fences, nothing \
before or after the JSON.
- Use EXACTLY these keys (never add, rename, or nest differently):
{
  "caseName": "string  - cause-title / case name, or \\"\\" if absent",
  "caseType": "string  - e.g. Civil Suit, Writ Petition, Criminal Appeal, or \\"\\"",
  "overview": "string  - 2 to 5 sentence plain-language summary of the matter",
  "parties": [ { "role": "string", "name": "string", "details": "string" } ],
  "claimAmount": "string - TOTAL money claimed/awarded WITH currency, or \\"\\" if not a money matter",
  "components": [ { "description": "string", "amount": "string" } ],
  "datesAndEvents": [ { "date": "string", "event": "string" } ],
  "issues": [ "string  - each legal issue / question of law" ],
  "reliefs": [ "string  - each relief / prayer sought, verbatim" ],
  "actsAndSections": [ { "act": "string", "section": "string", "purpose": "string" } ]
}

CONTENT RULES:
- Preserve legal terminology, party names, section/article numbers, citations, dates \
and amounts EXACTLY as they appear.
- Repair PDF/OCR extraction artefacts WITHOUT changing meaning:
    * Rejoin words split across lines or syllables: \
"S agar D ink ar Mart ande" -> "Sagar Dinkar Martande", "Jur isdiction" -> "Jurisdiction".
    * Tighten spaced amounts/dates: "Rs . 38 , 22 , 500 /-" -> "Rs. 38,22,500/-", \
"04 / 04 / 2024" -> "04/04/2024".
- Every array item must be a COMPLETE unit (a whole name / a whole event), NEVER a \
single fragment word on its own.
- "claimAmount" and "components" apply ONLY to money/recovery matters. For \
non-money matters leave "claimAmount" as "" and "components" as [].
- Order "datesAndEvents" chronologically (earliest first).
- NEVER fabricate. If a field is not present in the material, use "" for strings and \
[] for arrays.
- Always answer in English regardless of the document language.\
"""


# ─────────────────────────────────────────────────────────────────────────────
# JSON extraction / coercion helpers
# ─────────────────────────────────────────────────────────────────────────────

def _strip_code_fences(text: str) -> str:
    t = text.strip()
    # ```json ... ```  or  ``` ... ```
    fence = re.match(r"^```[a-zA-Z]*\s*([\s\S]*?)\s*```$", t)
    if fence:
        return fence.group(1).strip()
    return t


def _extract_json_object(text: str) -> Optional[dict]:
    """Best-effort: parse the first complete top-level JSON object in `text`."""
    if not text:
        return None
    candidate = _strip_code_fences(text)

    # Fast path — the whole thing is JSON.
    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    # Fallback — scan for the first balanced { ... } block.
    start = candidate.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(candidate)):
        ch = candidate[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                block = candidate[start : i + 1]
                try:
                    parsed = json.loads(block)
                    return parsed if isinstance(parsed, dict) else None
                except json.JSONDecodeError:
                    return None
    return None


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    return str(value)


def _as_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, dict):
            # Tolerate the model emitting [{"issue": "..."}] etc.
            joined = " ".join(_as_str(v) for v in item.values() if _as_str(v))
            if joined:
                out.append(joined)
        else:
            s = _as_str(item)
            if s:
                out.append(s)
    return out


def _objects(value: Any) -> list[dict]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def coerce_to_structured_case(data: dict) -> StructuredCase:
    """Map a loosely-typed dict into a strict StructuredCase with safe defaults."""
    return StructuredCase(
        caseName=_as_str(data.get("caseName")),
        caseType=_as_str(data.get("caseType")),
        overview=_as_str(data.get("overview")),
        parties=[
            Party(
                role=_as_str(p.get("role")),
                name=_as_str(p.get("name")),
                details=_as_str(p.get("details")),
            )
            for p in _objects(data.get("parties"))
        ],
        claimAmount=_as_str(data.get("claimAmount")),
        components=[
            AmountComponent(
                description=_as_str(c.get("description") or c.get("label") or c.get("name")),
                amount=_as_str(c.get("amount") or c.get("value")),
            )
            for c in _objects(data.get("components"))
        ],
        datesAndEvents=[
            DateEvent(
                date=_as_str(d.get("date")),
                event=_as_str(d.get("event") or d.get("description") or d.get("particulars")),
            )
            for d in _objects(data.get("datesAndEvents"))
        ],
        issues=_as_str_list(data.get("issues")),
        reliefs=_as_str_list(data.get("reliefs")),
        actsAndSections=[
            ActSection(
                act=_as_str(a.get("act") or a.get("statute")),
                section=_as_str(a.get("section") or a.get("sections")),
                purpose=_as_str(a.get("purpose")),
            )
            for a in _objects(data.get("actsAndSections"))
        ],
    )


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

def summarize_to_structured_case(
    *,
    case_text: Optional[str],
    query: Optional[str],
    model: Optional[str] = None,
) -> SummarizeResponse:
    """
    Call DeepSeek in JSON mode and return a SummarizeResponse.

    Never raises on a bad/empty model reply — returns the best-effort structure
    plus `rawMarkdown` (the raw model text) and `warnings` so the caller/frontend
    can degrade gracefully.
    """
    warnings: list[str] = []

    case_text = (case_text or "").strip()
    query = (query or "").strip()
    if not case_text and not query:
        return SummarizeResponse(
            success=False,
            data=StructuredCase(),
            warnings=["Provide caseText and/or query."],
        )

    # Reuse the service-wide DeepSeek client + model resolution so config (key,
    # timeout, retries) stays identical to the rest of the app.
    from app.services.adapters.document_ai import _deepseek_client, _deepseek_model_id

    client = _deepseek_client()
    if client is None:
        return SummarizeResponse(
            success=False,
            data=StructuredCase(),
            warnings=["DeepSeek client unavailable (check DEEPSEEK_API_KEY)."],
        )

    api_model = _deepseek_model_id(model or "") or _DEFAULT_MODEL

    user_parts: list[str] = []
    if query:
        user_parts.append(f"INSTRUCTION:\n{query}")
    if case_text:
        user_parts.append(f"CASE MATERIAL:\n{case_text}")
    user_parts.append(
        "Return the JSON object now. Output JSON only — no markdown, no commentary."
    )
    user_content = "\n\n".join(user_parts)

    raw_text = ""
    try:
        completion = client.chat.completions.create(
            model=api_model,
            messages=[
                {"role": "system", "content": STRUCTURED_CASE_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0,
            max_tokens=_MAX_TOKENS,
            response_format={"type": "json_object"},
        )
        raw_text = (completion.choices[0].message.content or "").strip()
        usage = getattr(completion, "usage", None)
        logger.info(
            "[StructuredCase] model=%s prompt_tokens=%s completion_tokens=%s",
            api_model,
            getattr(usage, "prompt_tokens", "?"),
            getattr(usage, "completion_tokens", "?"),
        )
    except Exception as exc:
        logger.warning("[StructuredCase] DeepSeek call failed model=%s error=%s", api_model, exc)
        return SummarizeResponse(
            success=False,
            data=StructuredCase(),
            warnings=[f"DeepSeek request failed: {exc}"],
        )

    parsed = _extract_json_object(raw_text)
    if parsed is None:
        # Could not recover JSON — hand back the raw text for markdown fallback.
        logger.warning("[StructuredCase] could not parse JSON; returning raw fallback")
        return SummarizeResponse(
            success=True,
            data=StructuredCase(overview=raw_text[:2000]),
            rawMarkdown=raw_text,
            warnings=["Model did not return valid JSON; using markdown fallback."],
        )

    try:
        structured = coerce_to_structured_case(parsed)
    except Exception as exc:
        logger.warning("[StructuredCase] coercion failed: %s", exc)
        return SummarizeResponse(
            success=True,
            data=StructuredCase(overview=raw_text[:2000]),
            rawMarkdown=raw_text,
            warnings=[f"JSON shape unexpected: {exc}"],
        )

    return SummarizeResponse(success=True, data=structured, warnings=warnings)
