
import os
import psycopg2
from dotenv import load_dotenv

# Load env from parent dir
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(env_path)

url = os.getenv('DRAFT_DATABASE_URL')
if not url:
    print("Error: DRAFT_DATABASE_URL not found")
    exit(1)

try:
    conn = psycopg2.connect(url)
    cur = conn.cursor()
    
    # Read SQL
    sql_path = os.path.join(os.path.dirname(__file__), 'allow_custom_template_fields.sql')
    with open(sql_path, 'r') as f:
        sql = f.read()
    
    print("Executing SQL:", sql)
    cur.execute(sql)
    conn.commit()
    print("Migration applied successfully.")
    
    # Verify constraint is gone
    print("Verifying constraint removal...")
    cur.execute("""
        SELECT conname 
        FROM pg_constraint 
        WHERE conrelid = 'template_user_field_values'::regclass 
        AND conname = 'template_user_field_values_template_id_fkey';
    """)
    if not cur.fetchone():
        print("VERIFIED: Constraint 'template_user_field_values_template_id_fkey' is gone.")
    else:
        print("ERROR: Constraint still exists!")

except Exception as e:
    print(f"Migration failed: {e}")
    exit(1)
finally:
    if 'conn' in locals():
        conn.close()
