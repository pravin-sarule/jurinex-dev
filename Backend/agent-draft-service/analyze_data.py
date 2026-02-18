
import os
import sys
import logging
from dotenv import load_dotenv
from services import db

load_dotenv()

def analyze():
    print("--- CASES ---")
    with db.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, case_title, folder_id FROM cases ORDER BY id DESC LIMIT 10")
            cases = cur.fetchall()
            for c in cases:
                print(f"Case: {c[0]}, Title: {c[1]}, FolderID: {c[2]}")
                
                # Check files for this folder_id
                if c[2]:
                    cur.execute("SELECT COUNT(*) FROM user_files WHERE folder_id = %s::uuid AND is_folder = false", (str(c[2]),))
                    cnt = cur.fetchone()[0]
                    print(f"  -> Has {cnt} files linked via folder_id")
                    
                    # Check files via folder_path (OLD METHOD)
                    cur.execute("SELECT folder_path FROM user_files WHERE id = %s::uuid", (str(c[2]),))
                    row = cur.fetchone()
                    if row:
                        path = row[0]
                        cur.execute("SELECT COUNT(*) FROM user_files WHERE folder_path = %s OR folder_path LIKE %s", (path, path + "/%"))
                        cnt_path = cur.fetchone()[0]
                        print(f"  -> Has {cnt_path} files linked via folder_path ('{path}')")

if __name__ == "__main__":
    analyze()
