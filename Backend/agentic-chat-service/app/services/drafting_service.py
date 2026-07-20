"""Dynamic Document Drafting pipeline — core service.

Pipeline stages (all triggered explicitly by the frontend "Drafting Mode"):

1. ``analyze_template_task``   — async worker: template file → Gemini structured
   output (``response_schema=TemplateStructure``) → JSON layout persisted.
2. ``prepare_supporting_context`` — supporting docs → Gemini explicit context
   cache when large enough, otherwise inline multimodal parts per request.
3. ``generate_draft_loop``     — sequential section-by-section generation that
   streams SSE events, wrapping each section's text in
   ``[START_SECTION_i] … [END_SECTION_i]`` markers so the frontend can split
   the stream into cards. Sequential looping sidesteps output-token limits:
   a 100-page draft is produced as N bounded calls, never one giant call.

Zero-hallucination posture: temperature 0.0, closed-world system prompt, and
explicit ``[DATA NOT PROVIDED: …]`` markers instead of invented facts.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import time
import zipfile
from typing import Any, AsyncIterator, Optional
from xml.etree import ElementTree

from app.core.config import get_settings
from app.services import drafting_repository as repo
from app.services.drafting_schemas import (
    PlaceholderSchema,
    SectionSchema,
    TemplateStructure,
    TextFormatSchema,
)
from app.services.drafting_monolithic import (
    MonolithicDraftContext,
    MonolithicDraftingStrategy,
)
from app.services.drafting_prompts import (
    ANALYSIS_SYSTEM_PROMPT,
    DRAFTING_SYSTEM_PROMPT,
    FACT_EXTRACTION_PROMPT,
    GROUNDING_AUDIT_PROMPT,
    MONOLITHIC_DRAFTING_SYSTEM_PROMPT,
)
from app.services.drafting_strategies import (
    build_consistency_context,
    filter_facts_for_section,
    log_section_call_boundary,
    resolve_strategy,
)
from app.services.draft_facts import (
    _ANNEXURE_RE,
    _PARA_NUM_RE,
    _build_doc_state,
    _build_factual_manifest,
    _extract_matrix_rows,
    _field_coverage_for_prompt,
    _interest_pairing_for_prompt,
    _plan_exhibits,
    _strip_markdown_artifacts,
)
from app.services.draft_repairs import (
    _PARA_LINE_FULL_RE,
    _PARA_REF_RE,
    _factual_strength_lint,
    _monolithic_deterministic_repairs,
    _table_mark_collisions,
)
from app.services.draft_grounded_extraction import (
    extract_grounded_fields,
    render_verified_fields_block,
    summarize_field_review,
    validate_extracted_fields,
)
from app.services.draft_ingestion import run_ingestion_check
from app.services.draft_run_log import DraftRunLogger
from app.services.draft_verification import run_discrepancy_review
from app.services.drafting_strategy_base import DraftMetadata
from app.services.gcs_service import download_object_buffer, upload_file_to_gcs
from app.services.llm_service import build_model_list
from app.services.llm_usage_service import log_llm_usage

logger = logging.getLogger(__name__)

# ── Limits / tuning ────────────────────────────────────────────────────────
MAX_TEMPLATE_BYTES = 20 * 1024 * 1024          # 20 MB template ceiling
MAX_SUPPORT_DOC_BYTES = 50 * 1024 * 1024       # 50 MB per supporting doc
MAX_SUPPORT_DOCS = 50
FACT_DIGEST_MAX_OUTPUT_TOKENS = 65536         # exhaustive matrix + inventory pass

# ── Long-draft controls ────────────────────────────────────────────────────
# Target total draft length in words (~400 words/page court format → default
# 8000 words ≈ 20+ pages). A floor only where the facts support it: expansion
# is coverage-driven, never padding.
DRAFT_MIN_TOTAL_WORDS = int(os.environ.get("DRAFT_MIN_TOTAL_WORDS", "8000"))
EXPANSION_TRIGGER_RATIO = 0.6                  # expand a narrative section below 60% of its floor
MAX_SECTION_MIN_WORDS = 3000                   # per-section floor ceiling
GROUNDING_AUDIT_ENABLED = os.environ.get("DRAFT_GROUNDING_AUDIT", "true").strip().lower() not in ("false", "0", "no")
MAX_AUDIT_REPAIRS = 8                          # sections repaired per audit round
# Monolithic LLM audit + full-document revision. Default OFF — after the draft
# streams, only free deterministic repairs run so the UI stops and cost does not
# keep climbing. Set DRAFT_MONO_AUDIT=true to re-enable the expensive pass.
MONO_AUDIT_ENABLED = os.environ.get("DRAFT_MONO_AUDIT", "false").strip().lower() in ("true", "1", "yes")
DRAFT_MONO_AUDIT_MODEL = os.environ.get("DRAFT_MONO_AUDIT_MODEL", "gemini-3-flash-preview").strip()
# Hard cap so a hung/truncated audit cannot burn minutes + tokens after draft.
MONO_AUDIT_TIMEOUT_S = int(os.environ.get("DRAFT_MONO_AUDIT_TIMEOUT_SECONDS", "45"))
# Never skip the librarian fact-extraction pass when documents exist unless
# explicitly experimenting (Gemini-only raw-doc single call). Default false.
MONO_SKIP_EXTRACTION = os.environ.get("DRAFT_MONO_SKIP_EXTRACTION", "false").strip().lower() in ("true", "1", "yes")
# Attach verbatim source-document text to Stage 2 so the drafter can verify the
# inventory against the originals. Gemini: on by default (cheap). Claude: OFF by
# default — re-dumping PDFs as text often adds 30–50k input tokens at Sonnet/Opus
# rates and dominates run cost when a fact digest already exists. Opt in with
# DRAFT_MONO_CLAUDE_ATTACH_SOURCE_DOCS=true (still capped tightly below).
MONO_ATTACH_SOURCE_DOCS = os.environ.get("DRAFT_MONO_ATTACH_SOURCE_DOCS", "true").strip().lower() not in ("false", "0", "no")
MONO_CLAUDE_ATTACH_SOURCE_DOCS = os.environ.get(
    "DRAFT_MONO_CLAUDE_ATTACH_SOURCE_DOCS", "false"
).strip().lower() in ("true", "1", "yes")
# Tight caps when Claude does attach source text (chars, not tokens).
MONO_CLAUDE_SOURCE_MAX_PER_DOC = int(os.environ.get("DRAFT_MONO_CLAUDE_SOURCE_MAX_PER_DOC", "6000"))
MONO_CLAUDE_SOURCE_MAX_TOTAL = int(os.environ.get("DRAFT_MONO_CLAUDE_SOURCE_MAX_TOTAL", "20000"))
# ── 4-stage zero-hallucination pipeline (monolithic strategy) ──
# Stage 1 ingestion check (fail-loud, OCR flags, batch plan) → Stage 2
# grounded extraction (response_schema, cited, programmatically validated) →
# Stage 3 draft from verified facts → Stage 4 adversarial verification
# (report-only discrepancy report). The staging is a deliberate
# anti-hallucination measure — never collapse it back into one call.
GROUNDED_PIPELINE_ENABLED = os.environ.get(
    "DRAFT_GROUNDED_PIPELINE", "true"
).strip().lower() not in ("false", "0", "no")
DISCREPANCY_TIMEOUT_S = int(os.environ.get("DRAFT_DISCREPANCY_TIMEOUT_SECONDS", "90"))
# Fact extraction is mechanical verbatim copying — route it to a cheap fast
# model instead of the (often expensive) session model. Biggest input of the
# whole pipeline is the raw documents read here, ONCE.
DRAFT_EXTRACT_MODEL = os.environ.get("DRAFT_EXTRACT_MODEL", "gemini-3-flash-preview").strip()
# Abort a Gemini stream that goes silent (hung connection = the "blinking
# cursor forever" stall). The strategy then falls to the next model in chain.
DRAFT_STREAM_INACTIVITY_S = int(os.environ.get("DRAFT_STREAM_INACTIVITY_SECONDS", "180"))

_NARRATIVE_KEYWORDS = (
    "facts", "fact", "background", "dispute", "grounds",
    "breach", "details", "submission", "events", "history", "circumstances",
)
# Legal-ingredient sections: state a legal element concisely and anchor it to
# earlier paragraphs — they must NEVER be word-count expanded (bloat = defect).
_INGREDIENT_KEYWORDS = (
    "cause of action", "limitation", "jurisdiction", "valuation",
    "maintainability", "court fee", "notice under",
)
_LIGHT_KEYWORDS = (
    "signature", "verification", "prayer", "cause title", "court", "parties",
    "versus", "suit no", "case no", "index", "memo",
    # cause-title party blocks ("Plaintiff Details") — short by convention,
    # must never be word-count expanded
    "plaintiff detail", "defendant detail", "petitioner detail", "respondent detail",
    "appellant detail", "address for service",
)
MAX_SECTIONS = 200                             # hard cap against degenerate analyses
CACHE_MIN_TOKENS = 4096                        # below this, inline parts are cheaper than a cache
CONTINUATION_ATTEMPTS = 2                      # extra calls when a section hits MAX_TOKENS
ANALYSIS_MAX_OUTPUT_TOKENS = 65536             # long templates need the full budget
# Structural analysis is a one-shot extraction pass — always use a fast Flash model,
# not the user's drafting model (Pro can take 2× longer and is unnecessary here).
ANALYSIS_MODEL = os.environ.get("DRAFT_ANALYSIS_MODEL", "gemini-2.5-flash-lite").strip()
ANALYSIS_TIMEOUT_SECONDS = int(os.environ.get("DRAFT_ANALYSIS_TIMEOUT_SECONDS", "480"))
CONTINUITY_TAIL_CHARS = 1500                   # tail of previous section fed forward — enough to
                                               # carry defined short-forms and numbering forward

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx (converted)
    "application/msword",  # legacy .doc — best-effort text pass-through
    "image/png",
    "image/jpeg",
    "image/tiff",
}

_SECTION_MARKER_RE = re.compile(r"\[/?(?:START|END)_SECTION[_ ]?\w*\]")


# ── Small utilities ────────────────────────────────────────────────────────

def _get_client():
    """Reuse the singleton google-genai client from llm_service."""
    from app.services.llm_service import _get_client as _base
    return _base()


_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def extract_docx_text(data: bytes) -> str:
    """Dependency-free .docx → text (Gemini has no native docx support).

    Reads word/document.xml, emitting paragraph breaks. Tables flatten row-wise.
    """
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        xml = zf.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    lines: list[str] = []
    for para in root.iter(f"{_W_NS}p"):
        runs = [node.text or "" for node in para.iter(f"{_W_NS}t")]
        lines.append("".join(runs))
    return "\n".join(lines)


def _extract_pdf_text(data: bytes) -> Optional[str]:
    """Best-effort raw text from a digitally-born PDF (pypdf) — enables the
    deterministic verbatim re-slice (and therefore mandatory-minified analysis
    output) for PDF templates too. Returns None for scanned/image PDFs."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((p.extract_text() or "") for p in reader.pages[:200])
        return text if len(text.strip()) >= 500 else None
    except Exception as exc:
        logger.debug("PDF text extraction failed: %s", exc)
        return None


def normalize_upload(data: bytes, filename: str, mime_type: str) -> tuple[bytes, str]:
    """Return (bytes, mime) in a Gemini-consumable form; docx is converted to text."""
    mime = (mime_type or "application/octet-stream").split(";")[0].strip().lower()
    lower = (filename or "").lower()
    if mime == _DOCX_MIME or lower.endswith(".docx"):
        try:
            text = extract_docx_text(data)
        except Exception as exc:
            raise ValueError(f"Could not read .docx file '{filename}': {exc}") from exc
        return text.encode("utf-8"), "text/plain"
    if lower.endswith((".txt", ".md")) and mime == "application/octet-stream":
        mime = "text/plain"
    if mime not in ALLOWED_MIME_TYPES:
        raise ValueError(
            f"Unsupported file type '{mime}' for '{filename}'. "
            "Allowed: PDF, DOCX, TXT/MD, PNG, JPEG, TIFF."
        )
    return data, mime


# In-memory blob fallback for local dev without a GCS bucket configured.
_local_blobs: dict[str, bytes] = {}


def store_blob(path: str, data: bytes, mime: str) -> str:
    bucket = get_settings().gcs_bucket_name
    if bucket:
        upload_file_to_gcs(bucket, path, data, mime)
    else:
        logger.warning("GCS_BUCKET_NAME not set — storing drafting blob in memory (dev only)")
        _local_blobs[path] = data
    return path


def load_blob(path: str) -> bytes:
    bucket = get_settings().gcs_bucket_name
    if bucket:
        return download_object_buffer(bucket, path)
    if path in _local_blobs:
        return _local_blobs[path]
    raise FileNotFoundError(f"Drafting blob not found: {path}")


def _strip_section_markers(text: str) -> str:
    """Guardrail: drop framing markers and markdown heading artifacts Claude emits."""
    if not text:
        return text or ""
    text = _SECTION_MARKER_RE.sub("", text)
    return _strip_markdown_artifacts(text)


def compile_draft_markdown(structure: dict[str, Any], sections: list[dict[str, Any]]) -> str:
    """Merge generated sections into one formatted markdown document.

    Shared by the /download route and the chat-history save so the user sees
    the identical compiled document everywhere.
    """
    title = (structure or {}).get("document_title") or "Draft Document"
    parts: list[str] = [f"# {title}\n"]
    for s in sorted(sections or [], key=lambda x: x.get("index", 0)):
        content = (s.get("content") or "").strip()
        if not content:
            continue
        heading = str(s.get("heading") or "")
        # Print the heading only when it is the template's real heading (never
        # derived UI labels) and the drafted text doesn't already start with it.
        if (
            heading
            and s.get("heading_verbatim", True)
            and not content.lstrip().lower().startswith(heading.lower()[:40])
        ):
            level = min(max(int(s.get("heading_level") or 1) + 1, 2), 6)
            parts.append(f"{'#' * level} {heading}\n")
        parts.append(content + "\n")
    return "\n".join(parts)


def _reslice_sections_from_text(structure: TemplateStructure, template_text: str) -> int:
    """Replace model-emitted section text with deterministic verbatim slices.

    Gemini structured output tends to collapse newlines inside JSON string
    fields, which would make the drafter reproduce sections as one long line.
    The model is only trusted for section BOUNDARIES (headings, in order);
    the verbatim text between consecutive headings is sliced from the raw
    template — same approach as the Template Analyzer service.
    Only applicable when the template is text (txt/md/converted docx).
    """
    def _find(needle: str, start: int) -> int:
        needle = (needle or "").strip()
        if not needle:
            return -1
        pos = template_text.find(needle, start)
        if pos != -1:
            return pos
        # Whitespace-insensitive fallback: match the heading with flexible gaps.
        pattern = r"\s*".join(re.escape(tok) for tok in needle.split())
        m = re.compile(pattern, re.IGNORECASE).search(template_text, start)
        return m.start() if m else -1

    starts: list[int] = []
    cursor = 0
    for sec in structure.sections:
        pos = _find(sec.heading, cursor)
        if pos == -1:
            # Try the first line of the model's original_text as an anchor.
            first_line = (sec.original_text or "").strip().splitlines()[0:1]
            pos = _find(first_line[0], cursor) if first_line else -1
        starts.append(pos)
        if pos != -1:
            cursor = pos + 1

    found = 0
    for i, sec in enumerate(structure.sections):
        if starts[i] == -1:
            continue  # heading not found — keep model text rather than guessing
        found += 1
        next_start = next((s for s in starts[i + 1:] if s != -1), len(template_text))
        sec.original_text = template_text[starts[i]:next_start].strip("\n")
    return found


_FAST_HEADING_RE = re.compile(
    r"^\s*(?:"
    r"(?:[IVXLCDM]+\.?\s+)?[A-Z][A-Z0-9 /&(),.'\-]{3,80}"
    r"|(?:\d{1,2}[.)]\s+)?(?:LIST\s+OF\s+DATES|DATES\s+AND\s+EVENTS|FACTS|"
    r"PARTIES|CAUSE\s+OF\s+ACTION|JURISDICTION|LIMITATION|VALUATION|"
    r"PRAYER|VERIFICATION|STATEMENT\s+OF\s+TRUTH|LIST\s+OF\s+DOCUMENTS|"
    r"ANNEXURES?|SCHEDULES?|MEMO\s+OF\s+PARTIES|SYNOPSIS)"
    r")\s*:?\s*$",
    re.I,
)
_PLACEHOLDER_TOKEN_RE = re.compile(
    r"\[[^\]\n]{2,80}\]|\{[^}\n]{2,80}\}|<[^>\n]{2,80}>|_{3,}",
)


def _placeholder_schema(token: str, idx: int) -> PlaceholderSchema:
    label = re.sub(r"[\[\]{}<>_]+", " ", token)
    label = re.sub(r"\s+", " ", label).strip(" :.-") or f"Blank {idx}"
    low = label.lower()
    dtype = "text"
    if "date" in low or "day" in low:
        dtype = "date"
    elif "amount" in low or "rs" in low or "fee" in low or "value" in low:
        dtype = "currency"
    elif "address" in low or "office" in low:
        dtype = "address"
    elif "name" in low or "party" in low or "deponent" in low:
        dtype = "name"
    elif "number" in low or "no" in low:
        dtype = "number"
    return PlaceholderSchema(
        key=f"field_{idx}",
        label=label[:80],
        description=label[:80],
        data_type=dtype,
        required=True,
        original_token=token,
    )


def _detect_placeholders(text: str) -> list[PlaceholderSchema]:
    out: list[PlaceholderSchema] = []
    seen: set[str] = set()
    for m in _PLACEHOLDER_TOKEN_RE.finditer(text or ""):
        tok = m.group(0)
        if tok in seen:
            continue
        seen.add(tok)
        out.append(_placeholder_schema(tok, len(out) + 1))
        if len(out) >= 80:
            break
    return out


def _looks_like_heading(line: str) -> bool:
    s = (line or "").strip().strip("*#")
    if len(s) < 4 or len(s) > 100:
        return False
    if _PLACEHOLDER_TOKEN_RE.fullmatch(s):
        return False
    if _FAST_HEADING_RE.match(s):
        return True
    # Numbered section headings such as "12. Cause of Action" / "14. Prayer".
    if re.match(r"^\d{1,2}[.)]\s+[A-Z][A-Za-z /&(),.'-]{3,80}:?\s*$", s):
        words = re.findall(r"[A-Za-z]{4,}", s)
        return len(words) <= 8
    return False


