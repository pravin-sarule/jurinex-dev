"""
Template Analyzer Agent — production pipeline.

Design
------
1. ONE structured-output Gemini call returns section boundaries + metadata +
   fields (schema-enforced JSON, so no regex/JSON-repair guesswork).
2. The actual section text (``source_clauses``) is NEVER copied by the LLM —
   it is sliced verbatim from the uploaded template using resolved line
   boundaries, guaranteeing byte-exact fidelity to the source document.
3. Per-section drafting prompts are built deterministically around the
   verbatim segment (no per-section LLM calls), so downstream drafting
   reproduces each section exactly as it appears in the template.
"""

import asyncio
import json
import logging
import os
import random
import re
from typing import Any, Dict, List, Optional, Tuple

from google import genai
from google.genai import errors as genai_errors

try:
    import json_repair
except ImportError:
    json_repair = None

from ..config import settings

logger = logging.getLogger(__name__)

# Cap the template text embedded in the analysis prompt. Slicing always runs
# against the FULL text, so a cap here only limits what the LLM sees.
MAX_PROMPT_TEMPLATE_CHARS = int(os.getenv("ANALYZER_MAX_PROMPT_CHARS", "180000"))

SECTION_CATEGORIES = [
    "header", "parties", "recitals", "facts", "grounds", "prayer",
    "terms", "verification", "signatures", "schedules", "annexures", "other",
]

FIELD_TYPES = ["string", "date", "number", "currency", "address", "text_long", "boolean"]

LEGAL_TYPES = [
    "Date", "PartyName", "MonetaryAmount", "Address", "StatuteReference",
    "CaseReference", "Relief", "Prayer", "Ground", "GeneralText", "Identifier",
]

UI_HINTS = ["date_picker", "text_input", "textarea", "number_input", "currency_input", "multi_select"]

# Structured-output schema for the single analysis call (OpenAPI subset
# accepted by google-genai `response_schema`).
ANALYSIS_SCHEMA: Dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "template_name": {"type": "STRING"},
        "document_type": {"type": "STRING"},
        "estimated_draft_length": {"type": "STRING"},
        "sections": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "section_name": {"type": "STRING"},
                    "section_category": {"type": "STRING", "enum": SECTION_CATEGORIES},
                    "section_purpose": {"type": "STRING"},
                    "start_marker": {
                        "type": "STRING",
                        "description": "EXACT phrase copied verbatim from one source line where this section begins.",
                    },
                    "template_logic": {"type": "STRING"},
                    "drafting_guidance": {
                        "type": "STRING",
                        "description": "Tone, legal terminology, formatting and conditional-logic notes for drafting this section.",
                    },
                    "page_break_before": {"type": "BOOLEAN"},
                    "fields": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "key": {"type": "STRING"},
                                "label": {"type": "STRING"},
                                "type": {"type": "STRING", "enum": FIELD_TYPES},
                                "required": {"type": "BOOLEAN"},
                                "description": {"type": "STRING"},
                                "legal_type": {"type": "STRING", "enum": LEGAL_TYPES},
                                "ui_hint": {"type": "STRING", "enum": UI_HINTS},
                                "validation_hint": {"type": "STRING"},
                            },
                            "required": ["key", "label", "type", "description"],
                        },
                    },
                },
                "required": ["section_name", "section_category", "section_purpose", "start_marker", "fields"],
            },
        },
    },
    "required": ["template_name", "document_type", "sections"],
}

VALIDATION_SCHEMA: Dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "valid": {"type": "BOOLEAN"},
        "error_prompt": {"type": "STRING"},
        "suggestion": {"type": "STRING"},
    },
    "required": ["valid"],
}

SECTION_CONTENT_SCHEMA: Dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "section_name": {"type": "STRING"},
        "content": {"type": "STRING"},
    },
    "required": ["content"],
}

