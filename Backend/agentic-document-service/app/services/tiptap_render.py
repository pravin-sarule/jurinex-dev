"""Deterministic TipTap JSON rendering for draft-from-template.

The drafting model still emits section markdown because the pipeline is tuned around
that contract, but the editor should not have to turn the final merged markdown back
into structure with regex guesses. This module converts each finished section into a
TipTap/ProseMirror JSON shape using the measured template typography captured in
Stage A.
"""
from __future__ import annotations

import html
import re
from dataclasses import asdict, is_dataclass
from typing import Any

TipTapNode = dict[str, Any]


_VALID_ALIGN = {"left", "center", "right", "justify"}
_HR_RE = re.compile(r"^\s*([-*_])(?:\s*\1){2,}\s*$")
_MD_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$")
_BULLET_RE = re.compile(r"^\s*[-*+]\s+(.+)$")
_RED_SPAN_RE = re.compile(
    r"<span\b(?=[^>]*(?:color\s*:\s*red|data-field-pill))[^>]*>(?P<body>.*?)</span>",
    re.IGNORECASE | re.DOTALL,
)
_RED_SLOT_RE = re.compile(
    r"\[\s*_{2,}\s*([^\]\n]*?)\s*_*\s*\]|\[\s*([^\]\n]*?)\s*_{2,}\s*\]"
)
# Either placeholder form, in document order: the canonical red <span>, or the bare
# "[________ LABEL ________]" the drafting prompt emits. Both become a fieldPill.
_FIELD_ANY_RE = re.compile(
    r"<span\b(?=[^>]*(?:color\s*:\s*red|data-field-pill))[^>]*>(?P<span_body>.*?)</span>"
    r"|\[\s*_{2,}\s*(?P<slot_a>[^\]\n]*?)\s*_*\s*\]"
    r"|\[\s*(?P<slot_b>[^\]\n]*?)\s*_{2,}\s*\]",
    re.IGNORECASE | re.DOTALL,
)
_HTML_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_TABLE_SEP_CELL_RE = re.compile(r"^:?-{2,}:?$")


def render_section_tiptap(section: Any, markdown: str) -> dict[str, Any]:
    """Return section metadata plus TipTap JSON for a single drafted section.

    ``doc`` and ``content`` contain only nodes supported by the current editor
    extensions. ``legal_section`` is included for the upcoming frontend path that
    wraps generated sections and updates them in place with ``insertContentAt``.
    """
    index = int(getattr(section, "index", 0) or 0)
    heading = str(getattr(section, "heading", "") or f"Section {index + 1}").strip()
    section_id = _section_id(index, heading)
    content = markdown_to_tiptap_content(markdown, section=section)
    legal_section = {
        "type": "legalSection",
        "attrs": {
            "sectionId": section_id,
            "sectionOrder": index,
            "heading": heading,
            "status": "generated",
            "userModified": False,
        },
        "content": content,
    }
    return {
        "section_id": section_id,
        "section_order": index,
        "heading": heading,
        "status": "generated",
        "user_modified": False,
        "content": content,
        "doc": {"type": "doc", "content": content},
        "legal_section": legal_section,
        "source_traceability": {
            "template_section_index": index,
            "template_heading": heading,
        },
    }


def render_document_tiptap(sections: list[Any], markdown_by_index: list[str]) -> dict[str, Any]:
    """Render the complete draft as TipTap JSON plus per-section records."""
    rendered: list[dict[str, Any]] = []
    for idx, section in enumerate(sections):
        md = markdown_by_index[idx] if idx < len(markdown_by_index) else ""
        if not (md or "").strip():
            continue
        rendered.append(render_section_tiptap(section, md))

    content: list[TipTapNode] = []
    for item in rendered:
        content.extend(item.get("content") or [])

    return {
        "doc": {"type": "doc", "content": content or [_paragraph("")]},
        "sections": rendered,
        "legal_section_doc": {
            "type": "doc",
            "content": [item["legal_section"] for item in rendered],
        },
    }


