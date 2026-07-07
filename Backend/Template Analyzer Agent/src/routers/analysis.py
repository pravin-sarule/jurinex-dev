from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, Header, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from ..database import get_db, AsyncSessionLocal
from ..models.db_models import UserTemplate, UserTemplateField, UserTemplateAnalysisSection, UserTemplateReferenceDocument
from ..services.agent_service import AntigravityAgent
from ..services.document_ai_service import DocumentAIService
from ..services.field_extractor import HybridFieldExtractor
from pydantic import BaseModel
import uuid
import logging
import re
import io
import zipfile
from typing import Any, Dict, List, Optional
from xml.etree import ElementTree

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analysis", tags=["Analysis"])

agent = AntigravityAgent()
doc_ai = DocumentAIService()
field_extractor = HybridFieldExtractor()

_UNDERSCORE_PLACEHOLDER_RE = re.compile(r"(?<!_)_([A-Za-z][A-Za-z0-9_]{1,80})_(?!_)")


def _build_validation_gate(analysis_result: Dict[str, Any], template_text: str) -> Dict[str, Any]:
    sections = analysis_result.get("sections", []) or []
    all_fields = analysis_result.get("all_fields", []) or []
    warnings: List[str] = []

    section_names = [str(s.get("section_name") or "").strip().lower() for s in sections if isinstance(s, dict)]
    has_prayer = any("prayer" in n for n in section_names)
    has_verification = any("verification" in n for n in section_names)
    if not has_prayer:
        warnings.append("Mandatory section missing: Prayer")
    if not has_verification:
        warnings.append("Mandatory section missing: Verification")

    section_field_counts = [
        len((s.get("fields") or [])) for s in sections if isinstance(s, dict)
    ]
    empty_sections = sum(1 for c in section_field_counts if c == 0)
    if empty_sections:
        warnings.append(f"{empty_sections} section(s) have no mapped fields; consider manual field tagging.")

    mapped_keys = {
        str(f.get("key") or "").strip().lower()
        for f in all_fields
        if isinstance(f, dict) and str(f.get("key") or "").strip()
    }
    raw_underscore_keys = {m.group(1).strip().lower() for m in _UNDERSCORE_PLACEHOLDER_RE.finditer(str(template_text or ""))}
    orphan_keys = sorted(k for k in raw_underscore_keys if k and k not in mapped_keys)
    if orphan_keys:
        warnings.append(f"Orphan placeholders not mapped to fields: {', '.join(orphan_keys[:20])}")

    passed = len(warnings) == 0
    return {
        "passed": passed,
        "warnings": warnings,
        "checks": {
            "mandatory_sections": {
                "prayer_present": has_prayer,
                "verification_present": has_verification,
            },
            "section_field_coverage": {
                "total_sections": len(sections),
                "sections_without_fields": empty_sections,
            },
            "orphan_placeholder_count": len(orphan_keys),
        },
    }


