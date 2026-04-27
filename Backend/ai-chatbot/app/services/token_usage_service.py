"""
Persist per-request token usage (input + output) to chatbot_token_usage table.
Called after every text or audio AI interaction.
"""
from __future__ import annotations

import logging

from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("ai_chatbot.token_usage")


def log_token_usage(
    *,
    session_id: str | None,
    mode: str,
    model_name: str,
    input_tokens: int,
    output_tokens: int,
    ip_address: str | None,
) -> None:
    if not is_db_available():
        logger.debug("DB unavailable — skipping token usage log")
        return
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chatbot_token_usage
                        (session_id, mode, model_name, input_tokens, output_tokens, ip_address)
                    VALUES (%s, %s, %s, %s, %s, %s::inet)
                    """,
                    (session_id, mode, model_name, input_tokens, output_tokens, ip_address),
                )
                conn.commit()
        logger.info(
            "Token usage logged mode=%s model=%s input=%d output=%d ip=%s session=%s",
            mode, model_name, input_tokens, output_tokens, ip_address, session_id,
        )
    except Exception:
        logger.exception("Failed to log token usage")
