from google import genai
try:
    import google.adk as adk
except ImportError:
    adk = None
try:
    import json_repair
except ImportError:
    json_repair = None
import json
import re
import asyncio
import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from ..config import settings


class AntigravityAgent:
    def __init__(self):
        self.client = genai.Client(api_key=settings.GEMINI_API_KEY)
        self.model_name = "gemini-2.5-pro"

    def _attempt_json_repair(self, text: str) -> str:
        open_braces = 0
        open_brackets = 0
        in_string = False
        escape_next = False

        for char in text:
            if escape_next:
                escape_next = False
                continue

            if char == "\\":
                escape_next = True
                continue

            if char == '"' and not in_string:
                in_string = True
            elif char == '"' and in_string:
                in_string = False
            elif not in_string:
                if char == "{":
                    open_braces += 1
                elif char == "}":
                    open_braces -= 1
                elif char == "[":
                    open_brackets += 1
                elif char == "]":
                    open_brackets -= 1

        text = text.rstrip()
        if text.endswith(","):
            text = text[:-1]
        return text + ("]" * open_brackets) + ("}" * open_braces)

    async def _call_gemini(self, prompt: str):
        print(f"DEBUG: Calling Gemini model {self.model_name} (Async)...")
        try:
            response = await asyncio.wait_for(
                self.client.aio.models.generate_content(
                    model=self.model_name,
                    contents=prompt,
                    config={
                        "response_mime_type": "application/json",
                        "max_output_tokens": 65536,
                        "temperature": 0.1,
                    },
                ),
                timeout=120.0,
            )
            print("DEBUG: Gemini response received.")
        except asyncio.TimeoutError:
            print("DEBUG: Gemini call timed out after 120s.")
            raise ValueError("Gemini AI analysis timed out. Please try again.")
        except Exception as e:
            print(f"DEBUG: Gemini call failed: {e}")
            raise e

        text = response.text.strip()
        print(f"DEBUG: Gemini response length: {len(text)} characters")

        json_match = re.search(r"```(?:json)?\s*\n?({[\s\S]*})\s*\n?```", text)
        if json_match:
            clean_text = json_match.group(1)
        else:
            json_match = re.search(r"({[\s\S]*})", text)
            clean_text = json_match.group(1) if json_match else text

        clean_text = re.sub(r",\s*([\]}])", r"\1", clean_text)
        clean_text = re.sub(r"[\x00-\x1F\x7F]", "", clean_text)
        clean_text = re.sub(r'\\(?!["\\/bfnrt])(?!u[0-9a-fA-F]{4})', r"\\\\", clean_text)

        try:
            return json.loads(clean_text)
        except json.JSONDecodeError as e:
            print(f"JSON Parse Error: {str(e)}")
            error_pos = getattr(e, "pos", 0)

            if error_pos >= len(clean_text) - 10:
                repaired_text = self._attempt_json_repair(clean_text)
                if repaired_text != clean_text:
                    try:
                        return json.loads(repaired_text)
                    except json.JSONDecodeError:
                        pass

            if json_repair is not None:
                try:
                    return json_repair.loads(clean_text)
                except Exception as repair_err:
                    print(f"json_repair fallback failed: {repair_err}")

            try:
                return json.loads(self._attempt_json_repair(clean_text))
            except json.JSONDecodeError:
                pass

            try:
                debug_dir = "debug_json_errors"
                os.makedirs(debug_dir, exist_ok=True)
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                debug_file = os.path.join(debug_dir, f"failed_json_{timestamp}.txt")
                with open(debug_file, "w", encoding="utf-8") as f:
                    f.write(clean_text)
                print(f"DEBUG: Saved problematic JSON to {debug_file}")
            except Exception as save_error:
                print(f"WARNING: Could not save debug file: {save_error}")

            raise ValueError(f"Failed to parse Gemini response as JSON: {str(e)}")

    def _compute_page_metrics(self, template_text: str) -> Dict[str, int]:
        lines = template_text.splitlines() or [template_text]
        line_lengths = [len(line.rstrip()) for line in lines if line.strip()]
        indents = [len(line) - len(line.lstrip(" ")) for line in lines if line.strip()]
        page_width = max(line_lengths, default=80)
        sorted_indents = sorted(indents)
        std_indent = sorted_indents[len(sorted_indents) // 2] if sorted_indents else 0
        deep_indent = std_indent + 8
        right_zone_start = max(int(page_width * 0.65), std_indent + 20)
        return {
            "page_width": page_width,
            "std_indent": std_indent,
            "deep_indent": deep_indent,
            "right_zone_start": right_zone_start,
        }

    def _classify_line(self, line: str, metrics: Dict[str, int]) -> str:
        stripped = line.rstrip("\n")
        if not stripped.strip():
            return "BLANK"

        indent = len(stripped) - len(stripped.lstrip(" "))
        text = stripped.strip()
        text_len = len(text)

        if re.fullmatch(r"[-_=]{3,}", text):
            return "SEPARATOR"
        if "|" in text or re.search(r"\s{3,}\S+\s{3,}\S+", stripped):
            return "TABLE_ROW"
        if indent >= metrics["right_zone_start"]:
            return "RIGHT"
        if indent >= metrics["deep_indent"]:
            return "LEFT_INDENT_MORE"
        if indent > metrics["std_indent"]:
            return "LEFT_INDENT"
        left_padding = indent
        right_padding = max(metrics["page_width"] - (indent + text_len), 0)
        if abs(left_padding - right_padding) <= 6 and left_padding > 0:
            return "CENTER"
        return "LEFT"

    def _extract_layout_blueprint(self, template_text: str, metrics: Dict[str, int]) -> List[Dict[str, Any]]:
        blueprint: List[Dict[str, Any]] = []
        pages = template_text.split("\f")
        for page_index, page_text in enumerate(pages, start=1):
            for line_index, line in enumerate(page_text.splitlines(), start=1):
                blueprint.append(
                    {
                        "page": page_index,
                        "line_no": line_index,
                        "align": self._classify_line(line, metrics),
                        "text": line.strip(),
                        "indent": len(line) - len(line.lstrip(" ")),
                    }
                )
        return blueprint

    def _blueprint_to_display(self, blueprint: List[Dict[str, Any]], max_lines: int = 500) -> str:
        rendered: List[str] = []
        for item in blueprint[:max_lines]:
            text = item["text"] if item["text"] else "<blank>"
            rendered.append(
                f"[P{item['page']:02d}:L{item['line_no']:03d}] [{item['align']}] indent={item['indent']} {text}"
            )
        return "\n".join(rendered)

    def _extract_segment_by_markers(self, template_text: str, start_marker: str, end_marker: str) -> str:
        text = str(template_text or "")
        start = str(start_marker or "").strip()
        end = str(end_marker or "").strip()
        if not text or not start:
            return ""
        lower_text = text.lower()
        start_idx = lower_text.find(start.lower())
        if start_idx == -1:
            return ""
        if end:
            end_idx = lower_text.find(end.lower(), start_idx + len(start))
            if end_idx > start_idx:
                return text[start_idx:end_idx].strip()
        return text[start_idx:].strip()

    def _line_number_for_marker(self, template_text: str, marker: str) -> int:
        marker_text = str(marker or "").strip().lower()
        if not marker_text:
            return 0
        for idx, line in enumerate(str(template_text or "").splitlines(), start=1):
            if marker_text in line.strip().lower():
                return idx
        return 0

    async def _identify_section_anchors(self, template_text: str) -> List[Dict[str, Any]]:
        prompt = f"""
You are doing PASS 1: Anchor Identification for a legal template.

Goal:
- Do NOT draft or summarize.
- Identify exact section boundaries using explicit markers from the source text.
- Return section anchors only.

Return strict JSON with this shape:
{{
  "sections": [
    {{
      "section_id": "2",
      "title": "BRIEF FACTS AND BACKGROUND",
      "start_marker": "2. BRIEF FACTS",
      "end_marker": "3. GROUNDS",
      "start_line": 42,
      "end_line": 79,
      "fields_found": ["petitioner_brief_description", "initial_event_date"]
    }}
  ]
}}

Rules:
- start_marker must be an exact phrase that exists in the source text.
- end_marker should be the next section's heading phrase when possible.
- If final section has no next heading, use empty string for end_marker.
- fields_found should list likely field keys inferred from that section context.
- start_line/end_line should be best-effort line numbers for the section bounds.
- Cover the ENTIRE template from first page to last page; do not skip middle sections.
- Include every major heading in sequence from top to bottom.
- Return ONLY valid JSON.

SOURCE TEMPLATE:
\"\"\"{template_text}\"\"\"
"""
        result = await self._call_gemini(prompt)
        sections = result.get("sections") if isinstance(result, dict) else []
        return sections if isinstance(sections, list) else []

    def _extract_deterministic_anchors(self, template_text: str) -> List[Dict[str, Any]]:
        anchors: List[Dict[str, Any]] = []
        seen = set()
        lines = str(template_text or "").splitlines()
        for idx, raw in enumerate(lines, start=1):
            line = self._clean_heading_text(raw)
            if not line:
                continue
            # Prefer numbered headings and all-caps legal headings for stable section boundaries.
            if not (
                re.match(r"^\s*(?:\d+(?:\.\d+){0,3}|[IVXLCM]+)[\.\)]?\s+[A-Z]", line)
                or bool(re.match(r"^[A-Z][A-Z0-9\s,&/\-\(\)]{3,}$", line))
            ):
                continue
            key = re.sub(r"[^a-z0-9]+", "_", line.lower()).strip("_")
            if not key or key in seen:
                continue
            seen.add(key)
            anchors.append(
                {
                    "section_id": f"det_{len(anchors) + 1:03d}",
                    "title": self._section_name_from_marker(line) or line,
                    "start_marker": line,
                    "start_line": idx,
                    "end_marker": "",
                    "end_line": 0,
                    "fields_found": [],
                }
            )
        return anchors

    def _merge_and_finalize_anchors(self, llm_anchors: List[Dict[str, Any]], template_text: str) -> List[Dict[str, Any]]:
        merged: List[Dict[str, Any]] = []
        by_marker = set()

        def _push(anchor: Dict[str, Any]) -> None:
            marker = self._clean_heading_text(anchor.get("start_marker", ""))
            if not marker:
                return
            key = marker.lower()
            if key in by_marker:
                return
            line = int(anchor.get("start_line") or 0)
            if line <= 0:
                line = self._line_number_for_marker(template_text, marker)
            merged.append(
                {
                    "section_id": anchor.get("section_id") or f"section_{len(merged) + 1:03d}",
                    "title": anchor.get("title") or self._section_name_from_marker(marker) or marker,
                    "start_marker": marker,
                    "start_line": line,
                    "end_marker": self._clean_heading_text(anchor.get("end_marker", "")),
                    "end_line": int(anchor.get("end_line") or 0),
                    "fields_found": anchor.get("fields_found") or [],
                }
            )
            by_marker.add(key)

        for anchor in llm_anchors or []:
            if isinstance(anchor, dict):
                _push(anchor)
        for anchor in self._extract_deterministic_anchors(template_text):
            _push(anchor)

        merged.sort(key=lambda item: item.get("start_line") or 10**9)
        for i, item in enumerate(merged):
            nxt = merged[i + 1] if i + 1 < len(merged) else None
            if nxt:
                item["end_marker"] = nxt.get("start_marker", "")
                item["end_line"] = int(nxt.get("start_line") or 0)
            else:
                item["end_marker"] = ""
                item["end_line"] = 0
        return merged

    async def contextualize_fields(self, template_text: str, fields: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        keys = []
        for f in fields or []:
            key = str((f or {}).get("key") or "").strip()
            if key:
                keys.append(key)
        keys = list(dict.fromkeys(keys))
        if not keys:
            return {}

        prompt = f"""
You are a legal field classifier for template drafting.

Given template text and field keys, assign contextual legal meaning.
Return strict JSON object:
{{
  "field_context": {{
    "field_key": {{
      "legal_type": "Date|PartyName|MonetaryAmount|Address|StatuteReference|CaseReference|Relief|Prayer|Ground|GeneralText|Identifier",
      "description": "what user should provide",
      "ui_hint": "date_picker|text_input|textarea|number_input|currency_input|multi_select",
      "validation_hint": "short rule"
    }}
  }}
}}

FIELD KEYS:
{json.dumps(keys, indent=2)}

TEMPLATE TEXT:
\"\"\"{template_text}\"\"\"
"""
        result = await self._call_gemini(prompt)
        payload = result.get("field_context") if isinstance(result, dict) else {}
        return payload if isinstance(payload, dict) else {}

    def _normalize_field(self, field: Any, section_id: str) -> Dict[str, Any]:
        # Gemini sometimes emits string items in fields/all_fields. Coerce them safely.
        if isinstance(field, dict):
            raw_key = field.get("key", "")
            field_type = field.get("type", "string")
            label = field.get("label")
            required = bool(field.get("required", False))
            default_value = field.get("default_value", "")
            validation_rules = field.get("validation_rules", "")
            description = field.get("description")
            source_section_id = field.get("section_id")
        else:
            raw_key = str(field or "")
            field_type = "string"
            label = None
            required = False
            default_value = ""
            validation_rules = ""
            description = None
            source_section_id = None

        key = re.sub(r"[^a-zA-Z0-9_]+", "_", str(raw_key).strip().lower()).strip("_") or "unnamed_field"
        return {
            "key": key,
            "type": field_type,
            "label": label or key.replace("_", " ").title(),
            "required": required,
            "default_value": default_value,
            "validation_rules": validation_rules,
            "description": description or f"Field for {key.replace('_', ' ')}",
            "section_id": source_section_id or section_id,
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
        text = re.sub(r"^\s*(?:\d+(?:\.\d+){0,3}|[IVXLCM]+)[\.\)]?\s*", "", text, flags=re.IGNORECASE).strip()
        return self._clean_heading_text(text)

    def _normalize_section_name(self, section_name: str, start_marker: str, index: int) -> str:
        name = self._clean_heading_text(section_name)
        marker_name = self._section_name_from_marker(start_marker)
        noisy = (
            not name
            or len(name) > 90
            or len(name.split()) > 10
            or "," in name
            or ";" in name
        )
        if marker_name and (noisy or name.lower().startswith("section ")):
            return marker_name
        return name or marker_name or f"Section {index + 1}"

    def _looks_like_heading(self, line: str) -> bool:
        text = self._clean_heading_text(line)
        if not text or len(text) < 4 or len(text) > 120:
            return False
        if "{{" in text or "}}" in text or "__" in text:
            return False
        if text.count(":") > 1:
            return False

        # Exclude lines that are clearly part of a header block and not a structural section
        upper_text = text.upper()
        exclude_phrases = [
            "IN THE HIGH COURT", "IN THE SUPREME COURT", "IN THE MATTER OF",
            "UNDER ARTICLE", "ORIGINAL JURISDICTION", "CIVIL JURISDICTION",
            "WRIT PETITION NO", "APPLICATION NO", "SUIT NO", "VERSUS", "BETWEEN",
            "AND IN THE MATTER", "PETITION UNDER", "AFFIDAVIT ON BEHALF", 
            "DATED THIS", "PRESENTED ON"
        ]
        if any(phrase in upper_text for phrase in exclude_phrases):
            return False

        numbered = re.match(r"^(?:\d+(?:\.\d+){0,3}|[IVXLCM]+)[\.\)]?\s+[A-Z]", text)
        uppercase = bool(re.match(r"^[A-Z][A-Z0-9\s,&/\-\(\)]{3,}$", text)) and not re.search(r"[a-z]", text)
        titled_legal = bool(
            re.match(
                r"^(agreement|parties|party details|definitions|interpretation|recitals|background|facts|grounds|prayer|consideration|term|termination|confidentiality|indemnity|governing law|jurisdiction|dispute resolution|notices|signature|execution|schedule|annexure|witness|property|payment|obligations|rights)\b",
                text,
                re.IGNORECASE,
            )
        )
        # Avoid broad title-case matching; it over-captures long clause sentences.
        return bool(numbered or uppercase or titled_legal)

    def _extract_heading_candidates(self, template_text: str, max_candidates: int = 18) -> List[str]:
        candidates: List[str] = []
        seen = set()
        for raw_line in str(template_text or "").splitlines():
            line = self._clean_heading_text(raw_line)
            if not self._looks_like_heading(line):
                continue
            normalized_key = re.sub(r"[^a-z0-9]+", "_", line.lower()).strip("_")
            if not normalized_key or normalized_key in seen:
                continue
            seen.add(normalized_key)
            candidates.append(line)
            if len(candidates) >= max_candidates:
                break
        return candidates

    def _infer_section_category(self, section_name: str) -> str:
        name = str(section_name or "").lower()
        if any(k in name for k in ("party", "parties", "vendor", "purchaser", "lessor", "lessee")):
            return "parties"
        if any(k in name for k in ("recital", "background", "whereas")):
            return "recitals"
        if any(k in name for k in ("fact", "synopsis", "brief facts")):
            return "facts"
        if any(k in name for k in ("ground", "basis")):
            return "grounds"
        if any(k in name for k in ("prayer", "relief")):
            return "prayer"
        if any(k in name for k in ("signature", "execution", "witness")):
            return "signatures"
        if any(k in name for k in ("term", "obligation", "consideration", "payment", "confidentiality", "indemnity", "liability")):
            return "terms"
        return "other"

    def _build_missing_sections_from_headings(self, sections: List[Dict[str, Any]], template_text: str) -> List[Dict[str, Any]]:
        heading_candidates = self._extract_heading_candidates(template_text)
        if not heading_candidates:
            return sections

        existing_names = {
            re.sub(r"[^a-z0-9]+", "_", str(section.get("section_name") or "").lower()).strip("_")
            for section in sections
        }
        next_order = len(sections)

        for heading in heading_candidates:
            normalized_name = re.sub(r"[^a-z0-9]+", "_", heading.lower()).strip("_")
            if not normalized_name or normalized_name in existing_names:
                continue
            existing_names.add(normalized_name)
            sections.append(
                {
                    "section_id": f"section_{next_order + 1:03d}",
                    "section_name": heading,
                    "section_purpose": f"Draft the {heading} section using the structure and placeholders visible in the source template.",
                    "section_category": self._infer_section_category(heading),
                    "order": next_order,
                    "page_break_before": False,
                    "estimated_words": 150,
                    "depends_on": [],
                    "drafting_prompt": f"Preserve the source heading '{heading}' and reproduce the corresponding clause block in the final draft with the same legal role and formatting intent.",
                    "format_blueprint": {"alignment": "LEFT", "notes": "Derived from source template heading detection."},
                    "is_subsection": False,
                    "parent_section_id": None,
                    "fields": [],
                }
            )
            next_order += 1

        sections.sort(key=lambda item: item.get("order", 0))
        return sections

    def _post_process_analysis(self, result: Dict[str, Any], metrics: Dict[str, int], template_text: str = "") -> Dict[str, Any]:
        sections = result.get("sections") or []
        normalized_sections: List[Dict[str, Any]] = []
        all_fields: List[Dict[str, Any]] = []
        seen_field_keys = set()

        for index, section in enumerate(sections):
            section_id = section.get("section_id") or f"section_{index + 1:03d}"
            raw_fields = section.get("fields") or []
            normalized_fields: List[Dict[str, Any]] = []
            for field in raw_fields:
                normalized = self._normalize_field(field, section_id)
                normalized_fields.append({k: v for k, v in normalized.items() if k != "section_id"})
                if normalized["key"] not in seen_field_keys:
                    seen_field_keys.add(normalized["key"])
                    all_fields.append(normalized)

            normalized_sections.append(
                {
                    "section_id": section_id,
                    "section_name": self._normalize_section_name(
                        section.get("section_name", ""),
                        section.get("start_marker", ""),
                        index,
                    ),
                    "section_purpose": section.get("section_purpose", ""),
                    "section_category": section.get("section_category", "other"),
                    "order": section.get("order", index),
                    "page_break_before": bool(section.get("page_break_before", False)),
                    "estimated_words": section.get("estimated_words", 150),
                    "source_clauses": section.get("source_clauses", ""),
                    "start_marker": section.get("start_marker", ""),
                    "end_marker": section.get("end_marker", ""),
                    "start_line": section.get("start_line", 0),
                    "end_line": section.get("end_line", 0),
                    "depends_on": section.get("depends_on") or [],
                    "drafting_prompt": section.get("drafting_prompt", ""),
                    "format_blueprint": section.get("format_blueprint") or {},
                    "template_logic": section.get("template_logic", ""),
                    "required_fields": section.get("required_fields") or [],
                    "ai_drafting_instruction": section.get("ai_drafting_instruction", ""),
                    "is_subsection": bool(section.get("is_subsection", False)),
                    "parent_section_id": section.get("parent_section_id"),
                    "fields": normalized_fields,
                }
            )

            if not normalized_sections[-1]["source_clauses"]:
                extracted = self._extract_segment_by_markers(
                    template_text,
                    normalized_sections[-1].get("start_marker", ""),
                    normalized_sections[-1].get("end_marker", ""),
                )
                if extracted:
                    normalized_sections[-1]["source_clauses"] = extracted
            if not normalized_sections[-1]["required_fields"]:
                normalized_sections[-1]["required_fields"] = [f.get("key") for f in normalized_sections[-1]["fields"] if isinstance(f, dict) and f.get("key")]

        if result.get("all_fields"):
            for field in result["all_fields"]:
                default_section_id = field.get("section_id", "") if isinstance(field, dict) else ""
                normalized = self._normalize_field(field, default_section_id)
                if normalized["key"] not in seen_field_keys:
                    seen_field_keys.add(normalized["key"])
                    all_fields.append(normalized)

        normalized_sections.sort(key=lambda item: item.get("order", 0))
        # Do not auto-append heuristic "missing sections" here; this can create
        # noisy subsection-like titles from long numbered clause lines.
        result["sections"] = normalized_sections
        result["all_fields"] = all_fields
        result["total_sections"] = len(normalized_sections)
        result["page_metrics"] = result.get("page_metrics") or metrics
        result["document_type"] = result.get("document_type") or "Template"
        result["template_name"] = result.get("template_name") or "Untitled Template"
        result["estimated_draft_length"] = result.get("estimated_draft_length") or "Unknown"
        return result

    async def analyze_template(self, template_text: str, template_file_signed_url: Optional[str] = None):
        char_count = len(template_text)
        word_count = len(template_text.split())
        metrics = self._compute_page_metrics(template_text)
        blueprint = self._extract_layout_blueprint(template_text, metrics)
        blueprint_display = self._blueprint_to_display(blueprint, max_lines=700)

        url_context = ""
        if template_file_signed_url:
            url_context = f"""
TEMPLATE DOCUMENT URL (Visual Reference):
{template_file_signed_url}
Use this URL to understand the visual layout, tables, and signature blocks that might be hard to parse from raw text.
"""

        anchor_sections = await self._identify_section_anchors(template_text)
        for sec in anchor_sections:
            if not isinstance(sec, dict):
                continue
            if not sec.get("start_line"):
                sec["start_line"] = self._line_number_for_marker(template_text, sec.get("start_marker", ""))
            if not sec.get("end_line") and sec.get("end_marker"):
                sec["end_line"] = self._line_number_for_marker(template_text, sec.get("end_marker", ""))
        anchor_sections = self._merge_and_finalize_anchors(anchor_sections, template_text)

        prompt = f"""
You are an Advanced Legal Document Engineer and Template Architect.
Your task is to perform PASS 2 analysis using PASS 1 anchor map.

DOCUMENT CONTEXT:
- Word Count: {word_count}
- Character Count: {char_count}
{url_context}

PAGE METRICS & LAYOUT:
{json.dumps(metrics, indent=2)}

LAYOUT BLUEPRINT (Line-by-line classification):
{blueprint_display}

RAW TEMPLATE CONTENT:
\"\"\"{template_text}\"\"\"

PASS 1 ANCHOR MAP (authoritative boundaries):
{json.dumps(anchor_sections, indent=2)}

=== CORE ANALYSIS REQUIREMENTS ===

1. STRUCTURAL SECTIONS (ANCHOR-DRIVEN):
   - Use PASS 1 start_marker/end_marker boundaries as primary section segmentation.
   - Do NOT invent arbitrary boundaries that conflict with markers.
   - For each section, return start_marker and end_marker, and extract source_clauses from that exact segment.
   - Assign clear section_category (header, parties, recitals, facts, grounds, prayer, terms, signatures, schedules, other).

2. INTELLIGENT FIELD EXTRACTION (ENTITY MAPPING):
   - Extract EVERY fillable field including:
     - Placeholder tags: _name_, __date__, {{name}}, [amount], etc.
     - Blanks: "I, _______", "Dated this ___ day of ___".
     - Implied fields: Even if there are no underscores, if a specific piece of data is required (e.g., the name of the Court in a Petition), mark it as a field.
   - Format fields PRECISELY:
     - 'key': snake_case_unique_identifier
     - 'label': Human-readable Title (e.g., "Monthly Rent Amount", "Petitioner Age")
     - 'type': string|date|number|currency|address|text_long|boolean
     - 'description': Clear instruction on what the user should provide.

3. DRAFTING BLUEPRINT (INSTRUCTION SYNTHESIS):
   - For every section, provide a 'drafting_prompt' that is EXTREMELY detailed and must include:
     - "Draft based on this structure: [Extracted Template Segment]"
     - A legal terminology constraint (e.g., use terms like "mala fide", "ultra vires" when relevant to section context)
   - It should also describe:
     - The legal tone and intent.
     - How the placeholders are integrated into the boilerplate.
     - Specific formatting rules (ALL CAPS, Centered, Numbered lists).
     - Any conditional logic found (e.g., "if Party B is a company, add GSTIN").

4. JSON OUTPUT CONTRACT:
{{
  "template_name": "Accurate, formal name of the template",
  "document_type": "The specific legal document type",
  "total_sections": 0,
  "estimated_draft_length": "e.g., 5-8 Pages",
  "all_fields": [
    {{
      "key": "field_key",
      "type": "string|date|number|currency|address|text_long|boolean",
      "label": "Proper Label",
      "required": true,
      "description": "Intelligent description of the field's purpose",
      "section_id": "section_001"
    }}
  ],
  "sections": [
    {{
      "section_id": "section_001",
      "section_name": "Formal Section Heading",
      "section_purpose": "Briefly explains the legal role of this section",
      "section_category": "header|parties|recitals|facts|grounds|prayer|terms|signatures|schedules|other",
      "order": 0,
      "start_marker": "2. BRIEF FACTS",
      "end_marker": "3. GROUNDS",
      "start_line": 42,
      "end_line": 79,
      "source_clauses": "THE ACTUAL CORE TEXT OR CLAUSES FROM THE TEMPLATE FOR THIS SECTION",
      "drafting_prompt": "Draft based on this structure: [Extracted Template Segment]. Ensure legal terminology like 'mala fide' or 'ultra vires' is used where relevant.",
      "template_logic": "One-line legal logic summary for this section",
      "required_fields": ["field_one", "field_two"],
      "ai_drafting_instruction": "A precise production-grade drafting instruction for this section",
      "format_blueprint": {{"alignment": "LEFT|CENTER|RIGHT", "is_bold": true, "has_border": false}},
      "fields": []
    }}
  ]
}}

STRICT RULES:
- Return ONLY valid JSON.
- Ensure every field is tied to its correct section.
- Be thorough. Do not skip any part of the template.
- Identify at least 5-15 sections for complex documents.
"""

        result = await self._call_gemini(prompt)
        result = self._post_process_analysis(result, metrics, template_text)
        print(f"DEBUG: Extracted {len(result.get('sections', []))} logical sections from {word_count} word document")
        return result

    async def generate_section_prompts(self, section_data: dict):
        # We now use the 'source_clauses' and 'drafting_prompt' from the analysis phase
        # to generate a PERECT, comprehensive prompt for the draft generator.
        
        section_name = section_data.get("section_name", "Untitled Section")
        source_text = section_data.get("source_clauses", "")
        base_prompt = section_data.get("drafting_prompt", "")
        fields = section_data.get("fields", [])
        start_marker = section_data.get("start_marker", "")
        end_marker = section_data.get("end_marker", "")
        
        prompt = f"""
You are creating a PERFECT DRAFTING INSTRUCTION for a legal document section: "{section_name}".

INPUT DATA:
- Source Template Clauses:
\"\"\"{source_text}\"\"\"

- Section Anchors:
  start_marker: "{start_marker}"
  end_marker: "{end_marker}"

- Intermediate Drafting Blueprint:
{base_prompt}

- Associated Fields:
{json.dumps(fields, indent=2)}

YOUR TASK:
Generate a comprehensive, expert-level master instruction that will guide an AI to draft this section PERFECTLY.
The instruction must ensure:
1. Legal precision: Maintain the exact legal tone and binding language found in the source clauses.
2. Perfect Placeholder Integration: Explain exactly how each field should be woven into the text.
3. Formatting Fidelity: Specify alignment, numbering, bolding, and spacing to match the template.
4. Completeness: Ensure no boilerplate or critical legal proviso is omitted.
5. Constraint Set: Include explicit drafting constraints and terminology guardrails.

Return strict JSON:
{{
    "section_intro": "A high-level conversational summary of how this section will be drafted professionally.",
    "drafting_complexity": "simple|moderate|complex",
    "estimated_output_words": 300,
    "constraint_set": [
        "Draft based on this structure: [Extracted Template Segment]",
        "Use legal terminology like mala fide or ultra vires where contextually relevant",
        "Do not add facts not inferable from the template segment"
    ],
    "field_prompts": [
        {{
            "field_id": "master_instruction",
            "prompt": "THE PERFECT MASTER PROMPT: A detailed, step-by-step drafting guide for the entire section, incorporating legal nuances and field placement."
        }}
    ],
    "dependencies": ["List any preceding sections whose context is needed"],
    "legal_references": ["Relevant Acts or standard legal practices identified in this section"]
}}
"""
        return await self._call_gemini(prompt)

    async def validate_input(self, field_info: dict, user_input: str):
        prompt = f"""
Act as Antigravity validation system.

FIELD RULES: {json.dumps(field_info)}
USER INPUT: "{user_input}"

OUTPUT:
{{"valid": true}}
OR
{{"valid": false, "error_prompt": "Explain the problem", "suggestion": "Optional guidance"}}
"""
        return await self._call_gemini(prompt)

    async def generate_section_content(self, section_data: dict, field_values: dict):
        # This function is used when drafting the actual document
        prompt = f"""
You are a Senior Legal Drafting Engine specialized in Indian court pleadings and legal templates.

Your role is NOT to generate new content.
Your role is to STRICTLY COMPILE a legal section from a template blueprint using provided values.

=====================================
SECTION METADATA
=====================================
{json.dumps({
  "section_name": section_data.get("section_name"),
  "section_category": section_data.get("section_category"),
  "format_blueprint": section_data.get("format_blueprint")
}, indent=2)}

=====================================
SOURCE TEMPLATE (AUTHORITATIVE)
=====================================
\"\"\"{section_data.get("source_clauses", "")}\"\"\"

=====================================
DRAFTING INSTRUCTIONS (STRICT)
=====================================
{section_data.get("drafting_prompt", "")}

=====================================
FIELDS (STRICT MAPPING REQUIRED)
=====================================
{json.dumps(section_data.get("fields", []), indent=2)}

=====================================
USER VALUES (FINAL DATA)
=====================================
{json.dumps(field_values, indent=2)}

=====================================
COMPILATION RULES (CRITICAL)
=====================================

1. ZERO HALLUCINATION:
   - Do NOT invent legal clauses.
   - Do NOT add new sentences unless required for grammar.
   - Stay максимально faithful to SOURCE TEMPLATE.

2. TEMPLATE COMPILATION MODE:
   - Treat SOURCE TEMPLATE as base code.
   - Replace placeholders using USER VALUES.
   - Preserve original legal language, tone, and structure.

3. PLACEHOLDER RESOLUTION:
   - Replace ALL placeholders like:
     - __field__
     - {{field}}
     - blanks
   - If value is missing:
     - KEEP placeholder AS-IS (do NOT guess)

4. FORMATTING STRICTNESS:
   - Maintain:
     - line breaks
     - indentation
     - numbering (1., 1.1, a), etc.)
     - ALL CAPS sections
   - Follow:
     {json.dumps(section_data.get("format_blueprint", {}), indent=2)}

5. LEGAL STYLE ENFORCEMENT:
   - Maintain court language like:
     - "MOST RESPECTFULLY SHOWETH"
     - "It is most respectfully prayed"
   - Do NOT simplify or paraphrase legal phrases

6. SECTION BOUNDARY:
   - Generate ONLY this section
   - Do NOT include next/previous sections

7. OUTPUT PURITY:
   - No explanations
   - No JSON inside content
   - No markdown

=====================================
FINAL OUTPUT FORMAT
=====================================

Return STRICT JSON ONLY:

{{
  "section_name": "{section_data.get("section_name")}",
  "content": "FULLY COMPILED LEGAL SECTION TEXT"
}}
"""
        response = await self._call_gemini(prompt)
        return response.get("content", "")


