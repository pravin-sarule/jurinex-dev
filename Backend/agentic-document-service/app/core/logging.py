"""
Rich console logger for agentic-document-service.

Every record renders as one aligned row. Metadata columns are fixed-width so the
eye can scan straight down them; the MESSAGE column is never truncated.

 TIME     │ LEVEL │ COMPONENT          │ MODEL                │ MESSAGE
 ─────────┼───────┼────────────────────┼──────────────────────┼──────────────
 11:43:35 │ INFO  │ DocumentAI         │ kimi-k2.6            │ ▶ Kimi stream  thinking=False  buffered=False
 11:43:36 │ INFO  │ → auth             │ —                    │ GET /api/auth/internal/user/65/firm-context → 200
 11:43:37 │ WARN  │ Embeddings         │ —                    │ text-embedding-004 returned 404 — blacklisting

Design goals, driven by what actually made the old output hard to read:
  • Nothing important gets truncated. Component/model columns are wide enough for
    real values ("gemini-3.5-flash-lite", "kimi-k2.7-code-highspeed") and adapt to
    the terminal width.
  • The FUNCTION column is HIDDEN by default. It was mostly noise
    ("send", "_send_single_reque…") and cost 22 columns that the message needed.
  • Redundancy is stripped. "📊 [TokenUsageService] Usage log request …" becomes
    "Usage log request …" because COMPONENT already says TokenUsageService.
  • Outbound HTTP collapses to one scannable line, with localhost ports resolved to
    service names (5001 → auth, 5003 → payment, …).
  • Pure noise (CORS preflights, google-genai "AFC is enabled", watchfiles reload
    chatter) is filtered out unless you ask for it.

Everything is tunable from .env — see _ENV_DOC at the bottom of this module.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import sys
import time
from typing import Any

# ── ANSI palette ───────────────────────────────────────────────────────────────
_R = '\x1b[0m'
_BOLD = '\x1b[1m'

_LEVEL_STYLE = {
    'DEBUG':    '\x1b[38;5;244m',    # grey
    'INFO':     '\x1b[38;5;44m',     # teal
    'WARNING':  '\x1b[1;38;5;214m',  # bold orange
    'ERROR':    '\x1b[1;38;5;203m',  # bold red
    'CRITICAL': '\x1b[1;97;41m',     # white on red
}
_LEVEL_SHORT = {'DEBUG': 'DEBUG', 'INFO': 'INFO', 'WARNING': 'WARN', 'ERROR': 'ERROR', 'CRITICAL': 'CRIT'}

_MSG_STYLE = {
    'failed':     '\x1b[38;5;203m',  # red
    'completed':  '\x1b[38;5;78m',   # green
    'processing': '',                 # plain — most lines are this; colouring them all is noise
    'info':       '',
}

_MODEL_COLOR = '\x1b[38;5;177m'   # violet
_COMP_COLOR  = '\x1b[38;5;75m'    # blue
_NET_COLOR   = '\x1b[38;5;108m'   # muted green (outbound HTTP component)
_DIM         = '\x1b[38;5;240m'   # dark grey
_KEY_COLOR   = '\x1b[38;5;245m'   # grey — key= part of key=value
_VAL_COLOR   = '\x1b[38;5;252m'   # near-white — the value
_HEADER      = '\x1b[1;38;5;253m'

_STATUS_COLOR = {2: '\x1b[38;5;78m', 3: '\x1b[38;5;44m', 4: '\x1b[38;5;214m', 5: '\x1b[38;5;203m'}


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {'1', 'true', 't', 'yes', 'y', 'on'}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, '') or default)
    except (TypeError, ValueError):
        return default


def _supports_color() -> bool:
    if not _env_bool('LOG_COLOR', True):
        return False
    if os.environ.get('NO_COLOR') is not None:
        return False
    return hasattr(sys.stderr, 'isatty') and sys.stderr.isatty()


def _enable_windows_vt() -> None:
    """Turn on ANSI escape processing for legacy Windows consoles (no-op elsewhere)."""
    if sys.platform != 'win32':
        return
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        # -11 = STD_OUTPUT_HANDLE, -12 = STD_ERROR_HANDLE; 0x4 = ENABLE_VIRTUAL_TERMINAL_PROCESSING
        for handle_id in (-11, -12):
            handle = kernel32.GetStdHandle(handle_id)
            mode = ctypes.c_uint32()
            if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                kernel32.SetConsoleMode(handle, mode.value | 0x4)
    except Exception:
        pass


# ── Localhost port → service name, so outbound calls read as words not numbers ──
_SERVICE_BY_PORT = {
    '3000': 'translation', '4000': 'draft', '5000': 'gateway', '5001': 'auth',
    '5003': 'payment', '5004': 'support', '5005': 'drafting', '5006': 'zoho',
    '5007': 'chatmodel', '5017': 'tmpl-analyzer', '5173': 'frontend',
    '8000': 'agent-draft', '8002': 'citation', '8003': 'citation-test',
    '8004': 'citation-v1', '8005': 'judgement', '8010': 'chat-draft',
    '8081': 'visual', '8092': 'document', '8095': 'ai-chatbot', '8096': 'chat',
}

# Upstream AI/vendor hosts, so a provider call reads as its provider name.
_EXTERNAL_HOSTS = {
    'api.moonshot.ai': 'moonshot',
    'api.moonshot.cn': 'moonshot',
    'api.anthropic.com': 'anthropic',
    'api.deepseek.com': 'deepseek',
    'api.openai.com': 'openai',
    'generativelanguage.googleapis.com': 'google-ai',
    'documentai.googleapis.com': 'document-ai',
    'storage.googleapis.com': 'gcs',
    'google.serper.dev': 'serper',
}

# ── Regex extractors ─────────────────────────────────────────────────────────
_COMPONENT_RE = re.compile(r'\[([A-Za-z][^\]]{1,35})\]')
# Recognises every provider this service can route to. `kimi`/`moonshot` were missing
# before, which is why Kimi calls logged a blank MODEL column.
# A real model id always separates the family from the version with '-' or '.'
# (kimi-k2.6, gemini-3.5-flash-lite). Requiring that separator stops internal
# identifiers like "kimi_stream" / "deepseek_generate" being mistaken for models.
_MODEL_RE = re.compile(
    r'\b((?:gemini|gemma|claude|deepseek|kimi|moonshot|gpt)[-.][\w.-]+)',
    re.IGNORECASE,
)
# `model_id=` matters for the Kimi/DeepSeek adapters, which log the resolved id that way.
_KV_MODEL_RE = re.compile(r'(?:llm_model|raw_llm_model|model_id|model_name|model)=([A-Za-z][^\s,;|]+)')

# uvicorn access:  127.0.0.1:64646 - "GET /path HTTP/1.1" 200
_ACCESS_RE = re.compile(r'(?:(\S+?)\s+-\s+)?"(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+(\S+)\s+HTTP/\S+"\s+(\d{3})')
# httpx:  HTTP Request: GET http://host:port/path "HTTP/1.1 200 OK"
_HTTPX_RE = re.compile(
    r'HTTP Request:\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+(\S+)\s+"HTTP/[\d.]+\s+(\d{3})[^"]*"'
)
_URL_RE = re.compile(r'^https?://([^/]+)(/.*)?$')

# Leading emoji / symbol decoration. Kept narrow (non-ASCII only) so it never eats
# an ASCII banner like "=== TOKEN USAGE ===".
_LEAD_DECOR_RE = re.compile(r'^(?:\s|[^\x00-\x7F])+')
_LEAD_TAGS_RE = re.compile(r'^\s*(?:\[[\w\s:/_\-.]{1,50}\]\s*)+')
_KV_RE = re.compile(r'(?<![\w=])([A-Za-z_][\w.]*)=([^\s|]+)')

# Friendlier component names for loggers whose dotted name reads badly.
_LOGGER_ALIAS = {
    'uvicorn': 'uvicorn',
    'uvicorn.error': 'uvicorn',
    'uvicorn.access': 'uvicorn',
    'uvicorn.lifespan': 'uvicorn',
    'uvicorn.lifespan.on': 'uvicorn',
    'httpx': 'http',
    'httpcore': 'http',
    'main': 'startup',
}

_DONE_KW = ('complete', 'success', 'ready', 'done', 'loaded', 'finish', ' ok', 'mounted',
            'repaired', 'passed', 'allowed')
_FAIL_KW = ('fail', 'error', 'exception', 'traceback', 'abort', 'invalid', 'denied',
            'timeout', '404', '403', '401', '500')
_PROC_KW = ('start', 'creat', 'submit', 'upload', 'process', 'running', 'fetch', 'download',
            'detect', 'build', 'poll', 'scan', 'ocr', 'generat', 'connect', 'received')

# Lines that carry no diagnostic value and drown everything else.
_NOISE_PATTERNS = (
    'AFC is enabled with max remote calls',   # google-genai, emitted once per generate_content
)


class _State:
    """Resolved config + render widths. Populated by configure_logging()."""
    color = True
    show_function = False
    show_options = False
    show_http_client = True
    widths: dict[str, int] = {'time': 8, 'level': 5, 'component': 18, 'function': 19, 'model': 22}
    prefix_len = 0


_S = _State()


def _compute_widths() -> None:
    """Size the metadata columns to the terminal, leaving the message room to breathe."""
    try:
        term = shutil.get_terminal_size(fallback=(140, 40)).columns
    except Exception:
        term = 140
    term = _env_int('LOG_WIDTH', term)

    if term < 100:
        comp, model = 14, 16
    elif term < 130:
        comp, model = 16, 20
    else:
        comp, model = 22, 24

    _S.widths = {'time': 8, 'level': 5, 'component': comp, 'function': 19, 'model': model}
    cols = ['time', 'level', 'component'] + (['function'] if _S.show_function else []) + ['model']
    # each column is followed by " │ " (3 chars)
    _S.prefix_len = sum(_S.widths[c] for c in cols) + 3 * len(cols)


_ANSI_WIDTH_RE = re.compile(r'\x1b\[[0-9;]*m')


def _visible_len(text: str) -> int:
    return len(_ANSI_WIDTH_RE.sub('', text or ''))


def log_message_width() -> int:
    """Columns left for MESSAGE after TIME/LEVEL/COMPONENT/MODEL.

    ASCII tables must stay within this width or the terminal wraps them and
    the borders fall apart.
    """
    try:
        term = shutil.get_terminal_size(fallback=(120, 40)).columns
    except Exception:
        term = 120
    term = _env_int('LOG_WIDTH', term)
    prefix = _S.prefix_len or (8 + 5 + 16 + 20 + 12)
    return max(40, term - prefix - 1)


def _continuation_indent(msg: str) -> int:
    """Pad wrapped log lines under MESSAGE, unless that would make a table wrap."""
    indent = _S.prefix_len
    try:
        term = shutil.get_terminal_size(fallback=(140, 40)).columns
    except Exception:
        term = 140
    term = _env_int('LOG_WIDTH', term)
    rest = (msg or '').split('\n')[1:]
    if not rest:
        return indent
    widest = max(_visible_len(line) for line in rest)
    if indent + widest >= term:
        return 0
    return indent


def _paint(text: str, color: str) -> str:
    return f'{color}{text}{_R}' if (color and _S.color) else text


def _cell(text: Any, width: int, color: str = '') -> str:
    t = str(text) if text not in (None, '') else '—'
    if len(t) > width:
        t = t[: width - 1] + '…'
    return _paint(t.ljust(width), color)


def _bar() -> str:
    return _paint('│', _DIM)


def _shorten_url(url: str) -> tuple[str, str]:
    """('→ auth', '/api/auth/internal/...') — resolve hosts to readable service names."""
    m = _URL_RE.match(url)
    if not m:
        return '→ http', url
    host, path = m.group(1), m.group(2) or '/'
    if host.startswith(('localhost:', '127.0.0.1:')):
        port = host.split(':', 1)[1]
        return f'→ {_SERVICE_BY_PORT.get(port, port)}', path

    bare = host.split(':')[0].lower()
    known = _EXTERNAL_HOSTS.get(bare)
    if known:
        return f'→ {known}', path
    # Drop a leading "api."/"www." so api.example.com reads as "example", not "api".
    labels = [p for p in bare.split('.') if p not in ('api', 'www')]
    return f'→ {labels[0] if labels else bare}', path


def _status_color(code: int) -> str:
    return _STATUS_COLOR.get(code // 100, '')


def _highlight_kv(msg: str) -> str:
    """Dim the `key=` and brighten the value, so key/value pairs scan at a glance."""
    if not _S.color:
        return msg

    def sub(m: re.Match) -> str:
        return f'{_KEY_COLOR}{m.group(1)}={_R}{_VAL_COLOR}{m.group(2)}{_R}'

    return _KV_RE.sub(sub, msg)


def _clean_message(msg: str) -> str:
    """Drop leading emoji and [Bracket] tags — COMPONENT already carries that name."""
    stripped = _LEAD_DECOR_RE.sub('', msg)
    stripped = _LEAD_TAGS_RE.sub('', stripped)
    return stripped.strip() or msg.strip()


def _extract(record: logging.LogRecord, msg: str, raw: str) -> dict[str, Any]:
    """`msg` is the cleaned message shown to the user; `raw` still carries the [Tag]s."""
    lower = msg.lower()
    out: dict[str, Any] = {'component': None, 'model': '—', 'status': 'info', 'message': msg}

    # ── Outbound HTTP (httpx) → "→ auth   GET /path → 200"
    hx = _HTTPX_RE.search(msg)
    if hx:
        method, url, code = hx.group(1), hx.group(2), int(hx.group(3))
        comp, path = _shorten_url(url)
        out['component'] = comp
        out['component_color'] = _NET_COLOR
        arrow = _paint('→', _DIM)
        out['message'] = f'{method} {path} {arrow} {_paint(str(code), _status_color(code))}'
        out['status'] = 'failed' if code >= 400 else 'info'
        out['plain'] = True
        return out

    # ── Inbound HTTP (uvicorn access) → "GET /path → 200"
    ac = _ACCESS_RE.search(msg)
    if ac:
        method, path, code = ac.group(2), ac.group(3), int(ac.group(4))
        out['component'] = f'{method}'
        out['component_color'] = _NET_COLOR
        arrow = _paint('→', _DIM)
        out['message'] = f'{path} {arrow} {_paint(str(code), _status_color(code))}'
        out['status'] = 'failed' if code >= 400 else 'info'
        out['plain'] = True
        return out

    # ── Component: first [Bracket] of the ORIGINAL message (it has been stripped from
    # `msg` by then), else the last dotted segment of the logger name.
    comp_m = _COMPONENT_RE.search(raw)
    if comp_m:
        out['component'] = comp_m.group(1)
    else:
        parts = record.name.split('.')
        fallback = parts[-1] if len(parts) > 1 else record.name
        # `uvicorn.error` carries ordinary startup INFO — showing "error" as the
        # component made healthy boot lines look like failures.
        out['component'] = _LOGGER_ALIAS.get(record.name, fallback)

    # ── Model
    kv = _KV_MODEL_RE.search(msg)
    if kv:
        out['model'] = kv.group(1)
    else:
        m = _MODEL_RE.search(msg)
        if m:
            out['model'] = m.group(1)

    if any(w in lower for w in _FAIL_KW):
        out['status'] = 'failed'
    elif any(w in lower for w in _DONE_KW):
        out['status'] = 'completed'
    elif any(w in lower for w in _PROC_KW):
        out['status'] = 'processing'
    return out


class NoiseFilter(logging.Filter):
    """Drops records that add volume without information."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True

        if not _S.show_options and '"OPTIONS ' in msg:
            return False
        if not _S.show_http_client and 'HTTP Request:' in msg:
            return False
        return all(p not in msg for p in _NOISE_PATTERNS)


