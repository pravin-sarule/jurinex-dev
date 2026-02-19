"""
Section API: Generate and refine draft sections using Drafter and Critic agents.

POST /api/drafts/{draft_id}/sections/{section_key}/generate - Initial generation
POST /api/drafts/{draft_id}/sections/{section_key}/refine - Refine with user feedback
GET /api/drafts/{draft_id}/sections - Get all active sections
GET /api/drafts/{draft_id}/sections/{section_key} - Get specific section
GET /api/drafts/{draft_id}/sections/{section_key}/versions - Get version history
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException

from api.deps import require_user_id, optional_user_id
from services import draft_db
from agents.drafter.agent import run_drafter_agent
from agents.citation.agent import run_citation_agent
from agents.critic.agent import run_critic_agent
from agents.librarian.agent import run_librarian_agent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["sections"])


def _invalidate_assembled_cache(draft_id: str, user_id: int):
    """
    Invalidate the assembled document cache when sections are modified (Edit Content or Update with prompt).
    Next Assemble will create a NEW Google Doc so the iframe shows the updated content (not the previous doc).
    """
    import json
    try:
        field_data = draft_db.get_draft_field_data_for_retrieve(draft_id, user_id)
        if field_data:
            metadata = field_data.get("metadata", {})
            if "assembled_cache" in metadata:
                del metadata["assembled_cache"]
                with draft_db.get_draft_conn() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE draft_field_data 
                            SET metadata = %s::jsonb, updated_at = NOW()
                            WHERE draft_id = %s
                            """,
                            (json.dumps(metadata), draft_id),
                        )
                logger.info(f"[CACHE INVALIDATED] Cleared assembled cache for draft {draft_id}; next Assemble will create new Google Doc.")
    except Exception as e:
        logger.warning(f"Failed to invalidate cache for draft {draft_id}: {e}")


