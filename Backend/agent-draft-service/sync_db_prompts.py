import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DRAFT_DATABASE_URL")
INSTRUCTIONS_FILE = r"c:\Users\ADMIN\jurinex-dev\Backend\agent-draft-service\instructions\drafter.txt"

def sync_instructions_to_db():
    if not os.path.exists(INSTRUCTIONS_FILE):
        print(f"File not found: {INSTRUCTIONS_FILE}")
        return

    with open(INSTRUCTIONS_FILE, "r", encoding="utf-8") as f:
        content = f.read().strip()

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    
    # Check if a drafting agent exists
    cur.execute("SELECT id FROM agent_prompts WHERE agent_type = 'drafting'")
    row = cur.fetchone()
    
    if row:
        print(f"Updating existing drafting agent prompt (ID: {row[0]})")
        cur.execute(
            "UPDATE agent_prompts SET prompt = %s, updated_at = NOW() WHERE agent_type = 'drafting'",
            (content,)
        )
    else:
        print("Creating new drafting agent entry in DB")
        cur.execute(
            "INSERT INTO agent_prompts (name, prompt, agent_type, created_at, updated_at) VALUES (%s, %s, %s, NOW(), NOW())",
            ("Drafter Agent", content, "drafting")
        )
    
    conn.commit()
    cur.close()
    conn.close()
    print("Database sync complete.")

if __name__ == "__main__":
    sync_instructions_to_db()
