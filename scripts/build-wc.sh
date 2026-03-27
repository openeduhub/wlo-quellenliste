#!/usr/bin/env bash
# -----------------------------------------------------------
# build-wc.sh
# Baut die Angular-Webkomponente und kopiert die Bundles
# in das Backend-Verzeichnis (backend/public/wc/).
# -----------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WC_DIR="$ROOT_DIR/webcomponent"
DEST_DIR="$ROOT_DIR/backend/public/wc"

echo "=== WLO Webkomponente: Build ==="

# 1. Abhängigkeiten installieren (falls nötig)
if [ ! -d "$WC_DIR/node_modules" ]; then
  echo "→ npm ci ..."
  (cd "$WC_DIR" && npm ci)
fi

# 2. Produktions-Build (IIFE via Angular browser-Builder)
echo "→ ng build --configuration=production ..."
(cd "$WC_DIR" && npx ng build --configuration=production)

DIST_DIR="$WC_DIR/dist/wlosources-ng"

# 3. Prüfen ob Build erfolgreich war
if [ ! -f "$DIST_DIR/main.js" ]; then
  echo "FEHLER: Build-Ausgabe nicht gefunden in $DIST_DIR"
  exit 1
fi

# 4. In Backend kopieren
echo "→ Kopiere Bundles nach $DEST_DIR ..."
mkdir -p "$DEST_DIR"
cp "$DIST_DIR/main.js"     "$DEST_DIR/main.js"
cp "$DIST_DIR/polyfills.js" "$DEST_DIR/polyfills.js"
cp "$DIST_DIR/runtime.js"   "$DEST_DIR/runtime.js"
cp "$DIST_DIR/styles.css"   "$DEST_DIR/styles.css"

echo "=== Fertig! Dateien in $DEST_DIR ==="
ls -lh "$DEST_DIR"
