import logging
import os

logger = logging.getLogger(__name__)

# Max characters of case context kept for the pipeline. Edit via .env. This is the
# "Context chars" number shown in the Pipeline Data Flow.
_MAX_CONTEXT_CHARS = int(os.environ.get("CITATION_V2_MAX_CONTEXT_CHARS", "60000"))


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
    )[:_MAX_CONTEXT_CHARS]

    if len(combined) < 800:
        logger.warning(
            "[CONTEXT_LOADER] Combined case context is only %d chars — the document was supplied "
            "as a snippet/cover page, not full text. Citations will be poor until full document text "
            "is provided (fix in the document service extraction or send full 'content' from the frontend).",
            len(combined),
        )
    return combined
