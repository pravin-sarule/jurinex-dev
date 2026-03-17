"""
AgentModifierService: Analyze and modify the autopopulation agent using an LLM.

Flow:
  1. Load current agent code (from DB agent_versions if present, else from disk).
  2. Load extraction prompts from DB extraction_prompts.
  3. Call Claude to analyse the reported issue.
  4. Call Claude to generate modified code + improved prompts.
  5. Validate the modifications with a final LLM call.
  6. Save a new agent_versions row (status='testing') and update extraction_prompts.

DynamicAgentExecutor:
  Loads agent code from the active agent_versions row and executes it via exec()
  in an isolated scope, then calls run_autopopulation_agent(payload) from that scope.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.draft_db import get_draft_conn

logger = logging.getLogger(__name__)

# Path to the canonical agent file (used when no DB version exists yet)
_AGENT_FILE = Path(__file__).resolve().parent.parent / "agents" / "ingestion" / "autopopulation_agent.py"

# Model used for analysis / modification calls
_MODIFIER_MODEL = "claude-sonnet-4-5"

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_active_agent() -> Optional[Dict[str, Any]]:
    """Return the active agent_versions row, or None."""
    try:
        with get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, version, model, code, system_prompt,
                           batch_size, max_tokens, temperature, timeout_ms,
                           avg_accuracy, success_rate, usage_count, status,
                           created_at, updated_at
                    FROM agent_versions
                    WHERE status = 'active'
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """
                )
                row = cur.fetchone()
                if not row:
                    return None
                cols = [d[0] for d in cur.description]
                return dict(zip(cols, row))
    except Exception as e:
        logger.warning("[AgentModifier] Could not fetch active agent_version: %s", e)
        return None


def _get_all_agents() -> List[Dict[str, Any]]:
    try:
        with get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, version, model, system_prompt,
                           batch_size, max_tokens, temperature, timeout_ms,
                           avg_accuracy, success_rate, usage_count, status,
                           created_at, updated_at
                    FROM agent_versions
                    ORDER BY updated_at DESC
                    """
                )
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, r)) for r in rows]
    except Exception as e:
        logger.warning("[AgentModifier] Could not list agent_versions: %s", e)
        return []


def _get_agent_by_id(agent_id: str) -> Optional[Dict[str, Any]]:
    try:
        with get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, version, model, code, system_prompt,
                           batch_size, max_tokens, temperature, timeout_ms,
                           avg_accuracy, success_rate, usage_count, status,
                           created_at, updated_at
                    FROM agent_versions
                    WHERE id = %s::uuid
                    """,
                    (agent_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                cols = [d[0] for d in cur.description]
                return dict(zip(cols, row))
    except Exception as e:
        logger.warning("[AgentModifier] Could not fetch agent_version %s: %s", agent_id, e)
        return None


def _get_extraction_prompts() -> List[Dict[str, Any]]:
    try:
        with get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, category, template, model,
                           max_tokens, temperature, success_rate,
                           avg_accuracy, usage_count, created_at, updated_at
                    FROM extraction_prompts
                    ORDER BY category
                    """
                )
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, r)) for r in rows]
    except Exception as e:
        logger.warning("[AgentModifier] Could not fetch extraction_prompts: %s", e)
        return []


def _get_prompt_by_id(prompt_id: str) -> Optional[Dict[str, Any]]:
    try:
        with get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, category, template, model,
                           max_tokens, temperature, success_rate,
                           avg_accuracy, usage_count, created_at, updated_at
                    FROM extraction_prompts
                    WHERE id = %s::uuid
                    """,
                    (prompt_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                cols = [d[0] for d in cur.description]
                return dict(zip(cols, row))
    except Exception as e:
        logger.warning("[AgentModifier] Could not fetch prompt %s: %s", prompt_id, e)
        return None


def _save_new_agent_version(
    current: Dict[str, Any],
    modified_code: str,
    new_version: str,
) -> Dict[str, Any]:
    """Deprecate current active agent and insert new one with status='testing'."""
    with get_draft_conn() as conn:
        with conn.cursor() as cur:
            # Deprecate all active versions for this agent name
            cur.execute(
                """
                UPDATE agent_versions
                SET status = 'deprecated'
                WHERE name = %s AND status = 'active'
                """,
                (current["name"],),
            )
            # Insert new testing version
            cur.execute(
                """
                INSERT INTO agent_versions
                    (name, version, model, code, system_prompt,
                     batch_size, max_tokens, temperature, timeout_ms, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'testing')
                RETURNING id, name, version, status, created_at
                """,
                (
                    current["name"],
                    new_version,
                    current["model"],
                    modified_code,
                    current.get("system_prompt") or "",
                    current.get("batch_size") or 12,
                    current.get("max_tokens") or 4000,
                    float(current.get("temperature") or 0.1),
                    current.get("timeout_ms") or 30000,
                ),
            )
            row = cur.fetchone()
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))


