import asyncio
from google.adk.agents import Agent
from agents.adk_app import get_or_build_document_runner
from app.core.config import get_settings

async def main():
    settings = get_settings()
    print("Testing gemini-2.5-pro stream via ADK")
    runner, svc, key = get_or_build_document_runner(
        file_id="12345678-1234-1234-1234-123456789012",
        model_name="gemini-2.5-pro",
        system_instruction="You are a helpful assistant.",
    )
    
    print("Runner built. Sending prompt...")
    async for event in runner.run_async(text="Summarize the importance of AI."):
        if event.output:
            print(f"OUTPUT: {event.output}")
        if event.finish_reason:
            print(f"FINISH REASON: {event.finish_reason}")

if __name__ == "__main__":
    asyncio.run(main())
