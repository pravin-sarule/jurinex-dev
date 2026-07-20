"""One-off cleanup: deflate whitespace-flood answers stored in file_chats.

Degenerate model output (pre-guard) saved answers containing megabytes of pure
spaces/newlines; loading such a session freezes the frontend into a blank tab.
This compresses whitespace runs (content preserved), caps extreme sizes, and
shrinks bloated chat_history jsonb the same way. Rerunnable; prints a report.

Run:  venv/Scripts/python.exe scripts/compress_whitespace_answers.py
"""
from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.services.chat_repository import sanitize_answer_for_storage  # noqa: E402
from app.services.db import doc_conn  # noqa: E402

SIZE_THRESHOLD = 200_000
HISTORY_ANSWER_CAP = 8_000


def main() -> None:
    fixed_answers = 0
    fixed_histories = 0
    with doc_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, LENGTH(answer) AS n FROM file_chats WHERE LENGTH(answer) > %s",
                (SIZE_THRESHOLD,),
            )
            big_rows = [dict(r) for r in cur.fetchall()]
            print(f"answers > {SIZE_THRESHOLD} chars: {len(big_rows)}")
            for row in big_rows:
                cur.execute("SELECT answer FROM file_chats WHERE id=%s", (row["id"],))
                answer = cur.fetchone()["answer"] or ""
                cleaned = sanitize_answer_for_storage(answer)
                if len(cleaned) < len(answer):
                    cur.execute(
                        "UPDATE file_chats SET answer=%s WHERE id=%s", (cleaned, row["id"])
                    )
                    fixed_answers += 1
                    print(f"  {row['id']}: {row['n']:,} -> {len(cleaned):,} chars")
                else:
                    print(f"  {row['id']}: {row['n']:,} chars — no whitespace bloat, left as-is")

            cur.execute(
                "SELECT id, LENGTH(chat_history::text) AS n FROM file_chats "
                "WHERE chat_history IS NOT NULL AND LENGTH(chat_history::text) > %s",
                (SIZE_THRESHOLD,),
            )
            big_hist = [dict(r) for r in cur.fetchall()]
            print(f"chat_history > {SIZE_THRESHOLD} chars: {len(big_hist)}")
            for row in big_hist:
                cur.execute("SELECT chat_history FROM file_chats WHERE id=%s", (row["id"],))
                hist = cur.fetchone()["chat_history"]
                if isinstance(hist, str):
                    try:
                        hist = json.loads(hist)
                    except json.JSONDecodeError:
                        continue
                if not isinstance(hist, list):
                    continue
                for item in hist:
                    if isinstance(item, dict):
                        for key in ("question", "answer"):
                            val = item.get(key)
                            if isinstance(val, str) and len(val) > HISTORY_ANSWER_CAP:
                                item[key] = (
                                    sanitize_answer_for_storage(val)[:HISTORY_ANSWER_CAP]
                                    + "\n…[truncated]"
                                )
                new_hist = json.dumps(hist, default=str)
                if len(new_hist) < row["n"]:
                    cur.execute(
                        "UPDATE file_chats SET chat_history=%s::jsonb WHERE id=%s",
                        (new_hist, row["id"]),
                    )
                    fixed_histories += 1
                    print(f"  {row['id']}: history {row['n']:,} -> {len(new_hist):,} chars")
        conn.commit()
    print(f"done: {fixed_answers} answers compressed, {fixed_histories} histories compressed")


if __name__ == "__main__":
    main()
