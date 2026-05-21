"""
Gunicorn configuration for production.

Usage:
  gunicorn main:app -c gunicorn.conf.py

Environment variables that override these defaults:
  WORKERS        — number of worker processes (default: 4)
  PORT           — bind port (default: 8095)
  HOST           — bind host (default: 0.0.0.0)
  LOG_LEVEL      — logging level (default: info)
"""
import os

# ── Workers ────────────────────────────────────────────────────────────────────
# Each worker is an independent Python process with its own DB connection pool.
# Rule of thumb: (2 × CPU cores) + 1. Cloud Run 2-vCPU → 4–5 workers.
# With DB_POOL_MAX_SIZE=10, total DB connections per instance = workers × 10.
workers = int(os.getenv("WORKERS", "4"))
worker_class = "uvicorn.workers.UvicornWorker"

# ── Binding ────────────────────────────────────────────────────────────────────
host = os.getenv("HOST", "0.0.0.0")
port = os.getenv("PORT", "8095")
bind = f"{host}:{port}"

# ── Timeouts ───────────────────────────────────────────────────────────────────
# Gemini API calls can take up to 30 s. Worker timeout must be higher.
timeout = 120
graceful_timeout = 30
keepalive = 5

# ── Worker recycling (prevents memory leaks in long-running workers) ───────────
max_requests = 1000
max_requests_jitter = 100  # randomises restart time so workers don't all restart at once

# ── Logging ────────────────────────────────────────────────────────────────────
loglevel = os.getenv("LOG_LEVEL", "info").lower()
accesslog = "-"   # stdout
errorlog  = "-"   # stdout

# ── WebSocket (audio) support ──────────────────────────────────────────────────
# UvicornWorker handles WebSocket natively — no extra config needed.
# Each worker can serve many concurrent WebSocket connections via asyncio.