def _extract_docx_text(file_content: bytes) -> str:
    """
    Extract text from a DOCX file (zip-based).
    Raises HTTPException(400) when the content is not actually a DOCX zip package.
    """
    try:
        with zipfile.ZipFile(io.BytesIO(file_content)) as archive:
            document_xml = archive.read("word/document.xml")
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=400,
            detail="Invalid DOCX upload. This file is not a valid DOCX (zip package). Please upload PDF or DOCX.",
        )

    root = ElementTree.fromstring(document_xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: List[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        runs = [node.text for node in paragraph.findall(".//w:t", namespace) if node.text]
        text = "".join(runs).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


def _looks_like_docx_zip(file_content: bytes) -> bool:
    """
    DOCX files are zip archives. If the first bytes match the ZIP magic number,
    treat it as a DOCX even if extension/content-type looks wrong.
    """
    return len(file_content) >= 4 and file_content[:2] == b"PK"


async def _extract_reference_document_text(file: UploadFile, file_content: bytes) -> str:
    filename = (file.filename or "").lower()
    content_type = (file.content_type or "").lower()

    if filename.endswith(".pdf") or content_type == "application/pdf":
        return await doc_ai.parallel_process_pdf(file_content)

    if filename.endswith(".docx") or content_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }:
        return _extract_docx_text(file_content)

    # Some clients may send .doc content with a misleading content-type; only accept it
    # if it actually looks like a DOCX zip package.
    if filename.endswith(".doc") or content_type.startswith("application/msword"):
        if _looks_like_docx_zip(file_content):
            return _extract_docx_text(file_content)
        raise HTTPException(
            status_code=400,
            detail="Unsupported reference document format: .doc. Please upload PDF, DOCX, or TXT.",
        )

    if filename.endswith(".txt") or content_type.startswith("text/") or not content_type:
        return file_content.decode("utf-8", errors="ignore")

    raise HTTPException(status_code=400, detail=f"Unsupported reference document type for {file.filename}. Use PDF, DOCX, or TXT.")


def _split_gs_uri(gs_uri: str) -> tuple[str, str]:
    if not gs_uri.startswith("gs://"):
        raise ValueError(f"Invalid gs uri: {gs_uri}")
    bucket_and_path = gs_uri[5:]
    bucket, path = bucket_and_path.split("/", 1)
    return bucket, path


def _normalize_placeholder_spacing(template_text: str) -> str:
    normalized = re.sub(r"\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}", r"{{\1}}", template_text)

    prev_text = None
    while prev_text != normalized:
        prev_text = normalized
        normalized = re.sub(
            r"(__[a-zA-Z][a-zA-Z0-9_]*)\s*\n\s*([a-zA-Z0-9_]+__)",
            lambda m: m.group(1) + m.group(2),
            normalized,
        )
        normalized = re.sub(
            r"(\{\{[a-zA-Z][a-zA-Z0-9_]*)\s*\n\s*([a-zA-Z0-9_]+\}\})",
            lambda m: m.group(1) + m.group(2),
            normalized,
        )
        normalized = re.sub(
            r"(\{[a-zA-Z][a-zA-Z0-9_\- ]*)\s*\n\s*([a-zA-Z0-9_\- ]+\})",
            lambda m: m.group(1) + m.group(2),
            normalized,
        )
        normalized = re.sub(
            r"(\[[a-zA-Z][a-zA-Z0-9_\- ]*)\s*\n\s*([a-zA-Z0-9_\- ]+\])",
            lambda m: m.group(1) + m.group(2),
            normalized,
        )
        normalized = re.sub(
            r"(\([a-zA-Z][a-zA-Z0-9_\- ]*)\s*\n\s*([a-zA-Z0-9_\- ]+\))",
            lambda m: m.group(1) + m.group(2),
            normalized,
        )

    return normalized


def _normalize_field_item(field: Dict[str, Any], fallback_section_id: str = "") -> Dict[str, Any]:
    key = (
        field.get("key")
        or field.get("field_id")
        or field.get("field_name")
        or ""
    )
    key = re.sub(r"[^a-zA-Z0-9_]+", "_", str(key).strip().lower()).strip("_")
    if not key:
        return {}

    return {
        "key": key,
        "type": field.get("type") or field.get("field_type") or "text",
        "label": field.get("label") or field.get("field_label") or key.replace("_", " ").title(),
        "required": bool(field.get("required", field.get("is_required", False))),
        "description": field.get("description") or field.get("help_text") or "",
        "default_value": field.get("default_value") or "",
        "validation_rules": field.get("validation_rules") or field.get("validation") or "",
        "section_id": field.get("section_id") or fallback_section_id or "",
    }


def _dedupe_fields(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    deduped: List[Dict[str, Any]] = []
    seen: Dict[str, Dict[str, Any]] = {}

    for raw_field in fields:
        normalized = _normalize_field_item(raw_field, raw_field.get("section_id", ""))
        if not normalized:
            continue
        key = normalized["key"]
        existing = seen.get(key)
        if not existing:
            seen[key] = normalized
            deduped.append(normalized)
            continue

        if not existing.get("section_id") and normalized.get("section_id"):
            existing["section_id"] = normalized["section_id"]
        if not existing.get("description") and normalized.get("description"):
            existing["description"] = normalized["description"]
        if existing.get("type") in ("text", "string") and normalized.get("type") not in ("text", "string"):
            existing["type"] = normalized["type"]
        existing["required"] = existing.get("required", False) or normalized.get("required", False)

    return deduped


def _find_section_id_for_field(field_key: str, section_name: str, section_id: str, template_text: str) -> bool:
    haystacks = [
        str(section_name or "").lower(),
        str(section_id or "").lower(),
    ]
    needle = str(field_key or "").lower().replace("_", " ").strip()
    text_l = template_text.lower()

    if needle and any(needle in hay for hay in haystacks):
        return True
    if section_name and section_name.lower() in text_l and needle:
        section_pos = text_l.find(section_name.lower())
        field_pos = text_l.find(needle)
        if section_pos != -1 and field_pos != -1:
            return abs(field_pos - section_pos) < 2500
    return False


def _distribute_fields_to_sections(analysis_result: Dict[str, Any], template_text: str, hybrid_fields_list: List[Dict[str, Any]]) -> None:
    sections = analysis_result.get("sections", []) or []
    if not sections:
        return

    all_fields = analysis_result.get("all_fields", []) or []
    all_fields = _dedupe_fields(all_fields + hybrid_fields_list)
    analysis_result["all_fields"] = all_fields

    for section in sections:
        section_id = section.get("section_id") or ""
        section_name = section.get("section_name") or ""
        existing_fields = _dedupe_fields(section.get("fields", []) or [])
        existing_keys = {field["key"] for field in existing_fields}

        for field in all_fields:
            field_key = field.get("key", "")
            field_section_id = field.get("section_id", "")
            should_attach = False

            if field_section_id and field_section_id == section_id:
                should_attach = True
            elif _find_section_id_for_field(field_key, section_name, section_id, template_text):
                should_attach = True

            if should_attach and field_key not in existing_keys:
                attached = dict(field)
                attached["section_id"] = section_id
                existing_fields.append(attached)
                existing_keys.add(field_key)

        section["fields"] = existing_fields


def _sync_all_fields_into_sections(analysis_result: Dict[str, Any]) -> None:
    all_fields = analysis_result.get("all_fields", []) or []
    if not all_fields:
        return

    fields_by_section: Dict[str, List[Dict[str, Any]]] = {}
    for field in all_fields:
        normalized = _normalize_field_item(field, field.get("section_id", ""))
        if not normalized:
            continue
        section_id = normalized.get("section_id") or ""
        if not section_id:
            continue
        fields_by_section.setdefault(section_id, []).append(normalized)

    for section in analysis_result.get("sections", []) or []:
        section_id = section.get("section_id") or ""
        section_fields = _dedupe_fields(section.get("fields", []) or [])
        known = {field["key"] for field in section_fields}
        for field in fields_by_section.get(section_id, []):
            if field["key"] not in known:
                section_fields.append(field)
                known.add(field["key"])
        section["fields"] = section_fields


async def _run_analysis_background(
    template_id: uuid.UUID,
    template_text: str,
    template_file_signed_url: Optional[str] = None,
) -> None:
    async with AsyncSessionLocal() as db:
        try:
            analysis_result = await agent.analyze_template(
                template_text,
                template_file_signed_url=template_file_signed_url,
            )
            # Persist original normalized template text so downstream services
            # (chat-draft/template content endpoints) can always reconstruct
            # the source template even when only PDF assets exist in storage.
            analysis_result["template_text"] = template_text
            hybrid_schema = field_extractor.extract_from_text(template_text)
            analysis_result["hybrid_fields"] = hybrid_schema
            hybrid_fields_list = hybrid_schema.get("fields", []) if isinstance(hybrid_schema, dict) else []
            _distribute_fields_to_sections(analysis_result, template_text, hybrid_fields_list)
            analysis_result["all_fields"] = _dedupe_fields((analysis_result.get("all_fields", []) or []) + hybrid_fields_list)
            _sync_all_fields_into_sections(analysis_result)

            # Contextual legal typing/enrichment for extracted fields
            # (deterministic in the redesigned agent — no extra LLM call)
            try:
                field_context = await agent.contextualize_fields(template_text, analysis_result.get("all_fields", []))
                if isinstance(field_context, dict):
                    for field in analysis_result.get("all_fields", []) or []:
                        if not isinstance(field, dict):
                            continue
                        key = str(field.get("key") or "").strip()
                        if not key:
                            continue
                        ctx = field_context.get(key) or field_context.get(key.lower())
                        if isinstance(ctx, dict):
                            field["legal_type"] = ctx.get("legal_type") or field.get("type")
                            field["ui_hint"] = ctx.get("ui_hint") or field.get("ui_hint")
                            if ctx.get("description"):
                                field["description"] = ctx["description"]
                            if ctx.get("validation_hint"):
                                field["validation_rules"] = ctx["validation_hint"]
            except Exception as context_err:
                logger.warning("[BackgroundAnalysis] Contextual field labeling failed: %s", context_err)

            validation_gate = _build_validation_gate(analysis_result, template_text)
            analysis_result["validation_gate"] = validation_gate

            await db.execute(delete(UserTemplateAnalysisSection).where(UserTemplateAnalysisSection.template_id == template_id))

            field_result = await db.execute(select(UserTemplateField).where(UserTemplateField.template_id == template_id))
            field_entry = field_result.scalar_one_or_none()
            if field_entry:
                field_entry.template_fields = analysis_result
            else:
                db.add(UserTemplateField(template_id=template_id, template_fields=analysis_result))

            sections = analysis_result.get("sections", []) or []

            # Section prompts are built deterministically from the verbatim
            # source segments (no LLM calls), so this loop is effectively free.
            prompt_payloads: List[Dict[str, Any]] = []
            for section in sections:
                section_with_type = {**section, "document_type": analysis_result.get("document_type", "")}
                prompt_payloads.append(await agent.generate_section_prompts(section_with_type))

            for index, section in enumerate(sections):
                prompt_data = prompt_payloads[index] if index < len(prompt_payloads) else {}
                section_schema = {
                    "section_name": section.get("section_name", "Untitled"),
                    "template_logic": section.get("template_logic", ""),
                    "required_fields": section.get("required_fields") or [f.get("key") for f in section.get("fields", []) if isinstance(f, dict) and f.get("key")],
                    "ai_drafting_instruction": section.get("ai_drafting_instruction") or (
                        (
                            ((prompt_data.get("field_prompts") or [{}])[0] or {}).get("prompt")
                            if isinstance(prompt_data, dict) else ""
                        ) or section.get("drafting_prompt", "")
                    ),
                    "constraint_set": (prompt_data.get("constraint_set") or []) if isinstance(prompt_data, dict) else [],
                    "start_marker": section.get("start_marker", ""),
                    "end_marker": section.get("end_marker", ""),
                    "start_line": section.get("start_line", 0),
                    "end_line": section.get("end_line", 0),
                }
                db.add(
                    UserTemplateAnalysisSection(
                        template_id=template_id,
                        section_name=section.get("section_name", "Untitled"),
                        section_purpose=section.get("section_purpose", ""),
                        section_intro=prompt_data.get("section_intro", ""),
                        section_prompts=[section_schema],
                        order_index=section.get("order", index),
                    )
                )

            template_result = await db.execute(select(UserTemplate).where(UserTemplate.template_id == template_id))
            template = template_result.scalar_one_or_none()
            if template:
                template.status = "active"

            await db.commit()
            if not validation_gate.get("passed", True):
                logger.warning(
                    "[BackgroundAnalysis][ValidationGate] template %s completed with warnings: %s",
                    template_id,
                    validation_gate.get("warnings", []),
                )
            logger.info(f"[BackgroundAnalysis] Completed for template {template_id}")
        except Exception as err:
            await db.rollback()
            logger.error(f"[BackgroundAnalysis] Failed for template {template_id}: {err}", exc_info=True)
            try:
                template_result = await db.execute(select(UserTemplate).where(UserTemplate.template_id == template_id))
                template = template_result.scalar_one_or_none()
                if template:
                    template.status = "error"
                    await db.commit()
            except Exception:
                await db.rollback()


def enqueue_template_analysis(
    background_tasks: BackgroundTasks,
    template_id: uuid.UUID,
    template_text: str,
    template_file_signed_url: Optional[str] = None,
) -> None:
    background_tasks.add_task(
        _run_analysis_background,
        template_id,
        template_text,
        template_file_signed_url,
    )


def _merge_sections_with_saved_prompts(saved_sections: List[Dict[str, Any]], analysis_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    analysis_sections = analysis_payload.get("sections", []) if isinstance(analysis_payload, dict) else []
    analysis_by_id = {str(section.get("section_id") or ""): section for section in analysis_sections}
    analysis_by_name = {str(section.get("section_name") or "").strip().lower(): section for section in analysis_sections}

    merged_sections: List[Dict[str, Any]] = []
    used_ids = set()

    for saved in saved_sections:
        match = analysis_by_name.get(str(saved.get("section_name") or "").strip().lower())
        if not match and saved.get("id"):
            match = analysis_by_id.get(str(saved["id"]))

        merged = {
            **(match or {}),
            **saved,
            "section_id": (match or {}).get("section_id") or saved.get("id") or "",
            "fields": _dedupe_fields((match or {}).get("fields", []) or []),
            "drafting_prompt": (match or {}).get("drafting_prompt", ""),
            "format_blueprint": (match or {}).get("format_blueprint", []),
        }
        used_ids.add(str(merged.get("section_id") or ""))
        merged_sections.append(merged)

    for section in analysis_sections:
        section_id = str(section.get("section_id") or "")
        if section_id and section_id in used_ids:
            continue
        merged_sections.append({
            **section,
            "id": section_id,
            "section_prompts": [],
            "order_index": section.get("order", 0),
            "is_active": True,
        })

    merged_sections.sort(key=lambda item: item.get("order_index", item.get("order", 0)))
    return merged_sections

@router.get("/")
async def analysis_root():
    return {"status": "active", "service": "User Template Analysis API", "endpoints": ["/templates", "/upload-template"]}

@router.get("/templates")
async def get_user_templates(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    x_user_id: Optional[str] = Header(None)
):
    """Get all templates for a specific user. Optional ?status=finalized to return only finalized templates (for draft section)."""
    print("[Template Analyzer] GET /templates received", flush=True)
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
    
    try:
        user_id_int = int(x_user_id)
    except ValueError:
         raise HTTPException(status_code=400, detail="Invalid X-User-Id format")

    logger.info(f"Fetching templates for user_id: {user_id_int}, status filter: {status}")
    print(f"[Template Analyzer] GET /templates for user_id={user_id_int}, status={status}", flush=True)
    
    query = select(UserTemplate).where(UserTemplate.user_id == user_id_int)
    if status and status.strip().lower() == "finalized":
        query = query.where(UserTemplate.status == "finalized")
    result = await db.execute(query)
    templates = list(result.scalars().all())
    
    for t in templates:
        if t.image_url and t.image_url.startswith("gs://"):
            t.image_url = doc_ai.generate_signed_url(t.image_url)

    print(f"[Template Analyzer] GET /templates returning {len(templates)} templates", flush=True)
    return templates

@router.delete("/template/{template_id}")
async def delete_template(
    template_id: uuid.UUID, 
    db: AsyncSession = Depends(get_db),
    x_user_id: Optional[str] = Header(None)
):
    """Delete a user-owned template."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
        
    try:
        user_id_int = int(x_user_id)
    except ValueError:
         raise HTTPException(status_code=400, detail="Invalid X-User-Id format")
         
    logger.info(f"Request to delete template {template_id} by user {user_id_int}")

    result = await db.execute(select(UserTemplate).where(
        (UserTemplate.template_id == template_id) & 
        (UserTemplate.user_id == user_id_int)
    ))
    template = result.scalar_one_or_none()
    
    if not template:
        logger.warning(f"Template {template_id} not found for user {user_id_int}")
        raise HTTPException(status_code=404, detail="Template not found")
        
    await db.execute(delete(UserTemplateAnalysisSection).where(UserTemplateAnalysisSection.template_id == template_id))
    await db.execute(delete(UserTemplateField).where(UserTemplateField.template_id == template_id))
    await db.execute(delete(UserTemplate).where(UserTemplate.template_id == template_id))
    await db.commit()
    
    logger.info(f"Template {template_id} deleted successfully.")
    return {"status": "success", "message": "Template deleted"}

@router.post("/upload-template")
async def upload_template(
    background_tasks: BackgroundTasks,
    name: str = Form(...),
    category: str = Form(...),
    subcategory: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...),
    image: Optional[UploadFile] = File(None),
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """Upload template and start asynchronous analysis."""
    print("[Template Analyzer] POST /upload-template received", flush=True)
    logger.info("POST /analysis/upload-template request received")

    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
    
    try:
        user_id_int = int(x_user_id)
    except ValueError:
         raise HTTPException(status_code=400, detail="Invalid X-User-Id format")

    logger.info(f"STARTING TEMPLATE UPLOAD FLOW for User: {user_id_int}, Template Name: {name}")
    print(f"[Template Analyzer] [STEP 1] Upload request. Name: {name}, User: {user_id_int}", flush=True)

    try:
        template_id = uuid.uuid4()
        file_content = await file.read()
        template_text = ""
        
        # --- 1. Document Processing ---
        logger.info(f"[STEP 2] Processing file: {file.filename}, Type: {file.content_type}")
        print(f"[Template Analyzer] [STEP 2] Document AI/Text extraction... file={file.filename}", flush=True)
        
        filename_lower = (file.filename or "").lower()
        content_type = (file.content_type or "").lower()

        if content_type == "application/pdf" or filename_lower.endswith(".pdf"):
            print(f"[Template Analyzer] Processing PDF with Document AI...", flush=True)
            template_text = await doc_ai.parallel_process_pdf(file_content)
            print(f"[Template Analyzer] Document AI done. Extracted {len(template_text)} chars.", flush=True)
        elif (
            content_type in {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
            or filename_lower.endswith(".docx")
            or (filename_lower.endswith(".doc") and _looks_like_docx_zip(file_content))
        ):
            # Only treat as DOCX when the content is actually a zip package.
            print(f"[Template Analyzer] Extracting DOCX text...", flush=True)
            template_text = _extract_docx_text(file_content)
            print(f"[Template Analyzer] DOCX extracted. Length: {len(template_text)}", flush=True)
        elif filename_lower.endswith(".doc") or content_type.startswith("application/msword"):
            # .doc is not supported by our DOCX extractor (it is not zip-based).
            raise HTTPException(
                status_code=400,
                detail="Unsupported template file format (.doc). Please upload PDF or DOCX.",
            )
        else:
            print(f"[Template Analyzer] Processing as plain text...", flush=True)
            template_text = file_content.decode('utf-8', errors='ignore')
            print(f"[Template Analyzer] Text decoded. Length: {len(template_text)}", flush=True)

        template_text = _normalize_placeholder_spacing(template_text)

        # --- 2. GCS Uploads — upload ALL file types so file_url is always set ---
        logger.info(f"[STEP 3] Uploading assets to GCS...")
        print(f"[Template Analyzer] [STEP 3] Uploading to GCS...", flush=True)

        image_url = None
        if image:
            print(f"[Template Analyzer] Uploading cover image {image.filename}...", flush=True)
            image_content = await image.read()
            image_url = await doc_ai.upload_to_gcs(image_content, f"user_uploads/{user_id_int}/{template_id}/image_{image.filename}", image.content_type)
            print(f"[Template Analyzer] Image uploaded.", flush=True)

        # Always upload the template file so chat-draft-backend can fetch it later
        print(f"[Template Analyzer] Uploading template file to GCS...", flush=True)
        safe_filename = re.sub(r"[^A-Za-z0-9._-]+", "_", file.filename or "template")
        file_url = await doc_ai.upload_to_gcs(
            file_content,
            f"user_uploads/{user_id_int}/{template_id}/doc_{safe_filename}",
            content_type or "application/octet-stream",
        )
        print(f"[Template Analyzer] Template file uploaded. GCS URL stored.", flush=True)

        # --- 3. Save UserTemplate ---
        logger.info(f"[STEP 4] Saving UserTemplate to Database...")
        print(f"[Template Analyzer] [STEP 4] Saving UserTemplate to DB...", flush=True)

        new_template = UserTemplate(
            template_id=template_id,
            template_name=name,
            category=category,
            sub_category=subcategory,
            description=description,
            language="en",
            status="processing",
            file_url=file_url,
            image_url=image_url,
            user_id=user_id_int
        )
        db.add(new_template)

        # Persist extracted text immediately so content endpoint can serve it
        # before background analysis finishes
        if template_text:
            initial_fields = UserTemplateField(
                template_id=template_id,
                template_fields={"original_template_text": template_text},
                is_active=True,
            )
            db.add(initial_fields)

        await db.commit()
        print(f"[Template Analyzer] UserTemplate created id={template_id}", flush=True)

        signed_file_url = doc_ai.generate_signed_url(file_url) if file_url else None
        enqueue_template_analysis(background_tasks, template_id, template_text, signed_file_url)
        logger.info(f"[Template Analyzer] Analysis queued for template_id={template_id}")
        return {
            "status": "processing",
            "template_id": str(template_id),
            "image_url": doc_ai.generate_signed_url(image_url) if image_url else None,
            "message": "Template uploaded. Analysis is running in background."
        }
        
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error in upload_template: {str(e)}", exc_info=True)
        print(f"[Template Analyzer] ERROR: {str(e)}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/template/{template_id}")
async def get_template_details(
    template_id: uuid.UUID, 
    db: AsyncSession = Depends(get_db),
    x_user_id: Optional[str] = Header(None)
):
    """Fetch user template details."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
        
    try:
        user_id_int = int(x_user_id)
    except ValueError:
         raise HTTPException(status_code=400, detail="Invalid X-User-Id format")
         
    result = await db.execute(select(UserTemplate).where(
        (UserTemplate.template_id == template_id) &
        (UserTemplate.user_id == user_id_int)
    ))
    template = result.scalar_one_or_none()
    
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    image_url = template.image_url
    if image_url and str(image_url).startswith("gs://"):
        image_url = doc_ai.generate_signed_url(image_url)

    sections_result = await db.execute(
        select(UserTemplateAnalysisSection)
        .where(UserTemplateAnalysisSection.template_id == template_id)
        .order_by(UserTemplateAnalysisSection.order_index)
    )
    section_rows = sections_result.scalars().all()
    sections = []
    for s in section_rows:
        sections.append({
            "id": str(s.id),
            "template_id": str(s.template_id),
            "section_name": s.section_name,
            "section_purpose": s.section_purpose,
            "section_intro": s.section_intro,
            "section_prompts": s.section_prompts or [],
            "order_index": s.order_index,
            "is_active": s.is_active,
        })

    fields_result = await db.execute(select(UserTemplateField).where(UserTemplateField.template_id == template_id))
    fields_entry = fields_result.scalar_one_or_none()
    fields = fields_entry.template_fields if fields_entry else {}
    if isinstance(fields, dict):
        fields["all_fields"] = _dedupe_fields(fields.get("all_fields", []) or [])
        _sync_all_fields_into_sections(fields)
    merged_sections = _merge_sections_with_saved_prompts(sections, fields if isinstance(fields, dict) else {})
    reference_docs_result = await db.execute(
        select(UserTemplateReferenceDocument)
        .where(UserTemplateReferenceDocument.template_id == template_id)
        .order_by(UserTemplateReferenceDocument.created_at.asc())
    )
    reference_docs = reference_docs_result.scalars().all()

    template_dict = {
        "template_id": str(template.template_id),
        "template_name": template.template_name,
        "category": template.category,
        "sub_category": template.sub_category,
        "language": template.language,
        "status": template.status,
        "description": template.description,
        "user_id": template.user_id,
        "image_url": image_url,
        "file_url": template.file_url,
    }
    return {
        "template": template_dict,
        "sections": merged_sections,
        "fields": fields,
        "reference_documents": [
            {
                "id": str(doc.id),
                "original_file_name": doc.original_file_name,
                "content_type": doc.content_type,
                "gcs_bucket": doc.gcs_bucket,
                "gcs_path": doc.gcs_path,
                "gs_uri": doc.gs_uri,
                "signed_url": doc_ai.generate_signed_url(doc.gs_uri),
                "created_at": doc.created_at.isoformat() if doc.created_at else None,
            }
            for doc in reference_docs
        ],
    }


@router.get("/template/{template_id}/status")
async def get_template_status(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    x_user_id: Optional[str] = Header(None),
):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")

    try:
        user_id_int = int(x_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-User-Id format")

    result = await db.execute(select(UserTemplate).where(
        (UserTemplate.template_id == template_id) &
        (UserTemplate.user_id == user_id_int)
    ))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    sections_count_result = await db.execute(
        select(func.count(UserTemplateAnalysisSection.id)).where(
            UserTemplateAnalysisSection.template_id == template_id
        )
    )
    sections_ready = int(sections_count_result.scalar() or 0)
    return {
        "template_id": str(template_id),
        "status": template.status,
        "sections_ready": sections_ready,
    }


@router.post("/template/{template_id}/reference-documents")
async def upload_reference_documents(
    template_id: uuid.UUID,
    reference_documents: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    x_user_id: Optional[str] = Header(None),
):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")

    try:
        user_id_int = int(x_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-User-Id format")

    result = await db.execute(select(UserTemplate).where(
        (UserTemplate.template_id == template_id) &
        (UserTemplate.user_id == user_id_int)
    ))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    stored_docs = []
    try:
        for file in reference_documents:
            file_content = await file.read()
            if not file_content:
                continue

            extracted_text = await _extract_reference_document_text(file, file_content)
            safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", file.filename or "reference_document")
            gs_uri = await doc_ai.upload_to_gcs(
                file_content,
                f"user_template_reference_documents/{user_id_int}/{template_id}/{uuid.uuid4()}_{safe_name}",
                file.content_type or "application/octet-stream",
            )
            if not gs_uri:
                raise HTTPException(status_code=500, detail=f"Failed to upload {file.filename} to GCS")

            bucket, path = _split_gs_uri(gs_uri)
            row = UserTemplateReferenceDocument(
                template_id=template_id,
                original_file_name=file.filename or "reference_document",
                content_type=file.content_type or "application/octet-stream",
                gcs_bucket=bucket,
                gcs_path=path,
                gs_uri=gs_uri,
                extracted_text=extracted_text,
                is_active=True,
            )
            db.add(row)
            stored_docs.append(row)

        await db.commit()
        return {
            "status": "success",
            "reference_documents": [
                {
                    "id": str(doc.id),
                    "original_file_name": doc.original_file_name,
                    "content_type": doc.content_type,
                    "gcs_bucket": doc.gcs_bucket,
                    "gcs_path": doc.gcs_path,
                    "gs_uri": doc.gs_uri,
                    "signed_url": doc_ai.generate_signed_url(doc.gs_uri),
                }
                for doc in stored_docs
            ],
        }
    except Exception:
        await db.rollback()
        raise


@router.get("/template/{template_id}/sections")
async def get_template_sections(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    x_user_id: Optional[str] = Header(None),
):
    """
    Get sections only for a user-uploaded template.
    Used by agent-draft-service to fetch sections for UUID templates.
    Returns JSON-serializable list: [{ id, section_name, section_purpose, section_intro, section_prompts, order_index }, ...]
    """
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
    try:
        user_id_int = int(x_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-User-Id format")

    result = await db.execute(select(UserTemplate).where(
        (UserTemplate.template_id == template_id) & (UserTemplate.user_id == user_id_int)
    ))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Template not found")

    sections_result = await db.execute(
        select(UserTemplateAnalysisSection)
        .where(UserTemplateAnalysisSection.template_id == template_id)
        .order_by(UserTemplateAnalysisSection.order_index)
    )
    rows = sections_result.scalars().all()
    # Return JSON-serializable list for agent-draft-service
    sections = []
    for s in rows:
        sections.append({
            "id": str(s.id),
            "template_id": str(s.template_id),
            "section_name": s.section_name,
            "section_purpose": s.section_purpose,
            "section_intro": s.section_intro,
            "section_prompts": s.section_prompts or [],
            "order_index": s.order_index,
            "is_active": s.is_active,
        })
    return {"sections": sections, "count": len(sections)}


class UpdateFieldsRequest(BaseModel):
    template_fields: dict

@router.put("/template/{template_id}/fields")
async def update_template_fields(
    template_id: uuid.UUID,
    request: UpdateFieldsRequest,
    db: AsyncSession = Depends(get_db),
    x_user_id: Optional[str] = Header(None)
):
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")

    try:
        user_id_int = int(x_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid X-User-Id format")

    ownership = await db.execute(select(UserTemplate).where(
        (UserTemplate.template_id == template_id) &
        (UserTemplate.user_id == user_id_int)
    ))
    if not ownership.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Template not found")

    result = await db.execute(select(UserTemplateField).where(UserTemplateField.template_id == template_id))
    field_entry = result.scalar_one_or_none()

    if not field_entry:
        raise HTTPException(status_code=404, detail="Template fields not found")
        
    field_entry.template_fields = request.template_fields
    await db.commit()
    return {"status": "success", "message": "Fields updated"}

class UpdateTemplateMetadataRequest(BaseModel):
    template_name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    status: Optional[str] = None  # e.g. 'active', 'finalized' — set in template section for draft visibility

@router.put("/template/{template_id}")
async def update_template_metadata(
    template_id: uuid.UUID, 
    request: UpdateTemplateMetadataRequest, 
    db: AsyncSession = Depends(get_db),
    x_user_id: Optional[str] = Header(None)
):
    """Update template metadata (name, description, category)."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
        
    try:
        user_id_int = int(x_user_id)
    except ValueError:
         raise HTTPException(status_code=400, detail="Invalid X-User-Id format")

    logger.info(f"Updating metadata for template {template_id} by user {user_id_int}")

    # Fetch template
    result = await db.execute(select(UserTemplate).where(
        (UserTemplate.template_id == template_id) & 
        (UserTemplate.user_id == user_id_int)
    ))
    template = result.scalar_one_or_none()
    
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Update fields if provided
    if request.template_name is not None:
        template.template_name = request.template_name
    if request.description is not None:
        template.description = request.description
    if request.category is not None:
        template.category = request.category
    if request.sub_category is not None:
        template.sub_category = request.sub_category
    if request.status is not None and request.status.strip() in ("active", "finalized"):
        template.status = request.status.strip()

    try:
        await db.commit()
        await db.refresh(template)
        return {"status": "success", "message": "Template metadata updated", "template": template}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating template metadata: {e}")
        raise HTTPException(status_code=500, detail=str(e))

