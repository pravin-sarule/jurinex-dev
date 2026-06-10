from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from app.schemas.contracts import DocumentReference, DocumentType
from app.services.llm_chat_config import get_summarization_chat_config, resolve_model_name
from app.services.token_usage_log import log_token_usage_table

logger = logging.getLogger("agentic_document_service.document_ai")
DEFAULT_MAX_OUTPUT_TOKENS = 65536
DEEPSEEK_MAX_OUTPUT_TOKENS = 384000

_MARKDOWN_RENDERING_CONTRACT = """
OUTPUT RENDERING CONTRACT:
- Return GitHub-Flavored Markdown only. Do not wrap the whole answer in a markdown code fence.
- Use clear headings, short paragraphs, bullets, and numbered lists where appropriate.
- CRITICAL: When source data is comparative, chronological, evidentiary, financial, or otherwise tabular (including numbered proceedings lists, schedules, S.No / date / description rows, or any list with consistent columns), you MUST reconstruct it as a proper Markdown table — do NOT present it as a flat paragraph or bullet list.
- Infer column headers from context if the source document headers are unclear or poorly OCR'd.
- Every Markdown table MUST include a header row and a valid separator row, for example:
  | S.No | Date | Description | Reference |
  |---|---|---|---|
- Keep every table row on one physical line. Replace line breaks inside cells with spaces.
- Escape literal pipe characters inside table cells as \\|.
- Do not emit HTML tables.
""".strip()

_JSON_RENDERING_CONTRACT = """
OUTPUT RENDERING CONTRACT:
- Return valid JSON only, matching the requested structure. Do not add explanations before or after the JSON.
- When a JSON string value contains comparative, chronological, evidentiary, financial, or otherwise tabular data, represent it as a GitHub-Flavored Markdown table inside that string value.
- Every Markdown table inside a JSON string value MUST include a header row and a valid separator row (e.g. | Date | Event | Source |\\n|---|---|---|).
- Keep every table row on one physical line inside the JSON string; replace cell-internal newlines with spaces.
- Also use bold, italic, and bullet lists inside JSON string values to preserve rich structure from source documents.
- Do not emit HTML tables anywhere in the JSON.
""".strip()
_gemini_extract_unavailable_logged = False
_gemini_qa_unavailable_logged = False
_SPEAKER_LINE_RE = re.compile(r"\[\s*Speaker\s+([^\]]+?)\s*\]\s*:\s*(.+)", re.IGNORECASE)

# Internal agent names used for document AI operations
_AGENT_EXTRACTION = "form_population_agent"
_AGENT_QA = "grounded_retrieval_agent"

# Public name for routes that must use the same agent as document Q&A (folder chat SSE, etc.).
GROUNDED_RETRIEVAL_AGENT_NAME = _AGENT_QA

_EXTRACTION_PROMPT = """You are an expert legal document analyst specialised in Indian court documents. Extract ALL case information from the document using semantic understanding and intelligent field matching.

INSTRUCTIONS:
1. Read the entire document carefully and understand the context
2. Look for fields even if they are written with different names, synonyms, or abbreviations
3. Use semantic understanding to match field names - for example:
   - "Case Title" could be: "Title", "Subject Matter", "Matter Title", "Case Name", "Cause Title", "Petition Title"
   - "Case Number" could be: "Case No.", "Suit No.", "Petition No.", "Application No.", "Writ Petition No.", "Criminal Case No."
   - "Court" could be: "Court Name", "Forum", "Adjudicating Forum", "Court of", "Before", "Hon'ble Court"
   - "Jurisdiction" could be: "Jurisdiction", "Adjudicating Authority", "Territorial Jurisdiction", "Jurisdictional Area"
   - "Petitioner" could be: "Petitioner", "Plaintiff", "Applicant", "Appellant", "Complainant", "Party"
   - "Respondent" could be: "Respondent", "Defendant", "Opposite Party", "Opponent", "Accused"
   - "Filing Date" could be: "Date of Filing", "Date Filed", "Filed On", "Instituted On", "Registration Date"
   - "Hearing Date" could be: "Next Date", "Next Date of Hearing", "Date of Hearing", "Listed On", "Posted On"
   - "Judge" could be: "Judge", "Hon'ble Justice", "Hon'ble Judge", "Bench", "Presiding Officer"

4. Extract ALL available information - be thorough and comprehensive
5. For dropdown fields (caseType, jurisdiction, courtName, etc.), extract the EXACT value even if written differently
6. For dates, convert to YYYY-MM-DD format
7. For monetary values, extract numeric value only (remove currency symbols, commas)
8. For arrays (petitioners, respondents, judges), extract ALL entries

⚠️  CRITICAL — DO NOT EXTRACT LABELS AS NAMES:
Indian court documents use structural label headings like "PETITIONER", "RESPONDENT", "PLAINTIFF",
"DEFENDANT", "APPELLANT", "COMPLAINANT", "APPLICANT", "ACCUSED", "OPPOSITE PARTY" as column/section
headers — these are NOT the actual party names.
Rules:
  a. NEVER use a bare label word ("PETITIONER", "RESPONDENT", etc.) as a fullName or in caseTitle.
  b. The ACTUAL name appears immediately after the label (on the same line or next line).
     Example in document:  "PETITIONER : Rajesh Kumar Sharma"  → fullName = "Rajesh Kumar Sharma"
     Example in document:  "PETITIONER\nRajesh Kumar Sharma"   → fullName = "Rajesh Kumar Sharma"
  c. If a document title heading reads "PETITIONER vs State of Maharashtra" that means the actual
     petitioner name was not captured yet — look elsewhere in the document for the real name and use it.
  d. "The State" must always be combined: "The State of Maharashtra", "State of Maharashtra & Others", etc.
  e. For caseTitle NEVER generate "PETITIONER vs X" — always replace label words with the real person/entity name.

EXTRACT THE FOLLOWING FIELDS:
{
  "caseTitle": "ACTUAL party names in 'Petitioner Full Name vs Respondent Full Name' format — never use label words like PETITIONER/RESPONDENT as names",
  "caseNumber": "Case number (Case No., Suit No., Petition No., WP No., Criminal Case No.)",
  "casePrefix": "Case prefix like WP, CR, WP(C), SLP, etc.",
  "caseYear": "Year from case number or filing date (YYYY format)",
  "caseType": "Type of case (Civil, Criminal, Writ, Arbitration, etc.)",
  "caseNature": "Case nature (Civil, Criminal, Constitutional/Writ, Arbitration, Commercial, etc.)",
  "subType": "Subtype or category of the case",
  "courtName": "Full court name",
  "courtLevel": "Court level (High Court, District Court, Supreme Court, etc.)",
  "benchDivision": "Bench or division name (e.g., Aurangabad Bench, Principal Bench, Mumbai Bench)",
  "jurisdiction": "Jurisdiction or Adjudicating Authority (territorial area)",
  "state": "State name if mentioned",
  "filingDate": "Filing date in YYYY-MM-DD format",
  "judges": ["Array of judge names"],
  "courtRoom": "Court room number if mentioned",
  "petitioners": [{"fullName": "Petitioner/Plaintiff name (REQUIRED)", "role": "Individual/Company/Government", "advocateName": "Advocate name", "barRegistration": "", "contact": ""}],
  "respondents": [{"fullName": "Respondent/Defendant name (REQUIRED)", "role": "Individual/Company/Government", "advocateName": "Advocate name", "barRegistration": "", "contact": ""}],
  "categoryType": "Category type if mentioned",
  "primaryCategory": "Primary category",
  "subCategory": "Sub category",
  "complexity": "Complexity level (Simple, Medium, Complex)",
  "monetaryValue": "Monetary value (numeric only)",
  "priorityLevel": "Priority level (Low, Medium, High)",
  "currentStatus": "Current status (Active, Pending, Closed, Disposed, etc.)",
  "nextHearingDate": "Next hearing date in YYYY-MM-DD format",
  "documentType": "Type of document (Petition, Affidavit, Notice, Order, etc.)",
  "filedBy": "Who filed the case (Plaintiff, Defendant, Both, or advocate name)"
}

Return ONLY valid JSON without markdown formatting. If a field is not found, use null or empty string.

=== DOCUMENT CONTENT ===
"""


