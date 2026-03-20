import re
from typing import Any, Dict, List


BODY_SECTIONS_HINT = {
    "facts of the case": ("facts_of_the_case", "Facts of the Case"),
    "facts": ("facts", "Facts"),
    "questions of law": ("questions_of_law", "Questions of Law"),
    "grounds": ("grounds", "Grounds"),
    "prayer": ("prayer", "Prayer"),
    "relief sought": ("relief_sought", "Relief Sought"),
    "averments": ("averments", "Averments"),
    "declaration": ("declaration", "Declaration"),
    "verification": ("verification", "Verification"),
    "affidavit": ("affidavit", "Affidavit"),
    "recitals": ("recitals", "Recitals"),
    "terms and conditions": ("terms_and_conditions", "Terms and Conditions"),
}


class HybridFieldExtractor:
    def __init__(self) -> None:
        self._curly_pattern = re.compile(r"\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}")
        self._underscore_pattern = re.compile(r"([A-Z][A-Z\s]{2,})_{3,}([A-Z][A-Z\s]{2,})")
        self._dots_pattern = re.compile(r"\.{3,}\s*([A-Za-z][A-Za-z\s]+)")
        self._blank_pattern = re.compile(r"([A-Z][A-Za-z\s]+?)\s+_{3,}\s+([A-Z][A-Za-z\s]+)")
        self._date_label_pattern = re.compile(r"(FILED ON|DATED|DATE)\s*:?\s*$", re.IGNORECASE | re.MULTILINE)
        self._section_heading_pattern = re.compile(r"^(\d+)\.\s+([A-Za-z][A-Za-z\s]+)$", re.MULTILINE)

    def extract_from_text(self, template_text: str) -> Dict[str, Any]:
        pattern_fields = self._extract_fields_by_pattern(template_text)
        structural_fields = self._extract_fields_by_structure(template_text)
        merged = self._merge_field_lists([pattern_fields, structural_fields])
        enriched = self._validate_and_enrich(merged)
        return {
            "total_fields": len(enriched),
            "fields": enriched,
        }

    def _extract_fields_by_pattern(self, template_text: str) -> List[Dict[str, Any]]:
        fields: List[Dict[str, Any]] = []
        seen_keys = set()

        for match in self._curly_pattern.finditer(template_text):
            key = self._normalize_key(match.group(1))
            if key in seen_keys:
                continue
            seen_keys.add(key)
            fields.append(self._make_field(key, self._infer_type_from_key(key), self._humanize_label(key), ["curly_placeholder"], 0.98))

        for pattern in self._underscore_pattern.finditer(template_text):
            left = self._normalize_key(pattern.group(1))
            right = self._normalize_key(pattern.group(2))
            key = self._pick_best_key([left, right], fallback="unnamed_blank")
            if key in seen_keys:
                continue
            seen_keys.add(key)
            fields.append(self._make_field(key, self._infer_type_from_key(key), self._humanize_label(key), ["underscore_blank"], 0.78))

        for pattern in self._dots_pattern.finditer(template_text):
            key = self._normalize_key(pattern.group(1))
            if len(key) < 3 or key in seen_keys:
                continue
            seen_keys.add(key)
            fields.append(self._make_field(key, self._infer_type_from_key(key), self._humanize_label(key), ["dot_placeholder"], 0.72))

        for pattern in self._blank_pattern.finditer(template_text):
            key = self._pick_best_key(
                [self._normalize_key(pattern.group(1)), self._normalize_key(pattern.group(2))],
                fallback="blank_field",
            )
            if key in seen_keys:
                continue
            seen_keys.add(key)
            fields.append(self._make_field(key, self._infer_type_from_key(key), self._humanize_label(key), ["labeled_blank"], 0.82))

        if self._date_label_pattern.search(template_text) and "date" not in seen_keys:
            seen_keys.add("date")
            fields.append(self._make_field("date", "date", "Date", ["date_label"], 0.8))

        for _, heading in self._section_heading_pattern.findall(template_text):
            normalized = heading.strip().lower()
            if normalized not in BODY_SECTIONS_HINT:
                continue
            key, label = BODY_SECTIONS_HINT[normalized]
            if key in seen_keys:
                continue
            seen_keys.add(key)
            fields.append(self._make_field(key, "text_long", label, ["section_heading"], 0.76))

        return fields

    def _extract_fields_by_structure(self, template_text: str) -> List[Dict[str, Any]]:
        lowered = template_text.lower()
        fields: List[Dict[str, Any]] = []

        def add_field(key: str, field_type: str, label: str, method: str, confidence: float) -> None:
            fields.append(self._make_field(key, field_type, label, [method], confidence))

        if "writ petition" in lowered and "no." in lowered:
            add_field("petition_number", "string", "Petition Number", "structure_writ_petition", 0.84)
            add_field("petition_year", "number", "Petition Year", "structure_writ_petition", 0.84)

        if "petitioner" in lowered:
            add_field("petitioner_name", "string", "Petitioner Name", "structure_party_detection", 0.8)

        if "respondent" in lowered:
            add_field("respondent_names", "text_long", "Respondent Names", "structure_party_detection", 0.8)

        for phrase, (key, label) in BODY_SECTIONS_HINT.items():
            if phrase in lowered:
                add_field(key, "text_long", label, "structure_body_section", 0.75)

        if "filed by" in lowered:
            add_field("filed_by", "string", "Filed By", "structure_filing_metadata", 0.82)
        if "drawn by" in lowered or re.search(r"\bdrawn\b", lowered):
            add_field("drawn_by", "string", "Drawn By", "structure_filing_metadata", 0.76)
        if "filed on" in lowered:
            add_field("filing_date", "date", "Filing Date", "structure_filing_metadata", 0.83)

        return fields

    def _merge_field_lists(self, field_lists: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        merged: Dict[str, Dict[str, Any]] = {}

        for field_list in field_lists:
            for field in field_list:
                key = field["field_id"]
                if key not in merged:
                    merged[key] = field
                    continue

                existing = merged[key]
                methods = set(existing.get("extraction_methods", [])) | set(field.get("extraction_methods", []))
                existing["extraction_methods"] = sorted(methods)
                existing["confidence"] = round(min(0.99, max(existing.get("confidence", 0.0), field.get("confidence", 0.0)) + 0.03), 2)
                existing["required"] = existing.get("required", False) or field.get("required", False)
                if existing.get("type") == "string" and field.get("type") != "string":
                    existing["type"] = field["type"]
                if not existing.get("description") and field.get("description"):
                    existing["description"] = field["description"]

        return list(merged.values())

    def _validate_and_enrich(self, fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        enriched: List[Dict[str, Any]] = []
        for field in fields:
            item = dict(field)
            item["vector_db_keys"] = [item["field_id"], item["label"].lower().replace(" ", "_")]
            item["validation"] = self._build_validation(item["type"])
            item["fallback_strategy"] = "ask_user_then_infer_from_context"
            if item["type"] == "text_long":
                item["formatting"] = {"multiline": True, "preserve_paragraphs": True}
            enriched.append(item)
        return enriched

    def _build_validation(self, field_type: str) -> Dict[str, Any]:
        if field_type == "date":
            return {"format": "date", "accepted_inputs": ["DD/MM/YYYY", "YYYY-MM-DD", "Month DD, YYYY"]}
        if field_type in {"number", "currency"}:
            return {"numeric": True}
        if field_type == "address":
            return {"multiline": True}
        if field_type == "text_long":
            return {"min_length": 10}
        return {"type": field_type}

    def _make_field(
        self,
        key: str,
        field_type: str,
        label: str,
        extraction_methods: List[str],
        confidence: float,
    ) -> Dict[str, Any]:
        return {
            "field_id": key,
            "key": key,
            "type": field_type,
            "label": label,
            "required": False,
            "description": f"Extracted from template analysis for {label.lower()}",
            "confidence": confidence,
            "extraction_methods": extraction_methods,
        }

    def _normalize_key(self, raw_value: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", raw_value.strip().lower())
        cleaned = re.sub(r"_+", "_", cleaned).strip("_")
        return cleaned[:80] or "field"

    def _humanize_label(self, key: str) -> str:
        return key.replace("_", " ").strip().title()

    def _infer_type_from_key(self, key: str) -> str:
        if any(token in key for token in ("date", "filed_on", "filing_date")):
            return "date"
        if any(token in key for token in ("amount", "fee", "rent", "price", "cost")):
            return "currency"
        if any(token in key for token in ("number", "count", "year", "age")):
            return "number"
        if "address" in key:
            return "address"
        if any(token in key for token in ("grounds", "facts", "prayer", "recitals", "verification", "declaration")):
            return "text_long"
        return "string"

    def _pick_best_key(self, candidates: List[str], fallback: str) -> str:
        ranked = [candidate for candidate in candidates if candidate and candidate not in {"of", "the", "and"}]
        ranked.sort(key=len, reverse=True)
        return ranked[0] if ranked else fallback
