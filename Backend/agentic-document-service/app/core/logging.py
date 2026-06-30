"""
Clean tabular terminal logger for agentic-document-service.

Each log line is one row of an aligned ASCII table. The metadata columns are
fixed-width so they line up; the MESSAGE column is shown IN FULL (never
truncated) so nothing important is lost.

 TIME     │ LEVEL │ COMPONENT        │ FUNCTION            │ MODEL           │ MESSAGE
 ─────────┼───────┼──────────────────┼─────────────────────┼─────────────────┼──────────────
 11:43:35 │ INFO  │ DocumentAI       │ _generate_text      │ gemma-4-31b-it  │ LLM IN USE  provider=gemini  api_key=GEMMA_API_KEY
 11:43:35 │ WARN  │ Embeddings       │ _gemini_embed       │ —               │ text-embedding-004 returned 404 — blacklisting
"""
from __future__ import annotations

import logging
import re
import sys
import time
from typing import Any

# ── ANSI palette ───────────────────────────────────────────────────────────────
_R = '\x1b[0m'

_LEVEL_COLOR = {
    'DEBUG':    '\x1b[38;5;244m',   # grey
    'INFO':     '\x1b[36m',          # cyan
    'WARNING':  '\x1b[33m',          # yellow
    'ERROR':    '\x1b[31m',          # red
    'CRITICAL': '\x1b[1;31m',        # bold red
}
# Short, fixed-width level labels so the column stays tidy.
_LEVEL_SHORT = {'DEBUG': 'DEBUG', 'INFO': 'INFO', 'WARNING': 'WARN', 'ERROR': 'ERROR', 'CRITICAL': 'CRIT'}

_STATUS_COLOR = {
    'processing': '\x1b[38;5;214m',  # orange
    'completed':  '\x1b[32m',         # green
    'failed':     '\x1b[31m',         # red
    'info':       '',                 # default (no recolor)
}
_MODEL_COLOR  = '\x1b[35m'           # magenta
_COMP_COLOR   = '\x1b[34m'           # blue
_DIM          = '\x1b[38;5;240m'     # dark grey
_HEADER_COLOR = '\x1b[1;37m'         # bold white

# ── Column widths (MESSAGE is unbounded / never truncated) ──────────────────────
_W = {
    'time':      8,
    'level':     5,
    'component': 16,
    'function':  19,
    'model':     15,
}
_BAR = f'{_DIM}│{_R}'   # column separator

# ── Regex extractors ─────────────────────────────────────────────────────────
_COMPONENT_RE = re.compile(r'\[([A-Za-z][^\]]{1,35})\]')
# Now recognizes gemma + deepseek too (not only gemini/claude/gpt).
_MODEL_RE     = re.compile(r'\b(gemini[-\w.]+|gemma[-\w.]+|claude[-\w.]+|deepseek[-\w.]+|gpt[-\w.]+)', re.IGNORECASE)
_KV_MODEL_RE  = re.compile(r'(?:llm_model|raw_llm_model|model)=([A-Za-z][^\s,;|]+)')
_HTTP_RE      = re.compile(r'"(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+HTTP/\S+"\s+(\d+)')

_DONE_KW  = ('complete', 'success', 'ready', 'done', 'loaded', 'finish', ' ok', 'mounted', 'repaired', 'passed', 'allowed')
_FAIL_KW  = ('fail', 'error', 'exception', 'traceback', 'abort', 'invalid', 'denied', 'timeout', '404', '403', '401', '500')
_PROC_KW  = ('start', 'creat', 'submit', 'upload', 'process', 'running', 'fetch',
             'download', 'detect', 'build', 'poll', 'scan', 'ocr', 'generat', 'connect', 'received')


def _cell(text: str, width: int, color: str = '', rpad: bool = True) -> str:
    """Truncate / pad text to exactly `width` visible characters (used for metadata columns only)."""
    t = str(text if text not in (None, '') else '—')
    if len(t) > width:
        t = t[:width - 1] + '…'
    padded = t.ljust(width) if rpad else t.rjust(width)
    return f'{color}{padded}{_R}' if color else padded


