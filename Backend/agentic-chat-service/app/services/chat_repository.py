from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from typing import Any

from app.services.db import doc_conn
from app.services.chat_helpers import is_valid_uuid, parse_attached_files_cell

MAX_HISTORY = 20


class _SafeEncoder(json.JSONEncoder):
    """Encode UUID and datetime objects that psycopg may return as Python types."""

    def default(self, o: Any) -> Any:
        if isinstance(o, uuid.UUID):
            return str(o)
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        return super().default(o)


class FileRepository:
    @staticmethod
    def create(
        user_id: str,
        originalname: str,
        gcs_path: str,
        mimetype: str,
        size: int,
        status: str = "uploaded",
    ) -> dict[str, Any]:
        file_id = str(uuid.uuid4())
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO user_files (id, user_id, originalname, gcs_path, mimetype, size, status, created_at)
                    VALUES (%s::uuid, %s, %s, %s, %s, %s, %s, NOW())
                    RETURNING *
                    """,
                    (file_id, user_id, originalname, gcs_path, mimetype, size, status),
                )
                row = cur.fetchone()
            conn.commit()
        return dict(row) if row else {}

    @staticmethod
    def find_by_id(file_id: str) -> dict[str, Any] | None:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM user_files WHERE id = %s::uuid", (file_id,))
                row = cur.fetchone()
        return dict(row) if row else None

    @staticmethod
    def find_by_user(user_id: str) -> list[dict[str, Any]]:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM user_files
                    WHERE user_id = %s AND (is_folder IS NULL OR is_folder = false)
                    ORDER BY created_at DESC
                    """,
                    (user_id,),
                )
                rows = cur.fetchall()
        return [dict(r) for r in rows]


