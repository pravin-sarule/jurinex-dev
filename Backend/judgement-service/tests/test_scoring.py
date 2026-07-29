"""Composite scoring: exact formula, hard good-law gate, explainability."""

from config import PHASE_WEIGHT_PRESETS, get_settings
from schemas import SignalSet
from tools import band_for, composite_score, judged_band

W1 = PHASE_WEIGHT_PRESETS[1]
W2 = PHASE_WEIGHT_PRESETS[2]


def test_phase1_formula_exact():
    signals = SignalSet(semantic_match=0.9, keyword_match=0.5)
    result = composite_score(signals, W1)
    assert result.score == round(0.7 * 0.9 + 0.3 * 0.5, 4)
    assert result.red_flag is False


def test_none_signals_never_break_the_formula():
    """A signal with weight 0 (or value None) stays valid — contributes
    nothing until its layer ships."""
    signals = SignalSet(semantic_match=0.8, keyword_match=0.6,
                        authority=None, good_law_status=None,
                        party_fit=None, fact_match=None)
    result = composite_score(signals, W2)
    assert result.score == round(0.4 * 0.8 + 0.15 * 0.6, 4)


def test_good_law_is_a_gate_not_a_weight():
    """An overruled case is capped/red-flagged regardless of a perfect
    semantic score — hard branch, cannot be outvoted."""
    cap = get_settings().good_law_gate_cap
    signals = SignalSet(semantic_match=1.0, keyword_match=1.0,
                        authority=1.0, good_law_status=0.0,
                        good_law_status_label="overruled", party_fit=1.0)
    result = composite_score(signals, W2)
    assert result.red_flag is True
    assert result.score <= cap


def test_breakdown_always_rides_along():
    signals = SignalSet(semantic_match=0.77, keyword_match=0.4)
    result = composite_score(signals, W1)
    assert result.breakdown is signals  # never a bare number


def test_phase_presets_sum_to_one():
    for phase, weights in PHASE_WEIGHT_PRESETS.items():
        assert abs(sum(weights.values()) - 1.0) < 1e-9, f"phase {phase}"


def test_judge_verdict_gates_bands():
    """A judged document the judge scored off-point is RED no matter how
    similar its text looks; an unjudged document can never be GREEN once
    the judge ran; without the judge, bands are untouched."""
    assert judged_band("GREEN", 0.10, True) == "RED"
    assert judged_band("YELLOW", 0.39, True) == "RED"
    assert judged_band("GREEN", 0.95, True) == "GREEN"
    assert judged_band("YELLOW", 0.60, True) == "YELLOW"
    assert judged_band("GREEN", None, True) == "YELLOW"
    assert judged_band("GREEN", None, False) == "GREEN"
    assert judged_band("RED", None, True) == "RED"


def test_court_rank_orders_bench_wise():
    from tools import court_rank
    sc = court_rank("Supreme Court of India")
    hc = court_rank("Bombay High Court")
    trib = court_rank("Income Tax Appellate Tribunal")
    dist = court_rank("Bangalore District Court")
    other = court_rank("Gram Nyayalaya, Wardha")
    assert sc < hc < trib < dist < other  # unknown forums sink last


def test_bands_follow_configured_thresholds():
    """Thresholds are config (calibrated per embedding model) — the band
    logic must respect whatever .env says, boundaries inclusive."""
    settings = get_settings()
    green, yellow = settings.band_green_min, settings.band_yellow_min
    assert band_for(green + 0.05) == "GREEN"
    assert band_for(green) == "GREEN"
    assert band_for((green + yellow) / 2) == "YELLOW"
    assert band_for(yellow) == "YELLOW"
    assert band_for(yellow - 0.05) == "RED"