@dataclass(slots=True)
class ExtractionResult:
    text: str
    entities: dict[str, str]
    confidence_by_field: dict[str, float]
    quality_score: float


# ── Provider detection ────────────────────────────────────────────────────────

def _model_tail_lower(model_name: str) -> str:
    """Last path segment, lowercased (handles anthropic/claude-4-6, models/claude-*, etc.)."""
    s = (model_name or "").strip()
    if not s:
        return ""
    if "/" in s:
        s = s.split("/")[-1].strip()
    return s.lower()


def _detect_provider(model_name: str) -> str:
    """
    Detect the LLM provider from the model name string (from agent_prompts → llm_models.name).
    Returns 'gemini', 'claude', or 'deepseek'.
    Uses the last path segment so DB values like 'anthropic/claude-sonnet-4-20250514' route to Claude.
    Default is 'gemini' for unknown names.
    """
    tail = _model_tail_lower(model_name)
    if tail.startswith("claude"):
        return "claude"
    if tail.startswith("deepseek"):
        return "deepseek"
    return "gemini"


def _anthropic_messages_model_id(model_name: str) -> str:
    """Anthropic Messages API expects 'claude-...' without vendor or URI prefix."""
    s = (model_name or "").strip()
    if not s:
        return s
    if "/" in s:
        return s.split("/")[-1].strip()
    return s


def _deepseek_model_id(model_name: str) -> str:
    """Return the bare model id expected by DeepSeek API (strip any vendor/ prefix)."""
    s = (model_name or "").strip()
    if not s:
        return s
    if "/" in s:
        return s.split("/")[-1].strip()
    return s


# ── API clients ───────────────────────────────────────────────────────────────

def _gemini_client():
    """Return a configured google.genai Client, or None if unavailable."""
    try:
        from google import genai  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().gemini_api_key
        if not api_key:
            return None
        return genai.Client(api_key=api_key)
    except Exception:
        return None


def _anthropic_client():
    """Return a configured anthropic.Anthropic client, or None if unavailable."""
    try:
        import anthropic as _anthropic  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().anthropic_api_key
        if not api_key:
            logger.warning("[DocumentAI] ANTHROPIC_API_KEY is not set — Claude calls will fail")
            return None
        return _anthropic.Anthropic(api_key=api_key)
    except ImportError:
        logger.warning("[DocumentAI] anthropic package not installed — run: pip install anthropic>=0.40.0")
        return None
    except Exception as exc:
        logger.warning("[DocumentAI] Anthropic client init failed: %s", exc)
        return None


def _deepseek_client():
    """Return an OpenAI-compatible client configured for DeepSeek API, or None if unavailable."""
    try:
        import openai  # type: ignore
        from app.core.config import get_settings

        api_key = get_settings().deepseek_api_key
        if not api_key:
            logger.warning("[DocumentAI] DEEPSEEK_API_KEY is not set — DeepSeek calls will fail")
            return None
        return openai.OpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com",
            timeout=600.0,
            max_retries=2,
        )
    except ImportError:
        logger.warning("[DocumentAI] openai package not installed — run: pip install openai")
        return None
    except Exception as exc:
        logger.warning("[DocumentAI] DeepSeek client init failed: %s", exc)
        return None


def _deepseek_expects_json(prompt: str, llm_params: dict) -> bool:
    if llm_params.get("structured_outputs_enabled"):
        return True
    prompt_lower = str(prompt or "").lower()
    # Only trigger JSON mode when the FORMATTING INSTRUCTIONS explicitly request JSON output.
    # Check for the critical output formatting block injected by secret_prompt_display /
    # addSecretPromptJsonFormatting — not just any occurrence of "```json" in document content.
    json_instruction_markers = (
        "response must be valid json",
        "return valid json",
        "output must be valid json",
        "absolute requirement: your response must be valid json",
        "critical output formatting requirements",
    )
    return any(marker in prompt_lower for marker in json_instruction_markers)


_DEEPSEEK_JSON_MODE_SUFFIX = (
    "\n\n"
    "IMPORTANT (DeepSeek JSON mode): respond with raw JSON only — no markdown wrapper. "
    "Use Markdown formatting (tables, bold, lists) inside JSON string values where the data is structured or tabular."
)


def _deepseek_output_contract(prompt: str, llm_params: dict) -> str:
    if _deepseek_expects_json(prompt, llm_params):
        return _JSON_RENDERING_CONTRACT + _DEEPSEEK_JSON_MODE_SUFFIX
    return _MARKDOWN_RENDERING_CONTRACT


def _deepseek_messages(prompt: str, llm_params: dict) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    sys_instr = str(llm_params.get("system_instructions") or "").strip()
    rendering_contract = _deepseek_output_contract(prompt, llm_params)
    combined_system = "\n\n".join(part for part in (sys_instr, rendering_contract) if part)
    if combined_system:
        messages.append({"role": "system", "content": combined_system})
    messages.append({"role": "user", "content": prompt})
    return messages


def normalize_markdown_render_output(text: str) -> str:
    """Remove provider-added outer Markdown fences while preserving inner code blocks."""
    cleaned = str(text or "").strip()
    match = re.fullmatch(r"```(?:markdown|md)?\s*\n([\s\S]*?)\n```", cleaned, flags=re.IGNORECASE)
    return match.group(1).strip() if match else cleaned


