"""
Sync agent instruction files → agent_prompts table in DRAFT_DATABASE_URL.

Uses agent ID for updates (not agent_type) to avoid overwriting other agents
that may share the same agent_type in the DB.

Run:  python sync_db_prompts.py

To find agent IDs:  python sync_db_prompts.py --list
"""
import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DRAFT_DATABASE_URL")
INSTRUCTIONS_DIR = os.path.join(os.path.dirname(__file__), "instructions")

# agent_id (DB primary key) → instruction filename
# Update these IDs if they change (run with --list to verify)
AGENTS_BY_ID = {
    27: "drafter.txt",     # Drafter Agent          (agent_type='drafting')
    31: "critic.txt",      # Jurinex Critic Agent   (agent_type='critic')
    21: "citation.txt",    # CitationAgent          (agent_type='citation')
    32: "injection.txt",   # Jurinex Injection Agent (agent_type='injection')
    30: "injection.txt",   # Autopopulation Agent   (agent_type='autopopulation')
}


def list_agents(conn):
    cur = conn.cursor()
    cur.execute(
        "SELECT id, name, agent_type, temperature, length(prompt) as prompt_len, updated_at "
        "FROM agent_prompts ORDER BY agent_type, id"
    )
    rows = cur.fetchall()
    print(f"{'ID':<5} {'agent_type':<14} {'temp':<6} {'prompt_len':<12} name")
    print("-" * 70)
    for r in rows:
        marker = " ◄" if r[0] in AGENTS_BY_ID else ""
        print(f"{str(r[0]):<5} {str(r[2]):<14} {str(r[3]):<6} {str(r[4]):<12} {r[1]}{marker}")
    cur.close()


def sync_instructions_to_db():
    if not DATABASE_URL:
        print("ERROR: DRAFT_DATABASE_URL not set")
        return

    conn = psycopg2.connect(DATABASE_URL)

    if "--list" in sys.argv:
        list_agents(conn)
        conn.close()
        return

    cur = conn.cursor()
    for agent_id, filename in AGENTS_BY_ID.items():
        filepath = os.path.join(INSTRUCTIONS_DIR, filename)
        if not os.path.exists(filepath):
            print(f"[SKIP] File not found: {filepath}")
            continue

        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read().strip()

        cur.execute("SELECT name, agent_type FROM agent_prompts WHERE id = %s", (agent_id,))
        row = cur.fetchone()
        if not row:
            print(f"[SKIP] No agent found with id={agent_id} — update AGENTS_BY_ID")
            continue

        name, agent_type = row
        cur.execute(
            "UPDATE agent_prompts SET prompt = %s, updated_at = NOW() WHERE id = %s",
            (content, agent_id),
        )
        print(f"[UPDATE] id={agent_id} name={name!r} agent_type={agent_type!r} — {len(content)} chars")

    conn.commit()
    cur.close()
    conn.close()
    print("\nSync complete.")


if __name__ == "__main__":
    sync_instructions_to_db()
