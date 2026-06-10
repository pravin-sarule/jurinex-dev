import asyncio
from app.services.gemini_cache_service import ask_with_context_cache
from app.api.dependencies import get_db

async def main():
    try:
        # We need a valid file_id and user_id. Let's get one from the db
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, user_id FROM files LIMIT 1")
                row = cur.fetchone()
                if not row:
                    print("No files found")
                    return
                file_id = row["id"]
                user_id = row["user_id"]
        
        print(f"Testing with file_id: {file_id}, user_id: {user_id}")
        async for ev in ask_with_context_cache(
            file_id=str(file_id),
            question="Acknowledge the document context.",
            user_id=str(user_id),
            file_specs=[{"buffer": b"test", "mimetype": "text/plain", "filename": "test.txt"}],
            system_instruction="Test system instruction",
            model_name="gemini-2.5-flash",
            llm_config={},
            chat_session_id=f"prime-{file_id}",
        ):
            print(ev)
    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