class FileChatRepository:
    @staticmethod
    def save_chat(
        file_id: str | None,
        user_id: str,
        question: str,
        answer: str,
        session_id: str | None = None,
        used_secret_prompt: bool = False,
        prompt_label: str | None = None,
        secret_id: str | None = None,
        chat_history: list | None = None,
        attached_files: Any = None,
        chat_type: str = "chat_model",
    ) -> dict[str, Any]:
        sid = session_id if is_valid_uuid(session_id) else str(uuid.uuid4())
        fid = file_id if is_valid_uuid(file_id) else None
        sec = secret_id if is_valid_uuid(secret_id) else None
        hist = json.dumps((chat_history or [])[-MAX_HISTORY:], cls=_SafeEncoder)
        attached = json.dumps(attached_files, cls=_SafeEncoder) if attached_files is not None else None

        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO file_chats
                      (file_id, user_id, question, answer, session_id, used_chunk_ids,
                       used_secret_prompt, prompt_label, secret_id, chat_history, attached_files, chat_type, created_at)
                    VALUES (%s::uuid, %s, %s, %s, %s::uuid, %s, %s, %s, %s::uuid, %s::jsonb, %s::jsonb, %s, NOW())
                    RETURNING id, session_id, created_at
                    """,
                    (
                        fid,
                        user_id,
                        question,
                        answer,
                        sid,
                        [],
                        used_secret_prompt,
                        prompt_label,
                        sec,
                        hist,
                        attached,
                        chat_type,
                    ),
                )
                row = cur.fetchone()
                inserted = dict(row) if row else {"session_id": sid}
                if inserted.get("id"):
                    updated = (chat_history or []) + [
                        {
                            "id": inserted["id"],
                            "question": question,
                            "answer": answer,
                            "created_at": inserted.get("created_at"),
                        }
                    ]
                    cur.execute(
                        "UPDATE file_chats SET chat_history = %s::jsonb WHERE id = %s",
                        (json.dumps(updated[-MAX_HISTORY:], cls=_SafeEncoder), inserted["id"]),
                    )
            conn.commit()
        return inserted

    @staticmethod
    def get_history(file_id: str, session_id: str | None = None) -> list[dict[str, Any]]:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                if session_id and is_valid_uuid(session_id):
                    cur.execute(
                        """
                        SELECT id, file_id, user_id, question, answer, session_id, used_chunk_ids,
                               used_secret_prompt, prompt_label, secret_id, chat_history, attached_files, created_at
                        FROM file_chats WHERE file_id = %s::uuid AND session_id = %s::uuid
                        ORDER BY created_at ASC
                        """,
                        (file_id, session_id),
                    )
                else:
                    cur.execute(
                        """
                        SELECT id, file_id, user_id, question, answer, session_id, used_chunk_ids,
                               used_secret_prompt, prompt_label, secret_id, chat_history, attached_files, created_at
                        FROM file_chats WHERE file_id = %s::uuid ORDER BY created_at ASC
                        """,
                        (file_id,),
                    )
                rows = cur.fetchall()
        return [dict(r) for r in rows]

    @staticmethod
    def get_general_history(user_id: str, session_id: str) -> list[dict[str, Any]]:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, question, answer, session_id, created_at
                    FROM file_chats
                    WHERE user_id = %s AND session_id = %s::uuid AND file_id IS NULL AND chat_type = 'chat_model'
                    ORDER BY created_at ASC
                    """,
                    (user_id, session_id),
                )
                rows = cur.fetchall()
        return [dict(r) for r in rows]

    @staticmethod
    def get_general_sessions(user_id: str) -> dict[str, Any]:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT session_id,
                           MIN(created_at) AS first_message_at,
                           MAX(created_at) AS last_message_at,
                           COUNT(*)::int AS message_count,
                           (array_agg(question ORDER BY created_at ASC))[1] AS first_question,
                           (array_agg(question ORDER BY created_at DESC))[1] AS last_question
                    FROM file_chats
                    WHERE user_id = %s AND file_id IS NULL AND chat_type = 'chat_model'
                    GROUP BY session_id
                    ORDER BY MAX(created_at) DESC
                    """,
                    (user_id,),
                )
                rows = cur.fetchall()
        sessions = [
            {
                "session_id": r["session_id"],
                "first_message_at": r["first_message_at"],
                "last_message_at": r["last_message_at"],
                "message_count": r["message_count"],
                "first_question": r["first_question"],
                "last_question": r["last_question"],
                "is_general_chat": True,
            }
            for r in (dict(x) for x in rows)
        ]
        return {"sessions": sessions, "count": len(sessions)}

    @staticmethod
    def get_document_sessions_for_file(file_id: str) -> list[dict[str, Any]]:
        rows = FileChatRepository.get_history(file_id, None)
        sessions_map: dict[str, dict[str, Any]] = {}
        for row in rows:
            sid = str(row.get("session_id"))
            if sid not in sessions_map:
                sessions_map[sid] = {
                    "session_id": sid,
                    "message_count": 0,
                    "first_message_at": row.get("created_at"),
                    "last_message_at": row.get("created_at"),
                    "messages": [],
                }
            s = sessions_map[sid]
            s["message_count"] += 1
            s["messages"].append(
                {
                    "id": row.get("id"),
                    "question": row.get("question"),
                    "answer": row.get("answer"),
                    "created_at": row.get("created_at"),
                }
            )
            if row.get("created_at") and row["created_at"] < s["first_message_at"]:
                s["first_message_at"] = row["created_at"]
            if row.get("created_at") and row["created_at"] > s["last_message_at"]:
                s["last_message_at"] = row["created_at"]
        return sorted(sessions_map.values(), key=lambda x: x["last_message_at"], reverse=True)

    @staticmethod
    def get_all_document_sessions(user_id: str) -> dict[str, Any]:
        with doc_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT fc.session_id, fc.file_id, f.originalname AS filename,
                           MIN(fc.created_at) AS first_message_at,
                           MAX(fc.created_at) AS last_message_at,
                           COUNT(*)::int AS message_count,
                           (array_agg(fc.question ORDER BY fc.created_at ASC))[1] AS first_question,
                           (array_agg(fc.question ORDER BY fc.created_at DESC))[1] AS last_question
                    FROM file_chats fc
                    LEFT JOIN user_files f ON f.id = fc.file_id
                    WHERE fc.user_id = %s AND fc.file_id IS NOT NULL AND fc.chat_type = 'chat_model'
                    GROUP BY fc.session_id, fc.file_id, f.originalname
                    ORDER BY MAX(fc.created_at) DESC
                    """,
                    (user_id,),
                )
                rows = cur.fetchall()
        sessions = [
            {
                **dict(r),
                "is_general_chat": False,
            }
            for r in rows
        ]
        return {"sessions": sessions, "count": len(sessions)}
