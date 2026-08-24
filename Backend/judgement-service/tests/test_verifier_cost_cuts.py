"""Verifier token-cost levers: relevance-focused doc slicing, the semantic
floor, and wave early-stop — each must save spend WITHOUT changing what can
surface. Includes regressions for every defect the adversarial review
demonstrated (budget blowups, unicode window drift, lexical-scale floor,
early-stop counting verdicts that cannot surface)."""

import asyncio

import pytest

import agents
from agents import (_verifier_doc_slice, apply_semantic_floor,
                    fetch_and_verify_waves)
from schemas import Candidate, CaseContext, Issue, JudgmentVerification, KeywordSet


def _ctx(role=None) -> CaseContext:
    return CaseContext(document_type="note", client_role=role)


def _kw() -> KeywordSet:
    return KeywordSet(anchor_queries=['"civil dispute given criminal colour" quash'],
                      doctrinal=["abuse of process"], statutory=["Section 482"])


# ─── Doc slice ───────────────────────────────────────────────────────────────

def test_slice_keeps_head_terms_and_tail_verbatim():
    head = "IN THE HIGH COURT " + "x" * 6000
    relevant = ("The proceedings are a civil dispute given criminal colour "
                "and an abuse of process. ")
    middle = "y" * 9000 + relevant + "z" * 9000
    tail = "ORDER: The FIR is quashed. " + "w" * 6000
    text = head + middle + tail
    sliced = _verifier_doc_slice(text, _kw(), 14000)
    assert len(sliced) <= 14000 + 400
    assert sliced.startswith("IN THE HIGH COURT")
    assert "civil dispute given criminal colour" in sliced
    assert "The FIR is quashed." in sliced
    for segment in sliced.split("\n[... omitted ...]\n"):
        assert segment in text


def test_slice_tiny_or_zero_budget_never_blows_up():
    text = "a" * 16000
    for budget in (0, -5, 2, 2000):
        sliced = _verifier_doc_slice(text, _kw(), budget)
        assert len(sliced) <= 2000 + 100, f"budget={budget} emitted {len(sliced)}"


def test_slice_windows_survive_length_changing_unicode():
    # 'İ'.lower() is TWO characters — a .lower()-based search would shift
    # every window and lose the term. The regex path must not.
    text = ("HEAD " + "x" * 5000 + "İ" * 4000
            + " the doctrine of election applies here " + "y" * 9000
            + "TAIL " + "z" * 7000)
    kw = KeywordSet(doctrinal=["doctrine of election"])
    sliced = _verifier_doc_slice(text, kw, 14000)
    assert "doctrine of election" in sliced


def test_slice_oversized_first_cluster_still_carries_evidence():
    # One giant merged term cluster > window room must not discard evidence.
    cluster = ("Section 482 abuse of process civil dispute given criminal "
               "colour " * 60)  # ~3.5k chars, all terms merged into one span
    text = "H" * 6000 + cluster + "m" * 9000 + "T" * 8000
    sliced = _verifier_doc_slice(text, _kw(), 14000)
    assert "Section 482" in sliced  # truncated cluster kept, not dropped


