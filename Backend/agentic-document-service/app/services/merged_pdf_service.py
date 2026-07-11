"""
Build a production-quality .pdf from selected Q&A sections.

Mirrors merged_docx_service: the answers are GitHub-Flavored Markdown, and
this module renders the same pragmatic GFM subset via reportlab Platypus —
headings (#–######), paragraphs, bullet/numbered lists, pipe tables,
fenced code blocks, and inline **bold** / *italic* / `code`.
"""
from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.services.merged_docx_service import _clean_answer_markdown

_INLINE_TOKEN_RE = re.compile(
    r"(\*\*[^*\n]+\*\*"      # **bold**
    r"|\*[^*\n]+\*"          # *italic*
    r"|`[^`\n]+`)"           # `code`
)
_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_RE = re.compile(r"^\s*[-*+]\s+(.*)$")
_NUMBERED_RE = re.compile(r"^\s*\d+[.)]\s+(.*)$")
_HR_RE = re.compile(r"^\s*([-*_]\s*){3,}$")

_BASE = getSampleStyleSheet()
_STYLES = {
    "title": ParagraphStyle(
        "MergedTitle", parent=_BASE["Title"], fontSize=20, leading=24,
        alignment=TA_CENTER, spaceAfter=2,
    ),
    "meta": ParagraphStyle(
        "MergedMeta", parent=_BASE["Normal"], fontSize=8, leading=10,
        alignment=TA_CENTER, textColor=colors.HexColor("#6B7280"), spaceAfter=14,
    ),
    "body": ParagraphStyle(
        "MergedBody", parent=_BASE["Normal"], fontSize=11, leading=15.5, spaceAfter=7,
        alignment=TA_JUSTIFY,
    ),
    "origin": ParagraphStyle(
        "MergedOrigin", parent=_BASE["Normal"], fontSize=8.5, leading=10,
        textColor=colors.HexColor("#9CA3AF"), spaceAfter=6,
    ),
    "source": ParagraphStyle(
        "MergedSource", parent=_BASE["Normal"], fontSize=8.5, leading=10,
        textColor=colors.HexColor("#6B7280"), spaceBefore=4, spaceAfter=10,
    ),
    "code": ParagraphStyle(
        "MergedCode", parent=_BASE["Code"], fontSize=9, leading=11.5,
        backColor=colors.HexColor("#F3F4F6"), borderPadding=4, spaceAfter=8,
    ),
    "cell": ParagraphStyle(
        "MergedCell", parent=_BASE["Normal"], fontSize=9.5, leading=12.5,
    ),
}
# Section heading (## 1. Question) and nested answer headings h2..h6.
for level in range(1, 7):
    _STYLES[f"h{level}"] = ParagraphStyle(
        f"MergedH{level}", parent=_BASE["Normal"],
        fontName="Helvetica-Bold",
        fontSize=max(10.5, 17 - 1.5 * (level - 1)),
        leading=max(13, 20.5 - 1.5 * (level - 1)),
        spaceBefore=10 if level <= 2 else 8,
        spaceAfter=4,
        textColor=colors.HexColor("#111827"),
    )


def _inline_markup(text: str) -> str:
    """Convert inline **bold** / *italic* / `code` to reportlab XML markup."""
    parts: list[str] = []
    for token in _INLINE_TOKEN_RE.split(text):
        if not token:
            continue
        if token.startswith("**") and token.endswith("**") and len(token) > 4:
            parts.append(f"<b>{escape(token[2:-2])}</b>")
        elif token.startswith("*") and token.endswith("*") and len(token) > 2:
            parts.append(f"<i>{escape(token[1:-1])}</i>")
        elif token.startswith("`") and token.endswith("`") and len(token) > 2:
            parts.append(f'<font face="Courier" size="9.5">{escape(token[1:-1])}</font>')
        else:
            parts.append(escape(token))
    return "".join(parts)


def _split_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _markdown_table_flowable(rows: list[str], avail_width: float) -> Table:
    header = _split_table_row(rows[0])
    body_lines = [r for r in rows[1:] if not _TABLE_SEPARATOR_RE.match(r)]
    n_cols = max(len(header), *(len(_split_table_row(r)) for r in body_lines)) if body_lines else len(header)

    def _row(cells: list[str], bold: bool) -> list[Paragraph]:
        padded = cells[:n_cols] + [""] * (n_cols - len(cells))
        return [
            Paragraph(f"<b>{_inline_markup(c)}</b>" if bold else _inline_markup(c), _STYLES["cell"])
            for c in padded
        ]

    data = [_row(header, bold=True)] + [_row(_split_table_row(r), bold=False) for r in body_lines]
    table = Table(data, colWidths=[avail_width / n_cols] * n_cols, repeatRows=1)
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D1D5DB")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3F4F6")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return table


