"""
Citation Agent: Generate citation reports from query + case context + search.

Uses Gemini for synthesis. Optionally performs Google search via Serper API for judgement discovery.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-2.0-flash"


def _search_judgements_serper(query: str, num_results: int = 5) -> List[Dict[str, Any]]:
    """Call Serper API to search for Indian law / judgement results. Returns list of {title, link, snippet}."""
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        logger.warning("SERPER_API_KEY not set; skipping web search for citation agent.")
        return []

    try:
        search_query = f"{query} Indian law judgement Supreme Court High Court site:indiankanoon.org OR site:supremecourtofindia.nic.in OR site:judgments.ecourts.gov.in"
        payload = {"q": search_query, "num": num_results}
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            "https://google.serper.dev/search",
            data=body,
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        organic = data.get("organic", [])
        return [
            {
                "title": item.get("title", ""),
                "link": item.get("link", ""),
                "snippet": item.get("snippet", ""),
            }
            for item in organic[:num_results]
        ]
    except Exception as e:
        logger.warning("Serper search failed: %s", e)
        return []


def run_citation_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the Citation agent: produce a citation report from query + case file context + search.

    Payload:
      - query (str): User's legal research question.
      - case_file_context (list, optional): List of { "name": str, "snippet" or "content": str }.
      - search_results (list, optional): Pre-fetched search hits { "title", "link", "snippet" }.
        If omitted and SERPER_API_KEY is set, the agent will run a Serper search for judgements.

    Returns:
      - report (str): Markdown citation report.
      - citations (list): Extracted sources for the frontend.
      - confidence (str): "high" | "medium" | "low".
      - error (str): Present only on failure.
    """
    query = (payload.get("query") or "").strip()
    if not query:
        return {"error": "query is required and must be non-empty", "report": "", "citations": [], "confidence": "low"}

    case_file_context: List[Dict[str, Any]] = payload.get("case_file_context") or []
    search_results: List[Dict[str, Any]] = payload.get("search_results") or []

    if not search_results:
        search_results = _search_judgements_serper(query, num_results=5)

    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {
            "error": "GOOGLE_API_KEY or GEMINI_API_KEY not set",
            "report": "",
            "citations": [],
            "confidence": "low",
        }

    # Resolve system prompt from DB → instructions/citation.txt → empty
    system_prompt = ""
    model = DEFAULT_MODEL
    temperature = 0.3
    max_tokens = 4096
    try:
        from utils.prompt_resolver import resolve_prompt
        pc = resolve_prompt(
            name="CitationAgent",
            agent_type="citation",
            default_prompt="",
            default_model=DEFAULT_MODEL,
            default_temperature=0.3,
            default_max_tokens=4096,
            file_path="instructions/citation.txt",
        )
        system_prompt = pc.prompt
        model = pc.model_name
        temperature = pc.temperature
        max_tokens = pc.max_tokens
        logger.info("[CITATION_AGENT] Prompt source=%s model=%s temp=%.2f", pc.source, model, temperature)
    except Exception as exc:
        logger.warning("[CITATION_AGENT] Prompt resolver failed (%s), trying file fallback", exc)
        try:
            instr_path = Path(__file__).resolve().parent / "instructions" / "citation.txt"
            if instr_path.exists():
                system_prompt = instr_path.read_text(encoding="utf-8").strip()
        except Exception:
            pass

    parts = [f"User query: {query}\n"]

    if case_file_context:
        parts.append("Case file context (user's attached case documents):\n")
        for i, doc in enumerate(case_file_context, 1):
            name = doc.get("name") or doc.get("filename") or f"Document {i}"
            content = doc.get("snippet") or doc.get("content") or ""
            if len(content) > 8000:
                content = content[:8000] + "\n[... truncated ...]"
            parts.append(f"[{i}] {name}:\n{content}\n")
        parts.append("\n")

    if search_results:
        parts.append("Search results (judgements / legal sources):\n")
        for i, r in enumerate(search_results, 1):
            title = r.get("title") or ""
            link = r.get("link") or ""
            snippet = r.get("snippet") or ""
            parts.append(f"[{i}] {title}\nURL: {link}\n{snippet}\n")
        parts.append("\n")
    else:
        parts.append("No external search results were provided or found. Rely on case file context only, or state that more sources are needed.\n\n")

    parts.append("Generate the citation report following the instructions. Use numbered citations [1], [2], etc. and list Sources at the end.")
    user_prompt = "\n".join(parts)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        # Start with safelist config from PromptConfig, merge explicit settings
        config_kw: Dict[str, Any] = pc.gemini_config

        if system_prompt:
            config_kw["systemInstruction"] = system_prompt
        config = types.GenerateContentConfig(**config_kw)

        response = client.models.generate_content(
            model=model,
            contents=user_prompt,
            config=config,
        )


        if not response:
            return {
                "error": "No response from model",
                "report": "",
                "citations": [],
                "confidence": "low",
            }

        text = getattr(response, "text", None) or ""
        if not text.strip():
            return {
                "error": "Empty model response",
                "report": "",
                "citations": [],
                "confidence": "low",
            }

        citations = []
        for i, r in enumerate(search_results, 1):
            citations.append({
                "index": i,
                "title": r.get("title", ""),
                "url": r.get("link", ""),
                "snippet": (r.get("snippet") or "")[:300],
            })
        for i, doc in enumerate(case_file_context, len(citations) + 1):
            citations.append({
                "index": i,
                "title": doc.get("name") or doc.get("filename") or f"Case file {i}",
                "url": doc.get("url") or "",
                "snippet": (doc.get("snippet") or doc.get("content") or "")[:300],
            })

        confidence = "high" if (search_results and len(citations) >= 2) else "medium" if citations else "low"

        return {
            "report": text.strip(),
            "citations": citations,
            "confidence": confidence,
        }
    except Exception as e:
        logger.exception("Citation agent failed: %s", e)
        return {
            "error": str(e),
            "report": "",
            "citations": [],
            "confidence": "low",
        }
