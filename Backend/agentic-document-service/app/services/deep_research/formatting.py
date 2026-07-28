"""Rewrite character-drawn layout in a Deep Research answer as clean Markdown.

The synthesis prompt forbids ASCII art, but models still occasionally "draw" a
table or a flow chart:

    ```
    +-------------------+--------------------------+
    | Risk Area         | Primary Legal Exposure   |
    +-------------------+--------------------------+
    | Non-Registration  | Criminal fine u/s 55(2)  |
    +-------------------+--------------------------+
    ```

Fenced character art is unusable downstream: the chat renders it as clipped
monospace text and the DOCX exporter skips fenced blocks entirely, so the
content silently disappears from an export. This module normalises it at the
single place every answer passes through (`_safe_answer_with_sources`), so the
STORED answer is clean Markdown for every consumer — chat, DOCX, PDF, merge.

Rewrites applied:
  * character-drawn tables (ASCII or unicode box) -> GFM pipe tables
  * a spanning banner row above a table          -> bold caption line
  * ASCII flow diagrams ("|" / "v" / "-->")      -> a single arrow chain
  * prose fenced for no reason                   -> plain paragraphs
  * stray "+----+----+" borders outside fences   -> removed

Genuine code fences (```python, ```json, …) and untagged fences whose content
looks like code are passed through untouched.
"""

from __future__ import annotations

import re

_ALNUM_RE = re.compile(r"[^\W_]", re.UNICODE)

_BOX_VERTICAL = "│║┃╎╏┆┇┊┋"
_BOX_HORIZONTAL = "─═━╌╍┄┅┈┉"
_BOX_JUNCTION = "┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬╭╮╯╰"
_BOX_ANY_RE = re.compile(f"[{_BOX_VERTICAL}{_BOX_HORIZONTAL}{_BOX_JUNCTION}]")

_ARROW_SPLIT_RE = re.compile(r"\s*(?:-{1,3}>|={1,3}>|<-{1,3}|→|➜|➔|⇒|▶|►)\s*")

_OPEN_FENCE_RE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$")
_CLOSE_FENCE_RE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$")

# Fence info strings that may be rewritten; anything else is real code/markup.
_REWRITABLE_INFO = frozenset({
    "", "text", "txt", "plain", "plaintext", "markdown", "md", "mkd",
    "ascii", "asciiart", "ascii-art", "art", "diagram", "flow", "flowchart",
    "table", "tables", "timeline", "chart", "output", "raw", "none",
    "document", "doc", "draft", "legal",
})

_CODE_SIGNALS = (
    re.compile(
        r"^\s*(?:def|class|function|return|import|from|package|public|private|const|let|var|"
        r"async|await|export|require|module|#include|using|namespace|SELECT|INSERT|UPDATE|"
        r"DELETE|CREATE TABLE)\b"
    ),
    re.compile(r"[;{}]\s*$"),
    re.compile(r"^\s*[)\]}]+[;,]?\s*$"),
    re.compile(r"=>|::|->\s*\w+\s*\("),
    re.compile(r"^\s*</?[A-Za-z][\w:-]*[\s/>]"),
    re.compile(r'^\s*"[\w-]+"\s*:'),
)

_DECORATION_TOKEN_RE = re.compile(r"^(?:[-=~|+<>^vV*/\\.'`:]{1,4})$")


def _has_alnum(value: str) -> bool:
    return bool(_ALNUM_RE.search(value))


def _is_border_line(line: str) -> bool:
    """`+-----+-----+`, `|-----|-----|`, `=====` — pure table scaffolding."""
    text = line.strip()
    if not text or _has_alnum(text):
        return False
    if not re.fullmatch(r"[\s+\-=~_|:.*'\"^]+", text):
        return False
    if "+" in text and re.search(r"[-=~]{2,}", text):
        return True
    if text.startswith("|") and re.search(r"[-=~]{3,}", text):
        return True
    return bool(re.fullmatch(r"[_=]{5,}", text))


def _is_decoration_line(line: str) -> bool:
    """`   |        |` / `   v     v` — diagram rails, no content of their own."""
    text = line.strip()
    if not text:
        return False
    if re.fullmatch(r"[|\s]+", text):
        return True
    return all(_DECORATION_TOKEN_RE.fullmatch(tok) for tok in text.split())


def _is_pipe_row(line: str) -> bool:
    return line.count("|") >= 2 and _has_alnum(line)


