"""Demo booking REST endpoints."""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException

from app.schemas.models import BookDemoRequest
from app.services.demo_service import get_available_slots, book_demo

router = APIRouter(prefix="/api", tags=["demo"])
logger = logging.getLogger("ai_chatbot.demo_route")


@router.get("/demo-slots", summary="List available demo time slots")
async def list_demo_slots() -> list[dict]:
    loop = asyncio.get_running_loop()
    slots = await loop.run_in_executor(None, get_available_slots)
    logger.info("GET /api/demo-slots returned=%d", len(slots))
    return slots


@router.post("/book-demo", summary="Book a product demo")
async def book_demo_endpoint(body: BookDemoRequest) -> dict:
    logger.info("POST /api/book-demo name=%r email=%r slot_id=%s", body.name, body.email, body.slot_id)
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None,
        lambda: book_demo(
            name=body.name,
            email=body.email,
            slot_id=body.slot_id,
            company=body.company or "",
            phone=body.phone or "",
        ),
    )
    logger.info("POST /api/book-demo result=%r", result)
    if not result.get("success") and result.get("error", "").startswith("name, email"):
        raise HTTPException(status_code=422, detail=result["error"])
    return result
