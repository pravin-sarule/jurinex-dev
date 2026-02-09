
import os
import psycopg2
from dotenv import load_dotenv

# Load env
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
    sql_path = os.path.join(os.path.dirname(__file__), 'add_name_type_to_section_prompts.sql')
    with open(sql_path, 'r') as f:
        sql = f.read()
    
    print("Executing SQL...")
    cur.execute(sql)
    conn.commit()
    print("Migration applied successfully.")
    
    # Verify columns
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'dt_draft_section_prompts';")
    columns = [row[0] for row in cur.fetchall()]
    print("Current columns:", columns)
    
    if 'section_name' in columns and 'section_type' in columns:
        print("VERIFIED: section_name and section_type columns exist.")
    else:
        print("ERROR: Columns still missing after migration!")

except Exception as e:
    print(f"Migration failed: {e}")
    exit(1)
