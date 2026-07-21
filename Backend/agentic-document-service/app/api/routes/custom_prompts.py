"""User custom prompt groups — CRUD + AI prompt generation.

Mounted at /api/files/custom-prompts (registered BEFORE the files router so the
static prefix wins over /api/files/{folder_name} wildcard routes). Data lives
in the shared document DB, so the same groups are served by the
agentic-chat-service under /api/chat/custom-prompts.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.services import custom_prompt_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/files/custom-prompts", tags=["custom-prompts"])


def _extract_user_id(authorization: str | None, x_user_id: str | None) -> str:
    """Resolve caller identity: verified JWT → unverified payload → x-user-id header."""
    token = None
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]

    if token:
        try:
            import jwt as pyjwt

            secret = get_settings().jwt_secret
            if secret:
                payload = pyjwt.decode(token, secret, algorithms=["HS256"])
                uid = payload.get("id") or payload.get("userId") or payload.get("user_id") or payload.get("sub")
                if uid:
                    return str(uid)
        except Exception:  # noqa: BLE001 — fall through to unverified decode
            pass
        try:
            body = token.split(".")[1]
            body += "=" * ((4 - len(body) % 4) % 4)
            payload = json.loads(base64.urlsafe_b64decode(body.encode("utf-8")).decode("utf-8"))
            uid = payload.get("id") or payload.get("userId") or payload.get("user_id") or payload.get("sub")
            if uid:
                return str(uid)
        except Exception:  # noqa: BLE001
            pass

    if x_user_id and x_user_id.strip():
        return x_user_id.strip()
    raise HTTPException(status_code=401, detail="Authentication required")


class GroupCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None


class PromptCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    prompt_text: str = Field(min_length=1)
    group_id: str | None = None
    group_name: str | None = Field(default=None, max_length=120)
    description: str | None = None


class BuilderMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str


class GenerateRequest(BaseModel):
    """Either a one-shot `description`, or the builder-chat `messages` history
    (each refinement turn resends the whole conversation)."""

    description: str = Field(default="", max_length=4000)
    messages: list[BuilderMessage] | None = None
    # The draft currently on screen. Sent alongside `messages` so a refinement
    # always has the exact text to edit, even if the history is trimmed.
    current_prompt: str | None = None


@router.get("/groups")
def groups_list(
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> list[dict[str, Any]]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return custom_prompt_service.list_groups(user_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to list prompt groups: {exc}") from exc


@router.post("/groups")
def groups_create(
    body: GroupCreateRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return custom_prompt_service.create_group(user_id, body.name, body.description)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to create group: {exc}") from exc


@router.delete("/groups/{group_id}")
def groups_delete(
    group_id: str,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        deleted = custom_prompt_service.delete_group(user_id, group_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to delete group: {exc}") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"success": True, "id": group_id}


@router.post("/prompts")
def prompts_create(
    body: PromptCreateRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        return custom_prompt_service.add_prompt(
            user_id,
            name=body.name,
            prompt_text=body.prompt_text,
            group_id=body.group_id,
            group_name=body.group_name,
            description=body.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to save prompt: {exc}") from exc


@router.delete("/prompts/{prompt_id}")
def prompts_delete(
    prompt_id: str,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, Any]:
    user_id = _extract_user_id(authorization, x_user_id)
    try:
        deleted = custom_prompt_service.delete_prompt(user_id, prompt_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to delete prompt: {exc}") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"success": True, "id": prompt_id}


@router.post("/generate")
def prompt_generate(
    body: GenerateRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None),
) -> dict[str, str]:
    _extract_user_id(authorization, x_user_id)  # auth gate only
    try:
        return custom_prompt_service.generate_prompt(
            body.description,
            messages=[m.model_dump() for m in body.messages] if body.messages else None,
            current_prompt=body.current_prompt,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Prompt generation failed: {exc}") from exc
