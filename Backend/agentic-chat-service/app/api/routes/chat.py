from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from starlette.requests import ClientDisconnect
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.services.db import doc_conn
from app.services.gemini_pricing import DEFAULT_CACHE_MODEL
from app.services import chat_orchestrator, gemini_cache_service
from app.services.chat_repository import FileChatRepository, FileRepository
from app.services.gcs_service import download_object_buffer
from app.services.llm_config_service import get_llm_config, merge_request_overrides
from app.services.llm_policy_service import assert_chat_allowed
from app.services.payment_token_guard import check_token_availability
from app.services.secret_prompt_service import get_secret_prompt_by_id, list_secret_prompts
from app.services.system_prompt_service import build_profile_query_prefix, build_system_instruction
from app.services.token_usage_log import log_token_usage_table
from app.services.user_profile_service import get_full_profile
from pipeline import run_adk_chat

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _default_cache_model(body: dict[str, Any] | None = None) -> str:
    b = body or {}
    return (
        b.get("modelName")
        or b.get("model_name")
        or get_settings().adk_model
        or DEFAULT_CACHE_MODEL
    ).strip()


def _profile_field(profile: dict[str, Any] | None, key: str) -> str | None:
    if not profile:
        return None
    basic = profile.get("basic") or {}
    professional = profile.get("professional") or {}
    for source in (basic, professional, profile):
        val = source.get(key)
        if val:
            return str(val).strip()
    return None


def _profile_name(profile: dict[str, Any] | None) -> str | None:
    if not profile:
        return None
    basic = profile.get("basic") or {}
    professional = profile.get("professional") or {}
    for val in (
        basic.get("username"),
        professional.get("fullname"),
        basic.get("email"),
        professional.get("email"),
        profile.get("full_name"),
        profile.get("name"),
    ):
        if val:
            return str(val).strip()
    return None


def _is_profile_lookup_question(question: str) -> bool:
    q = (question or "").strip().lower()
    if not q:
        return False
    keys = ("what is my name", "my name", "who am i", "my email", "my role", "my organization", "my profile")
    return any(k in q for k in keys)


def _build_profile_lookup_answer(profile: dict[str, Any] | None) -> str:
    name = _profile_name(profile) or "Not set"
    email = _profile_field(profile, "email") or "Not set"
    role = _profile_field(profile, "primary_role") or "Not set"
    org = _profile_field(profile, "organization_name") or "Not set"
    jurisdiction = _profile_field(profile, "primary_jurisdiction") or "Not set"
    return (
        "Here are your current profile details:\n"
        f"- Name: {name}\n"
        f"- Email: {email}\n"
        f"- Role: {role}\n"
        f"- Organization: {org}\n"
        f"- Jurisdiction: {jurisdiction}"
    )


async def _read_body(request: Request) -> dict[str, Any]:
    if hasattr(request.state, "json_body"):
        return request.state.json_body  # type: ignore[attr-defined]
    try:
        data = await request.json()
        request.state.json_body = data
        return data
    except ClientDisconnect:
        return {}
    except Exception:
        return {}


async def _policy_check(user: dict, body: dict[str, Any] | None = None) -> tuple[dict, dict, dict]:
    uid = int(user["id"])
    estimated = 0
    if body:
        estimated = max(0, int(body.get("estimated_tokens") or body.get("estimatedTokens") or 0))
    token_check = await check_token_availability(uid, estimated_tokens=estimated, service="agentic-chat-service")
    if not token_check.get("ok"):
        code = token_check.get("code")
        status = 503 if code == "TOKEN_CHECK_UNAVAILABLE" else 429
        raise HTTPException(status_code=status, detail=token_check)
    cfg = await get_llm_config(user["id"])
    check = assert_chat_allowed(uid, cfg)
    if not check.get("ok"):
        code = check.get("code")
        status = 503 if code == "POLICY_CHECK_UNAVAILABLE" else 429
        raise HTTPException(status_code=status, detail=check)
    merged = merge_request_overrides(cfg, body or {})
    return user, cfg, merged


