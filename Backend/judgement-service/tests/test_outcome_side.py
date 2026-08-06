"""Outcome verification — the spec's core lesson: the VERIFIED outcome,
never the query role, decides support vs contra; and an outcome only counts
when its verbatim evidence really appears in the fetched judgment text."""

from schemas import JudgmentVerification
from tools import (
    enforce_verifier_rules,
    shelf_present,
    side_for_outcome,
    side_for_verified_outcome,
    statutory_shelf_patterns,
    verify_outcome_evidence,
)

DOC = ("The petitioner sought quashing of the FIR. Heard both sides. "
       "In the result, the petition is dismissed. No order as to costs.")


def test_support_query_doc_with_refused_outcome_lands_contra():
    """Spec outcome test: a doc found by a SUPPORT query but classified
    relief_refused must be re-tagged contra — query role never wins."""
    assert side_for_outcome("relief_refused", client_seeks_relief=True) == "contra"
    assert side_for_outcome("relief_granted", client_seeks_relief=True) == "support"
    assert side_for_outcome("interim_only", client_seeks_relief=True) == "interim"
    # ambiguous outcomes take no side — never guessed
    assert side_for_outcome("partly", client_seeks_relief=True) is None
    assert side_for_outcome("unclear", client_seeks_relief=True) is None
    # without a stated relief there is no perspective to align to
    assert side_for_outcome("relief_refused", client_seeks_relief=False) is None


def test_outcome_evidence_must_be_verbatim_substring():
    # verbatim phrase from the doc → outcome stands
    outcome, evidence = verify_outcome_evidence(
        "relief_refused", "the petition is dismissed", DOC)
    assert outcome == "relief_refused" and evidence == "the petition is dismissed"
    # case/whitespace differences are normalized, still verbatim
    outcome, _ = verify_outcome_evidence(
        "relief_refused", "The  petition IS dismissed", DOC)
    assert outcome == "relief_refused"


def test_perspective_inverts_side():
    """A respondent-perspective issue is SUPPORTED by relief refused."""
    assert side_for_verified_outcome("relief_refused", "respondent") == "support"
    assert side_for_verified_outcome("relief_granted", "respondent") == "contra"
    assert side_for_verified_outcome("relief_granted", "petitioner") == "support"
    assert side_for_verified_outcome("relief_granted", None) == "support"
    assert side_for_verified_outcome("interim_only", "petitioner") == "interim"
    assert side_for_verified_outcome("partly", "petitioner") is None


