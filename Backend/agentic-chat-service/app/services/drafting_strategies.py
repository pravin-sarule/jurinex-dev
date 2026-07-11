"""Stage-2 drafting strategies — section-wise engine + strategy facade.

Stage 1 (fact extraction) and Stage 3 (verification) are unchanged; only the
drafting phase branches on ``drafting_strategy``.

This module owns the SECTION-WISE side (per-section fact filtering,
consistency context, call-boundary logging) and re-exports the shared
contracts and the monolithic strategy so existing imports keep working:

- shared contracts   → ``app.services.drafting_strategy_base``
- monolithic engine  → ``app.services.drafting_monolithic``
- system prompts     → ``app.services.drafting_prompts``
"""
from __future__ import annotations

import logging
import re
from typing import Any, AsyncIterator, Optional

from app.services.drafting_monolithic import (  # noqa: F401 — re-exported for back-compat
    MonolithicDraftContext,
    MonolithicDraftingStrategy,
    build_monolithic_prompt,
    find_missing_template_sections,
    split_monolithic_output,
)
from app.services.drafting_prompts import (  # noqa: F401 — canonical home is drafting_prompts
    MONOLITHIC_DRAFTING_SYSTEM_PROMPT,
)
from app.services.drafting_strategy_base import (  # noqa: F401 — re-exported for back-compat
    MONOLITHIC_DOCUMENT_ID,
    DraftingStrategy,
    DraftingStrategyName,
    DraftMetadata,
    SectionCallMeta,
    _sha256,
    count_placeholders,
)

logger = logging.getLogger(__name__)


def build_consistency_context(facts_digest: str) -> str:
    """Key entity names / defined terms passed into every section-wise call."""
    if not facts_digest:
        return ""
    parties = re.search(
        r"PARTIES\s*—\s*(.*?)(?=\n[A-Z][A-Z /&]+ —|\n## |\Z)",
        facts_digest,
        re.DOTALL | re.IGNORECASE,
    )
    block = parties.group(1).strip() if parties else ""
    if not block:
        return ""
    lines = [ln.strip() for ln in block.splitlines() if ln.strip()][:12]
    return (
        "\nCONSISTENCY CONTEXT (use these exact spellings everywhere — do not vary):\n"
        + "\n".join(f"- {ln[:200]}" for ln in lines)
        + "\n"
    )


def _section_keywords(section: dict[str, Any]) -> set[str]:
    words: set[str] = set()
    for src in (
        section.get("heading", ""),
        section.get("summary", ""),
        " ".join(
            str(p.get(k, ""))
            for p in (section.get("placeholders") or [])
            for k in ("key", "label", "description", "original_token")
        ),
    ):
        words.update(w.lower() for w in re.findall(r"[a-zA-Z]{4,}", str(src)))
    return words


