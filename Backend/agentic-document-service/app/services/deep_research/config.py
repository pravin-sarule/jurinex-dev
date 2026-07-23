"""Configuration for a Deep Research run.

All knobs are read from the app Settings (env-overridable) so ops can tune the
cost/quality trade-off without a code change. The defaults implement the deliberate
cheap-gather / expensive-synthesize split that lets a full 4-round run fit inside the
INR 10 budget:

    * reasoning + search rounds -> gemini-2.5-flash   (cheap, fast, still grounded)
    * final synthesis           -> gemini-2.5-pro      (quality, streamed to the user)
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DeepResearchConfig:
    reasoning_model: str        # planning + gap decisions (cheap, non-grounded)
    search_model: str           # per-round grounded web search (cheap, grounded)
    synthesis_model: str        # final grounded report (quality, streamed)
    max_rounds: int             # hard ceiling on search rounds
    budget_inr: float           # hard rupee ceiling for the WHOLE run
    synthesis_reserve_frac: float  # fraction of budget kept back for synthesis
    max_output_tokens: int      # ceiling for the synthesis output
    temperature: float = 0.2

    # Character caps on the private-context we feed each step. Feeding the whole case on
    # every round is what makes an agentic loop expensive; these keep spend predictable.
    plan_context_chars: int = 6000
    round_context_chars: int = 8000
    synth_context_chars: int = 12000

    @classmethod
    def from_settings(cls, settings, llm_config: dict | None = None) -> "DeepResearchConfig":
        llm_config = llm_config or {}
        _max = int(
            llm_config.get("max_summarization_output_tokens")
            or llm_config.get("max_output_tokens")
            or 32768
        )
        return cls(
            reasoning_model=(str(getattr(settings, "deep_research_reasoning_model", "") or "").strip()
                             or "gemini-2.5-flash"),
            search_model=(str(getattr(settings, "deep_research_search_model", "") or "").strip()
                          or "gemini-2.5-flash"),
            synthesis_model=(str(getattr(settings, "deep_research_synthesis_model", "") or "").strip()
                             or "gemini-2.5-pro"),
            max_rounds=max(1, int(getattr(settings, "deep_research_max_rounds", 4) or 4)),
            budget_inr=max(1.0, float(getattr(settings, "deep_research_budget_inr", 10.0) or 10.0)),
            synthesis_reserve_frac=min(0.9, max(0.1, float(
                getattr(settings, "deep_research_synthesis_reserve_frac", 0.6) or 0.6))),
            max_output_tokens=min(_max, 65536),
        )

    @property
    def synthesis_reserve_inr(self) -> float:
        """Rupees held back so the final report can always be written."""
        return self.budget_inr * self.synthesis_reserve_frac
