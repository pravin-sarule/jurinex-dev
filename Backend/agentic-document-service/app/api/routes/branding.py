from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.services import branding_service
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
    profileId: str
    contentHtml: str = ""
    filename: str | None = Field(default="export.pdf", max_length=255)


# ── Export PDF (production: Playwright / Puppeteer) ───────────────────────────


@router.post("/export-pdf")
def export_branded_pdf(
    body: ExportPdfRequest,
    x_user_id: str | None = Header(default=None),
) -> None:
    """
    Planned production path: fetch profile, merge defaults, render HTML, PDF via headless browser.
    Returns 501 until Playwright/Puppeteer is wired; frontend falls back to html2pdf.js.
    """
    user_id = _require_user(x_user_id)
    _require_db()
    t0 = time.monotonic()
    profile = branding_service.get_profile(user_id, body.profileId)
    if not profile:
        raise HTTPException(status_code=404, detail="Branding profile not found")
    content_len = len(body.contentHtml or "")
    has_logo = bool(profile.get("logo"))
    wm_on = bool(profile.get("watermark"))
    wm_txt = bool(profile.get("watermarkText"))
    logger.info(
        "[BrandingExport] pdf_request user=%s profile_id=%s content_len=%s has_logo=%s watermark_enabled=%s watermark_text=%s engine=unconfigured",
        user_id,
        body.profileId,
        content_len,
        has_logo,
        wm_on,
        wm_txt,
    )
    duration_ms = round((time.monotonic() - t0) * 1000)
    logger.info("[BrandingExport] pdf_reject status=501 duration_ms=%s", duration_ms)
    raise HTTPException(
        status_code=501,
        detail="Server-side PDF export is not enabled. Install Playwright/Puppeteer and implement HTML→PDF rendering.",
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


# ── Set default ───────────────────────────────────────────────────────────────

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
