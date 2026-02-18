
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv("DB_HOST", "35.200.202.69")
DB_NAME = os.getenv("DB_NAME", "Draft_DB")
DB_USER = os.getenv("DB_USER", "db_user")
DB_PASS = os.getenv("DB_PASS", "Nexintelai_43")

def inspect_constraints():
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASS
        )
        cur = conn.cursor()
        
        print("Checking constraints for table: template_user_field_values")
        cur.execute("""
            SELECT conname, pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid = 'template_user_field_values'::regclass
            AND contype = 'f';
        """)
        
        rows = cur.fetchall()
        for row in rows:
            print(f"Constraint: {row[0]}")
            print(f"Definition: {row[1]}")
            print("-" * 30)
            
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    inspect_constraints()