def _looks_like_code(lines: list[str]) -> bool:
    meaningful = [line for line in lines if line.strip()]
    if not meaningful:
        return False
    hits = sum(1 for line in meaningful if any(rx.search(line) for rx in _CODE_SIGNALS))
    return hits / len(meaningful) >= 0.25


def _normalize_box_chars(line: str) -> str:
    out = []
    for char in line:
        if char in _BOX_VERTICAL:
            out.append("|")
        elif char in _BOX_JUNCTION:
            out.append("+")
        elif char in _BOX_HORIZONTAL:
            out.append("-")
        else:
            out.append(char)
    return "".join(out)


def _split_cells(line: str) -> list[str]:
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|"):
        text = text[:-1]
    return [cell.strip() for cell in text.split("|")]


def _rows_to_markdown_table(rows: list[list[str]]) -> list[str]:
    width = max(len(row) for row in rows)
    lines: list[str] = []
    for cells in rows:
        padded = [cell.replace("|", r"\|").strip() for cell in cells[:width]]
        if len(cells) > width:
            padded[width - 1] = " ".join([padded[width - 1], *cells[width:]]).strip()
        padded += [""] * (width - len(padded))
        lines.append("| " + " | ".join(padded) + " |")
    separator = "|" + "|".join([" --- "] * width) + "|"
    return [lines[0], separator, *lines[1:]]


def _dedent(lines: list[str]) -> list[str]:
    expanded = [line.replace("\t", "    ") for line in lines]
    indents = [len(line) - len(line.lstrip(" ")) for line in expanded if line.strip()]
    common = min(indents) if indents else 0
    out = []
    for line in expanded:
        stripped = line[common:]
        lead = len(stripped) - len(stripped.lstrip(" "))
        out.append("   " + stripped.lstrip(" ") if lead >= 4 else stripped)
    return out


def _unwrap_block(raw_lines: list[str]) -> list[str]:
    """Character-drawn tables -> GFM tables; everything else -> plain text."""
    lines = [_normalize_box_chars(line) for line in _dedent(raw_lines)]
    out: list[str] = []
    table_rows: list[list[str]] = []
    text_run: list[str] = []

    def flush_text() -> None:
        nonlocal text_run
        if not text_run:
            return
        if out and out[-1] != "":
            out.append("")
        # A trailing backslash is a CommonMark hard break: the drafted line
        # structure survives without HTML and without trailing whitespace.
        for i, line in enumerate(text_run):
            out.append(f"{line}\\" if i < len(text_run) - 1 else line)
        out.append("")
        text_run = []

    def flush_table() -> None:
        nonlocal table_rows
        if not table_rows:
            return
        if len(table_rows) == 1:
            text_run.append("| " + " | ".join(table_rows[0]) + " |")
            table_rows = []
            flush_text()
            return
        rows = table_rows
        first = [cell for cell in rows[0] if cell]
        widest = max(len(row) for row in rows)
        # "|      RISK ASSESSMENT MATRIX      |" above the real header row is a
        # banner, not a header — promote it to a bold caption.
        if len(rows) >= 3 and len(first) == 1 and widest >= 2 and len(rows[1]) >= 2:
            text_run.append(f"**{first[0]}**")
            flush_text()
            rows = rows[1:]
        if out and out[-1] != "":
            out.append("")
        out.extend(_rows_to_markdown_table(rows))
        out.append("")
        table_rows = []

    for line in lines:
        if _is_border_line(line):
            continue
        if _is_decoration_line(line):
            flush_table()
            continue
        if _is_pipe_row(line):
            flush_text()
            table_rows.append(_split_cells(line))
            continue
        flush_table()
        text = line.replace("|", " ").replace("+", " ").rstrip()
        if not text.strip():
            if text_run:
                flush_text()
            continue
        if not _has_alnum(text):
            continue
        # Space-aligned columns ("01 July 2025      30 Sept 2025") must not
        # collapse into one run-on string — separate them visibly instead.
        lead = text[: len(text) - len(text.lstrip(" "))]
        text_run.append(lead + re.sub(r"\s{3,}", " · ", text.strip()))

    flush_table()
    flush_text()
    while out and out[-1] == "":
        out.pop()
    return out