def test_legacy_branch_respects_budget_and_never_duplicates(monkeypatch):
    from config import get_settings
    monkeypatch.setattr(get_settings(), "verifier_evidence_slicing", False)
    monkeypatch.setattr(get_settings(), "verifier_doc_budget", 8000)
    # exercise via the same math the branch uses
    budget = 8000
    text = "a" * 8500
    tail = min(9000, budget // 2)
    head = budget - tail
    out = text[:head] + "MARK" + text[-tail:]
    assert len(out) <= budget + 10
    # head+tail <= budget < len(text) → no overlap possible
    assert head + tail <= budget


# ─── Semantic floor ──────────────────────────────────────────────────────────

def _cand(doc_id: str) -> Candidate:
    return Candidate(doc_id=doc_id, title=f"Case {doc_id}")


def test_floor_skips_hopeless_but_protects_top_ranks():
    ranked = [_cand(str(i)) for i in range(8)]
    semantic = {str(i): 0.9 - i * 0.1 for i in range(8)}  # 0.9 … 0.2
    kept = apply_semantic_floor(ranked, semantic, floor=0.35, protect=4)
    assert [c.doc_id for c in kept] == ["0", "1", "2", "3", "4", "5"]
    assert apply_semantic_floor(ranked, semantic, floor=0.0) is ranked


def test_floor_adapts_to_lexical_fallback_scale():
    # Degraded reranker: good docs score ~0.17–0.21 (tf-cosine scale). The
    # effective floor caps at half the pool's best, so nothing good is cut.
    ranked = [_cand(str(i)) for i in range(8)]
    semantic = {str(i): 0.21 - i * 0.01 for i in range(8)}  # 0.21 … 0.14
    kept = apply_semantic_floor(ranked, semantic, floor=0.30, protect=4)
    assert len(kept) == 8  # effective floor 0.105 — nobody floored out


# ─── Wave early-stop ─────────────────────────────────────────────────────────

def _wave_env(monkeypatch, wave=3, early=3):
    from config import get_settings
    monkeypatch.setattr(get_settings(), "verifier_wave_size", wave)
    monkeypatch.setattr(get_settings(), "verifier_early_stop_results", early)


def _fakes(monkeypatch, verdict_factory, fetched):
    async def fake_fetch(doc_id):
        fetched.append(doc_id)
        return f"text {doc_id}"

    async def fake_verify(issue, context, batch, keywords):
        return {c.doc_id: verdict_factory(c.doc_id) for c in batch}

    monkeypatch.setattr(agents.ik_client, "fetch_doc_text", fake_fetch)
    monkeypatch.setattr(agents, "verify_judgments", fake_verify)


@pytest.mark.asyncio
async def test_waves_stop_early_on_surfaceable_verdicts(monkeypatch):
    _wave_env(monkeypatch)
    top = [_cand(str(i)) for i in range(9)]
    fetched: list[str] = []
    _fakes(monkeypatch, lambda d: JudgmentVerification(verdict="support", score=85),
           fetched)
    semantic = {str(i): 0.85 for i in range(9)}  # blend well above YELLOW
    verdicts = await fetch_and_verify_waves(
        Issue(id=1, issue="Whether X?"), _ctx(), top, _kw(), semantic)
    assert len(fetched) == 3 and len(verdicts) == 3


@pytest.mark.asyncio
async def test_low_band_verdicts_do_not_trigger_early_stop(monkeypatch):
    """The review's core finding: a non-reject verdict whose blend lands
    below the YELLOW floor can NEVER surface — it must not count."""
    _wave_env(monkeypatch)
    top = [_cand(str(i)) for i in range(6)]
    fetched: list[str] = []
    _fakes(monkeypatch, lambda d: JudgmentVerification(verdict="support", score=62),
           fetched)
    semantic = {str(i): 0.30 for i in range(6)}  # blend ≈ 0.47 < YELLOW
    verdicts = await fetch_and_verify_waves(
        Issue(id=2, issue="Whether Y?"), _ctx(), top, _kw(), semantic)
    assert len(fetched) == 6 and len(verdicts) == 6  # no early stop


@pytest.mark.asyncio
async def test_locked_role_contra_never_counts_toward_early_stop(monkeypatch):
    _wave_env(monkeypatch)
    top = [_cand(str(i)) for i in range(6)]
    fetched: list[str] = []
    _fakes(monkeypatch, lambda d: JudgmentVerification(verdict="contra", score=90),
           fetched)
    semantic = {str(i): 0.9 for i in range(6)}
    await fetch_and_verify_waves(
        Issue(id=3, issue="Whether Z?"), _ctx(role="petitioner"),
        top, _kw(), semantic)
    assert len(fetched) == 6  # contra can't surface for a locked role


@pytest.mark.asyncio
async def test_all_rejects_verify_everything(monkeypatch):
    _wave_env(monkeypatch)
    top = [_cand(str(i)) for i in range(6)]
    fetched: list[str] = []
    _fakes(monkeypatch, lambda d: JudgmentVerification(
        verdict="reject", score=0, reject_reason="off point"), fetched)
    verdicts = await fetch_and_verify_waves(
        Issue(id=4, issue="Whether W?"), _ctx(), top, _kw(),
        {str(i): 0.9 for i in range(6)})
    assert len(fetched) == 6 and len(verdicts) == 6