def _activate_agent(agent_id: str) -> Optional[Dict[str, Any]]:
    """Activate a specific agent version (deprecates all others with same name)."""
    agent = _get_agent_by_id(agent_id)
    if not agent:
        return None
    with get_draft_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE agent_versions SET status = 'deprecated' WHERE name = %s AND status = 'active'",
                (agent["name"],),
            )
            cur.execute(
                "UPDATE agent_versions SET status = 'active' WHERE id = %s::uuid RETURNING id, name, version, status",
                (agent_id,),
            )
            row = cur.fetchone()
            if not row:
                return None
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))


def _update_extraction_prompt(
    prompt_id: str,
    template: str,
    model: Optional[str] = None,
    max_tokens: Optional[int] = None,
    temperature: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    try:
        with get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE extraction_prompts
                    SET template    = COALESCE(%s, template),
                        model       = COALESCE(%s, model),
                        max_tokens  = COALESCE(%s, max_tokens),
                        temperature = COALESCE(%s, temperature),
                        usage_count = usage_count + 1
                    WHERE id = %s::uuid
                    RETURNING id, name, category, template, model, max_tokens, temperature, usage_count, updated_at
                    """,
                    (template, model, max_tokens, temperature, prompt_id),
                )
                row = cur.fetchone()
                if not row:
                    return None
                cols = [d[0] for d in cur.description]
                return dict(zip(cols, row))
    except Exception as e:
        logger.warning("[AgentModifier] Could not update prompt %s: %s", prompt_id, e)
        return None


def _track_performance(agent_id: str, results: Dict[str, Any]) -> None:
    filled = sum(1 for v in results.values() if v not in (None, ""))
    total = len(results)
    rate = filled / total if total > 0 else 0.0
    try:
        with get_draft_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE agent_versions
                    SET success_rate    = %s,
                        usage_count     = usage_count + 1,
                        perf_updated_at = NOW()
                    WHERE id = %s::uuid
                    """,
                    (rate, agent_id),
                )
    except Exception as e:
        logger.warning("[AgentModifier] Could not track performance for %s: %s", agent_id, e)


# ---------------------------------------------------------------------------
# LLM helpers
# ---------------------------------------------------------------------------

