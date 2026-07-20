import logging
import re

from core.config import settings

logger = logging.getLogger(__name__)

# Max characters of case context kept for the pipeline ("Context chars" in the Pipeline
# Data Flow) comes from settings.max_context_chars (CITATION_V2_MAX_CONTEXT_CHARS in
# .env). It is read at call time below — reading it as a module-level os.environ
# constant here silently fell back to 60000 when this module imported before core.config
# had run load_dotenv().

# indiankanoon.org/doc/12345/ or /docfragment/12345/ — used to harvest IK ids that the
# uploaded source document refers to, so they are never returned as citations (FAILURE 2).
_IK_DOC_ID_RX = re.compile(r"indiankanoon\.org/doc(?:fragment)?/(\d+)", re.IGNORECASE)
_ID_KEYS = ("doc_id", "docId", "tid", "canonical_id", "canonicalId", "ik_doc_id", "ikDocId")
_TITLE_KEYS = ("title", "case_name", "caseName", "name", "filename", "file_name")


def extract_source_identifiers(
    case_file_context: list[dict] | None, case_context_text: str = "",
) -> tuple[set[str], list[str]]:
    """Collect IK doc_ids and titles of the user's source documents for exclusion.

    Returns (excluded_doc_ids, excluded_titles). doc_ids are bare numeric IK tids
    (an ``ik:12345`` / ``ik-12345`` canonical id is reduced to ``12345``).
    """
    ids: set[str] = set()
    titles: list[str] = []
    for row in (case_file_context or []):
        if not isinstance(row, dict):
            continue
        for key in _ID_KEYS:
            raw = str(row.get(key) or "").strip()
            if raw:
                m = re.search(r"(\d{3,})", raw)
                if m:
                    ids.add(m.group(1))
        for key in _TITLE_KEYS:
            t = str(row.get(key) or "").strip()
            if t and t.lower() not in ("manual case facts",):
                titles.append(t)
    for m in _IK_DOC_ID_RX.finditer(case_context_text or ""):
        ids.add(m.group(1))
    # De-dupe titles, preserve order.
    titles = list(dict.fromkeys(titles))
    if ids or titles:
        logger.info("[CONTEXT_LOADER] Registered %d source doc_id(s) and %d source title(s) "
                    "for exclusion", len(ids), len(titles))
    return ids, titles


def from_case_file_context(case_file_context: list[dict] | None) -> str:
    items = list(case_file_context or [])

    # Diagnostic: show how much text each supplied item actually carries. A list of
    # ~500-char items means the document was handed to citation as a snippet/preview
    # (truncated upstream by the frontend or the document service), NOT fully extracted.
    per_item = []
    for row in items[:8]:
        content_len = len(str(row.get("content") or "").strip())
        snippet_len = len(str(row.get("snippet") or "").strip())
        per_item.append({
            "name": row.get("name") or row.get("filename") or "?",
            "content_chars": content_len,
            "snippet_chars": snippet_len,
            "used": "content" if content_len else ("snippet" if snippet_len else "empty"),
        })
    logger.info("[CONTEXT_LOADER] %d case-file item(s); per-item: %s", len(items), per_item)

    combined = "\n\n".join(
        str(row.get("content") or row.get("snippet") or "").strip()
        for row in items[:8]
        if str(row.get("content") or row.get("snippet") or "").strip()
    )[:settings.max_context_chars]

    if len(combined) < 800:
        logger.warning(
            "[CONTEXT_LOADER] Combined case context is only %d chars — the document was supplied "
            "as a snippet/cover page, not full text. Citations will be poor until full document text "
            "is provided (fix in the document service extraction or send full 'content' from the frontend).",
            len(combined),
        )
    return combined
