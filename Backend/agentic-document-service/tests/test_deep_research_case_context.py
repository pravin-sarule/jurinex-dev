"""A Deep run must SEE the uploaded case, and must never answer it as small talk.

Regression cover for the live failure where "give me citations for this case" was
triaged as chat: the planner was called with an empty context, so it had no idea what
"this case" was, replied asking for the case name, and the run ended with 0 rounds and
0 sources while a 29 MB case file sat in the folder.
"""

from __future__ import annotations

import json
import unittest

from app.services.deep_research.orchestrator import (
    _CASE_REFERENCE_RE,
    _looks_like_small_talk,
    _parse_triage,
    _redact_grounded_text,
)

CASE = (
    "[Document: Green Eye Infrastructure Pvt. Ltd. vs Chief Controlling Revenue Authority]\n"
    "The petitioner challenges an adjudication of stamp duty under the Maharashtra Stamp Act."
)


def triage(mode: str, *, reply: str = "", subs: list[str] | None = None) -> str:
    return json.dumps({"mode": mode, "chat_reply": reply, "sub_questions": subs or []})


class TriageGuardTests(unittest.TestCase):
    def test_case_question_triaged_as_chat_is_forced_into_legal_research(self) -> None:
        planner_said_chat = triage("chat", reply="Please share the case name so I can begin.")

        mode, reply, queue = _parse_triage(
            planner_said_chat, "give me citations for this case", 6, has_case_context=True,
        )

        self.assertEqual(mode, "legal")
        self.assertEqual(reply, "")
        self.assertEqual(queue, ["give me citations for this case"])

    def test_general_triage_is_upgraded_when_the_question_names_the_case(self) -> None:
        for question in (
            "give me citations for this case",
            "summarise the uploaded documents",
            "what are the risks in my matter",
            "key issues in these documents",
        ):
            mode, _reply, _queue = _parse_triage(
                triage("general", subs=["q"]), question, 6, has_case_context=True,
            )
            self.assertEqual(mode, "legal", question)

    def test_a_general_question_stays_general_even_with_documents_attached(self) -> None:
        mode, _reply, queue = _parse_triage(
            triage("general", subs=["world events on 28 July"]),
            "this day in history in India as well as foreign",
            6,
            has_case_context=True,
        )

        self.assertEqual(mode, "general")
        self.assertEqual(queue, ["world events on 28 July"])

    def test_real_small_talk_still_short_circuits(self) -> None:
        mode, reply, queue = _parse_triage(
            triage("chat", reply="Hello! How can I help?"), "hi", 6, has_case_context=True,
        )

        self.assertEqual(mode, "chat")
        self.assertEqual(reply, "Hello! How can I help?")
        self.assertEqual(queue, [])

    def test_guard_is_inert_without_case_documents(self) -> None:
        mode, reply, _queue = _parse_triage(
            triage("chat", reply="Which case do you mean?"),
            "give me citations for this case",
            6,
            has_case_context=False,
        )

        self.assertEqual(mode, "chat")
        self.assertEqual(reply, "Which case do you mean?")

    def test_small_talk_detector_is_conservative(self) -> None:
        for chit_chat in ("hi", "Hello", "thanks!", "good morning", "hey jurinex", "ok"):
            self.assertTrue(_looks_like_small_talk(chit_chat), chit_chat)
        for real in (
            "give me citations",
            "what is section 32A",
            "draft a reply",
            "summarise this",
            "hi, what does section 55 say about registration",
        ):
            self.assertFalse(_looks_like_small_talk(real), real)

    def test_case_reference_detector(self) -> None:
        for hit in ("citations for this case", "the uploaded file", "risks in my matter",
                    "these documents", "the present petition"):
            self.assertRegex(hit, _CASE_REFERENCE_RE)
        for miss in ("this day in history", "latest news in India", "who won the match"):
            self.assertIsNone(_CASE_REFERENCE_RE.search(miss), miss)


class PlannerContextTests(unittest.TestCase):
    def test_planner_prompt_now_carries_the_case_context(self) -> None:
        from app.services.deep_research import prompts

        prompt = prompts.planner("give me citations for this case", 6, CASE, 6_000, "28 July 2026")

        self.assertIn("Maharashtra Stamp Act", prompt)
        self.assertIn("NEVER ask the user to supply the case name", prompt)
        self.assertIn('the mode is "legal"', prompt)

    def test_grounded_text_is_still_redacted_before_any_web_search(self) -> None:
        # The privacy guarantee that makes it safe to show the planner the case.
        redacted = _redact_grounded_text(
            "Green Eye Infrastructure Pvt. Ltd. stamp duty adjudication", CASE,
        )

        self.assertNotIn("Green Eye Infrastructure", redacted)
        self.assertIn("[private entity]", redacted)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
