import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DRAFT_DATABASE_URL")

def get_drafting_prompt():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("SELECT name, prompt FROM agent_prompts WHERE agent_type = 'drafting'")
    row = cur.fetchone()
    if row:
        print(f"### DRAFTING AGENT PROMPT ({row[0]}) ###")
        print(row[1])
    else:
        print("No drafting agent found.")
    cur.close()
    conn.close()

if __name__ == "__main__":
    get_drafting_prompt()
