"""
Admin-only analytics helpers: normalize per-store (provider) cost breakdown.
Data is stored in citation_service_usage; not exposed to end users in product UI.
"""

from __future__ import annotations

from typing import Any, Dict, Tuple

# Canonical service keys stored in DB (citation_service_usage.service)
COST_STORE_KEYS: Tuple[str, ...] = (
    "gemini",
    "claude",
    "document_ai",
    "indian_kanoon",
    "serper",
)

COST_STORE_LABELS: Dict[str, str] = {
    "gemini": "Gemini (Google)",
    "claude": "Claude (Anthropic)",
    "document_ai": "Document AI (Google)",
    "indian_kanoon": "Indian Kanoon",
    "serper": "Serper (Google Search)",
}


def normalize_aggregate_by_service(by_service: Dict[str, Any] | None) -> Dict[str, Any]:
    """
    Map raw GROUP BY service aggregates to fixed keys with labels.
    `by_service` values may include: cost_inr, cost_usd, total_quantity, record_count.
    """
    raw = by_service or {}
    out: Dict[str, Any] = {}
    for key in COST_STORE_KEYS:
        row = raw.get(key) or {}
        out[key] = {
            "label": COST_STORE_LABELS.get(key, key),
            "cost_inr": float(row.get("cost_inr") or 0),
            "cost_usd": float(row.get("cost_usd") or 0),
            "quantity": int(row.get("total_quantity") or row.get("quantity") or 0),
            "record_count": int(row.get("record_count") or 0),
        }
    return out


def normalize_user_by_service(by_service: Dict[str, Any] | None) -> Dict[str, Any]:
    """Per-user per-service row (from usage_get_user_breakdown)."""
    raw = by_service or {}
    out: Dict[str, Any] = {}
    for key in COST_STORE_KEYS:
        row = raw.get(key) or {}
        out[key] = {
            "label": COST_STORE_LABELS.get(key, key),
            "cost_inr": float(row.get("cost_inr") or 0),
            "cost_usd": float(row.get("cost_usd") or 0),
            "quantity": int(row.get("quantity") or 0),
        }
    return out
