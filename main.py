"""
Root ASGI entrypoint for Google Cloud Buildpacks.

This module exposes ``app`` so that the Python webserver buildpack
can discover it as ``main:app`` when building from the monorepo root.

We delegate to the Agent Draft Service FastAPI app defined under
``Backend/agent-draft-service``.
"""

from __future__ import annotations

import sys
from pathlib import Path


def _load_agent_draft_app():
    """
    Load the FastAPI app from ``Backend/agent-draft-service/main.py``.

    The directory name contains a hyphen, so we cannot import it as a
    normal Python package. Instead, we temporarily add that directory
    to ``sys.path`` and import its ``main`` module, which exposes
    ``app``.
    """

    project_root = Path(__file__).resolve().parent
    service_root = project_root / "Backend" / "agent-draft-service"

    # Ensure the service directory is importable as top-level "main"
    if str(service_root) not in sys.path:
        sys.path.insert(0, str(service_root))

    from main import app as agent_app  # type: ignore[import,assignment]

    return agent_app


# ASGI app used by Gunicorn / Uvicorn (main:app)
app = _load_agent_draft_app()

