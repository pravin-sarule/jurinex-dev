"""Main orchestrator agent coordinating all workers."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List

from agents.orchestrator.flow_controller import AgentName, FlowController
from agents.orchestrator.state_manager import StateManager
from services.adk_client import ADKClient, ADKClientError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OrchestratorConfig:
    """Configuration for orchestrator execution."""

    max_redraft_attempts: int = 2


class OrchestratorAgent:
    """
    Coordinates all agent execution and maintains document state.

    The orchestrator is the only component that talks to the user and
    decides execution order, retries, and termination.
    """

    def __init__(
        self,
        adk_client: ADKClient,
        flow_controller: FlowController,
        state_manager: StateManager,
        config: OrchestratorConfig | None = None,
    ) -> None:
        self._adk_client = adk_client
        self._flow = flow_controller
        self._state = state_manager
        self._config = config or OrchestratorConfig()
        self._redraft_attempts = 0
        self._upload_payload: Dict[str, Any] | None = None
        self._query_payload: Dict[str, Any] | None = None
        self._assemble_payload: Dict[str, Any] | None = None
        self._agent_tasks: List[Dict[str, Any]] = []

    def run(
        self,
        user_input: str = "",
        upload_payload: Dict[str, Any] | None = None,
        query_payload: Dict[str, Any] | None = None,
        assemble_payload: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """
        Run the full orchestration pipeline.

        - When upload_payload is provided: run only the Ingestion agent.
        - When query_payload is provided: run only the Librarian agent.
        - When assemble_payload is provided: run only the Assembler agent (step-by-step assembly).
        - Otherwise: use user_input as raw_text and run the normal flow.

        Returns:
            Dict[str, Any]: Final output and state snapshot.
        """
        self._upload_payload = upload_payload
        self._query_payload = query_payload
        self._assemble_payload = assemble_payload
        ingestion_only = upload_payload is not None
        retrieve_only = query_payload is not None
        assemble_only = assemble_payload is not None
        self._agent_tasks = []  # trace: orchestrator → agent, task

        if retrieve_only:
            # Run Librarian only
            task_desc = f"fetch relevant chunks for query: {query_payload.get('query', '')[:80]}..."
            self._agent_tasks.append({
                "from": "orchestrator",
                "to": AgentName.LIBRARIAN.value,
                "task": task_desc,
                "payload_summary": {"query": query_payload.get("query"), "top_k": query_payload.get("top_k"), "file_ids": query_payload.get("file_ids")},
            })
            logger.info("Orchestrator → %s: %s", AgentName.LIBRARIAN.value, task_desc)
            librarian_response = self._run_librarian(payload_override=query_payload)
            return {
                "final_document": self._state.state.final_document,
                "state": self._state.state.snapshot(),
                "chunks": librarian_response.get("chunks", []),
                "context": librarian_response.get("context", ""),
                "agent_tasks": self._agent_tasks,
            }

        if assemble_only:
            # Run Assembler only
            task_desc = f"assemble final document for draft: {assemble_payload.get('draft_id', 'unknown')}"
            self._agent_tasks.append({
                "from": "orchestrator",
                "to": AgentName.ASSEMBLER.value,
                "task": task_desc,
                "payload_summary": {
                    "draft_id": assemble_payload.get("draft_id"),
                    "template_id": assemble_payload.get("template_id"),
                    "sections_count": len(assemble_payload.get("sections", []))
                }
            })
            logger.info("Orchestrator → %s: %s", AgentName.ASSEMBLER.value, task_desc)
            assembler_response = self._run_assembler_direct()
            return {
                "final_document": self._state.state.final_document,
                "state": self._state.state.snapshot(),
                "agent_tasks": self._agent_tasks,
                "google_docs": assembler_response.get("google_docs"),
                "metadata": assembler_response.get("metadata"),
            }

        if upload_payload is None:
            self._state.set_ingestion(raw_text=user_input or "")

        while True:
            decision = self._flow.decide_next(self._state.state)
            if decision.next_agent is None:
                break

            if decision.next_agent == AgentName.INGESTION:
                task_desc = "upload document to GCS, run Document AI (OCR), chunk, embed, store in DB"
                self._agent_tasks.append({"from": "orchestrator", "to": AgentName.INGESTION.value, "task": task_desc})
                logger.info("Orchestrator → %s: %s", AgentName.INGESTION.value, task_desc)
                self._run_ingestion()
                if ingestion_only:
                    break  # only ingestion
            elif decision.next_agent == AgentName.LIBRARIAN:
                task_desc = "fetch relevant chunks for query/evidence (vector search)"
                self._agent_tasks.append({"from": "orchestrator", "to": AgentName.LIBRARIAN.value, "task": task_desc})
                logger.info("Orchestrator → %s: %s", AgentName.LIBRARIAN.value, task_desc)
                self._run_librarian()
            elif decision.next_agent == AgentName.DRAFTER:
                self._agent_tasks.append({"from": "orchestrator", "to": AgentName.DRAFTER.value, "task": "draft document from chunks"})
                logger.info("Orchestrator → %s: draft document from chunks", AgentName.DRAFTER.value)
                self._run_drafter()
            elif decision.next_agent == AgentName.CITATION:
                self._agent_tasks.append({"from": "orchestrator", "to": AgentName.CITATION.value, "task": "add formal citations to draft"})
                logger.info("Orchestrator → %s: add formal citations to draft", AgentName.CITATION.value)
                self._run_citation()
            elif decision.next_agent == AgentName.CRITIC:
                self._agent_tasks.append({"from": "orchestrator", "to": AgentName.CRITIC.value, "task": "validate draft"})
                logger.info("Orchestrator → %s: validate draft", AgentName.CRITIC.value)
                self._run_critic()
            elif decision.next_agent == AgentName.ASSEMBLER:
                self._agent_tasks.append({"from": "orchestrator", "to": AgentName.ASSEMBLER.value, "task": "assemble final document"})
                logger.info("Orchestrator → %s: assemble final document", AgentName.ASSEMBLER.value)
                self._run_assembler()

        return {
            "final_document": self._state.state.final_document,
            "state": self._state.state.snapshot(),
            "agent_tasks": self._agent_tasks,
        }

    def _run_ingestion(self) -> None:
        payload: Dict[str, Any]
        if getattr(self, "_upload_payload", None) is not None:
            payload = self._upload_payload
            self._upload_payload = None
        else:
            payload = {"raw_input": self._state.state.raw_text or ""}

        try:
            response = self._adk_client.run_agent(
                AgentName.INGESTION.value,
                payload,
            )
        except ADKClientError as exc:
            raise RuntimeError("Ingestion agent failed.") from exc

        raw_text = response.get("raw_text")
        if raw_text is None:
            raise RuntimeError("Ingestion agent returned no raw_text.")
        file_id = response.get("file_id")
        self._state.set_ingestion(raw_text=raw_text or "", file_id=file_id)

        # If ingestion already produced chunks and embeddings (full pipeline), set them to skip librarian
        chunks = response.get("chunks")
        embeddings = response.get("embeddings")
        if chunks and embeddings and len(chunks) == len(embeddings):
            self._state.set_embeddings(chunks=chunks, embeddings=embeddings)

    def _run_librarian(self, payload_override: Dict[str, Any] | None = None) -> Dict[str, Any]:
        """Run Librarian: it only fetches relevant chunks and reports to orchestrator; no content generation."""
        payload: Dict[str, Any]
        if payload_override is not None:
            payload = payload_override
        else:
            payload = {"raw_text": self._state.state.raw_text or ""}
        try:
            response = self._adk_client.run_agent(
                AgentName.LIBRARIAN.value,
                payload,
            )
        except ADKClientError as exc:
            raise RuntimeError("Librarian agent failed.") from exc

        chunks = response.get("chunks", [])
        embeddings = response.get("embeddings", [])
        # Librarian only fetches chunks (no generation); returns list of dicts with "content"
        chunk_contents: List[str] = []
        for c in chunks:
            if isinstance(c, dict) and "content" in c:
                chunk_contents.append(c["content"] or "")
            elif isinstance(c, str):
                chunk_contents.append(c)
        # Allow 0 chunks when draft has no case and no uploaded files (draft-scoped retrieve)
        self._state.set_embeddings(chunks=chunk_contents, embeddings=embeddings or [])
        return response

    def _run_drafter(self) -> None:
        try:
            response = self._adk_client.run_agent(
                AgentName.DRAFTER.value,
                {
                    "chunks": self._state.state.chunks,
                    "embeddings": self._state.state.embeddings,
                },
            )
        except ADKClientError as exc:
            raise RuntimeError("Drafter agent failed.") from exc

        draft = response.get("draft")
        if not draft:
            raise RuntimeError("Drafter agent returned empty draft.")
        self._state.set_draft(draft=draft)

    def _run_citation(self) -> None:
        """Run Citation agent: add formal citations to drafted content."""
        try:
            response = self._adk_client.run_agent(
                AgentName.CITATION.value,
                {
                    "draft": self._state.state.draft or "",
                    "chunks": self._state.state.chunks,
                    "embeddings": self._state.state.embeddings,
                },
            )
        except ADKClientError as exc:
            raise RuntimeError("Citation agent failed.") from exc

        content_with_citations = response.get("content_html")
        citations = response.get("citations", [])

        if not content_with_citations:
            logger.warning("Citation agent returned no content; using original draft")
            self._state.set_citations(self._state.state.draft or "", [])
        else:
            self._state.set_citations(content_with_citations, citations)

    def _run_critic(self) -> None:
        try:
            response = self._adk_client.run_agent(
                AgentName.CRITIC.value,
                {"draft": self._state.state.draft or ""},
            )
        except ADKClientError as exc:
            raise RuntimeError("Critic agent failed.") from exc

        issues = response.get("issues", [])
        if not isinstance(issues, list):
            raise RuntimeError("Critic agent returned invalid issues list.")
        self._state.set_validation([str(issue) for issue in issues])

        if self._state.state.validated:
            return

        self._redraft_attempts += 1
        if self._redraft_attempts > self._config.max_redraft_attempts:
            raise RuntimeError("Maximum re-drafting attempts exceeded.")

        self._state.reset_validation()
        self._run_drafter()
        self._run_critic()

    def _run_assembler(self) -> Dict[str, Any]:
        try:
            response = self._adk_client.run_agent(
                AgentName.ASSEMBLER.value,
                {"draft": self._state.state.draft or ""},
            )
        except ADKClientError as exc:
            raise RuntimeError("Assembler agent failed.") from exc

        final_document = response.get("final_document")
        if not final_document:
            raise RuntimeError("Assembler agent returned empty output.")
        self._state.set_final_document(final_document)
        return response

    def _run_assembler_direct(self) -> Dict[str, Any]:
        """Run Assembler with structured assembly payload (step-by-step)."""
        if not self._assemble_payload:
            raise RuntimeError("No assemble_payload provided.")

        try:
            response = self._adk_client.run_agent(
                AgentName.ASSEMBLER.value,
                self._assemble_payload,
            )
        except ADKClientError as exc:
            raise RuntimeError("Assembler agent failed.") from exc

        final_document = response.get("final_document")
        if not final_document:
            # If assembler fails to return something meaningful, we fallback to sections joining
            # but usually the assembler agent should handle this logically.
            sections = self._assemble_payload.get("sections", [])
            final_document = "\n\n".join([s.get("content", "") for s in sections])
            
        self._state.set_final_document(final_document)
        return response
