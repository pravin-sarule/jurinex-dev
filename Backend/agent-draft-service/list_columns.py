
import os
import sys
from services import db
from dotenv import load_dotenv

load_dotenv()

def list_columns():
    with db.get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM user_files LIMIT 0")
            colnames = [desc[0] for desc in cur.description]
            print(f"Columns: {colnames}")

if __name__ == "__main__":
    list_columns()
