
import os
import sys
import json

# Set up environment
os.environ["DRAFT_DATABASE_URL"] = "postgresql://db_user:Nexintelai_43@35.200.202.69:5432/Draft_DB"

# Add current directory to path so we can import services
sys.path.append(os.getcwd())

from services.draft_db import get_template_fields_with_fallback, list_templates

def check_fallbacks():
    print("--- Checking Template Field Fallbacks ---")
    try:
        templates = list_templates(limit=100) # Get a bunch
        
        for t in templates:
            tid = t['template_id']
            name = t['name'] # list_templates returns 'name'
            category = t['category']
            
            print(f"Checking {name} ({category})...")
            try:
                fields = get_template_fields_with_fallback(tid)
                print(f"  -> Found {len(fields)} fields")
                if len(fields) > 0:
                    print(f"     First field: {fields[0].get('field_label')}")
                else:
                    print(f"  !! NO FIELDS RETURNED !!")
            except Exception as e:
                print(f"  !! ERROR: {e}")
                
    except Exception as e:
        print(f"Fatal Error: {e}")

if __name__ == "__main__":
    check_fallbacks()
