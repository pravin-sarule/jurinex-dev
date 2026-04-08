"""
Ports document-service/services/tokenUsageService.js (firm cap path only):

  - checkFirmUserTokenCap
  - enforceLimits

Used by folder intelligent-chat routes to block requests when the payment service
reports enforced=True and allowed=False.
"""
from __future__ import annotations

import logging
import math
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger("agentic_document_service.token_usage")


def estimate_streaming_token_request(
    question_text: str = "",
    *,
    has_secret_prompt: bool = False,
) -> dict[str, int]:
    """
    Mirrors estimateStreamingTokenRequest() in intelligentFolderChatController.js.
    """
    normalized = str(question_text or "").strip()
    question_chars = len(normalized)
    estimated_input_tokens = max(1, math.ceil(question_chars / 4.0))
    context_reserve_tokens = 256 if has_secret_prompt else 128
    estimated_output_tokens = max(
        128,
        math.ceil((estimated_input_tokens + context_reserve_tokens) * 1.2),
    )
    estimated_total_tokens = int(
        estimated_input_tokens + context_reserve_tokens + estimated_output_tokens
    )
    return {
        "question_chars": question_chars,
        "estimated_input_tokens": int(estimated_input_tokens),
        "context_reserve_tokens": context_reserve_tokens,
        "estimated_output_tokens": int(estimated_output_tokens),
        "estimated_total_tokens": estimated_total_tokens,
    }


def estimate_tokens_from_text(text: str | None) -> int:
    """Rough token estimate from chars (same heuristic used across services)."""
    normalized = str(text or "").strip()
    if not normalized:
        return 0
    return max(1, int(math.ceil(len(normalized) / 4.0)))


def check_firm_user_token_cap(user_id: int | None, requested_tokens: int) -> dict[str, Any]:
    """Mirror TokenUsageService.checkFirmUserTokenCap."""
    rt = max(0, int(requested_tokens or 0))
    logger.info(
        "🔒 [TokenUsageService] Firm cap check request received  userId=%s  requestedTokens=%s",
        user_id,
        rt,
    )

    if not user_id or rt <= 0:
        logger.info(
            "🔒 [TokenUsageService] Firm cap check skipped  userId=%s  requestedTokens=%s  "
            "reason=missing_user_or_zero_request",
            user_id,
            rt,
        )
        return {
            "allowed": True,
            "enforced": False,
            "message": "No firm token-cap check required",
        }

    settings = get_settings()
    payment_url = settings.payment_service_url.rstrip("/")

    try:
        resp = httpx.post(
            f"{payment_url}/api/user-resources/internal/firm-token-caps/check",
            json={"userId": user_id, "requestedTokens": rt},
            timeout=5.0,
        )
        resp.raise_for_status()
        cap_data = resp.json().get("data") or {
            "allowed": True,
            "enforced": False,
            "message": "Firm token-cap service returned no data",
        }
        logger.info(
            "🔒 [TokenUsageService] Firm cap check response received  userId=%s  requestedTokens=%s  "
            "status=%s  allowed=%s  enforced=%s  reason=%s  monthlyTokenLimit=%s  "
            "currentMonthTokensUsed=%s  remainingThisMonth=%s  projectedUsage=%s",
            user_id,
            rt,
            resp.status_code,
            cap_data.get("allowed"),
            cap_data.get("enforced"),
            cap_data.get("reason"),
            cap_data.get("monthlyTokenLimit"),
            cap_data.get("currentMonthTokensUsed"),
            cap_data.get("remainingThisMonth"),
            cap_data.get("projectedUsage"),
        )
        return cap_data
    except Exception as exc:
        logger.error(
            "❌ [TokenUsageService] Error checking firm-user token cap  userId=%s  requestedTokens=%s  error=%s",
            user_id,
            rt,
            exc,
        )
        return {
            "allowed": True,
            "enforced": False,
            "message": "Firm token-cap check unavailable, continuing with unlimited access",
        }


