
import os
import sys
from services import db
from dotenv import load_dotenv

load_dotenv()

def inspect_files():
    with db.get_conn() as conn:
        with conn.cursor() as cur:
            # Check specific files
            filenames = ['correct_draft_en.pdf', '4mb.pdf', 'Drafting_Engine_Task_Distribution.pdf']
            cur.execute("SELECT id, originalname, folder_path FROM user_files WHERE originalname = ANY(%s)", (filenames,))
            rows = cur.fetchall()
            for r in rows:
                print(f"File: {r[1]}, Path: {r[2]}")

if __name__ == "__main__":
    inspect_files()
