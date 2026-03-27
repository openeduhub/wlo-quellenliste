# ===========================================================
# Dockerfile: WLO Quellenverzeichnis – Backend
# -----------------------------------------------------------
# Enthält nur das FastAPI-Backend inkl. der vorgebauten
# Webkomponenten-Bundles (public/wc/).
#
# Vor dem Docker-Build die Webkomponente bauen + kopieren:
#   ./scripts/build-wc.sh   (Linux/macOS)
#   .\scripts\build-wc.ps1  (Windows)
# ===========================================================

FROM python:3.11-slim

WORKDIR /app

# Python-Abhängigkeiten installieren
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Backend-Code kopieren (inkl. public/wc/ mit vorgebauten Bundles)
COPY backend/ ./

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