def test_verifier_rules_enforced_deterministically():
    # Unverifiable evidence → outcome unclear → OUTCOME KILL → reject,
    # even though the model claimed a confident 'support' at 90.
    v = JudgmentVerification(verdict="support", score=90, outcome="relief_granted",
                             outcome_evidence="petition allowed with costs",
                             doctrine_link="quashing — abuse of process")
    out = enforce_verifier_rules(v, DOC, "petitioner")
    assert out.verdict == "reject" and out.outcome == "unclear"

    # Verified refusal on a petitioner issue → re-derived to contra even
    # though the model said 'support' (query role never wins). v3 recomputes
    # the score: components 90 (forum 0) with the persuasive-forum cap → 70.
    v = JudgmentVerification(verdict="support", score=80, outcome="relief_refused",
                             outcome_evidence="the petition is dismissed",
                             doctrine_link="quashing — abuse of process",
                             ratio_para="para 7", ratio_summary="test stated")
    out = enforce_verifier_rules(v, DOC, "petitioner")
    assert out.verdict == "contra" and out.score == 70
    assert "persuasive forum" in out.score_breakdown.caps_applied

    # Binding forum (same-HC DB = 9 points): no cap; components stand at 99.
    v = JudgmentVerification(verdict="support", score=50, outcome="relief_refused",
                             outcome_evidence="the petition is dismissed",
                             doctrine_link="quashing — abuse of process",
                             ratio_para="para 7", ratio_summary="test stated")
    v.score_breakdown.forum_points = 9
    out = enforce_verifier_rules(v, DOC, "petitioner")
    assert out.score == 99 and out.score_breakdown.caps_applied == []

    # SHELF KILL: no named doctrine link → reject (reject hygiene: score 0).
    v = JudgmentVerification(verdict="support", score=85, outcome="relief_refused",
                             outcome_evidence="the petition is dismissed",
                             doctrine_link="  ")
    out = enforce_verifier_rules(v, DOC, "petitioner")
    assert out.verdict == "reject" and out.score == 0 and not out.include_in_output

    # No locatable ratio → cap 30 → below the 60 threshold → reject (v3).
    v = JudgmentVerification(verdict="support", score=88, outcome="relief_refused",
                             outcome_evidence="the petition is dismissed",
                             doctrine_link="quashing — abuse of process",
                             ratio_para=None, ratio_summary=None)
    out = enforce_verifier_rules(v, DOC, "respondent")
    assert out.verdict == "reject" and out.score == 0

    # v3 LENS KILL: a deferential-review judgment on a first-instance issue.
    v = JudgmentVerification(verdict="support", score=90, outcome="relief_refused",
                             outcome_evidence="the petition is dismissed",
                             doctrine_link="quashing — abuse of process",
                             ratio_para="para 7", ratio_summary="test stated",
                             lens_match=False)
    out = enforce_verifier_rules(v, DOC, "petitioner")
    assert out.verdict == "reject" and "lens" in (out.reject_reason or "")

    # v3 RELIEF-HEAD KILL: loss-of-bargain damages cited for an ascertained debt.
    v = JudgmentVerification(verdict="support", score=90, outcome="relief_refused",
                             outcome_evidence="the petition is dismissed",
                             doctrine_link="s.73 Contract Act — damages",
                             ratio_para="para 7", ratio_summary="test stated",
                             relief_head_match=False)
    out = enforce_verifier_rules(v, DOC, "petitioner")
    assert out.verdict == "reject" and "relief-head" in (out.reject_reason or "")

    # v3 ABSTRACTION-LADDER: a genus phrase justifying the trigger match.
    v = JudgmentVerification(verdict="support", score=90, outcome="relief_refused",
                             outcome_evidence="the petition is dismissed",
                             doctrine_link="quashing — abuse of process",
                             ratio_para="para 7", ratio_summary="test stated",
                             abstraction_test_phrase="breach of contract")
    out = enforce_verifier_rules(v, DOC, "petitioner")
    assert out.verdict == "reject" and "abstraction-ladder" in (out.reject_reason or "")


def test_statutory_shelf_gate_kills_wrong_field_false_positive():
    """The Hindustan-Unilever class of false positive: a stamp-duty case
    full of deposit/withdrawal/interest words scored 100 for an Order 37
    issue. If the judgment never mentions any of the issue's statutory
    anchors, it is rejected no matter what the model scored."""
    patterns = statutory_shelf_patterns(
        "Order XXXVII CPC", ["Order 37 CPC", "Order XXXVII Rule 3 CPC"])
    # roman + arabic variants both generated
    assert "order 37" in patterns and "order xxxvii" in patterns
    assert "rule 3" in patterns

    stamp_doc = ("The dispute concerns stamp duty adjudication under Section 34 of the "
                 "Maharashtra Stamp Act. The amount deposited shall carry interest and "
                 "withdrawal is permitted against security. The petition is allowed.")
    order37_doc = ("Leave to defend under Order 37 Rule 3 CPC was granted on condition "
                   "of deposit. The petition is allowed.")
    assert not shelf_present(stamp_doc, patterns)
    assert shelf_present(order37_doc, patterns)
    # pure-doctrine issues (no statutory anchors) leave the gate open
    assert shelf_present(stamp_doc, [])

    v = JudgmentVerification(verdict="support", score=100, outcome="relief_granted",
                             outcome_evidence="The petition is allowed",
                             doctrine_link="deposit withdrawal (invented)",
                             ratio_para="para 3", ratio_summary="x")
    out = enforce_verifier_rules(v, stamp_doc, "petitioner", patterns)
    assert out.verdict == "reject" and "shelf" in (out.reject_reason or "")
    # the genuinely on-shelf judgment survives untouched
    ok = enforce_verifier_rules(v, order37_doc, "petitioner", patterns)
    assert ok.verdict == "support"


def test_invented_or_paraphrased_evidence_kills_the_outcome():
    # paraphrase not present in the text → outcome degraded to unclear
    outcome, evidence = verify_outcome_evidence(
        "relief_refused", "the court rejected the plea", DOC)
    assert outcome == "unclear" and evidence == ""
    # no evidence at all → unclear
    outcome, evidence = verify_outcome_evidence("relief_granted", "", DOC)
    assert outcome == "unclear" and evidence == ""
    # no fetched text to verify against → unclear
    outcome, evidence = verify_outcome_evidence(
        "relief_granted", "petition allowed", None)
    assert outcome == "unclear" and evidence == ""
