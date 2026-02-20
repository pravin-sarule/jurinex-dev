"""Application entry point for Jurynex-AI orchestrator.

- For HTTP/ASGI (uvicorn, Cloud Run): use `main:app` → FastAPI from api.app
- For CLI: run `python main.py` → interactive orchestrator
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

from dotenv import load_dotenv

# Re-export for uvicorn/ASGI: uvicorn main:app
from api.app import app  # noqa: E402

from agents.orchestrator.agent import OrchestratorAgent, OrchestratorConfig
from agents.orchestrator.flow_controller import AgentName, FlowController
from agents.orchestrator.state_manager import StateManager
from services.adk_client import ADKAgentConfig, ADKClient


class MockADKClient:
    """Local mock client for testing orchestrator without ADK."""

    def run_agent(self, name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if name == AgentName.INGESTION.value:
            return {"raw_text": payload.get("raw_input", "")}
        if name == AgentName.LIBRARIAN.value:
            raw_text = payload.get("raw_text", "")
            chunks = [raw_text[i : i + 200] for i in range(0, len(raw_text), 200)] or [""]
            embeddings = [[0.0, 0.0, 0.0] for _ in chunks]
            return {"chunks": chunks, "embeddings": embeddings}
        if name == AgentName.DRAFTER.value:
            return {"draft": "DRAFT:\n" + " ".join(payload.get("chunks", []))}
        if name == AgentName.CRITIC.value:
            return {"issues": []}
        if name == AgentName.ASSEMBLER.value:
            return {"final_document": payload.get("draft", "")}
        return {}


def _load_prompt(agent_name: str) -> str:
    prompt_path = Path(__file__).resolve().parent / "instructions" / f"{agent_name}.txt"
    if not prompt_path.exists():
        return f"You are the {agent_name} agent."
    prompt = prompt_path.read_text(encoding="utf-8").strip()
    return prompt or f"You are the {agent_name} agent."


def _create_adk_client() -> ADKClient:
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise SystemExit("Missing GOOGLE_API_KEY in environment or .env file.")

    client = ADKClient(api_key=api_key, use_local_ingestion=True)
    for agent_name in [
        AgentName.INGESTION.value,
        AgentName.LIBRARIAN.value,
        AgentName.DRAFTER.value,
        AgentName.CRITIC.value,
        AgentName.ASSEMBLER.value,
    ]:
        client.create_agent(
            ADKAgentConfig(
                name=agent_name,
                system_prompt=_load_prompt(agent_name),
            )
        )
    return client


def main() -> None:
    """Run the orchestrator with user input from stdin."""
    project_root = Path(__file__).resolve().parent
    load_dotenv(project_root / ".env")

    user_input = input("Enter document instructions: ").strip()
    if not user_input:
        raise SystemExit("No input provided.")

    mode = os.getenv("JURYNEX_MODE", "adk").lower()
    if mode == "mock":
        adk_client = MockADKClient()
    else:
        adk_client = _create_adk_client()

    orchestrator = OrchestratorAgent(
        adk_client=adk_client,
        flow_controller=FlowController(),
        state_manager=StateManager(),
        config=OrchestratorConfig(max_redraft_attempts=2),
    )

    result = orchestrator.run(user_input=user_input)
    final_document = result.get("final_document") or ""

    print("\n--- Final Document ---\n")
    print(final_document)


if __name__ == "__main__":
    main()
