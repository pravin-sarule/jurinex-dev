"""Best-effort Postgres persistence for chronology trees. Missing table never breaks upload."""
from __future__ import annotations

import json
import logging

from app.schemas.chronology import ChronologyTree
from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.chronology.persist")

_SAVE_SQL = """
INSERT INTO case_chronology (case_key, folder_name, tree, source_documents, updated_at)
VALUES (%s, %s, %s::jsonb, %s, NOW())
ON CONFLICT (case_key) DO UPDATE SET
    folder_name = EXCLUDED.folder_name,
    tree = EXCLUDED.tree,
    source_documents = EXCLUDED.source_documents,
    updated_at = NOW()
"""

_LOAD_SQL = """
SELECT tree, folder_name, source_documents
FROM case_chronology
WHERE case_key = %s
   OR folder_name = %s
ORDER BY updated_at DESC
LIMIT 1
"""

_REBIND_SQL = """
UPDATE case_chronology
SET case_key = %s, folder_name = COALESCE(%s, folder_name), updated_at = NOW()
WHERE case_key = %s
"""

_DELETE_SQL = "DELETE FROM case_chronology WHERE case_key = %s OR folder_name = %s"


def save(case_key: str, tree: ChronologyTree, folder_name: str | None = None) -> None:
    if not case_key or not is_db_available():
        return
    try:
        payload = json.dumps(tree.as_dict())
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                _SAVE_SQL,
                [case_key, folder_name or case_key, payload, tree.sourceDocuments],
            )
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Chronology] persist skipped case_key=%s error=%s", case_key, exc)


def load(case_key: str, folder_name: str | None = None) -> ChronologyTree | None:
    if not case_key or not is_db_available():
        return None
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(_LOAD_SQL, [case_key, folder_name or case_key])
            row = cur.fetchone()
        if not row:
            return None
        raw = row.get("tree") if isinstance(row, dict) else None
        if isinstance(raw, str):
            raw = json.loads(raw)
        if not isinstance(raw, dict):
            return None
        return ChronologyTree.model_validate(raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Chronology] load skipped case_key=%s error=%s", case_key, exc)
        return None


def rebind(old_key: str, new_key: str, folder_name: str | None = None) -> None:
    if not old_key or not new_key or old_key == new_key or not is_db_available():
        return
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(_REBIND_SQL, [new_key, folder_name, old_key])
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Chronology] rebind skipped %s -> %s error=%s", old_key, new_key, exc)


def delete(case_key: str, folder_name: str | None = None) -> None:
    if not case_key or not is_db_available():
        return
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(_DELETE_SQL, [case_key, folder_name or case_key])
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Chronology] delete skipped case_key=%s error=%s", case_key, exc)
