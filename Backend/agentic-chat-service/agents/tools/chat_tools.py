"""ADK FunctionTools — bridge Google ADK agents to Python chat services."""
from __future__ import annotations

from typing import Any, Dict

from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext

from app.services.chat_orchestrator import (
    stream_document_chat,
    stream_general_chat,
    stream_judgement_chat,
)
from pipeline import classify_request


async def _collect_stream(stream_fn, ctx: dict[str, Any]) -> str:
    parts: list[str] = []
    async for line in stream_fn(ctx):
        if line.startswith("data: ") and line.strip() != "data: [DONE]":
            import json

            raw = line[6:].strip()
            try:
                parsed = json.loads(raw)
                if parsed.get("type") == "chunk":
                    parts.append(parsed.get("text", ""))
                elif parsed.get("type") == "done" and parsed.get("answer"):
                    return parsed["answer"]
            except json.JSONDecodeError:
                pass
    return "".join(parts)


async def tool_classify_chat_request(tool_context: ToolContext) -> Dict[str, Any]:
    body = dict(tool_context.state.get("request_body") or {})
    route = classify_request(body)
    tool_context.state["chat_route"] = route
    tool_context.state["agent_key"] = route
    return {"route": route, "agent_key": route}


async def tool_run_file_based_chat(tool_context: ToolContext) -> Dict[str, Any]:
    ctx = dict(tool_context.state)
    answer = await _collect_stream(stream_document_chat, ctx)
    tool_context.state["answer"] = answer
    return {"success": True, "answer": answer, "route": "file_based"}


async def tool_run_legal_case_content(tool_context: ToolContext) -> Dict[str, Any]:
    ctx = dict(tool_context.state)
    body = dict(ctx.get("request_body") or {})
    body["used_secret_prompt"] = True
    ctx["request_body"] = body
    answer = await _collect_stream(stream_document_chat, ctx)
    tool_context.state["answer"] = answer
    return {"success": True, "answer": answer, "route": "legal_case_content"}


async def tool_run_general_content(tool_context: ToolContext) -> Dict[str, Any]:
    ctx = dict(tool_context.state)
    answer = await _collect_stream(stream_general_chat, ctx)
    tool_context.state["answer"] = answer
    return {"success": True, "answer": answer, "route": "general_content"}


async def tool_run_judgement_search(tool_context: ToolContext) -> Dict[str, Any]:
    ctx = dict(tool_context.state)
    answer = await _collect_stream(stream_judgement_chat, ctx)
    tool_context.state["answer"] = answer
    return {"success": True, "answer": answer, "route": "judgement_search"}


classify_tool = FunctionTool(tool_classify_chat_request)
file_based_tool = FunctionTool(tool_run_file_based_chat)
legal_content_tool = FunctionTool(tool_run_legal_case_content)
general_content_tool = FunctionTool(tool_run_general_content)
judgement_search_tool = FunctionTool(tool_run_judgement_search)