def _diagram_to_flow(raw_lines: list[str]) -> list[str] | None:
    """`A --> B` / stacked `|` `v` rails -> one readable arrow chain."""
    steps: list[str] = []
    for raw in raw_lines:
        line = _normalize_box_chars(raw)
        if not line.strip() or _is_border_line(line) or _is_decoration_line(line):
            continue
        for segment in _ARROW_SPLIT_RE.split(line):
            for piece in re.split(r"\s{3,}", segment):
                cleaned = re.sub(r"^[\s|+*.\\/'`<>^-]+", "", piece)
                cleaned = re.sub(r"[\s|+*\\/'`<>^-]+$", "", cleaned)
                cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
                if cleaned and _has_alnum(cleaned):
                    steps.append(cleaned)
    if len(steps) < 2:
        return None
    if len(steps) <= 8:
        return [" → ".join(steps)]
    return [f"- {step}" for step in steps]


def _classify(lines: list[str]) -> str:
    content = [
        line for line in lines
        if line.strip() and not _is_border_line(line) and not _is_decoration_line(line)
    ]
    if not content:
        return "empty"
    if _looks_like_code(content):
        return "code"
    pipe_rows = [line for line in content if _is_pipe_row(line)]
    if len(pipe_rows) >= 2 and len(pipe_rows) / len(content) >= 0.5:
        return "table"
    joined = "\n".join(lines)
    has_arrows = bool(_ARROW_SPLIT_RE.search(joined))
    has_rails = any(line.strip() and _is_decoration_line(line) for line in lines)
    if len(content) >= 2 and (has_arrows or has_rails):
        return "diagram"
    return "prose"


def _rewrite_fence_body(body: list[str]) -> list[str] | None:
    kind = _classify([_normalize_box_chars(line) for line in body])
    if kind in {"code", "empty"}:
        return None
    if kind == "diagram":
        return _diagram_to_flow(body) or _unwrap_block(body)
    return _unwrap_block(body)


def _clean_loose_lines(lines: list[str]) -> list[str]:
    """Drop ASCII borders emitted outside a fence; keep real Markdown rules."""
    out: list[str] = []
    for line in lines:
        normalized = _normalize_box_chars(line) if _BOX_ANY_RE.search(line) else line
        text = normalized.strip()
        if not text:
            out.append(line)
            continue
        if not _has_alnum(text) and "+" in text and re.search(r"[-=]{2,}", text):
            continue
        if not _has_alnum(text) and _BOX_ANY_RE.search(line):
            continue
        out.append(normalized)
    return out


def normalize_ascii_layout(text: str) -> str:
    """Return `text` with every character-drawn construct rewritten as Markdown."""
    raw = str(text or "")
    if not raw or not re.search(r"```|~~~|\+[-=]{2,}|[│─┌└├╔║]", raw):
        return raw

    lines = raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: list[str] = []
    loose: list[str] = []
    fence_marker: str | None = None
    fence_info = ""
    fence_header = ""
    fence_body: list[str] = []

    def flush_loose() -> None:
        nonlocal loose
        out.extend(_clean_loose_lines(loose))
        loose = []

    def close_fence(closing_line: str | None) -> None:
        nonlocal fence_marker, fence_info, fence_header, fence_body
        rewritten = (
            _rewrite_fence_body(fence_body)
            if fence_info.lower() in _REWRITABLE_INFO
            else None
        )
        if rewritten is not None:
            if out and out[-1].strip() != "":
                out.append("")
            out.extend(rewritten)
            out.append("")
        else:
            out.append(fence_header)
            out.extend(fence_body)
            if closing_line is not None:
                out.append(closing_line)
        fence_marker = None
        fence_info = ""
        fence_header = ""
        fence_body = []

    for line in lines:
        if fence_marker is not None:
            close = _CLOSE_FENCE_RE.match(line)
            if close and close.group(1)[0] == fence_marker[0] and len(close.group(1)) >= len(fence_marker):
                close_fence(line)
            else:
                fence_body.append(line)
            continue
        opening = _OPEN_FENCE_RE.match(line)
        if opening:
            flush_loose()
            fence_marker = opening.group(1)
            fence_info = opening.group(2) or ""
            fence_header = line
            fence_body = []
            continue
        loose.append(line)

    # A fence the model never closed (or a truncated stream) is rewritten anyway.
    if fence_marker is not None:
        close_fence(None)
    flush_loose()

    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


__all__ = ["normalize_ascii_layout"]