def filter_facts_for_section(section: dict[str, Any], facts_digest: str) -> str:
    """Subset of the fact inventory relevant to one template section.

    Section-wise drafting uses this instead of the full digest inline — smaller
    context per call. PARTIES are always included for cross-section name consistency.
    """
    if not facts_digest:
        return ""
    keywords = _section_keywords(section)
    heading_l = str(section.get("heading", "")).lower()
    parts: list[str] = []

    # User-confirmed addendum always travels with filtered slices.
    addendum_idx = facts_digest.find("## USER-CONFIRMED FACTS ADDENDUM")
    base = facts_digest[:addendum_idx] if addendum_idx != -1 else facts_digest
    addendum = facts_digest[addendum_idx:] if addendum_idx != -1 else ""

    parties = re.search(
        r"PARTIES\s*—\s*(.*?)(?=\n[A-Z][A-Z /&]+ —|\n## |\Z)",
        base,
        re.DOTALL | re.IGNORECASE,
    )
    if parties:
        parts.append("PARTIES —\n" + parties.group(1).strip())

    # Chronology matrix rows matching section keywords or always for date/event tables.
    in_matrix = False
    matrix_header: list[str] = []
    matrix_hits: list[str] = []
    want_matrix = (
        section.get("contains_table")
        or any(k in heading_l for k in ("date", "event", "chronolog", "list of"))
        or "fact" in heading_l
        or "statement" in heading_l
    )
    for line in base.splitlines():
        if line.strip().startswith("| S.No") or line.strip().startswith("|:-----"):
            in_matrix = True
            matrix_header = [line]
            continue
        if in_matrix:
            if line.strip().startswith("|"):
                row_l = line.lower()
                if want_matrix or any(k in row_l for k in keywords):
                    matrix_hits.append(line)
            elif line.strip() == "":
                continue
            else:
                in_matrix = False
    if matrix_hits:
        parts.append("| S.No | Date | Particulars |\n|:-----|:-----|:------------|\n" + "\n".join(matrix_hits))

    # Inventory subsections: include block when heading/keywords overlap.
    for block_name in (
        "AMOUNTS", "PROPERTIES / SUBJECT MATTER", "DOCUMENT REFERENCES",
        "TERMS AND CONDITIONS", "OTHER FACTS", "TIMELINE GAPS",
    ):
        m = re.search(
            rf"{re.escape(block_name)}\s*—\s*(.*?)(?=\n[A-Z][A-Z /&]+ —|\n## |\Z)",
            base,
            re.DOTALL | re.IGNORECASE,
        )
        if not m:
            continue
        body = m.group(1).strip()
        body_l = body.lower()
        name_l = block_name.lower()
        if (
            any(k in name_l for k in keywords)
            or any(k in body_l for k in keywords)
            or any(k in heading_l for k in name_l.split())
            or (block_name == "DOCUMENT REFERENCES" and "annexure" in heading_l)
            or (block_name == "AMOUNTS" and any(k in heading_l for k in ("amount", "invoice", "payment", "interest")))
        ):
            parts.append(f"{block_name} —\n{body}")

    if not parts:
        # Fallback: first 4k chars so the section is never starved of facts.
        parts.append(base[:4000] + ("…" if len(base) > 4000 else ""))

    out = "\n\n".join(parts)
    if addendum:
        out += "\n\n" + addendum
    return out


class SectionwiseDraftingStrategy(DraftingStrategy):
    """Marker strategy — implementation remains in ``generate_draft_loop`` (the
    existing per-section parallel/serial engine). Section-wise trade-off: more
    calls → higher cost/latency, but narrower context per call reduces
    hallucination risk and allows per-section retry via ``section_ids``.
    """

    async def draft(self, ctx: Any) -> AsyncIterator[dict[str, Any]]:
        raise NotImplementedError("Section-wise drafting runs inline in generate_draft_loop")
        yield  # pragma: no cover


def resolve_strategy(name: Optional[str]) -> DraftingStrategyName:
    n = (name or "sectionwise").strip().lower()
    if n in ("monolithic", "one_shot", "oneshot"):
        return "monolithic"
    if n in ("sectionwise", "section_wise", "per_section"):
        return "sectionwise"
    return "sectionwise"


def log_section_call_boundary(
    session_id: str,
    section: dict[str, Any],
    prompt: str,
    output: str,
    usage: dict[str, int],
    latency_ms: int,
    error: Optional[str] = None,
) -> SectionCallMeta:
    """Structured log at each section call boundary."""
    meta = SectionCallMeta(
        section_id=str(section.get("section_id", "")),
        heading=str(section.get("heading", ""))[:120],
        success=bool(output.strip()) and not error,
        latency_ms=latency_ms,
        input_tokens=int(usage.get("inputTokens", 0)),
        output_tokens=int(usage.get("outputTokens", 0)),
        placeholders_inserted=count_placeholders(output),
        input_hash=_sha256(prompt),
        output_hash=_sha256(output),
        error=error,
    )
    logger.info(
        "Section draft session=%s section=%s success=%s latency_ms=%s "
        "in=%s out=%s placeholders=%s input_hash=%s output_hash=%s%s",
        session_id, meta.section_id, meta.success, meta.latency_ms,
        meta.input_tokens, meta.output_tokens, meta.placeholders_inserted,
        meta.input_hash, meta.output_hash,
        f" error={error}" if error else "",
    )
    return meta