@router.get("/limits")
async def get_limits(user: dict = Depends(get_current_user)):
    return await chat_orchestrator.get_limits_payload(user["id"])


@router.get("/storage/usage")
async def get_storage_usage(user: dict = Depends(get_current_user)):
    uid = str(user["id"])
    try:
        with doc_conn() as conn:
            file_row = conn.execute(
                """SELECT COUNT(*)::int AS file_count,
                          COALESCE(SUM(size), 0)::bigint AS files_bytes
                   FROM user_files
                   WHERE user_id = %s AND (is_folder IS NULL OR is_folder = FALSE)""",
                (uid,),
            ).fetchone() or {}
            chat_row = conn.execute(
                """SELECT COUNT(*)::int AS chat_count,
                          COALESCE(SUM(
                            OCTET_LENGTH(COALESCE(question, '')) +
                            OCTET_LENGTH(COALESCE(answer, ''))
                          ), 0)::bigint AS chat_bytes
                   FROM file_chats WHERE user_id = %s""",
                (uid,),
            ).fetchone() or {}
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to calculate storage usage") from exc

    files_bytes = int(file_row.get("files_bytes") or 0)
    chat_bytes  = int(chat_row.get("chat_bytes") or 0)
    total_bytes = files_bytes + chat_bytes
    return {
        "success": True,
        "totalBytes": total_bytes,
        "filesBytes": files_bytes,
        "chatBytes": chat_bytes,
        "questionBytes": 0,
        "embeddingBytes": 0,
        "totalMB": round(total_bytes / 1024 ** 2, 4),
        "totalGB": round(total_bytes / 1024 ** 3, 6),
        "counts": {
            "files": int(file_row.get("file_count") or 0),
            "chats": int(chat_row.get("chat_count") or 0),
            "embeddings": 0,
        },
    }


@router.get("/secrets")
async def secrets_list(request: Request, user: dict = Depends(get_current_user)):
    fetch = str(request.query_params.get("fetch", "")).lower() == "true"
    rows = await list_secret_prompts(user["id"], request.headers.get("authorization"), fetch_values=fetch)
    return rows


