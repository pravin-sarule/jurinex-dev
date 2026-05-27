from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.services import branding_service
from app.services import branding_pdf_service
from app.services.db import is_db_available

router = APIRouter(prefix="/api/branding", tags=["branding"])
logger = logging.getLogger("agentic_document_service.api.branding")


def _require_user(x_user_id: str | None) -> str:
    if not x_user_id:
        raise HTTPException(status_code=401, detail="X-User-Id header is required")
    return x_user_id


def _require_db() -> None:
    if not is_db_available():
        raise HTTPException(status_code=503, detail="Database not configured")


class ProfilePayload(BaseModel):
    model_config = {"extra": "allow"}

    name: str = ""
    isDefault: bool = False


class ExportPdfRequest(BaseModel):
    """Full HTML from frontend buildBrandedHtml(..., { forPdf: true })."""

    html: str = Field(min_length=1, description="Complete HTML document for Chromium print")
    filename: str | None = Field(default="export.pdf", max_length=255)
    profileId: str | None = Field(default=None, description="Optional DB profile id")
    profile: dict[str, Any] | None = Field(
        default=None,
        description="Inline branding profile (footer/margins) when profile is only in localStorage",
    )


# ── Export PDF (Chromium / Playwright) ────────────────────────────────────────


@router.post("/export-pdf")
def export_branded_pdf(
    body: ExportPdfRequest,
    x_user_id: str | None = Header(default=None),
) -> Response:
    """
    Primary branded PDF path: HTML from frontend → Chromium print → PDF bytes.
    Requires Playwright with Chromium installed on the server.
    """
    _require_user(x_user_id)
    if not branding_pdf_service.is_pdf_renderer_available():
        raise HTTPException(
            status_code=503,
            detail="PDF export unavailable. Install Playwright: pip install playwright && playwright install chromium",
        )

    profile: dict[str, Any] | None = body.profile if isinstance(body.profile, dict) else None
    if body.profileId:
        _require_db()
        db_profile = branding_service.get_profile(x_user_id, body.profileId)
        if db_profile:
            profile = {**(profile or {}), **db_profile}
        elif not profile:
            raise HTTPException(status_code=404, detail="Branding profile not found")

    t0 = time.monotonic()
    try:
        pdf_bytes = branding_pdf_service.html_to_pdf(body.html, profile)
    except Exception as exc:
        logger.exception("[BrandingExport] pdf_render_failed user=%s: %s", x_user_id, exc)
        raise HTTPException(status_code=500, detail=f"PDF rendering failed: {exc}") from exc

    safe_name = branding_pdf_service.safe_filename(body.filename)
    duration_ms = round((time.monotonic() - t0) * 1000)
    logger.info(
        "[BrandingExport] pdf_ok user=%s profile_id=%s content_len=%s bytes=%s duration_ms=%s engine=playwright",
        x_user_id,
        body.profileId,
        len(body.html),
        len(pdf_bytes),
        duration_ms,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/profiles")
def list_profiles(x_user_id: str | None = Header(default=None)) -> dict[str, Any]:
    user_id = _require_user(x_user_id)
    _require_db()
    profiles = branding_service.list_profiles(user_id)
    return {"profiles": profiles}


# ── Get default ───────────────────────────────────────────────────────────────

@router.get("/profiles/default")
def get_default(x_user_id: str | None = Header(default=None)) -> dict[str, Any]:
    user_id = _require_user(x_user_id)
    _require_db()
    profile = branding_service.get_default_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="No default branding profile found")
    return profile


# ── Get single ────────────────────────────────────────────────────────────────

@router.get("/profiles/{profile_id}")
def get_profile(profile_id: str, x_user_id: str | None = Header(default=None)) -> dict[str, Any]:
    user_id = _require_user(x_user_id)
    _require_db()
    profile = branding_service.get_profile(user_id, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Branding profile not found")
    return profile


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/profiles", status_code=201)
def create_profile(
    payload: dict[str, Any],
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _require_user(x_user_id)
    _require_db()
    try:
        profile = branding_service.create_profile(user_id, payload)
    except Exception as exc:
        logger.exception("[branding] create_profile error user=%s: %s", user_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))
    return profile


# ── Update ────────────────────────────────────────────────────────────────────

@router.put("/profiles/{profile_id}")
def update_profile(
    profile_id: str,
    payload: dict[str, Any],
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _require_user(x_user_id)
    _require_db()
    try:
        profile = branding_service.update_profile(user_id, profile_id, payload)
    except Exception as exc:
        logger.exception("[branding] update_profile error user=%s id=%s: %s", user_id, profile_id, exc)
        raise HTTPException(status_code=500, detail=str(exc))
    if not profile:
        raise HTTPException(status_code=404, detail="Branding profile not found")
    return profile


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/profiles/{profile_id}", status_code=204)
def delete_profile(
    profile_id: str,
    x_user_id: str | None = Header(default=None),
) -> None:
    user_id = _require_user(x_user_id)
    _require_db()
    deleted = branding_service.delete_profile(user_id, profile_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Branding profile not found")


# ── Set default ─────────────────────────────────────────────────────────────

@router.post("/profiles/{profile_id}/set-default")
def set_default(
    profile_id: str,
    x_user_id: str | None = Header(default=None),
) -> dict[str, Any]:
    user_id = _require_user(x_user_id)
    _require_db()
    profile = branding_service.set_default_profile(user_id, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Branding profile not found")
    return profile
