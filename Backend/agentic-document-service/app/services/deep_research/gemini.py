"""Thin, synchronous google.genai wrappers used by the Deep Research loop.

All calls here are blocking network calls — the agent runs them off the event loop with
`asyncio.to_thread`. Keeping them synchronous makes them trivial to reason about and to
unit-test. The client is obtained from the existing shared factory
(`document_ai._gemini_client`) so key selection (Gemini vs Gemma) stays in one place.
"""

from __future__ import annotations

from typing import Any, Iterator


def _client(model: str):
    from app.services.adapters import document_ai
    return document_ai._gemini_client(model)  # noqa: SLF001 - shared factory, intentional reuse


def client_available(model: str) -> bool:
    return _client(model) is not None


def _usage(resp: Any) -> tuple[int, int]:
    um = getattr(resp, "usage_metadata", None)
    if um is None:
        return 0, 0
    inp = int(getattr(um, "prompt_token_count", 0) or 0)
    cand = int(getattr(um, "candidates_token_count", 0) or 0)
    total = int(getattr(um, "total_token_count", 0) or 0)
    # Thinking models (e.g. gemini-3.6-flash) emit hidden reasoning tokens billed at the
    # OUTPUT rate but not counted in candidates_token_count. Fold them into output so the
    # ₹ cost is accurate: Total = Input + Output.
    out = total - inp if total > inp + cand else cand
    return inp, max(0, out)


def _text(resp: Any) -> str:
    t = getattr(resp, "text", None)
    if t:
        return t
    # Fallback: concatenate candidate part texts (thinking parts are skipped by .text anyway).
    out: list[str] = []
    try:
        for cand in getattr(resp, "candidates", None) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", None) or []:
                pt = getattr(part, "text", None)
                if pt:
                    out.append(pt)
    except Exception:
        pass
    return "".join(out)


def _grounding_citations(resp: Any) -> list[dict[str, str]]:
    """Extract the web sources Gemini actually grounded on, from grounding_metadata."""
    out: list[dict[str, str]] = []
    try:
        for cand in getattr(resp, "candidates", None) or []:
            gm = getattr(cand, "grounding_metadata", None)
            if not gm:
                continue
            for gch in getattr(gm, "grounding_chunks", None) or []:
                web = getattr(gch, "web", None)
                uri = getattr(web, "uri", None) if web else None
                if not uri:
                    continue
                title = getattr(web, "title", None) if web else None
                out.append({"uri": uri, "title": title or uri})
    except Exception:
        pass
    return out


def _generate_with_optional_thinking(client, model: str, prompt: str, *, base_kwargs: dict, thinking_level: str):
    """`generate_content` that requests `thinking_level` when given, but FALLS BACK to a plain
    no-thinking call if the model rejects it.

    gemini-3.1-flash-lite (plan / round-search / gap-check) is NOT confirmed to support
    thinking_level — a lite model can 400 on it. Rather than break the whole Deep Research run,
    we retry the same call once without the thinking_config. ThinkingConfig construction itself is
    also guarded so an older SDK simply runs without it."""
    from google.genai import types

    def _run(use_thinking: bool):
        kw = dict(base_kwargs)
        if use_thinking and thinking_level:
            try:
                kw["thinking_config"] = types.ThinkingConfig(thinking_level=thinking_level)
            except Exception:
                pass  # SDK without ThinkingConfig / unsupported field → run without it
        return client.models.generate_content(
            model=model, contents=prompt, config=types.GenerateContentConfig(**kw),
        )

    try:
        return _run(use_thinking=True)
    except Exception:
        if thinking_level:
            # Most likely the model rejected thinking_level at the API layer — retry once plainly
            # so a lite model that lacks thinking still returns a normal answer.
            return _run(use_thinking=False)
        raise


def reason(model: str, prompt: str, *, temperature: float, max_output_tokens: int,
           thinking_level: str = "") -> tuple[str, int, int]:
    """Plain, NON-grounded call for planning / gap decisions. Returns (text, in_tok, out_tok).
    `thinking_level` (low|medium|high for Gemini) is best-effort with a safe no-thinking fallback
    — see `_generate_with_optional_thinking`."""
    client = _client(model)
    if client is None:
        return "", 0, 0
    resp = _generate_with_optional_thinking(
        client, model, prompt,
        base_kwargs=dict(temperature=temperature, max_output_tokens=max_output_tokens),
        thinking_level=thinking_level,
    )
    it, ot = _usage(resp)
    return _text(resp), it, ot


