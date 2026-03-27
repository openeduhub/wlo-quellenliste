"""
api/index.py
------------
Vercel Serverless Entry Point.

Importiert die FastAPI-App aus main.py und stellt sie als
Vercel-kompatible ASGI-App bereit.

Lokale Entwicklung: ``uvicorn main:app --reload --port 8080``
Vercel:             automatisch über vercel.json geroutet
"""

import sys
from pathlib import Path

# Projektverzeichnis (eine Ebene über api/) zum Python-Pfad hinzufügen,
# damit main.py, jobs.py, fetcher.py etc. importierbar sind.
_project_root = str(Path(__file__).resolve().parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from main import app  # noqa: F401, E402 — Vercel erkennt die ASGI-App über diesen Import

