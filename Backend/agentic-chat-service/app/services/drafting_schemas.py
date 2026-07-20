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
    heading_verbatim: bool = Field(
        default=True,
        description=(
            "True ONLY if `heading` appears character-for-character in the template. "
            "False when the heading is a derived/descriptive label for an unlabeled block "
            "(cause title, preamble, signature block) — derived labels are used for UI "
            "navigation only and must NEVER be printed into the drafted document."
        ),
    )
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


class InterimReliefConsistency(BaseModel):
    """Named, required check — freeform scanning proved unreliable for this."""

    necessity_paragraph_stance: Literal["sought", "not_sought", "absent"] = Field(
        default="absent",
        description="What the draft's necessity/urgency paragraph says about interim relief",
    )
    interim_argument_present: bool = Field(
        default=False,
        description="True if any paragraph ARGUES for interim relief (injunction, attachment, receiver)",
    )
    prayer_interim_clause_present: bool = Field(
        default=False,
        description="True if the Prayer contains an interim-relief clause",
    )
    contradiction: bool = Field(
        default=False,
        description="True when stance / argument paragraphs / prayer disagree with each other",
    )
    argument_section_id: str = Field(
        default="", description="section_id containing the interim-relief argument paragraphs"
    )
    argument_quote: str = Field(
        default="",
        description="EXACT first sentence of the offending interim-relief argument paragraph",
    )


class GroundingAuditReport(BaseModel):
    """Structured output of the post-draft zero-hallucination audit."""

    violations: list[GroundingViolation] = Field(
        default_factory=list,
        description="Every specific factual assertion in the draft not supported by the fact inventory",
    )
    interim_relief: InterimReliefConsistency = Field(
        default_factory=InterimReliefConsistency,
        description="ALWAYS filled: the interim-relief coherence check (TASK 3a)",
    )


class ExtractedFactField(BaseModel):
    """One target-schema field extracted with a mandatory verbatim citation.

    Stage 2 of the 4-stage zero-hallucination pipeline: controlled generation
    (``response_schema``) makes the citation field impossible to skip; Python
    then verifies ``source_snippet`` is an actual substring of the cited
    document before the value may reach the drafter.
    """

    field_name: str = Field(description="Target-schema key this entry answers, e.g. 'party_1_name'")
    value: str = Field(
        default="",
        description="The value EXACTLY as written in the source; empty when found=false",
    )
    source_document: str = Field(
        default="",
        description="Exact file name from the '===== SUPPORTING DOCUMENT: <name> =====' marker",
    )
    source_snippet: str = Field(
        default="",
        description="VERBATIM substring of the source document that supports the value (<=200 chars)",
    )
    confidence: Literal["high", "medium", "low"] = Field(default="low")
    found: bool = Field(
        default=False,
        description="True ONLY when the value is explicitly present in a source document",
    )
    conflict: bool = Field(
        default=False,
        description="True when two source documents state different values for this field",
    )
    conflicting_value: str = Field(
        default="", description="The second value when conflict=true (exactly as written)"
    )
    conflicting_source: str = Field(
        default="", description="File that states the conflicting value"
    )


class GroundedExtractionResult(BaseModel):
    """Structured output of the Stage-2 grounded extraction call (one per batch)."""

    fields: list[ExtractedFactField] = Field(default_factory=list)


class DiscrepancyItem(BaseModel):
    """One draft statement checked by the Stage-4 adversarial verification pass."""

    draft_quote: str = Field(description="The exact draft sentence/clause (<=40 words)")
    verdict: Literal["NO_SOURCE_SUPPORT_FOUND", "SUPPORTED_ON_REVIEW"] = Field(
        description="NO_SOURCE_SUPPORT_FOUND when nothing in the source supports the quote"
    )
    supporting_passage: str = Field(
        default="",
        description="Verbatim source passage (<=200 chars) when verdict=SUPPORTED_ON_REVIEW",
    )
    source_document: str = Field(
        default="", description="File containing the supporting passage, when located"
    )
    note: str = Field(default="", description="What exactly is unsupported / where support was found")


class DiscrepancyReport(BaseModel):
    """Structured output of the Stage-4 verification pass (report-only, never a fix)."""

    items: list[DiscrepancyItem] = Field(default_factory=list)


class SectionEvents(BaseModel):
    """Events from the chronological factual matrix owned by one section."""

    section_id: str = Field(description="section_id that will narrate these events")
    event_numbers: list[int] = Field(
        default_factory=list,
        description="S.No values from the factual matrix this section narrates",
    )


class EventOwnershipPlan(BaseModel):
    """Each matrix event assigned to exactly ONE section (no repetition)."""

    assignments: list[SectionEvents] = Field(default_factory=list)


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
    confirmed_facts: Optional[str] = Field(
        default=None,
        description=(
            "User-confirmed facts/decisions (e.g. 'defendant's business = not stated, "
            "do not infer'). Persisted on the session and injected into every future "
            "generation as a FACT INVENTORY ADDENDUM with the same authority as the "
            "digest — unlike user_instructions, these can never be overridden."
        ),
    )
    # Long-form output: Gemini 2.5 models support up to 65,536 output tokens —
    # default to the full budget so large sections are never truncated.
    max_output_tokens_per_section: int = Field(default=65536, ge=256, le=65536)
    drafting_strategy: Literal["monolithic", "sectionwise"] = Field(
        default="sectionwise",
        description=(
            "Stage-2 drafting mode: 'sectionwise' (one call per template section — "
            "current default) or 'monolithic' (single one-shot draft, faster for "
            "shorter documents)."
        ),
    )


class DraftSessionInfo(BaseModel):
    """Status payload returned by GET /api/chat/draft/{session_id}."""

    session_id: str
    status: str
    model: Optional[str] = None
    template_file: Optional[dict[str, Any]] = None
    template_structure: Optional[dict[str, Any]] = None
    supporting_docs: list[dict[str, Any]] = Field(default_factory=list)
    draft_sections: list[dict[str, Any]] = Field(default_factory=list)
    draft_metadata: Optional[dict[str, Any]] = None
    error: Optional[str] = None
