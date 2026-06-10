"""
Tabular terminal logger for agentic-document-service.

Every log line is rendered as a fixed-width table row so the console output
looks like a live dashboard instead of an unreadable wall of text.

  TIME      LEVEL    COMPONENT              FUNCTION               MODEL                  STATUS      MESSAGE
  ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  13:01:40  INFO     BatchService           create_batch_job       gemini-2.0-flash       processing  Creating JSONL for 3 queries
  13:01:52  INFO     HTTP                   —                      —                      completed   POST /api/batch/jobs 200
  13:02:05  WARNING  LLMModelsCatalog       _load                  —                      info        Could not reach model catalog DB
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
_STATUS_COLOR = {
    'processing': '\x1b[38;5;214m',  # orange
    'completed':  '\x1b[32m',         # green
    'failed':     '\x1b[31m',         # red
    'info':       '\x1b[38;5;244m',   # grey
}
_MODEL_COLOR  = '\x1b[35m'           # magenta
_COMP_COLOR   = '\x1b[34m'           # blue
_DIM          = '\x1b[38;5;240m'     # dark grey
_HEADER_COLOR = '\x1b[1;37m'         # bold white

# ── Column widths ─────────────────────────────────────────────────────────────
_W = {
    'time':      8,
    'level':     8,
    'component': 18,
    'function':  20,
    'api':       28,
    'model':     18,
    'status':    11,
    # message takes the rest
}

# ── Regex extractors ─────────────────────────────────────────────────────────
_COMPONENT_RE = re.compile(r'\[([A-Za-z][^\]]{1,35})\]')
_MODEL_RE     = re.compile(r'\b(gemini[-\w.]+|claude[-\w.]+|gpt[-\w.]+)', re.IGNORECASE)
_KV_MODEL_RE  = re.compile(r'(?:llm_model|raw_llm_model|model)=([^\s,;|]+)')
_HTTP_RE      = re.compile(r'"(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+HTTP/\S+"\s+(\d+)')

_DONE_KW  = ('complete', 'success', 'ready', 'done', 'loaded', 'finish', ' ok', 'mounted', 'repaired')
_FAIL_KW  = ('fail', 'error', 'exception', 'traceback', 'abort', 'invalid', 'denied')
_PROC_KW  = ('start', 'creat', 'submit', 'upload', 'process', 'running', 'fetch',
             'download', 'detect', 'build', 'poll', 'scan', 'ocr', 'generat', 'connect')


def _cell(text: str, width: int, color: str = '', rpad: bool = True) -> str:
    """Truncate / pad text to exactly `width` visible characters."""
    t = str(text or '—')
    if len(t) > width:
        t = t[:width - 1] + '…'
    padded = t.ljust(width) if rpad else t.rjust(width)
    if color:
        return f'{color}{padded}{_R}'
    return padded


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

    # Model — prefer explicit kv pair, then free-text match
    kv_m = _KV_MODEL_RE.search(msg)
    if kv_m:
        out['model'] = kv_m.group(1)
    else:
        m = _MODEL_RE.search(msg)
        out['model'] = m.group(1) if m else '—'

    # HTTP request — override component
    http_m = _HTTP_RE.search(msg)
    if http_m:
        out['component'] = f"{http_m.group(1)} {http_m.group(3)}"
        out['http_path'] = http_m.group(2)

    # Status
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
    """
    Formats each log record as one fixed-width table row.
    A header + divider is printed once at the start of the process.
    """
    _header_printed = False

    @classmethod
    def _print_header(cls) -> None:
        if cls._header_printed:
            return
        cls._header_printed = True
        sep = '─'
        total = sum(_W.values()) + (len(_W) - 1) * 2 + 60  # 60 for message
        cols = [
            _cell('TIME',      _W['time'],      _HEADER_COLOR),
            _cell('LEVEL',     _W['level'],     _HEADER_COLOR),
            _cell('COMPONENT', _W['component'], _HEADER_COLOR),
            _cell('FUNCTION',  _W['function'],  _HEADER_COLOR),
            _cell('API / PATH', _W['api'],      _HEADER_COLOR),
            _cell('MODEL',     _W['model'],     _HEADER_COLOR),
            _cell('STATUS',    _W['status'],    _HEADER_COLOR),
            f'{_HEADER_COLOR}MESSAGE{_R}',
        ]
        header = '  '.join(cols)
        divider = _DIM + sep * total + _R
        print(header, file=sys.stderr)
        print(divider, file=sys.stderr)

    def format(self, record: logging.LogRecord) -> str:
        self._print_header()

        fields = _extract(record)
        ts     = time.strftime('%H:%M:%S', time.localtime(record.created))
        level  = record.levelname
        func   = record.funcName or '—'
        comp   = fields.get('component', '—')
        model  = fields.get('model', '—')
        status = fields.get('status', 'info')
        msg    = record.getMessage()

        # API column: show "METHOD /path" for HTTP access logs, else route tag from [Route:xxx]
        api_col = '—'
        if fields.get('http_path'):
            method = fields.get('http_method', '')
            api_col = f"{method} {fields['http_path']}" if method else fields['http_path']
        else:
            route_m = re.search(r'\[Route:([^\]]+)\]', msg)
            if route_m:
                api_col = f"/{route_m.group(1).replace('_', '-')}"

        # Shorten noisy logger prefixes from message
        msg = re.sub(r'\[[\w\s:/_\-\.]{1,50}\]\s*', '', msg).strip() or msg

        # Truncate long messages
        if len(msg) > 85:
            msg = msg[:83] + '…'

        _API_COLOR = '\x1b[38;5;75m'   # light blue for API paths
        cols = [
            _cell(ts,      _W['time'],      _DIM),
            _cell(level,   _W['level'],     _LEVEL_COLOR.get(level, '')),
            _cell(comp,    _W['component'], _COMP_COLOR),
            _cell(func,    _W['function'],  _DIM),
            _cell(api_col, _W['api'],       _API_COLOR if api_col != '—' else _DIM),
            _cell(model,   _W['model'],     _MODEL_COLOR if model != '—' else _DIM),
            _cell(status,  _W['status'],    _STATUS_COLOR.get(status, '')),
            msg,
        ]
        return '  '.join(cols)


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
