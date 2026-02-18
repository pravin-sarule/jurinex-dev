import os
import psycopg2

# Get DB URL from env or use default (same as other scripts)
DB_URL = os.environ.get("DRAFT_DATABASE_URL", "postgresql://jurinex_user:yourpassword@localhost:5432/jurinex_draft_db")

def run_migration():
    print(f"Connecting to {DB_URL}...")
    try:
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor()
        
        # Read SQL file
        with open("migrations/allow_custom_template_drafts.sql", "r") as f:
            sql = f.read()
            
        print("Executing migration...")
        print(sql)
        
        cur.execute(sql)
        conn.commit()
        print("Migration successful: fk_template_draft dropped.")
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()

if __name__ == "__main__":
    run_migration()
