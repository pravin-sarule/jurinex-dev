
import os
import sys
import logging
import json
from dotenv import load_dotenv

# Load envs
load_dotenv()
logging.basicConfig(level=logging.INFO)

from services import draft_db
from services import db as doc_db

def debug_draft():
    draft_id = "333f4d2e-3ca2-4204-b74d-d6a6e429fbcc"
    
    print(f"Inspecting draft {draft_id}...")
    
    with draft_db.get_draft_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT metadata FROM draft_field_data WHERE draft_id = %s",
                (draft_id,)
            )
            row = cur.fetchone()
            
    if not row:
        print("Draft field data not found.")
        return

    metadata = row[0] if row[0] else {}
    print(f"Metadata: {json.dumps(metadata, indent=2)}")
    
    case_id = metadata.get("case_id")
    if not case_id:
        print("No case attached to this draft.")
        return
        
    print(f"Attached Case ID: {case_id}")
    
    # Check best source doc logic
    user_id = 3
    print("Checking best source document logic...")
    best_doc = doc_db.get_best_source_document(case_id, user_id)
    print(f"get_best_source_document returns: {best_doc}")
    
    if best_doc:
         with doc_db.get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM file_chunks WHERE file_id = %s::uuid", (str(best_doc),))
                cnt = cur.fetchone()[0]
                print(f"Reviewing best doc {best_doc}: {cnt} chunks")
                
                cur.execute("SELECT originalname, mimetype, size FROM user_files WHERE id = %s", (str(best_doc),))
                meta = cur.fetchone()
                print(f"File info: {meta}")

if __name__ == "__main__":
    debug_draft()
