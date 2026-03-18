"""
Post-processing helpers for generated legal draft HTML.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup


_DUPLICATE_WORD_RE = re.compile(r"\b(\w+)(\s+\1\b)+", re.IGNORECASE)


def clean_draft(text: str) -> str:
    cleaned = text or ""
    cleaned = _DUPLICATE_WORD_RE.sub(r"\1", cleaned)
    cleaned = re.sub(r"(floor|wing)\s+\1\b", r"\1", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*/\s*", ", ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _normalize_sentence(sentence: str) -> str:
    return re.sub(r"\s+", " ", sentence or "").strip(" .,:;").lower()


def prevent_duplication(text: str) -> str:
    if not text:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", text)
    seen = set()
    kept: List[str] = []
    for part in parts:
        normalized = _normalize_sentence(part)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        kept.append(part.strip())
    return " ".join(kept).strip()


def _node_text_signature(node) -> str:
    return _normalize_sentence(node.get_text(" ", strip=True))


def clean_section_html(html: str, final_address: Optional[str] = None) -> str:
    if not html:
        return ""

    # Parse the original HTML first. Running plain-text cleanup on the full HTML
    # string would corrupt markup such as closing tags (for example `</p>`).
    soup = BeautifulSoup(html, "html.parser")

    for text_node in list(soup.find_all(string=True)):
        parent_name = getattr(text_node.parent, "name", "")
        if parent_name in {"script", "style"}:
            continue
        updated = prevent_duplication(clean_draft(str(text_node)))
        text_node.replace_with(updated)

    seen_blocks = set()
    normalized_address = _normalize_sentence(final_address or "")
    address_seen = False

    for node in list(soup.find_all(["p", "li", "td", "div"])):
        text = node.get_text(" ", strip=True)
        signature = _node_text_signature(node)
        if not signature:
            continue
        if signature in seen_blocks:
            node.decompose()
            continue
        if normalized_address and normalized_address in signature:
            if address_seen:
                node.decompose()
                continue
            address_seen = True
        seen_blocks.add(signature)

    html_out = str(soup)
    html_out = re.sub(r">\s+<", "><", html_out)
    return html_out.strip()


def remove_cross_section_duplication(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen_paragraphs = set()
    result: List[Dict[str, Any]] = []

    for section in sections:
        content = section.get("content") or section.get("content_html") or ""
        soup = BeautifulSoup(content, "html.parser")
        for node in list(soup.find_all(["p", "li"])):
            signature = _node_text_signature(node)
            if signature and signature in seen_paragraphs:
                node.decompose()
                continue
            if signature:
                seen_paragraphs.add(signature)
        updated = dict(section)
        updated_content = str(soup).strip()
        if "content" in updated:
            updated["content"] = updated_content
        else:
            updated["content_html"] = updated_content
        result.append(updated)

    return result


def clean_assembled_html(html: str) -> str:
    if not html:
        return ""

    sections = [segment for segment in html.split("<!-- SECTION_BREAK -->") if segment.strip()]
    soup_sections = [BeautifulSoup(segment, "html.parser") for segment in sections]

    seen_headings = set()
    cleaned_sections: List[str] = []
    for soup in soup_sections:
        for heading in list(soup.find_all(re.compile(r"^h[1-6]$"))):
            signature = _node_text_signature(heading)
            if signature and signature in seen_headings:
                heading.decompose()
                continue
            if signature:
                seen_headings.add(signature)
        cleaned_sections.append(str(soup).strip())

    return "\n<!-- SECTION_BREAK -->\n".join(cleaned_sections).strip()
