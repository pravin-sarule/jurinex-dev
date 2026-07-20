"""Extract lightweight layout facts from draft templates.

The drafting pipeline already extracts plain text for semantic structure, but plain text
cannot tell whether a template line was centered, right-aligned, bold, or body text. This
module derives a conservative line-level layout map from the uploaded template bytes so
rendering can use the template as the formatting authority.
"""
from __future__ import annotations

import io
import logging
import math
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Any

logger = logging.getLogger("agentic_document_service.template_layout")

_VALID_ALIGN = {"left", "center", "right", "justify"}
_WORD_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def extract_template_layout(data: bytes, *, mime_type: str | None = None, filename: str | None = None) -> dict[str, Any]:
    """Return a best-effort layout map: {"lines": [{text, alignment, bold, size_pt, page}]}.

    The extractor is intentionally conservative. If geometry is uncertain, it returns
    left/justify instead of inventing center alignment. Downstream renderers should use
    these facts to override heuristics, not as drafted content.
    """
    if not data:
        return {"lines": [], "tables": []}
    name = (filename or "").lower()
    mime = (mime_type or "").lower()
    try:
        if name.endswith(".docx") or "wordprocessingml" in mime:
            return {"source": "docx", "lines": _dedupe_lines(_extract_docx_lines(data)), "tables": []}
        if name.endswith(".pdf") or mime == "application/pdf":
            return {
                "source": "pdf",
                "lines": _dedupe_lines(_extract_pdf_lines(data)),
                "tables": _extract_pdf_tables(data),
            }
    except Exception as exc:  # layout is a fidelity improvement, never a hard draft failure
        logger.warning("[template_layout] layout extraction failed for %s: %s", filename or mime_type, exc)
    return {"lines": [], "tables": []}


def _extract_pdf_tables(data: bytes) -> list[dict[str, Any]]:
    """Recover the template's TABLES from the PDF's ruling lines.

    Plain text extraction flattens a grid into a vertical dump — and a cell that is BLANK in
    the template (the "Original / Copy" and "Annexure / Exhibit" columns of a LIST OF DOCUMENTS
    schedule) simply vanishes, because there are no glyphs to extract. The model therefore had
    no way to tell a table from a numbered list, and drafted these schedules as flat lists with
    their columns and headings gone. pdfplumber reads the ruled lines, so the grid — empty cells
    included — is recovered exactly.

    Returns [{page, header: [...], rows: [[...]]}]; empty list when pdfplumber is unavailable.
    """
    try:
        import pdfplumber  # type: ignore
    except ImportError:
        logger.info("[template_layout] pdfplumber not installed — template tables not recovered")
        return []

    out: list[dict[str, Any]] = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as doc:
            for page_index, page in enumerate(doc.pages):
                for raw in page.extract_tables() or []:
                    rows = [
                        [_clean_text((cell or "").replace("\n", " ")) for cell in row]
                        for row in raw
                        if row is not None
                    ]
                    rows = [r for r in rows if any(c for c in r)]
                    # A real grid needs at least a header + one body row, and >1 column;
                    # anything less is a false positive from stray rules.
                    if len(rows) < 2 or len(rows[0]) < 2:
                        continue
                    out.append({
                        "page": page_index + 1,
                        "header": rows[0],
                        "rows": rows[1:],
                    })
    except Exception as exc:
        logger.warning("[template_layout] pdf table extraction failed: %s", exc)
        return []
    if out:
        logger.info(
            "[template_layout] recovered %d template table(s): %s",
            len(out), [f"{len(t['rows'])}x{len(t['header'])}" for t in out],
        )
    return out


