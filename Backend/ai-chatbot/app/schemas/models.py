from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    session_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Demo Booking
# ---------------------------------------------------------------------------

class SaveLeadRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=150)
    phone: Optional[str] = Field(None, max_length=20)


class BookDemoRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=150)
    phone: Optional[str] = Field(None, max_length=20)
    slot_id: int = Field(..., gt=0)
    company: Optional[str] = Field(None, max_length=150)


# ---------------------------------------------------------------------------
# Admin config
# ---------------------------------------------------------------------------

class ConfigUpdateRequest(BaseModel):
    model_text: Optional[str] = None
    model_audio: Optional[str] = None
    max_tokens: Optional[int] = Field(None, ge=1, le=8192)
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    top_p: Optional[float] = Field(None, ge=0.0, le=1.0)
    top_k_results: Optional[int] = Field(None, ge=1, le=20)
    voice_name: Optional[str] = None
    language_code: Optional[str] = None
    speaking_rate: Optional[float] = Field(None, ge=0.25, le=4.0)
    pitch: Optional[float] = Field(None, ge=-20.0, le=20.0)
    volume_gain_db: Optional[float] = Field(None, ge=-96.0, le=16.0)
    system_prompt: Optional[str] = Field(None, max_length=4000)
    audio_system_prompt: Optional[str] = Field(None, max_length=4000)


class ConfigResponse(BaseModel):
    config_key: str
    model_text: str
    model_audio: str
    max_tokens: int
    temperature: float
    top_p: float
    top_k_results: int
    voice_name: str
    language_code: str
    speaking_rate: float
    pitch: float
    volume_gain_db: float
    system_prompt: str
    audio_system_prompt: str
