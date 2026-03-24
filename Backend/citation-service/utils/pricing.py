"""
Pricing for third-party services — INR is the source of truth for stored costs.

Set costs in .env using CITATION_PRICING_*_INR (see .env.example).
Legacy USD env vars are still read and converted to INR using CITATION_INR_PER_USD if INR vars are not set.

Stored in DB: cost_inr (primary), cost_usd = cost_inr / CITATION_INR_PER_USD (for reference).
"""

from __future__ import annotations

import os
from typing import Optional

# FX: INR per 1 USD — used to convert legacy USD env to INR, and INR → USD for cost_usd column
INR_PER_USD = float(os.environ.get("CITATION_INR_PER_USD", "85"))


def _env_float(name: str, default: float) -> float:
    try:
        v = os.environ.get(name)
        if v is None or str(v).strip() == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def _inr_or_usd_legacy(inr_key: str, usd_key: str, default_inr: float) -> float:
    """Prefer explicit INR env; else legacy USD env × INR_PER_USD; else default INR."""
    v = os.environ.get(inr_key)
    if v is not None and str(v).strip() != "":
        try:
            return float(v)
        except (TypeError, ValueError):
            pass
    u = os.environ.get(usd_key)
    if u is not None and str(u).strip() != "":
        try:
            return float(u) * INR_PER_USD
        except (TypeError, ValueError):
            pass
    return default_inr


def _inr_legacy_inr_only(inr_key: str, legacy_key: str, default_inr: float) -> float:
    """IK env keys were always INR; do not multiply by FX."""
    v = os.environ.get(inr_key)
    if v is not None and str(v).strip() != "":
        try:
            return float(v)
        except (TypeError, ValueError):
            pass
    u = os.environ.get(legacy_key)
    if u is not None and str(u).strip() != "":
        try:
            return float(u)
        except (TypeError, ValueError):
            pass
    return default_inr


# ── Indian Kanoon (INR per API call) ─────────────────────────────────────────
IK_SEARCH_INR = _inr_legacy_inr_only(
    "CITATION_PRICING_IK_SEARCH_INR", "CITATION_PRICING_IK_SEARCH", 0.50
)
IK_DOCUMENT_INR = _inr_legacy_inr_only(
    "CITATION_PRICING_IK_DOCUMENT_INR", "CITATION_PRICING_IK_DOCUMENT", 0.20
)
IK_FRAGMENT_INR = _inr_legacy_inr_only(
    "CITATION_PRICING_IK_FRAGMENT_INR", "CITATION_PRICING_IK_FRAGMENT", 0.05
)
IK_META_INR = _inr_legacy_inr_only(
    "CITATION_PRICING_IK_META_INR", "CITATION_PRICING_IK_META", 0.02
)
IK_ORIG_DOC_INR = _inr_legacy_inr_only(
    "CITATION_PRICING_IK_ORIG_DOC_INR", "CITATION_PRICING_IK_ORIG_DOC", 0.50
)

# ── Gemini (INR per 1M tokens, INR per grounding call) ──────────────────────
# Defaults ≈ $0.10/$0.40 per 1M @ 85 INR/USD
GEMINI_INPUT_PER_1M_INR = _inr_or_usd_legacy(
    "CITATION_PRICING_GEMINI_INPUT_PER_1M_INR",
    "CITATION_PRICING_GEMINI_INPUT_PER_1M",
    8.5,
)
GEMINI_OUTPUT_PER_1M_INR = _inr_or_usd_legacy(
    "CITATION_PRICING_GEMINI_OUTPUT_PER_1M_INR",
    "CITATION_PRICING_GEMINI_OUTPUT_PER_1M",
    34.0,
)
GEMINI_GROUNDING_PER_CALL_INR = _inr_or_usd_legacy(
    "CITATION_PRICING_GEMINI_GROUNDING_PER_CALL_INR",
    "CITATION_PRICING_GEMINI_GROUNDING_PER_CALL",
    2.975,  # ~$0.035 × 85
)

# ── Claude (INR per 1M tokens) ──────────────────────────────────────────────
# Defaults ≈ $3/$15 per 1M @ 85
CLAUDE_INPUT_PER_1M_INR = _inr_or_usd_legacy(
    "CITATION_PRICING_CLAUDE_INPUT_PER_1M_INR",
    "CITATION_PRICING_CLAUDE_INPUT_PER_1M",
    255.0,
)
CLAUDE_OUTPUT_PER_1M_INR = _inr_or_usd_legacy(
    "CITATION_PRICING_CLAUDE_OUTPUT_PER_1M_INR",
    "CITATION_PRICING_CLAUDE_OUTPUT_PER_1M",
    1275.0,
)

# ── Serper (INR per search) ─────────────────────────────────────────────────
SERPER_PER_SEARCH_INR = _inr_or_usd_legacy(
    "CITATION_PRICING_SERPER_PER_SEARCH_INR",
    "CITATION_PRICING_SERPER_PER_SEARCH",
    0.85,  # ~$0.01 × 85
)

# ── Document AI (INR per 1000 pages) ────────────────────────────────────────
DOCUMENT_AI_PER_1000_PAGES_INR = _inr_or_usd_legacy(
    "CITATION_PRICING_DOCUMENT_AI_PER_1000_PAGES_INR",
    "CITATION_PRICING_DOCUMENT_AI_PER_1000",
    127.5,  # ~$1.50 × 85
)


def inr_to_usd(cost_inr: float) -> float:
    """Derive USD for DB column from INR (reference only)."""
    if not INR_PER_USD:
        return 0.0
    return float(cost_inr) / INR_PER_USD
