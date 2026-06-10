import asyncio
import sys
import traceback
sys.path.insert(0, '.')

from app.services.gemini_cache_service import ask_with_context_cache, _upsert_adk_cache_session, DEFAULT_CACHE_MODEL, _now, doc_conn

async def test_upsert():
    try:
        with doc_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id, user_id FROM files LIMIT 1")
            row = cur.fetchone()
            if not row:
                print("No file found")
                return
            
            file_id = str(row["id"])
            user_id = str(row["user_id"])
        
        print(f"Testing upsert for file_id: {file_id}")
        session_id = await _upsert_adk_cache_session(
            file_id=file_id,
            user_id=user_id,
            model_name="gemini-2.5-flash",
            adk_cache_name="test-adk-cache",
            adk_expire_time=_now().timestamp() + 3600,
            system_instruction="Test",
            document_tokens=100
        )
        print("Upsert result session_id:", session_id)
        
    except Exception as e:
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_upsert())