def _max_tokens_from_summarization_config(config: dict, *, for_summary: bool) -> int:
    """Compute effective max_output_tokens from a merged summarization_chat_config dict."""
    max_tokens = int(
        config.get("max_summarization_output_tokens") if for_summary
        else (config.get("max_output_tokens") or 0)
    )
    max_cap = max(1, int(config.get("max_output_tokens_cap") or DEFAULT_MAX_OUTPUT_TOKENS))
    min_tokens = max(1, int(config.get("min_output_tokens") or 1))
    if max_tokens <= 0:
        max_tokens = DEFAULT_MAX_OUTPUT_TOKENS
    return max(min_tokens, min(max_tokens, max_cap))


def _int_or_default(value: Any, default: int) -> int:
    try:
        n = int(value)
        return n if n > 0 else default
    except (TypeError, ValueError):
        return default


def _max_tokens_from_agent_prompt(cfg: Any, llm_params: dict, *, for_summary: bool) -> int:
    """
    Resolve max_output_tokens strictly from agent_prompts row data.
    Priority:
      1) llm_parameters.max_summarization_output_tokens (summary calls only)
      2) llm_parameters.max_output_tokens
      3) llm_parameters.max_tokens
      4) service default (65536)
    """
    default_tokens = DEFAULT_MAX_OUTPUT_TOKENS
    cap = _int_or_default(llm_params.get("max_output_tokens_cap"), DEFAULT_MAX_OUTPUT_TOKENS)
    min_tokens = _int_or_default(llm_params.get("min_output_tokens"), 1)
    if min_tokens > cap:
        min_tokens, cap = cap, min_tokens

    candidates: list[Any] = []
    if for_summary:
        candidates.append(llm_params.get("max_summarization_output_tokens"))
    candidates.extend(
        [
            llm_params.get("max_output_tokens"),
            llm_params.get("max_tokens"),
        ]
    )
    resolved = default_tokens
    for value in candidates:
        n = _int_or_default(value, 0)
        if n > 0:
            resolved = n
            break
    return max(min_tokens, min(resolved, cap))


def _describe_agent_prompts_origin(cfg: Any) -> str:
    """Log line: whether the agent row was loaded from public.agent_prompts."""
    if getattr(cfg, "source", None) == "db" and getattr(cfg, "db_id", None) is not None:
        return (
            f"from_db table=agent_prompts row_id={cfg.db_id} "
            f"agent_type={getattr(cfg, 'agent_type', '') or 'n/a'}"
        )
    if getattr(cfg, "source", None) == "db":
        return "from_db table=agent_prompts (row_id missing)"
    return "not_from_db (no agent_prompts row; using settings.adk_model + defaults)"


def _describe_summarization_token_origin(token_cfg: dict, *, caller_supplied: bool) -> str:
    """Log line: where token limits dict came from (DB vs fallback vs caller merge)."""
    scope = (token_cfg or {}).get("summarization_config_scope")
    cid = (token_cfg or {}).get("config_id")
    if caller_supplied:
        if scope in ("user_merged", "global"):
            return (
                f"from_db table=summarization_chat_config (request merge) "
                f"scope={scope} config_id={cid}"
            )
        if scope in ("fallback_no_db", "fallback_error"):
            return f"not_from_db scope={scope} (request merge)"
        return "caller_merge (effective limits; may include DB + request overrides)"
    if scope in ("fallback_no_db", "fallback_error"):
        return f"not_from_db scope={scope}"
    if scope in ("user_merged", "global"):
        return f"from_db table=summarization_chat_config scope={scope} config_id={cid}"
    return f"from_db table=summarization_chat_config config_id={cid} scope={scope or 'n/a'}"


def _describe_summarization_full_origin(config: dict, *, caller_supplied: bool) -> str:
    """Log line: origin of summarization dict when it drives model + temperature + tokens (no-agent path)."""
    scope = (config or {}).get("summarization_config_scope")
    cid = (config or {}).get("config_id")
    if caller_supplied:
        if scope in ("user_merged", "global"):
            return (
                f"from_db table=summarization_chat_config (request merge) "
                f"scope={scope} config_id={cid}"
            )
        if scope in ("fallback_no_db", "fallback_error"):
            return f"not_from_db scope={scope} (request merge)"
        return "caller_merge (model/temp/tokens; may include DB + overrides)"
    if scope in ("fallback_no_db", "fallback_error"):
        return f"not_from_db scope={scope}"
    return f"from_db table=summarization_chat_config scope={scope or 'n/a'} config_id={cid}"


def _generation_config(
    *,
    for_summary: bool = False,
    agent_name: str | None = None,
    user_id: str | int | None = None,
    summarization_llm_config: dict | None = None,
    model_name_override: str | None = None,
) -> tuple[str, dict, dict]:
    """
    Build (model_name, gen_kwargs, llm_params) for a Gemini call.

    When `agent_name` is set:
      - Model, temperature, and llm_parameters (tools, thinking, etc.) come from agent_prompts
        (or agent defaults when no DB row).
      - max_output_tokens comes from agent_prompts.llm_parameters (with safe defaults).
      - prompt from agent_prompts.prompt is injected as system_instructions unless
        llm_parameters.system_instructions is explicitly set.

    When `agent_name` is None (no agent context):
      - Model, temperature, and max_output_tokens all come from summarization_chat_config.

    Returns three values:
      model_name  — string model id
      gen_kwargs  — core generation params (temperature, max_output_tokens)
      llm_params  — full llm_parameters blob from DB (tool flags, thinking, etc.)
    """
    if agent_name:
        try:
            from app.services.agent_config_service import get_agent_config

            cfg = get_agent_config(agent_name)
            llm_params = dict(cfg.llm_parameters or {})
            # Always honor agent_prompts.prompt as system instruction when llm_parameters does not override it.
            if not str(llm_params.get("system_instructions") or "").strip():
                prompt_text = str(getattr(cfg, "prompt", "") or "").strip()
                if prompt_text:
                    llm_params["system_instructions"] = prompt_text

            max_tokens = _max_tokens_from_agent_prompt(cfg, llm_params, for_summary=for_summary)
            gen_kwargs: dict = {
                "temperature": float(cfg.temperature),
                "max_output_tokens": max_tokens,
            }
            logger.info(
                "[DocumentAI] generation_config  agent_prompts=%s  tokens=from_agent_prompts  "
                "agent=%s  model=%s  temperature=%.2f  max_output_tokens=%s  "
                "url_context=%s  grounding_search=%s  code_execution=%s",
                _describe_agent_prompts_origin(cfg),
                agent_name,
                cfg.model_name,
                gen_kwargs["temperature"],
                max_tokens,
                llm_params.get("url_context", False),
                llm_params.get("grounding_google_search", False),
                llm_params.get("code_execution", False),
            )
            resolved_model_name = str(model_name_override or cfg.model_name).strip()
            return resolved_model_name, gen_kwargs, llm_params
        except Exception as exc:
            logger.warning(
                "[DocumentAI] agent_config_service failed for agent=%s: %s "
                "— falling back to summarization_chat_config",
                agent_name,
                exc,
            )

    # ── Fallback: summarization_chat_config (no agent_name or agent load error) ──
    config = summarization_llm_config or get_summarization_chat_config(user_id=user_id)
    model_name = resolve_model_name(config, for_summary=for_summary) or "gemini-2.0-flash"
    model_name = str(model_name_override or model_name).strip()
    max_tokens = _max_tokens_from_summarization_config(config, for_summary=for_summary)
    temperature = float(config.get("model_temperature") or 0.7)
    temperature = min(
        max(temperature, float(config.get("temperature_min") or 0.0)),
        float(config.get("temperature_max") or 2.0),
    )
    logger.info(
        "[DocumentAI] generation_config  summarization_full=%s  agent=%s  "
        "model=%s  temperature=%.2f  max_output_tokens=%d",
        _describe_summarization_full_origin(
            config,
            caller_supplied=summarization_llm_config is not None,
        ),
        agent_name or "N/A",
        model_name,
        temperature,
        max_tokens,
    )
    return model_name, {"temperature": temperature, "max_output_tokens": max_tokens}, {}


