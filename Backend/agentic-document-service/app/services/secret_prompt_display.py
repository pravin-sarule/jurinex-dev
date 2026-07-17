"""
Resolve human-visible secret labels and effective query prompt body.

This service keeps the secret/preset prompt body server-side:
- DB/UI store only the secret name (question/prompt_label)
- full prompt body is loaded and expanded on the server for generation only
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Any

import httpx

from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("agentic_document_service.secret_prompt_display")


def _normalize_prompt_text(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _fetch_secret_row_local(secret_id: str) -> dict[str, Any] | None:
    if not is_db_available():
        return None
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  s.id::text AS id,
                  s.name,
                  s.secret_manager_id,
                  s.version,
                  s.input_template_id::text AS input_template_id,
                  s.output_template_id::text AS output_template_id
                FROM secret_manager s
                WHERE s.id::text = %s::text
                LIMIT 1
                """,
                (secret_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None
    except Exception as exc:
        logger.warning("[SecretLocal] secret row fetch failed id=%s: %s", secret_id, exc)
        return None


def _fetch_template_text_local(template_id: str | None) -> str | None:
    tid = (template_id or "").strip()
    if not tid or not is_db_available():
        return None
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            # Prefer template_files.extracted_text, fallback to input_templates.extracted_text.
            cur.execute(
                """
                SELECT extracted_text
                FROM template_files
                WHERE id::text = %s::text
                LIMIT 1
                """,
                (tid,),
            )
            row = cur.fetchone()
            if row and row.get("extracted_text"):
                return str(row.get("extracted_text")).strip()
    except Exception as exc:
        logger.debug("[SecretLocal] template_files lookup failed template_id=%s: %s", tid, exc)
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT extracted_text
                FROM input_templates
                WHERE id::text = %s::text
                LIMIT 1
                """,
                (tid,),
            )
            row = cur.fetchone()
            if row and row.get("extracted_text"):
                return str(row.get("extracted_text")).strip()
    except Exception as exc:
        logger.debug("[SecretLocal] input_templates lookup failed template_id=%s: %s", tid, exc)
    return None


def resolve_secret_prompt_llm_name(secret_id: str | None) -> str | None:
    """Return the model assigned to a selected secret prompt in the database."""
    sid = (secret_id or "").strip()
    if not sid or not is_db_available():
        return None
    try:
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT TRIM(l.name::text) AS llm_name
                FROM secret_manager s
                LEFT JOIN llm_models l ON s.llm_id::text = l.id::text
                WHERE s.id::text = %s::text
                LIMIT 1
                """,
                (sid,),
            )
            row = cur.fetchone()
            model_name = str((row or {}).get("llm_name") or "").strip()
            return model_name or None
    except Exception as exc:
        logger.warning("[SecretLocal] secret model lookup failed id=%s: %s", sid, exc)
        return None


def resolve_secret_display_label(
    secret_id: str,
    prompt_label: str | None,
    authorization: str | None,  # kept for compatibility
) -> str:
    """User-visible label: prompt_label from client, else local DB secret name."""
    _ = authorization
    if prompt_label and prompt_label.strip():
        return prompt_label.strip()
    row = _fetch_secret_row_local(secret_id)
    if row and row.get("name"):
        return str(row["name"]).strip()
    return "Analysis prompt"


def _fetch_secret_value_from_gcp(secret_manager_id: str, version: str | int | None) -> str | None:
    sid = (secret_manager_id or "").strip()
    if not sid:
        return None
    ver = str(version or "latest").strip() or "latest"
    project_id = None
    try:
        from app.core.config import get_settings

        project_id = (get_settings().google_cloud_project or "").strip() or None
    except Exception:
        project_id = None
    if not project_id:
        import os

        project_id = (
            os.getenv("GCLOUD_PROJECT_ID")
            or os.getenv("GOOGLE_CLOUD_PROJECT")
            or os.getenv("GCLOUD_PROJECT")
            or ""
        ).strip() or None
    if not project_id:
        logger.warning("[SecretLocal] Missing GCLOUD_PROJECT_ID in settings; cannot resolve secret value.")
        return None
    secret_name = f"projects/{project_id}/secrets/{sid}/versions/{ver}"
    try:
        # Import lazily to avoid grpc/cygrpc import crash at module import time on Python 3.14.
        from google.cloud import secretmanager  # type: ignore

        client = secretmanager.SecretManagerServiceClient()
        response = client.access_secret_version(name=secret_name)
        raw = response.payload.data.decode("utf-8")
        return raw.strip() if raw else None
    except Exception as exc:
        logger.warning("[SecretLocal] Secret Manager access failed name=%s error=%s", secret_name, exc)
        return None


