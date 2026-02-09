"""
Orchestrator factory for agent flows (upload → Ingestion, retrieve → Librarian).
Shared by ingestion_routes and librarian_routes.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException


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
            AgentName.CRITIC.value,
            AgentName.ASSEMBLER.value,
        ]

    for agent_name in agent_names:
        path = prompt_path / f"{agent_name}.txt"
        system_prompt = path.read_text(encoding="utf-8").strip() if path.exists() else f"You are the {agent_name} agent."
        client.create_agent(ADKAgentConfig(name=agent_name, system_prompt=system_prompt))

    return OrchestratorAgent(
        adk_client=client,
        flow_controller=FlowController(),
        state_manager=StateManager(),
        config=OrchestratorConfig(max_redraft_attempts=2),
    )
