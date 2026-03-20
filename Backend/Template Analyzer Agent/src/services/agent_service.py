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
        self.model_name = "gemini-2.0-flash"

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

    def _normalize_field(self, field: Dict[str, Any], section_id: str) -> Dict[str, Any]:
        key = re.sub(r"[^a-zA-Z0-9_]+", "_", str(field.get("key", "")).strip().lower()).strip("_") or "unnamed_field"
        return {
            "key": key,
            "type": field.get("type", "string"),
            "label": field.get("label") or key.replace("_", " ").title(),
            "required": bool(field.get("required", False)),
            "default_value": field.get("default_value", ""),
            "validation_rules": field.get("validation_rules", ""),
            "description": field.get("description") or f"Field for {key.replace('_', ' ')}",
            "section_id": section_id,
        }

    def _post_process_analysis(self, result: Dict[str, Any], metrics: Dict[str, int]) -> Dict[str, Any]:
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
                    "section_name": section.get("section_name") or f"Section {index + 1}",
                    "section_purpose": section.get("section_purpose", ""),
                    "section_category": section.get("section_category", "other"),
                    "order": section.get("order", index),
                    "page_break_before": bool(section.get("page_break_before", False)),
                    "estimated_words": section.get("estimated_words", 150),
                    "depends_on": section.get("depends_on") or [],
                    "drafting_prompt": section.get("drafting_prompt", ""),
                    "format_blueprint": section.get("format_blueprint") or {},
                    "is_subsection": bool(section.get("is_subsection", False)),
                    "parent_section_id": section.get("parent_section_id"),
                    "fields": normalized_fields,
                }
            )

        if result.get("all_fields"):
            for field in result["all_fields"]:
                normalized = self._normalize_field(field, field.get("section_id", ""))
                if normalized["key"] not in seen_field_keys:
                    seen_field_keys.add(normalized["key"])
                    all_fields.append(normalized)

        normalized_sections.sort(key=lambda item: item.get("order", 0))
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
        blueprint_display = self._blueprint_to_display(blueprint, max_lines=500)

        url_context = ""
        if template_file_signed_url:
            url_context = f"""
TEMPLATE DOCUMENT URL (uploaded template for reference; use the extracted text below as the primary source):
{template_file_signed_url}
When extracting fields, consider that the template PDF may contain visual blanks, form fields, or empty lines. Capture every fillable spot as a field.
"""

        prompt = f"""
You are analyzing a legal document template for a template analyzer agent.

Your job is to identify the real structural sections of the template using BOTH:
1. the raw extracted text
2. the layout blueprint built from the template formatting

Document stats:
- words: {word_count}
- characters: {char_count}

{url_context}

PAGE METRICS:
{json.dumps(metrics, indent=2)}

LAYOUT BLUEPRINT:
{blueprint_display}

RAW TEMPLATE TEXT:
\"\"\"{template_text}\"\"\"

RULES:
1. A section means one major structural block with a genuine heading or well-defined role, such as Case Title, Index, Synopsis, Facts, Grounds, Prayer, Affidavit, Parties, Recitals, Terms, Signatures.
2. Do not create sections for isolated boilerplate sentences, fill-in fragments, or micro-blocks.
3. Usually produce 5 to 12 sections unless the source document clearly requires fewer.
4. Every {{field_name}} placeholder is a field and its key must match the name inside braces.
5. Also treat blanks, names, dates, amounts, addresses, party names, numbered fill-ins, and signature lines as fields.
6. Every section must include a drafting_prompt explaining heading, layout, boilerplate, where fields go, and alignment/formatting expectations.
7. Return strict JSON only.

JSON CONTRACT:
{{
  "template_name": "Inferred template name",
  "document_type": "writ_petition|rent_deed|agreement|notice|petition|other",
  "total_sections": 0,
  "estimated_draft_length": "Short estimate",
  "page_metrics": {{"page_width": 0, "std_indent": 0, "deep_indent": 0, "right_zone_start": 0}},
  "all_fields": [
    {{
      "key": "field_key",
      "type": "string|date|number|currency|address|text_long|boolean",
      "label": "Human label",
      "required": true,
      "default_value": "",
      "validation_rules": "",
      "description": "",
      "section_id": "section_001"
    }}
  ],
  "sections": [
    {{
      "section_id": "section_001",
      "section_name": "Section name",
      "section_purpose": "Purpose",
      "section_category": "header|index|facts|grounds|prayer|affidavit|parties|recitals|terms|signatures|other",
      "order": 0,
      "page_break_before": false,
      "estimated_words": 150,
      "depends_on": [],
      "drafting_prompt": "How to draft the section, with layout and field placement guidance",
      "format_blueprint": {{"alignment": "LEFT|CENTER|RIGHT", "notes": ""}},
      "fields": [
        {{
          "key": "field_key",
          "type": "string|date|number|currency|address|text_long|boolean",
          "label": "Human label",
          "required": true,
          "default_value": "",
          "validation_rules": "",
          "description": ""
        }}
      ]
    }}
  ]
}}
"""

        result = await self._call_gemini(prompt)
        result = self._post_process_analysis(result, metrics)
        print(f"DEBUG: Extracted {len(result.get('sections', []))} logical sections from {word_count} word document")
        return result

    async def generate_section_prompts(self, section_data: dict):
        prompt = f"""
Analyze this section of a legal document and generate a single comprehensive set of drafting instructions.

SECTION DATA:
{json.dumps(section_data, indent=2)}

Return strict JSON:
{{
    "section_intro": "Conversational intro explaining what this section is for",
    "drafting_complexity": "simple|moderate|complex",
    "estimated_output_words": 250,
    "field_prompts": [
        {{
            "field_id": "master_instruction",
            "prompt": "Master drafting instruction for the full section"
        }}
    ],
    "dependencies": ["List any sections this should reference or depend on"],
    "legal_references": ["Any relevant laws, regulations, or standard practices to cite"]
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
        prompt = f"""
You are a legal document drafting AI. Generate professional, detailed content for this section.

SECTION INFORMATION:
{json.dumps(section_data, indent=2)}

USER PROVIDED VALUES:
{json.dumps(field_values, indent=2)}

OUTPUT FORMAT:
{{"content": "Drafted section text"}}
"""
        response = await self._call_gemini(prompt)
        return response.get("content", "")