def search(model: str, prompt: str, *, temperature: float, max_output_tokens: int,
           thinking_level: str = "") -> tuple[str, list[dict[str, str]], int, int]:
    """Grounded call with the google_search tool. Returns (text, citations, in_tok, out_tok).
    `thinking_level` is best-effort with the same safe fallback as `reason`."""
    from google.genai import types
    client = _client(model)
    if client is None:
        return "", [], 0, 0
    resp = _generate_with_optional_thinking(
        client, model, prompt,
        base_kwargs=dict(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
        thinking_level=thinking_level,
    )
    it, ot = _usage(resp)
    return _text(resp), _grounding_citations(resp), it, ot


def synthesis_stream(
    model: str, prompt: str, *, temperature: float, max_output_tokens: int, thinking_level: str = "",
) -> Iterator[Any]:
    """Grounded streaming synthesis, yielded one chunk at a time.

    This MUST be a generator (not `return iter(stream)`): the genai Client owns the
    underlying httpx transport, and if it is only a local it gets garbage-collected the
    moment the function returns — the next streamed read then fails with "Cannot send a
    request, as the client has been closed". Keeping `client` in this generator's frame
    holds it alive for the whole stream.

    `thinking_level` is passed through to ThinkingConfig as-is: Gemini accepts
    low|medium|high, but Gemma ONLY accepts minimal|high (anything else, including
    "low", 400s on the network call — verified live). The caller (DeepResearchConfig)
    is responsible for supplying a value valid for whichever model is configured; this
    function attaches it defensively so an SDK that lacks ThinkingConfig or the field
    simply runs without it rather than erroring.

    The google_search tool below is attached unconditionally — this is the whole point
    of Deep Research (a cited, grounded report). CONFIRMED LIVE 2026-07-24: Gemma
    (gemma-4-31b-it) accepts this tool without erroring but does NOT actually ground
    with it on this streaming call shape — two live runs both returned zero grounding
    citations from the synthesis step (see agent.py's per-run "citations ·
    round-search=N · synthesis=N new" log). Google AI Studio showing the tool as
    available for this model was not a reliable predictor here. Do not point
    synthesis_model at a Gemma model without re-verifying this first.
    """
    from google.genai import types
    client = _client(model)
    if client is None:
        return

    # Free-tier Gemma is rate-limited GLOBALLY per API key (shared with live document
    # chat on the same key) — this call previously went straight to the network,
    # unpaced, and could collide with that traffic. `_pace_gemma_call` is a no-op for
    # non-Gemma models, so this is safe for the existing Gemini synthesis path too.
    from app.services.adapters import document_ai
    document_ai._pace_gemma_call(  # noqa: SLF001 - shared pacer, intentional reuse
        model, est_input_tokens=document_ai._estimate_input_tokens(prompt)
    )

    cfg_kwargs: dict[str, Any] = dict(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        tools=[types.Tool(google_search=types.GoogleSearch())],
    )
    lvl = (thinking_level or "").strip().lower()
    if lvl:
        try:
            cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=lvl)
        except Exception:
            pass  # older SDK / unsupported field → run without an explicit thinking level

    stream = client.models.generate_content_stream(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(**cfg_kwargs),
    )
    for chunk in stream:
        yield chunk
    # `client` and `stream` stay referenced until this generator is exhausted.
    _ = client


def chunk_text_and_usage(chunk: Any) -> tuple[str, int, int]:
    """Pull (delta_text, cumulative_in_tok, cumulative_out_tok) from one stream chunk."""
    it, ot = _usage(chunk)
    txt = getattr(chunk, "text", None) or ""
    if not txt:
        txt = _text(chunk)
    return txt, it, ot


def chunk_citations(chunk: Any) -> list[dict[str, str]]:
    return _grounding_citations(chunk)
