"""
RBAC business logic for case assignments.

Ports the following Node.js modules to Python — every log line mirrors the
console.log / console.error style used in the original codebase so that
Cloud Run structured logs look identical for easy grepping.

Source modules:
  document-service/utils/caseAssignmentsDb.js  → schema init helpers
  document-service/utils/rbac.js               → permission helpers
  document-service/controllers/FileController.js (getFirmAssignmentScope,
                                                   getAssignedCaseIdsForUser,
                                                   normalizeCaseIdValue,
                                                   getDisplayCaseName)
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings
from app.services.db import get_db_connection

logger = logging.getLogger("agentic_document_service.rbac.service")

SUPPORTED_SQL_TYPES = {"uuid", "integer", "bigint"}

# ─────────────────────────────────────────────────────────────────────────────
# Structured log helpers  (mirror JS: logCaseAssignments / logCaseAssignmentsSchema)
# ─────────────────────────────────────────────────────────────────────────────

def _log(tag: str, event: str, payload: dict | None = None) -> None:
    """Emit a structured info log that matches the Node.js console.log pattern."""
    msg = f"[{tag}] {event}"
    if payload:
        parts = "  ".join(f"{k}={v!r}" for k, v in payload.items())
        msg = f"{msg}  {parts}"
    logger.info(msg)


def _log_err(tag: str, event: str, payload: dict | None = None) -> None:
    msg = f"[{tag}] {event}"
    if payload:
        parts = "  ".join(f"{k}={v!r}" for k, v in payload.items())
        msg = f"{msg}  {parts}"
    logger.error(msg)


def log_schema(event: str, payload: dict | None = None) -> None:
    _log("CaseAssignments][Schema", event, payload)


def log_assign(event: str, payload: dict | None = None) -> None:
    _log("CaseAssignments", event, payload)


def log_assign_err(event: str, payload: dict | None = None) -> None:
    _log_err("CaseAssignments", event, payload)


def log_rbac(event: str, payload: dict | None = None) -> None:
    _log("RBAC", event, payload)


# ─────────────────────────────────────────────────────────────────────────────
# Schema helpers  (ported from caseAssignmentsDb.js)
# ─────────────────────────────────────────────────────────────────────────────

def _get_column_type(conn: Any, table: str, col: str) -> str:
    row = conn.execute(
        """
        SELECT data_type, udt_name
        FROM   information_schema.columns
        WHERE  table_schema = 'public'
          AND  table_name   = %s
          AND  column_name  = %s
        LIMIT 1
        """,
        (table, col),
    ).fetchone()

    if not row:
        raise ValueError(f"Column public.{table}.{col} not found")

    raw = row["data_type"]
    sql_type = (
        "uuid"    if raw == "uuid"    else
        "integer" if raw == "integer" else
        "bigint"  if raw == "bigint"  else
        row["udt_name"]
    )

    if sql_type not in SUPPORTED_SQL_TYPES:
        raise ValueError(f"Unsupported SQL type for public.{table}.{col}: {sql_type}")
    return sql_type


def _try_column_type(conn: Any, table: str, col: str) -> str | None:
    try:
        return _get_column_type(conn, table, col)
    except ValueError as exc:
        if f"public.{table}.{col} not found" in str(exc):
            return None
        raise


def _resolve_user_id_type(conn: Any) -> tuple[str, str, str]:
    candidates = [
        ("cases",        "user_id"),
        ("user_files",   "user_id"),
        ("folder_chats", "user_id"),
        ("user_usage",   "user_id"),
        ("users",        "id"),
    ]
    for table, col in candidates:
        sql_type = _try_column_type(conn, table, col)
        if sql_type is not None:
            log_schema("user_id type resolved", {"table": table, "col": col, "type": sql_type})
            return sql_type, table, col

    raise RuntimeError(
        "Unable to infer user_id type. Tried: "
        + ", ".join(f"{t}.{c}" for t, c in candidates)
    )


def get_case_assignments_meta(conn: Any) -> dict[str, str]:
    """Return {caseIdSqlType, caseIdSource, userIdSqlType, userIdSource}."""
    case_id_type = _try_column_type(conn, "cases", "id")
    if case_id_type is None:
        raise RuntimeError("Unable to infer case_id type: public.cases.id not found")

    user_id_type, uid_table, uid_col = _resolve_user_id_type(conn)

    meta = {
        "caseIdSqlType": case_id_type,
        "caseIdSource":  "cases.id",
        "userIdSqlType": user_id_type,
        "userIdSource":  f"{uid_table}.{uid_col}",
    }
    log_schema("Meta resolved", meta)
    return meta


def ensure_case_assignments_schema(conn: Any) -> dict[str, str]:
    """
    Idempotently create the case_assignments table with correct column types.
    Mirrors initializeCaseAssignmentsSchema() from caseAssignmentsDb.js.
    """
    meta = get_case_assignments_meta(conn)
    cid = meta["caseIdSqlType"]
    uid = meta["userIdSqlType"]

    existing_cid = _try_column_type(conn, "case_assignments", "case_id")
    existing_uid = _try_column_type(conn, "case_assignments", "user_id")

    # ── Type-mismatch guard (mirrors ensureCompatibleCaseAssignmentsTable) ──
    if existing_cid is not None and (existing_cid != cid or existing_uid != uid):
        count_row = conn.execute(
            "SELECT COUNT(*)::int AS cnt FROM case_assignments"
        ).fetchone()
        row_count = count_row["cnt"] or 0

        log_schema("Type mismatch detected", {
            "existingCaseIdType": existing_cid,
            "existingUserIdType": existing_uid,
            "expectedCaseIdType": cid,
            "expectedUserIdType": uid,
            "rowCount": row_count,
        })

        if row_count > 0:
            raise RuntimeError(
                f"case_assignments type mismatch and table is NOT empty: "
                f"existingCaseId={existing_cid}, existingUserId={existing_uid}, "
                f"expectedCaseId={cid}, expectedUserId={uid}, rowCount={row_count}"
            )

        conn.execute("DROP TABLE IF EXISTS case_assignments")
        log_schema("Dropped empty incompatible table", {
            "existingCaseIdType": existing_cid,
            "existingUserIdType": existing_uid,
            "expectedCaseIdType": cid,
            "expectedUserIdType": uid,
        })

    log_schema("Initializing", {
        "caseIdSqlType": cid,
        "caseIdSource":  meta["caseIdSource"],
        "userIdSqlType": uid,
        "userIdSource":  meta["userIdSource"],
    })

    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS case_assignments (
            id          SERIAL PRIMARY KEY,
            case_id     {cid} NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
            user_id     {uid} NOT NULL,
            assigned_by {uid},
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (case_id, user_id)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_case_assignments_user_id ON case_assignments(user_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_case_assignments_case_id ON case_assignments(case_id)"
    )
    conn.commit()

    log_schema("Schema initialized successfully", {
        "caseIdSqlType": cid,
        "caseIdSource":  meta["caseIdSource"],
        "userIdSqlType": uid,
        "userIdSource":  meta["userIdSource"],
    })
    return meta


# ─────────────────────────────────────────────────────────────────────────────
# Value helpers
# ─────────────────────────────────────────────────────────────────────────────

def normalize_case_id(raw: Any, case_id_sql_type: str) -> Any:
    """Mirror normalizeCaseIdValue() from FileController.js."""
    if case_id_sql_type == "uuid":
        return str(raw).strip()
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise ValueError(f'Invalid case id "{raw}" for SQL type {case_id_sql_type}')


def get_display_case_name(case_row: dict[str, Any]) -> str:
    """Mirror getDisplayCaseName() from FileController.js."""
    title = str(case_row.get("case_title") or "").strip()
    if title:
        return title
    number = str(case_row.get("case_number") or "").strip()
    if number:
        return f"Case {number}"
    return "Untitled Case"


# ─────────────────────────────────────────────────────────────────────────────
# Permission helpers  (ported from rbac.js → isPermissionAllowed)
# ─────────────────────────────────────────────────────────────────────────────

def is_permission_allowed(permissions: dict[str, Any], key: str) -> bool:
    """
    Mirrors isPermissionAllowed():
      boolean → use directly
      string  → allowed unless the value is 'disabled'
      absent  → allowed (default open)
    """
    value = (permissions or {}).get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() != "disabled"
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Auth-service HTTP calls
# ─────────────────────────────────────────────────────────────────────────────

def _auth_url() -> str:
    return get_settings().auth_service_url.rstrip("/")


def fetch_firm_members(user_id: int) -> list[dict[str, Any]]:
    """
    GET /api/auth/internal/user/{userId}/firm-members
    Mirrors getFirmMembersForUser() from FileController.js.
    """
    url = f"{_auth_url()}/api/auth/internal/user/{user_id}/firm-members"
    log_rbac("Fetching firm members", {"userId": user_id, "url": url})
    try:
        resp = httpx.get(url, timeout=3.0)
        resp.raise_for_status()
        members = resp.json().get("members", [])
        result = members if isinstance(members, list) else []
        log_rbac("Firm members fetched", {"userId": user_id, "count": len(result)})
        return result
    except Exception as exc:
        log_assign_err("Failed to fetch firm members", {"userId": user_id, "error": str(exc)})
        raise


def fetch_firm_permissions(user_id: int) -> dict[str, Any]:
    """
    GET /api/auth/internal/user/{userId}/permissions
    Mirrors getFirmPermissionsForUser() from FileController.js.
    """
    url = f"{_auth_url()}/api/auth/internal/user/{user_id}/permissions"
    log_rbac("Fetching firm permissions", {"userId": user_id, "url": url})
    try:
        resp = httpx.get(url, timeout=3.0)
        resp.raise_for_status()
        perms = resp.json().get("permissions", {})
        result = perms if isinstance(perms, dict) else {}
        log_rbac("Firm permissions fetched", {
            "userId": user_id,
            "permissionKeys": list(result.keys()),
        })
        return result
    except Exception as exc:
        log_assign_err("Failed to fetch firm permissions", {"userId": user_id, "error": str(exc)})
        raise


# ─────────────────────────────────────────────────────────────────────────────
# Firm assignment scope  (mirrors getFirmAssignmentScope from FileController.js)
# ─────────────────────────────────────────────────────────────────────────────

def get_firm_assignment_scope(user: dict[str, Any]) -> dict[str, Any]:
    """
    Full port of getFirmAssignmentScope(req).

    Determines:
      isFirmAdmin            — ADMIN or FIRM_ADMIN role
      canViewCaseInformation — admin OR view_case_information permission
      canManageAssignments   — admin OR (manage_user_permissions AND canView)
    """
    actor_id = user.get("id")

    _empty = {
        "actorId":               None,
        "actorRole":             "",
        "isFirmAdmin":           False,
        "canViewCaseInformation": False,
        "canManageAssignments":  False,
        "permissions":           {},
        "members":               [],
        "memberIds":             [],
    }

    log_assign("Scope request received", {
        "actorId":          actor_id,
        "actorEmail":       user.get("email"),
        "actorAccountType": user.get("account_type"),
    })

    if not actor_id:
        log_assign("Scope aborted — no actor ID", {})
        return _empty

    members  = fetch_firm_members(actor_id)
    actor_member = next(
        (m for m in members if int(m.get("user_id", -1)) == actor_id), None
    )
    actor_role = str(
        (actor_member or {}).get("role") or user.get("account_type") or ""
    ).strip().upper()

    is_firm_admin = actor_role in ("ADMIN", "FIRM_ADMIN")

    permissions: dict[str, Any] = {}
    if str(user.get("account_type") or "").strip().upper() == "FIRM_USER":
        try:
            permissions = fetch_firm_permissions(actor_id)
        except Exception as exc:
            log_assign_err(
                "Could not fetch permissions — defaulting to deny",
                {"actorId": actor_id, "error": str(exc)},
            )

    can_view   = is_firm_admin or is_permission_allowed(permissions, "view_case_information")
    can_manage = is_firm_admin or (
        is_permission_allowed(permissions, "manage_user_permissions") and can_view
    )

    member_ids = [
        int(m["user_id"])
        for m in members
        if str(m.get("user_id", "")).lstrip("-").isdigit()
    ]

    scope = {
        "actorId":               actor_id,
        "actorRole":             actor_role,
        "isFirmAdmin":           is_firm_admin,
        "canViewCaseInformation": can_view,
        "canManageAssignments":  can_manage,
        "permissions":           permissions,
        "members":               members,
        "memberIds":             member_ids,
    }

    log_assign("Scope resolved", {
        "actorId":               actor_id,
        "actorRole":             actor_role,
        "isFirmAdmin":           is_firm_admin,
        "canViewCaseInformation": can_view,
        "canManageAssignments":  can_manage,
        "memberCount":           len(members),
        "memberIds":             member_ids,
    })
    return scope


# ─────────────────────────────────────────────────────────────────────────────
# DB operations
# ─────────────────────────────────────────────────────────────────────────────

def get_assigned_case_ids_for_user(
    conn: Any, user_id: int, meta: dict[str, str]
) -> list[Any]:
    """
    Mirrors getAssignedCaseIdsForUser() from FileController.js.
    SELECT case_id FROM case_assignments WHERE user_id = $1
    """
    log_assign("getAssignedCaseIdsForUser called", {
        "userId": user_id,
        "caseIdSqlType": meta["caseIdSqlType"],
    })
    rows = conn.execute(
        "SELECT case_id FROM case_assignments WHERE user_id = %s",
        (user_id,),
    ).fetchall()
    result = [normalize_case_id(r["case_id"], meta["caseIdSqlType"]) for r in rows]
    log_assign("getAssignedCaseIdsForUser done", {
        "userId": user_id,
        "assignedCaseIds": result,
    })
    return result