def markdown_to_tiptap_content(markdown: str, *, section: Any | None = None) -> list[TipTapNode]:
    """Convert a section's markdown-ish draft into TipTap node content.

    This is deliberately conservative: legal paragraph numbers remain literal text
    in paragraphs so TipTap never renumbers clauses. Markdown tables become TipTap
    table nodes. Red placeholder spans become the existing ``fieldPill`` atom.
    """
    lines = (markdown or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    nodes: list[TipTapNode] = []
    i = 0
    first_text_block = True

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        if not line.strip():
            i += 1
            continue

        if _is_table_start(lines, i):
            table, next_i = _consume_table(lines, i, section=section)
            nodes.append(table)
            i = next_i
            first_text_block = False
            continue

        if _HR_RE.match(line):
            nodes.append({"type": "horizontalRule"})
            i += 1
            first_text_block = False
            continue

        bullet_lines: list[str] = []
        j = i
        while j < len(lines):
            m = _BULLET_RE.match(lines[j])
            if not m:
                break
            bullet_lines.append(m.group(1).strip())
            j += 1
        if bullet_lines:
            nodes.append(_bullet_list(bullet_lines, section=section))
            i = j
            first_text_block = False
            continue

        node = _line_node(line.strip(), section=section, first_text_block=first_text_block)
        nodes.append(node)
        first_text_block = False
        i += 1

    return nodes or [_paragraph("", attrs=_text_attrs("justify"))]


def _line_node(line: str, *, section: Any | None, first_text_block: bool) -> TipTapNode:
    plain = _plain_text(line)
    typo = _typography_for_line(section, plain)
    m = _MD_HEADING_RE.match(line)
    if m:
        heading_text = m.group(2).strip()
        heading_typo = _typography_for_line(section, _plain_text(heading_text))
        if heading_typo.get("_matched_line") and heading_typo.get("layout_source") == "template" and int(heading_typo.get("level") or 0) <= 0:
            matched_layout = bool(heading_typo.get("_matched_part") or heading_typo.get("_matched_line"))
            marks = [{"type": "bold"}] if matched_layout and heading_typo.get("bold") else None
            return _paragraph(heading_text, attrs=_text_attrs(_align(heading_typo.get("alignment"))), force_marks=marks)
        return _heading(
            heading_text,
            level=len(m.group(1)),
            section=section,
            align=_heading_align(heading_typo, first_text_block=first_text_block),
        )

    if _looks_like_heading(line, plain, section=section, first_text_block=first_text_block):
        level = _heading_level(typo)
        return _heading(
            _strip_wrapping_bold(line),
            level=level,
            section=section,
            align=_heading_align(typo, first_text_block=first_text_block),
        )

    # Do not let a packed section's title typography leak into every body line.
    # The first measured part can be center/bold (e.g. RENT AGREEMENT), while the
    # same drafting unit may also contain normal operative clauses. Inline markdown
    # still supplies explicit bold/italic marks.
    #
    # When a drafted line matches no measured template line (drafting rewrote it — the values
    # got filled in), fall back to the SECTION's own measured alignment rather than a hardcoded
    # "justify". Hardcoding justify silently flattened right-aligned role labels ("…Plaintiff",
    # "…Defendant") and left-aligned blocks into justified body prose. `center` is still never
    # inherited — that is the title leak this guard exists to prevent.
    matched_layout = bool(typo.get("_matched_part") or typo.get("_matched_line"))
    sec_align = _section_alignment(section)
    fallback_align = sec_align if sec_align in ("right", "left", "justify") else "justify"
    para_align = _align(typo.get("alignment")) if matched_layout else fallback_align
    marks = [{"type": "bold"}] if matched_layout and typo.get("bold") and plain and len(plain) <= 160 else None
    return _paragraph(line, attrs=_text_attrs(para_align), force_marks=marks)


def _heading(text: str, *, level: int, section: Any | None, align: str | None = None) -> TipTapNode:
    attrs = {"level": max(1, min(int(level or 1), 6)), "textAlign": align or _section_alignment(section)}
    content = _inline_nodes(_strip_wrapping_bold(text))
    node: TipTapNode = {"type": "heading", "attrs": attrs}
    if content:
        node["content"] = content
    return node


def _paragraph(
    text: str,
    *,
    attrs: dict[str, Any] | None = None,
    force_marks: list[dict[str, Any]] | None = None,
) -> TipTapNode:
    content = _inline_nodes(text, force_marks=force_marks)
    node: TipTapNode = {"type": "paragraph", "attrs": attrs or {"textAlign": "justify"}}
    if content:
        node["content"] = content
    return node


def _bullet_list(items: list[str], *, section: Any | None) -> TipTapNode:
    attrs = _text_attrs("justify")
    return {
        "type": "bulletList",
        "content": [
            {"type": "listItem", "content": [_paragraph(item, attrs=attrs)]}
            for item in items
        ],
    }


def _consume_table(lines: list[str], start: int, *, section: Any | None) -> tuple[TipTapNode, int]:
    header = _split_table_row(lines[start])
    separators = _split_table_row(lines[start + 1])
    aligns = [_table_align(cell) for cell in separators]
    rows: list[list[str]] = [header]
    i = start + 2
    while i < len(lines) and _is_table_row(lines[i]) and not _is_table_separator(lines[i]):
        rows.append(_split_table_row(lines[i]))
        i += 1

    width = max([len(r) for r in rows] + [len(header), 1])
    table_rows: list[TipTapNode] = []
    for r_idx, row in enumerate(rows):
        cells: list[TipTapNode] = []
        for c_idx in range(width):
            cell_text = row[c_idx].strip() if c_idx < len(row) else ""
            align = aligns[c_idx] if c_idx < len(aligns) and aligns[c_idx] else "left"
            cells.append(_table_cell(cell_text, header=(r_idx == 0), align=align))
        table_rows.append({"type": "tableRow", "content": cells})
    return {"type": "table", "content": table_rows}, i


def _table_cell(text: str, *, header: bool, align: str) -> TipTapNode:
    return {
        "type": "tableHeader" if header else "tableCell",
        "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None},
        "content": [_paragraph(text, attrs=_text_attrs(align))],
    }


def _inline_nodes(text: str, *, force_marks: list[dict[str, Any]] | None = None) -> list[TipTapNode]:
    text = _HTML_BR_RE.sub("\n", text or "")
    nodes: list[TipTapNode] = []
    pos = 0
    # Placeholders are carved out BEFORE any markdown parsing. Both forms count: the canonical
    # red <span>, and the bare "[________ LABEL ________]" the drafting prompt emits. Scanning
    # only the span form left the bare form to fall through to the inline markdown parser,
    # where its "________" run matched the __bold__ rule — so every unfilled slot rendered as
    # literal bold underscores inside brackets instead of a clickable fieldPill.
    for match in _FIELD_ANY_RE.finditer(text):
        if match.start() > pos:
            nodes.extend(_inline_markdown_nodes(text[pos:match.start()], force_marks=force_marks))
        nodes.append({"type": "fieldPill", "attrs": {"label": _any_field_label(match) or "FIELD"}})
        pos = match.end()
    if pos < len(text):
        nodes.extend(_inline_markdown_nodes(text[pos:], force_marks=force_marks))
    return _compact_text_nodes(nodes)


def _any_field_label(match: re.Match[str]) -> str:
    """Label for either placeholder form matched by _FIELD_ANY_RE."""
    body = match.group("span_body")
    if body is not None:
        return _field_label(body)
    raw = match.group("slot_a") or match.group("slot_b") or ""
    return re.sub(r"\s+", " ", raw.replace("_", " ")).strip().upper()


def _inline_markdown_nodes(
    text: str,
    *,
    marks: list[dict[str, Any]] | None = None,
    force_marks: list[dict[str, Any]] | None = None,
) -> list[TipTapNode]:
    marks = list(marks or [])
    if force_marks:
        marks = _merge_marks(marks, force_marks)
    if not text:
        return []

    # Every pattern exposes the emphasised text as the SAME named group, `body`. This used to
    # be positional — `match.group(1) if mark_type == "code" else match.group(2)` — but only
    # the bold pattern actually has a group 2 (its opening fence is group 1). Both italic
    # patterns have a single group, so the first italic run in any draft raised
    # "IndexError: no such group" and killed the whole pipeline mid-section.
    patterns = [
        ("code", re.compile(r"`(?P<body>[^`]+)`", re.DOTALL)),
        ("bold", re.compile(r"(?P<fence>\*\*|__)(?=\S)(?P<body>.+?)(?<=\S)(?P=fence)", re.DOTALL)),
        ("italic", re.compile(r"(?<!\*)\*(?=\S)(?P<body>.+?)(?<=\S)\*(?!\*)", re.DOTALL)),
        ("italic", re.compile(r"(?<!\w)_(?=\S)(?P<body>.+?)(?<=\S)_(?!\w)", re.DOTALL)),
    ]

    best: tuple[str, re.Match[str]] | None = None
    for mark_type, pattern in patterns:
        m = pattern.search(text)
        if not m:
            continue
        if best is None or m.start() < best[1].start():
            best = (mark_type, m)
    if best is None:
        clean = html.unescape(_HTML_TAG_RE.sub("", text))
        if not clean:
            return []
        node: TipTapNode = {"type": "text", "text": clean}
        if marks:
            node["marks"] = marks
        return [node]

    mark_type, match = best
    before = text[:match.start()]
    body = match.group("body")
    after = text[match.end():]
    marked = _merge_marks(marks, [{"type": mark_type}])
    return (
        _inline_markdown_nodes(before, marks=marks)
        + _inline_markdown_nodes(body, marks=marked)
        + _inline_markdown_nodes(after, marks=marks)
    )


def _compact_text_nodes(nodes: list[TipTapNode]) -> list[TipTapNode]:
    compact: list[TipTapNode] = []
    for node in nodes:
        if not node:
            continue
        if (
            compact
            and node.get("type") == "text"
            and compact[-1].get("type") == "text"
            and compact[-1].get("marks") == node.get("marks")
        ):
            compact[-1]["text"] = str(compact[-1].get("text") or "") + str(node.get("text") or "")
        else:
            compact.append(node)
    return compact


def _merge_marks(a: list[dict[str, Any]], b: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for mark in [*a, *b]:
        typ = str(mark.get("type") or "")
        if typ and typ not in seen:
            seen.add(typ)
            out.append(mark)
    return out


def _is_table_start(lines: list[str], i: int) -> bool:
    return i + 1 < len(lines) and _is_table_row(lines[i]) and _is_table_separator(lines[i + 1])


def _is_table_row(line: str) -> bool:
    stripped = (line or "").strip()
    return stripped.count("|") >= 2


def _is_table_separator(line: str) -> bool:
    cells = _split_table_row(line)
    return bool(cells) and all(_TABLE_SEP_CELL_RE.match(cell.strip()) for cell in cells if cell.strip())


def _split_table_row(line: str) -> list[str]:
    stripped = (line or "").strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    cells: list[str] = []
    cur: list[str] = []
    escaped = False
    for ch in stripped:
        if escaped:
            cur.append(ch)
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == "|":
            cells.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    cells.append("".join(cur).strip())
    return cells


def _table_align(separator_cell: str) -> str:
    cell = separator_cell.strip()
    if cell.startswith(":") and cell.endswith(":"):
        return "center"
    if cell.endswith(":"):
        return "right"
    return "left"


def _heading_align(typo: dict[str, Any], *, first_text_block: bool) -> str:
    if first_text_block or typo.get("_matched_part") or typo.get("_matched_line"):
        return _align(typo.get("alignment"))
    return "left"


def _looks_like_heading(line: str, plain: str, *, section: Any | None, first_text_block: bool) -> bool:
    if not plain:
        return False
    typo = _typography_for_line(section, plain)
    if typo.get("layout_source") == "template" or typo.get("_matched_line"):
        return int(typo.get("level") or 0) > 0 and len(plain) <= 140
    if int(typo.get("level") or 0) > 0 and first_text_block and len(plain) <= 120:
        return True
    if _is_wrapped_bold(line) and int(typo.get("level") or 0) > 0 and len(plain) <= 120:
        return True
    letters = [c for c in plain if c.isalpha()]
    mostly_caps = bool(letters) and (sum(1 for c in letters if c.isupper()) / len(letters)) >= 0.82
    return mostly_caps and first_text_block and len(plain) <= 90 and not re.match(r"^\d{1,3}[.)]\s+", plain)


def _line_signature(text: str) -> str:
    plain = _norm(_plain_text(text)).strip(" :")
    if not plain:
        return ""
    m = re.match(r"^(?P<num>\d{1,3}[.)])\s*(?P<label>[A-Z][A-Z0-9 /&().,'-]{2,90}?)(?::|\s{2,}|$)", plain)
    if m:
        return _norm(f"{m.group('num')} {m.group('label')}").lower().strip(" :")
    m = re.match(r"^(?P<label>[A-Z][A-Z0-9 /&().,'-]{2,90})(?::)?$", plain)
    if m and len(plain) <= 120:
        return _norm(m.group("label")).lower().strip(" :")
    words = re.sub(r"[^A-Za-z0-9]+", " ", plain).lower().split()
    return " ".join(words[:10])


def _matches_layout_entry(line_key: str, line_sig: str, entry: dict[str, Any]) -> bool:
    text = _norm(str(entry.get("text") or "")).lower()
    sig = _norm(str(entry.get("signature") or "")).lower()
    if text and line_key == text:
        return True
    if sig and line_sig and line_sig == sig:
        return True
    return bool(text and len(text) >= 24 and len(line_key) >= 24 and (line_key.startswith(text[:24]) or text.startswith(line_key[:24])))


def _typography_for_line(section: Any | None, plain_line: str) -> dict[str, Any]:
    typo = _section_typography(section)
    line_key = _norm(plain_line).lower()
    line_sig = _line_signature(plain_line)
    for entry in typo.get("lines") or []:
        if not isinstance(entry, dict):
            continue
        if _matches_layout_entry(line_key, line_sig, entry):
            merged = dict(typo)
            merged.update({k: v for k, v in entry.items() if k in {"alignment", "bold", "level", "size_pt"}})
            merged["_matched_line"] = True
            return merged
    for part in typo.get("parts") or []:
        if not isinstance(part, dict):
            continue
        heading = _norm(str(part.get("heading") or "")).lower()
        if heading and (line_key.startswith(heading) or heading in line_key[:140]):
            merged = dict(typo)
            merged.update({k: v for k, v in part.items() if k in {"alignment", "bold", "level"}})
            merged["_matched_part"] = True
            return merged
    out = dict(typo)
    out["_matched_part"] = False
    out["_matched_line"] = False
    return out


def _section_typography(section: Any | None) -> dict[str, Any]:
    if section is None:
        return {"alignment": "justify", "bold": False, "level": 0}
    typo = getattr(section, "typography", None)
    if typo is None and is_dataclass(section):
        typo = asdict(section).get("typography")
    if not isinstance(typo, dict):
        typo = {}
    return typo


def _section_alignment(section: Any | None) -> str:
    return _align(_section_typography(section).get("alignment"))


def _align(value: Any) -> str:
    val = str(value or "").strip().lower()
    return val if val in _VALID_ALIGN else "justify"


def _text_attrs(align: str) -> dict[str, Any]:
    return {"textAlign": _align(align)}


def _heading_level(typo: dict[str, Any]) -> int:
    raw = int(typo.get("level") or 1)
    return max(1, min(raw if raw > 0 else 1, 6))


def _plain_text(text: str) -> str:
    no_span = _RED_SPAN_RE.sub(lambda m: _field_placeholder_text(_field_label(m.group("body"))), text or "")
    no_tags = _HTML_TAG_RE.sub("", no_span)
    no_md = re.sub(r"(\*\*|__)(.+?)\1", r"\2", no_tags)
    return html.unescape(no_md).strip()


def _field_label(text: str) -> str:
    raw = html.unescape(_HTML_TAG_RE.sub("", text or ""))
    m = _RED_SLOT_RE.search(raw)
    if not m:
        return ""
    return re.sub(r"\s+", " ", (m.group(1) or m.group(2) or "").replace("_", " ")).strip().upper()


def _field_placeholder_text(label: str) -> str:
    return f"[________ {label or 'FIELD'} ________]"


def _is_wrapped_bold(line: str) -> bool:
    stripped = line.strip()
    return (
        (stripped.startswith("**") and stripped.endswith("**") and len(stripped) > 4)
        or (stripped.startswith("__") and stripped.endswith("__") and len(stripped) > 4)
    )


def _strip_wrapping_bold(line: str) -> str:
    stripped = line.strip()
    if _is_wrapped_bold(stripped):
        return stripped[2:-2].strip()
    return stripped


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _section_id(index: int, heading: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (heading or "").lower()).strip("-")
    return f"draft-section-{index + 1}" + (f"-{slug[:48].strip('-')}" if slug else "")
