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


def reason(model: str, prompt: str, *, temperature: float, max_output_tokens: int) -> tuple[str, int, int]:
    """Plain, NON-grounded call for planning / gap decisions. Returns (text, in_tok, out_tok)."""
    from google.genai import types
    client = _client(model)
    if client is None:
        return "", 0, 0
    resp = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        ),
    )
    it, ot = _usage(resp)
    return _text(resp), it, ot


def search(model: str, prompt: str, *, temperature: float, max_output_tokens: int) -> tuple[str, list[dict[str, str]], int, int]:
    """Grounded call with the google_search tool. Returns (text, citations, in_tok, out_tok)."""
    from google.genai import types
    client = _client(model)
    if client is None:
        return "", [], 0, 0
    resp = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
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

    `thinking_level` (low|medium|high) is applied for thinking models such as
    gemini-3.6-flash; it is attached defensively so an SDK that lacks ThinkingConfig or
    the field simply runs without it rather than erroring.
    """
    from google.genai import types
    client = _client(model)
    if client is None:
        return

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
