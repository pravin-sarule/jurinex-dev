"""
Central settings for the Jurinex judgement-service search pipeline.

Every credential and tunable comes from the environment (.env) — nothing
secret is hardcoded here. The .env in this folder is shared with other
Jurinex services, so unknown keys are ignored and a few names have
service-specific overrides (e.g. JUDGEMENT_API_PORT beats API_PORT).
"""

from __future__ import annotations

import json
import logging
import os
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

_ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

# Phase weight presets (Section 8 of the spec). A weight of 0 keeps the
# signal valid in the formula — it just contributes nothing until it
# turns on. Selected via SCORING_PHASE, overridable per-key with
# SCORING_WEIGHTS_JSON so tuning never needs a redeploy.
PHASE_WEIGHT_PRESETS: dict[int, dict[str, float]] = {
    1: {"semantic": 0.70, "keyword": 0.30, "authority": 0.0, "good_law": 0.0, "party": 0.0, "fact": 0.0},
    2: {"semantic": 0.40, "keyword": 0.15, "authority": 0.20, "good_law": 0.10, "party": 0.15, "fact": 0.0},
    3: {"semantic": 0.25, "keyword": 0.10, "authority": 0.25, "good_law": 0.25, "party": 0.10, "fact": 0.05},
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Indian Kanoon ---
    indian_kanoon_api_token: str | None = None
    indian_kanoon_token: str | None = None  # legacy alias, second priority

    # --- Gemini / Google AI ---
    google_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    # Model for the CLAUDE-FALLBACK analysis jobs (issue spotting, grounds/
    # fresh extraction, query generation) when the Anthropic API is exhausted
    # or unavailable — a stronger flash so fallback quality degrades less.
    # Primary Gemini jobs (classify/extract/verifier/summaries) keep
    # gemini_model.
    gemini_fallback_model: str = "gemini-3.6-flash"
    gemini_embedding_model: str = "models/gemini-embedding-001"
    embedding_dim: int = 768

    # Case material budget for the analysis stages (chars). The old hardcoded
    # 28–30k fed the issue spotter barely a dozen pages — multi-hundred-page
    # cases lost most of their documents. ~120k chars ≈ 30k tokens: trivial
    # for Gemini flash; ~$0.45/call on Claude Opus when credits allow.
    max_llm_input_chars: int = 120_000

    # --- Claude API (issue spotting + query generation + verification) ---
    anthropic_api_key: str | None = None
    judgement_claude_model: str | None = None  # wins over claude_model when set
    claude_model: str = "claude-opus-4-8"
    use_claude_for_analysis: bool = True
    # Per-judgment relevance verification runs on Claude too (stronger
    # judgment than flash on shelf/field-of-law distinctions); Sonnet keeps
    # the ~12-calls-per-issue cost sane. false → Gemini verifier.
    verifier_use_claude: bool = True
    judgement_verifier_claude_model: str = "claude-sonnet-5"
    # Concurrent verifier calls PER ISSUE. Sized so the full-doc top-N
    # verifies in ONE wave (two sequential waves used to dominate search
    # latency); issues each get their own semaphore, so total concurrency
    # is this × selected issues.
    verifier_concurrency: int = 12
    # Web-grounded good-law check (Gemini + Google Search tool) on report
    # views — detects overruling/reversal/SLP/stay that text alone cannot.
    good_law_web_check: bool = True

    @property
    def active_claude_model(self) -> str:
        return self.judgement_claude_model or self.claude_model

    @property
    def claude_enabled(self) -> bool:
        return bool(self.use_claude_for_analysis and self.anthropic_api_key)

    # --- API server ---
    api_host: str = Field(default="0.0.0.0", validation_alias="API_HOST")
    api_port: int = 8002
    judgement_api_port: int | None = None  # wins over api_port when set
    # Cloud Run injects PORT and requires the container to listen on it;
    # when present it beats every service-specific port setting.
    cloud_run_port: int | None = Field(default=None, validation_alias="PORT")
    debug: bool = False
    cors_origins: str = (
        "https://ailearn.co.in,https://www.ailearn.co.in,"
        "http://localhost:5173,http://localhost:3000,http://localhost:5000"
    )

    # --- Scoring ---
    scoring_phase: int = 1
    scoring_weights_json: str | None = None
    good_law_gate_cap: float = 0.35

    # --- Confidence bands ---
    band_green_min: float = 0.80
    band_yellow_min: float = 0.75

    # --- IK fetch behaviour ---
    ik_candidate_cap: int = 30
    ik_max_concurrency: int = 6
    ik_timeout_seconds: float = 60.0
    ik_max_retries: int = 3
    ik_full_doc_top_n: int = 10
    # Restrict every search to actual judgments of these forums (IK
    # doctypes filter). District-court noise is excluded by default;
    # empty string disables the filter entirely.
    ik_doctypes: str = "supremecourt,highcourts,tribunals"
    ik_results_per_query: int = 10

    # --- Relevance judge (LLM verification of fetched judgments) ---
    # After full texts are fetched for the top N, one grounded Gemini call
    # per issue scores how on-point each judgment REALLY is; the verdict is
    # blended into the semantic signal at this weight. 0 disables blending.
    relevance_judge_enabled: bool = True
    relevance_judge_weight: float = 0.55

    # --- Stores (all optional; service degrades gracefully) ---
    redis_url: str | None = None
    qdrant_url: str | None = None
    qdrant_api_key: str | None = None
    judgement_qdrant_collection: str = "judgement_segments_768"
    judgement_disable_neo4j: bool = True
    neo4j_uri: str | None = None
    neo4j_username: str | None = None
    neo4j_password: str | None = None
    judgement_db_url: str | None = None
    # citationTest Postgres — used when JUDGEMENT_DB_URL is not set, so all
    # sessions/results/reports/vault rows land in the citationTest database.
    citation_db_url: str | None = None

    # --- Agentic document service (the user's cases live there) ---
    agentic_document_service_url: str = "http://localhost:8092"
    # Document_DB — read-only access to file_chunks for 'file, page N' refs
    doc_db_url: str | None = None

    # --- Document AI OCR fallback (optional) ---
    gcloud_project_id: str | None = None
    document_ai_location: str = "us"
    document_ai_processor_id: str | None = None
    gcs_key_base64: str | None = None

    # --- Sessions ---
    session_ttl_seconds: int = 3600

    @property
    def ik_token(self) -> str | None:
        # Same precedence as citation-service: INDIAN_KANOON_TOKEN first
        # (verified live), INDIAN_KANOON_API_TOKEN as fallback.
        return self.indian_kanoon_token or self.indian_kanoon_api_token

    @property
    def port(self) -> int:
        return self.cloud_run_port or self.judgement_api_port or self.api_port

    @property
    def db_url(self) -> str | None:
        """Persistence DSN: JUDGEMENT_DB_URL wins, else CITATION_DB_URL
        (citationTest) so everything is stored without extra setup."""
        return self.judgement_db_url or self.citation_db_url

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def phase_weights(self) -> dict[str, float]:
        """Active composite-score weights: preset for SCORING_PHASE, then
        per-key overrides from SCORING_WEIGHTS_JSON if provided."""
        preset = dict(PHASE_WEIGHT_PRESETS.get(self.scoring_phase, PHASE_WEIGHT_PRESETS[1]))
        if self.scoring_weights_json:
            try:
                overrides = json.loads(self.scoring_weights_json)
                for key, value in overrides.items():
                    if key in preset:
                        preset[key] = float(value)
                    else:
                        logger.warning("SCORING_WEIGHTS_JSON has unknown signal %r — ignored", key)
            except (ValueError, TypeError) as exc:
                logger.error("Invalid SCORING_WEIGHTS_JSON (%s) — using phase preset", exc)
        return preset


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    # google-genai and google-adk read GOOGLE_API_KEY from the process
    # environment; make sure it is exported even when only .env had it.
    if settings.google_api_key and not os.environ.get("GOOGLE_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = settings.google_api_key
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "FALSE")
    return settings
