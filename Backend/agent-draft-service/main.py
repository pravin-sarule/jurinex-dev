"""ASGI entry point for Cloud Run / uvicorn.

Cloud Run: container listens on PORT (default 8080) at 0.0.0.0.
Local: uvicorn main:app --host 0.0.0.0 --port 8080

For CLI orchestrator, run: python orchestrator_cli.py
"""
from api.app import app
