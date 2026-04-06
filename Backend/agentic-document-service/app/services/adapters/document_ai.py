from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from app.schemas.contracts import DocumentReference, DocumentType
from app.services.llm_chat_config import get_llm_chat_config, resolve_model_name

logger = logging.getLogger("agentic_document_service.document_ai")
_gemini_extract_unavailable_logged = False
_gemini_qa_unavailable_logged = False

# Internal agent names used for document AI operations
_AGENT_EXTRACTION = "form_population_agent"
_AGENT_QA = "grounded_retrieval_agent"

_EXTRACTION_PROMPT = """You are an expert legal document analyst. Extract ALL case information from the document using semantic understanding and intelligent field matching.

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

EXTRACT THE FOLLOWING FIELDS:
{
  "caseTitle": "Generate as 'Plaintiff Name vs Defendant Name' format. Use title from document or construct from petitioners/respondents",
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

def _detect_provider(model_name: str) -> str:
    """
    Detect the LLM provider from the model name string.
    Returns 'gemini' or 'claude'.
    Default is 'gemini' for unknown names.
    """
    name = (model_name or "").lower().strip()
    if name.startswith("claude"):
        return "claude"
    return "gemini"   # gemini-*, models/gemini-*, or unknown → Gemini


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


def _generation_config(
    *,
    for_summary: bool = False,
    agent_name: str | None = None,
) -> tuple[str, dict, dict]:
    """
    Build (model_name, gen_kwargs, llm_params) for a Gemini call.

    Priority:
      1. agent_prompts DB row for `agent_name`  (source=db)
      2. summarization_chat_config              (fallback)

    Returns three values:
      model_name  — string model id
      gen_kwargs  — core generation params (temperature, max_output_tokens)
      llm_params  — full llm_parameters blob from DB (contains tool flags like
                    url_context, grounding_google_search, code_execution, etc.)
                    Empty dict when coming from summarization_chat_config.
    """
    if agent_name:
        try:
            from app.services.agent_config_service import get_agent_config
            cfg = get_agent_config(agent_name)
            if cfg.source == "db":
                llm_params = cfg.llm_parameters
                max_tokens = int(
                    llm_params.get("max_output_tokens")
                    or (15000 if for_summary else 20000)
                )
                gen_kwargs: dict = {
                    "temperature": cfg.temperature,
                    "max_output_tokens": max_tokens,
                }
                logger.info(
                    "[DocumentAI] generation_config  source=agent_prompts  agent=%s  "
                    "model=%s  temperature=%.2f  max_output_tokens=%d  "
                    "url_context=%s  grounding_search=%s  code_execution=%s",
                    agent_name, cfg.model_name, cfg.temperature, max_tokens,
                    llm_params.get("url_context", False),
                    llm_params.get("grounding_google_search", False),
                    llm_params.get("code_execution", False),
                )
                return cfg.model_name, gen_kwargs, llm_params
            logger.info(
                "[DocumentAI] generation_config  source=DEFAULT(no-db-row)  agent=%s  "
                "model=%s  temperature=%.2f  — falling through to summarization_chat_config",
                agent_name, cfg.model_name, cfg.temperature,
            )
        except Exception as exc:
            logger.warning(
                "[DocumentAI] agent_config_service failed for agent=%s: %s "
                "— falling back to summarization_chat_config",
                agent_name, exc,
            )

    # ── Fallback: summarization_chat_config ───────────────────────────────────
    config = get_llm_chat_config()
    model_name = resolve_model_name(config, for_summary=for_summary) or "gemini-2.0-flash"
    max_tokens = int(
        config.get("max_summarization_output_tokens") if for_summary
        else config.get("max_output_tokens") or 0
    )
    max_cap = max(1, int(config.get("max_output_tokens_cap") or 65536))
    min_tokens = max(1, int(config.get("min_output_tokens") or 1))
    if max_tokens <= 0:
        max_tokens = 15000 if for_summary else 20000
    max_tokens = max(min_tokens, min(max_tokens, max_cap))
    temperature = float(config.get("model_temperature") or 0.7)
    temperature = min(
        max(temperature, float(config.get("temperature_min") or 0.0)),
        float(config.get("temperature_max") or 2.0),
    )
    logger.info(
        "[DocumentAI] generation_config  source=summarization_chat_config  agent=%s  "
        "model=%s  temperature=%.2f  max_output_tokens=%d",
        agent_name or "N/A", model_name, temperature, max_tokens,
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


# ── Gemini config builder ─────────────────────────────────────────────────────

def _build_gemini_config(gen_kwargs: dict, llm_params: dict):
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

        # ── Thinking (Gemini 2.5+) ───────────────────────────────────────────
        if llm_params.get("thinking_mode"):
            budget = _resolve_thinking_budget(llm_params, "gemini")
            config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=budget)
            active_flags.append(f"thinking(budget={budget})")

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

    create_kwargs: dict = {
        "model": model_name,
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
        "[DocumentAI] ▶ Claude generate  model=%s  temperature=%.2f  max_tokens=%d",
        model_name, temperature, max_tokens,
    )

    response = client.messages.create(**create_kwargs)

    # Extract text from content blocks (thinking blocks are skipped)
    for block in response.content:
        if getattr(block, "type", None) == "text":
            return (block.text or "").strip()
    return ""


# ── Unified text generation (routes Gemini ↔ Claude) ─────────────────────────

def _generate_text(
    prompt: str,
    *,
    for_summary: bool = False,
    agent_name: str | None = None,
) -> str:
    """
    Generate text using either Gemini or Claude depending on the model name
    stored in agent_prompts.model_ids → llm_models.name.

    Routing:
      model starts with "claude" → Anthropic API
      everything else            → Gemini API
    """
    model_name, gen_kwargs, llm_params = _generation_config(
        for_summary=for_summary, agent_name=agent_name
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

    # ── Gemini ───────────────────────────────────────────────────────────────
    client = _gemini_client()
    if client is None:
        logger.warning("[DocumentAI] Gemini client unavailable — check GEMINI_API_KEY")
        return ""
    gemini_config = _build_gemini_config(gen_kwargs, llm_params)
    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=gemini_config,
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


def _call_gemini_for_qa(
    question: str,
    document_texts: list[dict[str, str]],
    *,
    query_intent: str | None = None,
    output_format: str | None = None,
    extra_instructions: str | None = None,
    system_instruction: str | None = None,
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
            block = f"[Document: {name}]\n{text}"
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
                "answer": "No document text is available to answer this question.",
                "source_documents": "",
            }

        context = "\n\n---\n\n".join(context_parts)
        intent_hint = (query_intent or "general").strip().lower()
        format_hint = (output_format or "plain").strip().lower()
        instruction_parts = [
            "You are a legal expert assistant.",
            "Answer the user's question based ONLY on the following legal documents.",
            "Do not invent facts, dates, names, holdings, or procedural history.",
            "If the answer is not supported by the documents, say so clearly.",
            "Prefer precise legal writing over generic filler.",
            "Cite the document name inline when materially helpful.",
        ]
        if intent_hint == "timeline":
            instruction_parts.append("Organize the answer chronologically and focus on procedural sequence and dates.")
        elif intent_hint == "risk":
            instruction_parts.append("Focus on legal, procedural, evidentiary, and strategic risks supported by the record.")
        elif intent_hint == "evidence":
            instruction_parts.append("Focus on exhibits, proof, contradictions, admissions, and evidentiary support in the record.")
        elif intent_hint == "summary":
            instruction_parts.append("Provide a structured summary that captures the most material facts and issues from the record.")
        if format_hint == "structured":
            instruction_parts.append("Use a structured format with short headings and bullet points where useful.")
        if extra_instructions:
            instruction_parts.append(extra_instructions.strip())

        prompt = (
            f"{' '.join(instruction_parts)}\n\n"
            f"=== DOCUMENTS ===\n{context}\n\n"
            f"=== QUESTION ===\n{question}\n\n"
            "=== ANSWER ==="
        )
        if system_instruction:
            prompt = f"SYSTEM INSTRUCTION:\n{system_instruction}\n\n{prompt}"
        answer = _generate_text(
            prompt,
            for_summary=intent_hint == "summary",
            agent_name=_AGENT_QA,
        )
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