@router.post("/drafts/{draft_id}/sections/{section_key}/generate")
async def generate_section(
    draft_id: str,
    section_key: str,
    user_id: int = Depends(require_user_id),
    section_prompt: Optional[str] = Body(None, embed=True),
    rag_query: Optional[str] = Body(None, embed=True),
    template_url: Optional[str] = Body(None, embed=True),
    auto_validate: bool = Body(True, embed=True),
) -> Dict[str, Any]:
    """
    Generate initial section content using Drafter agent.
    
    Flow:
    1. Get template sections for this draft's template
    2. Use provided section_prompt or fetch from template_sections.default_prompt
    3. If rag_query provided → run Librarian to get context
    4. Run Drafter agent to generate content
    5. If auto_validate=True → run Critic agent for validation
    6. If Critic FAIL → auto-retry once with feedback
    7. Save version to section_versions
    
    Body:
      - section_prompt: Optional custom prompt (overrides template default)
      - rag_query: Optional query for Librarian context retrieval
      - template_url: Optional signed GCS URL for template visual reference
      - auto_validate: Whether to run Critic validation (default true)
    """
    logger.info(
        "API: POST /api/drafts/%s/sections/%s/generate — generateSection (Orchestrator → Librarian → Drafter → Critic)",
        draft_id,
        section_key,
    )
    print(f"[API] Generating section: draft_id={draft_id}, section_key={section_key}, user_id={user_id}")

    try:
        # Get draft to verify ownership and get template_id
        draft = draft_db.get_user_draft(draft_id, user_id)
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        template_id = draft.get("template_id")
        # Merged field_values (autopopulated + draft) so Drafter gets all data in every section; no [] or blank placeholders
        field_values = draft_db.get_merged_field_values_for_draft(draft_id, user_id)

        # Resolve template URL for multimodal visual reference (from template_assets table)
        if not template_url and template_id:
            asset = draft_db.get_template_primary_asset(template_id)
            if asset:
                from services.gcs_signed_url import generate_signed_url
                template_url = generate_signed_url(
                    asset["gcs_bucket"], 
                    asset["gcs_path"]
                )
                if template_url:
                    print(f"[Orchestrator] Resolved template_url from template_assets: {asset['original_file_name']}")
        
        # Get section prompt (user can provide custom prompt or use universal default)
        # Fetch section settings (custom prompts, language, detail level, etc.) for this draft
        start_fetch_time = __import__("time").time()
        section_settings = draft_db.get_draft_section_prompts_list(draft_id)
        section_config = next((s for s in section_settings if s.get("section_id") == section_key), None)
        print(f"[Orchestrator] Fetched section config in {__import__('time').time() - start_fetch_time:.3f}s. Config found: {bool(section_config)}")

        # Get section prompt priority:
        # 1. Body param (user override) → store in user_prompt_override
        # 2. Custom prompt from DB (section_config) → store in user_prompt_override
        # 3. Template default from template_analysis_sections → do NOT store as override
        # 4. Universal default → do NOT store as override
        user_edited_prompt = None  # Track if prompt was user-edited
        if not section_prompt:
            if section_config and section_config.get("custom_prompt"):
                section_prompt = section_config["custom_prompt"]
                user_edited_prompt = section_prompt  # User edited this prompt
                print(f"[Orchestrator] Using saved custom prompt for section '{section_key}'")
            else:
                # Fetch prompts from same table as sections: template_analysis_sections
                template_sections = draft_db.get_template_sections(str(template_id)) if template_id else []
                # Match by section_key (e.g. "title_page") OR by section_id (e.g. UUID from template_analysis_sections.id)
                def _section_matches(s: dict, key: str) -> bool:
                    if not key:
                        return False
                    sk = (s.get("section_key") or "").strip().lower()
                    sid = s.get("section_id")
                    key_lower = key.strip().lower().replace(" ", "_")
                    if sk == key_lower:
                        return True
                    if sid is not None and str(sid).lower() == key_lower:
                        return True
                    if sid is not None and str(sid) == key:
                        return True
                    return False
                template_section_config = next((s for s in template_sections if _section_matches(s, section_key)), None)
                
                if template_section_config:
                    section_prompt = template_section_config.get("default_prompt") or ""
                    if section_prompt:
                        print(f"[Orchestrator] Using prompt from template_analysis_sections for section '{section_key}'")
                if not section_prompt:
                    # Fallback: fetch directly from template_analysis_sections and resolve by id or section_key
                    analysis_sections = draft_db.get_template_analysis_sections(str(template_id)) if template_id else []
                    for sec in analysis_sections:
                        if _section_matches({"section_key": sec.get("section_key"), "section_id": sec.get("id")}, section_key):
                            prompts_list = sec.get("section_prompts") or []
                            if isinstance(prompts_list, list) and len(prompts_list) > 0:
                                section_prompt = prompts_list[0].get("prompt", "")
                            elif isinstance(prompts_list, dict):
                                section_prompt = prompts_list.get("prompt", "")
                            if section_prompt:
                                print(f"[Orchestrator] Using prompt from template_analysis_sections (fallback) for section '{section_key}'")
                            break
                if not section_prompt:
                    # Fall back to universal sections
                    from api.universal_sections_routes import load_universal_sections
                    universal_sections = load_universal_sections()
                    universal_config = next((s for s in universal_sections if s["section_key"] == section_key), None)
                    
                    if universal_config:
                        section_prompt = universal_config["default_prompt"]
                    elif section_config:
                        # Custom section (user-added): section_config exists but no template/universal match
                        # Use default prompt based on section name
                        section_name = section_config.get("section_name") or section_key.replace("custom_", "").replace("_", " ").title()
                        section_prompt = (
                            f"Generate comprehensive legal content for the section titled '{section_name}'. "
                            "Ensure it is professionally drafted, legally sound, and formatted in clean HTML. "
                            "Use the provided case context and field values. The section should be 2-10 A4 pages."
                        )
                        user_edited_prompt = section_prompt
                        print(f"[Orchestrator] Using default prompt for custom section '{section_key}' (name: {section_name})")
                    else:
                        raise HTTPException(
                            status_code=400,
                            detail=f"No prompt found for section '{section_key}'. Provide section_prompt in request body or save a custom prompt."
                        )
        else:
            # Prompt was explicitly provided in the request body — this is a user edit
            user_edited_prompt = section_prompt
        
        # Get RAG context (always try to fetch some context for variable filling if not provided)
        rag_context = ""
        effective_query = rag_query
        if not effective_query:
            # Use section name if available (better for semantic search than UUID keys)
            search_term = section_key
            if section_config and section_config.get("section_name"):
                search_term = section_config["section_name"]
            
            effective_query = f"Provide all factual details like names of parties, dates, addresses, and case specifics for the section: {search_term}"
            print(f"[Orchestrator] No rag_query provided. Using auto-query with term '{search_term}': {effective_query}")

        print(f"[Orchestrator → Librarian] Fetching context for query: {effective_query[:80]}...")
        print(f"[Orchestrator] Using draft_id={draft_id} for file resolution")
        librarian_payload = {
            "user_id": user_id,
            "query": effective_query,
            "top_k": 80,  # Fetch top 80 chunks for comprehensive context (batch-wise generation)
            "file_ids": [], # Default to empty list to prevent searching ALL user files if draft context resolution fails
        }
        # Add draft_id to payload so Librarian uses draft-scoped files
        print(f"[Orchestrator] Calling get_draft_field_data_for_retrieve with draft_id={draft_id}, user_id={user_id}")
        draft_field_data = draft_db.get_draft_field_data_for_retrieve(draft_id, user_id)
        resolved_file_ids = []
        
        if draft_field_data is None:
            print(f"[Orchestrator] ERROR: draft_field_data is None for draft_id={draft_id}")
        elif not draft_field_data:
            print(f"[Orchestrator] WARNING: draft_field_data is empty for draft_id={draft_id}")
        else:
            meta = draft_field_data.get("metadata", {})
            case_id = meta.get("case_id")
            uploaded_ids = meta.get("uploaded_file_ids", [])
            print(f"[Orchestrator] Draft metadata retrieved: case_id={case_id}, uploaded_file_ids={uploaded_ids}")
            
            # Resolve file_ids from case or uploaded files
            from api.librarian_routes import _resolve_retrieve_file_ids
            print(f"[Orchestrator] Calling _resolve_retrieve_file_ids with case_id={case_id}, draft_id={draft_id}")
            resolved_file_ids = _resolve_retrieve_file_ids(None, case_id, draft_id, user_id)
            librarian_payload["file_ids"] = resolved_file_ids
            print(f"[Orchestrator] Resolved {len(resolved_file_ids)} file_ids for Librarian: {resolved_file_ids[:5] if len(resolved_file_ids) > 5 else resolved_file_ids}")
        
        # Explicit debugging for RAG Isolation
        print(f"[Orchestrator] DEBUG: librarian_payload['file_ids'] = {librarian_payload.get('file_ids')}")
        if librarian_payload.get("file_ids") == []:
            print(f"[Orchestrator] DEBUG: RAG is strictly ISOLATED to draft (0 files attached).")
        elif librarian_payload.get("file_ids") is None:
            print(f"[Orchestrator] CRITICAL DEBUG: file_ids is None! This will search ALL user files. Should be [] if empty.")

        if not resolved_file_ids:
            print(f"[Orchestrator] CRITICAL WARNING: No file_ids resolved! Context retrieval will fail.")
        
        print(f"[Orchestrator] Calling Librarian with payload: query='{effective_query[:50]}...', file_ids_count={len(resolved_file_ids)}, top_k=80")
        librarian_result = run_librarian_agent(librarian_payload)
        rag_context = librarian_result.get("context", "")
        chunks = librarian_result.get("chunks", [])
        print(f"[Librarian → Orchestrator] Retrieved {len(chunks)} chunks, context length: {len(rag_context)} chars")
        if len(chunks) == 0:
            print(f"[Librarian → Orchestrator] WARNING: No chunks retrieved! This means no context will be available for generation.")
            print(f"[Librarian → Orchestrator] Librarian result keys: {list(librarian_result.keys())}")
        if rag_context:
            print(f"[Librarian → Orchestrator] Context preview: {rag_context[:200]}...")
        else:
            print(f"[Librarian → Orchestrator] WARNING: Empty context returned!")
        
        # Determine Language and Detail Level
        language = "English"  # Default
        detail_level = "detailed"  # Default to detailed for multi-page section output
        
        if section_config:
            lang_code = section_config.get("language") or "en"
            detail_level = section_config.get("detail_level") or "detailed"
            
            # Map language codes to full names
            language_map = {
                "en": "English", "hi": "Hindi", "bn": "Bengali", "te": "Telugu",
                "mr": "Marathi", "ta": "Tamil", "gu": "Gujarati", "kn": "Kannada",
                "ml": "Malayalam", "pa": "Punjabi", "or": "Odia", "as": "Assamese",
                "ur": "Urdu", "sa": "Sanskrit"
            }
            language = language_map.get(lang_code, "English")
        
        # Detail level controls output length; always require accurate content only
        # detailed = long (2-10 pages), concise = moderate, short = brief
        detail_instructions = {
            "detailed": "LONG OUTPUT: 2-10 A4 pages (~1000-5000 words). Comprehensive, thorough, extensive explanations. Still only accurate—no filler.",
            "concise": "CONCISE OUTPUT: Balanced length for this section. Clear, well-structured, moderate detail. Only accurate content.",
            "short": "SHORT OUTPUT: Brief, to-the-point. Only essential information. One or a few focused paragraphs. Only accurate content.",
        }
        length_instruction = detail_instructions.get(detail_level, detail_instructions["concise"])
        
        enhanced_prompt = f"""{section_prompt}

IMPORTANT:
- Language: {language}.
- Detail level: {detail_level.upper()} — {length_instruction}
- Give ONLY an accurate answer; do not add unsupported or generic filler.
"""
        
        # Batch-wise generation: split chunks into batches, generate each batch, combine
        from agents.drafter.tools import CHUNKS_PER_BATCH
        batch_size = CHUNKS_PER_BATCH
        content_html = ""
        drafter_result = {}
        
        if chunks and len(chunks) > batch_size:
            # Multiple batches: generate batch 1, then continue with batches 2+
            num_batches = (len(chunks) + batch_size - 1) // batch_size
            print(f"[Orchestrator → Drafter] Batch-wise generation: {len(chunks)} chunks → {num_batches} batches")
            
            for batch_idx in range(num_batches):
                start = batch_idx * batch_size
                end = min(start + batch_size, len(chunks))
                batch_chunks = chunks[start:end]
                batch_context_parts = []
                for c in batch_chunks:
                    cnt = c.get("content", "").strip()
                    if cnt:
                        batch_context_parts.append(cnt)
                batch_rag = "\n\n---\n\n".join(batch_context_parts)
                batch_info = f"**Batch {batch_idx + 1} of {num_batches}** (chunks {start + 1}-{end})"
                
                if batch_idx == 0:
                    drafter_payload = {
                        "mode": "generate",
                        "section_key": section_key,
                        "section_prompt": enhanced_prompt,
                        "rag_context": batch_rag,
                        "field_values": field_values,
                        "template_url": template_url,
                        "detail_level": detail_level,
                    }
                else:
                    drafter_payload = {
                        "mode": "continue",
                        "section_key": section_key,
                        "section_prompt": enhanced_prompt,
                        "rag_context": batch_rag,
                        "field_values": field_values,
                        "template_url": template_url,
                        "previous_content": content_html,
                        "batch_info": batch_info,
                        "detail_level": detail_level,
                    }
                
                print(f"[Orchestrator → Drafter] Batch {batch_idx + 1}/{num_batches} ({len(batch_chunks)} chunks)")
                batch_result = run_drafter_agent(drafter_payload)
                batch_html = batch_result.get("content_html", "")
                drafter_result = batch_result
                
                if batch_html:
                    content_html = content_html + ("\n" if content_html else "") + batch_html
                else:
                    print(f"[Orchestrator] Warning: Batch {batch_idx + 1} returned empty content")
        else:
            # Single batch: one API call
            print(f"[Orchestrator → Drafter] Single-batch generation ({len(chunks)} chunks) in {language} with {detail_level} detail level")
            drafter_payload = {
                "mode": "generate",
                "section_key": section_key,
                "section_prompt": enhanced_prompt,
                "rag_context": rag_context,
                "field_values": field_values,
                "template_url": template_url,
                "detail_level": detail_level,
            }
            drafter_result = run_drafter_agent(drafter_payload)
            content_html = drafter_result.get("content_html", "")

        if not content_html:
            raise HTTPException(status_code=500, detail=drafter_result.get("error", "Drafter returned empty content"))

        # Run Citation agent to add formal citations
        print(f"[Orchestrator → Citation] Adding formal citations to content")
        citation_payload = {
            "draft_id": draft_id,
            "section_key": section_key,
            "content_html": content_html,
            "rag_context": rag_context,
            "chunks": chunks,
            "field_values": field_values,
            "user_id": user_id,
            "file_ids": resolved_file_ids,
        }
        citation_result = run_citation_agent(citation_payload)

        # Update content with citations
        if citation_result.get("content_html"):
            content_html = citation_result["content_html"]
            print(f"[Citation → Orchestrator] Added {citation_result.get('citation_count', 0)} citations")
        else:
            print(f"[Citation → Orchestrator] No citations added (content unchanged)")

        # Run Critic validation if requested
        critic_result = None
        if auto_validate:
            print(f"[Orchestrator → Critic] Validating generated content")
            critic_payload = {
                "section_content": content_html,
                "section_key": section_key,
                "rag_context": rag_context,
                "field_values": field_values,
                "section_prompt": section_prompt,
            }
            critic_result = run_critic_agent(critic_payload)
            
            # Auto-retry once if FAIL
            if critic_result.get("status") == "FAIL":
                print(f"[Critic → Orchestrator] FAIL (score={critic_result.get('score')}). Auto-retry with feedback.")
                # Retry with Critic feedback
                drafter_payload_retry = {
                    "mode": "refine",
                    "section_key": section_key,
                    "section_prompt": section_prompt,
                    "rag_context": rag_context,
                    "field_values": field_values,
                    "template_url": template_url,
                    "previous_content": content_html,
                    "user_feedback": f"Critic feedback: {critic_result.get('feedback', '')}",
                    "detail_level": detail_level,
                }
                drafter_result_retry = run_drafter_agent(drafter_payload_retry)
                content_html_retry = drafter_result_retry.get("content_html", "")
                
                if content_html_retry:
                    content_html = content_html_retry
                    print(f"[Drafter → Orchestrator] Retry completed")
                    # Re-validate retry
                    critic_payload["section_content"] = content_html
                    critic_result = run_critic_agent(critic_payload)
                    print(f"[Critic → Orchestrator] Retry validation: {critic_result.get('status')}")
        
        # Save version
        version = draft_db.save_section_version(
            draft_id=draft_id,
            user_id=user_id,
            section_key=section_key,
            content_html=content_html,
            user_prompt_override=user_edited_prompt,  # Only stores user-edited prompts, not template defaults
            rag_context_used=rag_context,
            generation_metadata={
                "drafter": drafter_result.get("metadata", {}),
                "citation": citation_result.get("metadata", {}),
                "citations": citation_result.get("citations", []),
                "citation_count": citation_result.get("citation_count", 0),
                "citation_confidence": citation_result.get("confidence"),
                "citation_sources": citation_result.get("sources", []),
                "critic": critic_result if critic_result else None,
                "rag_query": rag_query,
            },
            created_by_agent="citation",
        )
        
        # Save critic review if validation was run
        if critic_result:
            draft_db.save_critic_review(
                version_id=version["version_id"],
                critic_status=critic_result.get("status", "PENDING"),
                critic_score=critic_result.get("score", 0),
                critic_feedback=critic_result.get("feedback", ""),
                review_metadata=critic_result.get("metadata", {}),
            )
        
        # Invalidate assembled cache since section content changed
        _invalidate_assembled_cache(draft_id, user_id)
        
        return {
            "success": True,
            "version": version,
            "critic_review": critic_result,
            "message": f"Section '{section_key}' generated successfully",
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("generate_section failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/drafts/{draft_id}/sections/{section_key}/refine")
async def refine_section_endpoint(
    draft_id: str,
    section_key: str,
    user_id: int = Depends(require_user_id),
    user_feedback: str = Body(..., embed=True),
    rag_query: Optional[str] = Body(None, embed=True),
    template_url: Optional[str] = Body(None, embed=True),
    auto_validate: bool = Body(True, embed=True),
) -> Dict[str, Any]:
    """
    Refine section content based on user feedback using Drafter agent.
    
    Flow:
    1. Get latest active version for this section
    2. If rag_query provided → run Librarian for updated context
    3. Run Drafter in refinement mode with user feedback
    4. If auto_validate=True → run Critic validation
    5. Save new version (increments version_number, deactivates previous)
    
    Body:
      - user_feedback: User's refinement instructions (required)
      - rag_query: Optional updated query for context
      - template_url: Optional template reference
      - auto_validate: Whether to run Critic (default true)
    """
    logger.info(
        "API: POST /api/drafts/%s/sections/%s/refine — refineSection",
        draft_id,
        section_key,
    )
    print(f"[API] Refining section: draft_id={draft_id}, section_key={section_key}")

    try:
        # Get draft
        draft = draft_db.get_user_draft(draft_id, user_id)
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        template_id = draft.get("template_id")
        field_values = draft_db.get_merged_field_values_for_draft(draft_id, user_id)

        # Resolve template URL for multimodal visual reference (from template_assets table)
        if not template_url and template_id:
            asset = draft_db.get_template_primary_asset(template_id)
            if asset:
                from services.gcs_signed_url import generate_signed_url
                template_url = generate_signed_url(
                    asset["gcs_bucket"], 
                    asset["gcs_path"]
                )
                if template_url:
                    print(f"[Orchestrator] Resolved template_url from template_assets: {asset['original_file_name']}")
        
        # Get latest version
        latest_version = draft_db.get_section_latest_version(draft_id, section_key, user_id)
        if not latest_version:
            raise HTTPException(
                status_code=404,
                detail=f"No existing version for section {section_key}. Generate first.",
            )
        
        previous_content = latest_version.get("content_html", "")
        
        # Use same detail_level as section config if set (for consistent length on refine)
        detail_level = "concise"
        section_settings = draft_db.get_draft_section_prompts_list(draft_id)
        section_config = next((s for s in section_settings if s.get("section_id") == section_key), None)
        if section_config and section_config.get("detail_level"):
            detail_level = section_config.get("detail_level") or "concise"
        
        # Get RAG context
        rag_context = ""
        if rag_query:
            print(f"[Orchestrator → Librarian] Fetching updated context")
            librarian_payload = {"user_id": user_id, "query": rag_query, "top_k": 80, "file_ids": []}
            draft_field_data = draft_db.get_draft_field_data_for_retrieve(draft_id, user_id)
            if draft_field_data:
                meta = draft_field_data.get("metadata", {})
                from api.librarian_routes import _resolve_retrieve_file_ids
                file_ids = _resolve_retrieve_file_ids(None, meta.get("case_id"), draft_id, user_id)
                librarian_payload["file_ids"] = file_ids
            librarian_result = run_librarian_agent(librarian_payload)
            rag_context = librarian_result.get("context", "")
        
        # Run Drafter in refinement mode
        print(f"[Orchestrator → Drafter] Refining with user feedback (detail_level={detail_level})")
        drafter_payload = {
            "mode": "refine",
            "section_key": section_key,
            "section_prompt": user_feedback,  # Use feedback as refinement prompt
            "rag_context": rag_context,
            "field_values": field_values,
            "template_url": template_url,
            "previous_content": previous_content,
            "user_feedback": user_feedback,
            "detail_level": detail_level,
        }
        drafter_result = run_drafter_agent(drafter_payload)
        content_html = drafter_result.get("content_html", "")
        
        if not content_html:
            raise HTTPException(status_code=500, detail="Drafter returned empty content")
        
        # Run Critic validation
        critic_result = None
        if auto_validate:
            print(f"[Orchestrator → Critic] Validating refined content")
            critic_payload = {
                "section_content": content_html,
                "section_key": section_key,
                "rag_context": rag_context,
                "field_values": field_values,
                "section_prompt": user_feedback,
            }
            critic_result = run_critic_agent(critic_payload)
        
        # Save new version (increments version_number)
        version = draft_db.save_section_version(
            draft_id=draft_id,
            user_id=user_id,
            section_key=section_key,
            content_html=content_html,
            user_prompt_override=user_feedback,
            rag_context_used=rag_context,
            generation_metadata={
                "drafter": drafter_result.get("metadata", {}),
                "critic": critic_result if critic_result else None,
                "rag_query": rag_query,
            },
            created_by_agent="drafter",
        )
        
        # Save critic review
        if critic_result:
            draft_db.save_critic_review(
                version_id=version["version_id"],
                critic_status=critic_result.get("status", "PENDING"),
                critic_score=critic_result.get("score", 0),
                critic_feedback=critic_result.get("feedback", ""),
                review_metadata=critic_result.get("metadata", {}),
            )
        
        # Invalidate assembled cache since section content changed
        _invalidate_assembled_cache(draft_id, user_id)
        
        return {
            "success": True,
            "version": version,
            "critic_review": critic_result,
            "message": f"Section '{section_key}' refined successfully",
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("refine_section failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/drafts/{draft_id}/sections")
async def get_all_sections(
    draft_id: str,
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """Get all active section versions for a draft."""
    logger.info("API: GET /api/drafts/%s/sections — getAllSections", draft_id)
    
    try:
        sections = draft_db.get_all_active_sections(draft_id, user_id)
        return {
            "success": True,
            "sections": sections,
            "count": len(sections),
        }
    except Exception as e:
        logger.exception("get_all_sections failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/drafts/{draft_id}/sections/{section_key}")
async def get_section(
    draft_id: str,
    section_key: str,
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """Get the latest active version for a specific section."""
    logger.info("API: GET /api/drafts/%s/sections/%s — getSection", draft_id, section_key)
    
    try:
        version = draft_db.get_section_latest_version(draft_id, section_key, user_id)
        if not version:
            return {
                "success": True,
                "version": None,
                "message": f"No version exists for section '{section_key}'",
            }
        
        # Get reviews for this version
        reviews = draft_db.get_section_reviews(version["version_id"])
        
        return {
            "success": True,
            "version": version,
            "reviews": reviews,
        }
    except Exception as e:
        logger.exception("get_section failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/drafts/{draft_id}/sections/{section_key}/versions")
async def get_section_versions(
    draft_id: str,
    section_key: str,
    user_id: int = Depends(require_user_id),
) -> Dict[str, Any]:
    """Get version history for a specific section (all versions, not just active)."""
    logger.info("API: GET /api/drafts/%s/sections/%s/versions — getSectionVersions", draft_id, section_key)
    
    try:
        # Verify ownership
        draft = draft_db.get_user_draft(draft_id, user_id)
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        # Get all versions for this section
        with draft_db.get_draft_conn() as conn:
            with conn.cursor(cursor_factory=draft_db.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT version_id, draft_id, section_key, version_number, content_html,
                           user_prompt_override, rag_context_used, generation_metadata,
                           is_active, created_by_agent, created_at
                    FROM section_versions
                    WHERE draft_id = %s AND LOWER(TRIM(section_key)) = LOWER(TRIM(%s))
                    ORDER BY version_number DESC
                    """,
                    (draft_id, section_key),
                )
                rows = cur.fetchall()
        
        versions = [dict(r) for r in rows]
        
        return {
            "success": True,
            "versions": versions,
            "count": len(versions),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("get_section_versions failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/drafts/{draft_id}/sections/{section_key}/versions/{version_id}")
async def update_section_version(
    draft_id: str,
    section_key: str,
    version_id: str,
    user_id: int = Depends(require_user_id),
    content_html: str = Body(..., embed=True),
) -> Dict[str, Any]:
    """
    Update the content of a specific section version (manual edit).
    
    This endpoint allows users to manually edit the generated content.
    It updates the content_html field of the specified version.
    
    Body:
      - content_html: The updated HTML content
    """
    logger.info(
        "API: PUT /api/drafts/%s/sections/%s/versions/%s — updateSectionVersion",
        draft_id,
        section_key,
        version_id,
    )
    
    try:
        # Verify ownership
        draft = draft_db.get_user_draft(draft_id, user_id)
        if not draft:
            raise HTTPException(status_code=404, detail="Draft not found")
        
        # Update by version_id + draft_id only (section_key in URL is for routing; version is unique)
        with draft_db.get_draft_conn() as conn:
            with conn.cursor(cursor_factory=draft_db.RealDictCursor) as cur:
                # Verify the version exists and belongs to this draft (no section_key match required)
                cur.execute(
                    """
                    SELECT version_id FROM section_versions
                    WHERE version_id = %s AND draft_id = %s
                    """,
                    (version_id, draft_id),
                )
                existing = cur.fetchone()
                
                if not existing:
                    raise HTTPException(
                        status_code=404,
                        detail="Version not found"
                    )
                
                # Update the content
                cur.execute(
                    """
                    UPDATE section_versions
                    SET content_html = %s,
                        generation_metadata = jsonb_set(
                            COALESCE(generation_metadata, '{}'::jsonb),
                            '{manually_edited}',
                            'true'::jsonb
                        )
                    WHERE version_id = %s AND draft_id = %s
                    RETURNING version_id, draft_id, section_key, version_number, 
                              content_html, is_active, created_at
                    """,
                    (content_html, version_id, draft_id),
                )
                updated_version = cur.fetchone()
                conn.commit()
        
        # Invalidate assembled cache since section content was manually edited
        _invalidate_assembled_cache(draft_id, user_id)
        
        return {
            "success": True,
            "version": dict(updated_version),
            "message": "Section content updated successfully",
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("update_section_version failed")
        raise HTTPException(status_code=500, detail=str(e))


def _is_uuid(value: str) -> bool:
    """Return True if value looks like a UUID (user-uploaded template from Template Analyzer)."""
    if not value or len(value) < 30:
        return False
    try:
        uuid.UUID(value.strip())
        return True
    except (ValueError, AttributeError):
        return False


def _fetch_sections_from_template_analyzer(
    template_id: str,
    user_id: Optional[int],
) -> List[Dict[str, Any]]:
    """
    Fetch sections from Template Analyzer API for user-uploaded (UUID) templates.
    Calls GET /analysis/template/{template_id}/sections (requires X-User-Id).
    Returns list in same shape as draft_db.get_template_sections: section_id, section_key, section_name, default_prompt, sort_order, ...
    """
    base_url = (os.environ.get("TEMPLATE_ANALYZER_URL") or "").rstrip("/")
    if not base_url or user_id is None:
        return []
    # Template Analyzer endpoint: GET /analysis/template/{template_id}/sections
    url = f"{base_url}/analysis/template/{template_id}/sections"
    headers = {"X-User-Id": str(user_id)}
    try:
        import json as _json
        import urllib.request
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read().decode()
        payload = _json.loads(data)
    except Exception as e:
        logger.warning("Template Analyzer API failed for %s: %s", template_id, e)
        return []
    sections_raw = payload.get("sections") if isinstance(payload, dict) else []
    if not sections_raw:
        return []
    results = []
    for idx, sec in enumerate(sections_raw):
        if not isinstance(sec, dict):
            continue
        section_name = sec.get("section_name") or "Untitled"
        section_key = (section_name or "").lower().replace(" ", "_").replace("-", "_")
        if not section_key:
            section_key = f"section_{idx}"
        prompts = sec.get("section_prompts") or []
        default_prompt = ""
        if isinstance(prompts, list) and len(prompts) > 0:
            first = prompts[0]
            default_prompt = (first.get("prompt") or "") if isinstance(first, dict) else ""
        elif isinstance(prompts, dict):
            default_prompt = prompts.get("prompt", "")
        results.append({
            "section_id": str(sec.get("id", "")),
            "section_key": section_key,
            "section_name": section_name,
            "section_purpose": sec.get("section_purpose"),
            "section_intro": sec.get("section_intro"),
            "default_prompt": default_prompt,
            "sort_order": sec.get("order_index", idx),
            "is_required": True,
        })
    return results


@router.get("/templates/{template_id}/sections")
async def get_template_sections_endpoint(
    template_id: str,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
    user_id: Optional[int] = Depends(optional_user_id),
) -> Dict[str, Any]:
    """
    Get all configured sections for a template.

    - Admin templates (non-UUID template_id): sections from draft DB (template_analysis_sections / user_template_analysis_sections).
    - User-uploaded templates (UUID template_id): sections from Template Analyzer API (GET /analysis/template/{id}/sections)
      when TEMPLATE_ANALYZER_URL is set. Requires user context via Authorization (JWT) or X-User-Id header.
    """
    logger.info("API: GET /api/templates/%s/sections — getTemplateSections", template_id)

    try:
        # Resolve user for Template Analyzer: JWT user_id or X-User-Id header
        analyzer_user_id = user_id
        if analyzer_user_id is None and x_user_id is not None:
            try:
                analyzer_user_id = int(x_user_id)
            except (ValueError, TypeError):
                pass

        is_user_template = _is_uuid(template_id)
        base_url = (os.environ.get("TEMPLATE_ANALYZER_URL") or "").rstrip("/")

        # User-uploaded (UUID) template: prefer Template Analyzer API when configured and we have user
        if is_user_template and base_url and analyzer_user_id is not None:
            sections = _fetch_sections_from_template_analyzer(template_id, analyzer_user_id)
            if sections:
                logger.info("Template sections from Template Analyzer API: %s (%d sections)", template_id, len(sections))
                return {"success": True, "sections": sections, "count": len(sections)}

        # Admin template or shared DB: get from draft DB (template_analysis_sections, user_template_analysis_sections)
        sections = draft_db.get_template_sections(template_id)
        if not sections and is_user_template and base_url and analyzer_user_id is not None:
            sections = _fetch_sections_from_template_analyzer(template_id, analyzer_user_id)
            if sections:
                logger.info("Template sections from Template Analyzer fallback: %s", template_id)

        return {
            "success": True,
            "sections": sections,
            "count": len(sections),
        }
    except Exception as e:
        logger.exception("get_template_sections failed")
        raise HTTPException(status_code=500, detail=str(e))