def _fast_analyze_text_template(template_text: str) -> Optional[TemplateStructure]:
    """Deterministic fast path for DOCX/TXT templates.

    It preserves the uploaded template text exactly and avoids the slow Gemini
    structural-analysis call. If the outline is too weak, callers fall back to
    model analysis.
    """
    text = (template_text or "").replace("\r\n", "\n").replace("\r", "\n")
    if len(text.strip()) < 80:
        return None
    lines = text.splitlines()
    nonempty = [(i, ln.strip()) for i, ln in enumerate(lines) if ln.strip()]
    if not nonempty:
        return None

    heading_idxs = [i for i, ln in nonempty if _looks_like_heading(ln)]
    # Always include a front-matter block before the first detected heading.
    starts: list[tuple[int, str, bool]] = []
    first_heading = heading_idxs[0] if heading_idxs else 0
    if first_heading > 0:
        starts.append((0, "Front Matter", False))
    for i in heading_idxs:
        starts.append((i, lines[i].strip().strip("*#").strip(), True))
    if not starts:
        starts = [(0, nonempty[0][1][:60] or "Document", False)]

    # De-duplicate adjacent false positives and require a useful outline.
    deduped: list[tuple[int, str, bool]] = []
    for item in starts:
        if deduped and item[0] <= deduped[-1][0]:
            continue
        if deduped and item[0] - deduped[-1][0] <= 1 and item[1].lower() == deduped[-1][1].lower():
            continue
        deduped.append(item)
    starts = deduped
    if len(starts) < 3 and len(text) > 2500:
        return None

    title = next(
        (ln for _, ln in nonempty[:12] if not re.search(r"\b(in the|before the|plaintiff|defendant)\b", ln, re.I)),
        nonempty[0][1],
    )[:120]
    sections: list[SectionSchema] = []
    for idx, (line_no, heading, verbatim) in enumerate(starts):
        end_line = starts[idx + 1][0] if idx + 1 < len(starts) else len(lines)
        original = "\n".join(lines[line_no:end_line]).strip("\n")
        if not original.strip():
            continue
        hl = heading.lower()
        contains_table = bool(re.search(r"(?m)^\s*\|.+\|\s*$", original)) or any(
            k in hl for k in ("list of documents", "dates", "events", "schedule", "annexure")
        )
        is_light = _section_kind(heading) == "light"
        sections.append(SectionSchema(
            section_id=f"section_{len(sections) + 1}",
            index=len(sections),
            heading=heading,
            heading_verbatim=verbatim,
            heading_level=1,
            original_text=original,
            summary=re.sub(r"\s+", " ", original)[:120],
            placeholders=_detect_placeholders(original),
            is_boilerplate=is_light,
            estimated_output_tokens=min(4096, max(512, len(original) // 2)),
            heading_format=TextFormatSchema(
                alignment="center" if verbatim and heading.upper() == heading and len(heading) < 60 else "left",
                font_size_pt=12,
                bold=verbatim,
                all_caps=bool(verbatim and heading.upper() == heading),
            ),
            body_format=TextFormatSchema(
                alignment="left" if is_light or contains_table else "justify",
                font_size_pt=12,
            ),
            contains_table=contains_table,
        ))
    if len(sections) < 2:
        return None
    return TemplateStructure(
        document_title=title or "Draft Document",
        document_type=title or "Legal Document",
        jurisdiction_or_domain="",
        layout_notes="Fast local text analysis; exact template text preserved.",
        base_font_family="Times New Roman",
        base_font_size_pt=12,
        title_format=TextFormatSchema(alignment="center", font_size_pt=14, bold=True),
        global_placeholders=[],
        sections=sections[:MAX_SECTIONS],
    )


async def _log_usage(user_id: str, model: str, usage: dict[str, int], endpoint: str, session_id: str) -> None:
    try:
        await log_llm_usage(
            user_id=int(user_id),
            model_name=model,
            input_tokens=usage.get("inputTokens", 0),
            output_tokens=usage.get("outputTokens", 0),
            total_tokens=usage.get("totalTokens", 0),
            endpoint=endpoint,
            session_id=session_id,
        )
    except Exception as exc:  # usage accounting must never break the draft stream
        logger.warning("Drafting usage log failed: %s", exc)


def _usage_from_response(resp: Any) -> dict[str, int]:
    meta = getattr(resp, "usage_metadata", None)
    prompt = int(getattr(meta, "prompt_token_count", 0) or 0)
    out = int(getattr(meta, "candidates_token_count", 0) or 0)
    cached = int(getattr(meta, "cached_content_token_count", 0) or 0)
    total = int(getattr(meta, "total_token_count", 0) or (prompt + out))
    return {"inputTokens": prompt, "outputTokens": out, "totalTokens": total, "cachedTokens": cached}


def _add_usage(sink: Optional[dict[str, int]], usage: Optional[dict[str, Any]]) -> None:
    """Accumulate token usage into a sink dict (input/output/total/cached)."""
    if sink is None or not usage:
        return
    for key in ("inputTokens", "outputTokens", "totalTokens", "cachedTokens"):
        sink[key] = int(sink.get(key, 0)) + int(usage.get(key, 0) or 0)
    # High-water mark of a single call's cached prefix — drives storage estimate.
    sink["cacheHwmTokens"] = max(
        int(sink.get("cacheHwmTokens", 0)), int(usage.get("cachedTokens", 0) or 0)
    )


def _record_call(
    ledger: Optional[list],
    stage: str,
    label: str,
    model: str,
    usage: Optional[dict[str, Any]],
) -> None:
    """Append one API call to the run's cost ledger with its own ₹ cost.

    Stages: analysis · fact_extraction · planning · drafting · expansion ·
    audit · repair · finalization. This is what powers the per-call cost
    breakdown in the UI ("where did the tokens go?").
    """
    if ledger is None or not usage:
        return
    if not any(int(usage.get(k, 0) or 0) for k in ("inputTokens", "outputTokens", "cachedTokens")):
        ledger.append({
            "stage": stage,
            "label": (label or stage)[:90],
            "model": model,
            "input": 0,
            "output": 0,
            "cached": 0,
            "usd": 0.0,
            "inr": 0.0,
            "promptCostUsd": 0.0,
            "cachedCostUsd": 0.0,
            "outputCostUsd": 0.0,
        })
        return
    try:
        from app.services.gemini_pricing import compute_usage_cost
        parts = compute_usage_cost(
            model=model,
            prompt_tokens=int(usage.get("inputTokens", 0)),
            cached_tokens=int(usage.get("cachedTokens", 0)),
            output_tokens=int(usage.get("outputTokens", 0)),
        )
        rate = float(os.environ.get("USD_TO_INR", "95.50"))
        ledger.append({
            "stage": stage,
            "label": (label or stage)[:90],
            "model": model,
            "input": int(usage.get("inputTokens", 0)),
            "output": int(usage.get("outputTokens", 0)),
            "cached": int(usage.get("cachedTokens", 0)),
            "usd": round(parts["queryCost"], 6),
            "inr": round(parts["queryCost"] * rate, 4),
            # Per-pillar cost AT THIS CALL'S OWN MODEL — the final total sums
            # these instead of repricing every stage's tokens under whichever
            # model happens to be selected for drafting (that bug inflated the
            # total: e.g. a cheap Flash analysis call's output tokens billed
            # again at the Pro model's output rate).
            "promptCostUsd": round(parts["promptCost"], 6),
            "cachedCostUsd": round(parts["cachedCost"], 6),
            "outputCostUsd": round(parts["outputCost"], 6),
        })
    except Exception as exc:
        logger.debug("Ledger record failed: %s", exc)


_TEMPLATE_STAGES = {"analysis"}


def _split_template_and_draft_cost(ledger: Optional[list[dict[str, Any]]]) -> dict[str, Any]:
    """Template cost = one-time template-analysis stage (paid once at upload,
    reused for every regeneration). Draft cost = everything else — what a
    regenerate actually costs. Grand total = both, and matches the top-line
    `cost` total exactly (same per-call figures, just partitioned)."""
    rate = float(os.environ.get("USD_TO_INR", "95.50"))
    tpl = {"calls": 0, "input": 0, "output": 0, "cached": 0, "usd": 0.0, "inr": 0.0}
    draft = {"calls": 0, "input": 0, "output": 0, "cached": 0, "usd": 0.0, "inr": 0.0}
    for e in ledger or []:
        bucket = tpl if e.get("stage") in _TEMPLATE_STAGES else draft
        bucket["calls"] += 1
        bucket["input"] += int(e.get("input", 0))
        bucket["output"] += int(e.get("output", 0))
        bucket["cached"] += int(e.get("cached", 0))
        bucket["usd"] += float(e.get("usd", 0.0))
        bucket["inr"] += float(e.get("inr", 0.0))
    for bucket in (tpl, draft):
        bucket["usd"] = round(bucket["usd"], 6)
        bucket["inr"] = round(bucket["inr"], 4)
    return {
        "templateCost": tpl,
        "draftOnlyCost": draft,
        "grandTotal": {
            "usd": round(tpl["usd"] + draft["usd"], 6),
            "inr": round(tpl["inr"] + draft["inr"], 4),
            "usdToInr": rate,
        },
    }


def _ledger_query_cost(ledger: Optional[list[dict[str, Any]]]) -> dict[str, float]:
    """Sum every call's cost at the model IT ACTUALLY RAN ON. This is the
    correct total — compute_draft_cost's single-model repricing of aggregate
    usage is wrong whenever stages use different models (e.g. analysis on
    a cheap Flash model, drafting on Pro/Claude)."""
    prompt = cached = output = 0.0
    for e in ledger or []:
        prompt += float(e.get("promptCostUsd", 0.0))
        cached += float(e.get("cachedCostUsd", 0.0))
        output += float(e.get("outputCostUsd", 0.0))
    return {"promptCost": prompt, "cachedCost": cached, "outputCost": output,
            "queryCost": prompt + cached + output, "newPromptTokens": 0.0}


def _ledger_by_stage(ledger: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Aggregate the call ledger per stage — where input/output tokens go."""
    agg: dict[str, dict[str, Any]] = {}
    for e in ledger:
        a = agg.setdefault(e["stage"], {
            "calls": 0, "input": 0, "output": 0, "cached": 0, "inr": 0.0, "usd": 0.0,
        })
        a["calls"] += 1
        a["input"] += e["input"]
        a["output"] += e["output"]
        a["cached"] += e["cached"]
        a["inr"] = round(a["inr"] + e["inr"], 4)
        a["usd"] = round(a["usd"] + e["usd"], 6)
    return agg


def _usage_delta(before: dict[str, int], after: dict[str, int]) -> dict[str, int]:
    return {k: int(after.get(k, 0)) - int(before.get(k, 0))
            for k in ("inputTokens", "outputTokens", "totalTokens", "cachedTokens")}


def compute_draft_cost(
    model: str,
    usage: dict[str, Any],
    ttl_seconds: int = 1800,
    elapsed_seconds: float = 0.0,
    setup_tokens: int = 0,
    ledger: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Real USD + INR cost breakdown for one draft run, following Gemini's
    three cost pillars:

    A. Cache STORAGE — cache size × storage rate × real lifespan
       (run duration so far + remaining TTL, prorated per hour).
    B. Cache READ (cache hit) — cached tokens at the discounted cached-input
       rate; the remaining prompt tokens at the standard input rate.
    C. Standard INPUT/OUTPUT — output is always billed once at the standard
       output rate; cache-miss input at the full input rate.
    Plus the one-time cache SETUP (creation) cost when an explicit cache is
    written (billed at the input rate), and the SAVINGS the cache produced
    (standard cost without cache − actual cost with cache).

    INR at USD_TO_INR (default 95.50).
    """
    from app.services.gemini_pricing import (
        compute_setup_cost, compute_storage_cost, compute_usage_cost, get_pricing,
    )

    usd_inr = float(os.environ.get("USD_TO_INR", "95.50"))
    inp = int(usage.get("inputTokens", 0))
    out = int(usage.get("outputTokens", 0))
    cached = int(usage.get("cachedTokens", 0))
    hwm = int(usage.get("cacheHwmTokens", 0))

    # B + C — cache-hit reads at cached rate, rest of prompt + output at
    # standard. When a call ledger is available, sum each call's cost at ITS
    # OWN model instead — a multi-model run (e.g. cheap-Flash analysis +
    # Pro/Claude drafting) must never be repriced entirely under one model.
    parts = _ledger_query_cost(ledger) if ledger else compute_usage_cost(
        model=model, prompt_tokens=inp, cached_tokens=cached, output_tokens=out,
    )
    # A — storage prorated over the cache's real committed lifespan:
    # the run's elapsed time plus the TTL it stays alive afterwards.
    lifespan_hours = (max(0.0, elapsed_seconds) + ttl_seconds) / 3600.0
    storage_usd = compute_storage_cost(model, hwm, lifespan_hours)
    # One-time cache creation (explicit caches.create — billed at input rate).
    setup_usd = compute_setup_cost(model, setup_tokens) if setup_tokens else 0.0
    total_usd = parts["queryCost"] + storage_usd + setup_usd

    # Savings: what the cached tokens would have cost at the full input rate,
    # minus what caching actually cost (reads + storage + setup).
    pricing = get_pricing(model, context_token_count=inp)
    without_cache_usd = cached * float(pricing["newInputRate"]) / 1_000_000
    with_cache_usd = parts["cachedCost"] + storage_usd + setup_usd
    savings_usd = max(0.0, without_cache_usd - with_cache_usd)

    def _inr(x: float) -> float:
        return round(x * usd_inr, 2)

    return {
        "model": model,
        "usdToInr": usd_inr,
        "cacheLifespanMinutes": round(lifespan_hours * 60, 1),
        "tokens": {
            "input": inp, "output": out, "cached": cached,
            "newInput": int(parts["newPromptTokens"]), "cacheHwm": hwm,
            "setup": int(setup_tokens),
            "total": int(usage.get("totalTokens", 0)),
        },
        "usd": {
            "input": round(parts["promptCost"], 6),
            "cacheRead": round(parts["cachedCost"], 6),
            "cacheStorage": round(storage_usd, 6),
            "cacheSetup": round(setup_usd, 6),
            "output": round(parts["outputCost"], 6),
            "total": round(total_usd, 6),
            "savings": round(savings_usd, 6),
        },
        "inr": {
            "input": _inr(parts["promptCost"]),
            "cacheRead": _inr(parts["cachedCost"]),
            "cacheStorage": _inr(storage_usd),
            "cacheSetup": _inr(setup_usd),
            "output": _inr(parts["outputCost"]),
            "total": _inr(total_usd),
            "savings": _inr(savings_usd),
        },
    }


def _is_cache_lost_error(exc: Exception) -> bool:
    """True when Gemini reports the explicit context cache expired/was deleted
    mid-run: 403 PERMISSION_DENIED "CachedContent not found"."""
    msg = str(exc)
    return "CachedContent not found" in msg or (
        "PERMISSION_DENIED" in msg and "ached" in msg
    )


def _is_transient_stream_error(exc: Exception) -> bool:
    """True for network blips / Gemini stream drops that are worth retrying."""
    name = type(exc).__name__
    if name in {
        "RemoteProtocolError", "ConnectError", "ReadTimeout", "TimeoutException",
        "ConnectionError", "ProtocolError", "ReadError",
    }:
        return True
    msg = str(exc).lower()
    return any(
        token in msg
        for token in (
            "server disconnected",
            "connection reset",
            "connection aborted",
            "temporarily unavailable",
            "timeout",
            "502",
            "503",
            "504",
        )
    )


def _gemini_models(primary: str) -> list[str]:
    """Model chain for GOOGLE-GENAI call sites (analysis, fact extraction,
    audit, planning, section engine). Claude ids 404 on the Gemini API —
    filter them out; build_model_list always appends Gemini fallbacks, so the
    result is never empty."""
    return [m for m in build_model_list({}, primary)
            if not m.lower().startswith("claude")]


async def _safe_update_session(session_id: str, **fields: Any) -> None:
    """Persist session fields without letting a pool blip kill the SSE stream."""
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, lambda: repo.update_session(session_id, **fields))
    except Exception as exc:
        logger.warning("Draft session update skipped for %s: %s", session_id, exc)


async def _safe_save_draft_section(session_id: str, record: dict[str, Any]) -> None:
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, repo.save_draft_section, session_id, record)
    except Exception as exc:
        logger.warning(
            "Could not persist draft section %s for session %s: %s",
            record.get("section_id"), session_id, exc,
        )


async def _iter_gemini_draft_chunks(
    loop: asyncio.AbstractEventLoop,
    client: Any,
    model: str,
    contents: list[Any],
    config: Any,
    *,
    max_retries: int = 3,
) -> AsyncIterator[dict[str, Any]]:
    """Stream one Gemini call; yields chunk dicts then a terminal ``done`` event."""

    def _pull_chunk(iterator):
        try:
            return next(iterator)
        except StopIteration:
            return None

    last_err: Exception | None = None
    for attempt in range(max_retries):
        yielded_any = False
        try:
            sync_iter = await loop.run_in_executor(
                None,
                lambda m=model, c=contents, cfg=config: client.models.generate_content_stream(
                    model=m, contents=c, config=cfg
                ),
            )
            finish_reason = None
            last_usage: dict[str, int] | None = None
            while True:
                # Watchdog: a hung connection here used to block FOREVER — the
                # "blinking cursor, no text, indefinitely" stall. Now it aborts
                # and the caller falls to the next model in the chain.
                try:
                    chunk = await asyncio.wait_for(
                        loop.run_in_executor(None, _pull_chunk, sync_iter),
                        timeout=DRAFT_STREAM_INACTIVITY_S,
                    )
                except asyncio.TimeoutError:
                    raise RuntimeError(
                        f"Gemini stream stalled — no data for {DRAFT_STREAM_INACTIVITY_S}s "
                        f"(model={model})"
                    ) from None
                if chunk is None:
                    break
                raw = getattr(chunk, "text", None) or ""
                if raw:
                    yielded_any = True
                    yield {"kind": "chunk", "text": _strip_section_markers(raw)}
                cands = getattr(chunk, "candidates", None)
                if cands:
                    finish_reason = getattr(cands[0], "finish_reason", None)
                if getattr(chunk, "usage_metadata", None):
                    last_usage = _usage_from_response(chunk)
            yield {"kind": "done", "finish_reason": finish_reason, "usage": last_usage}
            return
        except Exception as exc:
            last_err = exc
            if yielded_any:
                # Chunks already reached the consumer: a silent retry would
                # re-emit the document from the start and duplicate content.
                raise
            if _is_transient_stream_error(exc) and attempt < max_retries - 1:
                wait_s = 1.5 * (attempt + 1)
                logger.warning(
                    "Gemini stream transient error (model=%s, attempt=%s/%s): %s — retrying in %.1fs",
                    model, attempt + 1, max_retries, exc, wait_s,
                )
                await asyncio.sleep(wait_s)
                continue
            raise
    raise RuntimeError(f"Gemini stream failed after {max_retries} attempts: {last_err}")


# ══════════════════════════════════════════════════════════════════════════
# Stage 1 — async Template Structural Analyst worker
# ══════════════════════════════════════════════════════════════════════════

# Keep strong references to fire-and-forget analysis tasks (asyncio only holds weakrefs).
_analysis_tasks: set[asyncio.Task] = set()


def schedule_template_analysis(session_id: str, user_id: str, model_hint: Optional[str] = None) -> None:
    """Kick the analysis worker without blocking the upload response.

    The codebase uses asyncio throughout (no Celery/BullMQ); a supervised
    asyncio.Task is the idiomatic async worker here. Status is polled via
    GET /api/chat/draft/{session_id}.
    """
    task = asyncio.create_task(analyze_template_task(session_id, user_id))
    _analysis_tasks.add(task)
    task.add_done_callback(_analysis_tasks.discard)


async def resume_interrupted_analyses() -> int:
    """Re-queue sessions stuck in ``analyzing`` after a process restart.

    Uvicorn reload kills in-flight asyncio tasks without updating DB status;
    this runs on startup so uploads survive dev hot-reloads.
    """
    loop = asyncio.get_running_loop()
    rows = await loop.run_in_executor(None, repo.list_sessions_by_status, "analyzing", 100)
    for row in rows:
        sid, uid = str(row["id"]), row["user_id"]
        logger.info("Resuming interrupted template analysis for session %s", sid)
        schedule_template_analysis(sid, uid)
    return len(rows)


async def analyze_template_task(session_id: str, user_id: str) -> None:
    loop = asyncio.get_running_loop()
    try:
        logger.info(
            "Template analysis started: session=%s model=%s timeout=%ss",
            session_id, ANALYSIS_MODEL, ANALYSIS_TIMEOUT_SECONDS,
        )
        session = await loop.run_in_executor(None, repo.get_session, session_id, user_id)
        if not session or not session.get("template_file"):
            raise RuntimeError("Session or template file missing")
        tf = session["template_file"]
        data = await loop.run_in_executor(None, load_blob, tf["gcs_path"])

        # Re-sliceable raw text: text/DOCX always; PDFs when digitally born
        # (pypdf). With raw text available, the analyzer's original_text echo
        # is MANDATORY-MINIFIED (first line + … + last line) — the dominant
        # output-token cost of analysis drops ~80%.
        raw_text: Optional[str] = None
        if tf["mime_type"] in ("text/plain", "text/markdown"):
            raw_text = data.decode("utf-8", errors="replace")
        elif tf["mime_type"] == "application/pdf":
            raw_text = await loop.run_in_executor(None, _extract_pdf_text, data)

        analysis_usage: dict[str, int] = {
            "inputTokens": 0, "outputTokens": 0, "totalTokens": 0, "cachedTokens": 0,
        }
        analysis_model_used = ANALYSIS_MODEL
        structure = None
        if raw_text and tf["mime_type"] in ("text/plain", "text/markdown"):
            structure = _fast_analyze_text_template(raw_text)
            if structure:
                analysis_model_used = "local-fast-template-analyzer"
                logger.info(
                    "Template analysis fast-path: session=%s sections=%s",
                    session_id, len(structure.sections),
                )
        if structure is None:
            structure, analysis_usage = await _analyze_template(
                data, tf["mime_type"], ANALYSIS_MODEL, allow_abbrev=bool(raw_text),
            )

        if raw_text:
            try:
                found = _reslice_sections_from_text(structure, raw_text)
                if found < max(1, int(0.6 * len(structure.sections))):
                    # Abbreviated skeletons + failed re-slice = broken format
                    # guide. Fall back to one full-verbatim analysis pass.
                    logger.warning(
                        "Re-slice matched only %s/%s sections — re-analyzing verbatim",
                        found, len(structure.sections),
                    )
                    structure, usage2 = await _analyze_template(
                        data, tf["mime_type"], ANALYSIS_MODEL, allow_abbrev=False,
                    )
                    analysis_model_used = ANALYSIS_MODEL
                    _add_usage(analysis_usage, usage2)
                    _reslice_sections_from_text(structure, raw_text)
            except Exception:
                logger.exception("Verbatim re-slice failed; keeping model-emitted section text")

        if tf["mime_type"] in ("text/plain", "text/markdown"):
            # Plain text has no observable alignment — enforce the court default
            # deterministically: running prose is JUSTIFIED; only light blocks
            # (signature, cause title, party details…) stay left.
            for sec in structure.sections:
                if _section_kind(sec.heading) != "light" and not sec.contains_table:
                    if sec.body_format and sec.body_format.alignment == "left":
                        sec.body_format.alignment = "justify"

        if len(structure.sections) > MAX_SECTIONS:
            structure.sections = structure.sections[:MAX_SECTIONS]
            logger.warning("Template analysis capped at %s sections", MAX_SECTIONS)

        await loop.run_in_executor(
            None,
            lambda: repo.update_session(
                session_id,
                status="ready",
                template_structure=structure.model_dump(),
                # Analysis happens in its own request — persist its usage so the
                # generation run's cost ledger can include it.
                template_file={**tf, "analysis_usage": analysis_usage,
                               "analysis_model": analysis_model_used},
                error=None,
            ),
        )
        logger.info("Template analysis done: session=%s sections=%s", session_id, len(structure.sections))
    except Exception as exc:
        logger.exception("Template analysis failed for session %s", session_id)
        try:
            await loop.run_in_executor(
                None,
                lambda: repo.update_session(session_id, status="analysis_failed", error=str(exc)[:2000]),
            )
        except Exception:
            logger.exception("Could not persist analysis failure state")


async def _analyze_template(
    data: bytes, mime_type: str, model_hint: Optional[str],
    allow_abbrev: bool = False,
) -> TemplateStructure:
    """One structured-output Gemini call with the service's model-fallback chain."""
    from google.genai import types as gt

    client = _get_client()
    if allow_abbrev:
        # Verbatim section text is re-sliced deterministically from the raw file
        # afterwards, so echoing it in the JSON is pure output-token waste.
        instruction = (
            "Analyze this template and return its full structural layout. "
            "MANDATORY MINIFICATION: `original_text` MUST contain ONLY the section's "
            "first line, then the literal character '…', then its last line — NEVER "
            "the middle text (the system reconstructs verbatim text deterministically "
            "from the raw file). Headings must stay exact and complete. The section "
            "LIST itself must be complete and fine-grained, covering the entire "
            "template from first character to last."
        )
    else:
        instruction = (
            "Analyze this template and return its full structural layout with "
            "complete verbatim original_text for every section."
        )
    parts = [
        gt.Part.from_bytes(data=data, mime_type=mime_type),
        gt.Part(text=instruction),
    ]
    contents = [gt.Content(role="user", parts=parts)]
    config = gt.GenerateContentConfig(
        system_instruction=ANALYSIS_SYSTEM_PROMPT,
        temperature=0.0,                      # deterministic structural extraction
        max_output_tokens=ANALYSIS_MAX_OUTPUT_TOKENS,
        response_mime_type="application/json",
        response_schema=TemplateStructure,    # google-genai enforces the JSON schema
    )

    loop = asyncio.get_running_loop()
    last_err: Exception | None = None
    for model in _gemini_models(model_hint):
        try:
            resp = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda m=model: client.models.generate_content(
                        model=m, contents=contents, config=config
                    ),
                ),
                timeout=ANALYSIS_TIMEOUT_SECONDS,
            )
            parsed = getattr(resp, "parsed", None)
            if isinstance(parsed, TemplateStructure):
                structure = parsed
            else:  # SDK returned raw JSON text — validate manually
                structure = TemplateStructure.model_validate_json(resp.text or "")
            if not structure.sections:
                raise ValueError("Analysis returned zero sections")
            # Re-number defensively: downstream generation trusts index order.
            for i, sec in enumerate(sorted(structure.sections, key=lambda s: s.index)):
                sec.index = i
                if not sec.section_id:
                    sec.section_id = f"section_{i + 1}"
            structure.sections.sort(key=lambda s: s.index)
            return structure, _usage_from_response(resp)
        except asyncio.TimeoutError:
            last_err = TimeoutError(
                f"Template analysis timed out after {ANALYSIS_TIMEOUT_SECONDS}s (model={model})"
            )
            logger.warning("Template analysis model %s timed out after %ss", model, ANALYSIS_TIMEOUT_SECONDS)
        except Exception as exc:
            last_err = exc
            logger.warning("Template analysis model %s failed: %s", model, exc)
    raise RuntimeError(f"Template analysis failed on all models: {last_err}")


