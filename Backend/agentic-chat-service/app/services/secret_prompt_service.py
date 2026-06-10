from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import jwt

from app.core.config import get_settings
from app.services.db import doc_conn
from app.services.chat_helpers import is_valid_uuid

logger = logging.getLogger(__name__)
SECRET_CACHE: dict[str, tuple[str, float]] = {}
CACHE_TTL = 300.0


async def fetch_secret_value(gcp_secret_name: str) -> str:
    import time

    now = time.time()
    hit = SECRET_CACHE.get(gcp_secret_name)
    if hit and hit[1] > now:
        return hit[0]

    from google.cloud import secretmanager
    from app.services.gcs_service import get_service_account_credentials

    project = get_settings().gcloud_project_id
    name = gcp_secret_name
    if not name.startswith("projects/"):
        name = f"projects/{project}/secrets/{gcp_secret_name}/versions/latest"
    creds = get_service_account_credentials()
    client = (
        secretmanager.SecretManagerServiceClient(credentials=creds)
        if creds
        else secretmanager.SecretManagerServiceClient()
    )
    resp = client.access_secret_version(request={"name": name})
    value = resp.payload.data.decode("utf-8")
    SECRET_CACHE[gcp_secret_name] = (value, now + CACHE_TTL)
    return value


def fetch_secret_manager_row(secret_id: str) -> dict[str, Any] | None:
    if not is_valid_uuid(secret_id):
        return None
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.name, s.secret_manager_id, s.version, s.llm_id,
                       s.input_template_id, s.output_template_id, l.name AS llm_name
                FROM secret_manager s
                LEFT JOIN llm_models l ON s.llm_id = l.id
                WHERE s.id = %s::uuid
                  AND (s.deleted_at IS NULL OR s.deleted_at > NOW())
                """,
                (secret_id,),
            )
            row = cur.fetchone()
    return dict(row) if row else None


async def resolve_secret_prompt(secret_id: str, additional_input: str = "") -> dict[str, Any]:
    row = fetch_secret_manager_row(secret_id)
    if not row:
        raise ValueError(f"Secret not found: {secret_id}")
    project = get_settings().gcloud_project_id
    version = row.get("version") or "latest"
    sm_id = row.get("secret_manager_id")
    secret_name = f"projects/{project}/secrets/{sm_id}/versions/{version}"
    body = await fetch_secret_value(secret_name)
    if additional_input:
        body = f"{body}\n\n{additional_input}"
    return {
        "prompt_text": body,
        "name": row.get("name"),
        "llm_name": row.get("llm_name"),
        "secret_id": str(row.get("id")),
    }


async def list_secret_prompts(user_id: str, authorization: str | None, fetch_values: bool = False) -> list[Any]:
    role_id = None
    plan_id = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            decoded = jwt.decode(token, options={"verify_signature": False})
            role_id = decoded.get("role_id")
        except Exception:
            pass

    try:
        uid = int(user_id)
        from app.services.llm_config_service import get_llm_config

        cfg = get_llm_config(user_id)
        plan_id = cfg.get("_plan_id")
    except Exception:
        uid = None

    if plan_id is None or not role_id:
        return []

    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.*, l.name AS llm_name
                FROM secret_manager s
                LEFT JOIN llm_models l ON s.llm_id::text = l.id::text
                WHERE s.plan_id IS NOT NULL AND s.plan_id = %s
                  AND (s.role_id IS NULL OR s.role_id::text = %s)
                ORDER BY s.created_at DESC
                """,
                (plan_id, str(role_id)),
            )
            rows = [dict(r) for r in cur.fetchall()]

    if not fetch_values:
        return rows

    project = get_settings().gcloud_project_id
    out = []
    for row in rows:
        try:
            name = f"projects/{project}/secrets/{row['secret_manager_id']}/versions/{row.get('version') or 'latest'}"
            value = await fetch_secret_value(name)
            out.append({**row, "value": value})
        except Exception:
            out.append({**row, "value": "[ERROR: Cannot fetch]"})
    return out


async def get_secret_prompt_by_id(secret_id: str) -> dict[str, Any]:
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.secret_manager_id, s.version, s.llm_id, l.name AS llm_name,
                       cm.method_name AS chunking_method
                FROM secret_manager s
                LEFT JOIN chunking_methods cm ON s.chunking_method_id::text = cm.id::text
                LEFT JOIN llm_models l ON s.llm_id::text = l.id::text
                WHERE s.id::text = %s
                """,
                (str(secret_id),),
            )
            row = cur.fetchone()
    if not row:
        raise ValueError("Secret config not found")
    row = dict(row)
    project = get_settings().gcloud_project_id
    secret_name = f"projects/{project}/secrets/{row['secret_manager_id']}/versions/{row.get('version') or 'latest'}"
    value = await fetch_secret_value(secret_name)
    return {
        "secretManagerId": row["secret_manager_id"],
        "version": row.get("version"),
        "llm_id": row.get("llm_id"),
        "llm_name": row.get("llm_name"),
        "chunking_method": row.get("chunking_method"),
        "value": value,
    }
