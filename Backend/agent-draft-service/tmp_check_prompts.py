import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DRAFT_DATABASE_URL")

def check_agent_prompts():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("SELECT name, agent_type, prompt, model_ids, temperature FROM agent_prompts")
    rows = cur.fetchall()
    for row in rows:
        print(f"Name: {row[0]}")
        print(f"Type: {row[1]}")
        print(f"Model IDs: {row[3]}")
        print(f"Temp: {row[4]}")
        print(f"Prompt: {row[2][:500]}...")
        print("-" * 50)
    cur.close()
    conn.close()

if __name__ == "__main__":
    check_agent_prompts()
