"""
Session and message persistence for chat_sessions / chat_messages tables.

Every text-chat exchange saves:
  - A chat_sessions row on first message (returns session_id)
  - A chat_messages row for the user question  (role = 'user')
  - A chat_messages row for the assistant answer (role = 'assistant')
  - Updates last_active_at on the session each turn
"""
from __future__ import annotations

import logging

from app.services.db import get_db_connection, is_db_available

logger = logging.getLogger("ai_chatbot.session")


def get_or_create_session(session_id: str | None, mode: str = "text") -> str:
    """
    Returns an existing session_id if valid, otherwise creates a new session
    and returns its UUID string.
    """
    if not is_db_available():
        return session_id or "no-db"

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            if session_id:
                cur.execute(
                    "SELECT id FROM chat_sessions WHERE id = %s LIMIT 1",
                    (session_id,),
                )
                row = cur.fetchone()
                if row:
                    return str(row["id"])

            # Create a new session
            cur.execute(
                "INSERT INTO chat_sessions (mode) VALUES (%s) RETURNING id",
                (mode,),
            )
            new_row = cur.fetchone()
        conn.commit()

    return str(new_row["id"])


def save_exchange(session_id: str, question: str, answer: str) -> None:
    """
    Persists a user question + assistant answer pair and bumps last_active_at.
    Silently skips if the DB is unavailable.
    """
    if not is_db_available():
        return

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO chat_messages (session_id, role, content) VALUES (%s, %s, %s)",
                    (session_id, "user", question),
                )
                cur.execute(
                    "INSERT INTO chat_messages (session_id, role, content) VALUES (%s, %s, %s)",
                    (session_id, "assistant", answer),
                )
                cur.execute(
                    "UPDATE chat_sessions SET last_active_at = NOW() WHERE id = %s",
                    (session_id,),
                )
            conn.commit()
    except Exception as exc:
        logger.warning("save_exchange failed (non-fatal): %s", exc)


def get_history(session_id: str, limit: int = 20) -> list[dict]:
    """
    Returns the last `limit` messages for the session, oldest first.
    Each dict has: role, content, created_at
    """
    if not is_db_available():
        return []

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT role, content, created_at
                FROM chat_messages
                WHERE session_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (session_id, limit),
            )
            rows = cur.fetchall()

    return list(reversed([dict(r) for r in rows]))
