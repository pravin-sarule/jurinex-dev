
import os
import sys
import logging
from dotenv import load_dotenv

# Load envs
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from services import db as doc_db
from agents.ingestion.injection_agent import run_injection_agent

def verify():
    case_id = "109" 
    user_id = 3
    template_id = "3a50b4c7-3685-41f6-9b18-9432d680a0c2"

    print(f"Testing get_best_source_document for case {case_id}...")
    source_doc_id = doc_db.get_best_source_document(case_id, user_id)
    print(f"Best Source Doc ID: {source_doc_id}")
    
    if not source_doc_id:
        print("FAIL: No source document found.")
        return

    print(f"Running InjectionAgent with source_doc_id={source_doc_id}...")
    payload = {
        "template_id": template_id,
        "user_id": user_id,
        "draft_session_id": "verify_fix_final_v2",
        "source_document_id": source_doc_id,
    }
    
    try:
        res = run_injection_agent(payload)
        print("\n--- Agent Result ---")
        print(f"Status: {res.get('status')}")
        print(f"Extracted: {len(res.get('extracted_fields', {}))} fields")
        print(f"Keys: {list(res.get('extracted_fields', {}).keys())}")
    except Exception as e:
        print(f"Agent failed: {e}")

if __name__ == "__main__":
    verify()