# Placeholder patterns used for deterministic per-segment field detection.
_PLACEHOLDER_PATTERNS: List[Tuple[re.Pattern, float]] = [
    (re.compile(r"\{\{\s*([A-Za-z][A-Za-z0-9_ \-]{0,60}?)\s*\}\}"), 0.98),
    (re.compile(r"__\s*([A-Za-z][A-Za-z0-9_ \-]{0,60}?)\s*__"), 0.96),
    # Name must start and end alphanumeric so we never match fragments inside
    # a __double_underscore__ placeholder (e.g. "_amount__" → "amount").
    (re.compile(r"(?<!_)_([A-Za-z][A-Za-z0-9_]{0,59}[A-Za-z0-9])_(?!_)"), 0.95),
    (re.compile(r"\[\s*([A-Za-z][A-Za-z0-9_ \-]{1,60}?)\s*\]"), 0.85),
]

_TRANSIENT_MARKERS = ("429", "500", "502", "503", "504", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "DEADLINE_EXCEEDED", "overloaded")


def _normalize_key(raw: str) -> str:
    key = re.sub(r"[^a-zA-Z0-9_]+", "_", str(raw or "").strip().lower()).strip("_")
    return key[:80]


def _humanize(key: str) -> str:
    return key.replace("_", " ").strip().title()


def _infer_field_type(key: str) -> str:
    if any(t in key for t in ("date", "dated", "day", "month", "year_of")):
        return "date"
    if any(t in key for t in ("amount", "rent", "fee", "price", "consideration", "salary", "cost")):
        return "currency"
    if any(t in key for t in ("number", "count", "age", "year", "quantity")):
        return "number"
    if any(t in key for t in ("address", "place", "location")):
        return "address"
    if any(t in key for t in ("facts", "grounds", "prayer", "description", "details", "clause", "relief")):
        return "text_long"
    return "string"


def _legal_type_for(field_type: str, key: str) -> str:
    if field_type == "date":
        return "Date"
    if field_type == "currency":
        return "MonetaryAmount"
    if field_type == "address":
        return "Address"
    if "prayer" in key or "relief" in key:
        return "Relief"
    if "ground" in key:
        return "Ground"
    if any(t in key for t in ("name", "petitioner", "respondent", "party", "advocate", "deponent")):
        return "PartyName"
    if any(t in key for t in ("pan", "aadhar", "gstin", "enrollment", "uid", "fir", "case_no", "petition_no")):
        return "Identifier"
    if any(t in key for t in ("section", "article", "act", "statute")):
        return "StatuteReference"
    return "GeneralText"


def _ui_hint_for(field_type: str) -> str:
    return {
        "date": "date_picker",
        "number": "number_input",
        "currency": "currency_input",
        "text_long": "textarea",
        "address": "textarea",
    }.get(field_type, "text_input")


