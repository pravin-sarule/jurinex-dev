"""Unit tests for drafting strategy helpers."""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.drafting_strategies import (  # noqa: E402
    build_consistency_context,
    filter_facts_for_section,
    find_missing_template_sections,
    resolve_strategy,
    split_monolithic_output,
)


def test_resolve_strategy_defaults_sectionwise():
    assert resolve_strategy(None) == "sectionwise"
    assert resolve_strategy("monolithic") == "monolithic"
    assert resolve_strategy("section_wise") == "sectionwise"


def test_filter_facts_includes_parties():
    digest = (
        "PARTIES —\nAcme Pvt Ltd, plaintiff\n\n"
        "AMOUNTS —\nRs. 10,00,000 for services\n"
    )
    sec = {"heading": "6. PRAYER", "summary": "relief", "placeholders": []}
    out = filter_facts_for_section(sec, digest)
    assert "Acme Pvt Ltd" in out


def test_split_monolithic_by_tags():
    sections = [
        {"section_id": "s1", "heading": "FACTS", "index": 0},
        {"section_id": "s2", "heading": "PRAYER", "index": 1},
    ]
    text = "[SECTION s1]\n1. Facts here.\n[/SECTION s1]\n[SECTION s2]\n(a) decree;\n[/SECTION s2]"
    parts = split_monolithic_output(text, sections)
    assert "Facts here" in parts["s1"]
    assert "decree" in parts["s2"]


def test_consistency_context_from_parties():
    digest = "PARTIES —\nM/s Alpha Industries, Plaintiff\nBeta LLP, Defendant\n"
    ctx = build_consistency_context(digest)
    assert "Alpha Industries" in ctx


def test_find_missing_template_sections_detects_tail():
    sections = [
        {"section_id": "s1", "index": 0, "heading": "FACTS", "heading_verbatim": True,
         "original_text": "1. The plaintiff states…"},
        {"section_id": "s2", "index": 1, "heading": "PRAYER", "heading_verbatim": True,
         "original_text": "The plaintiff prays…"},
        {"section_id": "s3", "index": 2, "heading": "VERIFICATION", "heading_verbatim": True,
         "original_text": "I, ____, do hereby verify…"},
        {"section_id": "s4", "index": 3, "heading": "LIST OF DOCUMENTS", "heading_verbatim": True,
         "original_text": "| S.No | Particulars |"},
        {"section_id": "s5", "index": 4, "heading": "SIGNATURE", "heading_verbatim": True,
         "original_text": "Advocate for the Plaintiff\nPlace: ____\nDate: ____"},
    ]
    partial = (
        "FACTS\n1. The plaintiff states the claim.\n\n"
        "PRAYER\n(a) decree for recovery of money;\n"
    )
    missing = find_missing_template_sections(sections, partial)
    ids = [s["section_id"] for s in missing]
    assert "s3" in ids
    assert "s4" in ids
    assert "s5" in ids
    assert "s1" not in ids
    assert "s2" not in ids

    complete = partial + (
        "\nVERIFICATION\nI, A, do hereby verify…\n"
        "LIST OF DOCUMENTS\n| S.No | Particulars |\n"
        "Advocate for the Plaintiff\nPlace: Delhi\nDate: 1.1.2026\n"
    )
    assert find_missing_template_sections(sections, complete) == []


if __name__ == "__main__":
    import inspect

    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and inspect.isfunction(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as exc:
                failed += 1
                print(f"FAIL {name}: {exc}")
    raise SystemExit(1 if failed else 0)