def _extract(record: logging.LogRecord) -> dict[str, Any]:
    msg   = record.getMessage()
    lower = msg.lower()
    out: dict[str, Any] = {}

    # Component: first [Bracket] in message, else short logger name
    comp_m = _COMPONENT_RE.search(msg)
    if comp_m:
        out['component'] = comp_m.group(1)
    else:
        parts = record.name.split('.')
        out['component'] = parts[-1] if len(parts) > 1 else record.name

    # Model — prefer explicit kv pair, then free-text match (gemini/gemma/claude/deepseek/gpt)
    kv_m = _KV_MODEL_RE.search(msg)
    if kv_m:
        out['model'] = kv_m.group(1)
    else:
        m = _MODEL_RE.search(msg)
        out['model'] = m.group(1) if m else '—'

    # HTTP request — surface "METHOD status" as the component
    http_m = _HTTP_RE.search(msg)
    if http_m:
        out['component'] = f"{http_m.group(1)} {http_m.group(3)}"

    # Status (drives the message colour)
    if any(w in lower for w in _FAIL_KW):
        out['status'] = 'failed'
    elif any(w in lower for w in _DONE_KW):
        out['status'] = 'completed'
    elif any(w in lower for w in _PROC_KW):
        out['status'] = 'processing'
    else:
        out['status'] = 'info'

    return out


class TabularFormatter(logging.Formatter):
    """One aligned table row per record; full (untruncated) message; header printed once."""
    _header_printed = False

    @classmethod
    def _print_header(cls) -> None:
        if cls._header_printed:
            return
        cls._header_printed = True
        head = [
            _cell('TIME',      _W['time'],      _HEADER_COLOR),
            _cell('LEVEL',     _W['level'],     _HEADER_COLOR),
            _cell('COMPONENT', _W['component'], _HEADER_COLOR),
            _cell('FUNCTION',  _W['function'],  _HEADER_COLOR),
            _cell('MODEL',     _W['model'],     _HEADER_COLOR),
            f'{_HEADER_COLOR}MESSAGE{_R}',
        ]
        header = f' {_BAR} '.join(head)
        # Divider with ┼ joints under each │ for a clean table look.
        segs = [_W['time'], _W['level'], _W['component'], _W['function'], _W['model']]
        divider = _DIM + '─┼─'.join('─' * w for w in segs) + '─┼─' + '─' * 12 + _R
        print(header, file=sys.stderr)
        print(divider, file=sys.stderr)

    def format(self, record: logging.LogRecord) -> str:
        self._print_header()

        fields = _extract(record)
        ts     = time.strftime('%H:%M:%S', time.localtime(record.created))
        level  = record.levelname
        status = fields.get('status', 'info')
        model  = fields.get('model', '—')

        msg = record.getMessage()
        # Drop leading [Bracket] tags — the COMPONENT column already shows them.
        msg = re.sub(r'^\s*(?:\[[\w\s:/_\-\.]{1,50}\]\s*)+', '', msg).strip() or record.getMessage()
        # Indent any continuation lines (multi-line messages like the token table) so they
        # don't collide with the columns, keeping the block readable.
        if '\n' in msg:
            msg = msg.replace('\n', '\n' + ' ' * 12)
        # Colour the message by outcome (only failed/completed, so INFO stays plain & legible).
        scolor = _STATUS_COLOR.get(status, '')
        if scolor and status in ('failed', 'completed'):
            msg = f'{scolor}{msg}{_R}'

        cells = [
            _cell(ts,                _W['time'],      _DIM),
            _cell(_LEVEL_SHORT.get(level, level), _W['level'], _LEVEL_COLOR.get(level, '')),
            _cell(fields.get('component', '—'),   _W['component'], _COMP_COLOR),
            _cell(record.funcName or '—',         _W['function'],  _DIM),
            _cell(model,             _W['model'],     _MODEL_COLOR if model != '—' else _DIM),
            msg,
        ]
        return f' {_BAR} '.join(cells)


def configure_logging(level: str) -> None:
    resolved_level = getattr(logging, level.upper(), logging.INFO)

    handler = logging.StreamHandler(sys.stderr)
    handler.setLevel(resolved_level)
    handler.setFormatter(TabularFormatter())

    # Apply to root so every logger inherits it by default
    root = logging.getLogger()
    root.setLevel(resolved_level)
    for h in root.handlers[:]:
        root.removeHandler(h)
    root.addHandler(handler)

    # Explicitly attach to uvicorn loggers and clear their existing handlers
    # so uvicorn's own default formatter doesn't produce "INFO:     " lines.
    for logger_name in (
        'agentic_document_service',
        'agentic_document_service.pipeline',
        'agentic_document_service.folder',
        'agentic_document_service.agent',
        'uvicorn',
        'uvicorn.error',
        'uvicorn.access',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'fastapi',
    ):
        lg = logging.getLogger(logger_name)
        lg.setLevel(resolved_level)
        lg.propagate = True          # let the root handler pick it up
        for h in lg.handlers[:]:    # remove any pre-existing handlers
            lg.removeHandler(h)
