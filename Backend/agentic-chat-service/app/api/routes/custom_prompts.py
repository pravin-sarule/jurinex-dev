"""User custom prompt groups — CRUD + AI prompt generation.

Mounted at /api/chat/custom-prompts. Data lives in the shared document DB, so
the same groups are served by the agentic-document-service under
/api/files/custom-prompts.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.services import custom_prompt_service

router = APIRouter(prefix="/api/chat/custom-prompts", tags=["custom-prompts"])


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
def groups_list(user: dict = Depends(get_current_user)) -> list[dict[str, Any]]:
    try:
        return custom_prompt_service.list_groups(user["id"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to list prompt groups: {exc}") from exc


@router.post("/groups")
def groups_create(body: GroupCreateRequest, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return custom_prompt_service.create_group(user["id"], body.name, body.description)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to create group: {exc}") from exc


@router.delete("/groups/{group_id}")
def groups_delete(group_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    try:
        deleted = custom_prompt_service.delete_group(user["id"], group_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to delete group: {exc}") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Group not found")
    return {"success": True, "id": group_id}


@router.post("/prompts")
def prompts_create(body: PromptCreateRequest, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    try:
        return custom_prompt_service.add_prompt(
            user["id"],
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
def prompts_delete(prompt_id: str, user: dict = Depends(get_current_user)) -> dict[str, Any]:
    try:
        deleted = custom_prompt_service.delete_prompt(user["id"], prompt_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to delete prompt: {exc}") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return {"success": True, "id": prompt_id}


@router.post("/generate")
async def prompt_generate(body: GenerateRequest, user: dict = Depends(get_current_user)) -> dict[str, str]:
    try:
        return await custom_prompt_service.generate_prompt(
            body.description,
            messages=[m.model_dump() for m in body.messages] if body.messages else None,
            current_prompt=body.current_prompt,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Prompt generation failed: {exc}") from exc
