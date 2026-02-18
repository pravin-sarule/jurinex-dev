from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from ..database import get_db
from ..models.db_models import UserTemplate, UserTemplateField, UserTemplateAnalysisSection
from ..services.agent_service import AntigravityAgent
from ..services.document_ai_service import DocumentAIService
from pydantic import BaseModel
import uuid
import logging
from typing import List, Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analysis", tags=["Analysis"])

agent = AntigravityAgent()
doc_ai = DocumentAIService()

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
    name: str = Form(...),
    category: str = Form(...),
    subcategory: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    file: UploadFile = File(...),
    image: Optional[UploadFile] = File(None),
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """
    User endpoint: Upload and process a template.
    Flow: 
    1. Parse inputs
    2. Document AI Processing (Extract Text)
    3. Upload files to GCS
    4. Save initial UserTemplate record
    5. Phase 1 Analysis (Gemini) - Extract Sections & Fields
    6. Save UserTemplateField
    7. Phase 2 Analysis (Gemini) - Generate Prompts per Section
    8. Save UserTemplateAnalysisSection
    """
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
        
        if file.content_type == "application/pdf":
            print(f"[Template Analyzer] Processing PDF with Document AI...", flush=True)
            template_text = await doc_ai.parallel_process_pdf(file_content)
            print(f"[Template Analyzer] Document AI done. Extracted {len(template_text)} chars.", flush=True)
        else:
            print(f"[Template Analyzer] Processing as text file...", flush=True)
            template_text = file_content.decode('utf-8', errors='ignore')
            print(f"[Template Analyzer] Text decoded. Length: {len(template_text)}", flush=True)

        # --- 2. GCS Uploads ---
        logger.info(f"[STEP 3] Uploading assets to GCS...")
        print(f"[Template Analyzer] [STEP 3] Uploading to GCS...", flush=True)
        
        image_url = None
        if image:
            print(f"[Template Analyzer] Uploading cover image {image.filename}...", flush=True)
            image_content = await image.read()
            image_url = await doc_ai.upload_to_gcs(image_content, f"user_uploads/{user_id_int}/{template_id}/image_{image.filename}", image.content_type)
            print(f"[Template Analyzer] Image uploaded.", flush=True)

        file_url = None
        if file.content_type == "application/pdf":
            print(f"[Template Analyzer] Uploading PDF to GCS...", flush=True)
            file_url = await doc_ai.upload_to_gcs(file_content, f"user_uploads/{user_id_int}/{template_id}/doc_{file.filename}", "application/pdf")
            print(f"[Template Analyzer] PDF uploaded.", flush=True)

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
            status="active",
            file_url=file_url,
            image_url=image_url,
            user_id=user_id_int
        )
        db.add(new_template)
        await db.flush()
        print(f"[Template Analyzer] UserTemplate created id={template_id}", flush=True)

        signed_file_url = doc_ai.generate_signed_url(file_url) if file_url else None
        
        # --- 4. AI Analysis (Phase 1) ---
        logger.info(f"[STEP 5] Starting AI Analysis (Phase 1)...")
        print(f"[Template Analyzer] [STEP 5] Gemini structure analysis...", flush=True)
        
        analysis_result = await agent.analyze_template(template_text, template_file_signed_url=signed_file_url)
        num_sections = len(analysis_result.get('sections', []))
        print(f"[Template Analyzer] AI analysis done. Sections: {num_sections}", flush=True)

        # --- 5. Save Fields ---
        logger.info(f"[STEP 6] Saving Extracted Fields...")
        print(f"[Template Analyzer] [STEP 6] Saving UserTemplateField...", flush=True)
        
        new_field_entry = UserTemplateField(
            template_id=template_id, 
            template_fields=analysis_result
        )
        db.add(new_field_entry)

        # --- 6. AI Section Prompts (Phase 2) ---
        sections = analysis_result.get("sections", [])
        logger.info(f"[STEP 7] Processing {len(sections)} sections for prompts...")
        print(f"[Template Analyzer] [STEP 7] Generating prompts for {len(sections)} sections...", flush=True)
        
        for index, section in enumerate(sections):
            sec_name = section.get("section_name", "Untitled")
            print(f"[Template Analyzer]   Section {index+1}/{len(sections)}: '{sec_name}'", flush=True)
            
            prompt_data = await agent.generate_section_prompts(section)
            
            section_entry = UserTemplateAnalysisSection(
                template_id=template_id,
                section_name=sec_name,
                section_purpose=section.get("section_purpose", ""),
                section_intro=prompt_data.get("section_intro", ""),
                section_prompts=prompt_data.get("field_prompts", []),
                order_index=index
            )
            db.add(section_entry)
            
            # Flush periodically to avoid large pending state if many sections
            if index % 2 == 0:
                await db.flush()
                
            print(f"[Template Analyzer]   Section '{sec_name}' done.", flush=True)

        # --- 7. Final Commit ---
        logger.info(f"[STEP 8] Final Database Commit...")
        print(f"[Template Analyzer] [STEP 8] Committing to database...", flush=True)
        
        try:
            await db.commit()
            print(f"[Template Analyzer] Commit OK.", flush=True)
        except Exception as commit_error:
            logger.error(f"CRITICAL: DB Commit failed: {commit_error}")
            print(f"[Template Analyzer] CRITICAL: DB Commit failed: {commit_error}", flush=True)
            await db.rollback()
            raise commit_error

        logger.info(f"[SUCCESS] Template upload flow completed for {template_id}")
        print(f"[Template Analyzer] SUCCESS. template_id={template_id}", flush=True)
        return {
            "status": "success",
            "template_id": str(template_id),
            "image_url": doc_ai.generate_signed_url(image_url) if image_url else None,
            "message": "Template uploaded and processed successfully"
        }
        
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
        "sections": sections,
        "fields": fields
    }


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
    # Verify ownership logic would typically go here or be implicit by lookup
    
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