def _extract_docx_lines(data: bytes) -> list[dict[str, Any]]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        document_xml = archive.read("word/document.xml")
    root = ET.fromstring(document_xml)
    lines: list[dict[str, Any]] = []
    for p in root.findall(".//w:body/w:p", _WORD_NS):
        texts = [t.text or "" for t in p.findall(".//w:t", _WORD_NS)]
        text = _clean_text("".join(texts))
        if not text:
            continue
        ppr = p.find("w:pPr", _WORD_NS)
        align = "left"
        style = ""
        if ppr is not None:
            jc = ppr.find("w:jc", _WORD_NS)
            if jc is not None:
                raw = (jc.attrib.get(f"{{{_WORD_NS['w']}}}val") or "").lower()
                align = {"both": "justify", "distribute": "justify", "start": "left", "end": "right"}.get(raw, raw)
                if align not in _VALID_ALIGN:
                    align = "left"
            ps = ppr.find("w:pStyle", _WORD_NS)
            if ps is not None:
                style = (ps.attrib.get(f"{{{_WORD_NS['w']}}}val") or "").lower()
        bold = any(r.find("w:rPr/w:b", _WORD_NS) is not None for r in p.findall("w:r", _WORD_NS))
        sizes = []
        for sz in p.findall(".//w:rPr/w:sz", _WORD_NS):
            val = sz.attrib.get(f"{{{_WORD_NS['w']}}}val")
            try:
                if val:
                    sizes.append(float(val) / 2.0)
            except ValueError:
                pass
        level = 1 if style.startswith("heading") or (align == "center" and len(text) <= 120) else 0
        lines.append({
            "text": text,
            "alignment": align,
            "bold": bool(bold or style.startswith("heading")),
            "size_pt": sizes[0] if sizes else None,
            "level": level,
        })
    return lines


def _compose(cm: Any, tm: Any) -> tuple[float, float]:
    """Device-space (x, y) of a text fragment = translation of (tm x cm).

    Both are PDF affine matrices [a, b, c, d, e, f] meaning
        | a  b  0 |
        | c  d  0 |
        | e  f  1 |
    so the composed translation is:
        x = a_t*e_c + b_t*c_c + e_t  ... expanded below in full.
    Falls back to the text matrix alone when cm is missing/degenerate (identity CTM).
    """
    t = [float(v) for v in (tm or [1, 0, 0, 1, 0, 0])]
    c = [float(v) for v in (cm or [1, 0, 0, 1, 0, 0])]
    if len(t) < 6:
        raise ValueError("bad text matrix")
    if len(c) < 6:
        return t[4], t[5]
    x = t[4] * c[0] + t[5] * c[2] + c[4]
    y = t[4] * c[1] + t[5] * c[3] + c[5]
    return x, y


def _matrix_scale(cm: Any) -> float:
    """Uniform scale factor of the CTM (sqrt of |determinant|); 1.0 when absent/degenerate."""
    c = [float(v) for v in (cm or [1, 0, 0, 1, 0, 0])]
    if len(c) < 4:
        return 1.0
    det = abs(c[0] * c[3] - c[1] * c[2])
    return math.sqrt(det) if det > 0 else 1.0


