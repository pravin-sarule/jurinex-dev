from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agents.legal_case_management.agent import (
    delete_case_draft_tool,
    get_case_draft_tool,
    save_case_draft_tool,
)
from app.services.db import get_db_connection, is_db_available


router = APIRouter(prefix="/api/content", tags=["content"])


class SaveDraftRequest(BaseModel):
    userId: str | int
    draftData: str | dict
    lastStep: str | int | None = None


def _require_db() -> None:
    if not is_db_available():
        raise HTTPException(
            status_code=503,
            detail="Database is not available for native content endpoints.",
        )


@router.post("/case-draft/save")
def save_case_draft(request: SaveDraftRequest) -> dict:
    draft_data = request.draftData
    if isinstance(draft_data, str):
        try:
            parsed = json.loads(draft_data)
        except json.JSONDecodeError:
            parsed = draft_data
    else:
        parsed = draft_data
    return save_case_draft_tool(str(request.userId), parsed, request.lastStep)


@router.get("/case-draft/{user_id}")
def get_case_draft(user_id: str) -> dict:
    draft = get_case_draft_tool(str(user_id))
    if not draft:
        return {
            "exists": False,
            "user_id": str(user_id),
            "draft_data": None,
            "last_step": None,
        }
    return draft


@router.delete("/case-draft/{user_id}")
def delete_case_draft(user_id: str) -> dict:
    return delete_case_draft_tool(str(user_id))


@router.get("/case-types")
def get_case_types() -> list[dict]:
    _require_db()
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM case_types ORDER BY id ASC")
        return list(cur.fetchall())


@router.get("/case-types/{case_type_id}/sub-types")
def get_sub_types(case_type_id: str) -> list[dict]:
    _require_db()
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM sub_types WHERE case_type_id = %s ORDER BY id ASC",
            (case_type_id,),
        )
        return list(cur.fetchall())


@router.get("/jurisdictions")
def get_jurisdictions() -> list[dict]:
    _require_db()
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT j.*, COUNT(DISTINCT c.id) AS court_count
            FROM jurisdictions j
            LEFT JOIN courts c ON j.id = c.jurisdiction_id
            GROUP BY j.id
            ORDER BY j.id ASC
            """
        )
        return list(cur.fetchall())


@router.get("/jurisdictions/{jurisdiction_id}/courts")
def get_courts_by_jurisdiction(jurisdiction_id: str) -> list[dict]:
    _require_db()
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.*, COUNT(b.id) AS bench_count
            FROM courts c
            LEFT JOIN benches b ON c.id = b.court_id
            WHERE c.jurisdiction_id = %s
            GROUP BY c.id
            ORDER BY c.court_name ASC
            """,
            (jurisdiction_id,),
        )
        return list(cur.fetchall())


@router.get("/courts")
def get_courts(level: str | None = None) -> list[dict]:
    _require_db()
    with get_db_connection() as conn, conn.cursor() as cur:
        if level:
            cur.execute(
                "SELECT * FROM courts WHERE LOWER(level) = LOWER(%s) ORDER BY court_name ASC",
                (level,),
            )
        else:
            cur.execute("SELECT * FROM courts ORDER BY court_name ASC")
        return list(cur.fetchall())


@router.get("/courts/level/{level}")
def get_courts_by_level(level: str) -> list[dict]:
    _require_db()
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM courts WHERE LOWER(level) = LOWER(%s) ORDER BY court_name ASC",
            (level,),
        )
        return list(cur.fetchall())


@router.get("/courts/{court_id}/benches")
def get_benches_by_court(court_id: str) -> list[dict]:
    _require_db()
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT *
            FROM benches
            WHERE court_id = %s
            ORDER BY is_principal DESC, bench_name ASC
            """,
            (court_id,),
        )
        return list(cur.fetchall())


@router.get("/judges")
def get_judges(courtId: str, benchName: str) -> list[dict]:
    _require_db()
    with get_db_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT *
            FROM judges
            WHERE court_id = %s
              AND LOWER(bench_name) = LOWER(%s)
            ORDER BY name ASC
            """,
            (courtId, benchName),
        )
        return list(cur.fetchall())
