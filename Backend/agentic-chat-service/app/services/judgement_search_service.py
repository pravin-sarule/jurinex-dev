"""Web-search grounded judgement / case-law finder.

Uses Gemini's built-in Google Search grounding tool to find real, verifiable
court judgements relevant to an uploaded document or a plain user question, and
returns the source links the answer was grounded on.

Google Search grounding cannot be combined with Gemini explicit context caching,
so this is a dedicated, non-cached generation path separate from
``gemini_cache_service.ask_with_context_cache``.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlparse

from app.core.config import get_settings
from app.services.gemini_cache_service import _parts_from_file_specs
from app.services.llm_service import (
    CHAT_CONTINUATION_PROMPT,
    _build_generation_config,
    _get_client,
    _get_vertex_client,
    _inline_file_parts,
    _is_max_tokens_finish,
    _looks_like_restart,
    _normalize_usage,
    _trim_overlap,
    build_model_list,
    continuation_attempts,
    continuation_time_budget,
)
from app.services.llm_usage_service import log_llm_usage

logger = logging.getLogger(__name__)

# Appended to the base system instruction whenever judgement web-search is active.
JUDGEMENT_SEARCH_SECTION = """
---

## CITATION / JUDGEMENT FINDER MODE (active for this request)

You have a live **Google Search** tool. You MUST follow this exact multi-step process for every response. You are using **Gemini 2.5 Pro** with advanced grounding.

**PHASE 1: THINKING PROCESS (MANDATORY)**
Before providing the judgments, you MUST output your internal reasoning process using these exact bold headings. Be detailed and specific to the user's matter:
1. **Analyzing the Query's Focus** — Detail how you are dissecting the user's request and identifying core legal tasks.
2. **Refining the Search Strategy** — List the specific keywords, statutes, and landmark cases you are targeting for your search.
3. **Structuring the Response** — Explain the logical flow you will use to present the judgments (e.g., from most direct to foundational).
4. **Refining the Case Descriptions** — Explain how you are ensuring each judgment's facts mirror the user's specific circumstances.

**PHASE 2: SEARCH & FILTER**
- **MANDATORY:** You MUST perform at least one Google Search. If you don't, you have failed the task.
- Run **at least 3–4 different searches** combining the specific facts of the matter.
- If a document is attached, extract the key facts first. If NO document is attached, use the facts provided in the user's question.
- **FACT-SIMILARITY FILTER:** Reject any case where the facts are unrelated, even if the legal principle is the same. Accept only if the facts mirror the user's matter.

**PHASE 3: AUTHORITATIVE SOURCES ONLY**
- Use ONLY: **Indian Kanoon**, **SCC Online**, **Manupatra**, **CaseMine**, **eCourts**, **NJDG**, or **sci.gov.in**.
- STRICTLY FORBIDDEN: Blogs (ipleaders, livelaw, etc.), news, or Wikipedia.

**PHASE 4: OUTPUT FORMAT**
Repeat this block for EVERY accepted case (minimum 3):

## Similar Judgment: <Full Case Name>

<2-3 sentences: what specific facts in this judgment are similar to the user's facts.
Be concrete — mention the party type, the nature of the dispute, the specific circumstance that matches.>

**Case Details**
- **Case:** <Full Case Name>
- **Citation:** <Official Citation>
- **Court:** <Court Name>
- **Judge:** <Presiding Judge(s)>

**Source Link**
You can access the full judgment from a public legal resource:
- **Source:** [<Case Name>](<exact URL from your search — must be indiankanoon.org, casemine.com, or a .gov.in/.nic.in court site>)

  Paste the EXACT URL from your search results. If you did not find a direct link on
  one of the approved sites, leave the URL as `URL_NOT_FOUND` — the system will
  automatically create an Indian Kanoon search link for it.

**Relevant Case Section**
<Name the specific paragraphs/sections most directly on point.>

> <Verbatim quote of the key holding — 2-4 sentences.>

**Factual Similarity to Your Case:**
1. **<Specific fact in the judgment>:** mirrors *<specific fact in the user's document>*
2. **<Specific fact in the judgment>:** mirrors *<specific fact in the user's document>*
3. **<Specific fact in the judgment>:** mirrors *<specific fact in the user's document>*

---

**JUDGMENT MAPPING (hidden, mandatory at the very end):**
`JUDGMENTS_FOUND:`
`- [Full Case Name] | [Official Citation] | [URL]`