def _clean_json(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _call_llm(prompt: str, max_tokens: int = 4000, temperature: float = 0.1) -> str:
    from services.llm_service import call_llm
    return call_llm(
        prompt=prompt,
        model=_MODIFIER_MODEL,
        temperature=temperature,
    ) or ""


# ---------------------------------------------------------------------------
# Current agent code resolution
# ---------------------------------------------------------------------------

def _load_current_code(agent: Optional[Dict[str, Any]]) -> str:
    """Return agent code from DB row if present, otherwise read from disk."""
    if agent and agent.get("code"):
        return agent["code"]
    try:
        return _AGENT_FILE.read_text(encoding="utf-8")
    except Exception as e:
        raise RuntimeError(f"Could not load agent code from disk: {e}") from e


def _bump_version(version: str) -> str:
    parts = version.split(".")
    if len(parts) == 3:
        parts[2] = str(int(parts[2]) + 1)
        return ".".join(parts)
    return version + ".1"


# ---------------------------------------------------------------------------
# AgentModifierService
# ---------------------------------------------------------------------------

class AgentModifierService:
    """
    Analyse and modify the autopopulation agent using Claude.

    Usage:
        svc = AgentModifierService()
        result = svc.analyze_and_modify(issue_description="...", test_cases=[...])
    """

    # ── public entry point ─────────────────────────────────────────────────

    def analyze_and_modify(
        self,
        issue_description: str,
        test_cases: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        current_agent = _get_active_agent()
        current_prompts = _get_extraction_prompts()
        current_code = _load_current_code(current_agent)

        analysis = self._analyze_issue(current_code, current_prompts, issue_description, test_cases or [])
        modifications = self._generate_modifications(current_code, current_prompts, analysis)
        validation = self._validate_modifications(modifications)

        if not validation.get("isValid"):
            errors = validation.get("errors") or []
            raise ValueError(f"Modifications failed validation: {'; '.join(errors)}")

        # Use disk-based agent as the "current" if no DB version exists yet
        agent_for_save = current_agent or {
            "name": "LegalDocumentFieldExtractor",
            "version": "1.0.0",
            "model": _MODIFIER_MODEL,
            "system_prompt": "",
            "batch_size": 12,
            "max_tokens": 4000,
            "temperature": 0.1,
            "timeout_ms": 30000,
        }
        new_version_str = _bump_version(agent_for_save["version"])
        new_agent = _save_new_agent_version(
            current=agent_for_save,
            modified_code=modifications["modified_code"],
            new_version=new_version_str,
        )

        # Apply prompt updates from modifications
        updated_prompts = []
        for pm in modifications.get("modified_prompts") or []:
            if not pm.get("id") or not pm.get("template"):
                continue
            updated = _update_extraction_prompt(
                prompt_id=str(pm["id"]),
                template=pm["template"],
            )
            if updated:
                updated_prompts.append(updated)

        return {
            "analysis": analysis,
            "modifications": {
                "changes_made": modifications.get("changes_made", []),
                "test_suggestions": modifications.get("test_suggestions", []),
                "confidence_score": modifications.get("confidence_score"),
                "breaking_changes": modifications.get("breaking_changes", False),
            },
            "new_agent": new_agent,
            "updated_prompts": updated_prompts,
            "validation": validation,
        }

    # ── step 1: analyse ────────────────────────────────────────────────────

    def _analyze_issue(
        self,
        code: str,
        prompts: List[Dict[str, Any]],
        issue_description: str,
        test_cases: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        prompt_summary = json.dumps(
            [{"id": str(p["id"]), "name": p["name"], "category": p["category"], "template": p["template"]}
             for p in prompts],
            indent=2,
        )
        test_cases_text = json.dumps(test_cases, indent=2) if test_cases else "(none provided)"

        prompt = f"""You are analysing an auto-population agent that extracts fields from legal documents.

CURRENT AGENT CODE:
```python
{code}
```

CURRENT EXTRACTION PROMPTS:
{prompt_summary}

REPORTED ISSUE:
{issue_description}

TEST CASES:
{test_cases_text}

Analyse the code and prompts to identify:
1. Root cause of the issue
2. Which specific parts of the code are problematic
3. Which prompts need improvement
4. Recommended fixes

Return ONLY a valid JSON object (no markdown fences):
{{
  "root_cause": "explanation",
  "problematic_areas": ["area1", "area2"],
  "prompt_issues": ["issue1", "issue2"],
  "recommended_fixes": ["fix1", "fix2"],
  "severity": "high|medium|low",
  "estimated_impact": "description"
}}"""

        raw = _call_llm(prompt, max_tokens=2000, temperature=0.3)
        try:
            return json.loads(_clean_json(raw))
        except json.JSONDecodeError:
            logger.warning("[AgentModifier] Could not parse analysis JSON; returning raw")
            return {"root_cause": raw, "problematic_areas": [], "prompt_issues": [],
                    "recommended_fixes": [], "severity": "unknown", "estimated_impact": ""}

    # ── step 2: generate modifications ────────────────────────────────────

    def _generate_modifications(
        self,
        code: str,
        prompts: List[Dict[str, Any]],
        analysis: Dict[str, Any],
    ) -> Dict[str, Any]:
        prompt_summary = json.dumps(
            [{"id": str(p["id"]), "name": p["name"], "category": p["category"], "template": p["template"]}
             for p in prompts],
            indent=2,
        )

        prompt = f"""You are modifying an auto-population agent (Python) to fix identified issues.

CURRENT CODE:
```python
{code}
```

ANALYSIS:
{json.dumps(analysis, indent=2)}

CURRENT PROMPTS:
{prompt_summary}

Generate complete modified Python code and improved prompt templates that fix the identified issues.

Requirements:
1. Maintain the overall architecture and all public function signatures
2. Fix the specific issues identified in the analysis
3. Improve extraction accuracy
4. Add/improve error handling where missing
5. Make prompts more specific and directive
6. Preserve all imports and module structure

Return ONLY a valid JSON object (no markdown fences):
{{
  "analysis": "what was wrong and why",
  "changes_made": ["specific change 1", "specific change 2"],
  "modified_code": "complete Python code as a single string",
  "modified_prompts": [
    {{
      "id": "<uuid from prompt list above>",
      "category": "structured_fields",
      "template": "improved template text",
      "changes": "what changed and why"
    }}
  ],
  "test_suggestions": ["test 1", "test 2"],
  "confidence_score": 0.95,
  "breaking_changes": false
}}"""

        raw = _call_llm(prompt, max_tokens=8000, temperature=0.1)
        try:
            return json.loads(_clean_json(raw))
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Could not parse modifications JSON from LLM: {e}") from e

    # ── step 3: validate ───────────────────────────────────────────────────

    def _validate_modifications(self, modifications: Dict[str, Any]) -> Dict[str, Any]:
        modified_code = modifications.get("modified_code") or ""
        if not modified_code.strip():
            return {
                "isValid": False,
                "errors": ["modified_code is empty"],
                "warnings": [],
                "recommendations": [],
            }

        # Fast syntax check via compile()
        syntax_ok = True
        syntax_error = ""
        try:
            compile(modified_code, "<agent_version>", "exec")
        except SyntaxError as e:
            syntax_ok = False
            syntax_error = str(e)

        if not syntax_ok:
            return {
                "isValid": False,
                "syntaxCheck": "fail",
                "errors": [f"SyntaxError: {syntax_error}"],
                "warnings": [],
                "recommendations": ["Fix the syntax error before activating this version"],
            }

        # LLM-based semantic validation
        prompt = f"""Validate the following modified Python agent code for correctness and safety.

MODIFIED CODE (first 4000 chars):
```python
{modified_code[:4000]}
```

CHANGES MADE:
{json.dumps(modifications.get("changes_made", []), indent=2)}

Validation checklist:
1. No breaking changes to run_autopopulation_agent() signature
2. Error handling is present for LLM and DB calls
3. All imports are standard or from the existing services package
4. No obvious security vulnerabilities (no shell injection, eval of user input, etc.)
5. Prompts are clear and specific

Return ONLY a valid JSON object (no markdown fences):
{{
  "isValid": true,
  "syntaxCheck": "pass",
  "securityCheck": "pass",
  "compatibilityCheck": "pass",
  "errors": [],
  "warnings": [],
  "recommendations": []
}}"""

        raw = _call_llm(prompt, max_tokens=1500, temperature=0.1)
        try:
            result = json.loads(_clean_json(raw))
            # Override syntax check with our compile() result
            result["syntaxCheck"] = "pass"
            return result
        except json.JSONDecodeError:
            # Syntax passed compile(); treat as valid with a warning
            return {
                "isValid": True,
                "syntaxCheck": "pass",
                "securityCheck": "unknown",
                "compatibilityCheck": "unknown",
                "errors": [],
                "warnings": ["LLM validation response could not be parsed"],
                "recommendations": [],
            }


# ---------------------------------------------------------------------------
# DynamicAgentExecutor
# ---------------------------------------------------------------------------

class DynamicAgentExecutor:
    """
    Load agent code from the active agent_versions row and execute it.

    The stored code must define run_autopopulation_agent(payload) — the same
    public interface as autopopulation_agent.py on disk.
    """

    def execute(self, payload: Dict[str, Any], agent_version_id: Optional[str] = None) -> Dict[str, Any]:
        agent = (
            _get_agent_by_id(agent_version_id) if agent_version_id else _get_active_agent()
        )
        if not agent:
            raise RuntimeError("No active agent_version found in DB; seed or activate one first.")

        code = agent.get("code")
        if not code or not code.strip():
            raise RuntimeError(f"agent_version {agent['id']} has no code stored.")

        runner = self._compile_agent(code, str(agent["id"]))
        result = runner(payload)

        extracted = result.get("extracted_fields") or {}
        _track_performance(str(agent["id"]), extracted)

        return {**result, "_agent_version": agent["version"], "_agent_id": str(agent["id"])}

    # ── internal ───────────────────────────────────────────────────────────

    @staticmethod
    def _compile_agent(code: str, version_label: str):
        """
        Compile and exec the stored agent code, returning a callable that
        accepts a payload dict and returns the extraction result dict.
        """
        try:
            compile(code, f"<agent_version:{version_label}>", "exec")
        except SyntaxError as e:
            raise RuntimeError(f"Stored agent code has a SyntaxError: {e}") from e

        scope: Dict[str, Any] = {}
        exec(code, scope)  # noqa: S102 — intentional dynamic execution of stored code

        runner = scope.get("run_autopopulation_agent")
        if not callable(runner):
            raise RuntimeError(
                "Stored agent code does not define run_autopopulation_agent(payload)."
            )
        return runner
