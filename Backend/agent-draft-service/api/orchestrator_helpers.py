"""
Orchestrator factory for agent flows (upload → Ingestion, retrieve → Librarian).
Shared by ingestion_routes and librarian_routes.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException

from services.agent_config_service import get_agent_config_with_defaults


ADK_AGENT_DB_CONFIG = {
    "drafter": {
        "agent_type": "drafting",
        "preferred_names": ["Jurinex Drafter Agent", "Drafter Agent", "Orchestrator Agent"],
    },
    "citation": {
        "agent_type": "citation",
        "preferred_names": ["Jurinex Citation Agent", "Citation Agent"],
    },
    "critic": {
        "agent_type": "critic",
        "preferred_names": ["Jurinex Critic Agent", "Critic Agent"],
    },
    "assembler": {
        "agent_type": "assembler",
        "fallback_agent_types": ["drafting"],
        "preferred_names": ["Assembler Agent", "Jurinex Assembler Agent"],
    },
    "librarian": {
        "agent_type": "librarian",
        "fallback_agent_types": ["drafting"],
        "preferred_names": ["Librarian Agent", "Jurinex Librarian Agent"],
    },
}


def get_orchestrator(ingestion_only: bool = True, retrieve_only: bool = False):
    """
    Create orchestrator with ADK client.
    - ingestion_only=True (default): register only Ingestion (for upload flow).
    - retrieve_only=True: register only Librarian (for query/retrieve flow).
    - Both False: register Ingestion, Librarian, Drafter, Critic, Assembler (full pipeline).
    """
    from agents.orchestrator.agent import OrchestratorAgent, OrchestratorConfig
    from agents.orchestrator.flow_controller import AgentName, FlowController
    from agents.orchestrator.state_manager import StateManager
    from services.adk_client import ADKAgentConfig, ADKClient

    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GOOGLE_API_KEY or GEMINI_API_KEY not set")

    client = ADKClient(
        api_key=api_key,
        use_local_ingestion=True,
        use_local_librarian=True,
        use_local_citation=True,
        use_local_assembler=True,
        use_local_drafter=True,
        use_local_critic=True
    )
    project_root = Path(__file__).resolve().parent.parent
    prompt_path = project_root / "instructions"

    if retrieve_only:
        agent_names = [AgentName.LIBRARIAN.value]
    elif ingestion_only:
        agent_names = [AgentName.INGESTION.value]
    else:
        agent_names = [
            AgentName.INGESTION.value,
            AgentName.LIBRARIAN.value,
            AgentName.DRAFTER.value,
            AgentName.CITATION.value,
            AgentName.CRITIC.value,
            AgentName.ASSEMBLER.value,
        ]

    for agent_name in agent_names:
        path = prompt_path / f"{agent_name}.txt"
        file_prompt = path.read_text(encoding="utf-8").strip() if path.exists() else f"You are the {agent_name} agent."
        db_config = ADK_AGENT_DB_CONFIG.get(agent_name)
        resolved_config = (
            get_agent_config_with_defaults(
                agent_type=db_config["agent_type"],
                fallback_agent_types=db_config.get("fallback_agent_types"),
                preferred_names=db_config.get("preferred_names"),
                default_prompt=file_prompt,
            )
            if db_config
            else {"prompt": file_prompt, "model": "gemini-flash-lite-latest"}
        )
        client.create_agent(
            ADKAgentConfig(
                name=agent_name,
                system_prompt=resolved_config.get("prompt") or file_prompt,
                model=resolved_config.get("model") or "gemini-flash-lite-latest",
            )
        )

    return OrchestratorAgent(
        adk_client=client,
        flow_controller=FlowController(),
        state_manager=StateManager(),
        config=OrchestratorConfig(max_redraft_attempts=2),
    )
