"""
Assembler Agent - Google ADK (Gemini) powered document assembly.

This agent uses Google's Gemini model to format and assemble final legal documents.
See: /instructions/assembler.txt for system prompt.
"""

from agents.assembler.agent import run_assembler_agent

__all__ = ["run_assembler_agent"]