# ── Thinking level → token budget ─────────────────────────────────────────────

_THINKING_BUDGET_GEMINI = {"low": 1024,  "medium": 8192,  "high": 16384}
_THINKING_BUDGET_CLAUDE = {"low": 5000,  "medium": 10000, "high": 16000}


def _resolve_thinking_budget(llm_params: dict, provider: str) -> int:
    budget_map = _THINKING_BUDGET_GEMINI if provider == "gemini" else _THINKING_BUDGET_CLAUDE
    raw = llm_params.get("thinking_budget")
    if raw and isinstance(raw, (int, float)) and float(raw) > 0:
        return int(raw)
    level = str(llm_params.get("thinking_level") or "low").lower()
    return budget_map.get(level, list(budget_map.values())[0])


def _gemini_model_supports_thinking_config(model_name: str | None) -> bool:
    """
    Native Gemini ThinkingConfig is only accepted on certain models; others return 400
    INVALID_ARGUMENT ("thinking is not supported by this model"), e.g. gemini-2.0-flash.
    """
    raw = (model_name or "").strip().lower()
    if not raw:
        return False
    m = raw.rsplit("/", 1)[-1]
    if "gemini-2.0" in m or "gemini-1." in m or "gemini-1-" in m:
        return False
    if "2.5" in m or "2-5" in m:
        return True
    if "gemini-3" in m:
        return True
    return False


# ── Gemini config builder ─────────────────────────────────────────────────────

def _build_gemini_config(
    gen_kwargs: dict,
    llm_params: dict,
    *,
    model_name: str | None = None,
):
    """
    Build a GenerateContentConfig from gen_kwargs + every flag in llm_parameters.

    Handled flags:
      url_context              bool  — model fetches URLs in the prompt
      grounding_google_search  bool  — live Google Search grounding
      code_execution           bool  — model can execute Python
      thinking_mode            bool  — extended thinking (Gemini 2.5+)
      thinking_level           str   — "low" | "medium" | "high" (maps to token budget)
      thinking_budget          int   — explicit budget_tokens (overrides thinking_level)
      media_resolution         str   — "low" | "medium" | "high" | "default"
      system_instructions      str   — prepended system instruction text
      structured_outputs_enabled bool — forces JSON response
      structured_outputs_config  dict — JSON schema for the response
      function_calling_enabled   bool — enable function calling
      function_calling_config    dict — {mode: "AUTO"|"ANY"|"NONE", allowed_function_names: [...]}

    Falls back to a plain dict when google-genai types are unavailable.
    """
    try:
        from google.genai import types  # type: ignore

        config_kwargs = dict(gen_kwargs)
        tools: list = []
        active_flags: list[str] = []

        # ── Tools ────────────────────────────────────────────────────────────
        if llm_params.get("url_context"):
            tools.append(types.Tool(url_context=types.UrlContext()))
            active_flags.append("url_context")

        if llm_params.get("grounding_google_search"):
            tools.append(types.Tool(google_search=types.GoogleSearch()))
            active_flags.append("grounding_google_search")

        if llm_params.get("code_execution"):
            tools.append(types.Tool(code_execution=types.ToolCodeExecution()))
            active_flags.append("code_execution")

        if tools:
            config_kwargs["tools"] = tools

        # ── Thinking (Gemini 2.5+ only; 2.0 etc. reject ThinkingConfig) ─────────
        if llm_params.get("thinking_mode"):
            if _gemini_model_supports_thinking_config(model_name):
                budget = _resolve_thinking_budget(llm_params, "gemini")
                config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=budget)
                active_flags.append(f"thinking(budget={budget})")
            else:
                logger.info(
                    "[DocumentAI] thinking_mode set in llm_parameters but model=%s "
                    "does not support Gemini ThinkingConfig — omitting",
                    model_name or "(unknown)",
                )

        # ── Media resolution ─────────────────────────────────────────────────
        media_res = str(llm_params.get("media_resolution") or "default").lower()
        if media_res not in ("default", "", "none"):
            _res_map = {
                "low":    "MEDIA_RESOLUTION_LOW",
                "medium": "MEDIA_RESOLUTION_MEDIUM",
                "high":   "MEDIA_RESOLUTION_HIGH",
            }
            if media_res in _res_map:
                try:
                    config_kwargs["media_resolution"] = getattr(
                        types.MediaResolution, _res_map[media_res]
                    )
                    active_flags.append(f"media_resolution={media_res}")
                except AttributeError:
                    config_kwargs["media_resolution"] = media_res

        # ── System instructions ──────────────────────────────────────────────
        sys_instr = str(llm_params.get("system_instructions") or "").strip()
        if sys_instr:
            config_kwargs["system_instruction"] = sys_instr
            active_flags.append("system_instructions")

        # ── Structured outputs ───────────────────────────────────────────────
        if llm_params.get("structured_outputs_enabled"):
            config_kwargs["response_mime_type"] = "application/json"
            schema = llm_params.get("structured_outputs_config")
            if isinstance(schema, dict) and schema:
                config_kwargs["response_schema"] = schema
            active_flags.append("structured_outputs")

        # ── Function calling ─────────────────────────────────────────────────
        if llm_params.get("function_calling_enabled"):
            fc_raw = llm_params.get("function_calling_config") or {}
            mode_str = str(fc_raw.get("mode") or "AUTO").upper()
            try:
                mode = getattr(types.FunctionCallingConfig.Mode, mode_str,
                               types.FunctionCallingConfig.Mode.AUTO)
            except AttributeError:
                mode = mode_str
            fc_cfg = types.FunctionCallingConfig(mode=mode)
            allowed = fc_raw.get("allowed_function_names")
            if allowed:
                fc_cfg = types.FunctionCallingConfig(
                    mode=mode, allowed_function_names=list(allowed)
                )
            config_kwargs["tool_config"] = types.ToolConfig(
                function_calling_config=fc_cfg
            )
            active_flags.append(f"function_calling(mode={mode_str})")

        if active_flags:
            logger.info("[DocumentAI] Gemini flags active: %s", ", ".join(active_flags))

        return types.GenerateContentConfig(**config_kwargs)

    except Exception as exc:
        logger.debug("[DocumentAI] GenerateContentConfig build failed (%s) — using plain dict", exc)
        return gen_kwargs