class RichFormatter(logging.Formatter):
    """One aligned, colourised row per record. Message is never truncated."""

    _header_printed = False

    @classmethod
    def reset_header(cls) -> None:
        cls._header_printed = False

    def _print_header(self) -> None:
        if RichFormatter._header_printed:
            return
        RichFormatter._header_printed = True
        w = _S.widths
        cols = [('TIME', 'time'), ('LEVEL', 'level'), ('COMPONENT', 'component')]
        if _S.show_function:
            cols.append(('FUNCTION', 'function'))
        cols.append(('MODEL', 'model'))

        head = [_cell(label, w[key], _HEADER) for label, key in cols]
        head.append(_paint('MESSAGE', _HEADER))
        print(f' {_bar()} '.join(head), file=sys.stderr)

        segs = [w[key] for _, key in cols]
        divider = '─┼─'.join('─' * s for s in segs) + '─┼─' + '─' * 14
        print(_paint(divider, _DIM), file=sys.stderr)

    def format(self, record: logging.LogRecord) -> str:
        try:
            return self._format(record)
        except Exception:
            # A logging bug must never take the service down.
            try:
                return f'{time.strftime("%H:%M:%S")} {record.levelname} {record.getMessage()}'
            except Exception:
                return str(record.msg)

    def _format(self, record: logging.LogRecord) -> str:
        self._print_header()

        raw = record.getMessage()
        cleaned = _clean_message(raw)
        fields = _extract(record, cleaned, raw)
        w = _S.widths

        msg = fields['message']
        multiline = '\n' in msg
        if not fields.get('plain') and not multiline:
            msg = _highlight_kv(msg)
            style = _MSG_STYLE.get(fields['status'], '')
            if style and fields['status'] in ('failed', 'completed'):
                msg = _paint(msg, style)

        # Align continuation lines (token-usage tables, tracebacks) under MESSAGE.
        # If the block is wider than the remaining columns, indent 0 so ASCII
        # tables stay aligned instead of wrapping mid-border.
        if multiline:
            msg = msg.replace('\n', '\n' + ' ' * _continuation_indent(msg))

        level = record.levelname
        model = fields['model']
        cells = [
            _cell(time.strftime('%H:%M:%S', time.localtime(record.created)), w['time'], _DIM),
            _cell(_LEVEL_SHORT.get(level, level), w['level'], _LEVEL_STYLE.get(level, '')),
            _cell(fields['component'], w['component'], fields.get('component_color', _COMP_COLOR)),
        ]
        if _S.show_function:
            cells.append(_cell(record.funcName or '—', w['function'], _DIM))
        cells.append(_cell(model, w['model'], _MODEL_COLOR if model != '—' else _DIM))
        cells.append(msg)

        line = f' {_bar()} '.join(cells)
        if record.exc_info:
            line += '\n' + self.formatException(record.exc_info)
        return line