def _extract_pdf_lines(data: bytes) -> list[dict[str, Any]]:
    from pypdf import PdfReader  # type: ignore

    reader = PdfReader(io.BytesIO(data))
    layout_lines = _extract_pdf_layout_mode_lines(reader)
    if len(layout_lines) >= 8:
        return layout_lines
    out: list[dict[str, Any]] = []
    for page_index, page in enumerate(reader.pages):
        width = float(page.mediabox.width or 612)
        fragments: list[dict[str, Any]] = []

        def visitor_text(text, cm, tm, font_dict, font_size):  # pypdf visitor signature
            raw = str(text or "")
            if not raw.strip():
                return
            # PDF text position is the TEXT matrix composed with the CURRENT TRANSFORMATION
            # matrix: device = tm x cm. Reading tm[4]/tm[5] alone (as this did) yields
            # coordinates in text space, NOT page space — for a reportlab-style PDF that
            # produced values like x=0, y=-132 on an A4 page, so every alignment decision and
            # the top-to-bottom line ordering were computed from meaningless geometry.
            try:
                x, y = _compose(cm, tm)
                scale = _matrix_scale(cm)
            except Exception:
                return
            font_name = ""
            if isinstance(font_dict, dict):
                font_name = str(font_dict.get("/BaseFont") or font_dict.get("/FontName") or "")
            size = (float(font_size or 0) or 12.0) * (scale or 1.0)
            for part in raw.replace("\r", "\n").split("\n"):
                clean = _clean_text(part)
                if clean:
                    fragments.append({
                        "text": clean,
                        "x": x,
                        "y": y,
                        "font_size": size,
                        "font": font_name,
                    })

        try:
            page.extract_text(visitor_text=visitor_text)
        except TypeError:
            # Older pypdf API without visitors: no reliable geometry.
            text = page.extract_text() or ""
            for line in text.splitlines():
                clean = _clean_text(line)
                if clean:
                    out.append({"text": clean, "alignment": "left", "bold": False, "size_pt": None, "page": page_index + 1, "level": 0})
            continue

        # Group fragments by baseline. This handles the common pypdf case where each text
        # operator is a word/span but shares a y-coordinate with its line.
        fragments.sort(key=lambda f: (-f["y"], f["x"]))
        groups: list[list[dict[str, Any]]] = []
        for frag in fragments:
            placed = False
            tol = max(2.2, (frag.get("font_size") or 12.0) * 0.35)
            for group in groups:
                if abs(group[0]["y"] - frag["y"]) <= tol:
                    group.append(frag)
                    placed = True
                    break
            if not placed:
                groups.append([frag])

        page_lines: list[dict[str, Any]] = []
        for group in groups:
            group.sort(key=lambda f: f["x"])
            text = _clean_text(" ".join(f["text"] for f in group))
            if not text:
                continue
            font_size = max((float(f.get("font_size") or 0) for f in group), default=12.0) or 12.0
            x0 = min(float(f["x"]) for f in group)
            estimated_widths = [max(1.0, len(str(f["text"])) * float(f.get("font_size") or font_size) * 0.48) for f in group]
            x1 = max(float(f["x"]) + w for f, w in zip(group, estimated_widths))
            center = (x0 + x1) / 2.0
            page_center = width / 2.0
            left_margin = x0
            right_margin = max(0.0, width - x1)
            align = "left"
            if (
                abs(center - page_center) <= max(18.0, width * 0.045)
                and left_margin >= width * 0.12
                and right_margin >= width * 0.12
                and len(text) <= 160
            ):
                align = "center"
            elif right_margin <= max(28.0, width * 0.055) and left_margin > right_margin * 1.8:
                align = "right"
            bold = any("bold" in str(f.get("font") or "").lower() for f in group)
            level = 1 if align == "center" and len(text) <= 140 else 0
            page_lines.append({
                "text": text,
                "alignment": align,
                "bold": bold,
                "size_pt": round(font_size, 1),
                "page": page_index + 1,
                "level": level,
                "_x0": x0,
                "_x1": x1,
            })

        out.extend(_mark_justified_runs(page_lines))
    return out


