#!/usr/bin/env python3
"""
Run ALTER on user_drafts.user_id to TEXT so JWT user ids (e.g. "3") work.
Usage: from agent-draft-service root, with venv active:
  python scripts/run_alter_user_id.py
Requires DRAFT_DATABASE_URL in .env.
"""
import os
import sys
from pathlib import Path

# Load .env from project root
root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))
from dotenv import load_dotenv
load_dotenv(root / ".env")

url = os.environ.get("DRAFT_DATABASE_URL")
if not url:
    print("DRAFT_DATABASE_URL not set in .env")
    sys.exit(1)

import psycopg2

sql = """
ALTER TABLE user_drafts
  ALTER COLUMN user_id TYPE INTEGER USING (0);
"""
try:
    conn = psycopg2.connect(url)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(sql)
    cur.close()
    conn.close()
    print("OK: user_drafts.user_id is now INTEGER.")
except Exception as e:
    print("Error:", e)
    sys.exit(1)
