# WLO Quellenverzeichnis API

FastAPI-Backend für das WLO-Quellenverzeichnis. Ruft Quellendaten von der
WLO-Produktion ab, führt sie über eine 7-stufige Matching-Kaskade zusammen
und liefert sie als JSON-API aus.

Die API bündelt außerdem die **vorkompilierte `<wlo-sources>` Webkomponente**
(Angular 18 Custom Element), sodass Dritte das Quellenverzeichnis per
`<script>`-Tag in beliebige Webseiten einbetten können – ohne eigenen
Build-Prozess.

---

## 1. Installation & Lokaler Start

**Voraussetzungen:** Python ≥ 3.10

```bash
# Abhängigkeiten installieren
pip install -r requirements.txt

# Server starten
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

`requirements.txt` enthält:
```
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
requests>=2.31.0
pandas>=2.0.0
python-multipart>=0.0.9
```

Nach dem Start:

| URL | Beschreibung |
|-----|-------------|
| http://localhost:8080/docs | Swagger-UI (interaktive API-Dokumentation) |
| http://localhost:8080/public/example.html | Demo-Seite der Webkomponente |
| http://localhost:8080/wc/main.js | Kompiliertes Web-Component-Bundle |

### Erster Datenabruf

Beim ersten Start sind noch keine Daten vorhanden. Einmalig ausführen:

```bash
curl -X POST http://localhost:8080/jobs/refresh
```

Der Job läuft im Hintergrund (2–5 Min). Fortschritt prüfen:

```bash
curl http://localhost:8080/jobs/latest
```

---

## 2. Vercel-Deployment

```bash
npm i -g vercel    # einmalig
vercel --prod
```

Die `vercel.json` routet:
- `/wc/*` → statische Web-Component-Dateien mit CORS-Headern (`Access-Control-Allow-Origin: *`)
- `/example.html` und `/example` → öffentliche Demo-Seite
- Alles andere → FastAPI-App (`api/index.py`)

> **Vercel-Besonderheiten:**
> - Das Dateisystem ist read-only. Die API schreibt automatisch nach `/tmp/data/`
>   und kopiert beim Cold-Start vorhandene Dateien (z.B. `quellen_korrektur.csv`)
>   aus dem Deploy-Bundle dorthin.
> - Hintergrund-Threads werden nach der Response beendet. Daher erkennt die API
>   die Umgebungsvariable `VERCEL` und führt `POST /jobs/refresh` automatisch
>   **synchron** aus (blockierend, Response erst nach Abschluss).
> - `maxDuration` ist auf 300s gesetzt (erfordert **Pro-Plan**; Hobby: max 60s).
> - `/tmp/` wird bei jedem Cold-Start geleert. Für dauerhaft verfügbare Daten:
>   Job lokal ausführen und `data/quellen_merged.json` + `data/quellen_stats.json`
>   mit deployen.

**Produktions-URL:** `https://wlo-quellenliste-api.vercel.app`

---

## 3. Integrierte Webkomponente

Die API liefert unter `/wc/` eine **vorkompilierte Angular-Webkomponente** aus,
die aus dem Projekt `wlosources-ng` gebaut wird. Sie besteht aus drei Dateien:

| Datei | Größe | Beschreibung |
|-------|-------|-------------|
| `/wc/main.js` | ~291 kB | Webkomponente (Angular 18 Custom Element) |
| `/wc/polyfills.js` | ~35 kB | Zone.js Polyfills |
| `/wc/styles.css` | < 1 kB | Globale Styles |

Alle drei Dateien werden mit `Access-Control-Allow-Origin: *` ausgeliefert,
sodass sie von beliebigen Domains per `<script>` eingebunden werden können.

### Vollständiges Minimalbeispiel (copy & paste)

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WLO Quellenverzeichnis</title>
  <script src="https://wlo-quellenliste-api.vercel.app/wc/polyfills.js"></script>
  <script src="https://wlo-quellenliste-api.vercel.app/wc/main.js"></script>
  <link rel="stylesheet" href="https://wlo-quellenliste-api.vercel.app/wc/styles.css">
</head>
<body>
  <wlo-sources api-base="https://wlo-quellenliste-api.vercel.app"></wlo-sources>
</body>
</html>
```

### Mit Konfiguration

```html
<wlo-sources
  api-base="https://wlo-quellenliste-api.vercel.app"
  view="tile"
  min-count="5"
  primary-color="#003b7c"
  accent-color="#f97316"
  bg-color="#f4f7fc"
></wlo-sources>
```

### Attribute

| Attribut | Typ | Default | Beschreibung |
|----------|-----|---------|--------------|
| `api-base` | string | `""` | **Pflicht bei externer Einbettung.** URL der API (leer = gleicher Origin) |
| `view` | string | `"tile"` | Startansicht: `tile` (Kacheln) · `list` (Tabelle) · `stats` (Statistiken) |
| `min-count` | number | `5` | Nur Quellen mit mindestens N Inhalten anzeigen (0 = alle) |
| `primary-color` | color | `#003b7c` | Hauptfarbe (Header, Badges, Buttons) |
| `secondary-color` | color | `#002d5f` | Sekundärfarbe |
| `accent-color` | color | `#f97316` | Akzentfarbe (Highlights, Hover) |
| `bg-color` | color | `#f4f7fc` | Hintergrundfarbe der Komponente |
| `card-bg` | color | `#ffffff` | Hintergrundfarbe der Kacheln/Karten |
| `text-color` | color | `#12213a` | Textfarbe |

> **Live-Demo:** https://wlo-quellenliste-api.vercel.app/example.html

### Webkomponente aktualisieren

Die Dateien in `public/wc/` stammen aus dem Angular-Projekt `wlosources-ng`.
Nach Änderungen dort neu bauen und kopieren:

```bash
# Im wlosources-ng-Verzeichnis:
npx ng build --configuration production

# Build-Artefakte in die API kopieren:
cp dist/wlosources-ng/browser/main.js      ../wlosearchlistapi/public/wc/
cp dist/wlosources-ng/browser/polyfills.js  ../wlosearchlistapi/public/wc/
cp dist/wlosources-ng/browser/styles.css    ../wlosearchlistapi/public/wc/
```

Danach API neu deployen (`vercel --prod`).

---

## 4. API-Endpunkte

Vollständige interaktive Dokumentation: **[/docs](https://wlo-quellenliste-api.vercel.app/docs)**

### Jobs

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| `POST` | `/jobs/refresh` | Daten-Refresh starten (async, 2–5 Min) |
| `GET` | `/jobs` | Job-Liste (neueste zuerst) |
| `GET` | `/jobs/latest` | Status des letzten Jobs |
| `GET` | `/jobs/{job_id}` | Status eines bestimmten Jobs |

### Quellen

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| `GET` | `/data/sources` | Gefilterte + paginierte Quellenliste |
| `GET` | `/data/sources/{name}` | Einzelne Quelle (alle Felder) |
| `GET` | `/data/stats` | Statistiken für Charts |
| `GET` | `/data/review` | Review-Liste (manuelle Prüfung) |

**`/data/sources` – Query-Parameter:**

| Parameter | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `q` | string | – | Volltextsuche (Name, Titel, Beschreibung, Fächer) |
| `subject` | string | – | Fach-Filter (Teilstring, z.B. `Physik`) |
| `level` | string | – | Bildungsstufe (z.B. `Grundschule`) |
| `oer` | bool | – | `true` = nur OER, `false` = nur nicht-OER |
| `spider` | bool | – | `true` = nur Crawler, `false` = nur redaktionell |
| `has_node` | bool | – | `true` = nur mit Quelldatensatz |
| `min_count` | int | `0` | Mindestanzahl Inhalte |
| `primary_only` | bool | `true` | Nur primärer Record pro Bezugsquelle |
| `page` | int | `1` | Seitennummer (1-basiert) |
| `page_size` | int | `25` | Einträge pro Seite (max. 500) |
| `fields` | string | `slim` | `slim` · `full` · kommagetrennte Feldnamen |
| `sort` | string | `contentCount` | Sortierfeld |
| `order` | string | `desc` | `asc` oder `desc` |

**Beispiele:**
```
GET /data/sources?q=mathematik&oer=true&min_count=10&page_size=50
GET /data/sources?subject=Geschichte&level=Sekundarstufe&fields=name,nodeId,contentCount
```

### Export

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| `GET` | `/data/export/csv` | Gesamtdatensatz als Semikolon-CSV |
| `GET` | `/data/export/meta.json` | Metadaten-Map (Drop-in für `bezugsquellen-meta.json`) |
| `GET` | `/data/export/counts.json` | Inhaltszahlen-Map (Drop-in für `bezugsquellen-counts.json`) |

### Korrekturtabelle

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| `GET` | `/correction-list` | Aktuelle Tabelle herunterladen (CSV) |
| `POST` | `/correction-list` | Neue Tabelle hochladen (ersetzt komplett) |
| `GET` | `/correction-list/template` | Leere CSV-Vorlage |

### Statische Dateien

| Pfad | Beschreibung |
|------|--------------|
| `/wc/main.js` | Kompilierte Webkomponente |
| `/wc/polyfills.js` | Zone.js Polyfills |
| `/wc/styles.css` | Globale Styles |
| `/example.html` | Einbettungs-Demo mit Live-Vorschau |

---

## 5. Projektstruktur

```
wlosearchlistapi/
├── api/
│   └── index.py               # Vercel Serverless Entry Point
├── public/
│   ├── wc/
│   │   ├── main.js            # Vorkompilierte Webkomponente (~291 kB)
│   │   ├── polyfills.js       # Zone.js Polyfills (~35 kB)
│   │   └── styles.css         # Globale Styles
│   └── example.html           # Einbettungs-Demo + Attribut-Referenz
├── data/
│   ├── quellen_merged.json    # Letzter Gesamtdatensatz (generiert)
│   ├── quellen_stats.json     # Letzte Statistiken (generiert)
│   ├── quellen_korrektur.csv  # Korrekturtabelle (Whitelist/Blacklist)
│   └── jobs.json              # Job-Historie (generiert)
├── main.py                    # FastAPI-App (alle Routen + StaticFiles)
├── jobs.py                    # Job-Management + Hintergrund-Threads
├── merger.py                  # 7-Stufen Matching-Kaskade
├── fetcher.py                 # WLO-API-Abruf (Quelldatensätze + Facetten)
├── stats.py                   # Statistik-Berechnung
├── vercel.json                # Vercel-Konfiguration (Routing, CORS)
├── requirements.txt           # Python-Abhängigkeiten
└── README.md
```

---

## 6. Matching-Kaskade

| Stufe | Methode | Treffer (typisch) |
|-------|---------|-------------------|
| 1 | Korrektur-Override (CSV) | ~45 |
| 2 | `publisher_combined` exakt | ~980 |
| 3 | Titel exakt (case-insensitive) | ~35 |
| 4 | Domain-Match (URL) | ~40 |
| 5 | Combined-Score ≥ 0.75 | ~98 |
| 6 | Substring-Match | ~20 |
| 7 | Facets-only (kein Quelldatensatz) | ~2.900 |
