"""
Extract formatting from template HTML: font-family, font-size, margin, padding, headings.
Used so the Drafter applies the exact same formatting when generating sections.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# CSS properties we care about for section formatting
FORMAT_PROPS = (
    "font-family", "font-size", "font-weight", "font-style",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "text-align", "text-indent", "line-height", "letter-spacing",
    "color", "background-color",
)


def _parse_style_string(style_str: str) -> Dict[str, str]:
    """Parse a style attribute value into { property: value }."""
    out: Dict[str, str] = {}
    if not style_str or not isinstance(style_str, str):
        return out
    for part in style_str.split(";"):
        part = part.strip()
        if ":" not in part:
            continue
        k, _, v = part.partition(":")
        k = k.strip().lower()
        v = v.strip()
        if k in FORMAT_PROPS or k.replace("-", "_") in [p.replace("-", "_") for p in FORMAT_PROPS]:
            out[k] = v
    return out


def _extract_inline_styles(html: str) -> List[Dict[str, str]]:
    """Collect all inline style="..." from HTML."""
    styles: List[Dict[str, str]] = []
    for m in re.finditer(r'\sstyle\s*=\s*["\']([^"\']*)["\']', html, re.IGNORECASE):
        styles.append(_parse_style_string(m.group(1)))
    return styles


def _extract_tag_styles(html: str) -> List[tuple[str, Dict[str, str]]]:
    """Extract (tag_name, style_dict) for tags that have style= (e.g. h1, h2, p, body)."""
    result: List[tuple[str, Dict[str, str]]] = []
    # Match opening tag with style: <tagname ... style="..." ...>
    pattern = re.compile(
        r'<([a-z][a-z0-9]*)[^>]*\sstyle\s*=\s*["\']([^"\']*)["\'][^>]*>',
        re.IGNORECASE
    )
    for m in pattern.finditer(html):
        tag = m.group(1).lower()
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'body', 'div', 'span'):
            result.append((tag, _parse_style_string(m.group(2))))
    return result


def _extract_style_blocks(html: str) -> str:
    """Get concatenated content of <style>...</style> blocks."""
    parts: List[str] = []
    for m in re.finditer(r'<style[^>]*>([\s\S]*?)</style>', html, re.IGNORECASE):
        parts.append(m.group(1))
    return "\n".join(parts)


def _parse_css_rules(css: str) -> List[tuple[str, Dict[str, str]]]:
    """Parse CSS rules into (selector, { prop: value }). Simple parser for selector { ... }."""
    rules: List[tuple[str, Dict[str, str]]] = []
    # Remove comments
    css = re.sub(r'/\*[\s\S]*?\*/', '', css)
    # Match selector { declarations }
    pattern = re.compile(
        r'([^{]+)\{([^{}]*)\}',
        re.DOTALL
    )
    for m in pattern.finditer(css):
        selector = m.group(1).strip().strip(',').strip()
        decls = _parse_style_string(m.group(2))
        if decls:
            rules.append((selector, decls))
    return rules


def _merge_format(
    inline_styles: List[Dict[str, str]],
    tag_styles: List[tuple[str, Dict[str, str]]],
    css_rules: List[tuple[str, Dict[str, str]]],
) -> Dict[str, Any]:
    """Build a single format spec: body/default styles + heading styles (h1, h2, h3, etc.)."""
    default: Dict[str, str] = {}
    headings: Dict[str, Dict[str, str]] = {}

    # From generic inline styles: merge into default
    for d in inline_styles:
        for k, v in d.items():
            if v:
                default[k] = v

    # From tag-specific inline styles (e.g. <h2 style="...">, <p style="...">)
    for tag, decls in tag_styles:
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            for k, v in decls.items():
                if v:
                    headings.setdefault(tag, {})[k] = v
        else:
            for k, v in decls.items():
                if v:
                    default[k] = v

    # From CSS: body, p, * → default; h1-h6 → headings
    body_selectors = re.compile(r'^body$|^p$|^\*$|\.(?:body|content|paragraph)', re.IGNORECASE)
    for selector, decls in css_rules:
        sel_lower = selector.split(",")[0].strip().split(" ")[-1].strip().lower()
        if re.match(r'^h[1-6]$', sel_lower):
            for k, v in decls.items():
                if v:
                    headings.setdefault(sel_lower, {})[k] = v
        elif body_selectors.match(sel_lower) or sel_lower in ('div', 'span'):
            for k, v in decls.items():
                if v:
                    default[k] = v

    return {"default": default, "headings": headings}


def _format_spec_to_text(spec: Dict[str, Any]) -> str:
    """Turn merged format spec into a clear text block for the prompt."""
    lines: List[str] = []
    default = spec.get("default") or {}
    headings = spec.get("headings") or {}

    if default:
        lines.append("Default / body / paragraphs:")
        for k, v in sorted(default.items()):
            lines.append(f"  {k}: {v}")
        lines.append("")

    if headings:
        lines.append("Headings (use exactly for h1, h2, h3, etc.):")
        for sel, decls in sorted(headings.items()):
            line = "  " + sel + ": " + "; ".join(f"{k}: {v}" for k, v in sorted(decls.items()))
            lines.append(line)

    if not lines:
        return ""
    return "\n".join(lines).strip()


def fetch_template_html(template_url: Optional[str]) -> str:
    """
    Fetch raw HTML from template URL (http(s) or gs://).
    """
    if not template_url or not isinstance(template_url, str):
        return ""
    url = template_url.strip()
    if not url:
        return ""

    if url.startswith("http://") or url.startswith("https://"):
        try:
            import requests
            resp = requests.get(url, timeout=15)
            if resp.status_code == 200:
                return resp.text or ""
            return ""
        except Exception as e:
            logger.warning("fetch_template_html (http): %s", e)
            return ""

    if url.startswith("gs://"):
        try:
            rest = url[5:].strip()
            if "/" not in rest:
                return ""
            bucket_name, _, blob_path = rest.partition("/")
            if not bucket_name or not blob_path:
                return ""
            from google.cloud import storage
            if os.environ.get("GCS_KEY_BASE64"):
                import base64
                import json
                from google.oauth2 import service_account
                content = base64.b64decode(os.environ["GCS_KEY_BASE64"]).decode("utf-8")
                info = json.loads(content)
                creds = service_account.Credentials.from_service_account_info(info)
                client = storage.Client(credentials=creds, project=info.get("project_id"))
            else:
                client = storage.Client()
            bucket = client.bucket(bucket_name)
            blob = bucket.blob(blob_path)
            return blob.download_as_text() or ""
        except Exception as e:
            logger.warning("fetch_template_html (gs): %s", e)
            return ""

    return ""


def _section_key_variants(section_key: str) -> List[str]:
    """Return variants of section_key for matching in template (id, data-section, class)."""
    if not section_key:
        return []
    s = section_key.strip().lower()
    # statement_of_facts, statement-of-facts, statementoffacts
    variants = [s, s.replace("_", "-"), s.replace("-", "_"), s.replace("_", "").replace("-", "")]
    return list(dict.fromkeys(variants))  # unique, order preserved


def _find_section_start(html: str, section_key: str) -> Optional[tuple[int, str]]:
    """
    Find the start index and tag name of the element that represents this section.
    Looks for id="section_key", data-section="section_key", or class containing section_key.
    Returns (start_index, tag_name) or None.
    """
    variants = _section_key_variants(section_key)
    # Match: <tag ... id="statement_of_facts" ...> or data-section="..." or class="... statement_of_facts ..."
    for v in variants:
        # id="v" or id='v'
        m = re.search(r'<([a-z][a-z0-9]*)[^>]*\sid\s*=\s*["\']' + re.escape(v) + r'["\']', html, re.IGNORECASE)
        if m:
            return (m.start(), m.group(1).lower())
        m = re.search(r'<([a-z][a-z0-9]*)[^>]*\sdata-section\s*=\s*["\']' + re.escape(v) + r'["\']', html, re.IGNORECASE)
        if m:
            return (m.start(), m.group(1).lower())
        # class containing section key (e.g. "section statement_of_facts" or "statement-of-facts")
        m = re.search(r'<([a-z][a-z0-9]*)[^>]*\sclass\s*=\s*["\'][^"\']*' + re.escape(v) + r'[^"\']*["\']', html, re.IGNORECASE)
        if m:
            return (m.start(), m.group(1).lower())
    return None


def _find_matching_end(html: str, start: int, tag: str) -> Optional[int]:
    """From start (opening tag start), find the matching closing tag by counting nesting. Returns end index (past </tag>)."""
    # Start after the opening tag's '>'
    open_full = re.compile(r'<' + re.escape(tag) + r'\b[^>]*>', re.IGNORECASE)
    m = open_full.search(html[start:])
    if not m:
        return None
    i = start + m.end()
    depth = 1
    open_pat = re.compile(r'<' + re.escape(tag) + r'\b', re.IGNORECASE)
    close_pat = re.compile(r'</' + re.escape(tag) + r'\s*>', re.IGNORECASE)
    while i < len(html):
        next_open = open_pat.search(html, i)
        next_close = close_pat.search(html, i)
        if next_close and (not next_open or next_close.start() < next_open.start()):
            depth -= 1
            if depth == 0:
                return next_close.end()
            i = next_close.end()
        elif next_open:
            depth += 1
            i = next_open.end()
        else:
            break
    return None


def extract_section_fragment(html: str, section_key: str) -> str:
    """
    Extract the HTML fragment that corresponds to the given section.
    Looks for element with id, data-section, or class matching section_key; returns its full subtree.
    If no section-specific block is found, returns the full html (fallback to document-level format).
    """
    if not html or not section_key:
        return html or ""
    found = _find_section_start(html, section_key)
    if not found:
        return html
    start_idx, tag = found
    end_idx = _find_matching_end(html, start_idx, tag)
    if end_idx is None:
        return html
    return html[start_idx:end_idx]


def extract_format_from_html(html: str, section_label: Optional[str] = None) -> str:
    """
    Extract font-family, font-size, margin, padding, heading styles from (section) HTML.
    If section_label is set, prefix the format spec with "For section: ...".
    """
    if not html or not html.strip():
        return ""
    try:
        inline_styles = _extract_inline_styles(html)
        tag_styles = _extract_tag_styles(html)
        style_content = _extract_style_blocks(html)
        css_rules = _parse_css_rules(style_content)
        merged = _merge_format(inline_styles, tag_styles, css_rules)
        text = _format_spec_to_text(merged)
        if section_label and text:
            return f"For section: {section_label}\n" + text
        return text
    except Exception as e:
        logger.warning("extract_format_from_html failed: %s", e)
        return ""


def get_template_format_for_section(
    template_url: Optional[str],
    section_key: Optional[str] = None,
    html: Optional[str] = None,
) -> str:
    """
    Extract format for the given section only (section-wise format).
    If section_key is provided, finds the template fragment for that section (id, data-section, or class)
    and extracts font/size/margin/padding/headings from that fragment. If no section block is found,
    falls back to full-document format.
    If html is provided, use it; otherwise fetch from template_url.
    """
    if html is None and template_url:
        html = fetch_template_html(template_url)
    if not html:
        return ""
    if section_key:
        fragment = extract_section_fragment(html, section_key)
        return extract_format_from_html(fragment, section_label=section_key)
    return extract_format_from_html(html)
