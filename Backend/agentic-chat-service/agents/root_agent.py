"""ChatModel root — Google ADK SequentialAgent over classifier + execution agents."""
from __future__ import annotations

from google.adk.agents import SequentialAgent

from agents.file_based_agent import build_file_based_agent
from agents.general_content_agent import build_general_content_agent
from agents.legal_case_content_agent import build_legal_case_content_agent
from agents.query_classifier_agent import build_query_classifier_agent


def build_chat_root_agent() -> SequentialAgent:
    return SequentialAgent(
        name="chat_model_root",
        description=(
            "JuriNex ChatModel ADK pipeline: classify request → "
            "file_based | legal_case_content | general_content"
        ),
        sub_agents=[
            build_query_classifier_agent(),
            build_file_based_agent(),
            build_legal_case_content_agent(),
            build_general_content_agent(),
        ],
    )
