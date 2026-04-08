"""
RBAC case-assignment endpoints — full port of the three routes from
document-service/routes/fileRoutes.js that call FileController methods:

  GET  /api/files/cases/assignable            → getAssignableCases
  GET  /api/files/cases/assignments/{user_id} → getUserCaseAssignments
  PUT  /api/files/cases/assignments/{user_id} → updateUserCaseAssignments

Mounted on the same /api/files prefix so the gateway's existing
/files → /api/files/* proxy works with no changes.

Rich dataflow logs mirror every console.log call from the original Node.js
controller so Cloud Run logs look identical for easy grepping.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.routes.rbac.auth import get_current_user
from app.api.routes.rbac.service import (
    ensure_case_assignments_schema,
    get_assigned_case_ids_for_user,
    get_display_case_name,
    get_firm_assignment_scope,
    log_assign,
    log_assign_err,
    normalize_case_id,
)
from app.services.db import get_db_connection

router = APIRouter(prefix="/api/files", tags=["rbac-assignments"])


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class UpdateAssignmentsRequest(BaseModel):
    caseIds: list[Any] = []


# ─────────────────────────────────────────────────────────────────────────────
# Shared guard helpers
# ─────────────────────────────────────────────────────────────────────────────

def _require_manage_assignments(scope: dict[str, Any]) -> None:
    if not scope["canManageAssignments"]:
        log_assign("Access denied — canManageAssignments=False", {
            "actorId":   scope["actorId"],
            "actorRole": scope["actorRole"],
        })
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to manage case assignments.",
        )


def _require_member(user_id: int, scope: dict[str, Any]) -> dict[str, Any]:
    if not user_id or user_id not in scope["memberIds"]:
        log_assign("Target user not in firm", {
            "actorId":    scope["actorId"],
            "targetUser": user_id,
            "memberIds":  scope["memberIds"],
        })
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target user not found in this firm.",
        )
    return next(
        (m for m in scope["members"] if int(m.get("user_id", -1)) == user_id), {}
    )


def _guard_admin_target(
    target_member: dict, user_id: int, scope: dict[str, Any]
) -> None:
    """Prevent non-admins from managing the firm admin's assignments."""
    target_role = str(target_member.get("role", "")).strip().upper()
    if target_role in ("ADMIN", "FIRM_ADMIN") and not scope["isFirmAdmin"]:
        log_assign("Access denied — target is firm admin, actor is not", {
            "actorId":    scope["actorId"],
            "targetUser": user_id,
            "targetRole": target_role,
        })
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only firm admins can manage case assignments for the firm admin.",
        )


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/files/cases/assignable
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/cases/assignable")
def get_assignable_cases(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Return all firm cases together with their currently-assigned user IDs.
    Mirrors FileController.getAssignableCases().

    Dataflow:
      1. JWT → current_user
      2. firm-members auth call → scope
      3. canManageAssignments guard
      4. SELECT cases WHERE user_id IN (member_ids)
      5. SELECT case_assignments GROUP BY case_id
      6. Merge and return
    """
    ctx = {
        "action":           "getAssignableCases",
        "actorId":          current_user.get("id"),
        "actorEmail":       current_user.get("email"),
        "actorAccountType": current_user.get("account_type"),
    }
    log_assign("Request received", ctx)

    scope = get_firm_assignment_scope(current_user)

    log_assign("Scope resolved", {
        **ctx,
        "actorRole":             scope["actorRole"],
        "isFirmAdmin":           scope["isFirmAdmin"],
        "canViewCaseInformation": scope["canViewCaseInformation"],
        "canManageAssignments":  scope["canManageAssignments"],
        "memberIds":             scope["memberIds"],
    })

    _require_manage_assignments(scope)

    if not scope["memberIds"]:
        log_assign("No firm members — returning empty list", ctx)
        return {"cases": []}

    with get_db_connection() as conn:
        meta = ensure_case_assignments_schema(conn)
        cid_type = meta["caseIdSqlType"]

        log_assign("Querying assignable cases", {
            **ctx,
            "caseIdSqlType": cid_type,
            "memberIds":     scope["memberIds"],
        })

        case_rows = conn.execute(
            """
            SELECT DISTINCT c.id, c.user_id, c.case_title, c.case_number,
                            c.status, c.created_at
            FROM   cases c
            WHERE  c.user_id = ANY(%s::int[])
            ORDER  BY c.created_at DESC
            """,
            (scope["memberIds"],),
        ).fetchall()

        log_assign("Cases fetched from DB", {**ctx, "totalCases": len(case_rows)})

        assignments_by_case: dict[Any, list[int]] = {}
        if case_rows:
            case_ids = [r["id"] for r in case_rows]
            asgn_rows = conn.execute(
                f"""
                SELECT case_id,
                       ARRAY_AGG(user_id ORDER BY user_id) AS assigned_user_ids
                FROM   case_assignments
                WHERE  case_id = ANY(%s::{cid_type}[])
                GROUP  BY case_id
                """,
                (case_ids,),
            ).fetchall()
            for row in asgn_rows:
                assignments_by_case[row["case_id"]] = [
                    int(uid) for uid in (row["assigned_user_ids"] or [])
                    if str(uid).lstrip("-").isdigit()
                ]
            log_assign("Assignments fetched from DB", {
                **ctx,
                "assignedCaseCount": len(asgn_rows),
            })

    cases = [
        {
            "id":                r["id"],
            "user_id":           r["user_id"],
            "case_title":        get_display_case_name(r),
            "case_number":       r["case_number"],
            "status":            r["status"],
            "assigned_user_ids": assignments_by_case.get(r["id"], []),
        }
        for r in case_rows
    ]

    log_assign("Request succeeded", {
        **ctx,
        "caseIdSqlType": cid_type,
        "totalCases":    len(cases),
    })
    return {"cases": cases}


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/files/cases/assignments/{user_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/cases/assignments/{user_id}")
def get_user_case_assignments(
    user_id: int,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Return the list of case IDs assigned to a specific firm member.
    Mirrors FileController.getUserCaseAssignments().

    Dataflow:
      1. JWT → current_user
      2. firm-members auth call → scope
      3. canManageAssignments guard
      4. target-user-in-firm guard
      5. admin-target guard
      6. SELECT case_id FROM case_assignments WHERE user_id = target
    """
    ctx = {
        "action":           "getUserCaseAssignments",
        "actorId":          current_user.get("id"),
        "actorEmail":       current_user.get("email"),
        "actorAccountType": current_user.get("account_type"),
        "targetUserId":     user_id,
    }
    log_assign("Request received", ctx)

    scope = get_firm_assignment_scope(current_user)

    log_assign("Scope resolved", {
        **ctx,
        "actorRole":            scope["actorRole"],
        "isFirmAdmin":          scope["isFirmAdmin"],
        "canManageAssignments": scope["canManageAssignments"],
        "memberIds":            scope["memberIds"],
    })

    _require_manage_assignments(scope)
    target_member = _require_member(user_id, scope)
    _guard_admin_target(target_member, user_id, scope)

    with get_db_connection() as conn:
        meta = ensure_case_assignments_schema(conn)
        log_assign("Fetching assignments for target user", {
            **ctx, "caseIdSqlType": meta["caseIdSqlType"]
        })
        case_ids = get_assigned_case_ids_for_user(conn, user_id, meta)

    log_assign("Request succeeded", {
        **ctx,
        "caseIdSqlType": meta["caseIdSqlType"],
        "assignedCaseIds": case_ids,
    })
    return {"userId": user_id, "caseIds": case_ids}


# ─────────────────────────────────────────────────────────────────────────────
# PUT /api/files/cases/assignments/{user_id}
# ─────────────────────────────────────────────────────────────────────────────

@router.put("/cases/assignments/{user_id}")
def update_user_case_assignments(
    user_id: int,
    body: UpdateAssignmentsRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Replace a firm member's case assignments (full replace, not patch).
    Mirrors FileController.updateUserCaseAssignments().

    Dataflow:
      1. JWT → current_user
      2. firm-members + permissions auth calls → scope
      3. canManageAssignments guard
      4. target-user-in-firm guard
      5. admin-target guard
      6. Validate all requested caseIds belong to the firm
      7. BEGIN TRANSACTION
         DELETE FROM case_assignments WHERE user_id = target
         INSERT new rows (ON CONFLICT DO NOTHING)
         COMMIT
    """
    ctx = {
        "action":           "updateUserCaseAssignments",
        "actorId":          current_user.get("id"),
        "actorEmail":       current_user.get("email"),
        "actorAccountType": current_user.get("account_type"),
        "targetUserId":     user_id,
        "rawCaseIds":       body.caseIds,
    }
    log_assign("Request received", ctx)

    scope = get_firm_assignment_scope(current_user)

    log_assign("Scope resolved", {
        **ctx,
        "actorRole":            scope["actorRole"],
        "isFirmAdmin":          scope["isFirmAdmin"],
        "canManageAssignments": scope["canManageAssignments"],
        "memberIds":            scope["memberIds"],
    })

    _require_manage_assignments(scope)
    target_member = _require_member(user_id, scope)
    _guard_admin_target(target_member, user_id, scope)

    try:
        with get_db_connection() as conn:
            meta = ensure_case_assignments_schema(conn)
            cid_type = meta["caseIdSqlType"]

            # Deduplicate & normalise requested case IDs
            seen: set[Any] = set()
            requested: list[Any] = []
            for raw in body.caseIds:
                norm = normalize_case_id(raw, cid_type)
                if norm not in seen:
                    seen.add(norm)
                    requested.append(norm)

            log_assign("Scope and case IDs normalised", {
                **ctx,
                "caseIdSqlType":     cid_type,
                "normalizedCaseIds": requested,
            })

            # Validate all requested cases are accessible by this firm
            if requested:
                accessible = conn.execute(
                    f"""
                    SELECT id FROM cases
                    WHERE  id      = ANY(%s::{cid_type}[])
                      AND  user_id = ANY(%s::int[])
                    """,
                    (requested, scope["memberIds"]),
                ).fetchall()

                log_assign("Accessible cases validated", {
                    **ctx,
                    "requestedCount":  len(requested),
                    "accessibleCount": len(accessible),
                })

                if len(accessible) != len(requested):
                    log_assign_err("Case validation failed — inaccessible cases found", {
                        **ctx,
                        "requestedCount":  len(requested),
                        "accessibleCount": len(accessible),
                    })
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="One or more selected cases are not assignable for this firm.",
                    )

            # ── Atomic replace ───────────────────────────────────────────────────
            log_assign("Starting transaction — DELETE then INSERT", {
                **ctx, "caseCount": len(requested),
            })

            with conn.transaction():
                conn.execute(
                    "DELETE FROM case_assignments WHERE user_id = %s",
                    (user_id,),
                )
                log_assign("Existing assignments deleted", {**ctx, "targetUserId": user_id})
                if requested:
                    inserted = 0
                    for cid in requested:
                        conn.execute(
                            f"""
                            INSERT INTO case_assignments (case_id, user_id, assigned_by)
                            VALUES (%s::{cid_type}, %s::int, %s::int)
                            ON CONFLICT (case_id, user_id) DO NOTHING
                            """,
                            (cid, user_id, scope["actorId"]),
                        )
                        inserted += 1
                    log_assign(
                        "Assignments inserted",
                        {**ctx, "insertAttemptCount": inserted, "normalizedCaseIds": requested},
                    )
            # Explicit commit for psycopg connection lifecycle consistency.
            conn.commit()
            persisted_rows = conn.execute(
                "SELECT COUNT(*)::int AS cnt FROM case_assignments WHERE user_id = %s",
                (user_id,),
            ).fetchone()
            log_assign(
                "Transaction committed",
                {**ctx, "persistedAssignmentCount": int((persisted_rows or {}).get("cnt") or 0)},
            )
    except HTTPException:
        raise
    except Exception as exc:
        log_assign_err(
            "Unhandled error while saving assignments",
            {**ctx, "error": str(exc), "rawCaseIds": body.caseIds},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save case assignments.",
        ) from exc

    log_assign("Request succeeded", {
        **ctx,
        "caseIdSqlType": cid_type,
        "savedCaseIds":  requested,
    })
    return {
        "success": True,
        "message": "Case assignments updated successfully.",
        "userId":  user_id,
        "caseIds": requested,
    }
