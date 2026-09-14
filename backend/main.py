"""Vercel Services entrypoint. Local development still uses app.main:app."""

from app.main import app

__all__ = ["app"]