# ══════════════════════════════════════════════════════════════════════════
# Stage 2 — supporting-docs context (explicit cache when large, inline otherwise)
# ══════════════════════════════════════════════════════════════════════════

def _doc_parts(docs: list[dict[str, Any]]) -> list[Any]:
    from google.genai import types as gt

    parts: list[Any] = []
    for doc in docs:
        data = load_blob(doc["gcs_path"])
        parts.append(gt.Part(text=f"===== SUPPORTING DOCUMENT: {doc['name']} ====="))
        parts.append(gt.Part.from_bytes(data=data, mime_type=doc["mime_type"]))
    return parts


def _docs_as_grounding_text(
    docs: list[dict[str, Any]],
    max_chars_per_doc: int = 60_000,
    max_total: int = 220_000,
) -> str:
    """Plain-text extracts of supporting docs for Stage 2 (Gemini + Claude parity).

    Used so the monolithic drafter can verify the FACT INVENTORY against the
    originals and recover fields the librarian missed — without Gemini-only
    multimodal parts that Claude cannot read.
    """
    if not docs:
        return ""
    blocks: list[str] = []
    total = 0
    for doc in docs:
        name = str(doc.get("name") or "document").strip() or "document"
        if not doc.get("gcs_path"):
            continue
        try:
            data = load_blob(doc["gcs_path"])
            mime = (doc.get("mime_type") or "").lower()
            text = ""
            if "pdf" in mime or name.lower().endswith(".pdf"):
                text = _extract_pdf_text(data) or ""
            elif "word" in mime or name.lower().endswith(".docx"):
                try:
                    text = extract_docx_text(data)
                except Exception:
                    text = ""
            else:
                text = data.decode("utf-8", errors="replace")
            text = re.sub(r"\s+\n", "\n", (text or "").strip())
            if not text:
                continue
            if len(text) > max_chars_per_doc:
                text = text[:max_chars_per_doc] + "\n…[truncated for length]"
            block = f"===== SOURCE DOCUMENT: {name} =====\n{text}"
            if total + len(block) > max_total:
                remain = max_total - total - 80
                if remain > 500:
                    blocks.append(block[:remain] + "\n…[truncated — corpus cap]")
                break
            blocks.append(block)
            total += len(block)
        except Exception as exc:
            logger.debug("Grounding text skipped for %s: %s", name, exc)
    return "\n\n".join(blocks)


async def prepare_supporting_context(
    session_id: str,
    docs: list[dict[str, Any]],
    model: str,
    pinned_text: str = "",
    system_instruction: str = "",
) -> tuple[Optional[str], Optional[list[Any]], int]:
    """Return (cache_name, inline_parts) — exactly one of the two is set.

    Large corpora go into a Gemini explicit context cache (created once, reused
    for every section call — the dominant cost saver for a 100-page draft).
    Small corpora are cheaper inline, and some corpora are below the API's
    minimum cacheable token count anyway.
    """
    from google.genai import types as gt

    from google.genai import types as _gt

    if not docs and not pinned_text:
        return None, [], 0

    loop = asyncio.get_event_loop()
    client = _get_client()
    parts = await loop.run_in_executor(None, _doc_parts, docs) if docs else []
    # SPEC 3: the stable global block (document outline + complete fact
    # inventory) goes at the VERY BEGINNING of the cached prefix — written to
    # cache once, billed as 'cache read' on every one of the ~49 section calls.
    if pinned_text:
        parts = [_gt.Part(text=pinned_text), *parts]

    try:
        count = await loop.run_in_executor(
            None,
            lambda: client.models.count_tokens(
                model=model, contents=[gt.Content(role="user", parts=parts)]
            ),
        )
        total_tokens = int(getattr(count, "total_tokens", 0) or 0)
    except Exception as exc:
        logger.warning("count_tokens failed (%s) — using inline context", exc)
        return None, parts, 0

    if total_tokens < CACHE_MIN_TOKENS:
        return None, parts, 0

    ttl = max(get_settings().context_cache_ttl_seconds, 3600)  # long multi-section runs
    try:
        cache = await loop.run_in_executor(
            None,
            lambda: client.caches.create(
                model=model,
                config=gt.CreateCachedContentConfig(
                    display_name=f"drafting-{session_id}",
                    # System prompt lives IN the cache: generate calls that use
                    # cached_content must not pass their own system_instruction.
                    system_instruction=system_instruction or DRAFTING_SYSTEM_PROMPT,
                    contents=[gt.Content(role="user", parts=parts)],
                    ttl=f"{ttl}s",
                ),
            ),
        )
        logger.info(
            "Context cache created for session %s: %s (%s tokens)",
            session_id, cache.name, total_tokens,
        )
        await loop.run_in_executor(
            None, lambda: repo.update_session(session_id, cache_name=cache.name)
        )
        return cache.name, None, total_tokens
    except Exception as exc:
        # Cache creation can fail (model below min tokens, quota, region) — degrade
        # gracefully to inline parts rather than failing the draft.
        logger.warning("Context cache creation failed (%s) — using inline context", exc)
        return None, parts, 0


async def build_facts_digest(
    session_id: str,
    docs: list[dict[str, Any]],
    model: str,
    existing: Optional[str] = None,
    usage_sink: Optional[dict[str, int]] = None,
) -> str:
    """Exhaustive fact-inventory pass over ALL supporting documents.

    Runs once per session (cached in drafting_sessions.facts_digest; cleared
    when documents change). The digest is injected into every section prompt so
    the drafter works from a complete, pre-extracted fact list instead of
    re-mining N raw documents per section — this is what makes long drafts use
    ALL the data instead of whatever the model happens to attend to.
    """
    if existing and existing.strip():
        return existing
    if not docs:
        return ""

    from google.genai import types as gt

    loop = asyncio.get_event_loop()
    client = _get_client()
    parts = await loop.run_in_executor(None, _doc_parts, docs)
    parts.append(gt.Part(text=(
        f"Extract the complete fact inventory from the {len(docs)} supporting "
        "document(s) above. Be exhaustive — every fact, no omissions."
    )))
    config = gt.GenerateContentConfig(
        system_instruction=FACT_EXTRACTION_PROMPT,
        temperature=0.0,
        max_output_tokens=FACT_DIGEST_MAX_OUTPUT_TOKENS,
    )
    contents = [gt.Content(role="user", parts=parts)]

    last_err: Exception | None = None
    for m in _gemini_models(DRAFT_EXTRACT_MODEL):
        try:
            resp = await loop.run_in_executor(
                None,
                lambda mm=m: client.models.generate_content(model=mm, contents=contents, config=config),
            )
            digest = (resp.text or "").strip()
            if digest:
                _add_usage(usage_sink, _usage_from_response(resp))
                await _safe_update_session(session_id, facts_digest=digest)
                logger.info("Facts digest built for session %s (%s chars)", session_id, len(digest))
                return digest
        except Exception as exc:
            last_err = exc
            logger.warning("Facts digest model %s failed: %s", m, exc)
    logger.warning("Facts digest unavailable (%s) — sections will rely on raw docs only", last_err)
    return ""


def _delete_paragraph_containing(text: str, quote: str) -> Optional[str]:
    """Remove the whole numbered paragraph containing `quote` (whitespace-tolerant).
    Returns new text, or None if the quote can't be located."""
    if not quote or not text:
        return None
    norm = re.sub(r"\s+", " ", quote).strip()[:80]
    hay = re.sub(r"\s+", " ", text)
    pos_norm = hay.find(norm)
    if pos_norm == -1:
        return None
    # map normalized position back: count non-space chars
    nonspace_target = len(re.sub(r"\s", "", hay[:pos_norm]))
    count = 0
    pos = 0
    for i, ch in enumerate(text):
        if not ch.isspace():
            count += 1
            if count > nonspace_target:
                pos = i
                break
    # paragraph boundaries: previous numbered-line start (or blank line) → next
    start_matches = [m.start() for m in _PARA_LINE_FULL_RE.finditer(text) if m.start() <= pos]
    start = start_matches[-1] if start_matches else text.rfind("\n\n", 0, pos) + 1
    nxt = _PARA_LINE_FULL_RE.search(text, pos)
    end = nxt.start() if nxt else len(text)
    return (text[:start].rstrip() + "\n\n" + text[end:].lstrip()).strip()


def _structural_lint(all_secs: list[dict[str, Any]]) -> list[Any]:
    """Deterministic (non-LLM) structural checks on the compiled draft.

    Catches the review defects prompting alone can't guarantee away:
    duplicate paragraph numbers, annexure marks referenced but never annexed,
    and gaps in the annexure series. Findings feed the same repair loop as
    grounding-audit violations.
    """
    from app.services.drafting_schemas import GroundingViolation

    findings: list[Any] = []

    # ── Numbering: exact duplicate paragraph-number tokens across the draft ──
    token_locations: dict[str, list[str]] = {}
    for s in sorted(all_secs, key=lambda x: x.get("index", 0)):
        sid = str(s.get("section_id"))
        for m in _PARA_NUM_RE.finditer(s.get("content") or ""):
            token = f"{m.group(1)}.{m.group(2)}" if m.group(2) else m.group(1)
            token_locations.setdefault(token, []).append(sid)
    for token, sids in token_locations.items():
        if len(sids) > 1:
            findings.append(GroundingViolation(
                section_id=sids[-1],
                quote=f"paragraph number {token}.",
                problem=(
                    f"Duplicate paragraph number: '{token}.' already used earlier "
                    f"(sections {', '.join(dict.fromkeys(sids))}). Renumber this section "
                    "to continue the document-wide sequence without reuse."
                ),
            ))

    # ── Exhibits: orphan references and gaps in the annexure series ──
    full_text_by_sec = {str(s.get("section_id")): (s.get("content") or "") for s in all_secs}
    introduced: set[str] = set()
    referenced: dict[str, str] = {}  # mark -> first section that references it
    numeric_suffixes: list[int] = []
    for sid, text in full_text_by_sec.items():
        for m in _ANNEXURE_RE.finditer(text):
            mark = m.group(1).upper()
            referenced.setdefault(mark, sid)
            window = text[max(0, m.start() - 90):m.end() + 90].lower()
            # Formal introduction: "annexed hereto/herewith … marked as ANNEXURE …"
            if "annexed" in window or "marked as" in window:
                introduced.add(mark)
            num = re.search(r"(\d+)$", mark)
            if num:
                numeric_suffixes.append(int(num.group(1)))
    for mark, sid in referenced.items():
        if mark not in introduced:
            findings.append(GroundingViolation(
                section_id=sid,
                quote=f"ANNEXURE {mark}",
                problem=(
                    f"ANNEXURE {mark} is referenced but never formally annexed. At its FIRST "
                    "mention add '(annexed hereto and marked as ANNEXURE "
                    f"{mark})' identifying which document it is."
                ),
            ))
    if numeric_suffixes:
        have = set(numeric_suffixes)
        missing = [n for n in range(1, max(have) + 1) if n not in have]
        if missing and referenced:
            some_sid = next(iter(referenced.values()))
            findings.append(GroundingViolation(
                section_id=some_sid,
                quote=f"annexure series gap: missing {', '.join(str(n) for n in missing)}",
                problem=(
                    "The annexure series has gaps (marks skip numbers). Renumber the marks "
                    "in this section so the series runs P-1, P-2, … without gaps."
                ),
            ))

    # ── Terminology: never mix "ANNEXURE P-#" and "Exhibit P-#" ──
    joined = "\n".join(full_text_by_sec.values())
    if re.search(r"\bANNEXURE\s+P-?\d+", joined, re.I) and re.search(r"\bEXHIBIT\s+P-?\d+", joined, re.I):
        for sid, text in full_text_by_sec.items():
            m = re.search(r"\bEXHIBIT\s+P-?\d+", text, re.I)
            if m:
                findings.append(GroundingViolation(
                    section_id=sid,
                    quote=m.group(0),
                    problem=(
                        "Mixed exhibit terminology: the draft uses both 'ANNEXURE P-#' and "
                        "'Exhibit P-#'. Rewrite using 'ANNEXURE P-#' consistently."
                    ),
                ))
                break
    return findings


async def _run_grounding_audit(
    facts_digest: str, draft_blob: str, model: str,
    usage_sink: Optional[dict[str, int]] = None,
    exhibit_register: str = "",
    timeout_s: Optional[float] = None,
):
    """Structured-output verifier: grounding + exhibit-mapping consistency."""
    from google.genai import types as gt

    from app.services.drafting_schemas import GroundingAuditReport

    client = _get_client()
    loop = asyncio.get_event_loop()
    # Cap draft size so the JSON audit response fits and does not hang/truncate
    draft_for_audit = draft_blob or ""
    if len(draft_for_audit) > 80_000:
        draft_for_audit = draft_for_audit[:80_000] + "\n…[draft truncated for audit]"
    digest_for_audit = facts_digest or ""
    if len(digest_for_audit) > 40_000:
        digest_for_audit = digest_for_audit[:40_000] + "\n…[inventory truncated for audit]"
    register_block = (
        f"EXHIBIT REGISTER (marks assigned in this draft):\n{exhibit_register}\n\n"
        if exhibit_register else "EXHIBIT REGISTER: (no annexure marks assigned)\n\n"
    )
    contents = [gt.Content(role="user", parts=[gt.Part(text=(
        f"FACT INVENTORY:\n<<<FACTS\n{digest_for_audit}\nFACTS>>>\n\n"
        f"{register_block}"
        f"DRAFT (sections identified by [SECTION id]):\n<<<DRAFT\n{draft_for_audit}\nDRAFT>>>\n"
        "Audit the draft now (grounding + exhibit mapping). Return COMPLETE valid JSON only."
    ))])]
    config = gt.GenerateContentConfig(
        system_instruction=GROUNDING_AUDIT_PROMPT,
        temperature=0.0,
        max_output_tokens=8192,
        response_mime_type="application/json",
        response_schema=GroundingAuditReport,
    )
    limit = timeout_s if timeout_s is not None else float(MONO_AUDIT_TIMEOUT_S)

    async def _one(mm: str):
        return await loop.run_in_executor(
            None,
            lambda: client.models.generate_content(model=mm, contents=contents, config=config),
        )

    for m in _gemini_models(model)[:2]:  # at most two cheap attempts — no long fallback chain
        try:
            resp = await asyncio.wait_for(_one(m), timeout=limit)
            _add_usage(usage_sink, _usage_from_response(resp))
            parsed = getattr(resp, "parsed", None)
            if isinstance(parsed, GroundingAuditReport):
                return parsed
            return GroundingAuditReport.model_validate_json(resp.text or "")
        except asyncio.TimeoutError:
            logger.warning("Grounding audit model %s timed out after %.0fs", m, limit)
        except Exception as exc:
            logger.warning("Grounding audit model %s failed: %s", m, exc)
    return None


async def delete_context_cache(cache_name: str) -> None:
    if not cache_name:
        return
    try:
        client = _get_client()
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: client.caches.delete(name=cache_name)
        )
    except Exception as exc:
        logger.warning("Failed to delete drafting cache %s: %s", cache_name, exc)


_ANNEX_TOKEN_RE = re.compile(r"(ANNEXURE\s+P-)(\d+)", re.I)