def gemini_stream_config_for_folder_chat(
    *,
    for_summary: bool = True,
    user_id: str | int | None = None,
    summarization_llm_config: dict | None = None,
    agent_name: str | None = None,
) -> tuple[str, Any] | None:
    """
    Model + Gemini config for folder intelligent-chat SSE streaming.

    Uses the same agent_prompts resolution as _generate_text for grounded retrieval.
    Returns None when the resolved model is not Gemini (caller should use the non-stream path).
    """
    model_name, gen_kwargs, llm_params = _generation_config(
        for_summary=for_summary,
        agent_name=agent_name or GROUNDED_RETRIEVAL_AGENT_NAME,
        user_id=user_id,
        summarization_llm_config=summarization_llm_config,
    )
    if _detect_provider(model_name) != "gemini":
        return None
    return model_name, _build_gemini_config(gen_kwargs, llm_params, model_name=model_name)


def stream_config_for_folder_chat(
    *,
    for_summary: bool = True,
    user_id: str | int | None = None,
    summarization_llm_config: dict | None = None,
    agent_name: str | None = None,
    model_name_override: str | None = None,
) -> tuple[str, str, Any]:
    """
    Unified streaming config for folder intelligent-chat SSE.

    Returns (provider, model_name, config) where:
      provider   — "gemini" or "claude"
      model_name — resolved model string from agent_prompts (or summarization_chat_config fallback)
      config     — for gemini: GenerateContentConfig object
                   for claude: (gen_kwargs dict, llm_params dict) tuple

    Always uses agent_prompts for model + all llm_parameters when agent_name is given.
    Falls back to summarization_chat_config only when agent_name is None or DB lookup fails.
    """
    model_name, gen_kwargs, llm_params = _generation_config(
        for_summary=for_summary,
        agent_name=agent_name or GROUNDED_RETRIEVAL_AGENT_NAME,
        user_id=user_id,
        summarization_llm_config=summarization_llm_config,
        model_name_override=model_name_override,
    )
    provider = _detect_provider(model_name)
    if provider == "claude":
        return "claude", model_name, (gen_kwargs, llm_params)
    if provider == "deepseek":
        return "deepseek", model_name, (gen_kwargs, llm_params)
    return "gemini", model_name, _build_gemini_config(gen_kwargs, llm_params, model_name=model_name)


def claude_stream_generator(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
):
    """
    Yield text chunks from Claude streaming API using all agent llm_parameters flags.

    Handled flags: thinking_mode, thinking_level, thinking_budget, system_instructions,
    max_output_tokens (→ max_tokens).
    """
    from typing import Iterator  # local import to avoid circular issues

    client = _anthropic_client()
    if client is None:
        logger.warning("[DocumentAI] Claude stream skipped — Anthropic client unavailable")
        return

    max_tokens = min(
        DEEPSEEK_MAX_OUTPUT_TOKENS,
        int(gen_kwargs.get("max_output_tokens") or DEFAULT_MAX_OUTPUT_TOKENS),
    )
    temperature = float(gen_kwargs.get("temperature") or 1.0)
    api_model = _anthropic_messages_model_id(model_name)

    create_kwargs: dict = {
        "model": api_model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }

    sys_instr = str(llm_params.get("system_instructions") or "").strip()
    if sys_instr:
        create_kwargs["system"] = sys_instr

    if llm_params.get("thinking_mode"):
        budget = _resolve_thinking_budget(llm_params, "claude")
        create_kwargs["thinking"] = {"type": "enabled", "budget_tokens": budget}
        temperature = 1.0

    create_kwargs["temperature"] = temperature

    logger.info(
        "[DocumentAI] ▶ Claude stream  model_id=%s (raw=%s)  temperature=%.2f  max_tokens=%d",
        api_model, model_name, temperature, max_tokens,
    )

    with client.messages.stream(**create_kwargs) as stream:
        for text_chunk in stream.text_stream:
            yield text_chunk
        final_msg = stream.get_final_message()
        usage = getattr(final_msg, "usage", None)
        input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
        log_token_usage_table(
            context="claude_stream",
            usage={
                "provider": "claude",
                "model": api_model,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "totalTokens": input_tokens + output_tokens,
            },
            provider="claude",
            model_name=api_model,
        )


# ── Claude (Anthropic) generation ─────────────────────────────────────────────

def _generate_text_claude(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
) -> str:
    """
    Call the Anthropic Messages API with all applicable llm_parameters flags.

    Handled flags:
      thinking_mode       bool  — Claude extended thinking
      thinking_level      str   — "low"|"medium"|"high" → budget_tokens
      thinking_budget     int   — explicit budget_tokens (overrides thinking_level)
      system_instructions str   — system prompt prepended to the conversation
      max_output_tokens   int   — mapped to Anthropic's max_tokens

    Note: when thinking_mode=true, temperature is forced to 1.0 (Anthropic requirement).
    """
    client = _anthropic_client()
    if client is None:
        logger.warning("[DocumentAI] Claude call skipped — Anthropic client unavailable")
        return ""

    max_tokens = int(gen_kwargs.get("max_output_tokens") or 8192)
    temperature = float(gen_kwargs.get("temperature") or 1.0)

    api_model = _anthropic_messages_model_id(model_name)
    create_kwargs: dict = {
        "model": api_model,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }

    active_flags: list[str] = []

    # ── System instructions ──────────────────────────────────────────────────
    sys_instr = str(llm_params.get("system_instructions") or "").strip()
    if sys_instr:
        create_kwargs["system"] = sys_instr
        active_flags.append("system_instructions")

    # ── Extended thinking ────────────────────────────────────────────────────
    if llm_params.get("thinking_mode"):
        budget = _resolve_thinking_budget(llm_params, "claude")
        create_kwargs["thinking"] = {"type": "enabled", "budget_tokens": budget}
        # Anthropic requires temperature=1 when extended thinking is on
        temperature = 1.0
        active_flags.append(f"thinking(budget={budget})")

    create_kwargs["temperature"] = temperature

    if active_flags:
        logger.info("[DocumentAI] Claude flags active: %s", ", ".join(active_flags))

    logger.info(
        "[DocumentAI] ▶ Claude generate  model_id=%s (raw=%s)  temperature=%.2f  max_tokens=%d",
        api_model,
        model_name,
        temperature,
        max_tokens,
    )

    response = client.messages.create(**create_kwargs)

    usage = getattr(response, "usage", None)
    logger.info(
        "[TokenUsage] provider=claude  model=%s  prompt_tokens=%s  completion_tokens=%s  total_tokens=%s",
        api_model,
        getattr(usage, "input_tokens", "?"),
        getattr(usage, "output_tokens", "?"),
        (getattr(usage, "input_tokens", 0) or 0) + (getattr(usage, "output_tokens", 0) or 0),
    )

    # Extract text from content blocks (thinking blocks are skipped)
    for block in response.content:
        if getattr(block, "type", None) == "text":
            return (block.text or "").strip()
    return ""


