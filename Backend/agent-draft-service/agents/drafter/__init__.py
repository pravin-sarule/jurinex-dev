"""
Drafter Agent - Google ADK (Gemini) powered legal document drafting.

This agent uses Google's Gemini model to generate legal documents from retrieved context.
See: /instructions/drafter.txt for system prompt.
"""

from agents.drafter.agent import run_drafter_agent

__all__ = ["run_drafter_agent"]