# Third-party loggers that are chatty at INFO and rarely useful.
_QUIET_LOGGERS = {
    'httpcore': logging.WARNING,
    'urllib3': logging.WARNING,
    'watchfiles': logging.WARNING,       # --reload spams "N changes detected"
    'watchfiles.main': logging.WARNING,
    'google_genai.models': logging.WARNING,
    'google.adk': logging.WARNING,
    'asyncio': logging.WARNING,
    'multipart': logging.WARNING,
    'PIL': logging.WARNING,
}


def configure_logging(level: str) -> None:
    resolved_level = getattr(logging, str(level).upper(), logging.INFO)

    _enable_windows_vt()
    _S.color = _supports_color()
    _S.show_function = _env_bool('LOG_SHOW_FUNCTION', False)
    _S.show_options = _env_bool('LOG_SHOW_OPTIONS', False)
    _S.show_http_client = _env_bool('LOG_HTTP_CLIENT', True)
    _compute_widths()
    RichFormatter.reset_header()

    handler = logging.StreamHandler(sys.stderr)
    handler.setLevel(resolved_level)
    handler.setFormatter(RichFormatter())
    handler.addFilter(NoiseFilter())

    root = logging.getLogger()
    root.setLevel(resolved_level)
    for h in root.handlers[:]:
        root.removeHandler(h)
    root.addHandler(handler)

    # Attach to uvicorn/fastapi loggers and clear their own handlers so uvicorn's
    # default "INFO:     " formatter never reaches the console.
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
        lg.propagate = True
        for h in lg.handlers[:]:
            lg.removeHandler(h)

    for name, lvl in _QUIET_LOGGERS.items():
        logging.getLogger(name).setLevel(max(lvl, resolved_level))

    # httpx stays at the configured level when LOG_HTTP_CLIENT is on (the NoiseFilter
    # drops its lines otherwise), so outbound calls remain visible but compact.
    logging.getLogger('httpx').setLevel(resolved_level if _S.show_http_client else logging.WARNING)


_ENV_DOC = """
Console-logging environment variables (all optional):

  LOG_LEVEL            DEBUG | INFO | WARNING | ERROR      (read by app.core.config)
  LOG_COLOR            true  — set false (or NO_COLOR=1) for plain text / piping to a file
  LOG_SHOW_FUNCTION    false — add the FUNCTION column back
  LOG_SHOW_OPTIONS     false — show CORS preflight ("OPTIONS …") request lines
  LOG_HTTP_CLIENT      true  — show outbound httpx calls (compact, one line each)
  LOG_WIDTH            auto  — override detected terminal width used for column sizing
"""