@router.get("/secrets/{secret_id}")
async def secret_detail(secret_id: str, user: dict = Depends(get_current_user)):
    try:
        return await get_secret_prompt_by_id(secret_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/upload-document/initiate")
async def upload_initiate(request: Request, user: dict = Depends(get_current_user)):
    body = await _read_body(request)
    try:
        return await chat_orchestrator.initiate_upload(
            user["id"],
            body.get("filename", "document"),
            body.get("mimetype", "application/octet-stream"),
            int(body.get("size") or 0),
        )
    except ValueError as exc:
        status = 507 if getattr(exc, "code", None) == "STORAGE_LIMIT_EXCEEDED" else 400
        raise HTTPException(status_code=status, detail={
            "success": False,
            "code":    getattr(exc, "code", None),
            "message": str(exc),
            "details": getattr(exc, "details", {}),
        }) from exc


@router.post("/upload-document/complete")
async def upload_complete(request: Request, user: dict = Depends(get_current_user)):
    body = await _read_body(request)
    try:
        return await chat_orchestrator.complete_upload(
            user["id"],
            body.get("upload_token"),
            body.get("filename", "document"),
            body.get("mimetype", "application/octet-stream"),
            int(body.get("size") or 0),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail={"success": False, "message": str(exc)}) from exc
    except ValueError as exc:
        status = 507 if getattr(exc, "code", None) == "STORAGE_LIMIT_EXCEEDED" else 400
        raise HTTPException(status_code=status, detail={
            "success": False,
            "code":    getattr(exc, "code", None),
            "message": str(exc),
            "details": getattr(exc, "details", {}),
        }) from exc


@router.post("/upload-document")
async def upload_deprecated():
    return JSONResponse(
        status_code=410,
        content={
            "success": False,
            "message": "Direct multipart upload is disabled. Use /upload-document/initiate and /upload-document/complete.",
            "code": "SIGNED_UPLOAD_REQUIRED",
        },
    )


@router.post("/google-drive/upload")
async def google_drive_upload(request: Request, user: dict = Depends(get_current_user)):
    body = await _read_body(request)
    try:
        result = await chat_orchestrator.upload_from_google_drive(
            user["id"], body.get("fileId") or body.get("file_id"), body.get("accessToken") or body.get("access_token")
        )
        if result.get("needsAuth"):
            return JSONResponse(status_code=401, content=result)
        return result
    except ValueError as exc:
        status = 507 if getattr(exc, "code", None) == "STORAGE_LIMIT_EXCEEDED" else 400
        raise HTTPException(status_code=status, detail={
            "success": False,
            "code":    getattr(exc, "code", None),
            "message": str(exc),
            "details": getattr(exc, "details", {}),
        }) from exc


@router.post("/ask")
async def ask(request: Request, user: dict = Depends(get_current_user)):
    body = await _read_body(request)
    user, cfg, merged = await _policy_check(user, body)
    ctx = {
        "user_id": user["id"],
        "user_email": user.get("email"),
        "authorization": request.headers.get("authorization"),
        "request_body": body,
        "llm_config": cfg,
        "llm_config_for_request": merged,
    }
    result = await run_adk_chat(ctx)
    return {"success": True, "data": result}


@router.post("/ask/stream")
async def ask_stream(request: Request, user: dict = Depends(get_current_user)):
    body = await _read_body(request)
    user, cfg, merged = await _policy_check(user, body)
    ctx = {
        "user_id": user["id"],
        "user_email": user.get("email"),
        "authorization": request.headers.get("authorization"),
        "request_body": body,
        "llm_config": cfg,
        "llm_config_for_request": merged,
    }
    origin = request.headers.get("origin")

    async def gen():
        async for line in chat_orchestrator.stream_document_chat(ctx):
            yield line

    headers = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"}
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)


@router.post("/ask/general/stream")
async def ask_general_stream(request: Request, user: dict = Depends(get_current_user)):
    body = await _read_body(request)
    user, cfg, merged = await _policy_check(user, body)
    ctx = {
        "user_id": user["id"],
        "user_email": user.get("email"),
        "authorization": request.headers.get("authorization"),
        "request_body": body,
        "llm_config": cfg,
        "llm_config_for_request": merged,
    }
    origin = request.headers.get("origin")

    async def gen():
        async for line in chat_orchestrator.stream_general_chat(ctx):
            yield line

    headers = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)


@router.post("/ask/judgement/stream")
async def ask_judgement_stream(request: Request, user: dict = Depends(get_current_user)):
    """Web-search grounded judgement / citation finder (Google Search grounding).

    Works with or without an attached document. The standard /ask/stream and
    /ask/general/stream endpoints also route here automatically when the request
    carries a web_search flag (frontend "Citation" mode).
    """
    body = await _read_body(request)
    body["web_search"] = True  # force judgement mode for this explicit endpoint
    user, cfg, merged = await _policy_check(user, body)
    ctx = {
        "user_id": user["id"],
        "user_email": user.get("email"),
        "authorization": request.headers.get("authorization"),
        "request_body": body,
        "llm_config": cfg,
        "llm_config_for_request": merged,
    }
    origin = request.headers.get("origin")

    async def gen():
        async for line in chat_orchestrator.stream_judgement_chat(ctx):
            yield line

    headers = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"}
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)


@router.get("/files")
async def list_files(user: dict = Depends(get_current_user)):
    return chat_orchestrator.get_user_files_payload(user["id"])


