
import sys
import os
import json
from dotenv import load_dotenv
load_dotenv()

from services import draft_db
from api.draft_routes import get_template_user_field_values

# Hardcoded IDs from the user's terminal output/context
TEMPLATE_ID = "3a50b4c7-3685-41f6-9b18-9432d680a0c2"
USER_ID = 3
DRAFT_SESSION_ID = "f296c3b6-4db0-4707-9aea-6fd195b9de38" # From recent logs

def check_template_fields():
    print(f"\n--- Checking get_template_fields('{TEMPLATE_ID}') ---")
    fields = draft_db.get_template_fields(TEMPLATE_ID)
    print(f"Found {len(fields)} fields.")
    if len(fields) > 0:
        print("First 3 fields:")
        for f in fields[:3]:
            print(json.dumps(f, indent=2))
    else:
        print("!!! NO FIELDS FOUND - JSON parsing might still be wrong or DB invalid !!!")

def check_user_values():
    print(f"\n--- Checking get_existing_user_field_values ---")
    vals = draft_db.get_existing_user_field_values(TEMPLATE_ID, USER_ID, DRAFT_SESSION_ID)
    if vals:
        print("Found user values:")
        print(f"Filled by: {vals.get('filled_by')}")
        print(f"Extraction status: {vals.get('extraction_status')}")
        fv = vals.get('field_values', {})
        print(f"Field Values count: {len(fv)}")
        print(json.dumps(fv, indent=2))
    else:
        print("!!! NO USER VALUES FOUND in DB !!!")

def check_draft_details():
    print(f"\n--- Checking get_user_draft ---")
    draft = draft_db.get_user_draft(DRAFT_SESSION_ID, USER_ID)
    if draft:
        print(f"Draft found. Template ID: {draft.get('template_id')}")
        print(f"Draft fields count: {len(draft.get('fields', []))}")
        print(f"Draft field_values count: {len(draft.get('field_values', {}))}")
    else:
        print("!!! DRAFT NOT FOUND !!!")

if __name__ == "__main__":
    try:
        check_template_fields()
        check_user_values()
        check_draft_details()
    except Exception as e:
        print(f"Not crashing, but error: {e}")