def _normalize_draft(all_secs: list[dict[str, Any]]) -> dict[str, str]:
    """Deterministic post-generation normalization — the fixes prompting can't
    guarantee across independently-drafted sections:

    1. CONTINUOUS PARAGRAPH RENUMBERING — when any main paragraph number is
       used twice document-wide (parallel workers each following the template
       sample's numbers), renumber mains sequentially 1..N in section order,
       carry sub-numbers (5.3 → k.3), and remap in-text cross-references
       ("as pleaded in paragraph 12") via the first-occurrence mapping.
    2. ANNEXURE SERIES COMPACTION — if the used marks skip numbers
       (P-1, P-3, P-5…), renumber the series consecutively by first
       appearance, updating every reference.

    Returns {section_id: new_content} for changed sections only.
    """
    ordered = sorted(all_secs, key=lambda x: x.get("index", 0))
    texts: dict[str, str] = {
        str(s.get("section_id")): (s.get("content") or "") for s in ordered
    }
    original = dict(texts)

    # Attestation documents (Statement of Truth, affidavits) are SEPARATE
    # instruments: they restart numbering at 1 and are excluded from the
    # plaint's continuous sequence.
    def _num_scope(s: dict[str, Any]) -> str:
        h = str(s.get("heading", "")).lower()
        return "attest" if any(k in h for k in ("statement of truth", "affidavit", "vakalat")) else "body"

    # ── duplicate detection: body-scope first-appearance main numbers ──
    all_mains: list[int] = []
    for s in ordered:
        if _num_scope(s) != "body":
            continue
        seen_local: list[int] = []
        for m in _PARA_LINE_FULL_RE.finditer(texts[str(s.get("section_id"))]):
            om = int(m.group(2))
            if om not in seen_local:
                seen_local.append(om)
        all_mains.extend(seen_local)
    if all_mains and len(all_mains) != len(set(all_mains)):
        counter = 0
        ref_map: dict[int, int] = {}
        for s in ordered:
            if _num_scope(s) != "body":
                continue
            sid = str(s.get("section_id"))
            local_map: dict[int, int] = {}

            def _line(m):
                nonlocal counter
                om = int(m.group(2))
                if om not in local_map:
                    counter += 1
                    local_map[om] = counter
                    ref_map.setdefault(om, counter)
                nm = local_map[om]
                sub = m.group(3)
                mid = f"{nm}.{sub}" if sub else f"{nm}"
                return f"{m.group(1)}{mid}{m.group(4)}{m.group(5)}"

            texts[sid] = _PARA_LINE_FULL_RE.sub(_line, texts[sid])

        # cross-references still carry OLD numbers — remap via first occurrence
        # (applied to ALL sections: attestations reference plaint paragraphs).
        def _ref(m):
            def _num(nm):
                token = nm.group(0)
                parts = token.split(".")
                main = int(parts[0])
                if main in ref_map:
                    parts[0] = str(ref_map[main])
                    return ".".join(parts)
                return token
            return m.group(1) + re.sub(r"\d+(?:\.\d+)?", _num, m.group(2))

        for sid in texts:
            texts[sid] = _PARA_REF_RE.sub(_ref, texts[sid])

    # ── attestation sections: own numbered clauses restart at 1 ──
    for s in ordered:
        if _num_scope(s) != "attest":
            continue
        sid = str(s.get("section_id"))
        matches = list(_PARA_LINE_FULL_RE.finditer(texts[sid]))
        if matches and int(matches[0].group(2)) != 1:
            a_counter = 0
            a_map: dict[int, int] = {}

            def _aline(m):
                nonlocal a_counter
                om = int(m.group(2))
                if om not in a_map:
                    a_counter += 1
                    a_map[om] = a_counter
                nm = a_map[om]
                sub = m.group(3)
                mid = f"{nm}.{sub}" if sub else f"{nm}"
                return f"{m.group(1)}{mid}{m.group(4)}{m.group(5)}"

            texts[sid] = _PARA_LINE_FULL_RE.sub(_aline, texts[sid])

    # ── same-document mark dedup: one document may never hold two marks ──
    # Identity = shared strong reference code (e.g. NEX/INV/2025/26/041) in the
    # marks' first-introduction windows. Later duplicates remap to the first
    # (canonical) mark; the compaction below then closes the freed numbers.
    code_re = re.compile(r"\b[A-Z]{2,}[A-Z0-9]*(?:[/-][A-Z0-9]{2,}){1,6}\b")
    mark_keys: dict[int, set] = {}
    mark_first: list[int] = []
    for s in ordered:
        text = texts[str(s.get("section_id"))]
        for m in _ANNEX_TOKEN_RE.finditer(text):
            n = int(m.group(2))
            window = text[max(0, m.start() - 160):m.start()].upper()
            keys = {c for c in code_re.findall(window) if not c.startswith(("ANNEXURE", "P-"))}
            if n not in mark_keys:
                mark_keys[n] = set()
                mark_first.append(n)
            mark_keys[n] |= keys
    dup_map: dict[int, int] = {}
    for i, later in enumerate(mark_first):
        for earlier in mark_first[:i]:
            if earlier in dup_map:
                continue
            if mark_keys[later] & mark_keys[earlier]:
                dup_map[later] = dup_map.get(earlier, earlier)
                break
    if dup_map:
        def _dedup(m):
            n = int(m.group(2))
            return f"{m.group(1)}{dup_map.get(n, n)}"
        for sid in texts:
            texts[sid] = _ANNEX_TOKEN_RE.sub(_dedup, texts[sid])

    # ── annexure series compaction (first-appearance order) ──
    order: list[int] = []
    for s in ordered:
        for m in _ANNEX_TOKEN_RE.finditer(texts[str(s.get("section_id"))]):
            n = int(m.group(2))
            if n not in order:
                order.append(n)
    if order and order != list(range(1, len(order) + 1)):
        amap = {old: i + 1 for i, old in enumerate(order)}

        def _mark(m):
            return f"{m.group(1)}{amap[int(m.group(2))]}"

        for sid in texts:
            texts[sid] = _ANNEX_TOKEN_RE.sub(_mark, texts[sid])

    # ── lettered sub-clauses: close gaps left by deletions ((a,b,c,g,j) →
    # (a,b,c,d,e)). Only strictly-ascending-with-gaps sequences are relabeled;
    # sequences that restart (two separate lists) are left alone.
    letter_re = re.compile(r"(?m)^(\s{0,8})\(([a-z])\)(\s)")
    for s in ordered:
        sid = str(s.get("section_id"))
        letters = [m.group(2) for m in letter_re.finditer(texts[sid])]
        if len(letters) < 2:
            continue
        expected = [chr(ord("a") + i) for i in range(len(letters))]
        ascending = all(letters[i] < letters[i + 1] for i in range(len(letters) - 1))
        if ascending and letters != expected:
            seq = iter(expected)
            texts[sid] = letter_re.sub(
                lambda m: f"{m.group(1)}({next(seq)}){m.group(3)}", texts[sid]
            )

    return {sid: t for sid, t in texts.items() if t != original[sid]}


def _thinking_cfg() -> dict[str, Any]:
    """Optional thinking-token cap (DRAFT_THINKING_BUDGET env) — big latency
    saver on thinking models; unset = model default."""
    raw = os.environ.get("DRAFT_THINKING_BUDGET", "").strip()
    if not raw:
        return {}
    try:
        from google.genai import types as gt
        return {"thinking_config": gt.ThinkingConfig(thinking_budget=int(raw))}
    except Exception:
        return {}


def _mono_thinking_cfg() -> dict[str, Any]:
    """Monolithic drafting caps thinking by DEFAULT (2048 tokens) — an uncapped
    thinking model can stall for minutes before the first token of a 65k-token
    document. Override with DRAFT_MONO_THINKING_BUDGET (empty string = model
    default)."""
    raw = os.environ.get("DRAFT_MONO_THINKING_BUDGET", "2048").strip()
    if not raw:
        return {}
    try:
        from google.genai import types as gt
        return {"thinking_config": gt.ThinkingConfig(thinking_budget=int(raw))}
    except Exception:
        return {}


_DIGEST_SECTION_HEAD_RE = re.compile(r"^[A-Z][A-Z0-9 /&()\-]{3,58}:?\s*$")


async def _plan_event_ownership(
    sections: list[dict[str, Any]],
    facts_digest: str,
    model: str,
    usage_sink: Optional[dict[str, int]] = None,
) -> dict[str, list[int]]:
    """Assign every chronology event to exactly ONE narrating section.

    This is the anti-repetition mechanism for parallel drafting: without it,
    every narrative section independently re-tells the whole story to satisfy
    its word floor. With ownership, the story is told exactly once across the
    document and other sections cross-refer.
    """
    from google.genai import types as gt

    from app.services.drafting_schemas import EventOwnershipPlan

    rows = _extract_matrix_rows(facts_digest)
    narr = [s for s in sections
            if _section_kind(s.get("heading", "")) in ("narrative", "normal")
            and not s.get("contains_table")]
    if len(rows) < 4 or len(narr) < 2:
        return {}

    sec_lines = "\n".join(
        f"- {s['section_id']}: {s.get('heading', '')} — {str(s.get('summary', ''))[:100]}"
        for s in narr
    )
    ev_lines = "\n".join(rows[k] for k in sorted(rows))
    prompt = (
        "You are planning a legal draft. Assign EVERY chronology event below to exactly "
        "ONE of the candidate sections — the single most specific section whose purpose "
        "covers that event. The statement-of-facts style section owns the general story; "
        "specialised sections (breach, particular transactions) own only their specific "
        "events. Every event number must be assigned exactly once; never assign one event "
        "to two sections.\n\nCANDIDATE SECTIONS:\n" + sec_lines +
        "\n\nCHRONOLOGY EVENTS:\n" + ev_lines
    )
    client = _get_client()
    loop = asyncio.get_event_loop()
    config = gt.GenerateContentConfig(
        temperature=0.0,
        max_output_tokens=8192,
        response_mime_type="application/json",
        response_schema=EventOwnershipPlan,
    )
    contents = [gt.Content(role="user", parts=[gt.Part(text=prompt)])]
    for m in _gemini_models(model):
        try:
            resp = await loop.run_in_executor(
                None,
                lambda mm=m: client.models.generate_content(model=mm, contents=contents, config=config),
            )
            _add_usage(usage_sink, _usage_from_response(resp))
            parsed = getattr(resp, "parsed", None)
            plan = parsed if isinstance(parsed, EventOwnershipPlan) else \
                EventOwnershipPlan.model_validate_json(resp.text or "")
            valid_ids = {s["section_id"] for s in narr}
            out: dict[str, list[int]] = {}
            seen: set[int] = set()
            for a in plan.assignments:
                if a.section_id not in valid_ids:
                    continue
                nums = [n for n in a.event_numbers if n in rows and n not in seen]
                seen.update(nums)
                if nums:
                    out.setdefault(a.section_id, []).extend(nums)
            # Unassigned events fall to the largest narrative section.
            leftovers = [n for n in rows if n not in seen]
            if leftovers and out:
                biggest = max(out, key=lambda k: len(out[k]))
                out[biggest].extend(leftovers)
            elif leftovers and narr:
                out[narr[0]["section_id"]] = leftovers
            return out
        except Exception as exc:
            logger.warning("Event-ownership planning failed on %s: %s", m, exc)
    return {}


def _section_kind(heading: str) -> str:
    h = (heading or "").lower()
    if any(k in h for k in _LIGHT_KEYWORDS):
        return "light"
    if any(k in h for k in _INGREDIENT_KEYWORDS):
        return "ingredient"
    if any(k in h for k in _NARRATIVE_KEYWORDS):
        return "narrative"
    return "normal"


def _matrix_event_count(facts_digest: str) -> int:
    """Rows in the chronological factual matrix (| 1. | … lines)."""
    return len(re.findall(r"^\|\s*\d+\.?\s*\|", facts_digest or "", re.MULTILINE))


def _plan_section_lengths(
    sections: list[dict[str, Any]], facts_digest: str, total_words: int = DRAFT_MIN_TOTAL_WORDS,
) -> dict[str, int]:
    """Distribute the draft-level word target into per-section floors.

    Narrative sections (facts, grounds, dispute details) carry the length —
    weighted 4× and floored by the number of matrix events (a full numbered
    paragraph per event). Cause titles, prayers and signature blocks keep
    natural length. Floors drive coverage-based expansion, never padding.
    """
    events = _matrix_event_count(facts_digest)
    _kind_weight = {"light": 0.4, "ingredient": 0.8, "narrative": 4.0, "normal": 1.0}
    weights: dict[str, float] = {}
    for s in sections:
        weights[s["section_id"]] = _kind_weight[_section_kind(s.get("heading", ""))]
    total_weight = sum(weights.values()) or 1.0

    plan: dict[str, int] = {}
    for s in sections:
        sid = s["section_id"]
        kind = _section_kind(s.get("heading", ""))
        share = int(total_words * weights[sid] / total_weight)
        if kind == "narrative":
            # At least ~90 words of full narration per known event.
            share = max(share, events * 90, 500)
        elif kind == "ingredient":
            # Concise by definition: state the element + cross-refer. No bloat.
            share = min(share, 350)
        elif kind == "light":
            share = min(share, 150)
        plan[sid] = min(share, MAX_SECTION_MIN_WORDS)
    return plan


# ══════════════════════════════════════════════════════════════════════════
# Stage 3 — sequential section-by-section generation loop (SSE)
# ══════════════════════════════════════════════════════════════════════════

_BLANK_FIDELITY_BLOCK = """
BLANK / MISSING-DATA RULES (mandatory — exact draft, no fabrication):
- Use ONLY facts from the fact inventory / supporting documents for substantive content.
- If a value is NOT in the inventory:
  • Template blank tokens (____, ________, [NAME], <amount>, etc.) → keep that EXACT token.
  • Absent suit/case/diary numbers → customary filing blanks per template (e.g. NO. ____ OF 20__).
  • Narrative gaps with no template blank → [DATA NOT PROVIDED: <what>].
- NEVER invent plausible names, dates, amounts, or events. A blank is always correct when data is missing.
- NEVER copy sample names/dates/amounts from the template skeleton — those are format examples only.
"""


def _placeholder_fill_map(placeholders: list[dict[str, Any]]) -> str:
    """Per-placeholder resolution: inventory fact or exact template blank token."""
    lines: list[str] = []
    for p in placeholders:
        tok = (p.get("original_token") or "").strip() or "____"
        label = p.get("label") or p.get("key") or "field"
        lines.append(
            f"  • `{tok}` ({label}): fill from inventory ONLY; if absent, output `{tok}` verbatim."
        )
    if not lines:
        return ""
    return "PLACEHOLDER MAP:\n" + "\n".join(lines) + "\n"


def _section_prompt(
    structure: dict[str, Any],
    section: dict[str, Any],
    total: int,
    previous_tail: str,
    user_instructions: Optional[str],
    has_docs: bool,
    facts_digest: str = "",
    digest_in_context: bool = False,
    min_words: int = 0,
    doc_state: Optional[dict[str, Any]] = None,
    relevant_facts_digest: str = "",
    consistency_context: str = "",
) -> str:
    placeholders = section.get("placeholders") or []
    ph_map = _placeholder_fill_map(placeholders)
    ph_lines = "\n".join(
        f"- {p.get('original_token') or p.get('key')}: {p.get('label')} ({p.get('data_type')}) — {p.get('description')}"
        for p in placeholders
    ) or "- (none detected)"
    if has_docs and facts_digest and digest_in_context:
        facts_line = (
            "Fill placeholders using the FACT INVENTORY provided earlier in this conversation "
            "(a complete extraction of the supporting documents) together with the documents "
            "themselves. Use EVERY fact relevant to this section. Missing data → template blank "
            "token or [DATA NOT PROVIDED: …]; never invent."
        )
    elif has_docs:
        facts_line = (
            "Fill placeholders ONLY with facts from the supporting documents. "
            "Missing data → reproduce the template's exact blank token (____, brackets, underscores) "
            "or [DATA NOT PROVIDED: …]; never invent."
        )
    else:
        facts_line = (
            "No supporting documents were provided: keep EVERY template blank token exactly "
            "(____, ________, [NAME], etc.) and use [DATA NOT PROVIDED: <label>] only for "
            "open narrative slots — do not invent values."
        )
    digest_block = ""
    facts_for_inline = relevant_facts_digest or facts_digest
    if has_docs and facts_for_inline and not digest_in_context:
        digest_block = (
            "\nFACT INVENTORY (complete extraction of the supporting documents — use every "
            f"fact relevant to this section):\n<<<FACTS\n{facts_for_inline}\nFACTS>>>\n"
        )
    elif has_docs and relevant_facts_digest and digest_in_context:
        digest_block = (
            "\nRELEVANT FACTS FOR THIS SECTION (subset of the cached inventory — use ONLY "
            f"these plus the cached global inventory):\n<<<FACTS\n{relevant_facts_digest}\nFACTS>>>\n"
        )
    consistency_block = consistency_context or ""
    continuity = (
        f"\nCONTINUITY (do NOT repeat this text): the previous section ended as shown below. "
        f"Continue its paragraph-numbering scheme and reuse the SAME defined short forms "
        f"for parties and documents established so far:\n...{previous_tail}\n"
        if previous_tail else ""
    )
    extra = f"\nUSER DRAFTING INSTRUCTIONS (must not override grounding rules):\n{user_instructions}\n" \
        if user_instructions else ""
    kind = _section_kind(section.get("heading", ""))
    length_directive = ""
    if kind == "ingredient":
        length_directive = (
            "\nCONCISENESS DIRECTIVE: this is a LEGAL-INGREDIENT section (cause of action / "
            "limitation / jurisdiction / valuation / maintainability). Keep it SHORT and "
            "surgical — typically 1 to 4 numbered paragraphs: state the legal element, anchor "
            "it to the specific dates/amounts, and CROSS-REFER to the earlier paragraphs "
            "('as pleaded in paragraph __ hereinabove') instead of re-telling the story. "
            "PLACEMENT RULES: the cause of action pleads ACCRUAL events only (when the "
            "obligation fell due, when breach occurred, when the demand was refused). "
            "Statutory compliance steps — pre-institution mediation under Section 12A of the "
            "Commercial Courts Act, notices required by law, non-starter reports — are "
            "MAINTAINABILITY / procedural-compliance facts: plead them in the maintainability "
            "or procedural-statements portion, NOT as cause-of-action accrual events.\n"
        )
    elif min_words >= 300 and has_docs:
        length_directive = (
            f"\nLENGTH DIRECTIVE: this section must run to AT LEAST {min_words} words, "
            "achieved ONLY through coverage: narrate one complete, fully-developed "
            "numbered paragraph per relevant event from the factual matrix (who, what, "
            "when, where, consequence); give every term its own fully drafted clause; "
            "introduce every party with their complete formal particulars. If every "
            "relevant fact is already fully narrated before reaching the target, stop — "
            "NEVER pad, repeat, or invent to reach the number.\n"
        )
    state_block = ""
    if doc_state and (doc_state.get("last_para") or doc_state.get("annexures") or doc_state.get("headings")):
        annexures = doc_state.get("annexures") or []
        is_parallel = bool(doc_state.get("parallel"))
        if annexures:
            annex_lines = "\n".join(
                f"    ANNEXURE {a['mark']} = {a.get('desc') or '(description not captured)'}"
                for a in annexures
            )
            reg_label = (
                "- EXHIBIT REGISTER (PRE-ASSIGNED and COMPLETE for the whole draft — every "
                "source document is listed; cite these exact marks and NEVER create a mark "
                "that is not in this register):"
                if is_parallel else
                "- EXHIBIT REGISTER (marks already assigned — reuse these, never re-mark):"
            )
            annex_block = f"{reg_label}\n{annex_lines}"
        else:
            annex_block = "- Annexure marks already assigned: none yet"
        pleaded = "; ".join(h for h in (doc_state.get("headings") or []) if h) or "none yet"
        if is_parallel:
            numbering_line = (
                "- Numbering: sections are drafted independently — follow THIS template "
                "section's own numbering scheme exactly as the skeleton shows it; never "
                "renumber other sections' paragraphs."
            )
            pleaded_line = (
                f"- The document also contains these sections (each pleads its own facts once; "
                f"cross-refer by section rather than re-narrating): {pleaded}"
            )
        else:
            numbering_line = (
                f"- Last paragraph number used so far: {doc_state.get('last_para') or 'none (this starts the numbering)'}"
            )
            pleaded_line = f"- Sections already pleaded (do NOT re-narrate their facts; cross-refer): {pleaded}"
        state_block = (
            "\nDOCUMENT STATE (for coherence — obey the numbering/annexure/repetition rules):\n"
            f"{numbering_line}\n"
            f"{annex_block}\n"
            f"{pleaded_line}\n"
        )
    verification_directive = ""
    if "verification" in str(section.get("heading", "")).lower():
        verification_directive = (
            "\nTHIS IS THE VERIFICATION CLAUSE: use the statutory split form with the ACTUAL "
            "paragraph numbers of this draft (see DOCUMENT STATE for the last number used), "
            "in THREE categories: (a) personal knowledge = ONLY the deponent's own "
            "authority/actions; (b) business records = invoices, payments, ledger, "
            "correspondence, deployment events; (c) legal advice = jurisdiction, valuation, "
            "limitation, maintainability, commercial-dispute classification, relief. The "
            "three ranges must cover every paragraph exactly once — no gaps, no overlaps. "
            "Any Statement of Truth must mirror these ranges exactly.\n"
        )
    table_directive = ""
    if section.get("contains_table"):
        table_directive = (
            "\nTHIS SECTION CONTAINS A DATA TABLE. Output it as a GitHub markdown table "
            "with the template's exact column headers, then POPULATE IT COMPLETELY: for a "
            "chronology (list of dates and events), transfer EVERY row of the fact "
            "inventory's CHRONOLOGICAL FACTUAL MATRIX (re-narrated to fit the template's "
            "columns and date style, in the same order); for other tables, one row per "
            "matching fact. ROW SEMANTICS: every row must genuinely belong to the table's "
            "own category as defined by its headers — an invoice table lists invoices, a "
            "payment schedule lists payments, a demand column lists demands. Never force a "
            "document of a different type into the table (a legal notice is a demand, NOT "
            "an invoice — it belongs in the chronology or its own row category, not an "
            "invoice table). Items that do not fit the columns are pleaded in the text "
            "instead. Never COMPUTE a value for a cell (e.g. a due date derived from "
            "credit terms that do not apply to that item) — state the sourced fact or "
            "[DATA NOT PROVIDED: <what>]. Chronology tables stay strictly neutral (no "
            "argumentative adjectives) and begin with foundational dates (incorporation/"
            "registration) when the sources state them. Status columns are always filled "
            "('Filed herewith', 'Annexed as ANNEXURE P-#'). Missing cell facts → "
            "[DATA NOT PROVIDED: <what>] or leave blank — never invent. Drop template "
            "example rows with no matching fact.\n"
        )
    return f"""DOCUMENT: {structure.get('document_title')} ({structure.get('document_type')})
LAYOUT CONVENTIONS: {structure.get('layout_notes') or 'as per template'}

You are drafting SECTION {section.get('index', 0) + 1} of {total}: "{section.get('heading')}"
{'This section is BOILERPLATE — keep the template wording, filling in THIS matter’s particulars.' if section.get('is_boilerplate') else ''}{state_block}{verification_directive}{table_directive}

TEMPLATE SECTION (FORMAT GUIDE ONLY — copy its structure, numbering and procedural
phrasing; REPLACE every case-specific detail with THIS matter's facts from the fact
inventory; the template's sample names/dates/amounts must NOT appear in your output.
HEADING RULE: reproduce a heading ONLY if the template section itself contains one, and
then character-for-character; if the template block has no heading, output NO heading —
the section name above is a navigation label, never document text):
<<<TEMPLATE
{section.get('original_text')}
TEMPLATE>>>

PLACEHOLDERS TO RESOLVE:
{ph_lines}
{ph_map}{_BLANK_FIDELITY_BLOCK}
{facts_line}{digest_block}{consistency_block}{length_directive}{continuity}{extra}
Output ONLY the final drafted text of this section."""