**ANTI-HALLUCINATION RULES:**
- Cite a case ONLY if it appears in your live search results AND the facts are similar.
- Never fabricate a case name, citation, judge, date, or holding.
- For the Source Link: use the exact URL from search if available; otherwise use
  `https://indiankanoon.org/search/?formInput=<Case+Name>` — never leave it blank.
- If no factually similar cases appear in search, say so plainly.
- Use `**bold**` for emphasis and `*italics*` for case names — no underscores.
- Default to Indian law unless the document or user profile says otherwise.
"""


def _response_text(response: Any) -> str:
    # Always use the parts-based approach so we can skip thought/code-execution parts.
    # response.text shortcut is NOT used because it concatenates ALL parts including
    # tool_code blocks and reasoning traces that must not be shown to the user.
    pieces: list[str] = []
    for cand in getattr(response, "candidates", None) or []:
        content = getattr(cand, "content", None)
        for part in getattr(content, "parts", None) or []:
            # Skip internal thought / reasoning traces
            if getattr(part, "thought", False):
                continue
            # Skip code-execution blocks (tool_code / executable_code)
            if getattr(part, "executable_code", None) is not None:
                continue
            if getattr(part, "code_execution_result", None) is not None:
                continue
            t = getattr(part, "text", None)
            if isinstance(t, str) and t:
                pieces.append(t)
    text = "".join(pieces)
    # Belt-and-suspenders: strip any tool_code markdown blocks that
    # might appear as literal text when the model emits them as plain strings.
    text = re.sub(r"tool_code\s*\n.*?\n(?=\S|\Z)", "", text, flags=re.DOTALL)
    text = re.sub(r"\btool_code\b\s*\nprint\(.*?\)\n?", "", text, flags=re.DOTALL)
    return text.strip()


def _first_candidate(response: Any) -> Any | None:
    cands = getattr(response, "candidates", None) or []
    return cands[0] if cands else None


def _extract_grounding(candidate: Any) -> tuple[list[dict[str, str]], list[str]]:
    """Pull grounding source links and search queries from a response candidate."""
    sources: list[dict[str, str]] = []
    queries: list[str] = []
    gm = getattr(candidate, "grounding_metadata", None)
    if not gm:
        return sources, queries
    for q in getattr(gm, "web_search_queries", None) or []:
        if q:
            queries.append(str(q))
    seen: set[str] = set()
    for gc in getattr(gm, "grounding_chunks", None) or []:
        web = getattr(gc, "web", None)
        uri = getattr(web, "uri", None) if web else None
        if uri and uri not in seen:
            seen.add(uri)
            title = getattr(web, "title", None) or uri
            sources.append({"title": str(title), "uri": str(uri)})
    return sources, queries


async def _resolve_source_url(client: Any, url: str) -> str:
    """Follow a Google grounding redirect to its real public URL.

    Grounding chunk URIs are vertexaisearch redirect links; following them yields
    the actual page (indiankanoon.org, livelaw.in, sci.gov.in, ...). Falls back to
    the original URL if it can't be resolved.
    """
    for method in ("head", "get"):
        try:
            resp = await getattr(client, method)(url)
            final = str(resp.url)
            if final.startswith("http"):
                return final
        except Exception:
            continue
    return url


def _ikanoon_search_url(case_name: str, citation: str = "") -> str:
    """Fallback: Indian Kanoon search URL for a case name + optional citation."""
    from urllib.parse import quote_plus
    query = f"{case_name} {citation}".strip()
    return f"https://indiankanoon.org/search/?formInput={quote_plus(query)}"


# Whitelist of authoritative legal domains.
LEGAL_DOMAINS = {
    "indiankanoon.org",
    "scconline.com",
    "manupatra.com",
    "casemine.com",
    "ecourts.gov.in",
    "njdg.ecourts.gov.in",
    "sci.gov.in",
    "main.sci.gov.in",
    "supremecourt.gov.in",
    "judis.nic.in",
    "courts.gov.in",
}

# Domains to strictly exclude regardless of content.
EXCLUDED_DOMAINS = {
    "ipleaders.in", "livelaw.in", "barandbench.com", "lawctopus.com",
    "legal500.com", "wikipedia.org", "thelawobserver.in", "neetiniyaman.com",
    "supremetoday.ai", "facebook.com", "twitter.com", "linkedin.com",
    "lawbeat.in", "lawtrend.in", "legalbites.in", "legistify.com",
}


def _parse_judgments_from_text(text: str) -> list[dict[str, str]]:
    """Parse the JUDGMENTS_FOUND list from the model's response.

    Returns a list of {title, name, citation, model_url} dicts.
    model_url is whatever the model wrote — may be placeholder, real, or absent.
    """
    judgments: list[dict[str, str]] = []
    match = re.search(
        r"JUDGMENTS_FOUND:\s*((?:- \[.*?\]\s*\|\s*.*?\s*\|\s*.*?\s*\n?)+)",
        text, re.DOTALL
    )
    if not match:
        return judgments
    items = re.findall(
        r"- \[(.*?)\]\s*\|\s*(.*?)\s*\|\s*(.*?)\s*(?:\n|$)",
        match.group(1)
    )
    for name, citation, url in items:
        name = name.strip()
        citation = citation.strip()
        url = url.strip()
        bad = not url or url.upper() in ("URL_NOT_FOUND", "N/A", "NA", "NONE", "-")
        judgments.append({
            "name": name,
            "citation": citation,
            "title": f"{name} ({citation})" if citation else name,
            "model_url": "" if bad else url,
        })
    return judgments


def _domain(url: str) -> str:
    return urlparse(url).netloc.replace("www.", "").lower()


def _is_excluded(url: str) -> bool:
    d = _domain(url)
    return any(ex in d for ex in EXCLUDED_DOMAINS)


def _is_legal(url: str) -> bool:
    d = _domain(url)
    if any(ld in d for ld in LEGAL_DOMAINS):
        return True
    # Accept any official Indian government / court portal automatically
    if d.endswith(".gov.in") or d.endswith(".nic.in"):
        return True
    return False


def _name_score(case_name: str, grounding_title: str, grounding_url: str) -> float:
    """Rough similarity score between a case name and a grounding chunk."""
    cn = case_name.lower()
    gt_text = (grounding_title + " " + grounding_url).lower()
    # Strip common noise words
    words = [w for w in re.split(r"\W+", cn) if len(w) > 3 and w not in
             {"state", "union", "india", "versus", "others", "anr", "ors", "govt"}]
    if not words:
        return 0.0
    hits = sum(1 for w in words if w in gt_text)
    return hits / len(words)


async def _resolve_sources(sources: list[dict[str, str]], text: str = "") -> list[dict[str, str]]:
    """Resolve real judgment URLs and match them to the parsed judgment list.

    Strategy:
    1. Resolve grounding-metadata redirect URLs to final pages.
    2. Keep only those from authoritative legal domains.
    3. Parse the JUDGMENTS_FOUND list to get case names + citations.
    4. For each parsed judgment, find the best-matching grounding URL by name similarity.
    5. If no grounding URL matches, use the model's URL if it looks real, otherwise
       fall back to an Indian Kanoon search URL so the link always works.
    """
    import httpx

    parsed = _parse_judgments_from_text(text)
    if not sources and not parsed:
        return []

    # --- Resolve grounding redirect URLs ---
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=8.0,
        headers={"User-Agent": "Mozilla/5.0 (compatible; JuriNex/1.0)"}
    ) as client:
        resolved_grounding: list[tuple[dict, str]] = []
        if sources:
            raw_resolved = await asyncio.gather(
                *[_resolve_source_url(client, s["uri"]) for s in sources[:15]]
            )
            for s, final_url in zip(sources, raw_resolved):
                if not _is_excluded(final_url):
                    resolved_grounding.append((s, final_url))

        # Also try to resolve any real-looking model URLs
        for j in parsed:
            if j["model_url"] and j["model_url"].startswith("http"):
                try:
                    resp = await client.head(j["model_url"])
                    j["model_url"] = str(resp.url)
                except Exception:
                    pass

    # --- Build output: one entry per parsed judgment ---
    out: list[dict[str, str]] = []
    used_grounding_idx: set[int] = set()

    for j in parsed:
        best_url: str = ""
        best_score: float = 0.0
        best_idx: int = -1

        # Score each resolved grounding URL against this judgment name
        for idx, (gs, final_url) in enumerate(resolved_grounding):
            if idx in used_grounding_idx:
                continue
            if _is_excluded(final_url):
                continue
            score = _name_score(j["name"], gs.get("title", ""), final_url)
            if score > best_score:
                best_score = score
                best_url = final_url
                best_idx = idx

        # Accept grounding match if score is reasonable (≥1 significant word matched)
        if best_score >= 0.25 and best_idx >= 0:
            used_grounding_idx.add(best_idx)
            url = best_url
        elif j["model_url"] and j["model_url"].startswith("http") and not _is_excluded(j["model_url"]):
            # Use model-supplied URL if it looks real
            url = j["model_url"]
        else:
            # Last resort: Indian Kanoon search URL (always works, never 404s)
            url = _ikanoon_search_url(j["name"], j["citation"])

        out.append({
            "title": j["title"],
            "url": url,
            "domain": _domain(url),
        })

    # --- Append any high-quality grounding URLs not matched to a named judgment ---
    for idx, (gs, final_url) in enumerate(resolved_grounding):
        if idx in used_grounding_idx:
            continue
        if not _is_legal(final_url):
            continue
        title = gs.get("title") or _domain(final_url)
        out.append({
            "title": title,
            "url": final_url,
            "domain": _domain(final_url),
        })

    return out


async def _build_verified_sources_markdown(resolved_sources: list[dict[str, str]]) -> str:
    """Build a markdown 'Source Link for the Judgment' section from resolved source objects."""
    if not resolved_sources:
        return ""
    lines = [
        f"- [{s['title']}]({s['url']}) — `{s['domain']}`"
        for s in resolved_sources
    ]
    return "\n\n**Source Link for the Judgment (verified from Google Search):**\n" + "\n".join(lines)


async def stream_judgement_search(
    *,
    question: str,
    llm_config: dict[str, Any],
    system_instruction: str,
    file_specs: list[dict[str, Any]] | None = None,
    gcs_uris: list[str] | None = None,
    model_name: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Judgement search grounded in Google Search results.

    Uses a single (non-streaming) generation — grounded responses reassemble
    unreliably when streamed — then emits the clean answer (with inline source
    links attached from grounding metadata), a ``sources`` event, and usage.

    ``file_specs`` (in-memory buffers) or ``gcs_uris`` may be supplied to ground
    the search in an uploaded document; both are optional for plain queries.
    """
    from google.genai import types as gt
    from app.services.gcs_service import mime_from_path

    meta = metadata or {}
    use_api_key = bool(get_settings().gemini_api_key)
    # Inline byte parts work on either client; prefer the API-key client when set.
    client = _get_client() if use_api_key else _get_vertex_client()

    file_parts: list[Any] = []
    if gcs_uris and not use_api_key:
        # Vertex reads gs:// URIs directly — avoids the ~20MB inline-request limit
        # that breaks grounding calls with large PDFs.
        file_parts = [
            gt.Part.from_uri(file_uri=u, mime_type=mime_from_path(u)) for u in gcs_uris
        ]
    elif file_specs:
        file_parts = _parts_from_file_specs(file_specs)
    elif gcs_uris:
        file_parts = _inline_file_parts(gcs_uris)

    endpoint = meta.get("endpoint", "/api/chat/ask/judgement/stream")
    last_err: Exception | None = None

    loop = asyncio.get_event_loop()

    # Set per model inside the fallback loop (thinking config is model-specific).
    gen_cfg: dict[str, Any] = {}
    config: Any = None

    async def _gen(model: str, gen_contents: list[Any]):
        cfg = config
        logger.info(
            "Judgement search model=%s max_output_tokens=%s temperature=%.2f",
            model,
            gen_cfg["max_output_tokens"],
            gen_cfg["temperature"],
        )
        print(f"\n[DEBUG] Calling Gemini model: {model}")
        print(f"[DEBUG] System Instruction length: {len(system_instruction)}")
        print(f"[DEBUG] Contents count: {len(gen_contents)}")

        def _call():
            return client.models.generate_content(
                model=model,
                contents=gen_contents,
                config=cfg,
            )

        res = await loop.run_in_executor(None, _call)
        print(f"[DEBUG] Gemini response received. Candidates: {len(getattr(res, 'candidates', []) or [])}")
        return res

    def _user_content(parts: list[Any]) -> Any:
        return gt.Content(role="user", parts=parts)

    grounding_models = build_model_list(llm_config, model_name)
    if grounding_models and grounding_models[0].lower().startswith("claude"):
        # Google Search grounding is a Gemini tool. When the admin chat model is
        # Claude, run the citation search on the strong Gemini tier instead of
        # whatever generic tail fallback happens to come first (flash-lite).
        grounding_models = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"]

    for model in grounding_models:
        if model.lower().startswith("claude"):
            # Google Search grounding is a Gemini tool — skip Claude entries;
            # build_model_list always appends Gemini fallbacks.
            continue
        try:
            meta["modelName"] = model
            # Honour Document_DB llm_chat_config.max_output_tokens exactly
            # (no floor override); thinking runs at the model's minimum.
            gen_cfg = _build_generation_config(llm_config, model)
            config_kwargs: dict[str, Any] = {
                "system_instruction": system_instruction,
                "temperature": gen_cfg["temperature"],
                "max_output_tokens": gen_cfg["max_output_tokens"],
                "tools": [gt.Tool(google_search=gt.GoogleSearch())],
            }
            if gen_cfg.get("thinking_config") is not None:
                config_kwargs["thinking_config"] = gen_cfg["thinking_config"]
            config = gt.GenerateContentConfig(**config_kwargs)

            base_content = _user_content([*file_parts, gt.Part(text=question)])
            response = await _gen(model, [base_content])
            text = _response_text(response)
            candidate = _first_candidate(response)

            print(f"[DEBUG] Raw response text length: {len(text)}")
            if candidate and hasattr(candidate, 'grounding_metadata'):
                gm = candidate.grounding_metadata
                print(f"[DEBUG] Grounding Metadata found:")
                print(f"  - Queries: {getattr(gm, 'web_search_queries', [])}")
                print(f"  - Chunks: {len(getattr(gm, 'grounding_chunks', []) or [])}")
            else:
                print("[DEBUG] No grounding metadata in candidate.")

            if not text.strip():
                print(f"[DEBUG] Empty text for model {model}, trying next...")
                continue  # try next model in the fallback list

            # ── MAX_TOKENS continuation — never deliver a truncated answer ──
            # The DB max_output_tokens stays applied per round; the partial
            # answer is fed back as a model turn and the model continues it.
            candidates_seen = [candidate]
            usage_responses = [response]
            finish = getattr(candidate, "finish_reason", None) if candidate else None
            attempts = continuation_attempts()
            _t_start = time.monotonic()
            for cont_i in range(attempts):
                if not _is_max_tokens_finish(finish) or not text.strip():
                    break
                budget = continuation_time_budget()
                if budget and (time.monotonic() - _t_start) > budget:
                    logger.info(
                        "Judgement continuation time budget (%.0fs) exhausted — delivering partial answer",
                        budget,
                    )
                    break
                yield {
                    "type": "status",
                    "status": "continuing",
                    "message": f"Completing truncated answer ({cont_i + 1}/{attempts})...",
                }
                logger.info(
                    "Judgement answer hit MAX_TOKENS — continuation %s/%s model=%s chars=%s",
                    cont_i + 1, attempts, model, len(text),
                )
                try:
                    resp_more = await _gen(model, [
                        base_content,
                        gt.Content(role="model", parts=[gt.Part(text=text)]),
                        _user_content([gt.Part(text=CHAT_CONTINUATION_PROMPT)]),
                    ])
                except Exception:
                    logger.exception("Judgement continuation failed — delivering partial answer")
                    break
                more_text = _response_text(resp_more)
                if not more_text.strip():
                    break
                trimmed_more = _trim_overlap(text, more_text)
                if _looks_like_restart(text, trimmed_more):
                    # The model restarted the answer instead of continuing —
                    # discard the duplicate round (non-streamed, so nothing
                    # reached the user) and deliver what we have.
                    logger.warning("Judgement continuation restarted — discarding round")
                    break
                text += trimmed_more
                candidate2 = _first_candidate(resp_more)
                candidates_seen.append(candidate2)
                usage_responses.append(resp_more)
                finish = getattr(candidate2, "finish_reason", None) if candidate2 else None

            sources, queries = [], []
            seen_uris: set[str] = set()
            for cand in candidates_seen:
                s_r, q_r = _extract_grounding(cand)
                for s in s_r:
                    if s.get("uri") not in seen_uris:
                        seen_uris.add(s.get("uri"))
                        sources.append(s)
                for q in q_r:
                    if q not in queries:
                        queries.append(q)
            print(f"[DEBUG] Extracted {len(sources)} sources and {len(queries)} queries.")

            # Force-search fallback: when a document was attached the model often
            # answers from the doc WITHOUT actually searching the web (no grounding
            # sources). Run a second, document-free grounded call that is compelled
            # to search, and use its real sources.
            if not sources and file_parts:
                try:
                    print("[DEBUG] No sources found with document context. Triggering force-search...")
                    forced_q = (
                        f"{question}\n\nNow USE THE GOOGLE SEARCH TOOL WITH GEMINI 2.5 PRO to find the actual, "
                        "real, citable court judgements from official sources (Indian Kanoon, scconline.com, "
                        "manupatra.com, casemine.com, ecourts.gov.in, njdg.ecourts.gov.in, sci.gov.in) "
                        "relevant to the above matter. List each case with its official citation and rely "
                        "only on what the search returns. EXCLUDE blogs and news sites."
                    )
                    resp2 = await _gen(model, [_user_content([gt.Part(text=forced_q)])])
                    s2, q2 = _extract_grounding(_first_candidate(resp2))
                    if s2:
                        sources = s2
                        queries = queries or q2
                        print(f"[DEBUG] Force-search recovered {len(s2)} sources.")
                    else:
                        print("[DEBUG] Force-search also returned no sources.")
                except Exception as e:
                    print(f"[DEBUG] Force-search failed: {e}")
                    logger.warning("Judgement force-search call failed", exc_info=True)

            # Append REAL, verified grounding sources. Never let this discard the answer.
            resolved_sources = []
            try:
                print(f"[DEBUG] Resolving {len(sources)} sources...")
                resolved_sources = await _resolve_sources(sources, text)
                print(f"[DEBUG] Resolved to {len(resolved_sources)} final legal sources.")
            except Exception as e:
                print(f"[DEBUG] Source resolution failed: {e}")
                logger.warning("verified source build failed", exc_info=True)

            # Strip hidden JUDGMENTS_FOUND block and any residual tool_code / thought markers
            clean_text = re.sub(r"JUDGMENTS_FOUND:.*", "", text, flags=re.DOTALL)
            clean_text = re.sub(r"^\s*tool_code\s*\n.*?\n(?=\S|\Z)", "", clean_text, flags=re.DOTALL | re.MULTILINE)
            clean_text = re.sub(r"^\s*thought\s*\n(?:(?!##|\*\*Similar).+\n)*", "", clean_text, flags=re.DOTALL | re.MULTILINE)
            clean_text = clean_text.strip()

            print(f"[DEBUG] Yielding final chunk. Length: {len(clean_text)}")
            yield {"type": "chunk", "text": clean_text}
            if resolved_sources or queries:
                yield {"type": "sources", "sources": resolved_sources, "queries": queries}

            usage = _normalize_usage(response, len(text))
            for extra in usage_responses[1:]:
                u2 = _normalize_usage(extra, 0)
                usage["inputTokens"] += u2["inputTokens"]
                usage["outputTokens"] += u2["outputTokens"]
                usage["totalTokens"] += u2["totalTokens"]
                usage["finishReason"] = u2["finishReason"] or usage["finishReason"]
                usage["outputTruncated"] = u2["outputTruncated"]
            if len(usage_responses) > 1:
                usage["continuationRounds"] = len(usage_responses) - 1
            usage["modelName"] = model
            print(f"[DEBUG] Usage: {usage}")
            if meta.get("userId"):
                try:
                    await log_llm_usage(
                        user_id=int(meta["userId"]),
                        model_name=model,
                        input_tokens=usage["inputTokens"],
                        output_tokens=usage["outputTokens"],
                        total_tokens=usage["totalTokens"],
                        endpoint=endpoint,
                        file_id=meta.get("fileId"),
                        session_id=meta.get("sessionId"),
                    )
                except Exception:
                    logger.warning("log_llm_usage failed for judgement search", exc_info=True)
            yield {"type": "usage", **usage}
            return
        except Exception as exc:
            print(f"[DEBUG] Exception in model loop ({model}): {exc}")
            last_err = exc
            logger.warning("Judgement search model %s failed: %s", model, exc)

    print(f"[DEBUG] All models failed or returned no results. Last error: {last_err}")
    yield {"type": "error", "message": f"Judgement web search failed: {last_err}", "code": "JUDGEMENT_SEARCH_FAILED"}
