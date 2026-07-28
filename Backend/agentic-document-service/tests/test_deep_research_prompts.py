from __future__ import annotations

import unittest
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path


_MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "services"
    / "deep_research"
    / "prompts.py"
)
_SPEC = spec_from_file_location("deep_research_prompts_under_test", _MODULE_PATH)
assert _SPEC is not None and _SPEC.loader is not None
prompts = module_from_spec(_SPEC)
_SPEC.loader.exec_module(prompts)


class DeepResearchPromptTests(unittest.TestCase):
    def test_search_round_has_explicit_distinct_query_ceiling(self) -> None:
        prompt = prompts.round_search(
            "What law applies?",
            "Find the governing statute.",
            [],
            "",
            8_000,
            "28 July 2026",
            "legal",
        )

        self.assertIn("at most 4 distinct Google Search queries", prompt)

    def test_synthesis_is_evidence_closed_and_does_not_request_links(self) -> None:
        prompt = prompts.synthesis(
            "What law applies?",
            [],
            "",
            12_000,
            "28 July 2026",
            "legal",
        )

        for contradictory_instruction in (
            "You also have live Google Search",
            "during this synthesis",
            "with linked sources",
            "inline Markdown link",
        ):
            self.assertNotIn(contradictory_instruction, prompt)
        self.assertIn("validated source IDs", prompt)
        self.assertIn("Do not emit", prompt)

    def test_synthesis_forbids_ascii_art_and_fenced_narrative_text(self) -> None:
        prompt = prompts.synthesis(
            "What law applies?",
            [],
            "",
            12_000,
            "28 July 2026",
            "legal",
        )

        # The prompt must not TEACH character drawing (it used to ship an ASCII
        # diagram example, which the model copied into every report).
        self.assertNotIn("ASCII DIAGRAMS", prompt)
        self.assertNotIn("draw a simple ASCII diagram", prompt)
        self.assertNotIn("Cognizance & summons          Trial", prompt)

        self.assertIn("NO ASCII ART — HARD RULE", prompt)
        self.assertIn("fenced code block", prompt)
        self.assertIn("arrow chain", prompt)
        self.assertIn("Markdown pipe tables", prompt)
        self.assertIn("Emit NO raw HTML anywhere", prompt)

    def test_formatting_contract_is_stated_for_every_mode(self) -> None:
        for mode in ("legal", "general"):
            prompt = prompts.synthesis("Q", [], "", 12_000, "28 July 2026", mode)
            self.assertIn("C and E are ABSOLUTE and apply to every answer", prompt)
            self.assertIn(f"Research mode: {mode}", prompt)

    def test_finding_sources_include_their_supported_claim_texts(self) -> None:
        rendered = prompts.format_findings(
            [
                {
                    "query": "Section 32A",
                    "text": "The statutory finding.",
                    "citations": [
                        {
                            "source_id": "S1",
                            "title": "India Code",
                            "authority_tier": "official_primary",
                            "claim_texts": [
                                "Section 32A applies to adjudication.",
                                "The provision remains in force.",
                            ],
                        }
                    ],
                }
            ]
        )

        self.assertIn("[S1] India Code", rendered)
        self.assertIn("Section 32A applies to adjudication.", rendered)
        self.assertIn("The provision remains in force.", rendered)

    def test_all_accumulated_findings_injections_are_bounded(self) -> None:
        findings = [
            {
                "query": "large result",
                "text": "F" * 300_000,
                "citations": [],
            }
        ]

        search_prompt = prompts.round_search(
            "Question",
            "Sub-question",
            findings,
            "",
            8_000,
            "28 July 2026",
            "legal",
        )
        gap_prompt = prompts.gap_check(
            "Question",
            findings,
            1,
            4,
            "legal",
        )
        synthesis_prompt = prompts.synthesis(
            "Question",
            findings,
            "",
            12_000,
            "28 July 2026",
            "legal",
        )

        for prompt in (search_prompt, gap_prompt, synthesis_prompt):
            self.assertIn("truncated to control cost", prompt)
        self.assertLess(len(search_prompt), 50_000)
        self.assertLess(len(gap_prompt), 60_000)
        self.assertLess(len(synthesis_prompt), 120_000)