def _mark_justified_runs(page_lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Promote left-aligned runs to "justify" when their interior lines are flush right.

    A PDF gives no alignment attribute — it only gives glyph positions — so a JUSTIFIED
    paragraph is indistinguishable from a LEFT one by start-x alone (both begin at the left
    margin). The distinguishing signal is the RIGHT edge: justification stretches every line of
    a paragraph except its last one out to the body's right margin, whereas a left-aligned
    paragraph's lines end ragged. So: find the body's right edge, then any run of consecutive
    left lines sharing a left margin in which at least one NON-FINAL line reaches that edge is
    a justified paragraph — and the whole run (its short last line included) is marked justify.

    Without this, every justified body paragraph in a PDF template reported as "left", which is
    the single largest source of alignment drift on PDF templates.
    """
    body = [ln for ln in page_lines if ln["alignment"] == "left"]
    if len(body) >= 2:
        right_edge = max(float(ln["_x1"]) for ln in body)
        left_edge = min(float(ln["_x0"]) for ln in body)
        # Flush = within 2% of the body's widest line; same-left = within 4pt of the body margin.
        flush_tol = max(6.0, right_edge * 0.02)
        left_tol = 4.0

        run: list[dict[str, Any]] = []

        def _flush_run() -> None:
            # Justified only if an INTERIOR line (not the last) reaches the right edge — the
            # last line of a justified paragraph is legitimately short, so it proves nothing.
            if len(run) >= 2 and any(
                float(ln["_x1"]) >= right_edge - flush_tol for ln in run[:-1]
            ):
                for ln in run:
                    ln["alignment"] = "justify"
            run.clear()

        for ln in page_lines:
            same_block = (
                ln["alignment"] == "left"
                and abs(float(ln["_x0"]) - left_edge) <= left_tol
            )
            if same_block:
                run.append(ln)
            else:
                _flush_run()
        _flush_run()

    for ln in page_lines:
        ln.pop("_x0", None)
        ln.pop("_x1", None)
    return page_lines


def _extract_pdf_layout_mode_lines(reader: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for page_index, page in enumerate(reader.pages):
        try:
            raw_text = page.extract_text(extraction_mode="layout") or ""
        except TypeError:
            return []
        raw_lines = [ln.rstrip() for ln in raw_text.replace("\r", "\n").split("\n")]
        nonblank = [ln for ln in raw_lines if ln.strip()]
        if not nonblank:
            continue
        page_chars = max(max(len(ln) for ln in nonblank), 80)
        page_lines: list[dict[str, Any]] = []
        for raw in raw_lines:
            if not raw.strip():
                continue
            text = _clean_text(raw)
            if not text:
                continue
            leading = len(raw) - len(raw.lstrip(" "))
            align = _layout_mode_align(text, leading, page_chars)
            bold = _layout_mode_bold(text, align)
            page_lines.append({
                "text": text,
                "alignment": align,
                "bold": bold,
                "size_pt": None,
                "page": page_index + 1,
                "level": 1 if bold and align == "center" else 0,
                # Column extents in CHARACTER units. layout mode pads each line with spaces to
                # its true column, so leading..leading+len is a faithful (monospaced) stand-in
                # for the x-extent — enough for the same flush-right test the geometry path uses.
                "_x0": float(leading),
                "_x1": float(leading + len(text)),
            })
        # Justified body paragraphs are indistinguishable from left-aligned ones by indent alone
        # (both start at the left margin); the tell is that their interior lines run flush to the
        # right margin. Without this every justified paragraph in a PDF template reported "left",
        # which was the single largest source of alignment drift on PDF templates.
        out.extend(_mark_justified_runs(page_lines))
    return out


def _layout_mode_align(text: str, leading: int, page_chars: int) -> str:
    plain = _clean_text(text)
    if re.search(r"…\s*(?:plaintiff|defendant|petitioner|respondent|appellant|applicant)\b", plain, re.IGNORECASE):
        return "right"
    if re.fullmatch(r"(?:VERSUS|VS\.?|V/S\.?)", plain, re.IGNORECASE):
        return "center"
    letters = [c for c in plain if c.isalpha()]
    upper_ratio = (sum(1 for c in letters if c.isupper()) / len(letters)) if letters else 0
    court_title = bool(re.match(r"^(?:IN\s+THE\s+COURT|.*\b(?:SUIT|PETITION|APPEAL|APPLICATION|COMPLAINT)\s+NO\.?|PLAINT\s+UNDER|PETITION\s+UNDER|APPLICATION\s+UNDER|WITH\s+SECTION|COMMERCIAL\s+COURTS?\s+ACT,?\s+2015\s+FOR|DECLARATION\s*/|COMMERCIAL\s+RELIEFS|PRAYER|VERIFICATION|STATEMENT\s+OF\s+TRUTH|LIST\s+OF\s+DOCUMENTS|LIST\s+OF\s+DATES)", plain, re.IGNORECASE))
    center_pos = leading + (len(plain) / 2.0)
    page_center = page_chars / 2.0
    visually_centered = leading > 0 and abs(center_pos - page_center) <= max(10.0, page_chars * 0.18)
    if court_title or (upper_ratio >= 0.82 and leading > 0 and len(plain) <= 180) or (visually_centered and upper_ratio >= 0.75):
        return "center"
    if leading >= page_chars * 0.58 and len(plain) <= 80:
        return "right"
    return "left"


def _layout_mode_bold(text: str, align: str) -> bool:
    plain = _clean_text(text)
    if align == "center" and len(plain) <= 220:
        return True
    letters = [c for c in plain if c.isalpha()]
    if len(letters) >= 4 and sum(1 for c in letters if c.isupper()) / len(letters) >= 0.86 and len(plain) <= 140:
        return True
    return False


def _dedupe_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()
    for line in lines or []:
        text = _clean_text(str(line.get("text") or ""))
        if not text:
            continue
        align = str(line.get("alignment") or "left").lower()
        if align not in _VALID_ALIGN:
            align = "left"
        page = int(line.get("page") or 0)
        key = (_norm_key(text), align, page)
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "text": text,
            "alignment": align,
            "bold": bool(line.get("bold")),
            "size_pt": line.get("size_pt"),
            "page": page or None,
            "level": int(line.get("level") or 0),
        })
    return out[:2000]


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _norm_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()