def enforce_limits(
    user_id: int | None,
    requested_resources: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Mirror TokenUsageService.enforceLimits(userId, null, null, { tokens }).

    Returns keys: allowed, message, and when blocked: details, remainingTokens, capStatus.
    When allowed: remainingTokens ~ unlimited sentinel (matches Node).
    """
    req = requested_resources or {}
    tokens = max(0, int(req.get("tokens") or 0))

    logger.info(
        "🔒 [TokenUsageService] Limit enforcement started  userId=%s  requestedResources=%s",
        user_id,
        req,
    )

    firm_cap_check = check_firm_user_token_cap(user_id, tokens)

    logger.info(
        "🔒 [TokenUsageService] Limit enforcement cap result  userId=%s  requestedTokens=%s  "
        "allowed=%s  enforced=%s  reason=%s  monthlyTokenLimit=%s  currentMonthTokensUsed=%s  "
        "remainingThisMonth=%s",
        user_id,
        tokens,
        firm_cap_check.get("allowed"),
        firm_cap_check.get("enforced"),
        firm_cap_check.get("reason"),
        firm_cap_check.get("monthlyTokenLimit"),
        firm_cap_check.get("currentMonthTokensUsed"),
        firm_cap_check.get("remainingThisMonth"),
    )

    if firm_cap_check.get("enforced") and not firm_cap_check.get("allowed"):
        remaining = firm_cap_check.get("remainingThisMonth")
        if not isinstance(remaining, (int, float)) or not math.isfinite(float(remaining)):
            remaining = 0
        current_month = firm_cap_check.get("currentMonthTokensUsed")
        if not isinstance(current_month, (int, float)) or not math.isfinite(float(current_month)):
            current_month = 0
        monthly_limit = firm_cap_check.get("monthlyTokenLimit")
        if not isinstance(monthly_limit, (int, float)) or not math.isfinite(float(monthly_limit)):
            monthly_limit = 0

        message = (
            "Your token quota has been exceeded. "
            "Please talk to your firm admin to extend your tokens or update your token quota."
        )
        details = (
            f"Current month usage: {int(current_month)}/{int(monthly_limit)} tokens. "
            f"Remaining tokens: {int(remaining)}."
        )

        logger.warning(
            "⛔ [TokenUsageService] Limit enforcement blocked request  userId=%s  requestedTokens=%s  "
            "currentMonthTokensUsed=%s  monthlyTokenLimit=%s  remaining=%s",
            user_id,
            tokens,
            current_month,
            monthly_limit,
            remaining,
        )

        return {
            "allowed": False,
            "message": message,
            "details": details,
            "remainingTokens": int(remaining),
            "capStatus": firm_cap_check,
        }

    logger.info(
        "✅ [TokenUsageService] Limit enforcement passed  userId=%s  requestedTokens=%s  "
        "message=Unlimited document service access",
        user_id,
        tokens,
    )
    return {
        "allowed": True,
        "message": "Unlimited document service access",
        "remainingTokens": 999_999_999,
    }


def log_llm_usage(
    *,
    user_id: int | None,
    model_name: str,
    input_tokens: int,
    output_tokens: int,
    endpoint: str,
    request_id: str | None = None,
    file_id: str | None = None,
    session_id: str | None = None,
) -> bool:
    """
    Push usage to payment-service llm_usage_logs sink so firm analytics and
    firm token-cap checks reflect live usage.
    """
    if not user_id or not model_name:
        logger.info(
            "📊 [TokenUsageService] Skip usage log userId=%s model=%s reason=missing_user_or_model",
            user_id,
            model_name,
        )
        return False

    it = max(0, int(input_tokens or 0))
    ot = max(0, int(output_tokens or 0))
    payload = {
        "userId": int(user_id),
        "modelName": str(model_name),
        "inputTokens": it,
        "outputTokens": ot,
        "endpoint": endpoint,
        "requestId": request_id,
        "fileId": file_id,
        "sessionId": session_id,
    }
    settings = get_settings()
    payment_url = settings.payment_service_url.rstrip("/")

    logger.info(
        "📊 [TokenUsageService] Usage log request userId=%s endpoint=%s model=%s input=%s output=%s requestId=%s sessionId=%s",
        user_id,
        endpoint,
        model_name,
        it,
        ot,
        request_id,
        session_id,
    )
    try:
        resp = httpx.post(
            f"{payment_url}/api/user-resources/llm-usage-log",
            json=payload,
            timeout=5.0,
        )
        resp.raise_for_status()
        logger.info(
            "📊 [TokenUsageService] Usage log success userId=%s endpoint=%s status=%s",
            user_id,
            endpoint,
            resp.status_code,
        )
        return True
    except Exception as exc:
        logger.error(
            "❌ [TokenUsageService] Usage log failed userId=%s endpoint=%s error=%s",
            user_id,
            endpoint,
            exc,
        )
        return False
