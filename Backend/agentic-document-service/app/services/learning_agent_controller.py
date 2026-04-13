from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("agentic_document_service.learning_agent")


@dataclass
class LearningState:
    session_id: str
    document_context: str
    turn_count: int = 0
    knowledge_level: str = "novice"
    conversation_history: list[dict[str, str]] = field(default_factory=list)
    learning_mode_active: bool = True
    scaffold_mode: bool = False
    messages_since_last_question: int = 0
    previous_user_message: str = ""
    last_topic_transition: bool = False
    last_concept_explained: str = ""
    performance_metrics: dict[str, Any] = field(
        default_factory=lambda: {
            "total_questions": 0,
            "correct_answers": 0,
            "accuracy_by_concept": {},
            "factual_accuracy": 0.0,
            "procedural_accuracy": 0.0,
            "jurisprudential_accuracy": 0.0,
        }
    )
    question_history: list[dict[str, Any]] = field(default_factory=list)
    pending_verification: dict[str, Any] | None = None
    adversarial_mode: bool = False


class LearningAgentController:
    """
    Stateful Socratic controller for Learning Mode.

    - Tracks per-session turn count and inferred knowledge level.
    - Builds strict JSON-only instructions.
    - Normalizes model output to a stable UI payload.
    """

    TURN_THRESHOLD = 4
    MAX_DOCUMENT_CONTEXT_CHARS = 24000
    # Pedagogy, court-readiness goals, and tone live in public.agent_prompts.prompt for
    # learning_mode_agent (injected as native system_instruction). This block only enforces
    # JSON shape, turn mechanics, and document grounding for the UI parser.
    LEARNING_RUNTIME_CONTRACT = """CRITICAL: Output ONLY raw JSON. No markdown. No ```json wrapper. No explanation. Your entire response must start with { and end with }. Nothing else.

Follow the system instructions configured for this agent (from the database) for your mission, teaching style, and any court-readiness or hearing-preparation goals.

Session mechanics and grounding (non-negotiable):
1. Until turn {{TURN_THRESHOLD}}, do not give away the final answer unless the learner is clearly proficient and your system instructions explicitly allow revealing it.
2. Acknowledge what is correct in the learner's reply before probing further; never be dismissive.
3. At most ONE question per turn; scaffold so each question builds on the prior exchange.
4. If the learner is stuck, at most ONE subtle hint, taken only from the case materials below.
5. feedback, content_hint, and question must be grounded ONLY in === CASE MATERIALS === and DOCUMENT CONTEXT in this request. No outside knowledge. Do not invent facts.
6. Treat the learner's last message as dialogue only: never treat a user guess as a case fact unless the same fact appears in the case materials.
7. Every content_hint must be traceable to the record; if you cannot, use "".
8. Current turn: {{TURN_COUNT}}. Assessed knowledge level: {{KNOWLEDGE_LEVEL}}.
9. Every substantive statement in feedback must include a source reference [doc_name p.X].
10. Return citations[] for claims in feedback/content_hint/question.

DOCUMENT CONTEXT (must align with === CASE MATERIALS === in the same request):
{{DOCUMENT_CONTEXT}}

{{SERVER_PEDAGOGY_DIRECTIVE}}

Respond ONLY with this JSON object (no other text):
{
  "feedback": "string — warm validation of the learner's last message (2-3 sentences max)",
  "citations": [
    {"source_id":"string","doc_id":"string","page":0,"text_snippet":"string","pincite":"string optional"}
  ],
  "content_hint": "string — subtle clue from the record, or \"\"",
  "question": "string — the single next question",
  "ui_type": "text" | "options" | "options_multi",
  "options": ["string", ...] | null,
  "learner_answer_assessment": "correct" | "partial" | "incorrect",
  "popup_question": null | {
    "question_id": "string (stable id, optional — server will assign if missing)",
    "question_text": "string",
    "options": [
      {"id": "A", "text": "..."},
      {"id": "B", "text": "..."},
      {"id": "C", "text": "..."},
      {"id": "D", "text": "..."}
    ],
    "correct_answer": "A|B|C|D",
    "explanations": {"A": "...", "B": "...", "C": "...", "D": "..."},
    "difficulty": "easy|intermediate|hard",
    "concept": "snake_case tag grounded in the document",
    "page_reference": 0,
    "question_type": "comprehension|application|analysis|synthesis|comparison",
    "grounding_ids": ["source_id_1", "source_id_2"]
  }
}

When SERVER_PEDAGOGY_DIRECTIVE in this request says include_popup_mcq=true, you MUST populate popup_question with a rigorous MCQ grounded ONLY in === CASE MATERIALS === (four labeled options, one correct key, educational explanations per option, realistic distractors). When include_popup_mcq=false, set popup_question to null and continue with ui_type text/options as appropriate.

Alternatively you may place the same popup JSON between <POPUP_QUESTION> and </POPUP_QUESTION> after the JSON object (rare); the server will merge it.

Set learner_answer_assessment from the case materials only (not from unsupported user claims). When it is "incorrect" or "partial", the server may run a second configured remediation agent (Claude or Gemini per agent_prompts) to refine this JSON.

Use ui_type "options" for exactly one correct choice (radio + submit in UI). Use "options_multi" when the learner may select more than one checkbox before submitting. Use "text" with options null for open-ended turns. Provide 2–6 short option strings when using options or options_multi."""

    _store: dict[str, LearningState] = {}
    _lock = threading.Lock()

    @classmethod
    def _state_key(cls, *, user_id: str, folder_name: str, session_id: str | None) -> str:
        sid = (session_id or "new").strip() or "new"
        return f"{user_id}::{folder_name}::{sid}"

    @classmethod
    def init_session(
        cls,
        *,
        user_id: str,
        folder_name: str,
        session_id: str,
        document_context: str,
        learning_mode_active: bool = True,
        adversarial_mode: bool = False,
    ) -> LearningState:
        key = cls._state_key(user_id=user_id, folder_name=folder_name, session_id=session_id)
        with cls._lock:
            state = LearningState(
                session_id=session_id,
                document_context=document_context,
                turn_count=0,
                knowledge_level="novice",
                conversation_history=[],
                learning_mode_active=learning_mode_active,
                adversarial_mode=adversarial_mode,
            )
            cls._store[key] = state
            return state

    @classmethod
    def initSession(cls, sessionId: str, documentContext: str, userId: str, folderName: str) -> LearningState:
        return cls.init_session(
            user_id=userId,
            folder_name=folderName,
            session_id=sessionId,
            document_context=documentContext,
            learning_mode_active=True,
        )

    @classmethod
    def get_state(cls, *, user_id: str, folder_name: str, session_id: str) -> LearningState | None:
        key = cls._state_key(user_id=user_id, folder_name=folder_name, session_id=session_id)
        with cls._lock:
            return cls._store.get(key)

    @classmethod
    def begin_turn(cls, *, user_id: str, folder_name: str, session_id: str | None, user_text: str) -> LearningState:
        from app.services.question_strategy import infer_topic_transition

        key = cls._state_key(user_id=user_id, folder_name=folder_name, session_id=session_id)
        with cls._lock:
            state = cls._store.get(key)
            if state is None:
                sid = (session_id or "new").strip() or "new"
                state = LearningState(session_id=sid, document_context="", turn_count=0)
            prev = (state.previous_user_message or "").strip()
            state.last_topic_transition = bool(infer_topic_transition(prev, user_text))
            state.previous_user_message = (user_text or "").strip()
            state.messages_since_last_question = int(getattr(state, "messages_since_last_question", 0) or 0) + 1
            state.turn_count += 1
            state.knowledge_level = cls.evaluate_knowledge(user_text)
            state.conversation_history.append({"role": "user", "content": user_text})
            state.scaffold_mode = cls._is_user_stuck(state)
            cls._store[key] = state
            return state

    @staticmethod
    def evaluate_knowledge(user_text: str) -> str:
        text = (user_text or "").strip().lower()
        if len(text) > 180 or any(token in text for token in ("therefore", "because", "based on", "it implies", "according to", "section")):
            return "proficient"
        if len(text) > 70 or any(token in text for token in ("i think", "maybe", "could be", "appears", "perhaps")):
            return "developing"
        return "novice"

    @classmethod
    def evaluateKnowledge(cls, userMessage: str) -> str:
        return cls.evaluate_knowledge(userMessage)

    @staticmethod
    def _is_user_stuck(state: LearningState) -> bool:
        user_msgs = [m.get("content", "").strip().lower() for m in state.conversation_history if m.get("role") == "user"]
        if len(user_msgs) < 2:
            return False
        return user_msgs[-1] != "" and user_msgs[-1] == user_msgs[-2]

    @classmethod
    def should_reveal_answer(cls, state: LearningState) -> bool:
        return state.turn_count >= cls.TURN_THRESHOLD and state.knowledge_level == "proficient"

    @classmethod
    def shouldRevealAnswer(cls, state: LearningState) -> bool:
        return cls.should_reveal_answer(state)

    @staticmethod
    def build_system_prompt(
        *,
        state: LearningState,
        context_page: int | None,
        context_selection: str | None,
        server_pedagogy_directive: str = "",
    ) -> str:
        page_line = f"\nCURRENT PAGE FOCUS: {context_page}" if context_page else ""
        selection_line = (
            f"\nCURRENT SELECTION FOCUS: {context_selection.strip()[:800]}"
            if context_selection and context_selection.strip()
            else ""
        )
        scaffold_line = (
            "\nUSER appears stuck (repeated wrong attempt). Activate scaffold mode: give one analogy/hint tied to document text."
            if state.scaffold_mode
            else ""
        )
        reveal_line = (
            "\nTurn threshold reached and learner is proficient: you may reveal final answer with concise explanation."
            if LearningAgentController.should_reveal_answer(state)
            else "\nDo not reveal final answer this turn."
        )
        pedagogy = (server_pedagogy_directive or "").strip()
        adversarial_line = (
            "\nADVERSARIAL_MODE=true: You are opposing counsel. Challenge weak logic using only case materials and prefer options_multi rebuttal checks."
            if state.adversarial_mode
            else "\nADVERSARIAL_MODE=false: You are a supportive Socratic legal tutor."
        )
        legal_protocol = (
            "\nSTRICT LEGAL PROTOCOL:\n"
            "IRAC METHOD: structure reasoning as Issue, Rule, Application, Conclusion.\n"
            "NO HALLUCINATION: statute/section numbers must exist in document_context.\n"
            "PRECEDENT PRIORITY: prioritize ratio decidendi over bare facts in hints.\n"
            "CITATIONS: feedback claims must cite document + page pincite.\n"
        )
        bounded_document_context = str(state.document_context or "")[
            : LearningAgentController.MAX_DOCUMENT_CONTEXT_CHARS
        ]
        return (
            LearningAgentController.LEARNING_RUNTIME_CONTRACT
            .replace("{{TURN_THRESHOLD}}", str(LearningAgentController.TURN_THRESHOLD))
            .replace("{{TURN_COUNT}}", str(state.turn_count))
            .replace("{{KNOWLEDGE_LEVEL}}", state.knowledge_level)
            .replace("{{DOCUMENT_CONTEXT}}", bounded_document_context)
            .replace("{{SERVER_PEDAGOGY_DIRECTIVE}}", pedagogy)
            + page_line
            + selection_line
            + scaffold_line
            + reveal_line
            + adversarial_line
            + legal_protocol
        )

    @classmethod
    def buildSystemPrompt(
        cls,
        state: LearningState,
        contextPage: int | None = None,
        contextSelection: str | None = None,
        serverPedagogyDirective: str = "",
    ) -> str:
        return cls.build_system_prompt(
            state=state,
            context_page=contextPage,
            context_selection=contextSelection,
            server_pedagogy_directive=serverPedagogyDirective,
        )

    @classmethod
    def learning_system_prompt(
        cls,
        *,
        turn_count: int,
        knowledge_level: str,
        context_page: int | None,
        context_selection: str | None,
        document_context: str = "",
        server_pedagogy_directive: str = "",
    ) -> str:
        state = LearningState(
            session_id="temp",
            document_context=document_context,
            turn_count=turn_count,
            knowledge_level=knowledge_level,
        )
        return cls.build_system_prompt(
            state=state,
            context_page=context_page,
            context_selection=context_selection,
            server_pedagogy_directive=server_pedagogy_directive,
        )

    @classmethod
    def processMessage(cls, sessionId: str, userMessage: str, userId: str, folderName: str) -> dict[str, Any]:
        state = cls.begin_turn(user_id=userId, folder_name=folderName, session_id=sessionId, user_text=userMessage)
        return {
            "sessionId": sessionId,
            "turnCount": state.turn_count,
            "knowledgeLevel": state.knowledge_level,
            "shouldRevealAnswer": cls.should_reveal_answer(state),
        }

    @staticmethod
    def parse_model_json(raw_text: str) -> dict[str, Any]:
        payload, _ = LearningAgentController.parse_model_json_with_status(raw_text)
        return payload

    @staticmethod
    def _strip_code_fences(text: str) -> str:
        """Remove markdown ```json ... ``` or ``` ... ``` wrappers from LLM output."""
        cleaned = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```\s*$", "", cleaned, flags=re.IGNORECASE)
        return cleaned.strip()

    @staticmethod
    def parse_model_json_with_status(raw_text: str) -> tuple[dict[str, Any], bool]:
        text = (raw_text or "").strip()
        if not text:
            return LearningAgentController.fallback_payload(), False
        # Try direct parse first
        try:
            payload = json.loads(text)
            return LearningAgentController.normalize_payload(payload), True
        except Exception:
            pass
        # Strip markdown code fences and retry
        cleaned = LearningAgentController._strip_code_fences(text)
        if cleaned != text:
            try:
                payload = json.loads(cleaned)
                return LearningAgentController.normalize_payload(payload), True
            except Exception:
                pass
        # Last resort: extract first {...} block via regex
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if match:
            try:
                payload = json.loads(match.group(0))
                return LearningAgentController.normalize_payload(payload), True
            except Exception:
                pass
        return LearningAgentController.fallback_payload(), False

    @staticmethod
    def normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
        feedback = str(payload.get("feedback") or "Great effort. You are thinking in the right direction.")
        citations = payload.get("citations")
        if not isinstance(citations, list):
            citations = []
        normalized_citations: list[dict[str, Any]] = []
        for c in citations[:8]:
            if not isinstance(c, dict):
                continue
            normalized_citations.append(
                {
                    "source_id": str(c.get("source_id") or "").strip(),
                    "doc_id": str(c.get("doc_id") or c.get("document_name") or "").strip(),
                    "page": c.get("page"),
                    "text_snippet": str(c.get("text_snippet") or c.get("snippet") or "").strip(),
                    "pincite": str(c.get("pincite") or "").strip(),
                }
            )
        content_hint = str(payload.get("content_hint") or "Look for the sentence that directly supports your claim.")
        question = str(payload.get("question") or "What specific line in the document supports your answer?")
        raw_ui = str(payload.get("ui_type") or "").strip().lower().replace("-", "_")
        if raw_ui in ("options_multi", "optionsmulti", "multi", "checkbox", "checkboxes"):
            ui_type = "options_multi"
        elif raw_ui == "options":
            ui_type = "options"
        else:
            ui_type = "text"

        options = payload.get("options")
        max_opts = 6
        default_opts = [
            "Can you point to the key sentence?",
            "What term appears repeatedly?",
            "Which page seems most relevant?",
        ]

        if ui_type in ("options", "options_multi"):
            if not isinstance(options, list):
                options = list(default_opts)
            options = [str(item).strip() for item in options if str(item).strip()][:max_opts]
            if len(options) < 2:
                options = list(default_opts)[:3]
            while len(options) < 2:
                options.append("Can you cite one more clue from the document?")
        else:
            options = None

        assess = str(payload.get("learner_answer_assessment") or "").strip().lower()
        if assess not in ("correct", "partial", "incorrect"):
            assess = ""

        popup: dict[str, Any] | None = None
        raw_popup = payload.get("popup_question")
        if isinstance(raw_popup, dict) and raw_popup:
            from app.services.learning_question_validator import validate_question

            v = validate_question(raw_popup)
            if v["is_valid"]:
                popup = dict(raw_popup)
                if not str(popup.get("question_id") or "").strip():
                    popup["question_id"] = uuid.uuid4().hex
            else:
                logger.warning("[LearningAgentController] popup_question rejected: %s", v.get("errors"))

        return {
            "feedback": feedback,
            "citations": normalized_citations,
            "content_hint": content_hint,
            "question": question,
            "ui_type": ui_type,
            "options": options,
            "learner_answer_assessment": assess,
            "popup_question": popup,
        }

    @staticmethod
    def fallback_payload() -> dict[str, Any]:
        return {
            "feedback": "Excellent attempt. Let us build this step by step.",
            "citations": [],
            "content_hint": "Focus on the exact phrase that states the core condition.",
            "question": "Which sentence in the current document section most directly supports your answer?",
            "ui_type": "text",
            "options": None,
            "learner_answer_assessment": "",
            "popup_question": None,
        }

    _CORRECTION_AGENT_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,79}$")

    @classmethod
    def resolve_correction_agent_name(cls, learning_llm_parameters: dict[str, Any] | None) -> str | None:
        """Internal agent name from learning_mode_agent.llm_parameters (must match agent_prompts row)."""
        lp = learning_llm_parameters or {}
        for key in ("correction_agent_name", "remediation_agent_name", "wrong_answer_agent_name"):
            raw = lp.get(key)
            if isinstance(raw, str) and raw.strip():
                name = raw.strip()
                if cls._CORRECTION_AGENT_NAME_RE.match(name):
                    return name
        return None

    @classmethod
    def correction_triggers(cls, assessment: str, learning_llm_parameters: dict[str, Any] | None) -> bool:
        a = (assessment or "").strip().lower()
        if not a:
            return False
        lp = learning_llm_parameters or {}
        triggers = lp.get("correction_assessment_triggers")
        if isinstance(triggers, list):
            if len(triggers) == 0:
                return False
            allowed = {str(x).strip().lower() for x in triggers if str(x).strip()}
            return a in allowed
        if isinstance(triggers, str) and triggers.strip():
            allowed = {x.strip().lower() for x in triggers.split(",") if x.strip()}
            return a in allowed
        default = {"incorrect", "partial", "wrong", "needs_help", "not_correct"}
        return a in default

    @classmethod
    def merge_remediation_into_payload(cls, primary: dict[str, Any], remediation: dict[str, Any]) -> dict[str, Any]:
        merged = dict(primary)
        for k in ("feedback", "citations", "content_hint", "question", "ui_type", "options", "learner_answer_assessment", "popup_question"):
            if k not in remediation:
                continue
            val = remediation.get(k)
            if k == "options" and val is not None and not isinstance(val, list):
                continue
            if k == "citations" and val is not None and not isinstance(val, list):
                continue
            if k == "popup_question" and val is not None and not isinstance(val, dict):
                continue
            if val is None:
                continue
            if k in ("feedback", "content_hint", "question", "learner_answer_assessment") and isinstance(val, str):
                if not val.strip() and k != "learner_answer_assessment":
                    continue
            merged[k] = val
        return cls.normalize_payload(merged)

    @classmethod
    def maybe_run_remediation(
        cls,
        *,
        primary_payload: dict[str, Any],
        learning_primary_llm_parameters: dict[str, Any],
        correction_agent_name: str,
        user_text: str,
        case_excerpt: str,
        learning_runtime_contract_text: str,
        user_id: str | int | None,
        summarization_llm_config: dict | None,
    ) -> dict[str, Any]:
        """
        Optional second LLM call when the primary tutor marks a weak/wrong answer.
        Uses whatever model is configured for correction_agent_name in agent_prompts
        (Gemini or Claude via document_ai._generate_text routing).
        """
        from app.services.agent_config_service import get_agent_config
        from app.services.adapters.document_ai import _generate_text

        cfg = get_agent_config(correction_agent_name)
        if getattr(cfg, "source", "") != "db":
            logger.info(
                "[LearningRemediation] skip — agent %r has no agent_prompts row (source=%s)",
                correction_agent_name,
                getattr(cfg, "source", ""),
            )
            return primary_payload

        assessment = str(primary_payload.get("learner_answer_assessment") or "").strip().lower()
        if not cls.correction_triggers(assessment, learning_primary_llm_parameters):
            return primary_payload

        primary_json = json.dumps(primary_payload, ensure_ascii=False)
        prompt = (
            "LEARNING REMEDIATION PASS:\n"
            "The primary tutor JSON is below. The learner's answer was assessed as: "
            f"{assessment or 'unknown'}.\n"
            "Refine feedback, content_hint, and question so the learner is gently guided toward the correct "
            "understanding using ONLY the case excerpt and the session rules. Keep the same JSON shape.\n\n"
            f"LEARNING RUNTIME (session rules):\n{learning_runtime_contract_text}\n\n"
            f"CASE EXCERPT:\n{case_excerpt}\n\n"
            f"LEARNER LAST MESSAGE:\n{user_text}\n\n"
            f"PRIMARY TUTOR JSON:\n{primary_json}\n\n"
            "Output ONLY one JSON object with keys: feedback, content_hint, question, ui_type, options, "
            "learner_answer_assessment. Preserve ui_type/options unless they clearly must change. No markdown."
        )

        raw = _generate_text(
            prompt,
            for_summary=True,
            agent_name=correction_agent_name,
            user_id=user_id,
            summarization_llm_config=summarization_llm_config,
        )
        remediated, ok = cls.parse_model_json_with_status(raw)
        if not ok:
            logger.warning("[LearningRemediation] remediation model returned non-JSON; keeping primary payload")
            return primary_payload

        logger.info(
            "[LearningRemediation] applied agent=%s model=%s assessment=%s",
            correction_agent_name,
            cfg.model_name,
            assessment,
        )
        return cls.merge_remediation_into_payload(primary_payload, remediated)

    @staticmethod
    def to_display_text(payload: dict[str, Any]) -> str:
        feedback = str(payload.get("feedback", "") or "").strip()
        hint = str(payload.get("content_hint", "") or "").strip()
        question = str(payload.get("question", "") or "").strip()
        pq = payload.get("popup_question")
        if isinstance(pq, dict) and pq.get("question_text"):
            parts = [feedback] if feedback else []
            if hint:
                parts.append(f"Hint: {hint}")
            parts.append("A verification question is shown in the popup — answer there when you are ready.")
            return "\n\n".join(parts).strip()
        base = feedback
        if hint:
            base = f"{base}\n\nHint: {hint}".strip() if base else f"Hint: {hint}"
        if question:
            base = f"{base}\n\nQuestion: {question}".strip() if base else f"Question: {question}"
        return base.strip()

    @classmethod
    def build_pedagogy_directive(cls, decision: dict[str, Any]) -> str:
        """Serialize QuestionStrategy output for the runtime contract."""
        if not decision:
            return ""
        flag = "true" if decision.get("should_ask") else "false"
        reason = str(decision.get("reason") or "").replace("\n", " ")[:400]
        stype = str(decision.get("suggested_type") or "comprehension")
        concept = str(decision.get("suggested_concept") or "").replace("\n", " ")[:160]
        return (
            f"SERVER_PEDAGOGY_DIRECTIVE: include_popup_mcq={flag}; "
            f"reason={reason!r}; suggested_question_type={stype!r}; suggested_concept={concept!r}"
        )

    @classmethod
    def strategy_context_for_state(cls, state: LearningState, user_text: str) -> dict[str, Any]:
        from app.services.question_strategy import infer_user_confusion

        pm = state.performance_metrics or {}
        total = int(pm.get("total_questions") or 0)
        correct = int(pm.get("correct_answers") or 0)
        acc = (correct / total) if total else 0.65
        weak: list[str] = []
        for c, raw in (pm.get("accuracy_by_concept") or {}).items():
            try:
                if float(raw) < 0.6:
                    weak.append(str(c))
            except (TypeError, ValueError):
                continue
        return {
            "messages_since_last_question": int(getattr(state, "messages_since_last_question", 0) or 0),
            "last_concept_explained": str(getattr(state, "last_concept_explained", "") or ""),
            "user_expressed_confusion": infer_user_confusion(user_text),
            "topic_transition": bool(getattr(state, "last_topic_transition", False)),
            "user_performance": {"recent_accuracy": acc, "weak_concepts": weak},
            "current_section": str(getattr(state, "last_concept_explained", "") or ""),
            "document_progress": 0.0,
            "adversarial_mode": bool(getattr(state, "adversarial_mode", False)),
        }

    @classmethod
    def register_popup_question(
        cls,
        *,
        user_id: str,
        folder_name: str,
        session_id: str | None,
        popup: dict[str, Any],
    ) -> None:
        key = cls._state_key(user_id=user_id, folder_name=folder_name, session_id=session_id)
        with cls._lock:
            st = cls._store.get(key)
            if st is None:
                return
            st.pending_verification = dict(popup)
            st.messages_since_last_question = 0
            c = str(popup.get("concept") or "").strip()
            if c:
                st.last_concept_explained = c[:240]

    @classmethod
    def record_mcq_answer(
        cls,
        *,
        user_id: str,
        folder_name: str,
        session_id: str | None,
        question_id: str,
        selected_answer: str,
        time_taken: float | int | None = None,
    ) -> dict[str, Any]:
        key = cls._state_key(user_id=user_id, folder_name=folder_name, session_id=session_id)
        with cls._lock:
            st = cls._store.get(key)
            if st is None:
                return {
                    "correct": False,
                    "explanation": "Session not found. Start or resume learning mode and try again.",
                    "follow_up_message": "",
                    "next_action": "continue",
                }
            pending = st.pending_verification
            if not pending or str(pending.get("question_id") or "") != str(question_id or ""):
                return {
                    "correct": False,
                    "explanation": "That question is no longer active. Ask a new question to continue.",
                    "follow_up_message": "",
                    "next_action": "continue",
                }
            correct_key = str(pending.get("correct_answer") or "").strip().upper()
            picked = str(selected_answer or "").strip().upper()
            is_correct = bool(correct_key) and picked == correct_key
            explanations = pending.get("explanations") if isinstance(pending.get("explanations"), dict) else {}
            expl = str(explanations.get(picked) or explanations.get(correct_key) or "").strip()
            concept = str(pending.get("concept") or "general")
            concept_l = concept.lower()
            st.question_history.append(
                {
                    "question_id": question_id,
                    "concept": concept,
                    "selected": picked,
                    "correct": is_correct,
                    "time_taken": time_taken,
                }
            )
            pm = st.performance_metrics
            pm["total_questions"] = int(pm.get("total_questions") or 0) + 1
            if is_correct:
                pm["correct_answers"] = int(pm.get("correct_answers") or 0) + 1
            acc_map: dict[str, dict[str, int]] = pm.setdefault("_concept_counts", {})
            bucket = acc_map.setdefault(concept, {"c": 0, "t": 0})
            bucket["t"] += 1
            if is_correct:
                bucket["c"] += 1
            ab = pm.setdefault("accuracy_by_concept", {})
            ab[concept] = bucket["c"] / max(1, bucket["t"])
            current = 1.0 if is_correct else 0.0
            if any(k in concept_l for k in ("fact", "factual", "who", "what", "where")):
                pm["factual_accuracy"] = (float(pm.get("factual_accuracy") or 0.0) + current) / 2.0
            if any(k in concept_l for k in ("procedure", "limitation", "filing", "jurisdiction")):
                pm["procedural_accuracy"] = (float(pm.get("procedural_accuracy") or 0.0) + current) / 2.0
            if any(k in concept_l for k in ("precedent", "ratio", "jurisprudence", "application", "synthesis")):
                pm["jurisprudential_accuracy"] = (float(pm.get("jurisprudential_accuracy") or 0.0) + current) / 2.0
            st.pending_verification = None
        follow = (
            "Great — that matches how the materials frame the issue. What part should we tackle next?"
            if is_correct
            else "Good effort. Re-read the cited passage slowly, then tell me which phrase still feels ambiguous."
        )
        next_action = "continue" if is_correct else "review"
        return {
            "correct": is_correct,
            "explanation": expl or "Review the cited pages and compare each option to the record.",
            "follow_up_message": follow,
            "next_action": next_action,
        }

    @classmethod
    def get_session_snapshot(
        cls,
        *,
        user_id: str,
        folder_name: str,
        session_id: str | None,
    ) -> dict[str, Any] | None:
        from app.services.adaptive_learning_engine import recommend_next_action

        st = cls.get_state(user_id=user_id, folder_name=folder_name, session_id=str(session_id or ""))
        if st is None:
            return None
        pm = dict(st.performance_metrics or {})
        pm.pop("_concept_counts", None)
        total = int(pm.get("total_questions") or 0)
        correct = int(pm.get("correct_answers") or 0)
        base_snap = {
            "session_id": st.session_id,
            "current_page": None,
            "concepts_covered": [str(x.get("concept")) for x in st.question_history if x.get("concept")],
            "question_stats": {"total": total, "correct": correct},
            "recommended_next_step": "Keep answering grounded questions; cite pages when unsure.",
            "performance_metrics": pm,
            "messages_since_last_question": int(getattr(st, "messages_since_last_question", 0) or 0),
            "adversarial_mode": bool(getattr(st, "adversarial_mode", False)),
        }
        try:
            rec = recommend_next_action(base_snap)
            base_snap["recommended_next_step"] = str(rec.get("note") or base_snap["recommended_next_step"])
            base_snap["adaptive_hint"] = rec
        except Exception:
            pass
        return base_snap

