"""Ambiguous-question clarification protocol for the folder chat.

When the user's question is genuinely ambiguous, the model — instead of
guessing — replies with a strict JSON object describing ONE clarifying
question plus 2–4 selectable options. The route parses that JSON, ships it
to the frontend on the `done` event as `clarification` (rendered as an
interactive option card, Claude-Code style), and stores a readable markdown
rendering as the answer so session history and model replay stay coherent.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

# Appended AFTER the OUTPUT CONTRACT in the normal-chat prompt, so it survives
# the contract's "overrides all prior instructions" framing.
CLARIFICATION_PROTOCOL = """=== CLARIFICATION PROTOCOL (takes precedence over the OUTPUT CONTRACT only when triggered) ===
If — and ONLY if — the user's CURRENT question is genuinely ambiguous, ask ONE clarifying question instead of answering.
"Genuinely ambiguous" means you cannot answer confidently because:
- the question has two or more materially DIFFERENT interpretations that would lead to different answers (e.g. an unspecified party, document, date range, or proceeding when the case has several); or
- a key term matches several distinct things in the documents and the user did not indicate which one; or
- the request is missing a decision you cannot reasonably default (e.g. "draft the reply" when the case has multiple pending notices).
Do NOT trigger this protocol when:
- a reasonable single interpretation exists (just answer it, stating your interpretation in one line);
- the question is broad but answerable (e.g. "summarize the case" — answer, never ask);
- the information is simply absent from the documents (say so, as instructed above);
- the conversation history shows your immediately previous reply was already a clarifying question — in that case NEVER ask again: treat the user's latest message as their answer and respond with the best possible answer.
At most ONE clarifying question per user question, with 2–4 concrete options drawn from THIS case's actual documents/parties/context — never generic filler options.

When triggered, your ENTIRE response must be ONLY this JSON object — no markdown, no code fence, no prose before or after, starting with { and ending with }:
{"type": "clarification", "header": "<2-3 word topic label, e.g. 'Which party?'>", "question": "<one short, specific question ending with ?>", "options": [{"label": "<short option the user can click, max 8 words>", "description": "<one line saying what choosing this means>"}, ...]}
"""

_MAX_OPTIONS = 4
_MIN_OPTIONS = 2
_MAX_LABEL_CHARS = 120
_MAX_DESC_CHARS = 300
_MAX_QUESTION_CHARS = 500
_MAX_HEADER_CHARS = 60

_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$", re.MULTILINE)


def parse_clarification(text: str) -> Optional[dict[str, Any]]:
    """Return a normalized clarification dict, or None if `text` is a normal answer.

    Lenient on wrapping (code fences, stray prose from post-processing) but strict
    on shape: wrong/missing fields mean "not a clarification" — never a guess.
    """
    raw = (text or "").strip()
    if not raw or '"clarification"' not in raw:
        return None
    raw = _FENCE_RE.sub("", raw).strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(raw[start : end + 1])
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or data.get("type") != "clarification":
        return None

    question = str(data.get("question") or "").strip()
    if not question:
        return None

    options: list[dict[str, str]] = []
    for opt in data.get("options") or []:
        if isinstance(opt, dict):
            label = str(opt.get("label") or "").strip()
            description = str(opt.get("description") or "").strip()
        elif isinstance(opt, str):
            label, description = opt.strip(), ""
        else:
            continue
        if not label:
            continue
        options.append({
            "label": label[:_MAX_LABEL_CHARS],
            "description": description[:_MAX_DESC_CHARS],
        })
        if len(options) >= _MAX_OPTIONS:
            break
    if len(options) < _MIN_OPTIONS:
        return None

    return {
        "header": str(data.get("header") or "").strip()[:_MAX_HEADER_CHARS],
        "question": question[:_MAX_QUESTION_CHARS],
        "options": options,
    }


def clarification_to_markdown(clarification: dict[str, Any]) -> str:
    """Readable rendering stored as the answer (DB history, model replay, copy/PDF)."""
    lines = [f"**{clarification['question']}**", ""]
    for i, opt in enumerate(clarification["options"], start=1):
        entry = f"{i}. **{opt['label']}**"
        if opt.get("description"):
            entry += f" — {opt['description']}"
        lines.append(entry)
    lines += ["", "*Pick the option that matches what you need, or describe it in your own words.*"]
    return "\n".join(lines)
