"""Google ADK client wrapper used by orchestrator and agents."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional
import logging

# Initialize the logger for this module
logger = logging.getLogger(__name__)

class ADKClientError(RuntimeError):
    """Raised when ADK client operations fail."""


@dataclass(frozen=True)
class ADKAgentConfig:
    """Configuration used to construct ADK agents."""

    name: str
    system_prompt: str
    model: str = "gemini-flash-lite-latest"


class ADKClient:
    """
    Minimal, production-friendly wrapper around Google ADK (Gemini).

    This wrapper centralizes agent creation and execution using Google's ADK.
    
    Agent modes:
    - Ingestion: Uses local Python pipeline (GCS → Document AI → chunk → embed → DB)
      No LLM needed as it's pure data processing.
    - Librarian: Uses local Python retrieval (vector search → return chunks)
      No LLM needed as it's pure retrieval.
    - Drafter, Critic, Assembler: Use Google ADK with Gemini LLM for content generation
      and validation. These agents use the Gemini model for intelligent processing.
    
    All agents are registered with their instructions from the instructions/ folder.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        use_local_ingestion: bool = True,
        use_local_librarian: bool = True,
        use_local_citation: bool = True,
        use_local_drafter: bool = False,
        use_local_critic: bool = False,
        use_local_assembler: bool = False,
    ) -> None:
        """
        Initialize ADK client.

        Args:
            api_key: Google API key for Gemini. If None, uses default from environment.
            use_local_ingestion: If True, use local pipeline instead of LLM (recommended: True)
            use_local_librarian: If True, use local retrieval instead of LLM (recommended: True)
            use_local_citation: If True, use local citation agent instead of LLM (recommended: True)
            use_local_drafter: If True, use local mock instead of Gemini (for testing only)
            use_local_critic: If True, use local mock instead of Gemini (for testing only)
            use_local_assembler: If True, use local mock instead of Gemini (for testing only)
        """
        self._api_key = api_key
        self._agents: Dict[str, Any] = {}
        self._use_local_ingestion = use_local_ingestion
        self._use_local_librarian = use_local_librarian
        self._use_local_citation = use_local_citation
        self._use_local_drafter = use_local_drafter
        self._use_local_critic = use_local_critic
        self._use_local_assembler = use_local_assembler

    def create_agent(self, config: ADKAgentConfig) -> None:
        """
        Create and register an ADK agent with Google Gemini.

        For local mode agents (ingestion, librarian by default), registers a placeholder
        so run_agent uses the local Python implementation instead of calling Gemini.
        
        For LLM agents (drafter, critic, assembler), creates a Google ADK agent with
        the specified system prompt and Gemini model.
        """
        if config.name in self._agents:
            return

        # Local mode agents (tool-based, no LLM needed)
        if config.name == "ingestion" and self._use_local_ingestion:
            self._agents[config.name] = None  # placeholder; run_agent uses local pipeline
            return
        if config.name == "librarian" and self._use_local_librarian:
            self._agents[config.name] = None  # placeholder; run_agent uses local retrieval
            return
        if config.name == "citation" and self._use_local_citation:
            self._agents[config.name] = None  # placeholder; run_agent uses local citation agent
            return
        if config.name == "drafter" and self._use_local_drafter:
            self._agents[config.name] = None  # placeholder for testing
            return
        if config.name == "critic" and self._use_local_critic:
            self._agents[config.name] = None  # placeholder for testing
            return
        if config.name == "assembler" and self._use_local_assembler:
            self._agents[config.name] = None  # placeholder for testing
            return

        # Create Google ADK agent with Gemini
        try:
            from google import genai  # type: ignore
        except Exception as exc:  # pragma: no cover - runtime check
            raise ADKClientError(
                "Google ADK SDK (google-genai) is not installed. "
                "Run: pip install google-genai"
            ) from exc

        try:
            client = genai.Client(api_key=self._api_key) if self._api_key else genai.Client()
            
            # Check if 'agents' attribute exists (depends on SDK version)
            if not hasattr(client, "agents"):
                logger.warning("GenAI Client does not have 'agents' attribute. Skipping agent creation for %s", config.name)
                # If we're not using local mode but agents are missing, we might have a problem later
                # but let's not crash here.
                self._agents[config.name] = None
                return

            agent = client.agents.create(
                name=config.name,
                model=config.model,
                system_prompt=config.system_prompt,
            )
        except Exception as exc:  # pragma: no cover - runtime check
            logger.exception("Failed to create Google ADK agent '%s'", config.name)
            raise ADKClientError(
                f"Failed to create Google ADK agent '{config.name}'. "
                f"Check your GOOGLE_API_KEY and internet connection. Error: {exc}"
            ) from exc

        self._agents[config.name] = agent

    def run_agent(self, name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute an agent with a JSON-like payload.

        For local mode agents (ingestion, librarian), runs Python implementation.
        For Google ADK agents (drafter, critic, assembler), calls Gemini LLM.

        Returns:
            Dict[str, Any]: Structured response from the agent.
        """
        # Ingestion: Local Python pipeline (GCS → Document AI → chunk → embed → DB)
        if name == "ingestion" and self._use_local_ingestion:
            try:
                from agents.ingestion.agent import run_ingestion_agent
                result = run_ingestion_agent(payload)
                if result.get("error"):
                    raise ADKClientError(result["error"])
                return result
            except ADKClientError:
                raise
            except Exception as exc:
                raise ADKClientError(f"Ingestion pipeline failed: {exc}") from exc

        # Librarian: Local Python retrieval (vector search)
        if name == "librarian" and self._use_local_librarian:
            try:
                from agents.librarian.agent import run_librarian_agent
                result = run_librarian_agent(payload)
                if result.get("error"):
                    raise ADKClientError(result["error"])
                return result
            except ADKClientError:
                raise
            except Exception as exc:
                raise ADKClientError(f"Librarian retrieval failed: {exc}") from exc

        # Citation: Local Python citation agent (Gemini-powered tools)
        if name == "citation" and self._use_local_citation:
            try:
                from agents.citation.agent import run_citation_agent
                result = run_citation_agent(payload)
                if result.get("error"):
                    raise ADKClientError(result["error"])
                return result
            except ADKClientError:
                raise
            except Exception as exc:
                raise ADKClientError(f"Citation agent failed: {exc}") from exc

        # Drafter: Local mock (for testing only)
        if name == "drafter" and self._use_local_drafter:
            try:
                from agents.drafter.agent import run_drafter_agent
                result = run_drafter_agent(payload)
                if result.get("error"):
                    raise ADKClientError(result["error"])
                return result
            except ADKClientError:
                raise
            except Exception as exc:
                raise ADKClientError(f"Drafter mock failed: {exc}") from exc

        # Critic: Local mock (for testing only)
        if name == "critic" and self._use_local_critic:
            try:
                from agents.critic.agent import run_critic_agent
                result = run_critic_agent(payload)
                if result.get("error"):
                    raise ADKClientError(result["error"])
                return result
            except ADKClientError:
                raise
            except Exception as exc:
                raise ADKClientError(f"Critic mock failed: {exc}") from exc

        # Assembler: Local mock (for testing only)
        if name == "assembler" and self._use_local_assembler:
            try:
                from agents.assembler.agent import run_assembler_agent
                result = run_assembler_agent(payload)
                if result.get("error"):
                    raise ADKClientError(result["error"])
                return result
            except ADKClientError:
                raise
            except Exception as exc:
                raise ADKClientError(f"Assembler mock failed: {exc}") from exc

        # Google ADK agent (Gemini LLM)
        agent = self._agents.get(name)
        if agent is None:
            raise ADKClientError(
                f"Agent '{name}' is not registered. "
                f"Call create_agent() first with proper configuration."
            )

        try:
            response = agent.run(payload)
        except Exception as exc:  # pragma: no cover - runtime check
            raise ADKClientError(
                f"Google ADK agent '{name}' execution failed. "
                f"Error: {exc}"
            ) from exc

        if not isinstance(response, dict):
            raise ADKClientError(
                f"Agent '{name}' returned unexpected response type: {type(response)}"
            )

        return response
