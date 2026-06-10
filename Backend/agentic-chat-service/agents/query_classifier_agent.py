"""Query Classifier — classifies case chat request and strategy (agent key: query_classifier)."""

from __future__ import annotations



from google.adk.agents import LlmAgent



from agents.model_config import get_adk_model

from agents.tools.chat_tools import classify_tool



STATIC_INSTRUCTION = """

You are the Query Classifier for JuriNex ChatModel.

You only classify requests; you never answer legal questions directly.

""".strip()



INSTRUCTION = """

Call `tool_classify_chat_request` once, then stop.



Classification rules (encoded in the tool):

- `legal_case_content` when used_secret_prompt is true

- `general_content` when no file_id / file_ids are provided

- `file_based` for standard document Q&A on uploaded files

""".strip()





def build_query_classifier_agent() -> LlmAgent:

    return LlmAgent(

        name="query_classifier",

        model=get_adk_model(),

        description="Classifies case chat request and strategy",

        static_instruction=STATIC_INSTRUCTION,

        instruction=INSTRUCTION,

        tools=[classify_tool],

        output_key="classification_summary",

    )

