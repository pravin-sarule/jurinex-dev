"""
Assembler Agent: Assemble the final document using templates and editor formatting.

This agent uses Google ADK (Gemini) to format and structure the final legal document
with proper HTML/TipTap formatting.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)


def run_assembler_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run the Assembler agent: Step-by-step assembly and AI-polishing of the final document.
    
    1. Combines sections procedurally.
    2. Uses Gemini to fill remaining placeholders/blanks from field_values.
    3. Ensures template format consistency.
    """
    import os
    from pathlib import Path
    from google import genai
    import requests

    sections = payload.get("sections", [])
    template_url = payload.get("template_url")
    draft_id = payload.get("draft_id", "unknown")
    field_values = payload.get("field_values", {})

    if not sections:
        draft_content = payload.get("draft", "")
        if not draft_content:
            logger.warning("Assembler: No sections or draft provided for assembly")
            return {"final_document": "", "error": "No content provided"}
        return {"final_document": draft_content, "format": "html"}

    logger.info("Assembler: Assembling %d sections for draft %s", len(sections), draft_id)

    # Step 1: Initialize API and Template
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    client = None
    if api_key:
        client = genai.Client(api_key=api_key)

    template_content = ""
    if template_url:
        try:
            t_resp = requests.get(template_url, timeout=10)
            if t_resp.status_code == 200:
                template_content = t_resp.text
        except Exception as e:
            logger.warning("Assembler: Could not fetch template: %s", e)

    # Load system prompt
    system_prompt = ""
    try:
        instr_path = Path(__file__).parent.parent.parent / "instructions" / "assembler.txt"
        if instr_path.exists():
            system_prompt = instr_path.read_text(encoding="utf-8").strip()
    except Exception:
        pass

    try:
        # Step 2: Batchwise Polishing
        # ... logic moved inside this try ...
        BATCH_SIZE = 2 
        polished_html_parts = []
        
        from google.genai import types
        tools = [types.Tool(googleSearch=types.GoogleSearch())]
        generate_content_config = types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            tools=tools,
        )

        for b_idx in range(0, len(sections), BATCH_SIZE):
            batch = sections[b_idx : b_idx + BATCH_SIZE]
            logger.info("Assembler: Polishing batch %d (%d sections)", (b_idx // BATCH_SIZE) + 1, len(batch))
            
            # Build raw HTML for this batch
            batch_parts = []
            for s in batch:
                s_key = s.get("key", "section")
                s_content = s.get("content", "").strip()
                if s_content:
                    batch_parts.append(f"<div class='document-section' id='section-{s_key}'>{s_content}</div>")
                    batch_parts.append("<!-- SECTION_BREAK --><div class='page-break'></div>")
            
            batch_raw = "\n".join(batch_parts)
            
            if not client or not batch_raw:
                polished_html_parts.append(batch_raw)
                continue

            try:
                parts = []
                if system_prompt:
                    parts.append(f"{system_prompt}\n\n")
                if template_content:
                    parts.append(f"ORIGINAL TEMPLATE FORMAT REFERENCE:\n{template_content}\n\n")
                
                parts.append(f"FIELD VALUES:\n{field_values}\n\n")
                parts.append(f"CURRENT BATCH CONTENT TO POLISH:\n{batch_raw}\n\n")
                parts.append("TASK: Fill all blanks/placeholders. Use 'Times New Roman'. Do NOT add section names. Match template spacing and alignment perfectly. Return ONLY polished HTML. PRESERVE <!-- SECTION_BREAK --> markers exactly.")

                response = client.models.generate_content(
                    model="gemini-flash-lite-latest",
                    contents=parts,
                    config=generate_content_config,
                )

                chunk_polished = response.text.strip() if response and response.text else batch_raw
                
                # Clean markdown artifacts
                import re
                chunk_polished = re.sub(r'```(?:html)?\s*(.*?)\s*```', r'\1', chunk_polished, flags=re.DOTALL).strip()
                chunk_polished = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', chunk_polished)
                chunk_polished = re.sub(r'\*(.*?)\*', r'<i>\1</i>', chunk_polished)
                
                polished_html_parts.append(chunk_polished)
            except Exception as e:
                logger.error("Assembler: Batch polishing failed: %s", e)
                polished_html_parts.append(batch_raw)

        final_document = "\n".join(polished_html_parts)

        # Step 3: Convert to DOCX and upload to Drafting Service (for Google Drive/GCS sync)
        try:
            import io
            from htmldocx import HtmlToDocx
            from docx import Document
            from docx.shared import Pt, Cm
            
            logger.info("Assembler: Converting final HTML to DOCX")
            doc = Document()
            
            # Set basic styling
            style = doc.styles['Normal']
            font = style.font
            font.name = 'Times New Roman'
            font.size = Pt(12)
            
            # Page setup
            section = doc.sections[0]
            section.page_height = Cm(29.7)
            section.page_width = Cm(21)
            
            parser = HtmlToDocx()
            
            # Use same split logic as export_routes
            content_parts = final_document.split('<!-- SECTION_BREAK -->')
            for i, part in enumerate(content_parts):
                clean_part = part.strip()
                if not clean_part: continue
                parser.add_html_to_document(clean_part, doc)
                if i < len(content_parts) - 1:
                    doc.add_page_break()
            
            # Final font pass
            for paragraph in doc.paragraphs:
                for run in paragraph.runs:
                    run.font.name = 'Times New Roman'
            
            doc_io = io.BytesIO()
            doc.save(doc_io)
            doc_io.seek(0)
            
            # Step 4: Upload to Drafting Service
            logger.info("Assembler: Uploading DOCX to Drafting Service")
            DRAFTING_SERVICE_URL = os.environ.get("DRAFTING_SERVICE_URL", "http://localhost:5005")
            
            # Get existing Google File ID from payload (if reassembling)
            existing_google_file_id = payload.get("existing_google_file_id")
            
            files = {
                'file': (f"Assembled_{draft_id}.docx", doc_io, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            }
            data = {
                'draft_id': draft_id,
                'title': f"Assembled_{draft_id}",
                'user_id': payload.get("user_id", ""),
                'existing_google_file_id': existing_google_file_id or ''  # Pass existing file ID for update
            }
            # Important: pass the user_id in headers as well if needed by middleware
            headers = {
                'x-user-id': str(payload.get("user_id", ""))
            }
            
            resp = requests.post(
                f"{DRAFTING_SERVICE_URL}/api/drafts/finish-assembled",
                files=files,
                data=data,
                headers=headers,
                timeout=120
            )
            
            upload_result = {}
            if resp.status_code == 200:
                upload_result = resp.json()
                logger.info("Assembler: ✅ Successfully uploaded to Drafting Service: %s", upload_result.get("googleFileId"))
            else:
                logger.error("Assembler: ❌ Failed to upload to Drafting Service. Status: %d, Message: %s", resp.status_code, resp.text)
                upload_result = {"error": f"Upload failed: {resp.text}"}

        except Exception as e:
            logger.exception("Assembler: Failed to generate/upload DOCX")
            upload_result = {"error": str(e)}

        return {
            "final_document": final_document,
            "format": "html",
            "sections_assembled": len(sections),
            "google_docs": upload_result,
            "metadata": {
                "draft_id": draft_id,
                "template_url": template_url,
                "ai_polished": True,
                "batch_processed": True,
                "google_file_id": upload_result.get("googleFileId"),
                "iframe_url": upload_result.get("iframeUrl"),
                "existing_file_id": payload.get("existing_google_file_id")  # Track if we updated existing
            }
        }

    except Exception as e:
        logger.exception("Assembler AI polishing failed")
        # Fallback to simple procedural assembly
        fallback_parts = []
        for s in sections:
            s_content = s.get("content", "").strip()
            if s_content:
                fallback_parts.append(s_content)
                fallback_parts.append("<!-- SECTION_BREAK --><div class='page-break'></div>")
        
        return {
            "final_document": "\n".join(fallback_parts),
            "error": str(e),
            "metadata": {"draft_id": draft_id, "ai_polished": False}
        }