class AntigravityAgent:
    def __init__(self):
        self._client: Optional[genai.Client] = None
        self.model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-pro")
        self.fallback_model_name = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash")
        self.gemini_timeout = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "240"))
        self.max_retries = int(os.getenv("GEMINI_MAX_RETRIES", "2"))

    @property
    def client(self) -> genai.Client:
        # Lazy init so importing the module never fails/costs anything.
        if self._client is None:
            self._client = genai.Client(api_key=settings.GEMINI_API_KEY)
        return self._client

    # ------------------------------------------------------------------
    # LLM invocation (structured output + retry + model fallback)
    # ------------------------------------------------------------------

    async def _invoke_model(self, model: str, prompt: str, schema: Optional[Dict[str, Any]]) -> str:
        config: Dict[str, Any] = {
            "response_mime_type": "application/json",
            "max_output_tokens": 65536,
            "temperature": 0.1,
        }
        if schema is not None:
            config["response_schema"] = schema
        response = await asyncio.wait_for(
            self.client.aio.models.generate_content(model=model, contents=prompt, config=config),
            timeout=self.gemini_timeout,
        )
        text = (response.text or "").strip()
        if not text:
            raise ValueError(f"Empty response from {model}")
        return text

    @staticmethod
    def _is_transient(err: Exception) -> bool:
        if isinstance(err, asyncio.TimeoutError):
            return True
        if isinstance(err, genai_errors.APIError):
            return getattr(err, "code", 0) in (429, 500, 502, 503, 504)
        message = str(err)
        return any(marker in message for marker in _TRANSIENT_MARKERS)

    async def _call_gemini(self, prompt: str, schema: Optional[Dict[str, Any]] = None) -> Any:
        models = [self.model_name]
        if self.fallback_model_name and self.fallback_model_name != self.model_name:
            models.append(self.fallback_model_name)

        last_error: Optional[Exception] = None
        for model in models:
            for attempt in range(self.max_retries + 1):
                try:
                    text = await self._invoke_model(model, prompt, schema)
                    return self._parse_json(text)
                except Exception as err:  # noqa: BLE001 — classified below
                    last_error = err
                    transient = self._is_transient(err)
                    logger.warning(
                        "Gemini call failed (model=%s attempt=%d transient=%s): %s",
                        model, attempt + 1, transient, err,
                    )
                    if not transient:
                        break  # non-transient → try the fallback model directly
                    if attempt < self.max_retries:
                        await asyncio.sleep((2 ** attempt) + random.uniform(0, 0.5))
        raise ValueError(f"Gemini analysis failed after retries: {last_error}")

    def _parse_json(self, text: str) -> Any:
        # Structured output normally returns clean JSON; strip fences defensively.
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as err:
            if json_repair is not None:
                try:
                    return json_repair.loads(cleaned)
                except Exception:
                    pass
            raise ValueError(f"Failed to parse Gemini response as JSON: {err}") from err

    # ------------------------------------------------------------------
    # Deterministic layout analysis
    # ------------------------------------------------------------------

    def _compute_page_metrics(self, template_text: str) -> Dict[str, int]:
        lines = template_text.splitlines() or [template_text]
        line_lengths = [len(line.rstrip()) for line in lines if line.strip()]
        indents = [len(line) - len(line.lstrip(" ")) for line in lines if line.strip()]
        page_width = max(line_lengths, default=80)
        sorted_indents = sorted(indents)
        std_indent = sorted_indents[len(sorted_indents) // 2] if sorted_indents else 0
        return {
            "page_width": page_width,
            "std_indent": std_indent,
            "deep_indent": std_indent + 8,
            "right_zone_start": max(int(page_width * 0.65), std_indent + 20),
        }

    def _clean_heading_text(self, text: str) -> str:
        cleaned = re.sub(r"\s+", " ", str(text or "")).strip(" \t:-.")
        cleaned = re.sub(r"^[\(\[]+", "", cleaned).strip()
        cleaned = re.sub(r"[\)\]]+$", "", cleaned).strip()
        return cleaned

    def _section_name_from_marker(self, marker: str) -> str:
        text = self._clean_heading_text(marker)
        if not text:
            return ""
        # Roman numerals must be followed by punctuation so we never eat the
        # leading letters of real words (e.g. the "M" in "MOST RESPECTFULLY").
        text = re.sub(r"^\s*(?:\d+(?:\.\d+){0,3}[\.\)]?|[IVXLCM]+[\.\)])\s*", "", text).strip()
        return self._clean_heading_text(text)

    def _looks_like_heading(self, line: str) -> bool:
        text = self._clean_heading_text(line)
        if not text or len(text) < 4 or len(text) > 120:
            return False
        if "{{" in text or "}}" in text or "__" in text:
            return False
        upper_text = text.upper()
        exclude_phrases = (
            "IN THE HIGH COURT", "IN THE SUPREME COURT", "IN THE MATTER OF",
            "UNDER ARTICLE", "ORIGINAL JURISDICTION", "CIVIL JURISDICTION",
            "WRIT PETITION NO", "APPLICATION NO", "SUIT NO", "VERSUS", "BETWEEN",
            "AND IN THE MATTER", "PETITION UNDER", "AFFIDAVIT ON BEHALF",
            "DATED THIS", "PRESENTED ON", "RESPECTFULLY SHOWETH",
            "ADVOCATE FOR", "COUNSEL FOR", "APPELLATE JURISDICTION",
        )
        if any(phrase in upper_text for phrase in exclude_phrases):
            return False
        numbered = re.match(r"^(?:\d+(?:\.\d+){0,3}|[IVXLCM]+)[\.\)]?\s+[A-Z]", text)
        uppercase = bool(re.match(r"^[A-Z][A-Z0-9\s,&/\-\(\)]{3,}$", text)) and not re.search(r"[a-z]", text)
        titled_legal = bool(re.match(
            r"^(agreement|parties|party details|definitions|interpretation|recitals|background|facts|grounds|"
            r"prayer|consideration|term|termination|confidentiality|indemnity|governing law|jurisdiction|"
            r"dispute resolution|notices|signature|execution|schedule|annexure|witness|property|payment|"
            r"obligations|rights|verification|declaration|synopsis|list of dates)\b",
            text, re.IGNORECASE,
        ))
        return bool(numbered or uppercase or titled_legal)

    _STRONG_HEADING_KEYWORDS = re.compile(
        r"^(parties|party details|definitions|interpretation|recitals|background|facts|brief facts|grounds|"
        r"prayer|interim prayer|consideration|term|termination|confidentiality|indemnity|governing law|"
        r"jurisdiction clause|dispute resolution|notices|signature|execution|schedule|annexure|witness|"
        r"payment|obligations|verification|declaration|synopsis|list of dates|memo of parties|index)\b",
        re.IGNORECASE,
    )

    def _is_strong_heading(self, line: str) -> bool:
        """Conservative check used for backfilling sections the LLM missed:
        only numbered headings or canonical legal section keywords qualify,
        so generic ALL-CAPS boilerplate lines never split real sections."""
        text = self._clean_heading_text(line)
        if not self._looks_like_heading(text):
            return False
        if re.match(r"^(?:\d+(?:\.\d+){0,3}[\.\)]?|[IVXLCM]+[\.\)])\s+\S", text):
            return True
        return bool(self._STRONG_HEADING_KEYWORDS.match(self._section_name_from_marker(text) or text))

    def _heading_candidates(self, template_text: str, max_candidates: int = 60, strict: bool = False) -> List[Dict[str, Any]]:
        """Detected headings with 1-based line numbers — fed to the LLM as anchor hints."""
        candidates: List[Dict[str, Any]] = []
        seen = set()
        for idx, raw in enumerate(str(template_text or "").splitlines(), start=1):
            line = self._clean_heading_text(raw)
            if strict:
                if not self._is_strong_heading(line):
                    continue
            elif not self._looks_like_heading(line):
                continue
            key = re.sub(r"[^a-z0-9]+", "_", line.lower()).strip("_")
            if not key or key in seen:
                continue
            seen.add(key)
            candidates.append({"line": idx, "text": line})
            if len(candidates) >= max_candidates:
                break
        return candidates

    # ------------------------------------------------------------------
    # Marker → line resolution and verbatim slicing
    # ------------------------------------------------------------------

    @staticmethod
    def _norm_for_match(text: str) -> str:
        return re.sub(r"\s+", " ", str(text or "").strip().lower())

    def _resolve_marker_line(self, lines: List[str], marker: str, search_from: int = 1) -> int:
        """Return 1-based line number of the marker, 0 when unresolved."""
        target = self._norm_for_match(marker)
        if not target:
            return 0
        # Pass 1: containment match scanning forward from `search_from`.
        for idx in range(max(search_from, 1), len(lines) + 1):
            if target in self._norm_for_match(lines[idx - 1]):
                return idx
        # Pass 2: relaxed prefix match (first ~30 chars) over the whole document.
        prefix = target[:30]
        if len(prefix) >= 8:
            for idx, line in enumerate(lines, start=1):
                if prefix in self._norm_for_match(line):
                    return idx
        return 0

    def _slice_lines(self, lines: List[str], start_line: int, end_line: int) -> str:
        start = max(start_line, 1)
        end = end_line if end_line >= start else len(lines)
        return "\n".join(lines[start - 1:end]).strip("\n")

    def _detect_segment_fields(self, segment: str) -> List[Dict[str, Any]]:
        fields: List[Dict[str, Any]] = []
        seen = set()
        for pattern, confidence in _PLACEHOLDER_PATTERNS:
            for match in pattern.finditer(segment):
                key = _normalize_key(match.group(1))
                if not key or len(key) < 2 or key in seen:
                    continue
                seen.add(key)
                field_type = _infer_field_type(key)
                fields.append({
                    "key": key,
                    "type": field_type,
                    "label": _humanize(key),
                    "required": True,
                    "description": f"Value for {_humanize(key).lower()} found as a placeholder in the template.",
                    "legal_type": _legal_type_for(field_type, key),
                    "ui_hint": _ui_hint_for(field_type),
                    "confidence": confidence,
                    "extraction_methods": ["segment_placeholder"],
                })
        return fields

    # ------------------------------------------------------------------
    # Field normalisation
    # ------------------------------------------------------------------

    def _normalize_field(self, field: Any, section_id: str) -> Dict[str, Any]:
        if isinstance(field, dict):
            raw_key = field.get("key") or field.get("field_id") or ""
            base = dict(field)
        else:
            raw_key = str(field or "")
            base = {}
        key = _normalize_key(raw_key) or "unnamed_field"
        field_type = base.get("type") if base.get("type") in FIELD_TYPES else _infer_field_type(key)
        return {
            "key": key,
            "type": field_type,
            "label": base.get("label") or _humanize(key),
            "required": bool(base.get("required", True)),
            "default_value": base.get("default_value", ""),
            "validation_rules": base.get("validation_rules") or base.get("validation_hint") or "",
            "description": base.get("description") or f"Field for {_humanize(key).lower()}",
            "legal_type": base.get("legal_type") or _legal_type_for(field_type, key),
            "ui_hint": base.get("ui_hint") or _ui_hint_for(field_type),
            "section_id": base.get("section_id") or section_id,
        }

    # ------------------------------------------------------------------
    # Deterministic drafting prompt (fidelity-first)
    # ------------------------------------------------------------------

    def _build_drafting_prompt(self, section: Dict[str, Any], document_type: str) -> str:
        source = section.get("source_clauses") or ""
        fields = section.get("fields") or []
        field_lines = "\n".join(
            f'- "{f["key"]}" ({f.get("type", "string")}): {f.get("label", "")} — {f.get("description", "")}'
            for f in fields if isinstance(f, dict) and f.get("key")
        ) or "- (no fillable fields detected in this section)"
        guidance = str(section.get("drafting_guidance") or "").strip()
        guidance_block = f"\nADDITIONAL DRAFTING GUIDANCE:\n{guidance}\n" if guidance else ""

        return f"""You are drafting the "{section.get('section_name', 'Untitled Section')}" section of a {document_type or 'legal document'}.

SOURCE TEMPLATE SEGMENT (AUTHORITATIVE — extracted verbatim from the uploaded template):
\"\"\"{source}\"\"\"

TASK:
Reproduce this section EXACTLY as it appears in the source segment above — same wording, same clause order, same numbering style, same ALL-CAPS headings, same line breaks and indentation — replacing only the fillable placeholders with the provided values.

FIELDS TO FILL:
{field_lines}

STRICT RULES:
1. ZERO REWRITING: Do not paraphrase, shorten, expand, or "improve" any clause. The source segment is legally settled boilerplate.
2. PLACEHOLDER RESOLUTION: Replace placeholders (__field__, {{{{field}}}}, [field], blanks) with the supplied values. If a value is missing, keep the placeholder exactly as-is — never guess.
3. FORMATTING FIDELITY: Preserve line breaks, indentation, numbering (1., 1.1, (a), A.), ALL-CAPS headings, and centered header blocks.
4. LEGAL LANGUAGE: Keep court phrases verbatim (e.g. "MOST RESPECTFULLY SHOWETH", "It is most respectfully prayed").
5. SCOPE: Output ONLY this section — no preceding or following sections, no commentary, no markdown.
{guidance_block}"""

    # ------------------------------------------------------------------
    # Main analysis pipeline
    # ------------------------------------------------------------------

    def _build_analysis_prompt(
        self,
        template_text: str,
        headings: List[Dict[str, Any]],
        metrics: Dict[str, int],
        template_file_signed_url: Optional[str],
    ) -> str:
        prompt_text = template_text
        truncated_note = ""
        if len(prompt_text) > MAX_PROMPT_TEMPLATE_CHARS:
            prompt_text = prompt_text[:MAX_PROMPT_TEMPLATE_CHARS]
            truncated_note = "\nNOTE: the template was truncated for this prompt; still identify every section heading you can see.\n"

        headings_block = "\n".join(f"  line {h['line']}: {h['text']}" for h in headings) or "  (no headings auto-detected)"
        url_block = f"\nTEMPLATE DOCUMENT URL (visual reference for layout/tables/signature blocks):\n{template_file_signed_url}\n" if template_file_signed_url else ""

        return f"""You are an expert Legal Document Engineer analyzing an uploaded legal template (Indian legal practice).

Your job: segment the template into its logical drafting sections and identify every fillable field. You do NOT copy section text — boundaries only. Another system slices the text verbatim using your start_marker values, so marker accuracy is critical.
{url_block}
PAGE METRICS: {json.dumps(metrics)}

AUTO-DETECTED HEADING CANDIDATES (line numbers are 1-based; use these as anchors, correct or extend them as needed):
{headings_block}

REQUIREMENTS:
1. SECTIONS — cover the ENTIRE template top to bottom, in document order, with no gaps:
   - The court/document header block (cause title, party blocks, "IN THE MATTER OF", VERSUS) is its own "header" section.
   - Every numbered or ALL-CAPS heading (FACTS, GROUNDS, PRAYER, VERIFICATION, schedules, annexures, signature blocks…) is a section.
   - start_marker MUST be an EXACT phrase copied verbatim from a single line of the source where the section begins (prefer the heading line itself, including its number, e.g. "2. BRIEF FACTS AND BACKGROUND").
   - section_name: clean formal heading (no clause text). section_purpose: one sentence on its legal role.
   - drafting_guidance: tone, mandatory legal terminology (e.g. "mala fide", "ultra vires" where relevant), formatting rules (ALL CAPS / centered / numbered list style), and any conditional logic visible in the template.
2. FIELDS — for each section list every fillable field:
   - Explicit placeholders: {{{{name}}}}, __date__, _field_, [amount], "I, _______", "___ day of ___".
   - Implied fields: data a drafter must supply even without a blank (court name, party names, dates, amounts).
   - key = snake_case; label = human readable; type/legal_type/ui_hint per the schema enums.
3. Also return template_name (formal), document_type (specific legal document type), estimated_draft_length (e.g. "5-8 pages").

SOURCE TEMPLATE:
\"\"\"{prompt_text}\"\"\"{truncated_note}"""

    def _finalize_sections(
        self,
        llm_sections: List[Dict[str, Any]],
        template_text: str,
        document_type: str,
    ) -> List[Dict[str, Any]]:
        lines = template_text.splitlines()

        # 1. Resolve every LLM section's start_marker to a line number.
        resolved: List[Dict[str, Any]] = []
        seen_lines = set()
        cursor = 1
        for section in llm_sections:
            if not isinstance(section, dict):
                continue
            marker = self._clean_heading_text(section.get("start_marker", ""))
            line_no = self._resolve_marker_line(lines, marker, search_from=cursor)
            if line_no == 0 or line_no in seen_lines:
                # Unresolvable/duplicate boundary — merge its fields into the previous section.
                if resolved and section.get("fields"):
                    resolved[-1].setdefault("_extra_fields", []).extend(section["fields"])
                logger.info("Dropping unresolvable section boundary: %r", marker)
                continue
            seen_lines.add(line_no)
            cursor = line_no
            resolved.append({**section, "start_marker": marker, "start_line": line_no})

        # 2. Backfill with deterministic heading anchors the LLM missed
        #    (strict mode: numbered or canonical legal headings only).
        for heading in self._heading_candidates(template_text, strict=True):
            if heading["line"] in seen_lines:
                continue
            near_existing = any(abs(heading["line"] - ln) <= 1 for ln in seen_lines)
            if near_existing:
                continue
            seen_lines.add(heading["line"])
            resolved.append({
                "section_name": self._section_name_from_marker(heading["text"]) or heading["text"],
                "section_category": "other",
                "section_purpose": f"Draft the {heading['text']} section as structured in the source template.",
                "start_marker": heading["text"],
                "start_line": heading["line"],
                "drafting_guidance": "",
                "fields": [],
            })

        if not resolved:
            resolved = [{
                "section_name": "Full Document",
                "section_category": "other",
                "section_purpose": "Complete template content.",
                "start_marker": lines[0].strip() if lines else "",
                "start_line": 1,
                "drafting_guidance": "",
                "fields": [],
            }]

        resolved.sort(key=lambda s: s["start_line"])
        # The first section owns everything from the top of the document
        # (court header lines usually precede the first detected heading).
        resolved[0]["start_line"] = 1

        # 3. Compute end boundaries, slice verbatim text, normalise fields,
        #    and build the deterministic drafting prompt.
        finalized: List[Dict[str, Any]] = []
        for index, section in enumerate(resolved):
            nxt = resolved[index + 1] if index + 1 < len(resolved) else None
            end_line = (nxt["start_line"] - 1) if nxt else len(lines)
            source_clauses = self._slice_lines(lines, section["start_line"], end_line)

            section_id = f"section_{index + 1:03d}"
            raw_fields = list(section.get("fields") or []) + list(section.get("_extra_fields") or [])
            normalized_fields: List[Dict[str, Any]] = []
            seen_keys = set()
            for field in raw_fields:
                normalized = self._normalize_field(field, section_id)
                if normalized["key"] in seen_keys:
                    continue
                seen_keys.add(normalized["key"])
                normalized_fields.append(normalized)
            # Deterministic sweep: placeholders physically present in this segment.
            for field in self._detect_segment_fields(source_clauses):
                if field["key"] in seen_keys:
                    continue
                seen_keys.add(field["key"])
                field["section_id"] = section_id
                normalized_fields.append(self._normalize_field(field, section_id))

            name = self._clean_heading_text(section.get("section_name", "")) or \
                self._section_name_from_marker(section.get("start_marker", "")) or f"Section {index + 1}"
            category = section.get("section_category") if section.get("section_category") in SECTION_CATEGORIES else "other"

            entry = {
                "section_id": section_id,
                "section_name": name,
                "section_purpose": section.get("section_purpose", ""),
                "section_category": category,
                "order": index,
                "page_break_before": bool(section.get("page_break_before", False)),
                "estimated_words": max(len(source_clauses.split()), 50),
                "source_clauses": source_clauses,
                "start_marker": section.get("start_marker", ""),
                "end_marker": (nxt or {}).get("start_marker", ""),
                "start_line": section["start_line"],
                "end_line": end_line,
                "depends_on": [],
                "drafting_guidance": section.get("drafting_guidance", ""),
                "template_logic": section.get("template_logic", ""),
                "required_fields": [f["key"] for f in normalized_fields],
                "format_blueprint": {"alignment": "LEFT", "notes": "Reproduce alignment exactly as in source_clauses."},
                "is_subsection": False,
                "parent_section_id": None,
                "fields": normalized_fields,
            }
            entry["drafting_prompt"] = self._build_drafting_prompt(entry, document_type)
            entry["ai_drafting_instruction"] = entry["drafting_prompt"]
            finalized.append(entry)
        return finalized

    async def analyze_template(self, template_text: str, template_file_signed_url: Optional[str] = None) -> Dict[str, Any]:
        template_text = str(template_text or "")
        if not template_text.strip():
            raise ValueError("Template text is empty — nothing to analyze.")

        word_count = len(template_text.split())
        metrics = self._compute_page_metrics(template_text)
        headings = self._heading_candidates(template_text)

        prompt = self._build_analysis_prompt(template_text, headings, metrics, template_file_signed_url)
        result = await self._call_gemini(prompt, schema=ANALYSIS_SCHEMA)
        if not isinstance(result, dict):
            raise ValueError("Analysis response was not a JSON object.")

        document_type = str(result.get("document_type") or "Legal Document")
        sections = self._finalize_sections(result.get("sections") or [], template_text, document_type)

        all_fields: List[Dict[str, Any]] = []
        seen_keys = set()
        for section in sections:
            for field in section["fields"]:
                if field["key"] in seen_keys:
                    continue
                seen_keys.add(field["key"])
                all_fields.append(dict(field))

        analysis = {
            "template_name": str(result.get("template_name") or "Untitled Template"),
            "document_type": document_type,
            "estimated_draft_length": str(result.get("estimated_draft_length") or f"~{max(word_count // 350, 1)} pages"),
            "total_sections": len(sections),
            "page_metrics": metrics,
            "sections": sections,
            "all_fields": all_fields,
        }
        logger.info(
            "Template analyzed: %d sections, %d fields from a %d-word document.",
            len(sections), len(all_fields), word_count,
        )
        return analysis

    # ------------------------------------------------------------------
    # Downstream helpers (deterministic — no extra LLM latency)
    # ------------------------------------------------------------------

    async def generate_section_prompts(self, section_data: dict) -> Dict[str, Any]:
        """
        Build the per-section master drafting instruction deterministically.
        The verbatim source segment is already the ground truth, so an extra
        LLM round-trip per section adds latency without adding fidelity.
        """
        section_name = section_data.get("section_name", "Untitled Section")
        source_text = str(section_data.get("source_clauses") or "")
        fields = section_data.get("fields", []) or []
        word_count = len(source_text.split())

        master_prompt = section_data.get("drafting_prompt") or self._build_drafting_prompt(
            section_data, section_data.get("document_type", "legal document"),
        )
        complexity = "simple" if word_count < 120 else ("moderate" if word_count < 450 else "complex")

        return {
            "section_intro": (
                f'The "{section_name}" section will be reproduced exactly as structured in your uploaded template, '
                f"with {len(fields)} fillable field(s) merged into the original legal language."
            ),
            "drafting_complexity": complexity,
            "estimated_output_words": max(word_count, 50),
            "constraint_set": [
                "Reproduce the source template segment verbatim — no paraphrasing or restructuring.",
                "Replace only the fillable placeholders with user-provided values; keep missing placeholders as-is.",
                "Preserve numbering, indentation, ALL-CAPS headings, and court-style phrases exactly.",
                "Do not add clauses, facts, or legal citations that are not in the source segment.",
            ],
            "field_prompts": [{"field_id": "master_instruction", "prompt": master_prompt}],
            "dependencies": section_data.get("depends_on", []) or [],
            "legal_references": [],
        }

    async def contextualize_fields(self, template_text: str, fields: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """
        Deterministic legal-type/ui-hint enrichment for fields that were merged
        in from the hybrid extractor (analysis-call fields already carry these).
        """
        context: Dict[str, Dict[str, Any]] = {}
        for field in fields or []:
            if not isinstance(field, dict):
                continue
            key = _normalize_key(field.get("key") or "")
            if not key:
                continue
            field_type = field.get("type") if field.get("type") in FIELD_TYPES else _infer_field_type(key)
            context[key] = {
                "legal_type": field.get("legal_type") or _legal_type_for(field_type, key),
                "ui_hint": field.get("ui_hint") or _ui_hint_for(field_type),
                "description": field.get("description") or f"Provide the {_humanize(key).lower()}.",
                "validation_hint": field.get("validation_rules") or "",
            }
        return context

    # ------------------------------------------------------------------
    # Drafting-time endpoints
    # ------------------------------------------------------------------

    async def validate_input(self, field_info: dict, user_input: str) -> Dict[str, Any]:
        prompt = f"""Validate a user's input for a legal template field.

FIELD RULES: {json.dumps(field_info, ensure_ascii=False)}
USER INPUT: "{user_input}"

Return valid=true when the input satisfies the field's type and rules; otherwise valid=false with a short error_prompt and an optional suggestion."""
        result = await self._call_gemini(prompt, schema=VALIDATION_SCHEMA)
        return result if isinstance(result, dict) else {"valid": True}

    async def generate_section_content(self, section_data: dict, field_values: dict) -> str:
        drafting_prompt = section_data.get("drafting_prompt") or self._build_drafting_prompt(
            section_data, section_data.get("document_type", "legal document"),
        )
        prompt = f"""{drafting_prompt}

USER VALUES (FINAL DATA):
{json.dumps(field_values, indent=2, ensure_ascii=False)}

Return the fully compiled section text in the "content" field. Output the section text only — no explanations, no markdown."""
        result = await self._call_gemini(prompt, schema=SECTION_CONTENT_SCHEMA)
        if isinstance(result, dict):
            return str(result.get("content") or "")
        return ""
