"""
Critic Agent - Google ADK (Gemini) powered draft validation.

This agent uses Google's Gemini model to validate legal drafts for correctness and completeness.
See: /instructions/critic.txt for system prompt.
"""

from agents.critic.agent import run_critic_agent

__all__ = ["run_critic_agent"]