@router.get("/history/{file_id}")
async def history(file_id: str, session_id: str | None = None, user: dict = Depends(get_current_user)):
    try:
        return chat_orchestrator.get_chat_history_payload(user["id"], file_id, session_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail={"success": False, "message": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404 if "not found" in str(exc).lower() else 400, detail={"success": False, "message": str(exc)}) from exc


@router.get("/sessions/{file_id}")
async def sessions(file_id: str, user: dict = Depends(get_current_user)):
    try:
        return chat_orchestrator.get_document_sessions_payload(user["id"], file_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail={"success": False, "message": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail={"success": False, "message": str(exc)}) from exc


@router.get("/general/history/{session_id}")
async def general_history(session_id: str, user: dict = Depends(get_current_user)):
    try:
        return chat_orchestrator.get_general_history_payload(user["id"], session_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"success": False, "message": str(exc)}) from exc


@router.get("/general/sessions")
async def general_sessions(user: dict = Depends(get_current_user)):
    data = FileChatRepository.get_general_sessions(user["id"])
    return {"success": True, "data": data}


@router.get("/document-sessions")
async def document_sessions(user: dict = Depends(get_current_user)):
    data = FileChatRepository.get_all_document_sessions(user["id"])
    return {"success": True, "data": data}


@router.post("/count-tokens")
async def count_tokens(request: Request, user: dict = Depends(get_current_user)):
    body = await _read_body(request)
    file_id = body.get("file_id")
    if not file_id:
        raise HTTPException(status_code=400, detail={"success": False, "message": "file_id is required"})
    row = FileRepository.find_by_id(str(file_id))
    if not row:
        raise HTTPException(status_code=404, detail={"success": False, "message": "File not found"})
    if str(row.get("user_id")) != str(user["id"]):
        raise HTTPException(status_code=403, detail={"success": False, "message": "Access denied"})
    bucket = get_settings().gcs_bucket_name
    gcs_path = row.get("gcs_path")
    if not gcs_path:
        raise HTTPException(
            status_code=400,
            detail={"success": False, "message": "File is not yet available in GCS — try again in a moment"},
        )
    model = _default_cache_model(body)
    try:
        buf = download_object_buffer(bucket, gcs_path)
        result = await gemini_cache_service.count_tokens_for_file_specs(
            [{"buffer": buf, "mimetype": row.get("mimetype") or "application/octet-stream", "filename": row.get("originalname") or "document"}],
            model,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail={"success": False, "message": f"Token count failed: {exc}"},
        ) from exc
    total = result.get("totalTokens", 0)
    return {
        "success": True,
        "data": {
            "file_id": file_id,
            "totalTokens": total,
            "modelName": result.get("modelName") or model,
            "countingMethod": "gemini_explicit_cache_input",
            "mimeType": row.get("mimetype"),
            "filename": row.get("originalname"),
            "promptTokenCount": total,
        },
    }


@router.get("/cache/file-status/{file_id}")
async def cache_file_status(file_id: str, user: dict = Depends(get_current_user)):
    row = FileRepository.find_by_id(file_id)
    if not row or str(row.get("user_id")) != str(user["id"]):
        raise HTTPException(status_code=404, detail={"success": False, "message": "File not found"})
    return {"success": True, "data": await gemini_cache_service.get_status_for_file(file_id)}


@router.get("/cache/status/{session_id}")
async def cache_status(session_id: str, user: dict = Depends(get_current_user)):
    return {"success": True, "data": await gemini_cache_service.get_status(session_id, user["id"])}


@router.post("/cache/create")
async def cache_create(request: Request, user: dict = Depends(get_current_user)):
    """Prime the ADK runner and explicitly create the cache immediately."""
    body = await _read_body(request)
    file_id = body.get("file_id")
    if not file_id:
        raise HTTPException(status_code=400, detail={"success": False, "message": "file_id is required"})
    row = FileRepository.find_by_id(file_id)
    if not row or str(row.get("user_id")) != str(user["id"]):
        raise HTTPException(status_code=404, detail={"success": False, "message": "File not found"})
    profile = await get_full_profile(user["id"], request.headers.get("authorization"))
    system = build_system_instruction(profile)
    model = _default_cache_model(body)

    buf = download_object_buffer(get_settings().gcs_bucket_name, row["gcs_path"])
    file_specs = [{"buffer": buf, "mimetype": row.get("mimetype") or "application/pdf", "filename": row.get("originalname") or "document"}]

    llm_req = merge_request_overrides(await get_llm_config(str(user["id"])), body)
    async for _ in gemini_cache_service.ask_with_context_cache(
        file_id=file_id,
        question="Acknowledge the document context.",
        user_id=str(user["id"]),
        file_specs=file_specs,
        system_instruction=system,
        model_name=model,
        llm_config=llm_req,
        chat_session_id=f"prime-{file_id}",
        is_priming=True,
    ):
        pass

    status = await gemini_cache_service.get_status_for_file(file_id)
    return {"success": True, "message": "Gemini explicit cache created via ADK.", "data": status}


@router.post("/cache/ask")
async def cache_ask(request: Request, user: dict = Depends(get_current_user)):
    """Non-streaming document Q&A via ADK ContextCacheConfig (explicit Gemini cache)."""
    body = await _read_body(request)
    file_id = body.get("file_id")
    question = (body.get("question") or "").strip()
    if not file_id or not question:
        raise HTTPException(status_code=400, detail={"success": False, "message": "file_id and question are required"})
    row = FileRepository.find_by_id(file_id)
    if not row or str(row.get("user_id")) != str(user["id"]):
        raise HTTPException(status_code=404, detail={"success": False, "message": "File not found"})
    profile = await get_full_profile(user["id"], request.headers.get("authorization"))
    profile_prefix = build_profile_query_prefix(profile)
    system = build_system_instruction(profile)
    model = _default_cache_model(body)
    buf = download_object_buffer(get_settings().gcs_bucket_name, row["gcs_path"])
    file_specs = [{"buffer": buf, "mimetype": row.get("mimetype") or "application/pdf", "filename": row.get("originalname") or "document"}]
    prompt = f"{profile_prefix}\n\n{question}" if profile_prefix else question

    llm_req = merge_request_overrides(await get_llm_config(str(user["id"])), body)
    answer = ""
    usage: dict[str, Any] = {}
    async for ev in gemini_cache_service.ask_with_context_cache(
        file_id=file_id,
        question=prompt,
        user_id=str(user["id"]),
        file_specs=file_specs,
        system_instruction=system,
        model_name=model,
        llm_config=llm_req,
        chat_session_id=body.get("sessionId"),
    ):
        if ev.get("type") == "chunk":
            answer += ev.get("text", "")
        elif ev.get("type") == "usage":
            usage = ev
    return {"success": True, "data": {"answer": answer, "tokenUsage": usage, "sessionMetrics": await gemini_cache_service.get_status_for_file(file_id)}}


@router.post("/cache/ask/stream")
async def cache_ask_stream(request: Request, user: dict = Depends(get_current_user)):
    """Streaming document Q&A via ADK ContextCacheConfig (explicit Gemini cache)."""
    body = await _read_body(request)
    file_id = body.get("file_id")
    question = (body.get("question") or "").strip()
    if not file_id or not question:
        return StreamingResponse(iter(['data: {"type":"error","message":"file_id and question are required"}\n\n']), media_type="text/event-stream")
    row = FileRepository.find_by_id(file_id)
    if not row or str(row.get("user_id")) != str(user["id"]):
        return StreamingResponse(iter(['data: {"type":"error","message":"File not found"}\n\n']), media_type="text/event-stream")
    profile = await get_full_profile(user["id"], request.headers.get("authorization"))
    profile_prefix = build_profile_query_prefix(profile)
    system = build_system_instruction(profile)
    model = _default_cache_model(body)
    buf = download_object_buffer(get_settings().gcs_bucket_name, row["gcs_path"])
    file_specs = [{"buffer": buf, "mimetype": row.get("mimetype") or "application/pdf", "filename": row.get("originalname") or "document"}]

    llm_req = merge_request_overrides(await get_llm_config(str(user["id"])), body)

    async def gen():
        token_usage: dict[str, Any] = {}
        answer_parts: list[str] = []
        captured_session_metrics: dict[str, Any] | None = None
        try:
            prompt = f"{profile_prefix}\n\n{question}" if profile_prefix else question
            async for ev in gemini_cache_service.ask_with_context_cache(
                file_id=file_id,
                question=prompt,
                user_id=str(user["id"]),
                file_specs=file_specs,
                system_instruction=system,
                model_name=model,
                llm_config=llm_req,
                chat_session_id=body.get("sessionId"),
            ):
                if ev.get("type") == "chunk":
                    answer_parts.append(ev.get("text", ""))
                if ev.get("type") == "usage":
                    token_usage = ev
                    # Capture sessionMetrics from the usage event to avoid
                    # a redundant DB call when building the done event.
                    captured_session_metrics = ev.get("sessionMetrics")
                if ev.get("type") == "done":
                    # Use sessionMetrics already captured from the usage event.
                    # Avoids a second get_status_for_file() DB call that could
                    # raise an exception and turn a successful query into an error,
                    # which would leave cacheHandled=false on the frontend and
                    # cause the fallback /ask/stream path to log a duplicate query.
                    done = {
                        **ev,
                        "tokenUsage": token_usage,
                        "sessionMetrics": captured_session_metrics,
                    }
                    log_token_usage_table(
                        context="cache_ask_stream",
                        usage=token_usage,
                        model_name=model,
                        endpoint="/api/chat/cache/ask/stream",
                        session_id=body.get("sessionId"),
                        user_id=str(user["id"]),
                        answer_length=len(done.get("answer") or "".join(answer_parts)),
                        cache_mechanism=token_usage.get("cacheMechanism") if token_usage else "gemini_explicit_adk",
                    )
                    yield f"data: {json.dumps(done)}\n\n"
                    continue
                yield f"data: {json.dumps(ev)}\n\n"

            # GCS fallback if ADK path returned nothing
            if not "".join(answer_parts).strip():
                from app.services.llm_service import stream_llm_with_gcs
                gcs_uri = f"gs://{get_settings().gcs_bucket_name}/{row['gcs_path']}"
                yield f"data: {json.dumps({'type': 'status', 'status': 'generating', 'message': 'Processing document...'})}\n\n"
                async for ev in stream_llm_with_gcs(
                    question=prompt,
                    gcs_uris=[gcs_uri],
                    llm_config=llm_req,
                    system_instruction=system,
                    model_name=model,
                    metadata={"userId": user["id"], "fileId": file_id, "endpoint": "/api/chat/cache/ask/stream"},
                ):
                    if ev.get("type") == "chunk":
                        answer_parts.append(ev.get("text", ""))
                    if ev.get("type") == "usage":
                        token_usage = ev
                    yield f"data: {json.dumps(ev)}\n\n"
                if answer_parts:
                    final_answer = "".join(answer_parts)
                    log_token_usage_table(
                        context="cache_ask_stream_gcs_fallback",
                        usage=token_usage,
                        model_name=model,
                        endpoint="/api/chat/cache/ask/stream",
                        session_id=body.get("sessionId"),
                        user_id=str(user["id"]),
                        answer_length=len(final_answer),
                        cache_mechanism="gcs_fallback",
                    )
                    yield f"data: {json.dumps({'type': 'done', 'answer': final_answer, 'tokenUsage': token_usage})}\n\n"

            yield "data: [DONE]\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc), 'code': 'CACHE_STREAM_FAILED'})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.delete("/cache/{session_id}")
async def cache_delete(session_id: str, user: dict = Depends(get_current_user)):
    return {"success": True, "data": await gemini_cache_service.delete_cache(session_id, user["id"])}


@router.post("/cache/delete")
async def cache_delete_compat(request: Request, user: dict = Depends(get_current_user)):
    body = await _read_body(request)
    session_id = body.get("sessionId") or body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail={"success": False, "message": "sessionId is required"})
    return {"success": True, "data": await gemini_cache_service.delete_cache(session_id, user["id"])}

