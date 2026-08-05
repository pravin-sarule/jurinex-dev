"""v2 verifier enforcement: trigger/sub-doctrine mismatch and parasitic
authority are deterministic KILL checks — a settlement quashing can never
surface for a civil-colour issue, and a judgment that merely QUOTES the
on-point principle points counsel at the quoted authority instead."""

from schemas import JudgmentVerification
from tools import enforce_verifier_rules

DOC = ("The parties have argued at length. In view of the settled position "
       "under Section 482 CrPC, the petition is allowed and the FIR is "
       "quashed. No order as to costs.")


def _v(**overrides) -> JudgmentVerification:
    base = dict(
        verdict="support", score=80, outcome="relief_granted",
        outcome_evidence="the petition is allowed and the FIR is quashed",
        doctrine_link="Section 482 CrPC — inherent power to quash",
        trigger_condition="civil_colour", trigger_match=True,
        parasitic=False, ratio_para="para 5", ratio_summary="settled position",
    )
    base.update(overrides)
    return JudgmentVerification(**base)


def test_trigger_mismatch_is_a_kill():
    out = enforce_verifier_rules(
        _v(trigger_match=False, trigger_condition="settlement"),
        DOC, "petitioner", [])
    assert out.verdict == "reject"
    assert "settlement" in (out.reject_reason or "")


def test_parasitic_is_a_kill_and_names_the_real_authority():
    out = enforce_verifier_rules(
        _v(parasitic=True, cite_source_instead="State of Haryana v. Bhajan Lal"),
        DOC, "petitioner", [])
    assert out.verdict == "reject"
    assert "Bhajan Lal" in (out.reject_reason or "")


def test_model_reject_reason_wins_when_present():
    out = enforce_verifier_rules(
        _v(trigger_match=False,
           reject_reason="settlement judgment cited for civil_colour"),
        DOC, "petitioner", [])
    assert out.verdict == "reject"
    assert out.reject_reason == "settlement judgment cited for civil_colour"


def test_clean_v2_verification_still_passes():
    out = enforce_verifier_rules(_v(), DOC, "petitioner", [])
    assert out.verdict == "support"
    assert out.trigger_match is True
    assert out.parasitic is False