def _fetch_secret_value_from_gcp_rest(secret_manager_id: str, version: str | int | None) -> str | None:
    sid = (secret_manager_id or "").strip()
    if not sid:
        return None
    ver = str(version or "latest").strip() or "latest"
    project_id = None
    try:
        from app.core.config import get_settings

        project_id = (get_settings().google_cloud_project or "").strip() or None
        key_b64 = (get_settings().gcs_key_base64 or "").strip()
    except Exception:
        key_b64 = ""
    if not project_id:
        project_id = (
            os.getenv("GCLOUD_PROJECT_ID")
            or os.getenv("GOOGLE_CLOUD_PROJECT")
            or os.getenv("GCLOUD_PROJECT")
            or ""
        ).strip() or None
    if not project_id:
        logger.warning("[SecretREST] Missing GCLOUD_PROJECT_ID/GOOGLE_CLOUD_PROJECT; cannot resolve secret id=%s", sid)
        return None
    if not key_b64:
        key_b64 = (os.getenv("GCS_KEY_BASE64") or "").strip()
    if not key_b64:
        logger.warning("[SecretREST] Missing GCS_KEY_BASE64; cannot resolve secret id=%s", sid)
        return None
    try:
        from google.auth.transport.requests import Request  # type: ignore
        from google.oauth2 import service_account  # type: ignore

        info = json.loads(base64.b64decode(key_b64).decode("utf-8"))
        creds = service_account.Credentials.from_service_account_info(
            info,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        creds.refresh(Request())
        token = getattr(creds, "token", None)
        if not token:
            return None
        name = f"projects/{project_id}/secrets/{sid}/versions/{ver}"
        url = f"https://secretmanager.googleapis.com/v1/{name}:access"
        with httpx.Client(timeout=30.0) as client:
            response = client.get(url, headers={"Authorization": f"Bearer {token}"})
            if response.status_code != 200:
                logger.warning(
                    "[SecretREST] access failed name=%s status=%s body=%s",
                    name,
                    response.status_code,
                    response.text[:300],
                )
                return None
            payload = response.json().get("payload", {})
            data_b64 = payload.get("data")
            if not data_b64:
                logger.warning("[SecretREST] Empty payload data for name=%s", name)
                return None
            raw = base64.b64decode(data_b64).decode("utf-8")
            logger.info("[SecretREST] Loaded secret via REST name=%s", name)
            return raw.strip() if raw else None
    except Exception as exc:
        logger.warning("[SecretREST] Secret Manager REST access failed id=%s: %s", sid, exc)
        return None


def _augment_prompt_with_templates(secret_text: str, input_template_text: str | None, output_template_text: str | None) -> str:
    prompt = (secret_text or "").strip()
    if not prompt:
        return ""
    if input_template_text:
        prompt += (
            "\n\n=== INPUT TEMPLATE (DATA COLLECTION GUIDE) ===\n"
            "Collect all required facts and fields matching this structure and semantics.\n"
            f"{input_template_text.strip()}"
        )
    if output_template_text:
        prompt += (
            "\n\n=== OUTPUT TEMPLATE (REQUIRED RESPONSE FORMAT) ===\n"
            "Format your final answer strictly using this structure.\n"
            f"{output_template_text.strip()}"
        )

        # Mirror the strict output expectations used in the Node `postProcessSecretPromptResponse`
        # flow: force the model to return valid JSON wrapped in markdown code blocks.
        required_section_keys = _extract_required_section_keys(output_template_text)
        sections_list = ""
        if required_section_keys:
            sections_list = "\n\n📋 REQUIRED SECTIONS (MUST INCLUDE ALL):\n" + "\n".join(
                [f"   {idx + 1}. {key}" for idx, key in enumerate(required_section_keys)]
            )

        prompt += (
            "\n\n"
            "═══════════════════════════════════════════════════════════════════════\n"
            "🚨 CRITICAL OUTPUT FORMATTING REQUIREMENTS - MANDATORY FOR ALL LLMs 🚨\n"
            "═══════════════════════════════════════════════════════════════════════\n\n"
            "⚠️ ABSOLUTE REQUIREMENT: Your response MUST be valid JSON wrapped in markdown code blocks.\n"
            "⚠️ NO EXCEPTIONS: This applies to ALL LLM models (Gemini, Claude, GPT, DeepSeek, etc.).\n"
            "⚠️ NO RAW JSON: Never return raw JSON without markdown code blocks.\n"
            "⚠️ NO EXPLANATIONS: Do not include any text before or after the JSON code block.\n"
            f"{sections_list}\n\n"
            "📝 Output MUST match the OUTPUT TEMPLATE structure provided above.\n"
            "🧾 Wrap ONLY the JSON (no extra text) like this:\n"
            "```json\n"
            "{}\n"
            "```\n"
        )
    return prompt


def _extract_required_section_keys(output_template_text: str) -> list[str]:
    """
    Extract keys like `2_1_ground_wise_summary` from the stored extracted_text.
    Mirrors the regex used in the Node controller layer.
    """
    if not output_template_text or not isinstance(output_template_text, str):
        return []
    # Keys often appear inside quotes in templates, so accept optional quotes.
    pattern = r"""["']?(\d+_\d+_[a-z_]+)["']?"""
    matches = re.findall(pattern, output_template_text, flags=re.IGNORECASE)
    # Preserve order while de-duping
    seen: set[str] = set()
    ordered: list[str] = []
    for key in matches:
        key_norm = str(key).strip()
        if not key_norm:
            continue
        if key_norm in seen:
            continue
        seen.add(key_norm)
        ordered.append(key_norm)
    return ordered


def post_process_secret_prompt_response(raw_response: str) -> str:
    """
    Ensure secret/preset prompt responses are wrapped as:
    ```json
    {...}
    ```
    so the frontend renderer can reliably parse/format them.
    """
    if not raw_response or not isinstance(raw_response, str):
        return raw_response

    cleaned = raw_response.strip()

    # 1) Extract from ```json code block if present
    code_block_match = re.search(r"```json\s*([\s\S]*?)\s*```", cleaned, flags=re.IGNORECASE)
    if code_block_match:
        inner = code_block_match.group(1).strip()
        try:
            parsed = json.loads(inner)
            return f"```json\n{json.dumps(parsed, indent=2)}\n```"
        except Exception:
            # If already in a code block but invalid JSON, fall back to original.
            return cleaned

    # 2) Try direct JSON parse (raw JSON string)
    try:
        if cleaned.startswith("{") or cleaned.startswith("["):
            parsed = json.loads(cleaned)
            return f"```json\n{json.dumps(parsed, indent=2)}\n```"
    except Exception:
        pass

    return cleaned


def resolve_query_and_display(
    *,
    question: str | None,
    secret_id: str | None,
    prompt_label: str | None,
    authorization: str | None,
) -> tuple[str, str]:
    """
    Returns (query_text_for_rag_llm, display_for_user_and_db).

    For secret flows, display is always the secret name, never the prompt body.
    If question is empty but secret_id is set, loads and augments prompt body locally.
    """
    q = (question or "").strip()
    sid = (secret_id or "").strip() or None

    if not sid:
        if not q:
            return "", ""
        return q, q

    display = resolve_secret_display_label(sid, prompt_label, authorization)
    row = _fetch_secret_row_local(sid)
    if not row:
        raise ValueError("Could not load secret prompt metadata from local DB.")
    # Prefer GCP REST + service-account first (uses GCS_KEY_BASE64 + GCLOUD_PROJECT_ID,
    # avoids grpc/ADC path completely on local).
    secret_body = _fetch_secret_value_from_gcp_rest(
        str(row.get("secret_manager_id") or ""),
        row.get("version"),
    )
    if not secret_body:
        secret_body = _fetch_secret_value_from_gcp(
            str(row.get("secret_manager_id") or ""),
            row.get("version"),
        )
    if not secret_body:
        raise ValueError("Could not load secret prompt value from Secret Manager.")
    input_template_text = _fetch_template_text_local(row.get("input_template_id"))
    output_template_text = _fetch_template_text_local(row.get("output_template_id"))
    effective_query = _augment_prompt_with_templates(secret_body, input_template_text, output_template_text)

    normalized_question = _normalize_prompt_text(q)
    normalized_display = _normalize_prompt_text(display)
    looks_like_label_only = normalized_question in {
        "",
        normalized_display,
        _normalize_prompt_text(f"analysis: {display}"),
        _normalize_prompt_text(f"analysis - {display}"),
        _normalize_prompt_text(sid),
    }

    if not looks_like_label_only and q:
        effective_query = (
            f"{effective_query}\n\n=== ADDITIONAL USER INSTRUCTIONS ===\n{q}"
            if effective_query
            else q
        )

    return effective_query, display
