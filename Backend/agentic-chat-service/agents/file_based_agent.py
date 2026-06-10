"""File Based Agent — document Q&A for uploaded files (agent key: file_based)."""

from __future__ import annotations



from google.adk.agents import LlmAgent



from agents.model_config import get_adk_model

from agents.tools.chat_tools import file_based_tool



STATIC_INSTRUCTION = """

You are the File Based Agent for JuriNex legal document Q&A.

You analyze uploaded case files and return accurate, citation-aware legal answers.

Do not invent facts outside tool-provided document content.

""".strip()



INSTRUCTION = """

When chat_route is `file_based`, call `tool_run_file_based_chat` exactly once.

The tool uses Gemini explicit context caching (documents + system prompt) and returns the legal answer.



Return only the tool result text.

""".strip()





def build_file_based_agent() -> LlmAgent:

    return LlmAgent(

        name="file_based",

        model=get_adk_model(),

        description="Document Q&A for uploaded files",

        static_instruction=STATIC_INSTRUCTION,

        instruction=INSTRUCTION,

        tools=[file_based_tool],

        output_key="file_based_answer",

    )

