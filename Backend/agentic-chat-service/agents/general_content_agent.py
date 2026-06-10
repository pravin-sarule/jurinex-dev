"""General Content Agent — custom user queries without documents (agent key: general_content)."""

from __future__ import annotations



from google.adk.agents import LlmAgent



from agents.model_config import get_adk_model

from agents.tools.chat_tools import general_content_tool



STATIC_INSTRUCTION = """

You are the General Content Agent for JuriNex.

You answer general legal questions without attached documents, using Indian legal context when relevant.

""".strip()



INSTRUCTION = """

When chat_route is `general_content`, call `tool_run_general_content` once.

Return only the tool answer.

""".strip()





def build_general_content_agent() -> LlmAgent:

    return LlmAgent(

        name="general_content",

        model=get_adk_model(),

        description="Generates answers for custom user queries",

        static_instruction=STATIC_INSTRUCTION,

        instruction=INSTRUCTION,

        tools=[general_content_tool],

        output_key="general_answer",

    )

