"""
Secret prompts API: list and fetch values from `secret_manager` + GCP Secret Manager.
Same behavior as document-service secretManagerController (no Node dependency).
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi.encoders import jsonable_encoder

from app.services.db import get_db_connection, is_db_available
from app.services.secret_prompt_display import _fetch_secret_value_from_gcp, _fetch_secret_value_from_gcp_rest

logger = logging.getLogger("agentic_document_service.secret_manager_api")


def _want_fetch(fetch: str | None) -> bool:
    return (fetch or "").strip().lower() in ("1", "true", "yes")


def list_secret_prompts(*, fetch: str | None, user_role_id: str | None = None) -> list[dict[str, Any]]:
    if not is_db_available():
        raise RuntimeError("Database is not configured (DATABASE_URL).")

    include_values = _want_fetch(fetch)

    if not user_role_id:
        return []

    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                s.*,
                l.name AS llm_name
            FROM secret_manager s
            LEFT JOIN llm_models l ON s.llm_id::text = l.id::text
            WHERE s.role_id::text = %s
            ORDER BY s.created_at DESC
            """,
            (user_role_id,),
        )
        rows = cur.fetchall()

    out: list[dict[str, Any]] = [jsonable_encoder(dict(r)) for r in rows]

    if not include_values:
        return out

    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _enrich_row(row: dict[str, Any]) -> dict[str, Any]:
        smid = row.get("secret_manager_id")
        ver = row.get("version")
        try:
            val = _fetch_secret_value_from_gcp_rest(str(smid or ""), ver)
            if val is None:
                val = _fetch_secret_value_from_gcp(str(smid or ""), ver)
            if val is None:
                return {**row, "value": "[ERROR: Cannot fetch]"}
            return {**row, "value": val}
        except Exception as exc:  # noqa: BLE001
            logger.warning("[secrets] enrich value failed id=%s: %s", row.get("id"), exc)
            return {**row, "value": "[ERROR: Cannot fetch]"}

    enriched: list[dict[str, Any]] = [None] * len(out)  # type: ignore[list-item]
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(out)))) as pool:
        futures = {pool.submit(_enrich_row, row): i for i, row in enumerate(out)}
        for fut in as_completed(futures):
            idx = futures[fut]
            enriched[idx] = fut.result()
    return enriched


def get_secret_prompt_detail(secret_id: str) -> dict[str, Any]:
    if not is_db_available():
        raise RuntimeError("Database is not configured (DATABASE_URL).")

    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                s.secret_manager_id,
                s.version,
                s.llm_id,
                l.name AS llm_name,
                cm.method_name AS chunking_method
            FROM secret_manager s
            LEFT JOIN chunking_methods cm ON s.chunking_method_id::text = cm.id::text
            LEFT JOIN llm_models l ON s.llm_id::text = l.id::text
            WHERE s.id::text = %s::text
            LIMIT 1
            """,
            (str(secret_id),),
        )
        row = cur.fetchone()

    if not row:
        return None

    d = dict(row)
    secret_manager_id = d.get("secret_manager_id")
    version = d.get("version")
    llm_id = d.get("llm_id")
    llm_name = d.get("llm_name")
    chunking_method = d.get("chunking_method")

    val = _fetch_secret_value_from_gcp_rest(str(secret_manager_id or ""), version)
    if val is None:
        val = _fetch_secret_value_from_gcp(str(secret_manager_id or ""), version)
    if val is None:
        raise RuntimeError(
            "GCP Secret Manager: could not read secret value. "
            "Check GCLOUD_PROJECT_ID, GCS_KEY_BASE64 / credentials, and IAM access."
        )

    return {
        "secretManagerId": secret_manager_id,
        "version": version,
        "llm_id": llm_id,
        "llm_name": llm_name,
        "chunking_method": chunking_method,
        "value": val,
    }