# ── DeepSeek (OpenAI-compatible) generation ──────────────────────────────────

def _generate_text_deepseek(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
) -> str:
    """
    Call the DeepSeek chat completions API (OpenAI-compatible).

    Supported llm_parameters flags:
      system_instructions str  — system prompt
      max_output_tokens   int  — mapped to max_tokens
      thinking_mode       bool — enables DeepSeek reasoning (reasoning_effort=high)
    """
    client = _deepseek_client()
    if client is None:
        logger.warning("[DocumentAI] DeepSeek call skipped — client unavailable")
        return ""

    max_tokens = int(gen_kwargs.get("max_output_tokens") or 8192)
    temperature = float(gen_kwargs.get("temperature") or 1.0)
    api_model = _deepseek_model_id(model_name)

    messages = _deepseek_messages(prompt, llm_params)

    create_kwargs: dict = {
        "model": api_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if _deepseek_expects_json(prompt, llm_params):
        create_kwargs["response_format"] = {"type": "json_object"}

    if llm_params.get("thinking_mode"):
        create_kwargs["reasoning_effort"] = "high"
        create_kwargs["extra_body"] = {"thinking": {"type": "enabled"}}
    else:
        create_kwargs["extra_body"] = {"thinking": {"type": "disabled"}}

    logger.info(
        "[DocumentAI] ▶ DeepSeek generate  model_id=%s (raw=%s)  temperature=%.2f  max_tokens=%d",
        api_model, model_name, temperature, max_tokens,
    )

    try:
        response = client.chat.completions.create(**create_kwargs)
    except Exception as exc:
        logger.exception(
            "[DocumentAI] DeepSeek generate failed model=%s error=%s",
            api_model,
            exc,
        )
        raise
    usage = getattr(response, "usage", None)
    logger.info(
        "[TokenUsage] provider=deepseek  model=%s  prompt_tokens=%s  completion_tokens=%s  total_tokens=%s",
        api_model,
        getattr(usage, "prompt_tokens", "?"),
        getattr(usage, "completion_tokens", "?"),
        getattr(usage, "total_tokens", "?"),
    )
    return normalize_markdown_render_output(response.choices[0].message.content or "") if response.choices else ""


def deepseek_stream_generator(
    prompt: str,
    *,
    model_name: str,
    gen_kwargs: dict,
    llm_params: dict,
):
    """
    Yield text chunks from the DeepSeek streaming API (OpenAI-compatible SSE).

    Supported flags: system_instructions, max_output_tokens, thinking_mode.
    """
    client = _deepseek_client()
    if client is None:
        logger.warning("[DocumentAI] DeepSeek stream skipped — client unavailable")
        return

    max_tokens = min(
        DEEPSEEK_MAX_OUTPUT_TOKENS,
        int(gen_kwargs.get("max_output_tokens") or DEFAULT_MAX_OUTPUT_TOKENS),
    )
    temperature = float(gen_kwargs.get("temperature") or 1.0)
    api_model = _deepseek_model_id(model_name)

    messages = _deepseek_messages(prompt, llm_params)

    create_kwargs: dict = {
        "model": api_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if _deepseek_expects_json(prompt, llm_params):
        create_kwargs["response_format"] = {"type": "json_object"}

    if llm_params.get("thinking_mode"):
        create_kwargs["reasoning_effort"] = "high"
        create_kwargs["extra_body"] = {"thinking": {"type": "enabled"}}
    else:
        create_kwargs["extra_body"] = {"thinking": {"type": "disabled"}}

    logger.info(
        "[DocumentAI] ▶ DeepSeek stream  model_id=%s (raw=%s)  temperature=%.2f  max_tokens=%d",
        api_model, model_name, temperature, max_tokens,
    )

    try:
        stream = client.chat.completions.create(**create_kwargs)
    except Exception as exc:
        logger.exception(
            "[DocumentAI] DeepSeek stream failed model=%s error=%s",
            api_model,
            exc,
        )
        raise
    final_usage: dict[str, int] | None = None
    for chunk in stream:
        usage = getattr(chunk, "usage", None)
        if usage is not None:
            prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
            completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            total_tokens = int(getattr(usage, "total_tokens", 0) or 0)
            if not total_tokens and (prompt_tokens or completion_tokens):
                total_tokens = prompt_tokens + completion_tokens
            final_usage = {
                "inputTokens": prompt_tokens,
                "outputTokens": completion_tokens,
                "totalTokens": total_tokens,
            }
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta and delta.content:
            yield delta.content
    if final_usage:
        log_token_usage_table(
            context="deepseek_stream",
            usage={"provider": "deepseek", "model": api_model, **final_usage},
            provider="deepseek",
            model_name=api_model,
        )


# ── Unified text generation (routes Gemini ↔ Claude) ─────────────────────────

def _generate_text(
    prompt: str,
    *,
    for_summary: bool = False,
    agent_name: str | None = None,
    user_id: str | int | None = None,
    summarization_llm_config: dict | None = None,
    model_name_override: str | None = None,
) -> str:
    """
    Generate text using either Gemini or Claude depending on the model name
    stored in agent_prompts.model_ids → llm_models.name.

    Routing:
      model id tail starts with "claude" (after any vendor/ path prefix) → Anthropic API
      everything else → Gemini API
    """
    model_name, gen_kwargs, llm_params = _generation_config(
        for_summary=for_summary,
        agent_name=agent_name,
        user_id=user_id,
        summarization_llm_config=summarization_llm_config,
        model_name_override=model_name_override,
    )
    provider = _detect_provider(model_name)

    logger.info(
        "[DocumentAI] generate  provider=%s  model=%s  agent=%s",
        provider, model_name, agent_name or "N/A",
    )

    if provider == "claude":
        return _generate_text_claude(
            prompt,
            model_name=model_name,
            gen_kwargs=gen_kwargs,
            llm_params=llm_params,
        )

    if provider == "deepseek":
        return _generate_text_deepseek(
            prompt,
            model_name=model_name,
            gen_kwargs=gen_kwargs,
            llm_params=llm_params,
        )

    # ── Gemini ───────────────────────────────────────────────────────────────
    client = _gemini_client()
    if client is None:
        logger.warning("[DocumentAI] Gemini client unavailable — check GEMINI_API_KEY")
        return ""
    gemini_config = _build_gemini_config(gen_kwargs, llm_params, model_name=model_name)
    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=gemini_config,
    )
    um = getattr(response, "usage_metadata", None)
    prompt_tokens = int(getattr(um, "prompt_token_count", 0) or 0)
    completion_tokens = int(getattr(um, "candidates_token_count", 0) or 0)
    total_tokens = int(getattr(um, "total_token_count", 0) or 0)
    if not total_tokens and (prompt_tokens or completion_tokens):
        total_tokens = prompt_tokens + completion_tokens
    log_token_usage_table(
        context="gemini_generate",
        usage={
            "provider": "gemini",
            "model": model_name,
            "inputTokens": prompt_tokens,
            "outputTokens": completion_tokens,
            "totalTokens": total_tokens,
        },
        provider="gemini",
        model_name=model_name,
    )
    return (getattr(response, "text", None) or "").strip()


def _call_gemini_for_extraction(text: str) -> dict:
    """Use Gemini to extract all case fields from document text (uses form_population_agent config)."""
    try:
        limited_text = text[:80000]  # stay within token limits
        prompt = _EXTRACTION_PROMPT + limited_text
        raw = _generate_text(prompt, agent_name=_AGENT_EXTRACTION)
        if not raw:
            return {}
        # Try to extract JSON
        json_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw) or re.search(r"\{[\s\S]*\}", raw)
        if json_match:
            return json.loads(json_match.group(1) if json_match.lastindex else json_match.group(0))
        return {}
    except Exception as exc:
        global _gemini_extract_unavailable_logged
        if not _gemini_extract_unavailable_logged:
            logger.warning("[DocumentAI] Gemini extraction unavailable, using regex fallback: %s", exc)
            _gemini_extract_unavailable_logged = True
        return {}


