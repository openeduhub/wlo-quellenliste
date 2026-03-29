# WLO Quellenverzeichnis

Vollständiges **Quellenverzeichnis für [WirLernenOnline (WLO)](https://wirlernenonline.de/)**.

Das Projekt besteht aus zwei Teilen:

1. **Backend** (`backend/`) – eine FastAPI-Anwendung (Python), die Quellendaten aus der WLO edu-sharing-Instanz abruft, mit einer redaktionellen Korrekturliste zusammenführt und als REST-API bereitstellt.
2. **Webkomponente** (`webcomponent/`) – eine Angular 18 Anwendung, die als Custom Element `<wlo-sources>` gebaut wird und in beliebige Webseiten eingebettet werden kann. Sie kommuniziert mit dem Backend und zeigt das Quellenverzeichnis als Kachel-, Listen- oder Statistikansicht.

Die gebauten Bundles der Webkomponente (JS/CSS) werden in `backend/public/wc/` abgelegt und vom Backend als statische Dateien ausgeliefert. Das **Docker-Image enthält nur das Backend** mit den vorgebauten Bundles – kein Node.js, kein Angular-Quellcode.

---

## Projektstruktur

```
wlo-quellenliste/
│
├── backend/                    # FastAPI-Backend (Python)
│   ├── main.py                 # API-Anwendung mit allen Endpoints
│   ├── merger.py               # Daten-Merge: WLO-API + Korrekturliste → Gesamtdatensatz
│   ├── fetcher.py              # WLO edu-sharing REST-API Fetcher
│   ├── jobs.py                 # Hintergrund-Jobs für Datenaktualisierung
│   ├── stats.py                # Statistik-Berechnung über den Gesamtdatensatz
│   ├── requirements.txt        # Python-Abhängigkeiten
│   ├── data/                   # Persistente Daten
│   │   ├── quellen_korrektur.csv   # Redaktionelle Korrekturliste (Whitelist/Blacklist)
│   │   ├── quellen_merged.json     # Zusammengeführter Gesamtdatensatz
│   │   └── quellen_stats.json      # Berechnete Statistiken
│   ├── public/                 # Statische Dateien
│   │   ├── wc/                 # ← Gebaute Webkomponenten-Bundles (main.js, polyfills.js, …)
│   │   └── example.html        # Einbettungs-Beispielseite
│   ├── api/                    # Vercel Serverless Entry-Point
│   └── vercel.json             # Vercel-Deployment-Konfiguration
│
├── webcomponent/               # Angular 18 Webkomponente (Quellcode)
│   ├── src/                    # Angular-Quellcode
│   │   ├── main.ts             # Entry-Point: Custom Element „wlo-sources" registrieren
│   │   └── app/                # Komponenten, Services, Models
│   ├── angular.json            # Build-Konfiguration (browser-Builder → IIFE-Bundle)
│   ├── package.json            # Node-Abhängigkeiten
│   └── proxy.conf.json         # Proxy für ng serve (→ edu-sharing + lokales Backend)
│
├── scripts/
│   ├── build-wc.sh             # Build-Skript (Linux/macOS): WC bauen + ins Backend kopieren
│   └── build-wc.ps1            # Build-Skript (Windows/PowerShell)
│
├── Dockerfile                  # Docker-Image (nur Backend + vorgebaute Bundles)
├── docker-compose.yml          # Docker Compose für lokalen Start
│
└── .github/
    └── workflows/
        └── docker.yml          # CI: WC bauen → Docker Build → Push zu DockerHub
```

---

## Voraussetzungen

| Tool | Version | Wofür |
|------|---------|-------|
| Python | 3.11+ | Backend |
| Node.js | 18+ | Webkomponente bauen |
| npm | 9+ | Webkomponente bauen |
| Docker | (optional) | Container-Deployment |

---

## Schnellstart

### 1. Webkomponente bauen und ins Backend kopieren

```bash
./scripts/build-wc.sh
```

Windows (PowerShell):
```powershell
.\scripts\build-wc.ps1
```

Das Skript führt automatisch folgende Schritte aus:
1. `npm ci` in `webcomponent/` (falls `node_modules/` fehlt)
2. `ng build --configuration=production` → erzeugt IIFE-Bundles in `webcomponent/dist/wlosources-ng/`
3. Kopiert `main.js`, `polyfills.js`, `runtime.js`, `styles.css` nach `backend/public/wc/`

### 2. Backend starten

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

- **API-Dokumentation (Swagger):** http://localhost:8080/docs
- **Beispielseite mit Webkomponente:** http://localhost:8080/public/example.html

### 3. Daten aktualisieren

Beim ersten Start oder nach Änderungen an der Korrekturliste:

```bash
curl -X POST http://localhost:8080/jobs/refresh
```

Der Job ruft die WLO edu-sharing API ab, führt die Daten mit der Korrekturliste zusammen und berechnet Statistiken neu.

### 4. API-Key-Schutz (optional)

Schreibende Endpoints (`POST /jobs/refresh`, `POST /correction-list`) können
über die Umgebungsvariable `WLO_API_KEY` geschützt werden:

```bash
# Linux/macOS
export WLO_API_KEY="mein-geheimer-schluessel"

# Windows PowerShell
$env:WLO_API_KEY = "mein-geheimer-schluessel"

# Docker
docker run -p 8080:8080 -e WLO_API_KEY="mein-geheimer-schluessel" wlo-quellenliste
```

Den Key als `X-API-Key`-Header oder `?api_key=…` Query-Parameter mitgeben:

```bash
curl -X POST -H "X-API-Key: mein-geheimer-schluessel" http://localhost:8080/jobs/refresh
```

> Ist `WLO_API_KEY` nicht gesetzt, sind alle Endpoints frei zugänglich.
> Lesende Endpoints (GET) sind immer öffentlich.

Für Vercel: In *Settings → Environment Variables* die Variable `WLO_API_KEY` anlegen.

---

## Webkomponente entwickeln und integrieren

### Entwicklungsserver

```bash
cd webcomponent
npm ci                    # einmalig
npm start                 # startet ng serve auf Port 4251
```

Dabei muss das Backend parallel auf Port 8080 laufen. Die `proxy.conf.json` leitet API-Aufrufe (`/api/…`) und edu-sharing-Anfragen (`/edu-sharing/…`) automatisch weiter.

### Änderungen in die API übernehmen

Nach Änderungen am Angular-Quellcode müssen die neuen Bundles ins Backend kopiert werden:

```bash
# Vom Projekt-Root aus:
./scripts/build-wc.sh          # Linux/macOS
.\scripts\build-wc.ps1         # Windows
```

**Was passiert dabei:**
1. Angular baut die Webkomponente als **IIFE-Bundle** (kein ES-Module, keine `export`-Statements → funktioniert mit normalem `<script>`-Tag)
2. Die vier Ausgabedateien werden nach `backend/public/wc/` kopiert:
   - `main.js` (~286 kB) – Hauptbundle mit allen Angular-Komponenten
   - `polyfills.js` (~35 kB) – Browser-Polyfills
   - `runtime.js` (~1 kB) – Webpack-Runtime
   - `styles.css` – Globale Styles
3. Das Backend liefert diese Dateien unter `/wc/` als statische Assets aus

**Wichtig:** Die Bundles in `backend/public/wc/` werden ins Git-Repository eingecheckt, damit das Docker-Image und Vercel-Deployments immer einen funktionierenden Stand haben – auch ohne Node.js-Build.

### Warum IIFE und nicht ES-Module?

Die Webkomponente wird als **IIFE** (Immediately Invoked Function Expression) gebaut, nicht als ES-Module. So kann sie mit einem einfachen `<script src="…">` Tag geladen werden, ohne `type="module"`. Das vermeidet `Unexpected token 'export'`-Fehler und funktioniert in allen Einbettungsszenarien.

Die Build-Konfiguration steht in `webcomponent/angular.json`:
- Builder: `@angular-devkit/build-angular:browser` (nicht `application`)
- Output-Hashing: `none` (stabile Dateinamen)

---

## API-Endpoints

### Jobs (Datenaktualisierung)

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| `POST` | `/jobs/refresh` | Neuen Daten-Refresh starten ¹ |
| `GET` | `/jobs` | Letzte Jobs auflisten |
| `GET` | `/jobs/latest` | Status des letzten Jobs |
| `GET` | `/jobs/{job_id}` | Status eines bestimmten Jobs |

### Daten & Export

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| `GET` | `/data/stats` | Statistiken (JSON) |
| `GET` | `/data/sources` | Gefilterte + paginierte Quellenliste |
| `GET` | `/data/sources/{name}` | Einzelne Quelle per Name |
| `GET` | `/data/export/csv` | Gesamtdatensatz als CSV (Semikolon-getrennt) |
| `GET` | `/data/export/meta.json` | Metadaten-Map (kompatibel mit Webkomponente) |
| `GET` | `/data/export/counts.json` | Inhaltszahlen-Map |

### Korrekturliste

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| `GET` | `/correction-list` | Aktuelle Korrekturtabelle herunterladen |
| `POST` | `/correction-list` | Neue Korrekturtabelle hochladen (CSV) ¹ |
| `GET` | `/correction-list/template` | Leere CSV-Vorlage |

> ¹ Geschützt durch `WLO_API_KEY` (wenn gesetzt). Siehe [API-Key-Schutz](#4-api-key-schutz-optional).

### Webkomponente

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| `GET` | `/wc/info` | Einbettungs-Infos, Dateien, Attribute |

---

## Webkomponente einbetten

```html
<!-- 1. Bundles laden -->
<script src="https://YOUR-DOMAIN/wc/runtime.js"></script>
<script src="https://YOUR-DOMAIN/wc/polyfills.js"></script>
<script src="https://YOUR-DOMAIN/wc/main.js"></script>
<link rel="stylesheet" href="https://YOUR-DOMAIN/wc/styles.css">

<!-- 2. Komponente einbetten -->
<wlo-sources
  api-base="https://YOUR-DOMAIN"
  view="tile"
  min-count="5"
></wlo-sources>
```

### Konfigurierbare Attribute

| Attribut | Typ | Default | Beschreibung |
|----------|-----|---------|-------------|
| `api-base` | string | `""` | API-URL (leer = gleicher Origin) |
| `view` | string | `"tile"` | Startansicht: `tile`, `list` oder `stats` |
| `min-count` | number | `5` | Nur Quellen mit mind. N Inhalten anzeigen |
| `primary-color` | color | `#003b7c` | Hauptfarbe (Header, Badges, Buttons) |
| `secondary-color` | color | `#002d5f` | Sekundärfarbe |
| `accent-color` | color | `#f97316` | Akzentfarbe (Highlights) |
| `bg-color` | color | `#f4f7fc` | Hintergrundfarbe |
| `card-bg` | color | `#ffffff` | Kartenfarbe |
| `text-color` | color | `#12213a` | Textfarbe |

---

## Deployment

### Vercel

Das Backend enthält eine fertige `vercel.json`. Statische Dateien (`/wc/*`, `/example.html`) werden via Rewrites aus `public/` serviert, alle anderen Anfragen gehen an die FastAPI-Serverless-Function.

### Docker

Das Docker-Image enthält **nur das Backend** (Python 3.11) mit den vorgebauten JS-Bundles – kein Node.js, kein Angular-Quellcode (~150 MB).

```bash
# 1. Webkomponente bauen (falls noch nicht geschehen)
./scripts/build-wc.sh

# 2. Docker-Image bauen und starten
docker compose up --build
```

Oder manuell:
```bash
docker build -t wlo-quellenliste .
docker run -p 8080:8080 wlo-quellenliste
```

### GitHub Actions (CI/CD)

Der Workflow `.github/workflows/docker.yml` läuft bei jedem Push auf `main`:

1. **Checkout** des Repositories
2. **Node.js 18** aufsetzen + `npm ci`
3. **`ng build`** der Webkomponente → Bundles nach `backend/public/wc/`
4. **Docker Build** (nur `backend/` Ordner → schlankes Python-Image)
5. **Push** zu DockerHub

**Voraussetzung:** Das Repository-Secret `DOCKERHUB_PASSWORD` muss konfiguriert sein (Settings → Secrets and variables → Actions).

---

## Datenfluss

```
┌─────────────────┐     ┌───────────────┐     ┌──────────────┐
│  WLO edu-sharing │────▶│   fetcher.py  │────▶│  merger.py   │
│  REST-API        │     │  (API-Abruf)  │     │  (Merge +    │
└─────────────────┘     └───────────────┘     │  Deduplizier.)│
                                               └──────┬───────┘
┌─────────────────┐                                   │
│  quellen_       │───────────────────────────────────▶│
│  korrektur.csv  │  (Whitelist / Blacklist)           │
└─────────────────┘                                   ▼
                                            ┌──────────────────┐
                                            │ quellen_merged    │
                                            │ .json             │
                                            └────────┬─────────┘
                                                     │
                                    ┌────────────────┼────────────────┐
                                    ▼                ▼                ▼
                             ┌────────────┐  ┌─────────────┐  ┌───────────┐
                             │ /data/     │  │ /data/stats │  │ stats.py  │
                             │ sources    │  │             │  │ (Berechn.)│
                             └────────────┘  └─────────────┘  └───────────┘
```

Die **Korrekturliste** (`data/quellen_korrektur.csv`) erlaubt redaktionelle Eingriffe:
- **Whitelist** – Quellen erzwingen (auch wenn sie unter dem Min-Count liegen)
- **Blacklist** – Quellen ausschließen
- **Umbenennung** – Anzeigenamen überschreiben

---

## Lizenz

MIT