def _render_markdown(story: list, markdown: str, avail_width: float, *, heading_offset: int = 1) -> None:
    """Render the GFM subset into Platypus flowables (same contract as the docx renderer)."""
    lines = markdown.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]

        if not line.strip():
            i += 1
            continue

        # Fenced code block
        if line.lstrip().startswith("```"):
            code_lines: list[str] = []
            i += 1
            while i < len(lines) and not lines[i].lstrip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing fence
            story.append(Preformatted("\n".join(code_lines), _STYLES["code"]))
            continue

        # Table block
        if _TABLE_ROW_RE.match(line) and i + 1 < len(lines) and _TABLE_SEPARATOR_RE.match(lines[i + 1]):
            table_rows = []
            while i < len(lines) and _TABLE_ROW_RE.match(lines[i]):
                table_rows.append(lines[i])
                i += 1
            story.append(_markdown_table_flowable(table_rows, avail_width))
            story.append(Spacer(1, 6))
            continue

        heading = _HEADING_RE.match(line)
        if heading:
            level = min(6, len(heading.group(1)) + heading_offset)
            text = heading.group(2).strip().strip("*").strip()
            story.append(Paragraph(_inline_markup(text), _STYLES[f"h{level}"]))
            i += 1
            continue

        if _HR_RE.match(line):
            i += 1
            continue

        # Consecutive bullet / numbered items become one list flowable.
        if _BULLET_RE.match(line) or _NUMBERED_RE.match(line):
            numbered = bool(_NUMBERED_RE.match(line))
            pattern = _NUMBERED_RE if numbered else _BULLET_RE
            items = []
            while i < len(lines) and pattern.match(lines[i]):
                items.append(ListItem(
                    Paragraph(_inline_markup(pattern.match(lines[i]).group(1)), _STYLES["body"]),
                ))
                i += 1
            story.append(ListFlowable(
                items,
                bulletType="1" if numbered else "bullet",
                bulletFontSize=9,
                leftIndent=15,
            ))
            continue

        # Plain paragraph — join soft-wrapped lines until a structural break.
        para_lines = [line.strip()]
        i += 1
        while (
            i < len(lines)
            and lines[i].strip()
            and not _HEADING_RE.match(lines[i])
            and not _BULLET_RE.match(lines[i])
            and not _NUMBERED_RE.match(lines[i])
            and not _TABLE_ROW_RE.match(lines[i])
            and not lines[i].lstrip().startswith("```")
        ):
            para_lines.append(lines[i].strip())
            i += 1
        story.append(Paragraph(_inline_markup(" ".join(para_lines)), _STYLES["body"]))


def build_merged_pdf(
    title: str,
    sections: list[dict[str, Any]],
    *,
    include_questions: bool = True,
) -> bytes:
    """
    Assemble the selected Q&A sections into a single .pdf.

    Each section dict: {question, answer, source?, origin_label?}.
    include_questions=False omits the numbered question headings so the
    document reads as a continuous set of answers.
    """
    buffer = io.BytesIO()
    doc_title = (title or "").strip() or "Merged Legal Analysis"
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=doc_title,
    )
    avail_width = doc.width

    story: list = [
        Paragraph(escape(doc_title), _STYLES["title"]),
        Paragraph(
            escape(
                f"Generated on {datetime.now(timezone.utc).strftime('%d %B %Y')}"
                + (f" · {len(sections)} section(s)" if len(sections) > 1 else "")
            ),
            _STYLES["meta"],
        ),
    ]

    for index, section in enumerate(sections, start=1):
        if include_questions:
            question = str(section.get("question") or "").strip() or f"Question {index}"
            story.append(Paragraph(f"{index}. {_inline_markup(question)}", _STYLES["h1"]))
        elif index > 1:
            story.append(Spacer(1, 14))  # breathing room between unlabelled answers

        origin_label = str(section.get("origin_label") or "").strip()
        if origin_label:
            story.append(Paragraph(f"<i>{escape(origin_label)}</i>", _STYLES["origin"]))

        answer = _clean_answer_markdown(str(section.get("answer") or ""))
        if answer:
            _render_markdown(story, answer, avail_width, heading_offset=1)
        else:
            story.append(Paragraph("(No answer content)", _STYLES["body"]))

        source = str(section.get("source") or "").strip()
        if source:
            story.append(Paragraph(f"<i>Source: {escape(source)}</i>", _STYLES["source"]))

    doc.build(story)
    return buffer.getvalue()
