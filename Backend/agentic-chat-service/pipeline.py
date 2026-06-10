"""ADK pipeline runner for ChatModel requests."""

from __future__ import annotations



import logging

import uuid

from typing import Any



logger = logging.getLogger(__name__)



ROUTE_FILE = "file_based"

ROUTE_LEGAL = "legal_case_content"

ROUTE_GENERAL = "general_content"





def classify_request(body: dict[str, Any]) -> str:

    if body.get("used_secret_prompt") and body.get("secret_id"):

        return ROUTE_LEGAL

    file_ids = body.get("file_ids") or []

    if body.get("file_id"):

        file_ids = [body["file_id"], *file_ids]

    if not file_ids:

        return ROUTE_GENERAL

    return ROUTE_FILE





async def run_adk_chat(state: dict[str, Any]) -> dict[str, Any]:

    """

    Run Google ADK App when installed; otherwise direct route execution.

    """

    route = classify_request(state.get("request_body") or {})

    state["chat_route"] = route

    state["agent_key"] = route



    async def _run_direct_route() -> dict[str, Any]:

        from app.services.chat_orchestrator import stream_document_chat, stream_general_chat



        if route == ROUTE_GENERAL:

            answer = ""

            async for line in stream_general_chat(state):

                if '"type": "done"' in line:

                    import json



                    raw = line.replace("data: ", "").strip()

                    try:

                        answer = json.loads(raw).get("answer", answer)

                    except json.JSONDecodeError:

                        pass

            return {"answer": answer, "route": route, "agent_key": route}

        if route == ROUTE_LEGAL:

            body = dict(state.get("request_body") or {})

            body["used_secret_prompt"] = True

            state["request_body"] = body

            answer = ""

            async for line in stream_document_chat(state):

                if '"type": "done"' in line:

                    import json



                    raw = line.replace("data: ", "").strip()

                    try:

                        answer = json.loads(raw).get("answer", answer)

                    except json.JSONDecodeError:

                        pass

            return {"answer": answer, "route": route, "agent_key": route}



        answer = ""

        async for line in stream_document_chat(state):

            if '"type": "done"' in line:

                import json



                raw = line.replace("data: ", "").strip()

                try:

                    answer = json.loads(raw).get("answer", answer)

                except json.JSONDecodeError:

                    pass

        return {"answer": answer, "route": route, "agent_key": route}



    try:

        from google.adk.runners import Runner

        from google.adk.sessions import InMemorySessionService

        from google.genai import types as genai_types



        from agents.adk_app import build_chat_app



        app = build_chat_app()

        session_service = InMemorySessionService()

        runner = Runner(app=app, session_service=session_service)

        session_id = str(state.get("run_id") or uuid.uuid4())

        await session_service.create_session(

            app_name=app.name,

            user_id=str(state.get("user_id")),

            session_id=session_id,

        )

        initial = genai_types.Content(

            role="user",

            parts=[genai_types.Part(text=f"Process chat request. Route hint: {route}")],

        )



        final_answer = ""

        async for event in runner.run_async(

            user_id=str(state.get("user_id")),

            session_id=session_id,

            new_message=initial,

            state_delta=state,

        ):

            if hasattr(event, "content") and event.content:

                text = getattr(event.content, "text", None)

                if text:

                    final_answer = text



        if state.get("answer"):

            return {

                "answer": state["answer"],

                "route": route,

                "agent_key": route,

                "contextCache": "adk",

            }

        if final_answer:

            logger.warning("ADK completed without tool answer; falling back to direct route execution.")

        return await _run_direct_route()

    except ImportError:

        logger.warning("google-adk not installed — using direct route execution")

    except Exception as exc:

        logger.warning("ADK runner failed (%s) — direct execution", exc)

    return await _run_direct_route()

