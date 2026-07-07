"""Pydantic schemas for the Dynamic Document Drafting pipeline.

Two families of models live here:

1. Gemini structured-output schemas (`TemplateStructure`, `SectionSchema`,
   `PlaceholderSchema`) — passed as `response_schema` to the Template
   Structural Analyst call so the model returns a validated JSON layout.
2. API request/response models used by the drafting routes.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ──────────────────────────────────────────────────────────────────────────
# Structured-output schemas (Template Structural Analyst agent)
# ──────────────────────────────────────────────────────────────────────────

class TextFormatSchema(BaseModel):
    """Typography captured from the template so the draft reproduces it exactly.

    For PDF templates Gemini reads these visually; for text templates it infers
    from layout conventions (centered title lines, ALL-CAPS headings, etc.).
    """

    alignment: Literal["left", "center", "right", "justify"] = Field(
        default="left", description="Paragraph alignment exactly as in the template"
    )
    font_size_pt: int = Field(
        default=12, ge=6, le=48,
        description="Font size in points as seen in the template (12 if unknown)",
    )
    bold: bool = Field(default=False)
    underline: bool = Field(default=False)
    all_caps: bool = Field(default=False, description="Text is rendered in ALL CAPITALS")


class PlaceholderSchema(BaseModel):
    """A fillable slot detected in the template (e.g. ``[PARTY NAME]``, ``____``)."""

    key: str = Field(description="Stable snake_case identifier, e.g. 'party_1_name'")
    label: str = Field(description="Human-readable label, e.g. 'First Party Name'")
    description: str = Field(
        description="What information belongs here, inferred from surrounding text"
    )
    data_type: Literal[
        "text", "name", "date", "number", "currency", "address", "clause", "list"
    ] = Field(default="text", description="Expected kind of value")
    required: bool = Field(default=True)
    original_token: str = Field(
        default="",
        description="The exact placeholder text as it appears in the template, e.g. '[DATE]' or '__________'",
    )


class SectionSchema(BaseModel):
    """One logical section of the template — the unit of generation."""

    section_id: str = Field(description="Stable id, e.g. 'section_1'")
    index: int = Field(description="0-based position in document order")
    heading: str = Field(description="Section heading exactly as written in the template")
    heading_level: int = Field(
        default=1, description="1 = top-level heading, 2 = sub-heading, etc."
    )
    original_text: str = Field(
        description=(
            "The VERBATIM text of this section from the template, including all "
            "numbering, formatting cues and placeholder tokens. Never paraphrase."
        )
    )
    summary: str = Field(description="One-sentence description of the section's purpose")
    placeholders: list[PlaceholderSchema] = Field(default_factory=list)
    is_boilerplate: bool = Field(
        default=False,
        description="True when the section must be reproduced near-verbatim (standard clauses)",
    )
    estimated_output_tokens: int = Field(
        default=1024,
        description="Rough estimate of tokens needed to draft this section fully",
    )
    heading_format: TextFormatSchema = Field(
        default_factory=TextFormatSchema,
        description="Typography of the section heading as in the template",
    )
    body_format: TextFormatSchema = Field(
        default_factory=lambda: TextFormatSchema(alignment="justify"),
        description="Typography of the section body as in the template",
    )
    contains_table: bool = Field(
        default=False,
        description="True when this section contains tabular data (render as a GitHub markdown table)",
    )


class TemplateStructure(BaseModel):
    """Root structured-output schema returned by the Template Structural Analyst."""

    document_title: str = Field(description="Title of the template document")
    document_type: str = Field(
        description="Kind of document, e.g. 'Rental Agreement', 'Writ Petition', 'NDA'"
    )
    jurisdiction_or_domain: str = Field(
        default="", description="Legal jurisdiction or business domain if identifiable"
    )
    layout_notes: str = Field(
        default="",
        description="Global formatting conventions: numbering style, indentation, signature blocks",
    )
    base_font_family: str = Field(
        default="Times New Roman",
        description="Dominant font family of the template (court drafts: Times New Roman)",
    )
    base_font_size_pt: int = Field(
        default=12, ge=6, le=48,
        description="Dominant body font size in points",
    )
    title_format: TextFormatSchema = Field(
        default_factory=lambda: TextFormatSchema(alignment="center", font_size_pt=14, bold=True),
        description="Typography of the document title as in the template",
    )
    global_placeholders: list[PlaceholderSchema] = Field(
        default_factory=list,
        description="Placeholders that recur across the whole document (party names, dates)",
    )
    sections: list[SectionSchema] = Field(description="Ordered list of template sections")


class GroundingViolation(BaseModel):
    """One unsupported factual assertion found by the grounding auditor."""

    section_id: str = Field(description="section_id of the draft section containing the violation")
    quote: str = Field(description="The exact unsupported text from the draft (under 30 words)")
    problem: str = Field(
        description="Why it is unsupported: not in the fact inventory / contradicts it / template sample content"
    )


class GroundingAuditReport(BaseModel):
    """Structured output of the post-draft zero-hallucination audit."""

    violations: list[GroundingViolation] = Field(
        default_factory=list,
        description="Every specific factual assertion in the draft not supported by the fact inventory",
    )


# ──────────────────────────────────────────────────────────────────────────
# API models
# ──────────────────────────────────────────────────────────────────────────

class DraftGenerateRequest(BaseModel):
    """Body of POST /api/chat/draft/{session_id}/generate/stream."""

    llm_name: Optional[str] = Field(
        default=None,
        description="Frontend-selected model id, e.g. 'gemini-2.5-pro' or 'gemini-2.5-flash'",
    )
    # Optional subset regeneration — omit to generate every section.
    section_ids: Optional[list[str]] = None
    user_instructions: Optional[str] = Field(
        default=None, description="Free-form drafting guidance typed by the user"
    )
    # Long-form output: Gemini 2.5 models support up to 65,536 output tokens —
    # default to the full budget so large sections are never truncated.
    max_output_tokens_per_section: int = Field(default=65536, ge=256, le=65536)


class DraftSessionInfo(BaseModel):
    """Status payload returned by GET /api/chat/draft/{session_id}."""

    session_id: str
    status: str
    model: Optional[str] = None
    template_file: Optional[dict[str, Any]] = None
    template_structure: Optional[dict[str, Any]] = None
    supporting_docs: list[dict[str, Any]] = Field(default_factory=list)
    draft_sections: list[dict[str, Any]] = Field(default_factory=list)
    error: Optional[str] = None