def _adk_drafting_enabled() -> bool:
    """Legacy ADK conversational engine — its session ACCUMULATES prior sections
    as chat history (input bloat, poor cache reuse). The isolated-worker
    architecture is now the default; set DRAFT_USE_ADK=true to opt back in
    (only effective with DRAFT_PARALLEL_SECTIONS=1)."""
    return os.environ.get("DRAFT_USE_ADK", "false").strip().lower() in ("true", "1", "yes")


# SPEC 4: dynamic model routing — boilerplate sections don't need a flagship.
DRAFT_LIGHT_MODEL = os.environ.get("DRAFT_LIGHT_MODEL", "gemini-2.5-flash").strip()


def _route_section_model(selected_model: str, kind: str) -> str:
    """Route light/boilerplate sections (cause title, signature blocks, memo)
    to the cheap model when the user selected a flagship; complex sections
    (narrative, legal arguments, prayers) stay on the user's modelChoice."""
    if kind == "light" and "pro" in (selected_model or "").lower():
        return DRAFT_LIGHT_MODEL
    return selected_model


async def _build_adk_drafting_context(
    *,
    session_id: str,
    user_id: str,
    model: str,
    docs: list[dict[str, Any]],
    max_output_tokens: int,
) -> dict[str, Any]:
    """Build the ADK runner + session for a draft and preload doc parts.

    Raises on any failure — the caller falls back to the direct genai engine.
    """
    from agents.drafting_adk import ensure_adk_session, get_or_build_drafting_runner

    loop = asyncio.get_event_loop()
    runner, svc, runner_key = get_or_build_drafting_runner(
        session_id=session_id,
        model_name=model,
        system_instruction=DRAFTING_SYSTEM_PROMPT,
        max_output_tokens=max_output_tokens,
        ttl_seconds=max(get_settings().context_cache_ttl_seconds, 1800),
    )
    adk_session_id = await ensure_adk_session(
        session_service=svc, user_id=user_id, session_id=session_id,
    )
    # Priming payload guard: ADK sends the priming turn as ONE non-streamed
    # request — very large raw-doc payloads provoke "server disconnected"
    # errors. Above the threshold, prime with the fact inventory only (the
    # digest is the drafting source of truth; raw bytes are optional support).
    prime_max_bytes = int(os.environ.get("DRAFT_ADK_PRIME_MAX_BYTES", str(8 * 1024 * 1024)))
    total_bytes = sum(int(d.get("size") or 0) for d in docs)
    doc_parts: list[Any] = []
    if docs and total_bytes <= prime_max_bytes:
        doc_parts = await loop.run_in_executor(None, _doc_parts, docs)
    elif docs:
        logger.info(
            "ADK priming with digest only (%s bytes of docs > %s limit)",
            total_bytes, prime_max_bytes,
        )
    return {
        "runner": runner,
        "runner_key": runner_key,
        "adk_session_id": adk_session_id,
        "doc_parts": doc_parts,
    }


