
import os
import sys
import logging
from dotenv import load_dotenv
from services import db

load_dotenv()

def check_schema():
    with db.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'user_files'
            """)
            rows = cur.fetchall()
            for r in rows:
                print(r)

if __name__ == "__main__":
    check_schema()
