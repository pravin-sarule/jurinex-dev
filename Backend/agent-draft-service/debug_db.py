
import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor

# URL provided by user
DB_URL = "postgresql://db_user:Nexintelai_43@35.200.202.69:5432/Draft_DB"

def check_templates():
    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor(cursor_factory=RealDictCursor)

        print("--- Templates & Fields Check ---")
        
        # Get all templates
        cur.execute("SELECT template_id, template_name, category, status FROM templates ORDER BY template_name")
        templates = cur.fetchall()

        for t in templates:
            tid = t['template_id']
            tname = t['template_name']
            tcat = t['category']
            
            # Check DB fields
            cur.execute("SELECT template_fields FROM template_fields WHERE template_id = %s", (tid,))
            field_row = cur.fetchone()
            
            db_field_count = 0
            db_raw = None
            if field_row and field_row['template_fields']:
                db_raw = field_row['template_fields']
                if isinstance(db_raw, str):
                    try:
                        db_raw = json.loads(db_raw)
                    except:
                        db_raw = []
                
                fields_list = db_raw.get("fields", []) if isinstance(db_raw, dict) else db_raw if isinstance(db_raw, list) else []
                db_field_count = len(fields_list)
            
            print(f"Template: {tname} (ID: {tid})")
            print(f"  Category: {tcat}")
            print(f"  DB Fields: {db_field_count}")
            if db_field_count == 0:
                 print(f"  [WARNING] No fields in DB for {tname}")

        conn.close()

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_templates()
