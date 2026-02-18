"""
Entry point for uvicorn. Use: uvicorn main:app --reload --port 5017
Ensure the venv is activated first: source venv/bin/activate
"""
from src.app import app

__all__ = ["app"]