async def generate_draft_loop(
    *,
    user_id: str,
    session_id: str,
    selected_model: Optional[str],
    section_ids: Optional[list[str]] = None,
    user_instructions: Optional[str] = None,
    confirmed_facts: Optional[str] = None,
    max_output_tokens_per_section: int = 65536,
    drafting_strategy: Optional[str] = None,
) -> AsyncIterator[dict[str, Any]]:
    """Core generation loop. Yields typed SSE events:

    status / section_start / chunk / section_end / section_error / usage / done / error

    Chunk text is additionally framed with [START_SECTION_i] … [END_SECTION_i]
    markers so a plain-text consumer can split sections without the typed events.
    """
    from google.genai import types as gt

    loop = asyncio.get_event_loop()
    session = await loop.run_in_executor(None, repo.get_session, session_id, user_id)
    if not session:
        yield {"type": "error", "message": "Drafting session not found"}
        return
    structure = session.get("template_structure")
    if not structure or session.get("status") in ("created", "template_uploaded", "analyzing"):
        yield {"type": "error", "message": "Template analysis is not complete yet"}
        return

    sections: list[dict[str, Any]] = structure.get("sections") or []
    if section_ids:
        wanted = set(section_ids)
        sections = [s for s in sections if s.get("section_id") in wanted]
    if not sections:
        yield {"type": "error", "message": "No sections to generate"}
        return

    docs: list[dict[str, Any]] = session.get("supporting_docs") or []
    strategy = resolve_strategy(drafting_strategy)
    logger.info("Draft generation session=%s strategy=%s (requested=%r)", session_id, strategy, drafting_strategy)
    model_chain = build_model_list({}, selected_model or session.get("model"))
    model = model_chain[0]
    client = _get_client()

    yield {"type": "status", "message": f"Preparing context ({len(docs)} supporting document(s))…"}

    # ── 4-STAGE PIPELINE (monolithic): Stage 1 — Document Ingestion Check.
    # Zero-LLM, fail-loud: every blob must resolve and carry an allowed MIME
    # type; scanned/image documents are flagged OCR-derived (read visually by
    # Gemini, higher scrutiny downstream); page/token counts are logged; and
    # an oversized corpus is split into extraction batches, never truncated.
    grounded_pipeline = GROUNDED_PIPELINE_ENABLED and strategy == "monolithic"
    run_log: Optional[DraftRunLogger] = DraftRunLogger(session_id) if grounded_pipeline else None
    ingestion_report: dict[str, Any] = {}
    ingested_texts: dict[str, str] = {}
    if grounded_pipeline and docs:
        yield {"type": "status",
               "message": "Stage 1/4 — ingestion check (storage, MIME types, text layers, token counts)…"}
        try:
            ingestion_report, ingested_texts = await loop.run_in_executor(
                None, run_ingestion_check, docs,
            )
        except Exception as exc:
            logger.exception("Ingestion check crashed")
            ingestion_report = {"ok": False, "fatal": [f"ingestion check failed: {exc}"],
                                "documents": [], "batches": [], "ocr_derived_docs": []}
        if run_log:
            run_log.log_stage("ingestion_check", ingestion_report)
        yield {
            "type": "ingestion_report",
            "runId": run_log.run_id if run_log else None,
            "ok": bool(ingestion_report.get("ok")),
            "documents": ingestion_report.get("documents") or [],
            "totalEstTokens": ingestion_report.get("total_est_tokens", 0),
            "batches": len(ingestion_report.get("batches") or []),
            "ocrDerivedDocs": ingestion_report.get("ocr_derived_docs") or [],
        }
        if not ingestion_report.get("ok", True):
            # FAIL LOUDLY — a document the model cannot read must never be
            # silently skipped in a legal draft.
            msg = "; ".join(ingestion_report.get("fatal") or ["unknown ingestion failure"])
            await _safe_update_session(session_id, status="generation_failed", error=msg)
            yield {"type": "error",
                   "message": f"Stage 1 ingestion check failed — {msg}. "
                              "Fix or re-upload the affected document(s), then regenerate."}
            return
        _ocr_docs = ingestion_report.get("ocr_derived_docs") or []
        if _ocr_docs:
            yield {"type": "status",
                   "message": "OCR-derived document(s) — no text layer, read visually, "
                              "flagged for higher scrutiny: " + ", ".join(_ocr_docs[:6])
                              + ("…" if len(_ocr_docs) > 6 else "")}
        if len(ingestion_report.get("batches") or []) > 1:
            yield {"type": "status",
                   "message": f"Corpus ~{ingestion_report.get('total_est_tokens', 0):,} est. tokens — "
                              f"extraction will run in {len(ingestion_report['batches'])} batches "
                              "(no truncation)."}

    # Engine selection: Google ADK agent with automatic ContextCacheConfig
    # caching (default), falling back to the direct genai path with a manually
    # managed explicit cache if ADK is unavailable or fails mid-draft.
    use_adk = _adk_drafting_enabled() and strategy == "sectionwise"
    # Parallel section generation (default ×4): the dominant latency win — a
    # 16-section draft goes from 16 serial calls to ~4 waves. Concurrency needs
    # the stateless direct engine sharing one explicit cache; ADK's session is
    # inherently serial, so it is used only when DRAFT_PARALLEL_SECTIONS=1.
    parallel_n = max(1, int(os.environ.get("DRAFT_PARALLEL_SECTIONS", "4")))
    used_parallel = strategy == "sectionwise" and parallel_n > 1 and len(sections) > 1
    if used_parallel:
        use_adk = False
    cache_name: Optional[str] = None
    inline_parts: Optional[list[Any]] = None
    cache_setup_tokens = 0                     # one-time explicit-cache write (setup cost)
    run_started = time.monotonic()             # real cache lifespan for storage proration
    adk_ctx: Optional[dict[str, Any]] = None
    if use_adk:
        try:
            adk_ctx = await _build_adk_drafting_context(
                session_id=session_id,
                user_id=user_id,
                model=model,
                docs=docs,
                max_output_tokens=max_output_tokens_per_section,
            )
        except Exception as exc:
            logger.warning("ADK drafting engine unavailable (%s) — using direct Gemini path", exc)
            use_adk = False
    # Context prep is DEFERRED until after the fact inventory is built, so the
    # inventory can be pinned into the cache (isolated-worker architecture).
    pinned_global = ""
    digest_cached = False

    # Mid-run cache-expiry recovery: if Gemini reports the cache gone
    # (403 CachedContent not found), one caller rebuilds it — concurrent
    # workers wait on the lock and reuse the fresh cache.
    ctx_lock = asyncio.Lock()

    async def _recover_cache(failed_cache: Optional[str]) -> None:
        nonlocal cache_name, inline_parts, cache_setup_tokens
        async with ctx_lock:
            if cache_name != failed_cache:
                return  # another worker already recovered
            logger.warning("Context cache lost mid-run — rebuilding…")
            try:
                new_cache, new_inline, new_setup = await prepare_supporting_context(
                    session_id, docs, model, pinned_text=pinned_global,
                    system_instruction=MONOLITHIC_DRAFTING_SYSTEM_PROMPT
                    if strategy == "monolithic" else DRAFTING_SYSTEM_PROMPT,
                )
                cache_name, inline_parts = new_cache, new_inline
                cache_setup_tokens += new_setup
            except Exception as exc:
                logger.warning("Cache rebuild failed (%s) — switching to inline parts", exc)
                cache_name = None
                inline_parts = _doc_parts(docs) if docs else []

    # Exhaustive fact-inventory pass (cached per session, cleared on doc changes):
    # the drafter then works from a complete pre-extracted fact list, so long
    # drafts use ALL the data instead of whatever it happens to attend to.
    # Cumulative token usage across every call in this run (sections, digest,
    # expansion, audit, repairs) — drives the INR cost breakdown at the end.
    total_usage: dict[str, int] = {
        "inputTokens": 0, "outputTokens": 0, "totalTokens": 0,
        "cachedTokens": 0, "cacheHwmTokens": 0,
    }
    # Per-call cost ledger: every Gemini call of every agent, individually
    # costed — powers the "cost details" breakdown in the UI.
    call_ledger: list[dict[str, Any]] = []
    tf_meta = session.get("template_file") or {}
    if tf_meta.get("analysis_usage"):
        _add_usage(total_usage, tf_meta["analysis_usage"])
        _record_call(call_ledger, "analysis", "Template structural analysis",
                     tf_meta.get("analysis_model") or ANALYSIS_MODEL,
                     tf_meta["analysis_usage"])

    facts_digest = ""
    _existing_digest = str(session.get("facts_digest") or "").strip()
    # SINGLE-CALL MONOLITHIC (Gemini): when there is no cached digest yet, skip
    # the separate extraction call entirely — the ONE drafting call reads the
    # raw documents directly (inline_parts, below) instead of a pre-extracted
    # digest. Claude has no document-attachment path here, so it still needs
    # the (cheap, Flash) extraction call; a cached digest is always reused for
    # free on every strategy.
    _mono_skip_extraction = (
        MONO_SKIP_EXTRACTION
        and strategy == "monolithic" and not _existing_digest
        and not model.strip().lower().startswith("claude")
    )
    if docs and not _mono_skip_extraction:
        yield {"type": "status", "message": "Extracting complete data from supporting documents…"}
        _before_digest = dict(total_usage)
        try:
            # Keepalive: the extraction call can run for minutes on large corpora;
            # emit a heartbeat status so the SSE connection and UI stay alive.
            digest_task = asyncio.ensure_future(build_facts_digest(
                session_id, docs, model, existing=session.get("facts_digest"),
                usage_sink=total_usage,
            ))
            waited = 0
            while True:
                try:
                    facts_digest = await asyncio.wait_for(asyncio.shield(digest_task), timeout=12)
                    break
                except asyncio.TimeoutError:
                    waited += 12
                    yield {"type": "status",
                           "message": f"Reading all {len(docs)} supporting document(s)… ({waited}s)"}
            if facts_digest:
                _record_call(call_ledger, "fact_extraction",
                             "Fact inventory (librarian pass over all documents)",
                             DRAFT_EXTRACT_MODEL, _usage_delta(_before_digest, total_usage))
                if run_log:
                    run_log.log_stage("fact_extraction",
                                      {"chars": len(facts_digest), "digest": facts_digest})
                yield {"type": "status",
                       "message": f"Fact inventory ready ({len(facts_digest):,} chars) — drafting…"}
        except Exception as exc:
            logger.warning("Facts digest failed: %s", exc)
        if not facts_digest:
            yield {
                "type": "error",
                "message": (
                    "Could not extract a complete fact inventory from the supporting "
                    "documents. Draft generation stopped to avoid an incomplete draft."
                ),
            }
            return

    # ── Stage 1b: provenance verification (zero LLM) — drop extractions values
    # that are not verbatim in the cited source file before Stage 2 sees them. ──
    provenance_to_confirm: list[dict[str, str]] = []
    if facts_digest and docs:
        try:
            from app.services.draft_provenance import verify_fact_provenance
            cleaned, provenance_to_confirm = verify_fact_provenance(facts_digest, docs)
            if provenance_to_confirm:
                facts_digest = cleaned
                await _safe_update_session(session_id, facts_digest=facts_digest)
                yield {"type": "status",
                       "message": f"Provenance check: excluded {len(provenance_to_confirm)} "
                                  "unverified extraction(s) from the fact inventory…"}
                yield {
                    "type": "qa_report",
                    "toBeConfirmed": [
                        {
                            "label": item.get("value", "")[:80],
                            "reason": item.get("reason", ""),
                            "source": item.get("source", ""),
                            "flag": item.get("flag", "UNVERIFIED_PROVENANCE"),
                        }
                        for item in provenance_to_confirm
                    ],
                }
        except Exception as exc:
            logger.warning("Provenance verification skipped: %s", exc)

    # ── Session fact memory: user-confirmed facts persist across
    # regenerations and carry the SAME authority as the inventory —
    # unlike user_instructions, they cannot be overridden. ──
    addendum = str(session.get("facts_addendum") or "").strip()
    if confirmed_facts and confirmed_facts.strip():
        new_fact = confirmed_facts.strip()
        if new_fact not in addendum:
            addendum = f"{addendum}\n- {new_fact}".strip() if addendum else f"- {new_fact}"
            await _safe_update_session(session_id, facts_addendum=addendum)
    if addendum and facts_digest:
        facts_digest = (
            facts_digest
            + "\n\n## USER-CONFIRMED FACTS ADDENDUM (same authority as the inventory; "
              "these OVERRIDE any conflicting inference):\n" + addendum
        )
        yield {"type": "status",
               "message": "Applying user-confirmed facts from this session…"}

    # ── Stage 2 — Grounded Extraction: one controlled-generation call per
    # ingestion batch (response_schema makes the citation field impossible to
    # skip), then a ZERO-LLM validation confirms every source_snippet is an
    # actual substring of the cited document. Only verified values reach the
    # drafter; missing / conflicting / unverified fields are withheld and
    # surfaced in the review packet instead. ──
    grounded_fields: list[dict[str, Any]] = []
    verified_fields_block = ""
    field_review: dict[str, Any] = {}
    if grounded_pipeline and docs and not _mono_skip_extraction:
        yield {"type": "status",
               "message": "Stage 2/4 — grounded field extraction (schema-enforced source citations)…"}
        _before_grounded = dict(total_usage)
        try:
            # Heartbeat: keep the SSE connection alive during the extraction
            # call (same pattern as the digest pass).
            grounded_task = asyncio.ensure_future(extract_grounded_fields(
                docs=docs,
                batches=ingestion_report.get("batches")
                or [[str(d.get("doc_id") or d.get("name") or "") for d in docs]],
                structure=structure,
                model=DRAFT_EXTRACT_MODEL,
                usage_sink=total_usage,
            ))
            _waited = 0
            while True:
                try:
                    raw_fields = await asyncio.wait_for(asyncio.shield(grounded_task), timeout=12)
                    break
                except asyncio.TimeoutError:
                    _waited += 12
                    yield {"type": "status",
                           "message": f"Stage 2/4 — extracting cited fields… ({_waited}s)"}
            _record_call(call_ledger, "grounded_extraction",
                         "Grounded field extraction (structured, cited)",
                         DRAFT_EXTRACT_MODEL, _usage_delta(_before_grounded, total_usage))
            grounded_fields = validate_extracted_fields(
                raw_fields, docs, ingested_texts, ingestion_report,
            )
            verified_fields_block = render_verified_fields_block(grounded_fields)
            field_review = summarize_field_review(grounded_fields)
            await _safe_update_session(session_id, grounded_facts={
                "runId": run_log.run_id if run_log else None,
                "fields": grounded_fields,
                "summary": {k: field_review.get(k) for k in
                            ("total", "verified", "missing", "conflicts", "unverified")},
            })
            if run_log:
                run_log.log_stage("grounded_extraction",
                                  {"fields": grounded_fields, "summary": field_review})
            yield {"type": "status",
                   "message": (f"Grounded extraction: {field_review.get('verified', 0)} verified, "
                               f"{field_review.get('missing', 0)} missing, "
                               f"{field_review.get('conflicts', 0)} conflict(s), "
                               f"{field_review.get('unverified', 0)} unverified citation(s).")}
        except Exception as exc:
            logger.warning("Grounded extraction failed: %s", exc)
            field_review = {"error": str(exc)}
            if run_log:
                run_log.log_stage("grounded_extraction", {"error": str(exc)}, kind="error")
            yield {"type": "status",
                   "message": f"Stage 2 grounded extraction unavailable ({exc}) — "
                              "drafting continues from the fact inventory only "
                              "(flagged in the review packet)."}

    # ── ISOLATED WORKER CONTEXT (SPEC 2+3): every section call is stateless;
    # the stable global block (outline + fact inventory) is pinned at the
    # start of the explicit cache — one cache write, 49 cache reads. ──
    _mono_source_docs_text = ""
    if not use_adk:
        if facts_digest:
            outline = "\n".join(
                f"{s.get('index', 0) + 1}. {s.get('heading', '')}"
                for s in (structure.get("sections") or [])
            )
            pinned_global = (
                "## DOCUMENT OUTLINE (this draft's structure — for cross-reference only):\n"
                + outline
                + "\n\n## FACT INVENTORY (single source of truth for EVERY section):\n"
                + facts_digest
            )
        if strategy == "monolithic":
            # Digest is primary. Gemini may also get verbatim source-text
            # extracts. Claude skips that dump by default (cost) — see
            # MONO_CLAUDE_ATTACH_SOURCE_DOCS.
            cache_name, cache_setup_tokens = None, 0
            inline_parts = None
            _will_claude = model.strip().lower().startswith("claude")
            if _mono_skip_extraction and docs:
                # No digest — attach raw bytes (Gemini only; Claude is blocked
                # from skip-extraction above).
                inline_parts = await loop.run_in_executor(None, _doc_parts, docs)
            elif docs and facts_digest and MONO_ATTACH_SOURCE_DOCS:
                if _will_claude and not MONO_CLAUDE_ATTACH_SOURCE_DOCS:
                    yield {
                        "type": "status",
                        "message": (
                            "Claude cost mode: drafting from fact inventory only "
                            "(source-doc re-attach skipped — set "
                            "DRAFT_MONO_CLAUDE_ATTACH_SOURCE_DOCS=true to opt in)."
                        ),
                    }
                elif _will_claude and MONO_CLAUDE_ATTACH_SOURCE_DOCS:
                    yield {"type": "status",
                           "message": "Attaching capped source-document text for Claude…"}
                    _mono_source_docs_text = await loop.run_in_executor(
                        None,
                        lambda: _docs_as_grounding_text(
                            docs,
                            max_chars_per_doc=MONO_CLAUDE_SOURCE_MAX_PER_DOC,
                            max_total=MONO_CLAUDE_SOURCE_MAX_TOTAL,
                        ),
                    ) or ""
                else:
                    yield {"type": "status",
                           "message": "Attaching source-document text for draft verification…"}
                    _mono_source_docs_text = await loop.run_in_executor(
                        None, lambda: _docs_as_grounding_text(docs),
                    ) or ""
        else:
            try:
                cache_name, inline_parts, cache_setup_tokens = await prepare_supporting_context(
                    session_id, docs, model, pinned_text=pinned_global,
                    system_instruction=MONOLITHIC_DRAFTING_SYSTEM_PROMPT
                    if strategy == "monolithic" else DRAFTING_SYSTEM_PROMPT,
                )
            except Exception as exc:
                yield {"type": "error", "message": f"Failed to load supporting documents: {exc}"}
                return
        digest_cached = bool(cache_name and pinned_global)
        if digest_cached:
            yield {"type": "status",
                   "message": "Global context cached once (outline + fact inventory) — "
                              "all section calls are isolated cache-reads…"}

    # ADK / edge path: Gemini parity only (Claude uses digest-only unless opted in)
    if (
        strategy == "monolithic"
        and docs
        and MONO_ATTACH_SOURCE_DOCS
        and facts_digest
        and not _mono_source_docs_text
        and not _mono_skip_extraction
        and not model.strip().lower().startswith("claude")
    ):
        yield {"type": "status",
               "message": "Attaching source-document text for draft verification…"}
        _mono_source_docs_text = await loop.run_in_executor(
            None, lambda: _docs_as_grounding_text(docs),
        ) or ""

    await _safe_update_session(session_id, status="generating", model=model)
    yield {
        "type": "status",
        "message": f"Drafting {len(sections)} sections with {model}"
                   + (f" ({strategy})" if strategy else "")
                   + (" (ADK agent, auto context caching)" if use_adk
                      else (" (context cache active)" if cache_name else "")),
        "model": model,
        "engine": "adk" if use_adk else "genai",
        "cached": bool(use_adk or cache_name),
        "total_sections": len(sections),
        "drafting_strategy": strategy,
    }

    # Per-section word floors: narrative sections carry the 20+-page target,
    # scaled by the number of events in the factual matrix.
    length_plan = _plan_section_lengths(sections, facts_digest) if (docs and facts_digest) else {}
    consistency_context = build_consistency_context(facts_digest) if strategy == "sectionwise" else ""
    section_call_meta: list[Any] = []
    draft_metadata: Optional[DraftMetadata] = None

    def _section_facts(section: dict[str, Any]) -> str:
        return filter_facts_for_section(section, facts_digest) if strategy == "sectionwise" else ""

    def _prompt_kwargs(section: dict[str, Any], **extra: Any) -> dict[str, Any]:
        return {
            **extra,
            "relevant_facts_digest": _section_facts(section),
            "consistency_context": consistency_context,
        }

    completed = 0
    drafted_records: list[dict[str, Any]] = []

    # ── Strategy: monolithic (one-shot) ─────────────────────────────────────
    if strategy == "monolithic":
        # Claude models can't read the Gemini context cache — inline the fact
        # inventory into the prompt and drop Gemini-typed doc parts.
        _mono_is_claude = model.strip().lower().startswith("claude")
        mono_ctx = MonolithicDraftContext(
            loop=loop,
            client=client,
            model=model,
            model_chain=model_chain,
            session_id=session_id,
            user_id=user_id,
            structure=structure,
            sections=sections,
            facts_digest=facts_digest,
            has_docs=bool(docs),
            user_instructions=user_instructions,
            cache_name=None if _mono_is_claude else cache_name,
            inline_parts=None if _mono_is_claude else inline_parts,
            max_output_tokens=max_output_tokens_per_section,
            total_usage=total_usage,
            call_ledger=call_ledger,
            iter_chunks=_iter_gemini_draft_chunks,
            strip_markers=_strip_section_markers,
            record_call=_record_call,
            add_usage=_add_usage,
            log_usage=_log_usage,
            save_section=_safe_save_draft_section,
            thinking_cfg=_mono_thinking_cfg,
            drafting_system_prompt=MONOLITHIC_DRAFTING_SYSTEM_PROMPT,
            digest_cached=digest_cached and not _mono_is_claude,
            min_total_words=DRAFT_MIN_TOTAL_WORDS,
            exhibit_register=_plan_exhibits(facts_digest) if facts_digest else [],
            factual_manifest=_build_factual_manifest(facts_digest) if facts_digest else "",
            interest_pairing_table=_interest_pairing_for_prompt(facts_digest),
            field_coverage_checklist=_field_coverage_for_prompt(facts_digest),
            source_docs_text=_mono_source_docs_text,
            verified_fields_block=verified_fields_block,
        )
        if grounded_pipeline:
            yield {"type": "status",
                   "message": "Stage 3/4 — drafting from verified facts "
                              "(fact inventory + verified field ledger)…"}
            if run_log:
                run_log.log_stage("drafting", {
                    "model": model,
                    "digest_chars": len(facts_digest or ""),
                    "verified_fields_block": verified_fields_block,
                    "user_instructions": user_instructions or "",
                }, kind="input")
        drafted_records: list[dict[str, Any]] = []
        completed = 0
        async for evt in MonolithicDraftingStrategy().draft(mono_ctx):
            if evt.get("type") == "_monolithic_result":
                drafted_records = evt.get("drafted_records") or []
                completed = int(evt.get("completed") or 0)
                draft_metadata = evt.get("metadata")
                continue
            if evt.get("type", "").startswith("_"):
                continue
            yield evt
        if run_log and drafted_records:
            run_log.log_stage("drafting", {
                "model": getattr(draft_metadata, "model", None) or model,
                "chars": len(drafted_records[0].get("content") or ""),
                "text": drafted_records[0].get("content") or "",
            })
        sequential_sections: list[dict[str, Any]] = []

    run_section_loops = strategy == "sectionwise"

    async def _silent_engine_turn(turn_prompt: str, stage: str = "finalization",
                                  label: str = "") -> str:
        """One non-streamed turn on the current engine (expansion / audit repair)."""
        collected = ""
        turn_usage: dict[str, int] = {}
        if use_adk and adk_ctx:
            from agents.drafting_adk import run_drafting_turn
            async for item in run_drafting_turn(
                runner=adk_ctx["runner"],
                user_id=user_id,
                adk_session_id=adk_ctx["adk_session_id"],
                parts=[gt.Part(text=turn_prompt)],
            ):
                if item["kind"] == "chunk":
                    collected += item["text"]
                elif item["kind"] == "done":
                    _add_usage(total_usage, item.get("usage"))
                    _add_usage(turn_usage, item.get("usage"))
        else:
            config_kwargs: dict[str, Any] = {
                "temperature": 0.0, "top_p": 0.1,
                "max_output_tokens": max_output_tokens_per_section,
                **_thinking_cfg(),
            }
            if cache_name:
                config_kwargs["cached_content"] = cache_name
            else:
                config_kwargs["system_instruction"] = DRAFTING_SYSTEM_PROMPT
            config = gt.GenerateContentConfig(**config_kwargs)
            turn_parts = [gt.Part(text=turn_prompt)]
            if inline_parts:
                turn_parts = [*inline_parts, gt.Part(text=turn_prompt)]
            contents = [gt.Content(role="user", parts=turn_parts)]
            async for item in _iter_gemini_draft_chunks(loop, client, model, contents, config):
                if item["kind"] == "chunk":
                    collected += item["text"]
                elif item["kind"] == "done":
                    _add_usage(total_usage, item.get("usage"))
                    _add_usage(turn_usage, item.get("usage"))
        _record_call(call_ledger, stage, label or stage, model, turn_usage)
        return _strip_section_markers(collected).strip()

    if run_section_loops:
        previous_tail = ""
        completed = 0
        drafted_records: list[dict[str, Any]] = []
        sequential_sections: list[dict[str, Any]] = sections
        if used_parallel:
            # ══ PARALLEL GENERATION ══
            # Workers draft sections concurrently (bounded by parallel_n); the
            # emitter streams results to the client in template order. Exhibit
            # marks are PRE-ASSIGNED from the fact inventory so no section depends
            # on another; numbering follows each section's own template skeleton;
            # the review pass (lint + audit + repairs) enforces global coherence.
            sequential_sections = []
            exhibits = _plan_exhibits(facts_digest) if facts_digest else []
            shared_state = {
                "last_para": "",
                "annexures": exhibits,
                # heading + one-line summary: each worker sees what the OTHER
                # sections cover, so it pleads only its own lane (no re-narration).
                "headings": [
                    (f"{s.get('heading', '')} — {str(s.get('summary', ''))[:80]}"
                     if s.get("summary") else s.get("heading", ""))
                    for s in sections
                ],
                "parallel": True,
            }
            yield {"type": "status",
                   "message": f"Drafting {len(sections)} sections in parallel (×{parallel_n}, "
                              f"{len(exhibits)} exhibits pre-assigned)…"}

            # Event ownership: every chronology event narrated by exactly ONE
            # section — the story is told once; other sections cross-refer.
            ownership_blocks: dict[str, str] = {}
            try:
                _before_own = dict(total_usage)
                ownership = await _plan_event_ownership(sections, facts_digest, model, usage_sink=total_usage)
                _record_call(call_ledger, "planning", "Event-ownership plan",
                             model, _usage_delta(_before_own, total_usage))
                if ownership:
                    matrix_rows = _extract_matrix_rows(facts_digest)
                    owned_any = {n for nums in ownership.values() for n in nums}
                    for s in sections:
                        sid_o = s["section_id"]
                        kind_o = _section_kind(s.get("heading", ""))
                        if kind_o not in ("narrative", "normal") or s.get("contains_table"):
                            continue
                        own = sorted(ownership.get(sid_o, []))
                        if own:
                            own_rows = "\n".join(matrix_rows[n] for n in own if n in matrix_rows)
                            ownership_blocks[sid_o] = (
                                "\nOWNED EVENTS — this section narrates ONLY the following "
                                "chronology events (all other events are pleaded in their own "
                                "sections; cross-refer to them WITHOUT re-narrating, and never "
                                "re-quote correspondence quoted elsewhere):\n" + own_rows + "\n"
                            )
                            if kind_o == "narrative":
                                length_plan[sid_o] = min(
                                    MAX_SECTION_MIN_WORDS, max(300, len(own) * 90)
                                )
                        else:
                            ownership_blocks[sid_o] = (
                                "\nOWNED EVENTS: none — this section owns NO chronology events. "
                                "State its legal function concisely and cross-refer to the "
                                "paragraphs that plead the facts; do NOT re-narrate the story.\n"
                            )
                            length_plan[sid_o] = 0
                    yield {"type": "status",
                           "message": f"Fact ownership planned — {len(owned_any)} events assigned "
                                      f"across {len([k for k, v in ownership.items() if v])} sections (no repetition)…"}
            except Exception as exc:
                logger.warning("Event ownership skipped: %s", exc)

            sem = asyncio.Semaphore(parallel_n)
            queues: dict[str, asyncio.Queue] = {s["section_id"]: asyncio.Queue() for s in sections}
            results: dict[str, dict[str, Any]] = {}

            def _worker_config(use_cache: bool = True) -> Any:
                kwargs: dict[str, Any] = {
                    "temperature": 0.0, "top_p": 0.1,
                    "max_output_tokens": max_output_tokens_per_section,
                    **_thinking_cfg(),
                }
                if cache_name and use_cache:
                    kwargs["cached_content"] = cache_name
                else:
                    kwargs["system_instruction"] = DRAFTING_SYSTEM_PROMPT
                return gt.GenerateContentConfig(**kwargs)

            async def _worker(section: dict[str, Any]) -> None:
                sid = section["section_id"]
                idx = section.get("index", 0)
                q = queues[sid]
                try:
                    async with sem:
                        kind_w = _section_kind(section.get("heading", ""))
                        sec_model = _route_section_model(model, kind_w)
                        use_cache_here = digest_cached and sec_model == model
                        sec_started = time.monotonic()
                        prompt = _section_prompt(
                            structure, section, len(sections), "", user_instructions,
                            has_docs=bool(docs), facts_digest=facts_digest,
                            digest_in_context=use_cache_here,
                            min_words=length_plan.get(sid, 0),
                            doc_state=shared_state,
                            **_prompt_kwargs(section),
                        ) + ownership_blocks.get(sid, "")
                        text, err = "", None
                        last_usage: dict[str, int] = {}
                        for attempt in range(1 + CONTINUATION_ATTEMPTS):
                            prompt_text = prompt if attempt == 0 else (
                                f"{prompt}\n\nYou already produced the following beginning of this "
                                f"section; continue EXACTLY where it stops, without repeating anything:\n"
                                f"<<<PARTIAL\n{text[-4000:]}\nPARTIAL>>>"
                            )
                            finish_reason, last_usage = None, {}
                            ok, last_err = False, None
                            for recovery_try in range(2):
                                failed_cache = cache_name
                                for m in _gemini_models(sec_model):
                                    try:
                                        w_parts2 = [gt.Part(text=prompt_text)]
                                        if inline_parts:
                                            w_parts2 = [*inline_parts, gt.Part(text=prompt_text)]
                                        async for item in _iter_gemini_draft_chunks(
                                            loop, client, m,
                                            [gt.Content(role="user", parts=w_parts2)],
                                            _worker_config(use_cache=use_cache_here and m == sec_model),
                                        ):
                                            if item["kind"] == "chunk":
                                                clean = _strip_section_markers(item["text"])
                                                text += clean
                                                q.put_nowait({"type": "chunk", "text": clean,
                                                              "section_id": sid, "index": idx})
                                            elif item["kind"] == "done":
                                                finish_reason = item.get("finish_reason")
                                                last_usage = item.get("usage") or {}
                                        ok = True
                                        break
                                    except Exception as exc:
                                        last_err = exc
                                        if _is_cache_lost_error(exc):
                                            break
                                if ok:
                                    break
                                if last_err is not None and _is_cache_lost_error(last_err) and recovery_try == 0:
                                    await _recover_cache(failed_cache)
                                    continue
                                break
                            if not ok:
                                err = str(last_err) if last_err else "generation failed"
                                break
                            if last_usage:
                                _add_usage(total_usage, last_usage)
                                _record_call(call_ledger, "drafting",
                                             f"Section: {section.get('heading', '')}",
                                             sec_model, last_usage)
                                await _log_usage(user_id, model, last_usage,
                                                 "/api/chat/draft/generate/stream", session_id)
                            if str(finish_reason) in ("FinishReason.MAX_TOKENS", "MAX_TOKENS") \
                                    and attempt < CONTINUATION_ATTEMPTS:
                                continue
                            break

                        floor = length_plan.get(sid, 0)
                        words = len(text.split())
                        replaced = False
                        if (
                            floor >= 300 and not err
                            and words < int(floor * EXPANSION_TRIGGER_RATIO)
                            and _section_kind(section.get("heading", "")) == "narrative"
                            and not section.get("contains_table")
                        ):
                            try:
                                exp_prompt = (
                                    f"{prompt}\n\nYour previous draft of this section (below) is too "
                                    f"compressed: {words} words against a floor of {floor}. REWRITE the "
                                    "ENTIRE section at full length: narrate every relevant event from the "
                                    "factual matrix as its own complete numbered paragraph. Every grounding "
                                    f"rule still applies — never invent or pad.\n<<<PREVIOUS\n{text.strip()}\n"
                                    "PREVIOUS>>>\nOutput the complete rewritten section only."
                                )
                                e_parts = [gt.Part(text=exp_prompt)]
                                if inline_parts:
                                    e_parts = [*inline_parts, gt.Part(text=exp_prompt)]
                                expanded = ""
                                async for item in _iter_gemini_draft_chunks(
                                    loop, client, model,
                                    [gt.Content(role="user", parts=e_parts)], _worker_config(),
                                ):
                                    if item["kind"] == "chunk":
                                        expanded += item["text"]
                                    elif item["kind"] == "done":
                                        _add_usage(total_usage, item.get("usage"))
                                        _record_call(call_ledger, "expansion",
                                                     f"Expansion: {section.get('heading', '')}",
                                                     model, item.get("usage"))
                                expanded = _strip_section_markers(expanded).strip()
                                if expanded and len(expanded.split()) > words:
                                    text = expanded
                                    replaced = True
                            except Exception as exc:
                                logger.warning("Parallel expansion failed for %s: %s", sid, exc)

                        section_call_meta.append(log_section_call_boundary(
                            session_id, section, prompt, text, last_usage,
                            int((time.monotonic() - sec_started) * 1000), err,
                        ))
                        results[sid] = {"text": text.strip(), "error": err, "replaced": replaced}
                except Exception as exc:
                    logger.exception("Parallel worker crashed for %s", sid)
                    results[sid] = {"text": "", "error": str(exc), "replaced": False}
                finally:
                    q.put_nowait(None)  # sentinel: this section's stream is complete

            worker_tasks = [asyncio.create_task(_worker(s)) for s in sections]

            # Emitter: stream sections to the client in template order; later
            # sections keep generating in the background while earlier ones drain.
            for section in sections:
                sid = section["section_id"]
                idx = section.get("index", 0)
                marker_id = idx + 1
                yield {
                    "type": "section_start",
                    "section_id": sid,
                    "index": idx,
                    "heading": section.get("heading"),
                    "heading_level": section.get("heading_level", 1),
                }
                yield {"type": "chunk", "text": f"\n[START_SECTION_{marker_id}]\n"}
                q = queues[sid]
                while True:
                    item = await q.get()
                    if item is None:
                        break
                    yield item
                yield {"type": "chunk", "text": f"\n[END_SECTION_{marker_id}]\n"}

                r = results.get(sid) or {}
                text = r.get("text", "")
                if r.get("error") and not text.strip():
                    yield {"type": "section_error", "section_id": sid, "index": idx,
                           "message": f"Generation failed: {r.get('error')}"}
                else:
                    completed += 1
                    record = {
                        "section_id": sid,
                        "index": idx,
                        "heading": section.get("heading"),
                        "heading_level": section.get("heading_level", 1),
                        "heading_verbatim": bool(section.get("heading_verbatim", True)),
                        "content": text,
                        "truncated": bool(r.get("error")),
                    }
                    await _safe_save_draft_section(session_id, record)
                    drafted_records.append(record)
                    if r.get("replaced"):
                        yield {"type": "section_replace", "section_id": sid,
                               "index": idx, "text": text}
                    yield {"type": "section_end", "section_id": sid, "index": idx,
                           "heading": section.get("heading"), "chars": len(text),
                           "completed": completed, "total": len(sections)}
            await asyncio.gather(*worker_tasks, return_exceptions=True)

        for section in sequential_sections:
            idx = section.get("index", 0)
            marker_id = idx + 1
            yield {
                "type": "section_start",
                "section_id": section.get("section_id"),
                "index": idx,
                "heading": section.get("heading"),
                "heading_level": section.get("heading_level", 1),
            }
            yield {"type": "chunk", "text": f"\n[START_SECTION_{marker_id}]\n"}

            sec_started = time.monotonic()
            # SPEC 1: ISOLATED, STATELESS calls — no previous-section text is ever
            # passed forward (the old previous_tail accumulation is removed).
            # Coherence comes from compact metadata (doc_state) + the cached
            # global inventory, never from full prior content.
            prompt = _section_prompt(
                structure, section, len(structure.get("sections") or sections),
                "", user_instructions, has_docs=bool(docs),
                facts_digest=facts_digest,
                digest_in_context=(use_adk or digest_cached),
                min_words=length_plan.get(section.get("section_id"), 0),
                doc_state=_build_doc_state(drafted_records),
                **_prompt_kwargs(section),
            )
            section_text = ""
            section_error: str | None = None
            last_usage: dict[str, int] = {}

            # A section may exceed max_output_tokens; continuation calls stitch the tail.
            for attempt in range(1 + CONTINUATION_ATTEMPTS):
                if attempt == 0:
                    prompt_text = prompt
                else:
                    prompt_text = (
                        f"{prompt}\n\nYou already produced the following beginning of this "
                        f"section; continue EXACTLY where it stops, without repeating anything:\n"
                        f"<<<PARTIAL\n{section_text[-4000:]}\nPARTIAL>>>"
                    )

                finish_reason = None
                last_usage: dict[str, int] | None = None
                stream_ok = False
                last_stream_err: Exception | None = None

                # ── Engine 1: Google ADK agent (ContextCacheConfig handles caching) ──
                if use_adk and adk_ctx:
                    # Transient network drops ("server disconnected") deserve one
                    # retry before abandoning ADK — but only if nothing streamed yet,
                    # otherwise the client would see duplicated text.
                    text_before_adk = len(section_text)
                    from agents.drafting_adk import is_primed, mark_primed, run_drafting_turn

                    for adk_try in range(2):
                        try:
                            adk_parts = [gt.Part(text=prompt_text)]
                            if not is_primed(adk_ctx["runner_key"]) and (adk_ctx["doc_parts"] or facts_digest):
                                # First turn primes the ADK session with the supporting
                                # documents + complete fact inventory; ADK caches this
                                # prefix for all later section turns.
                                prime_parts = list(adk_ctx["doc_parts"])
                                if facts_digest:
                                    prime_parts.append(gt.Part(text=(
                                        "FACT INVENTORY (complete extraction of the supporting "
                                        f"documents above — the drafting source of truth):\n{facts_digest}"
                                    )))
                                adk_parts = [*prime_parts, gt.Part(text=prompt_text)]
                            async for item in run_drafting_turn(
                                runner=adk_ctx["runner"],
                                user_id=user_id,
                                adk_session_id=adk_ctx["adk_session_id"],
                                parts=adk_parts,
                            ):
                                if item["kind"] == "chunk":
                                    clean = _strip_section_markers(item["text"])
                                    section_text += clean
                                    yield {
                                        "type": "chunk",
                                        "text": clean,
                                        "section_id": section.get("section_id"),
                                        "index": idx,
                                    }
                                elif item["kind"] == "done":
                                    finish_reason = item.get("finish_reason")
                                    last_usage = item.get("usage")
                            mark_primed(adk_ctx["runner_key"])
                            if section_text.strip():
                                stream_ok = True
                            else:
                                raise RuntimeError("ADK turn produced no text")
                            break
                        except Exception as exc:
                            last_stream_err = exc
                            # Retry once for transient drops — but only when nothing
                            # streamed yet, otherwise the client would see duplicates.
                            if adk_try == 0 and len(section_text) == text_before_adk:
                                logger.warning(
                                    "ADK turn failed for %s (%s) — retrying once",
                                    section.get("section_id"), exc,
                                )
                                await asyncio.sleep(2)
                                continue
                            logger.warning(
                                "ADK drafting turn failed for %s (%s) — falling back to direct Gemini",
                                section.get("section_id"), exc,
                            )
                            use_adk = False
                            try:
                                cache_name, inline_parts, cache_setup_tokens = await prepare_supporting_context(
                                    session_id, docs, model
                                )
                            except Exception as ctx_exc:
                                logger.warning("Fallback context preparation failed: %s", ctx_exc)
                                cache_name, inline_parts = None, _doc_parts(docs) if docs else []
                            break

                # ── Engine 2: direct google-genai with explicit cache / inline parts ──
                if not stream_ok:
                    engine2_prompt = prompt_text
                    if section_text.strip():
                        # ADK streamed a partial section before dying: continue it
                        # instead of restarting, so the client never sees duplicates.
                        engine2_prompt = (
                            f"{prompt}\n\nYou already produced the following beginning of this "
                            f"section; continue EXACTLY where it stops, without repeating anything:\n"
                            f"<<<PARTIAL\n{section_text[-4000:]}\nPARTIAL>>>"
                        )
                    parts = [gt.Part(text=engine2_prompt)]
                    if inline_parts:
                        parts = [*inline_parts, gt.Part(text=engine2_prompt)]

                    config_kwargs: dict[str, Any] = {
                        "temperature": 0.0,            # zero-hallucination: fully deterministic
                        "top_p": 0.1,
                        "max_output_tokens": max_output_tokens_per_section,
                        **_thinking_cfg(),
                    }
                    if cache_name:
                        config_kwargs["cached_content"] = cache_name
                    else:
                        config_kwargs["system_instruction"] = DRAFTING_SYSTEM_PROMPT
                    config = gt.GenerateContentConfig(**config_kwargs)
                    contents = [gt.Content(role="user", parts=parts)]

                    for draft_model in model_chain:
                        try:
                            async for item in _iter_gemini_draft_chunks(
                                loop, client, draft_model, contents, config,
                            ):
                                if item["kind"] == "chunk":
                                    clean = item["text"]
                                    section_text += clean
                                    yield {
                                        "type": "chunk",
                                        "text": clean,
                                        "section_id": section.get("section_id"),
                                        "index": idx,
                                    }
                                elif item["kind"] == "done":
                                    finish_reason = item.get("finish_reason")
                                    last_usage = item.get("usage")
                            model = draft_model
                            stream_ok = True
                            break
                        except Exception as exc:
                            last_stream_err = exc
                            logger.warning(
                                "Section %s model %s failed: %s",
                                section.get("section_id"), draft_model, exc,
                            )

                if not stream_ok and last_stream_err is not None and _is_cache_lost_error(last_stream_err):
                    # Cache expired mid-run: rebuild once and retry this attempt.
                    await _recover_cache(cache_name)
                    yield {"type": "status", "message": "Context cache expired — rebuilt, retrying section…"}
                    continue

                if not stream_ok:
                    section_error = str(last_stream_err) if last_stream_err else "Generation stream failed"
                    logger.error(
                        "Section %s generation failed on all models: %s",
                        section.get("section_id"), section_error,
                    )
                    break

                if last_usage:
                    _add_usage(total_usage, last_usage)
                    _record_call(call_ledger, "drafting",
                                 f"Section: {section.get('heading', '')}",
                                 model, last_usage)
                    await _log_usage(user_id, model, last_usage, "/api/chat/draft/generate/stream", session_id)

                if str(finish_reason) == "FinishReason.MAX_TOKENS" or str(finish_reason) == "MAX_TOKENS":
                    if attempt < CONTINUATION_ATTEMPTS:
                        yield {"type": "status",
                               "message": f"Section {marker_id} hit the output-token limit — continuing…"}
                        continue
                    yield {"type": "status",
                           "message": f"Section {marker_id} truncated after {attempt + 1} passes."}
                break  # normal completion

            yield {"type": "chunk", "text": f"\n[END_SECTION_{marker_id}]\n"}

            if section_error and not section_text.strip():
                yield {
                    "type": "section_error",
                    "section_id": section.get("section_id"),
                    "index": idx,
                    "message": f"Generation failed: {section_error}",
                }
                section_call_meta.append(log_section_call_boundary(
                    session_id, section, prompt, section_text, last_usage,
                    int((time.monotonic() - sec_started) * 1000), section_error,
                ))
            else:
                # ── Coverage-based expansion: a narrative section far below its
                # word floor gets one full-length rewrite pass (never padding —
                # the rewrite narrates each matrix event as its own paragraph). ──
                floor = length_plan.get(section.get("section_id"), 0)
                words = len(section_text.split())
                if (
                    floor >= 300
                    and words < int(floor * EXPANSION_TRIGGER_RATIO)
                    and _section_kind(section.get("heading", "")) == "narrative"
                    and not section.get("contains_table")   # tables: completeness = rows, not words
                    and not section_error
                ):
                    yield {"type": "status",
                           "message": f"Expanding section {marker_id} for full coverage "
                                      f"({words} → {floor}+ words)…"}
                    try:
                        expansion_prompt = (
                            f"{prompt}\n\nYour previous draft of this section (below) is too "
                            f"compressed: {words} words against a floor of {floor}. REWRITE the "
                            "ENTIRE section at full length: narrate every relevant event from the "
                            "factual matrix as its own complete, fully-developed numbered paragraph "
                            "(who, what, when, where, consequence); expand every term into its own "
                            "clause. Every grounding rule still applies — never invent or pad.\n"
                            f"<<<PREVIOUS\n{section_text.strip()}\nPREVIOUS>>>\n"
                            "Output the complete rewritten section only."
                        )
                        expanded = await _silent_engine_turn(
                            expansion_prompt, stage="expansion",
                            label=f"Expansion: {section.get('heading', '')}",
                        )
                        if expanded and len(expanded.split()) > words:
                            section_text = expanded
                            yield {
                                "type": "section_replace",
                                "section_id": section.get("section_id"),
                                "index": idx,
                                "text": section_text,
                            }
                    except Exception as exc:
                        logger.warning("Expansion pass failed for %s: %s", section.get("section_id"), exc)

                section_call_meta.append(log_section_call_boundary(
                    session_id, section, prompt, section_text, last_usage,
                    int((time.monotonic() - sec_started) * 1000), section_error,
                ))
                completed += 1
                record = {
                    "section_id": section.get("section_id"),
                    "index": idx,
                    "heading": section.get("heading"),
                    "heading_level": section.get("heading_level", 1),
                    "heading_verbatim": bool(section.get("heading_verbatim", True)),
                    "content": section_text.strip(),
                    "truncated": bool(section_error),
                }
                await _safe_save_draft_section(session_id, record)
                drafted_records.append(record)
                previous_tail = section_text.strip()[-CONTINUITY_TAIL_CHARS:]
                yield {
                    "type": "section_end",
                    "section_id": section.get("section_id"),
                    "index": idx,
                    "heading": section.get("heading"),
                    "chars": len(section_text),
                    "completed": completed,
                    "total": len(sections),
                }

    final_status = "completed" if completed == len(sections) else "generation_failed"
    if draft_metadata is None:
        draft_metadata = DraftMetadata(
            drafting_strategy=strategy,
            model=model,
            section_calls=section_call_meta,
        )
    try:
        await _safe_update_session(session_id, status=final_status, draft_metadata=draft_metadata.to_dict())
    except Exception:
        await _safe_update_session(session_id, status=final_status)

    # Provisional cost as soon as the sections are done — the audit/repair
    # phase can run for minutes and the user should already see the spend.
    try:
        yield {
            "type": "cost", "provisional": True,
            **compute_draft_cost(
                model, total_usage,
                ttl_seconds=max(get_settings().context_cache_ttl_seconds, 1800),
                elapsed_seconds=time.monotonic() - run_started,
                setup_tokens=cache_setup_tokens,
                ledger=call_ledger,
            ),
            **_split_template_and_draft_cost(call_ledger),
            "calls": call_ledger[-400:],
            "byStage": _ledger_by_stage(call_ledger),
        }
    except Exception as exc:
        logger.warning("Provisional cost computation failed: %s", exc)

    # ── Zero-hallucination grounding audit: verify every draft assertion
    # against the fact inventory, then repair offending sections. ──
    if completed > 0:
        try:
            fresh = await loop.run_in_executor(None, repo.get_session, session_id, user_id)
            all_secs = (fresh or {}).get("draft_sections") or []
            violations: list[Any] = []
            mono_qa: dict[str, Any] = {}  # deterministic-repairs QA snapshot → review packet

            # ── Deterministic normalization: continuous paragraph numbering +
            # compact annexure series — guaranteed, not model-dependent. ──
            normalized_changed = False
            try:
                norm_changes = _normalize_draft(all_secs)
                if norm_changes:
                    normalized_changed = True
                    yield {"type": "status",
                           "message": f"Normalizing paragraph numbering and annexure series "
                                      f"({len(norm_changes)} section(s) updated)…"}
                    for s in all_secs:
                        sid = str(s.get("section_id"))
                        if sid in norm_changes:
                            s["content"] = norm_changes[sid]
                            await _safe_save_draft_section(session_id, s)
                            yield {"type": "section_replace", "section_id": sid,
                                   "index": s.get("index", 0), "text": norm_changes[sid]}
            except Exception as exc:
                logger.warning("Draft normalization failed (draft unchanged): %s", exc)

            # ── Monolithic deterministic repairs (zero LLM calls): unique
            # annexure marks + interim-relief prayer reconciliation. ──
            if strategy == "monolithic" and all_secs:
                try:
                    doc_rec = all_secs[0]
                    txt = doc_rec.get("content") or ""
                    new_txt, repair_info = _monolithic_deterministic_repairs(
                        txt,
                        facts_digest or "",
                        exhibit_register=_plan_exhibits(facts_digest) if facts_digest else None,
                        user_instructions=user_instructions or "",
                    )
                    if new_txt != txt:
                        doc_rec["content"] = new_txt
                        await _safe_save_draft_section(session_id, doc_rec)
                        yield {"type": "section_replace",
                               "section_id": str(doc_rec.get("section_id")),
                               "index": doc_rec.get("index", 0), "text": new_txt}
                        yield {"type": "document_replace", "text": new_txt}
                        msgs = []
                        if repair_info.get("restarted_copies_removed"):
                            msgs.append(
                                "removed duplicated re-drafted content appended "
                                "after the document end"
                            )
                        if repair_info.get("cause_title_deduped"):
                            msgs.append("cause title de-duplicated")
                        if repair_info.get("option_menu_narrowed"):
                            msgs.append("template option menu narrowed to this matter")
                        if repair_info.get("admitted_dues_fixed"):
                            msgs.append("unsafe admissions wording corrected")
                        if repair_info.get("statute_year_fixed"):
                            msgs.append("statute year aligned to source")
                        if repair_info.get("field_swaps_fixed"):
                            msgs.append(
                                f"field-swap corrected ({len(repair_info['field_swaps_fixed'])})"
                            )
                        if repair_info.get("proceedings_placeholder_fixed"):
                            msgs.append("other-proceedings placeholder resolved")
                        if repair_info.get("deponent_age_fixed"):
                            msgs.append("deponent age placeholder resolved")
                        if repair_info.get("unauthorized_signatory_fixed"):
                            msgs.append("unsupported authorized-signatory wording corrected")
                        if repair_info.get("attestation_renumbered"):
                            msgs.append("Statement of Truth / Verification renumbered from 1")
                        if repair_info.get("attestation_rebuilt"):
                            msgs.append("Verification / Statement of Truth ranges rebuilt")
                        notes_rm = repair_info.get("internal_notes_removed") or []
                        if notes_rm:
                            msgs.append(
                                f"removed internal note paragraph(s) {', '.join(map(str, notes_rm))}"
                            )
                        corrupt_n = repair_info.get("corrupted_tables_removed") or 0
                        if corrupt_n:
                            msgs.append(f"removed {corrupt_n} corrupted table(s)")
                        if repair_info.get("body_renumbered"):
                            msgs.append("body paragraph numbering repaired")
                        if repair_info.get("company_registration_added"):
                            msgs.append("Company Registration particulars added")
                        annex_info = repair_info.get("annexures") or {}
                        if annex_info:
                            msgs.append(f"annexures re-marked {annex_info['count']} unique "
                                        f"marks (one document, one mark)")
                        removed_clauses = repair_info.get("interim_prayers_removed") or []
                        if removed_clauses:
                            msgs.append(f"removed {len(removed_clauses)} leftover interim-relief "
                                        f"prayer clause(s) contradicting the declared position")
                        removed_ph = repair_info.get("prayer_placeholders_removed") or []
                        if removed_ph:
                            msgs.append(f"removed {len(removed_ph)} prayer clause(s) with "
                                        f"unresolved [DATA NOT PROVIDED] markers")
                        added = repair_info.get("chronology_rows_added") or []
                        if added:
                            msgs.append(f"added {len(added)} missing chronology row(s) from inventory")
                            # The merge only patches the List-of-Dates table —
                            # instruct the revision pass to narrate these in
                            # the body / invoice table too.
                            from app.services.drafting_schemas import GroundingViolation as _GV
                            _mx = _extract_matrix_rows(facts_digest or "")
                            for _sn in added:
                                violations.append(_GV(
                                    section_id=str(doc_rec.get("section_id", "__document__")),
                                    quote=(_mx.get(_sn) or str(_sn))[:100],
                                    problem=("This event was missing and was only appended to the "
                                             "List of Dates table — ADD a narrating paragraph in "
                                             "the factual body (and an invoice-table row if it is "
                                             "an invoice/payment)."),
                                ))
                        if repair_info.get("lod_rebuilt"):
                            msgs.append("List of Documents rebuilt from body annexure register")
                        cites = repair_info.get("exhibit_citations_added") or 0
                        if cites:
                            msgs.append(f"added {cites} inline exhibit citation(s)")
                        resolved = repair_info.get("placeholders_resolved") or 0
                        if resolved:
                            msgs.append(f"resolved {resolved} placeholder(s) from inventory")
                        sworn = repair_info.get("sworn_placeholders_neutralized") or 0
                        if sworn:
                            msgs.append(f"neutralized {sworn} placeholder(s) in sworn clauses")
                        if msgs:
                            yield {"type": "status",
                                   "message": "Deterministic repairs: " + "; ".join(msgs) + "."}
                    annex_info = repair_info.get("annexures") or {}
                    if annex_info.get("ambiguous"):
                        yield {"type": "status",
                               "message": "Review needed: mark(s) "
                                          + ", ".join(annex_info["ambiguous"])
                                          + " were cited for multiple documents — later citations "
                                            "of these marks and the List of Documents rows should "
                                            "be checked against the new register."}
                    # QA report (extends existing SSE contract — no new event type)
                    mono_qa = {
                        "toBeConfirmed": [
                            {
                                "label": item.get("value", "")[:80],
                                "reason": item.get("reason", ""),
                                "source": item.get("source", ""),
                                "flag": item.get("flag", "UNVERIFIED_PROVENANCE"),
                            }
                            for item in (provenance_to_confirm or [])
                        ],
                        "ambiguousMarks": list(annex_info.get("ambiguous") or []),
                        "removedPrayerClauses": list(
                            repair_info.get("interim_prayers_removed")
                            or repair_info.get("prayer_placeholders_removed")
                            or []
                        ),
                        "chronologyRowsAdded": list(
                            repair_info.get("chronology_rows_added") or []
                        ),
                        "annexureCount": int(annex_info.get("count") or 0),
                        "fieldSwapsFixed": list(repair_info.get("field_swaps_fixed") or []),
                    }
                    yield {"type": "qa_report", **mono_qa}
                except Exception as exc:
                    logger.warning("Monolithic deterministic repairs skipped: %s", exc)

            # ── Deterministic factual-strength lint (inventory anchors vs draft) ──
            if strategy == "monolithic" and all_secs and facts_digest:
                try:
                    doc_rec = all_secs[0]
                    factual_issues = _factual_strength_lint(
                        doc_rec.get("content") or "",
                        facts_digest,
                        section_id=str(doc_rec.get("section_id", "__document__")),
                    )
                    if factual_issues:
                        violations.extend(factual_issues)
                        yield {"type": "status",
                               "message": f"Factual strength lint: {len(factual_issues)} "
                                          "inventory anchor(s) missing from draft…"}
                except Exception as exc:
                    logger.warning("Factual strength lint skipped: %s", exc)

            # ── Table exhibit-mark collision scan (no digest needed) ──
            if strategy == "monolithic" and all_secs:
                try:
                    from app.services.drafting_schemas import GroundingViolation as _GVt
                    collisions = _table_mark_collisions(all_secs[0].get("content") or "")
                    for _mark, _rows in collisions:
                        violations.append(_GVt(
                            section_id=str(all_secs[0].get("section_id", "__document__")),
                            quote=f"ANNEXURE {_mark}: " + " || ".join(_rows[:2]),
                            problem=(f"Two table rows share mark ANNEXURE {_mark} but appear to be "
                                     "DIFFERENT documents (one document, one mark). Verify: if they "
                                     "are different documents, keep the mark on the one introduced "
                                     "first, re-mark the other with the next unused annexure number, "
                                     "and update its List of Documents row and every citation."),
                        ))
                    if collisions:
                        yield {"type": "status",
                               "message": f"Exhibit check: {len(collisions)} table mark "
                                          "collision(s) queued for revision…"}
                except Exception as exc:
                    logger.warning("Table mark collision scan skipped: %s", exc)

            # LLM grounding audit — section-wise when enabled. Monolithic only if
            # DRAFT_MONO_AUDIT=true (default false) so cost stops after the draft.
            if GROUNDING_AUDIT_ENABLED and docs and facts_digest \
                    and (strategy != "monolithic" or MONO_AUDIT_ENABLED):
                yield {"type": "status",
                       "message": "Auditing draft against source documents (zero-hallucination check)…"}
                draft_blob = "\n\n".join(
                    f"[SECTION {s.get('section_id')}] {s.get('heading')}\n{s.get('content', '')}"
                    for s in all_secs
                )
                register = "\n".join(
                    f"ANNEXURE {a['mark']} = {a.get('desc') or '?'}"
                    for a in _build_doc_state(all_secs).get("annexures", [])
                )
                _before_audit = dict(total_usage)
                audit_model = DRAFT_MONO_AUDIT_MODEL if strategy == "monolithic" else model
                if strategy == "monolithic" or str(audit_model).lower().startswith("claude"):
                    audit_model = DRAFT_MONO_AUDIT_MODEL
                report = await _run_grounding_audit(
                    facts_digest, draft_blob, audit_model,
                    usage_sink=total_usage, exhibit_register=register,
                    timeout_s=float(MONO_AUDIT_TIMEOUT_S) if strategy == "monolithic" else 90.0,
                )
                _record_call(call_ledger, "audit", "Grounding & consistency audit",
                             audit_model, _usage_delta(_before_audit, total_usage))
                violations.extend(report.violations if report else [])
                if strategy == "monolithic" and report is None:
                    yield {"type": "status",
                           "message": "Audit skipped or timed out — keeping deterministic repairs only."}

            # ── Interim-relief contradiction: HARD-CODED resolution (this
            # defect survived 7 drafts of prompt-based repair) ──
            try:
                irc = report.interim_relief if report else None
            except NameError:
                irc = None   # audit disabled — no report in scope
            if irc and irc.contradiction and irc.necessity_paragraph_stance == "not_sought" \
                    and irc.argument_section_id and irc.argument_quote:
                target = next((s for s in all_secs
                               if str(s.get("section_id")) == irc.argument_section_id), None)
                if target:
                    cut = _delete_paragraph_containing(target.get("content", ""), irc.argument_quote)
                    if cut is not None:
                        target["content"] = cut
                        await _safe_save_draft_section(session_id, target)
                        yield {"type": "section_replace",
                               "section_id": str(target.get("section_id")),
                               "index": target.get("index", 0), "text": cut}
                        yield {"type": "status",
                               "message": "Interim-relief contradiction resolved — argument "
                                          "paragraph removed (relief not sought; liberty to apply stands)."}
                    else:
                        from app.services.drafting_schemas import GroundingViolation
                        violations.append(GroundingViolation(
                            section_id=irc.argument_section_id,
                            quote=irc.argument_quote[:100],
                            problem=("Contradicts the declared stance that no interim relief is "
                                     "sought: DELETE this argument paragraph entirely; keep only "
                                     "'no interim relief is sought at this stage, with liberty to apply'."),
                        ))

            # Deterministic structural lint — numbering + exhibit mapping.
            lint = _structural_lint(all_secs)
            if lint:
                yield {"type": "status",
                       "message": f"Structural lint: {len(lint)} numbering/exhibit issue(s) found…"}
                violations.extend(lint)

            # ── Monolithic: never re-draft the whole document after stream end.
            # Deterministic repairs already ran; report any notes and finish so
            # cost/UI stop (no Claude full-document revision).
            if strategy == "monolithic":
                if violations:
                    yield {
                        "type": "grounding_report",
                        "violations": [v.model_dump() for v in violations],
                    }
                    yield {"type": "status",
                           "message": f"Draft complete — {len(violations)} note(s) flagged "
                                      "(deterministic repairs applied; no extra LLM revision)."}
                else:
                    yield {"type": "status", "message": "Draft complete."}

                # ── Stage 4 — Adversarial Verification Pass (report-only).
                # A SEPARATE model call: draft + source material → every
                # sentence with no direct source support. It NEVER modifies
                # the draft; the report rides the review packet for the human
                # legal reviewer to read first. ──
                discrepancy_items: list[dict[str, Any]] = []
                verification_error = ""
                if grounded_pipeline and all_secs and docs:
                    yield {"type": "status",
                           "message": "Stage 4/4 — adversarial verification pass "
                                      "(discrepancy report; the draft is not modified)…"}
                    _before_verify = dict(total_usage)
                    try:
                        _verify_task = asyncio.ensure_future(run_discrepancy_review(
                            draft_text=all_secs[0].get("content") or "",
                            facts_digest=facts_digest or "",
                            verified_fields_block=verified_fields_block,
                            source_docs_text=_mono_source_docs_text or "",
                            model=DRAFT_MONO_AUDIT_MODEL,
                            usage_sink=total_usage,
                            timeout_s=float(DISCREPANCY_TIMEOUT_S),
                        ))
                        _vwaited = 0
                        while True:
                            try:
                                d_report = await asyncio.wait_for(
                                    asyncio.shield(_verify_task), timeout=12)
                                break
                            except asyncio.TimeoutError:
                                _vwaited += 12
                                yield {"type": "status",
                                       "message": f"Stage 4/4 — verifying draft against source… ({_vwaited}s)"}
                        _record_call(call_ledger, "verification",
                                     "Adversarial discrepancy review (Stage 4)",
                                     DRAFT_MONO_AUDIT_MODEL,
                                     _usage_delta(_before_verify, total_usage))
                        if d_report is None:
                            verification_error = "verification model unavailable or timed out"
                            yield {"type": "status",
                                   "message": "Stage 4 verification unavailable — "
                                              "flagged in the review packet."}
                        else:
                            discrepancy_items = [i.model_dump() for i in d_report.items]
                            unsupported_n = sum(
                                1 for i in discrepancy_items
                                if i.get("verdict") == "NO_SOURCE_SUPPORT_FOUND"
                            )
                            yield {"type": "discrepancy_report",
                                   "items": discrepancy_items,
                                   "unsupportedCount": unsupported_n}
                            yield {"type": "status",
                                   "message": (f"Verification pass: {unsupported_n} draft "
                                               "statement(s) with NO SOURCE SUPPORT — see "
                                               "the review packet."
                                               if unsupported_n else
                                               "Verification pass: every substantive statement "
                                               "traced to source.")}
                            if run_log:
                                run_log.log_stage("verification", {"items": discrepancy_items})
                    except Exception as exc:
                        verification_error = str(exc)
                        logger.warning("Discrepancy review failed: %s", exc)
                        yield {"type": "status",
                               "message": f"Stage 4 verification failed ({exc}) — "
                                          "flagged in the review packet."}

                # ── REVIEW PACKET — the single surface the human reviewer
                # reads FIRST: ingestion flags, missing/conflicting/unverified
                # fields, provenance flags, QA register, grounding notes and
                # the Stage-4 discrepancy report — never buried in logs.
                # (Template-only drafts have no sources to verify — no packet.) ──
                if grounded_pipeline and docs:
                    review_packet = {
                        "runId": run_log.run_id if run_log else None,
                        "strategy": "monolithic",
                        "ingestion": {
                            "documents": ingestion_report.get("documents") or [],
                            "ocrDerivedDocs": ingestion_report.get("ocr_derived_docs") or [],
                            "totalEstTokens": ingestion_report.get("total_est_tokens", 0),
                            "batches": len(ingestion_report.get("batches") or []),
                        },
                        "fields": {
                            "summary": {k: field_review.get(k, 0) for k in
                                        ("total", "verified", "missing",
                                         "conflicts", "unverified")},
                            "missing": field_review.get("missingFields") or [],
                            "conflicts": field_review.get("conflictFields") or [],
                            "unverifiedCitations": field_review.get("unverifiedCitations") or [],
                            "extractionError": str(field_review.get("error") or ""),
                        },
                        "provenance": provenance_to_confirm or [],
                        "qa": mono_qa,
                        "groundingNotes": [v.model_dump() for v in violations],
                        "discrepancies": discrepancy_items,
                        "verificationError": verification_error,
                    }
                    yield {"type": "review_packet", **review_packet}
                    await _safe_update_session(session_id, review_packet=review_packet)
                    if run_log:
                        run_log.log_stage("review_packet", review_packet)

                violations = []  # skip section-wise LLM repair loop below

            if violations:
                yield {
                    "type": "grounding_report",
                    "violations": [v.model_dump() for v in violations],
                }
                by_sec: dict[str, list] = {}
                for v in violations:
                    by_sec.setdefault(v.section_id, []).append(v)
                sec_map = {s.get("section_id"): s for s in all_secs}
                tmpl_map = {s.get("section_id"): s for s in (structure.get("sections") or [])}
                def _repair_priority(vlist: list) -> int:
                    txt = " ".join(str(v.problem) for v in vlist).lower()
                    structural = ("contradict", "duplicate", "numbering", "mirror",
                                  "two different marks", "does not match the table",
                                  "annexure", "renumber", "statement of truth")
                    return 0 if any(k in txt for k in structural) else 1

                # Structural/contradiction findings get repair slots BEFORE
                # grounding nits — they are the worst recurring defect class.
                repair_items = sorted(
                    by_sec.items(), key=lambda kv: (_repair_priority(kv[1]), -len(kv[1]))
                )[:MAX_AUDIT_REPAIRS]
                yield {"type": "status",
                       "message": f"Repairing {len(repair_items)} section(s) in parallel…"}
                sem_repair = asyncio.Semaphore(3)

                async def _repair_one(sid: str, vlist: list):
                    cur, tmpl = sec_map.get(sid), tmpl_map.get(sid)
                    if not cur or not tmpl:
                        return None
                    findings = "\n".join(f'- "{v.quote}" — {v.problem}' for v in vlist)
                    base_prompt = _section_prompt(
                        structure, tmpl, len(structure.get("sections") or []),
                        "", user_instructions, has_docs=True,
                        facts_digest=facts_digest, digest_in_context=(use_adk or digest_cached),
                        min_words=length_plan.get(sid, 0),
                        # State from every OTHER section, so the repair keeps
                        # numbering and annexure marks coherent.
                        doc_state=_build_doc_state([s for s in all_secs if s.get("section_id") != sid]),
                    )
                    repair_prompt = (
                        f"{base_prompt}\n\nREVIEW FINDINGS — your previous draft of this section "
                        "(below) contains the following issues (unsupported facts and/or "
                        "structural defects like duplicate numbering or unannexed exhibits). "
                        "Rewrite the ENTIRE section correcting each one: unsupported specifics "
                        "become the correct inventory fact or [DATA NOT PROVIDED: …]; numbering "
                        "and annexure marks follow the DOCUMENT STATE. Keep everything else "
                        "intact.\n"
                        f"{findings}\n<<<PREVIOUS\n{cur.get('content', '')}\nPREVIOUS>>>\n"
                        "Output the complete corrected section only."
                    )
                    try:
                        async with sem_repair:
                            fixed = await _silent_engine_turn(
                                repair_prompt, stage="repair",
                                label=f"Repair: {str(cur.get('heading', ''))[:60]}",
                            )
                    except Exception as exc:
                        logger.warning("Audit repair failed for %s: %s", sid, exc)
                        return None
                    if not fixed:
                        return None
                    await _safe_save_draft_section(session_id, {**cur, "content": fixed})
                    return sid, cur, fixed

                repaired = 0
                repair_tasks = [asyncio.create_task(_repair_one(r_sid, r_v)) for r_sid, r_v in repair_items]
                for fut in asyncio.as_completed(repair_tasks):
                    res = await fut
                    if res:
                        rep_sid, rep_cur, rep_fixed = res
                        repaired += 1
                        yield {
                            "type": "section_replace",
                            "section_id": rep_sid,
                            "index": rep_cur.get("index", 0),
                            "text": rep_fixed,
                        }
                yield {"type": "status",
                       "message": f"Review: {len(violations)} issue(s) found (facts + structure), {repaired} section(s) repaired."}
            else:
                yield {"type": "status",
                       "message": "Review passed — facts traceable, numbering and exhibits consistent."}

            # ── Attestation pass: finalize the Verification with the ACTUAL
            # final paragraph ranges, then the Statement of Truth mirroring it
            # exactly — the two sworn statements must never disagree. ──
            # Correctness-critical for section-wise runs (monolithic covers the
            # same duties inside its single revision call above).
            if completed > 0 and strategy != "monolithic":
                tmpl_by_sid = {s.get("section_id"): s for s in (structure.get("sections") or [])}
                cur_by_sid = {str(s.get("section_id")): s for s in all_secs}
                # List of Documents is DERIVED from the final body, never trusted
                # as generated: one row per mark, in order, statuses filled.
                lod_sec = next(
                    (s for s in all_secs if any(
                        k in str(s.get("heading", "")).lower()
                        for k in ("list of documents", "index of documents", "accompanying filings")
                    )), None)
                if lod_sec:
                    l_sid = str(lod_sec.get("section_id"))
                    body_state = _build_doc_state(
                        [s for s in all_secs if str(s.get("section_id")) != l_sid]
                    )
                    reg_lines = "\n".join(
                        f"ANNEXURE {a['mark']} = {a.get('desc') or '?'}"
                        for a in body_state.get("annexures", [])
                    )
                    if reg_lines:
                        yield {"type": "status",
                               "message": "Finalizing List of Documents from the body's annexure register…"}
                        lod_tmpl = {str(t.get("section_id")): t for t in (structure.get("sections") or [])}.get(l_sid)
                        lod_base = _section_prompt(
                            structure, lod_tmpl or lod_sec, len(structure.get("sections") or []),
                            "", user_instructions, has_docs=bool(docs),
                            facts_digest=facts_digest, digest_in_context=(use_adk or digest_cached),
                            doc_state=body_state,
                        )
                        lod_prompt = (
                            f"{lod_base}\nRe-draft the List of Documents STRICTLY from this "
                            "final annexure register — EXACTLY one row per mark, in order "
                            "P-1, P-2, …, with each document's proper description and the "
                            "status column filled ('Annexed herewith'). Do not add rows for "
                            "unmarked documents, do not renumber, do not write "
                            "[DATA NOT PROVIDED] for any document in the register.\n"
                            f"FINAL REGISTER:\n{reg_lines}\n"
                            f"<<<PREVIOUS\n{lod_sec.get('content', '')}\nPREVIOUS>>>\n"
                            "Output the complete corrected section only."
                        )
                        try:
                            lod_fixed = await _silent_engine_turn(
                                lod_prompt, stage="finalization",
                                label="List of Documents (derived from register)",
                            )
                            if lod_fixed:
                                await _safe_save_draft_section(session_id, {**lod_sec, "content": lod_fixed})
                                lod_sec["content"] = lod_fixed
                                yield {"type": "section_replace", "section_id": l_sid,
                                       "index": lod_sec.get("index", 0), "text": lod_fixed}
                        except Exception as exc:
                            logger.warning("List-of-documents finalization failed: %s", exc)

                ver_sec = next((s for s in all_secs
                                if "verification" in str(s.get("heading", "")).lower()), None)
                sot_sec = next((s for s in all_secs
                                if "statement of truth" in str(s.get("heading", "")).lower()), None)
                ver_text = ""
                for att in (ver_sec, sot_sec):
                    if not att:
                        continue
                    a_sid = str(att.get("section_id"))
                    tmpl = tmpl_by_sid.get(att.get("section_id")) or tmpl_by_sid.get(a_sid)
                    if not tmpl:
                        continue
                    yield {"type": "status",
                           "message": f"Finalizing '{str(att.get('heading', ''))[:40]}' with final paragraph ranges…"}
                    att_base = _section_prompt(
                        structure, tmpl, len(structure.get("sections") or []),
                        "", user_instructions, has_docs=bool(docs),
                        facts_digest=facts_digest, digest_in_context=(use_adk or digest_cached),
                        doc_state=_build_doc_state([s for s in all_secs
                                                    if str(s.get("section_id")) != a_sid]),
                    )
                    mirror = ""
                    if att is sot_sec and ver_text:
                        mirror = (
                            "\nTHE FINAL VERIFICATION CLAUSE reads:\n<<<VERIFICATION\n"
                            + ver_text +
                            "\nVERIFICATION>>>\nYour Statement of Truth paragraph ranges must "
                            "MIRROR the Verification's ranges EXACTLY — same numbers, same categories."
                        )
                    att_prompt = (
                        f"{att_base}\nRe-draft this section using the ACTUAL final paragraph "
                        "numbers of the draft (see DOCUMENT STATE)."
                        f"{mirror}\n<<<PREVIOUS\n{cur_by_sid.get(a_sid, {}).get('content', '')}\nPREVIOUS>>>\n"
                        "Output the complete corrected section only."
                    )
                    try:
                        fixed = await _silent_engine_turn(
                            att_prompt, stage="finalization",
                            label=f"Attestation: {str(att.get('heading', ''))[:60]}",
                        )
                    except Exception as exc:
                        logger.warning("Attestation pass failed for %s: %s", a_sid, exc)
                        continue
                    if fixed:
                        await _safe_save_draft_section(session_id, {**cur_by_sid[a_sid], "content": fixed})
                        cur_by_sid[a_sid]["content"] = fixed
                        if att is ver_sec:
                            ver_text = fixed
                        yield {"type": "section_replace", "section_id": a_sid,
                               "index": att.get("index", 0), "text": fixed}

            # ── Final normalization sweep: repairs/deletions this run may have
            # re-introduced numbering or letter gaps — idempotent re-run. ──
            try:
                sweep = _normalize_draft(all_secs)
                for s in all_secs:
                    s_sid = str(s.get("section_id"))
                    if s_sid in sweep:
                        s["content"] = sweep[s_sid]
                        await _safe_save_draft_section(session_id, s)
                        yield {"type": "section_replace", "section_id": s_sid,
                               "index": s.get("index", 0), "text": sweep[s_sid]}
            except Exception as exc:
                logger.warning("Final normalization sweep failed: %s", exc)

            # ── Telemetry: per-draft defect scorecard (same invariants as the
            # regression suite) — measures whether defect rates trend down. ──
            try:
                from app.services.draft_invariants import run_all as _run_invariants
                scorecard = _run_invariants(all_secs, facts_digest)
                logger.info(
                    "Draft scorecard session=%s failed=%d/%d issues=%s",
                    session_id, scorecard["checks_failed"], scorecard["checks_run"],
                    scorecard["issues"],
                )
                yield {"type": "scorecard", **scorecard}
            except Exception as exc:
                logger.warning("Scorecard computation failed: %s", exc)
        except Exception as exc:
            logger.warning("Grounding audit crashed (draft unaffected): %s", exc)

    # Release explicit context cache — stops storage accrual and finalizes the bill.
    run_elapsed = time.monotonic() - run_started
    if cache_name:
        try:
            await delete_context_cache(cache_name)
            await _safe_update_session(session_id, cache_name=None)
            cache_name = None
        except Exception as exc:
            logger.warning("Post-draft cache cleanup failed: %s", exc)

    # Final usage + INR/USD cost breakdown (input / output / cache read /
    # cache storage) — after all passes so audit/repair tokens are included.
    yield {"type": "usage", **total_usage, "modelName": model}
    draft_cost: dict[str, Any] = {}
    try:
        draft_cost = compute_draft_cost(
            model, total_usage,
            ttl_seconds=0,                    # final: run-duration storage only
            elapsed_seconds=run_elapsed,
            setup_tokens=cache_setup_tokens,
            ledger=call_ledger,
        )
        yield {
            "type": "cost",
            "provisional": False,
            "final": True,
            **draft_cost,
            **_split_template_and_draft_cost(call_ledger),
            "calls": call_ledger[-400:],
            "byStage": _ledger_by_stage(call_ledger),
        }
    except Exception as exc:
        logger.warning("Draft cost computation failed: %s", exc)

    # Persist the compiled draft as a chat-history turn (general chat) so the
    # user finds it in their sessions list, rendered with full formatting.
    chat_record: dict[str, Any] = {}
    if completed > 0:
        try:
            from app.services.chat_repository import FileChatRepository

            fresh = await loop.run_in_executor(None, repo.get_session, session_id, user_id)
            all_sections = (fresh or {}).get("draft_sections") or []
            compiled = compile_draft_markdown(structure, all_sections)
            title = structure.get("document_title") or "Draft Document"
            question = f"Drafting Mode — {title}"
            if user_instructions:
                question += f" ({user_instructions.strip()[:120]})"
            chat_record = await loop.run_in_executor(
                None,
                lambda: FileChatRepository.save_chat(
                    file_id=None,
                    user_id=user_id,
                    question=question,
                    answer=compiled,
                    session_id=session_id,   # drafting session doubles as the chat session
                    used_secret_prompt=False,
                    prompt_label="Drafting Mode",
                    chat_type="chat_model",
                ),
            ) or {}
            yield {
                "type": "chat_saved",
                "chat_id": str(chat_record.get("id") or ""),
                "session_id": str(chat_record.get("session_id") or session_id),
            }
        except Exception as exc:  # history persistence must never fail the draft
            logger.warning("Could not save draft to chat history: %s", exc)

    yield {
        "type": "done",
        "session_id": session_id,
        "status": final_status,
        "sections_completed": completed,
        "sections_total": len(sections),
        "drafting_strategy": strategy,
        "draft_metadata": draft_metadata.to_dict() if draft_metadata else None,
        "chat_id": str(chat_record.get("id")) if chat_record.get("id") else None,
        "token_usage": total_usage,
    }
