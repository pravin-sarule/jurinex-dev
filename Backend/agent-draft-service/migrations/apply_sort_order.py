
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
    sql_path = os.path.join(os.path.dirname(__file__), 'add_sort_order_to_section_prompts.sql')
    with open(sql_path, 'r') as f:
        sql = f.read()
    
    print("Executing Sort Order Migration...")
    cur.execute(sql)
    conn.commit()
    print("Sort Order Migration applied successfully.")
    
    # Verify columns
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'dt_draft_section_prompts';")
    columns = [row[0] for row in cur.fetchall()]
    print("Current columns:", columns)
    
    if 'sort_order' in columns:
        print("VERIFIED: sort_order column exists.")
    else:
        print("ERROR: sort_order column still missing!")

except Exception as e:
    print(f"Migration failed: {e}")
    exit(1)