def _is_audio_source_name(name: str) -> bool:
    lowered = str(name or "").strip().lower()
    if not lowered:
        return False
    return lowered.endswith((".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".webm", ".mp4", ".opus", ".amr"))


def _extract_speaker_turns(document_texts: list[dict[str, str]], *, max_turns: int = 140) -> list[tuple[str, str]]:
    turns: list[tuple[str, str]] = []
    for doc in document_texts:
        text = str(doc.get("text") or "")
        if not text:
            continue
        for line in text.splitlines():
            match = _SPEAKER_LINE_RE.search(line)
            if not match:
                continue
            speaker = match.group(1).strip()
            utterance = " ".join(match.group(2).split()).strip()
            if not utterance:
                continue
            turns.append((speaker, utterance))
            if len(turns) >= max_turns:
                return turns
    return turns


def _build_speaker_diarization_suffix(document_texts: list[dict[str, str]]) -> str:
    turns = _extract_speaker_turns(document_texts)
    if not turns:
        return ""

    snippets_by_speaker: dict[str, list[str]] = {}
    for speaker, utterance in turns:
        snippets_by_speaker.setdefault(speaker, [])
        if len(snippets_by_speaker[speaker]) < 2:
            snippets_by_speaker[speaker].append(utterance[:220])

    ordered_speakers = sorted(snippets_by_speaker.keys(), key=lambda x: (len(x), x))
    speaker_lines: list[str] = []
    for speaker in ordered_speakers[:8]:
        snippets = "; ".join(snippets_by_speaker[speaker])
        speaker_lines.append(f"- Speaker {speaker}: {snippets}")

    transitions: list[str] = []
    previous_speaker = turns[0][0]
    for speaker, _utterance in turns[1:]:
        if speaker == previous_speaker:
            continue
        transitions.append(f"Speaker {previous_speaker} -> Speaker {speaker}")
        previous_speaker = speaker
        if len(transitions) >= 8:
            break
    transition_lines = [f"- {item}" for item in transitions] if transitions else ["- Single-speaker sequence in retrieved context."]

    return (
        "Speaker Diarization:\n"
        + "\n".join(speaker_lines)
        + "\n\nWho Talks To Whom (turn sequence):\n"
        + "\n".join(transition_lines)
    )


def _call_gemini_for_qa(
    question: str,
    document_texts: list[dict[str, str]],
    *,
    query_intent: str | None = None,
    output_format: str | None = None,
    extra_instructions: str | None = None,
    system_instruction: str | None = None,
    user_id: str | int | None = None,
    summarization_llm_config: dict | None = None,
    agent_name: str | None = None,
    model_name_override: str | None = None,
) -> dict[str, str]:
    """
    Ask Gemini a question grounded in the provided document texts.

    Args:
        question: The user's question.
        document_texts: List of dicts with keys 'name' and 'text'.

    Returns:
        Dict with keys 'answer' and 'source_documents'.
    """
    try:
        # Build the document context block
        context_parts = []
        source_names = []
        running_chars = 0
        char_limit = 80000
        for doc in document_texts:
            name = doc.get("name", "document")
            text = (doc.get("text") or "").strip()
            if not text:
                continue
            block = f"[Source file: {name}]\n{text}"
            if running_chars + len(block) > char_limit:
                block = block[: char_limit - running_chars]
                context_parts.append(block)
                source_names.append(name)
                break
            context_parts.append(block)
            source_names.append(name)
            running_chars += len(block)

        if not context_parts:
            return {
                "answer": "No case material text is available to answer this question.",
                "source_documents": "",
            }

        context = "\n\n---\n\n".join(context_parts)
        intent_hint = (query_intent or "general").strip().lower()
        format_hint = (output_format or "plain").strip().lower()
        has_audio_source = any(_is_audio_source_name(name) for name in source_names)
        has_speaker_labels = bool(_extract_speaker_turns(document_texts, max_turns=1))
        require_speaker_diarization = has_audio_source or has_speaker_labels
        is_learning_agent = str(agent_name or "").strip() == "learning_mode_agent"
        if is_learning_agent:
            instruction_parts = [
                "You are in Learning Mode. Follow the system instructions (from agent configuration) for how to teach the case and prepare the learner.",
                "Use ONLY the case materials below. Honor the runtime instructions prepended to this prompt (JSON shape, turn rules, grounding).",
                "Do not invent facts, dates, names, holdings, or procedural history.",
            ]
        else:
            instruction_parts = [
                "You are a legal expert assistant.",
                "Answer the user's question based ONLY on the following case materials (PDFs, images, text files, AND transcripts from audio — treat transcript excerpts as valid sources).",
                "Do not invent facts, dates, names, holdings, or procedural history.",
                "If the answer is not supported by the provided text, say so clearly.",
                "Prefer precise legal writing over generic filler.",
                "Cite the source file name inline when materially helpful.",
                "Never say there are no audio files in the folder if the excerpts below include content from an audio filename — that transcript represents the audio.",
            ]
        if not is_learning_agent:
            if require_speaker_diarization:
                instruction_parts.append(
                    "Because this query uses audio transcript context, include a 'Speaker Diarization' section and a "
                    "'Who Talks To Whom (turn sequence)' section using only speaker labels found in the transcript."
                )
            if intent_hint == "timeline":
                instruction_parts.append("Organize the answer chronologically and focus on procedural sequence and dates.")
            elif intent_hint == "risk":
                instruction_parts.append("Focus on legal, procedural, evidentiary, and strategic risks supported by the record.")
            elif intent_hint == "evidence":
                instruction_parts.append("Focus on exhibits, proof, contradictions, admissions, and evidentiary support in the record.")
            elif intent_hint == "summary":
                instruction_parts.append("Provide a structured summary that captures the most material facts and issues from the record.")
            if format_hint == "structured":
                instruction_parts.append(
                    "Use GitHub-Flavored Markdown with short headings and bullets. "
                    "For comparative, chronological, evidentiary, or financial information, use a Markdown table "
                    "with a header row and a valid separator row such as |---|---|. "
                    "Keep each table row on one line and do not use HTML tables."
                )
        if extra_instructions:
            instruction_parts.append(extra_instructions.strip())

        prompt = (
            f"{' '.join(instruction_parts)}\n\n"
            f"=== CASE MATERIALS (documents and/or audio transcripts) ===\n{context}\n\n"
            f"=== QUESTION ===\n{question}\n\n"
            "=== ANSWER ==="
        )
        if system_instruction:
            prompt = f"SYSTEM INSTRUCTION:\n{system_instruction}\n\n{prompt}"
        answer = _generate_text(
            prompt,
            for_summary=intent_hint == "summary",
            agent_name=agent_name or _AGENT_QA,
            user_id=user_id,
            summarization_llm_config=summarization_llm_config,
            model_name_override=model_name_override,
        )
        if require_speaker_diarization:
            diarization_suffix = _build_speaker_diarization_suffix(document_texts)
            if diarization_suffix and "speaker diarization" not in (answer or "").lower():
                answer = f"{(answer or '').strip()}\n\n{diarization_suffix}".strip()
        return {
            "answer": answer,
            "source_documents": ", ".join(source_names),
        }
    except Exception as exc:
        global _gemini_qa_unavailable_logged
        if not _gemini_qa_unavailable_logged:
            logger.warning("[DocumentAI] Gemini Q&A unavailable, returning fallback response: %s", exc)
            _gemini_qa_unavailable_logged = True
        return {"answer": "", "source_documents": ""}



class DocumentAIAdapter:
    CASE_NUMBER_RE = re.compile(r"(case\s*(?:no\.?|number)?\s*[:\-]?\s*[A-Z0-9\/\-]+)", re.I)
    DATE_RE = re.compile(
        r"\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|"
        r"\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|"
        r"[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})\b"
    )
    PARTY_RE = re.compile(r"([A-Z][A-Za-z0-9&.,'\- ]+)\s+v(?:s\.?|ersus)\s+([A-Z][A-Za-z0-9&.,'\- ]+)", re.I)
    COURT_RE = re.compile(r"(high court|supreme court|district court|sessions court|tribunal)", re.I)

    def extract(self, document: DocumentReference) -> ExtractionResult:
        text = (document.inline_text or document.document_name or "").strip()
        quality_score = 0.97 if len(text) > 100 else 0.25

        # Use Gemini for comprehensive extraction if text is meaningful
        if len(text) > 50:
            gemini_entities = _call_gemini_for_extraction(text)
            if gemini_entities:
                logger.info("[DocumentAI] Gemini extraction succeeded: %d fields", len(gemini_entities))
                return ExtractionResult(
                    text=text,
                    entities=gemini_entities,
                    confidence_by_field={k: 0.90 for k in gemini_entities},
                    quality_score=quality_score,
                )

        # Fallback: regex-based extraction
        entities: dict[str, str] = {}
        confidence: dict[str, float] = {}
        lowered_name = document.document_name.lower()

        case_number_match = self.CASE_NUMBER_RE.search(text)
        if case_number_match:
            entities["caseNumber"] = case_number_match.group(1)
            confidence["caseNumber"] = 0.96

        party_match = self.PARTY_RE.search(text)
        if party_match:
            p = party_match.group(1).strip()
            r = party_match.group(2).strip()
            entities["caseTitle"] = f"{p} vs {r}"
            entities["petitioners"] = [{"fullName": p, "role": "Individual", "advocateName": "", "barRegistration": "", "contact": ""}]
            entities["respondents"] = [{"fullName": r, "role": "Individual", "advocateName": "", "barRegistration": "", "contact": ""}]
            confidence["caseTitle"] = 0.94

        dates = self.DATE_RE.findall(text)
        if dates:
            entities["filingDate"] = dates[0]
            confidence["filingDate"] = 0.91

        court_match = self.COURT_RE.search(text)
        if court_match:
            entities["courtName"] = court_match.group(1).title()
            entities["courtLevel"] = court_match.group(1).title()
            confidence["courtName"] = 0.92

        if "bail" in lowered_name or "bail" in text.lower():
            entities.setdefault("caseType", "Bail")
        elif "petition" in lowered_name or "petition" in text.lower():
            entities.setdefault("caseType", "Petition")

        return ExtractionResult(
            text=text,
            entities=entities,
            confidence_by_field=confidence,
            quality_score=quality_score,
        )

    def classify(self, document: DocumentReference, text: str) -> DocumentType:
        from app.services.adapters.speech_to_text import is_audio_filename, is_audio_mime

        if is_audio_mime(document.mime_type) or is_audio_filename(document.document_name or ""):
            tl = text.lower()
            if any(k in tl for k in ("witness", "deposition", "testimony", "examination")):
                return DocumentType.evidence
            if any(k in tl for k in ("hearing", "courtroom", "proceedings", "oral arguments")):
                return DocumentType.order
            if any(k in tl for k in ("consultation", "client interview", "interview")):
                return DocumentType.correspondence
            if any(k in tl for k in ("phone call", "voicemail", "telephone")):
                return DocumentType.correspondence
            if any(k in tl for k in ("recording", "audio", "tape")):
                return DocumentType.evidence
            if "pleading" in tl or "plaint" in tl:
                return DocumentType.pleading
            return DocumentType.audio_recording

        candidate = f"{document.document_name} {text}".lower()
        if "pleading" in candidate or "plaint" in candidate or "written statement" in candidate:
            return DocumentType.pleading
        if "evidence" in candidate or "exhibit" in candidate:
            return DocumentType.evidence
        if "order" in candidate or "judgment" in candidate:
            return DocumentType.order
        if "letter" in candidate or "notice" in candidate or "email" in candidate:
            return DocumentType.correspondence
        if "affidavit" in candidate:
            return DocumentType.affidavit
        if "agreement" in candidate or "contract" in candidate:
            return DocumentType.contract
        return document.declared_doc_type or DocumentType.unknown
