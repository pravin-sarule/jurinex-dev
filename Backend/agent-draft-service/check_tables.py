import os
import psycopg2
from psycopg2.extras import RealDictCursor

def check_schema():
    url = "postgresql://db_user:Nexintelai_43@35.200.202.69:5432/Draft_DB"
    conn = psycopg2.connect(url)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    tables = ['user_drafts', 'drafts', 'draft_field_data', 'section_versions']
    for table in tables:
        print(f"\n--- Schema for {table} ---")
        try:
            cur.execute(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table}' ORDER BY ordinal_position")
            columns = cur.fetchall()
            for col in columns:
                print(f"{col['column_name']}: {col['data_type']}")
        except Exception as e:
            print(f"Error: {e}")
            conn.rollback()
            
    conn.close()

if __name__ == "__main__":
    check_schema()
