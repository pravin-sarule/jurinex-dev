"""
Librarian agent tools (in agents folder).

When the orchestrator asks the Librarian for research or to fetch relevant chunks,
the Librarian uses fetch_relevant_chunks to search the vector store and return chunks.
Tools execute predefined logic; they do not generate content.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from services.db import find_nearest_chunks
from services.embedding_service import generate_embeddings

logger = logging.getLogger(__name__)


def fetch_relevant_chunks(
    query: str,
    user_id: int,
    file_ids: Optional[List[str]] = None,
    top_k: int = 10,
) -> Dict[str, Any]:
    """
    Fetch the most relevant document chunks from the vector database for a given query.
    User-specific: only chunks from this user's documents. Use JWT-decoded user id.

    Args:
        query: User question or evidence request. Used to embed and search for similar chunks.
        user_id: Numeric user id from JWT. Only this user's document chunks are returned.
        file_ids: Optional list of file UUIDs to restrict the search to (must belong to user_id).
        top_k: Number of chunks to return (1–80). Default 80.

    Returns:
        On success: { status: 'success', chunks: [...], context: str, count: int }
        On failure: { status: 'error', error_message: str }
    """
    query = (query or "").strip()
    if not query:
        return {"status": "error", "error_message": "query is required and must be non-empty."}
    
    logger.info(f"[Librarian Tool] Called with query='{query[:100]}...', user_id={user_id}, file_ids={file_ids}, top_k={top_k}")
    
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return {"status": "error", "error_message": "user_id is required (numeric, from JWT) for user-specific retrieval."}

    top_k = max(1, min(int(top_k), 80))
    if isinstance(file_ids, str):
        file_ids = [f.strip() for f in file_ids.split(",") if f.strip()]

    # Explicit empty list: this draft has no case and no uploaded files → return no chunks
    if file_ids is not None and isinstance(file_ids, list) and len(file_ids) == 0:
        logger.warning(f"[Librarian Tool] file_ids=[] (draft-scoped, no files attached) → returning 0 chunks")
        return {
            "status": "success",
            "chunks": [],
            "context": "",
            "count": 0,
        }
    
    if file_ids:
        logger.info(f"[Librarian Tool] Searching in {len(file_ids)} files: {file_ids[:5] if len(file_ids) > 5 else file_ids}")

    try:
        embeddings = generate_embeddings([query])
        if not embeddings or not embeddings[0]:
            logger.warning("Librarian tool: no embedding for query")
            return {"status": "error", "error_message": "Could not embed query."}

        rows = find_nearest_chunks(
            embedding=embeddings[0],
            limit=top_k,
            file_ids=file_ids,
            user_id=uid,
        )
        
        logger.info(f"[Librarian Tool] find_nearest_chunks returned {len(rows)} rows")

        chunks: List[Dict[str, Any]] = []
        for r in rows:
            chunks.append({
                "chunk_id": r.get("chunk_id"),
                "content": r.get("content") or "",
                "file_id": r.get("file_id"),
                "page_start": r.get("page_start"),
                "page_end": r.get("page_end"),
                "heading": r.get("heading"),
                "similarity": float(r.get("similarity") or 0),
                "distance": float(r.get("distance") or 0),
            })

        context = "\n\n".join(c.get("content", "") for c in chunks if c.get("content"))
        
        unique_files = list(set(c.get("file_id") for c in chunks if c.get("file_id")))
        logger.info(f"[Librarian Tool] Fetched {len(chunks)} chunks from {len(unique_files)} files, context length: {len(context)} chars")
        
        return {
            "status": "success",
            "chunks": chunks,
            "context": context,
            "count": len(chunks),
        }
    except Exception as e:
        logger.exception("Librarian tool failed: %s", e)
        return {"status": "error", "error_message": str(e)}


# ── Template Fetching ─────────────────────────────────────────────────────────

from pydantic import BaseModel
import re as _re


class PlaceholderMeta(BaseModel):
    element_selector: str
    field_name: str
    expected_content_type: str  # "text" | "html" | "image" | "table" | "chart"


class TemplateData(BaseModel):
    raw_html: str
    template_url: str
    layout_type: str          # "single-column"|"two-column"|"grid"|"report"|"card-based"
    sections: List[Dict[str, Any]]      # detected section containers
    placeholders: List[PlaceholderMeta]
    css_classes: List[str]
    color_tokens: Dict[str, Any]        # {"--primary": "#1a1a2e", ...}
    fonts: List[str]                    # Google Font / @import URLs


def _detect_layout(soup: Any) -> str:
    """Heuristic layout detection from BeautifulSoup tree."""
    body = soup.find("body")
    html_str = str(body or soup)

    # grid
    if _re.search(r'display\s*:\s*grid', html_str, _re.IGNORECASE):
        return "grid"
    # two-column: flex row or two-column class hints
    if _re.search(r'display\s*:\s*flex', html_str, _re.IGNORECASE):
        flex_containers = soup.find_all(style=_re.compile(r'display\s*:\s*flex', _re.IGNORECASE))
        for el in flex_containers:
            children = [c for c in el.children if hasattr(c, 'name') and c.name]
            if len(children) >= 2:
                return "two-column"
    if soup.find(class_=_re.compile(r'two.?col|sidebar|grid', _re.IGNORECASE)):
        return "two-column"
    # card-based
    if soup.find(class_=_re.compile(r'card|tile', _re.IGNORECASE)):
        return "card-based"
    # report: large table presence
    tables = soup.find_all("table")
    if len(tables) >= 2:
        return "report"
    return "single-column"


def _extract_sections(soup: Any) -> List[Dict[str, Any]]:
    """Find section containers by id, data-section, or semantic tags."""
    sections = []
    seen = set()

    # Elements with data-section or id that look like sections
    for el in soup.find_all(True):
        selector = None
        if el.get("data-section"):
            selector = f'[data-section="{el["data-section"]}"]'
        elif el.get("id"):
            selector = f'#{el["id"]}'
        elif el.name in ("section", "article", "header", "footer", "aside", "nav", "main"):
            selector = el.name

        if selector and selector not in seen:
            seen.add(selector)
            sections.append({
                "selector": selector,
                "tag": el.name,
                "id": el.get("id", ""),
                "classes": el.get("class", []),
            })

    return sections[:50]  # cap at 50 to keep payload reasonable


def _extract_placeholders(soup: Any) -> List[PlaceholderMeta]:
    """Collect draft-placeholder elements, data-field attrs, and {{mustache}} tokens."""
    placeholders: List[PlaceholderMeta] = []
    seen: set = set()

    def _add(selector: str, field_name: str, ctype: str):
        if selector not in seen:
            seen.add(selector)
            placeholders.append(PlaceholderMeta(
                element_selector=selector,
                field_name=field_name,
                expected_content_type=ctype,
            ))

    # class="draft-placeholder"
    for el in soup.find_all(class_="draft-placeholder"):
        sel = el.get("id") and f'#{el["id"]}' or ".draft-placeholder"
        _add(sel, el.get("data-field", sel.lstrip("#.")), "html")

    # data-field="..."
    for el in soup.find_all(attrs={"data-field": True}):
        field = el["data-field"]
        sel = f'[data-field="{field}"]'
        ctype = "image" if el.name == "img" else "table" if el.name == "table" else "text"
        _add(sel, field, ctype)

    # {{variable}} mustache tokens in text nodes
    mustache = _re.compile(r'\{\{(\w[\w\s]*?)\}\}')
    for text_node in soup.find_all(string=mustache):
        for match in mustache.finditer(str(text_node)):
            field = match.group(1).strip()
            _add(f"{{{{ {field} }}}}", field, "text")

    return placeholders


def _extract_css_classes(soup: Any) -> List[str]:
    classes: set = set()
    for el in soup.find_all(True):
        for cls in (el.get("class") or []):
            if cls:
                classes.add(cls)
    return sorted(classes)


def _extract_color_tokens(html: str) -> Dict[str, Any]:
    """Extract CSS custom properties from :root { ... } blocks."""
    tokens: Dict[str, str] = {}
    root_block = _re.search(r':root\s*\{([^}]+)\}', html, _re.IGNORECASE | _re.DOTALL)
    if root_block:
        for m in _re.finditer(r'(--[\w-]+)\s*:\s*([^;]+);', root_block.group(1)):
            tokens[m.group(1).strip()] = m.group(2).strip()
    return tokens


def _extract_fonts(html: str) -> List[str]:
    """Return all @import / <link> font URLs in <head>."""
    fonts: List[str] = []
    # @import url(...)
    for m in _re.finditer(r'@import\s+url\(["\']?([^"\')\s]+)["\']?\)', html, _re.IGNORECASE):
        url = m.group(1)
        if "font" in url.lower() or "googleapis" in url.lower():
            fonts.append(url)
    # <link href="..." rel="stylesheet"> containing fonts.googleapis
    for m in _re.finditer(r'<link[^>]+href=["\']([^"\']+)["\'][^>]*>', html, _re.IGNORECASE):
        url = m.group(1)
        if "fonts.googleapis" in url.lower() or "fonts.gstatic" in url.lower():
            fonts.append(url)
    return list(dict.fromkeys(fonts))  # deduplicate preserving order


def fetch_template(template_url: str) -> Optional[TemplateData]:
    """
    Fetch the HTML template from the given URL and parse its structure.

    Returns TemplateData with:
      - raw_html, template_url
      - layout_type: "single-column" | "two-column" | "grid" | "report" | "card-based"
      - sections: detected section containers
      - placeholders: draft-placeholder / data-field / {{mustache}} elements
      - css_classes: all classes used (preserve exactly in output)
      - color_tokens: CSS custom properties from :root
      - fonts: Google Fonts / @import URLs

    Returns None on failure.
    """
    if not template_url:
        return None

    try:
        import requests as _requests
        resp = _requests.get(template_url, timeout=20)
        if resp.status_code != 200:
            logger.warning("fetch_template: HTTP %s for %s", resp.status_code, template_url)
            return None
        raw_html = resp.text
    except Exception as e:
        logger.warning("fetch_template: request failed: %s", e)
        return None

    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(raw_html, "html.parser")
    except ImportError:
        logger.warning("fetch_template: beautifulsoup4 not installed; returning minimal TemplateData")
        return TemplateData(
            raw_html=raw_html,
            template_url=template_url,
            layout_type="single-column",
            sections=[],
            placeholders=[],
            css_classes=[],
            color_tokens={},
            fonts=_extract_fonts(raw_html),
        )

    layout_type = _detect_layout(soup)
    sections = _extract_sections(soup)
    placeholders = _extract_placeholders(soup)
    css_classes = _extract_css_classes(soup)
    color_tokens = _extract_color_tokens(raw_html)
    fonts = _extract_fonts(raw_html)

    return TemplateData(
        raw_html=raw_html,
        template_url=template_url,
        layout_type=layout_type,
        sections=sections,
        placeholders=placeholders,
        css_classes=css_classes,
        color_tokens=color_tokens,
        fonts=fonts,
    )
