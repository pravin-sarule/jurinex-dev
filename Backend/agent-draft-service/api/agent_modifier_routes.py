"""
Agent Modifier API — manage and improve the autopopulation agent.

Routes:
  POST   /api/agent-modifier/modify           — Analyse issue + generate modified code
  POST   /api/agent-modifier/execute          — Run autopopulation using DB agent code
  GET    /api/agent-modifier/current          — Get current active agent version
  GET    /api/agent-modifier/versions         — List all agent versions
  POST   /api/agent-modifier/activate/{id}   — Promote a version to active
  GET    /api/agent-modifier/prompts          — List all extraction prompts
  GET    /api/agent-modifier/prompts/{id}     — Get a single extraction prompt
  PUT    /api/agent-modifier/prompts/{id}     — Update an extraction prompt template
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agent-modifier", tags=["Agent Modifier"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class ModifyRequest(BaseModel):
    issue_description: str
    test_cases: Optional[List[Dict[str, Any]]] = None


class ExecuteRequest(BaseModel):
    payload: Dict[str, Any]
    agent_version_id: Optional[str] = None


class UpdatePromptRequest(BaseModel):
    template: str
    model: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize(obj: Any) -> Any:
    """Make psycopg2 row dicts JSON-serialisable (datetime → ISO string, UUID → str)."""
    import datetime, uuid
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(i) for i in obj]
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    if isinstance(obj, uuid.UUID):
        return str(obj)
    return obj


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/modify")
def modify_agent(body: ModifyRequest) -> Dict[str, Any]:
    """
    Analyse a reported issue with the autopopulation agent, generate improved code
    using Claude, validate it, and save a new agent_versions row (status='testing').

    Activate the new version via POST /activate/{id} after manual review.
    """
    from services.agent_modifier_service import AgentModifierService

    try:
        svc = AgentModifierService()
        result = svc.analyze_and_modify(
            issue_description=body.issue_description,
            test_cases=body.test_cases,
        )
        return {"success": True, **_serialize(result)}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("[AgentModifier] /modify failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute")
def execute_agent(body: ExecuteRequest) -> Dict[str, Any]:
    """
    Run autopopulation using agent code stored in agent_versions (active or specified).
    Falls back to run_autopopulation_agent() from disk if no DB version exists.
    """
    from services.agent_modifier_service import DynamicAgentExecutor

    try:
        executor = DynamicAgentExecutor()
        result = executor.execute(
            payload=body.payload,
            agent_version_id=body.agent_version_id,
        )
        return {"success": True, "result": _serialize(result)}
    except RuntimeError as e:
        # No DB version — fall back to disk agent
        if "No active agent_version" in str(e):
            logger.info("[AgentModifier] No DB agent; falling back to disk autopopulation_agent")
            try:
                from agents.ingestion.autopopulation_agent import run_autopopulation_agent
                result = run_autopopulation_agent(body.payload)
                return {"success": True, "result": result, "source": "disk"}
            except Exception as disk_err:
                raise HTTPException(status_code=500, detail=str(disk_err))
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception("[AgentModifier] /execute failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/current")
def get_current_agent() -> Dict[str, Any]:
    """Return the currently active agent_versions row (code excluded for brevity)."""
    from services.agent_modifier_service import _get_active_agent

    agent = _get_active_agent()
    if not agent:
        return {"success": True, "agent": None, "message": "No active DB version; using disk agent"}

    out = {k: v for k, v in agent.items() if k != "code"}
    return {"success": True, "agent": _serialize(out)}


@router.get("/versions")
def list_versions() -> Dict[str, Any]:
    """List all agent_versions rows (code excluded)."""
    from services.agent_modifier_service import _get_all_agents

    agents = _get_all_agents()
    out = [{k: v for k, v in a.items() if k != "code"} for a in agents]
    return {"success": True, "versions": _serialize(out), "total": len(out)}


@router.post("/activate/{agent_id}")
def activate_version(agent_id: str) -> Dict[str, Any]:
    """
    Promote the specified agent_version to active.
    All other versions with the same name are deprecated.
    """
    from services.agent_modifier_service import _activate_agent

    activated = _activate_agent(agent_id)
    if not activated:
        raise HTTPException(status_code=404, detail=f"agent_version {agent_id} not found")
    return {"success": True, "agent": _serialize(activated)}


@router.get("/prompts")
def list_prompts() -> Dict[str, Any]:
    """List all extraction_prompts rows."""
    from services.agent_modifier_service import _get_extraction_prompts

    prompts = _get_extraction_prompts()
    return {"success": True, "prompts": _serialize(prompts), "total": len(prompts)}


@router.get("/prompts/{prompt_id}")
def get_prompt(prompt_id: str) -> Dict[str, Any]:
    """Get a single extraction_prompts row by ID."""
    from services.agent_modifier_service import _get_prompt_by_id

    prompt = _get_prompt_by_id(prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail=f"Prompt {prompt_id} not found")
    return {"success": True, "prompt": _serialize(prompt)}


@router.put("/prompts/{prompt_id}")
def update_prompt(prompt_id: str, body: UpdatePromptRequest) -> Dict[str, Any]:
    """Update the template (and optionally model/config) of an extraction_prompts row."""
    from services.agent_modifier_service import _update_extraction_prompt

    updated = _update_extraction_prompt(
        prompt_id=prompt_id,
        template=body.template,
        model=body.model,
        max_tokens=body.max_tokens,
        temperature=body.temperature,
    )
    if not updated:
        raise HTTPException(status_code=404, detail=f"Prompt {prompt_id} not found")
    return {"success": True, "prompt": _serialize(updated)}