class DeepResearchDepthContractTests(unittest.TestCase):
    """The depth floors that stop a Deep run from answering like a quick lookup."""

    TODAY = "28 July 2026"

    def test_planner_requires_one_sub_question_per_named_facet(self) -> None:
        prompt = prompts.planner("this day in history in India as well as foreign", 6, "", 6_000, self.TODAY)

        self.assertIn("FACET COVERAGE IS MANDATORY", prompt)
        self.assertIn("in India as well as foreign", prompt)
        self.assertIn("DEPTH FLOOR", prompt)
        self.assertIn("at least 2 sub-questions", prompt)
        # The old rule that collapsed these questions to a single round must be gone.
        self.assertNotIn('1 for a simple lookup', prompt)
        self.assertNotIn('use the FEWEST sub-questions', prompt)

    def test_planner_decomposes_date_questions_by_category(self) -> None:
        prompt = prompts.planner("what happened on 28 July", 6, "", 6_000, self.TODAY)

        self.assertIn("CATEGORY COVERAGE", prompt)
        for category in ("events in India", "world/international events", "births and deaths", "observances"):
            self.assertIn(category, prompt)

    def test_gap_check_no_longer_stops_a_day_in_history_after_one_round(self) -> None:
        prompt = prompts.gap_check("this day in history", [], 1, 6, "general")

        self.assertNotIn('are DONE after one adequate round', prompt)
        self.assertNotIn("Never extend a simple question", prompt)
        self.assertIn("FACET COVERAGE FIRST", prompt)
        self.assertIn("MUST target that facet", prompt)
        self.assertIn("When the call is close, CONTINUE", prompt)

    def test_round_search_harvests_generously_in_general_mode(self) -> None:
        prompt = prompts.round_search(
            "this day in history", "major world events on 28 July", [], "", 8_000, self.TODAY, "general",
        )

        self.assertIn("8-15 distinct dated items", prompt)
        self.assertIn("confirm each fact on a second independent source", prompt)
        self.assertIn("400-800+ words", prompt)

    def test_synthesis_sets_a_length_floor_for_general_answers(self) -> None:
        prompt = prompts.synthesis("this day in history", [], "", 12_000, self.TODAY, "general")

        self.assertIn("800-1,500+ words", prompt)
        self.assertIn("A four-item answer is a failure", prompt)
        self.assertIn("FACET COMPLETENESS", prompt)
        self.assertIn("USE THE EVIDENCE YOU WERE GIVEN", prompt)

    def test_synthesis_keeps_bold_and_layout_under_control(self) -> None:
        prompt = prompts.synthesis("Q", [], "", 12_000, self.TODAY, "legal")

        self.assertIn("HIGHLIGHTING — SPARINGLY", prompt)
        self.assertIn("at most 2-3 bold spans per paragraph", prompt)
        self.assertIn("READABILITY", prompt)
        self.assertIn("Paragraphs of 2-5 sentences", prompt)

    def test_legal_depth_mandate_survived_the_rewrite(self) -> None:
        prompt = prompts.synthesis("Q", [], "", 12_000, self.TODAY, "legal")

        self.assertIn("minimum 2,000 words", prompt)
        self.assertIn("Judicial Authorities the Respondent May Rely On", prompt)
        self.assertIn("BNS/BNSS/BSA", prompt)

    def test_privacy_and_anti_hallucination_contracts_survived_the_rewrite(self) -> None:
        planner = prompts.planner("Q", 6, "Ramesh Desai, Flat B-304", 6_000, self.TODAY)
        search = prompts.round_search("Q", "S", [], "ctx", 8_000, self.TODAY, "legal")
        synth = prompts.synthesis("Q", [], "ctx", 12_000, self.TODAY, "legal")

        self.assertIn("PRIVACY", planner)
        self.assertIn("Never place names of private individuals", planner)
        self.assertIn("Never invent a source", search)
        self.assertIn("PRIVACY", search)
        self.assertIn("Never invent a source", synth)
        self.assertIn("QUOTE VERIFICATION", synth)
        self.assertIn("SOURCE REGISTER", synth)


if __name__ == "__main__":
    unittest.main()
