"""
ADK-Compatible Agent Base Classes for JuriNex Citation Service.

Mirrors Google ADK's Agent / LlmAgent / Tool patterns using google-genai
so the architecture is ADK-ready (swap class imports when google-adk is installed).

Pattern:  RootAgent → sub-agents via .delegate()
          Each sub-agent: run(context) → AgentResult
"""

from __future__ import annotations
import json, logging, os, re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class AgentContext:
    """Shared context passed between agents (like ADK's InvocationContext)."""
    query:        str                   = ""
    user_id:      str                   = "anonymous"
    case_id:      Optional[str]         = None
    raw_docs:     List[Dict[str,Any]]   = field(default_factory=list)
    judgement_ids:List[str]             = field(default_factory=list)
    metadata:     Dict[str, Any]        = field(default_factory=dict)


@dataclass
class AgentResult:
    """What every agent returns."""
    success:  bool           = True
    error:    Optional[str]  = None
    data:     Dict[str,Any]  = field(default_factory=dict)


class Tool:
    """ADK-compatible Tool wrapper."""
    def __init__(self, name: str, description: str, fn: Callable):
        self.name        = name
        self.description = description
        self._fn         = fn

    def run(self, **kwargs) -> Any:
        return self._fn(**kwargs)


class BaseAgent:
    """
    ADK-compatible base agent.
    Sub-class and override `run(context) -> AgentResult`.
    """
    name:        str = "base_agent"
    description: str = "Abstract base agent"

    def __init__(self):
        self._tools: List[Tool] = []

    def add_tool(self, tool: Tool):
        self._tools.append(tool)

    def get_tool(self, name: str) -> Optional[Tool]:
        return next((t for t in self._tools if t.name == name), None)

    def run(self, context: AgentContext) -> AgentResult:
        raise NotImplementedError(f"{self.__class__.__name__}.run() not implemented")

    # ── Gemini helper ────────────────────────────────────────────────────────
    def _gemini(self, prompt: str, max_tokens: int = 1024, temperature: float = 0.1) -> Optional[str]:
        """Call Gemini via google-genai SDK."""
        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            logger.warning("[%s] GOOGLE_API_KEY not set", self.name)
            return None
        try:
            from google import genai as _genai
            client = _genai.Client(api_key=api_key)
            model  = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
            resp   = client.models.generate_content(
                model=model,
                contents=prompt,
                config=_genai.types.GenerateContentConfig(
                    temperature=temperature,
                    max_output_tokens=max_tokens,
                ),
            )
            return resp.text or ""
        except Exception as e:
            logger.warning("[%s] Gemini call failed: %s", self.name, e)
            return None

    def _gemini_json(self, prompt: str, max_tokens: int = 1024) -> Optional[Dict]:
        """Call Gemini and parse JSON response."""
        text = self._gemini(prompt, max_tokens=max_tokens)
        if not text:
            return None
        text = re.sub(r"^```(?:json)?\s*", "", text.strip())
        text = re.sub(r"```\s*$", "", text)
        try:
            return json.loads(text)
        except Exception:
            # Try to extract JSON object from text
            m = re.search(r"\{.*\}", text, re.DOTALL)
            if m:
                try:
                    return json.loads(m.group(0))
                except Exception:
                    pass
        logger.warning("[%s] Could not parse Gemini JSON response", self.name)
        return None

    # ── Claude helper (Sonnet) ──────────────────────────────────────────────
    def _claude(self, prompt: str, max_tokens: int = 1024, temperature: float = 0.1, **kwargs) -> Optional[str]:
        """
        Call Claude Sonnet via Anthropic Messages API using claude_proxy.forward_to_claude.
        Accepts extra **kwargs (from llm_parameters) and merges them into the request body.
        Returns plain text content (concatenated) or None on failure.
        """
        from claude_proxy import forward_to_claude

        model = os.environ.get("CLAUDE_MODEL", "claude-3-5-sonnet-20241022")
        
        # Start with any additional kwargs from llm_parameters
        body = dict(kwargs)
        
        # Override with explicit required fields
        body["model"] = model
        body["max_tokens"] = max_tokens
        body["temperature"] = temperature
        body["messages"] = [
            {"role": "user", "content": prompt},
        ]
        
        try:
            resp = forward_to_claude(body)
        except Exception as e:
            logger.warning("[%s] Claude call failed: %s", self.name, e)
            return None

        try:
            # Anthropic Messages API: content is a list of blocks; we join all text blocks
            blocks = resp.get("content") or []
            parts: List[str] = []
            for b in blocks:
                if isinstance(b, dict) and b.get("type") == "text":
                    parts.append(b.get("text") or "")
            text = "\n".join(p for p in parts if p).strip()
            return text or None
        except Exception as e:
            logger.warning("[%s] Unexpected Claude response format: %s", self.name, e)
            return None
