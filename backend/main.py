"""
main.py
-------
FastAPI-Anwendung: WLO Quellenverzeichnis API

Endpoints:
  POST   /jobs/refresh              Neuen Daten-Refresh starten
  GET    /jobs                      Letzte Jobs auflisten
  GET    /jobs/latest               Status des letzten Jobs
  GET    /jobs/{job_id}             Status eines bestimmten Jobs

  GET    /data/stats                Statistiken (JSON)
  GET    /data/export/csv           Gesamtdatensatz als CSV (semikolon)
  GET    /data/export/meta.json     Nur Metadaten-Map (kompatibel mit Webkomponente)
  GET    /data/export/counts.json   Nur Inhaltszahlen-Map (kompatibel mit Webkomponente)

  GET    /data/sources              Gefilterte + paginierte Quellenliste (JSON)
  GET    /data/sources/{name}       Einzelne Quelle per Name

  GET    /correction-list           Aktuelle Korrekturtabelle herunterladen
  POST   /correction-list           Neue Korrekturtabelle hochladen (CSV)
  GET    /correction-list/template  Leere Vorlage herunterladen

  GET    /wc/info                   Webkomponente: Einbettungs-Infos, Dateien, Attribute
"""

import csv
import io
import logging
import os

from pathlib import Path

import requests as http_requests
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

import jobs as jobs_mod
import merger as merger_mod

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

DESCRIPTION = """
## WLO Quellenverzeichnis API

Backend für die **`<wlo-sources>`** Webkomponente (Angular 18 Custom Element).
Ruft Quellendaten von der WLO-Produktion ab, führt sie über eine 7-stufige
Matching-Kaskade zusammen und liefert sie gefiltert als JSON oder CSV aus.

Die API bündelt außerdem die **vorkompilierte Webkomponente** unter `/wc/`,
sodass sie per `<script>`-Tag in beliebige Webseiten eingebettet werden kann.

### Typischer Ablauf

1. **`POST /jobs/refresh`** – Datenabruf starten (async, dauert 2–5 min)
2. **`GET /jobs/latest`** – Fortschritt pollen bis `status = "done"`
3. **`GET /data/sources`** – Gefilterte Quellenliste abrufen
4. **`GET /data/stats`** – Statistiken für UI-Charts
5. **`GET /data/export/csv`** – Gesamtexport für Offline-Analyse
6. **`GET /wc/info`** – Einbettungs-Infos für die Webkomponente

### Datenquellen

| Quelle | Beschreibung | Anzahl |
|--------|-------------|--------|
| WLO LRT-API | Quelldatensätze (contentType=Quelle) | ~1.300 |
| WLO Facets-API | Bezugsquellen + Inhaltsanzahl | ~3.500 |
| Korrekturtabelle | Manuelle Overrides | variabel |

### Matching-Kaskade (7 Stufen)

| Stufe | Methode | Typische Treffer |
|-------|---------|------------------|
| 1 | Korrektur-Override (Titel / URL-Domain) | ~45 |
| 2 | `publisher_combined` exakt | ~980 |
| 3 | Titel exakt (case-insensitive) | ~35 |
| 4 | Domain-Match | ~40 |
| 5 | Combined-Score ≥ 0.75 | ~98 |
| 6 | Substring | ~20 |
| 7 | Facets-only (kein Quelldatensatz) | ~2.900 |
"""

app = FastAPI(
    title="WLO Quellenverzeichnis API",
    description=DESCRIPTION,
    version="1.0.0",
    openapi_tags=[
        {
            "name": "Jobs",
            "description": "Datenabruf-Jobs starten und Fortschritt überwachen. "
                           "Ein Job durchläuft: `pending → fetching_quellen → "
                           "fetching_facets → merging → done`.",
        },
        {
            "name": "Export",
            "description": "Gesamtdatensatz exportieren: CSV (Semikolon) oder "
                           "JSON-Maps als Drop-in-Ersatz für die Webkomponente.",
        },
        {
            "name": "Quellen",
            "description": "Gefilterte, paginierte Quellenliste und Einzelabruf. "
                           "Datensparend durch `fields`-Projektion.",
        },
        {
            "name": "Statistiken",
            "description": "Vorberechnete Statistiken für UI-Charts "
                           "(Fächer, Bildungsstufen, OER, Qualität, Erschließung).",
        },
        {
            "name": "Korrekturtabelle",
            "description": "Manuelle Overrides für falsche oder fehlende `publisher_combined`-Zuordnungen. "
                           "CSV-Upload mit Spalten: `Node-Id` | `Titel` | `Url` | `Bezugsquelle` | `Spider` | `Liste`. "
                           "Bei gesetzter `Node-Id` werden Metadaten automatisch von WLO abgerufen. "
                           "`Spider=1` gibt der Quelle Vorrang bei Duplikaten. "
                           "`Liste=whitelist` = bevorzugter primärer Datensatz; `Liste=blacklist` = bekanntes Duplikat, wird nie primär.",
        },
        {
            "name": "Webkomponente",
            "description": "Die API liefert unter `/wc/` eine **vorkompilierte Angular-Webkomponente** "
                           "(`<wlo-sources>`) aus. Die drei Dateien (`main.js`, `polyfills.js`, `styles.css`) "
                           "können per `<script>`-Tag in beliebige Webseiten eingebettet werden – CORS ist "
                           "freigeschaltet (`Access-Control-Allow-Origin: *`). "
                           "Unter `/wc/info` gibt es Einbettungs-Infos, Dateigrößen und eine Attribut-Referenz.",
        },
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    jobs_mod.load_jobs_from_disk()
    log.info("API gestartet.")


# ---------------------------------------------------------------------------
# Reverse-Proxy: edu-sharing API
# ---------------------------------------------------------------------------
# Leitet /edu-sharing/rest/* an https://redaktion.openeduhub.net weiter.
# Dadurch kann die eingebettete Webkomponente ohne CORS-Probleme auf die
# edu-sharing-Suche zugreifen – sowohl lokal als auch auf Vercel.

_EDU_SHARING_ORIGIN = "https://redaktion.openeduhub.net"


@app.api_route(
    "/edu-sharing/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    include_in_schema=False,
)
async def _edu_sharing_proxy(path: str, request: Request):
    target = f"{_EDU_SHARING_ORIGIN}/edu-sharing/{path}"
    qs = str(request.query_params)
    if qs:
        target += f"?{qs}"

    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "connection", "content-length", "transfer-encoding")
    }

    body = await request.body()
    try:
        resp = http_requests.request(
            method=request.method,
            url=target,
            headers=headers,
            data=body if body else None,
            timeout=30,
            allow_redirects=False,
        )
    except http_requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    excluded = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    resp_headers = {
        k: v for k, v in resp.headers.items()
        if k.lower() not in excluded
    }

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=resp_headers,
    )


# ---------------------------------------------------------------------------
# CSV-Export-Felder (Webkomponente)
# ---------------------------------------------------------------------------

# Nur die Felder, die die Webkomponente tatsächlich benötigt
WC_FIELDS = [
    "name",              # Bezugsquelle / Publisher-Name
    "nodeId",
    "title",
    "description",
    "wwwUrl",
    "previewUrl",
    "contentCount",
    "oer",
    "isSpider",
    "license",
    "licenseVersion",
    "language",
    "subjects",          # list → | separated
    "educationalContext",
    "oehLrt",
    "loginRaw",
    "adsRaw",
    "priceRaw",
    "gdprRaw",
    "accessRaw",
    # Rechtliche Qualität
    "lawMinors", "lawMinorsLbl",
    "lawPrivacy", "lawPrivacyLbl",
    "lawPersonal", "lawPersonalLbl",
    "lawCriminal", "lawCriminalLbl",
    "lawCopyright", "lawCopyrightLbl",
    # Inhaltliche Qualität
    "qCurrentness", "qCurrentnessLbl",
    "qNeutralness", "qNeutralnessLbl",
    "qLanguage", "qLanguageLbl",
    "qCorrectness", "qCorrectnessLbl",
    "qMedial", "qMedialLbl",
    "qTransparent", "qTransparentLbl",
    "qDidactics", "qDidacticsLbl",
    # Zugänglichkeit
    "qInterop", "qInteropLbl",
    "qAdvertisement", "qAdvertisementLbl",
    "qUsability", "qUsabilityLbl",
    "qSecurity", "qSecurityLbl",
    "qFind", "qFindLbl",
    "qBarrier",
    # Erschließung / Herkunft
    "matchStage",
    "matchConfidence",
    "isPrimary",
    "qualityFlags",
    "created",
    "modified",
]


def _record_to_csv_row(r: dict) -> dict:
    row = {}
    for f in WC_FIELDS:
        val = r.get(f, "")
        if isinstance(val, list):
            val = " | ".join(str(v) for v in val if v)
        elif isinstance(val, bool):
            val = "1" if val else "0"
        elif val is None:
            val = ""
        row[f] = val
    return row


def _build_csv(records: list[dict], skip: int, limit: int,
               min_count: int, with_node_only: bool) -> str:
    filtered = [
        r for r in records
        if (r.get("contentCount") or 0) >= min_count
        and (not with_node_only or r.get("nodeId"))
    ]
    page = filtered[skip: skip + limit] if limit else filtered

    buf = io.StringIO()
    w   = csv.DictWriter(buf, fieldnames=WC_FIELDS, delimiter=";",
                         extrasaction="ignore")
    w.writeheader()
    for r in page:
        w.writerow(_record_to_csv_row(r))
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Routen: Jobs
# ---------------------------------------------------------------------------

@app.post(
    "/jobs/refresh",
    summary="Neuen Daten-Refresh starten",
    tags=["Jobs"],
    response_description="Job-ID und Status (bei sync=true: Endergebnis)",
)
def start_refresh(
    sync: bool = Query(
        False,
        description=(
            "`true` = Job blockierend ausführen (Response erst nach Abschluss). "
            "**Nötig auf Vercel**, da Hintergrund-Threads nach der Response beendet werden. "
            "Wird automatisch auf `true` gesetzt wenn die Umgebungsvariable `VERCEL` erkannt wird."
        ),
    ),
):
    """
    Startet einen Datenabruf- und Merge-Job.

    **Modi:**
    - `sync=false` (Default lokal): Job läuft im Hintergrund-Thread.
      Fortschritt per `GET /jobs/latest` pollen.
    - `sync=true` (Default auf Vercel): Job läuft blockierend.
      Response enthält direkt das Endergebnis.

    **Phasen:**

    | Status | Beschreibung |
    |--------|---------------|
    | `pending` | Wartet auf Start |
    | `fetching_quellen` | Quelldatensätze werden seitenweise abgerufen |
    | `fetching_facets` | Bezugsquellen-Facetten werden abgerufen |
    | `merging` | Datenzusammenführung, Primär-Markierung, Statistiken |
    | `done` | Fertig – Daten abrufbar |
    | `error` | Fehler – `error`-Feld enthält Stacktrace |
    """
    # Auf Vercel automatisch synchron laufen lassen
    is_vercel = bool(os.environ.get("VERCEL"))
    run_sync = sync or is_vercel

    job = jobs_mod.start_job(sync=run_sync)
    return {"jobId": job.id, "status": job.status}


@app.get(
    "/jobs",
    summary="Job-Liste",
    tags=["Jobs"],
    response_description="Liste der letzten Jobs, neueste zuerst",
)
def list_jobs(
    limit: int = Query(20, ge=1, le=100, description="Maximale Anzahl zurückgegebener Jobs", examples=[10]),
):
    """Gibt die letzten N Jobs zurück (neueste zuerst)."""
    return jobs_mod.list_jobs(limit)


@app.get(
    "/jobs/latest",
    summary="Status des letzten Jobs",
    tags=["Jobs"],
    response_description="Job-Objekt mit Status, Fortschritt und Schritt-Verlauf",
)
def latest_job():
    """
    Gibt den zuletzt gestarteten Job zurück – nützlich zum Pollen ohne Job-ID.

    **Antwort-Felder:**

    | Feld | Typ | Beschreibung |
    |------|-----|--------------|
    | `id` | string | UUID des Jobs |
    | `status` | string | Aktueller Status-Code |
    | `statusLabel` | string | Lesbarer Statustext (Deutsch) |
    | `message` | string | Detailmeldung des aktuellen Schritts |
    | `progress.fetched` | int | Bisher geladene Quelldatensätze |
    | `progress.total` | int | Gesamtanzahl laut API |
    | `elapsedSeconds` | float | Laufzeit seit Start |
    | `steps` | array | Verlauf aller Statuswechsel mit Zeitstempel |
    | `resultSummary` | object | Ergebniszahlen nach Abschluss |
    | `error` | string / null | Stacktrace bei Fehler |
    """
    j = jobs_mod.latest_job()
    if not j:
        raise HTTPException(404, "Noch kein Job gestartet.")
    return j


@app.get(
    "/jobs/{job_id}",
    summary="Job-Status per ID",
    tags=["Jobs"],
    response_description="Job-Objekt (gleiche Struktur wie GET /jobs/latest)",
)
def get_job(
    job_id: str,
):
    """
    Gibt den Status eines bestimmten Jobs anhand seiner ID zurück.

    Die Job-ID wird beim Start per `POST /jobs/refresh` zurückgegeben.
    """
    j = jobs_mod.get_job(job_id)
    if not j:
        raise HTTPException(404, f"Job {job_id!r} nicht gefunden.")
    return j.to_dict()


# ---------------------------------------------------------------------------
# Routen: Daten / Export
# ---------------------------------------------------------------------------

@app.get(
    "/data/stats",
    summary="Statistiken (JSON)",
    tags=["Statistiken"],
    response_description="Statistik-Objekt mit Verteilungen und KPIs",
)
def get_stats():
    """
    Liefert vorberechnete Statistiken aus dem letzten erfolgreich
    abgeschlossenen Job. **Kein erneuter WLO-API-Aufruf nötig.**

    **Enthaltene Statistiken:**

    | Feld | Beschreibung |
    |------|--------------|
    | `total` | Gesamtanzahl Quellen |
    | `totalContents` | Summe aller Inhalte |
    | `withNodeId` | Quellen mit Quelldatensatz |
    | `facetsOnly` | Quellen nur aus Facetten (kein Node) |
    | `oer.count / percent` | OER-Anteil |
    | `erschliessung` | Crawler vs. redaktionell |
    | `contentBrackets` | Verteilung Inhaltsmengen (0, 1–4, 5–9, …) |
    | `matchingStages` | Treffer pro Matching-Stufe |
    | `quality` | Login, Kosten, Werbung, DSGVO-Kennzahlen |
    | `licenseDistribution` | Top-30 Lizenzen |
    | `topSubjects` | Top-50 Fächer |
    | `topEducationalContext` | Top-30 Bildungsstufen |
    | `topLanguages` | Top-30 Sprachen |
    | `topLrt` | Top-30 Inhaltstypen (LRT) |
    """
    data = jobs_mod.load_stats()
    if data is None:
        raise HTTPException(
            404, "Noch keine Daten vorhanden. Bitte zuerst POST /jobs/refresh aufrufen."
        )
    return data


@app.get(
    "/data/export/csv",
    summary="Gesamtdatensatz als Semikolon-CSV",
    tags=["Export"],
    response_description="CSV-Datei (Content-Type: text/csv; Trennzeichen: Semikolon)",
)
def export_csv(
    skip:           int  = Query(0,       ge=0,          description="Zeilen überspringen (Pagination)", examples=[0]),
    limit:          int  = Query(5000,    ge=1, le=100_000, description="Max. Zeilen pro Abruf", examples=[5000]),
    min_count:      int  = Query(0,       ge=0,          description="Nur Quellen mit mind. N Inhalten", examples=[5]),
    with_node_only: bool = Query(False,                  description="true = nur Quellen mit Quelldatensatz (nodeId)"),
):
    """
    Exportiert den Gesamtdatensatz als **Semikolon-CSV** (UTF-8).

    **CSV-Spalten:**

    `name`, `nodeId`, `title`, `description`, `wwwUrl`, `previewUrl`,
    `contentCount`, `oer`, `isSpider`, `license`, `licenseVersion`, `language`,
    `subjects`, `educationalContext`, `oehLrt`,
    `loginRaw`, `adsRaw`, `priceRaw`, `gdprRaw`, `accessRaw`,
    `matchStage`, `matchConfidence`, `isPrimary`, `created`, `modified`

    **Hinweise:**
    - Listen-Felder (`subjects`, `educationalContext`, `oehLrt`) werden mit ` | ` getrennt
    - Boolean-Felder (`oer`, `isSpider`, `isPrimary`) werden als `1`/`0` ausgegeben
    - Pagination: `skip=0&limit=5000` → erste 5.000 Zeilen
    """
    records = jobs_mod.load_merged()
    if records is None:
        raise HTTPException(
            404, "Noch keine Daten vorhanden. Bitte zuerst POST /jobs/refresh aufrufen."
        )
    csv_text = _build_csv(records, skip, limit, min_count, with_node_only)
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=quellen_export.csv"},
    )


@app.get(
    "/data/export/meta.json",
    summary="Metadaten-Map (Drop-in für bezugsquellen-meta.json)",
    tags=["Export"],
    response_description="JSON-Objekt { PublisherName: { nodeId, title, oer, … } }",
)
def export_meta_json(
    min_count: int = Query(0, ge=0, description="Nur Quellen mit mind. N Inhalten", examples=[0]),
):
    """
    Gibt ein JSON-Objekt im Format der statischen `bezugsquellen-meta.json` zurück –
    **direkter Drop-in-Ersatz** für die Webkomponente.

    **Format:**
    ```json
    {
      "_meta": { "generated": "2026-03-25T…", "count": 3570 },
      "Bundeszentrale für politische Bildung": {
        "nodeId": "abc-123",
        "title": "bpb",
        "wwwUrl": "https://bpb.de",
        "oer": false,
        "subjects": ["Politik"],
        "educationalContext": ["Sekundarstufe I"],
        "license": "CC_BY"
      }
    }
    ```
    Leere Felder werden weggelassen (kompakter Output).
    """
    records = jobs_mod.load_merged()
    if records is None:
        raise HTTPException(404, "Keine Daten verfügbar.")

    from datetime import datetime, timezone
    out: dict = {
        "_meta": {
            "generated": datetime.now(timezone.utc).isoformat(),
            "count": len(records),
        }
    }
    for r in records:
        name = r.get("name") or r.get("publisher") or ""
        if not name:
            continue
        if (r.get("contentCount") or 0) < min_count:
            continue
        entry = {
            "nodeId":            r.get("nodeId") or None,
            "title":             r.get("title") or None,
            "description":       r.get("description") or None,
            "wwwUrl":            r.get("wwwUrl") or None,
            "previewUrl":        r.get("previewUrl") or None,
            "oer":               r.get("oer"),
            "isSpider":          r.get("isSpider"),
            "subjects":          r.get("subjects") or [],
            "educationalContext":r.get("educationalContext") or [],
            "oehLrt":            r.get("oehLrt") or [],
            "license":           r.get("license") or None,
            "licenseVersion":    r.get("licenseVersion") or None,
            "language":          r.get("language") or None,
            "loginRaw":          r.get("loginRaw") or None,
            "adsRaw":            r.get("adsRaw") or None,
            "priceRaw":          r.get("priceRaw") or None,
            "gdprRaw":           r.get("gdprRaw") or None,
            "accessRaw":         r.get("accessRaw") or None,
        }
        # Leere Felder entfernen (kleiner Output)
        out[name] = {k: v for k, v in entry.items() if v is not None and v != [] and v != ""}

    return JSONResponse(content=out)


@app.get(
    "/data/export/counts.json",
    summary="Inhaltszahlen-Map (Drop-in für bezugsquellen-counts.json)",
    tags=["Export"],
    response_description="JSON-Objekt { PublisherName: contentCount }",
)
def export_counts_json(
    min_count: int = Query(0, ge=0, description="Nur Quellen mit mind. N Inhalten", examples=[0]),
):
    """
    Gibt ein JSON-Objekt `{ "PublisherName": 42, … }` zurück –
    **direkter Drop-in-Ersatz** für `bezugsquellen-counts.json` der Webkomponente.

    **Format:**
    ```json
    {
      "Bundeszentrale für politische Bildung": 1842,
      "Schule im Aufbruch": 234,
      "ZDF": 78
    }
    ```
    """
    records = jobs_mod.load_merged()
    if records is None:
        raise HTTPException(404, "Keine Daten verfügbar.")

    out = {}
    for r in records:
        name  = r.get("name") or r.get("publisher") or ""
        count = r.get("contentCount") or 0
        if name and count >= min_count:
            out[name] = count

    return JSONResponse(content=out)


# ---------------------------------------------------------------------------
# Routen: Quellen (gefiltert, paginiert, Volltextsuche)
# ---------------------------------------------------------------------------

# Felder die bei fields=slim zurückgegeben werden (Kachel-Ansicht)
_SLIM_FIELDS = {
    "name", "nodeId", "title", "description", "previewUrl", "contentCount",
    "bezugsquellen",
    "oer", "isSpider", "subjects", "educationalContext", "oehLrt", "license",
    "matchStage", "matchConfidence", "isPrimary", "qualityFlags",
    # Basis-Qualitätskriterien (Kachel-Icons)
    "loginRaw", "adsRaw", "priceRaw", "gdprRaw", "accessRaw",
    # Rechtliche Qualität (für Detail-View und kompakte Anzeige)
    "lawMinors", "lawMinorsLbl",
    "lawPrivacy", "lawPrivacyLbl",
    "lawPersonal", "lawPersonalLbl",
    "lawCriminal", "lawCriminalLbl",
    "lawCopyright", "lawCopyrightLbl",
    # Inhaltliche Qualität
    "qCurrentness", "qCurrentnessLbl",
    "qNeutralness", "qNeutralnessLbl",
    "qLanguage", "qLanguageLbl",
    "qCorrectness", "qCorrectnessLbl",
    "qMedial", "qMedialLbl",
    "qTransparent", "qTransparentLbl",
    "qDidactics", "qDidacticsLbl",
    # Zugänglichkeit
    "qInterop", "qInteropLbl",
    "qAdvertisement", "qAdvertisementLbl",
    "qUsability", "qUsabilityLbl",
    "qSecurity", "qSecurityLbl",
    "qFind", "qFindLbl",
    "qBarrier",
}


def _apply_filters(
    records: list[dict],
    q:              str | None,
    subject:        str | None,
    level:          str | None,
    oer:            bool | None,
    spider:         bool | None,
    has_node:       bool | None,
    min_count:      int,
) -> list[dict]:
    out = []
    q_low = q.lower().strip() if q else None

    for r in records:
        # min_count
        if (r.get("contentCount") or 0) < min_count:
            continue
        # has_node
        if has_node is True and not r.get("nodeId"):
            continue
        if has_node is False and r.get("nodeId"):
            continue
        # subject
        if subject:
            subjs = [str(s).lower() for s in (r.get("subjects") or [])]
            if not any(subject.lower() in s for s in subjs):
                continue
        # educational level
        if level:
            levels = [str(lv).lower() for lv in (r.get("educationalContext") or [])]
            if not any(level.lower() in lv for lv in levels):
                continue
        # oer
        if oer is True and not r.get("oer"):
            continue
        if oer is False and r.get("oer"):
            continue
        # spider
        if spider is True and not r.get("isSpider"):
            continue
        if spider is False and r.get("isSpider"):
            continue
        # full-text search
        if q_low:
            name  = (r.get("name") or "").lower()
            title = (r.get("title") or "").lower()
            desc  = (r.get("description") or "").lower()
            subjs = " ".join(str(s) for s in (r.get("subjects") or [])).lower()
            if not (q_low in name or q_low in title or q_low in desc or q_low in subjs):
                continue
        out.append(r)
    return out


def _project(r: dict, fields: str | None) -> dict:
    """Gibt nur die gewünschten Felder zurück."""
    if not fields or fields == "full":
        return r
    if fields == "slim":
        return {k: v for k, v in r.items() if k in _SLIM_FIELDS}
    # kommagetrennte Feldliste
    wanted = {f.strip() for f in fields.split(",")}
    return {k: v for k, v in r.items() if k in wanted}


@app.get(
    "/data/sources",
    summary="Gefilterte + paginierte Quellenliste",
    tags=["Quellen"],
    response_description="Paginiertes Ergebnis-Objekt mit items-Array",
)
def get_sources(
    # Suche
    q:            str | None = Query(None,  description="Volltextsuche in Name, Titel, Beschreibung und Fächern (Teilstring, case-insensitive)", examples=["Mathematik"]),
    # Filter
    subject:      str | None = Query(None,  description="Fach-Filter: Teilstring gegen alle Fach-Tags (z.B. \"Physik\")", examples=["Geschichte"]),
    level:        str | None = Query(None,  description="Bildungsstufen-Filter: Teilstring (z.B. \"Grundschule\", \"Sekundarstufe\")", examples=["Grundschule"]),
    oer:          bool | None= Query(None,  description="`true` = nur OER-lizenzierte Quellen · `false` = nur nicht-OER"),
    spider:       bool | None= Query(None,  description="`true` = nur maschinell erschlossene (Crawler) · `false` = nur redaktionelle"),
    has_node:     bool | None= Query(None,  description="`true` = nur Quellen mit Quelldatensatz (nodeId vorhanden) · `false` = nur Facets-only"),
    min_count:    int        = Query(0, ge=0, description="Nur Quellen mit mind. N Inhalten (0 = alle)", examples=[5]),
    primary_only: bool       = Query(True,   description="`true` (Default) = nur primärer Record pro Bezugsquelle · `false` = alle Records inkl. Duplikate"),
    # Paginierung
    page:         int        = Query(1, ge=1,  description="Seitennummer, 1-basiert", examples=[1]),
    page_size:    int        = Query(25, ge=1, le=500, description="Einträge pro Seite (max. 500)", examples=[25]),
    # Projektion
    fields:       str | None = Query(
        "slim",
        description=(
            "Feldauswahl: "
            "`slim` = Kachel-Felder (name, nodeId, title, previewUrl, contentCount, oer, isSpider, subjects, educationalContext, license, matchStage, matchConfidence, isPrimary) · "
            "`full` = alle Felder · "
            "kommagetrennte Feldnamen z.B. `name,nodeId,contentCount`"
        ),
        examples=["slim"],
    ),
    # Sortierung
    sort:         str        = Query("contentCount", description="Sortierfeld (beliebiger Record-Feldname)", examples=["contentCount"]),
    order:        str        = Query("desc", description="Sortierreihenfolge: `asc` oder `desc`", examples=["desc"]),
):
    """
    Gibt eine **gefilterte, paginierte Quellenliste** als JSON zurück.

    Alle Filter sind kombinierbar. Ohne Parameter: primäre Records, alle Quellen,
    sortiert nach Inhaltsanzahl absteigend, 25 pro Seite.

    **Datensparend durch `fields`-Projektion:**

    | Wert | Felder | Typische Größe |
    |------|--------|----------------|
    | `slim` (Default) | 13 Felder für Kachel-Ansicht | ~30 % |
    | `full` | alle 25+ Felder | 100 % |
    | `name,nodeId,contentCount` | beliebige Auswahl | minimal |

    **Antwortformat:**
    ```json
    {
      "total": 558,
      "page": 1,
      "pageSize": 25,
      "pages": 23,
      "items": [
        {
          "name": "Bundeszentrale für politische Bildung",
          "nodeId": "abc-123",
          "title": "bpb",
          "contentCount": 1842,
          "oer": false,
          "isPrimary": true,
          "matchStage": 2,
          "matchConfidence": "HIGH"
        }
      ]
    }
    ```

    **Beispiel-URLs:**
    - Nur OER, mind. 10 Inhalte: `?oer=true&min_count=10`
    - Volltextsuche: `?q=mathematik&fields=slim`
    - Fach-Filter: `?subject=Geschichte&level=Sekundarstufe`
    - Facets-only (ohne Node): `?has_node=false&primary_only=true`
    - Alle Records inkl. Duplikate: `?primary_only=false&fields=name,nodeId,isPrimary`
    """
    records = jobs_mod.load_merged()
    if records is None:
        raise HTTPException(
            404, "Noch keine Daten. Bitte zuerst POST /jobs/refresh aufrufen."
        )

    if primary_only:
        records = [r for r in records if r.get("isPrimary", True)]
    else:
        # Deduplicate by name: keep best record per unique name
        # (isPrimary ones first, then by insertion order from merger)
        seen: dict[str, dict] = {}
        for r in records:
            key = (r.get("name") or "").strip().lower()
            if key not in seen or (not seen[key].get("isPrimary") and r.get("isPrimary")):
                seen[key] = r
        records = list(seen.values())

    filtered = _apply_filters(records, q, subject, level, oer, spider, has_node, min_count)

    # Sortierung
    reverse = (order.lower() != "asc")
    try:
        filtered.sort(
            key=lambda r: (r.get(sort) or 0) if isinstance(r.get(sort), (int, float)) else str(r.get(sort) or "").lower(),
            reverse=reverse,
        )
    except Exception:
        pass  # ungültiges Sortierfeld → keine Sortierung

    total = len(filtered)
    pages = max(1, (total + page_size - 1) // page_size)
    skip  = (page - 1) * page_size
    page_items = filtered[skip: skip + page_size]

    return {
        "total":    total,
        "page":     page,
        "pageSize": page_size,
        "pages":    pages,
        "items":    [_project(r, fields) for r in page_items],
    }


@app.get(
    "/data/sources/{name}",
    summary="Einzelne Quelle per Name",
    tags=["Quellen"],
    response_description="Vollständiger Record der Quelle mit allen Feldern",
)
def get_source_by_name(name: str):
    """
    Gibt **alle Felder** einer einzelnen Quelle zurück (entspricht `fields=full`).

    Der `name`-Pfadparameter ist der `name`-Wert aus `GET /data/sources`
    (= Bezugsquellen-Name, entspricht `publisher_combined` bzw. dem Facetten-Eintrag).

    Sonderzeichen und Leerzeichen müssen URL-kodiert werden, z.B.:
    - `Bundeszentrale%20f%C3%BCr%20politische%20Bildung`
    - `ZDF%20-%20Zweites%20Deutsches%20Fernsehen`

    Suche ist **case-insensitive** (Groß-/Kleinschreibung egal).
    """
    records = jobs_mod.load_merged()
    if records is None:
        raise HTTPException(404, "Keine Daten verfügbar.")

    name_low = name.lower().strip()
    for r in records:
        if (r.get("name") or "").lower().strip() == name_low:
            return r

    raise HTTPException(404, f"Quelle {name!r} nicht gefunden.")


# ---------------------------------------------------------------------------
# Routen: Review-Liste
# ---------------------------------------------------------------------------

@app.get(
    "/data/review",
    summary="Review-Liste (MITTEL-Matches, Unmatched, Datenqualität)",
    tags=["Quellen"],
    response_description="Einträge die manuelle Prüfung benötigen, mit Top-3-Kandidaten",
)
def get_review(
    typ: str | None = Query(
        None,
        description=(
            "Filter nach Review-Typ: "
            "`MITTEL_MATCH` · `KEIN_MATCH` · `DATENQUALITAET` · "
            "`PUB_INKONSISTENT` · `KORREKTUR_ABWEICHUNG` · "
            "`URL_MEHRFACH_VERSCH_TITEL` · `URL_TITEL_DUBLETTE`"
        ),
        examples=["MITTEL_MATCH"],
    ),
    page:      int = Query(1,  ge=1, description="Seitennummer"),
    page_size: int = Query(50, ge=1, le=500, description="Einträge pro Seite"),
):
    """
    Gibt Einträge zurück, die manuelle Prüfung empfehlen:

    | Typ | Beschreibung |
    |-----|--------------|
    | `MITTEL_MATCH` | Stufe-5/6-Treffer mit `matchConfidence=MEDIUM` + Top-3-Kandidaten |
    | `KEIN_MATCH` | Quelldatensätze ohne Facetten-Zuordnung + Top-3-Kandidaten |
    | `DATENQUALITAET` | Einträge mit Qualitäts-Flags (PUB_INKONSISTENT, URL-Dubletten …) |

    **Antwort-Felder pro Eintrag:**

    | Feld | Beschreibung |
    |------|--------------|
    | `reviewTyp` | Kategorie (s.o.) |
    | `name` | Bezugsquelle |
    | `title` | Titel des Quelldatensatzes |
    | `wwwUrl` | URL |
    | `publisher` | `publisher_combined` |
    | `matchStage` | Zugeordnete Stufe |
    | `matchSource` | Matching-Methode |
    | `qualityFlags` | Liste der Flags |
    | `nodeId` | Node-UUID |
    | `candidates` | Top-3-Kandidaten mit Score (nur bei KEIN_MATCH/MITTEL_MATCH) |
    """
    records = jobs_mod.load_merged()
    if records is None:
        raise HTTPException(404, "Keine Daten verfügbar.")

    # Facets-Liste für Kandidaten-Berechnung
    fac_list = list({
        r["name"] for r in records if r.get("name") and r.get("matchStage") is not None
    })

    review: list[dict] = []

    def _top3(r: dict) -> list[dict]:
        dom   = merger_mod._domain(r.get("wwwUrl") or "")
        title = r.get("title") or ""
        if not dom and not title:
            return []
        scores = sorted(
            [(merger_mod._combined_score(dom, title, bq), bq) for bq in fac_list],
            reverse=True,
        )
        return [{"name": bq, "score": round(s, 3)} for s, bq in scores[:3]]

    def _entry(r: dict, rev_typ: str, with_candidates: bool = False) -> dict:
        e = {
            "reviewTyp":    rev_typ,
            "name":         r.get("name") or "",
            "title":        r.get("title") or "",
            "wwwUrl":       r.get("wwwUrl") or "",
            "publisher":    r.get("publisher") or "",
            "matchStage":   r.get("matchStage"),
            "matchSource":  r.get("matchSource") or "",
            "matchConfidence": r.get("matchConfidence") or "",
            "qualityFlags": r.get("qualityFlags") or [],
            "nodeId":       r.get("nodeId") or "",
        }
        if with_candidates:
            e["candidates"] = _top3(r)
        return e

    seen_nodes: set[str] = set()

    # ── MITTEL_MATCH ──────────────────────────────────────────────────────
    if not typ or typ == "MITTEL_MATCH":
        for r in records:
            if r.get("matchConfidence") == "MEDIUM" and r.get("nodeId"):
                nid = r["nodeId"]
                if nid not in seen_nodes:
                    seen_nodes.add(nid)
                    review.append(_entry(r, "MITTEL_MATCH", with_candidates=True))

    # ── KEIN_MATCH ────────────────────────────────────────────────────────
    if not typ or typ == "KEIN_MATCH":
        for r in records:
            flags = r.get("qualityFlags") or []
            if "KEIN_MATCH" in flags and r.get("nodeId"):
                nid = r["nodeId"]
                if nid not in seen_nodes:
                    seen_nodes.add(nid)
                    review.append(_entry(r, "KEIN_MATCH", with_candidates=True))

    # ── DATENQUALITAET ────────────────────────────────────────────────────
    dq_flags = {"PUB_INKONSISTENT", "KORREKTUR_ABWEICHUNG",
                "URL_MEHRFACH_VERSCH_TITEL", "URL_TITEL_DUBLETTE"}
    if typ and typ in dq_flags:
        dq_flags = {typ}
    if not typ or typ == "DATENQUALITAET" or typ in dq_flags:
        for r in records:
            flags = set(r.get("qualityFlags") or [])
            hit   = flags & dq_flags
            nid   = r.get("nodeId") or ""
            if hit and nid not in seen_nodes:
                seen_nodes.add(nid) if nid else None
                review.append(_entry(r, "DATENQUALITAET"))

    total  = len(review)
    pages  = max(1, (total + page_size - 1) // page_size)
    skip   = (page - 1) * page_size
    return {
        "total":    total,
        "page":     page,
        "pageSize": page_size,
        "pages":    pages,
        "items":    review[skip: skip + page_size],
    }


# ---------------------------------------------------------------------------
# Routen: Korrekturtabelle
# ---------------------------------------------------------------------------

@app.get(
    "/correction-list",
    summary="Korrekturtabelle herunterladen",
    tags=["Korrekturtabelle"],
    response_description="CSV-Datei mit aktuellen Korrekturen (Komma-getrennt, UTF-8)",
)
def download_correction_list():
    """
    Lädt die aktuelle Korrekturtabelle als CSV herunter.

    **Spalten:**

    | Spalte | Beschreibung |
    |--------|--------------|
    | `Node-Id` | WLO-NodeId des Quelldatensatzes – ermöglicht direktes Matching und automatischen Metadaten-Abruf |
    | `Titel` | Quelldatensatz-Titel für exakten Titelabgleich |
    | `Url` | URL (wwwUrl) des Quelldatensatzes – Domain wird für Matching verwendet |
    | `Bezugsquelle` | Ziel-Bezugsquelle (muss exakt mit Facetten-Wert übereinstimmen) |
    | `Spider` | `1` = Quelle ist Crawler-erschlossen (technischer Vorrang bei Duplikaten) |
    | `Liste` | `whitelist` (Standard) = bevorzugter primärer Datensatz; `blacklist` = bekanntes Duplikat, wird nie primär |

    Mindestens `Bezugsquelle` muss befüllt sein. Zusätzlich muss mindestens
    `Node-Id`, `Titel` **oder** `Url` angegeben werden, damit das Matching greift.
    """
    rows = jobs_mod.load_corrections()
    fields = ["Node-Id", "Titel", "Url", "Bezugsquelle", "Spider", "Liste"]
    buf = io.StringIO()
    w   = csv.DictWriter(buf, fieldnames=fields, delimiter=";",
                         extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=quellen_korrektur.csv"},
    )


@app.post(
    "/correction-list",
    summary="Korrekturtabelle hochladen",
    tags=["Korrekturtabelle"],
    response_description="Anzahl gespeicherter Zeilen",
)
async def upload_correction_list(file: UploadFile = File(..., description="CSV-Datei (Komma oder Semikolon, UTF-8 oder UTF-8 BOM)")):
    """
    **Ersetzt** die aktuelle Korrekturtabelle vollständig.

    **Format (Semikolon-getrennt):**
    ```csv
    Node-Id;Titel;Url;Bezugsquelle;Spider
    744e3c29-c20f-438e-8841-8c8f44239dc4;;https://www.bpb.de;Bundeszentrale für politische Bildung;0
    ;;https://zdf.de;ZDF – Zweites Deutsches Fernsehen;0
    ;;https://wlo-spider.de;Beispiel Crawler-Quelle;1
    ```

    **Spalten:**

    | Spalte | Pflicht | Beschreibung |
    |--------|---------|------------- |
    | `Node-Id` | nein | WLO nodeId – ermöglicht direktes Matching und automatischen Metadaten-Abruf beim nächsten Job |
    | `Titel` | nein | Exakter Titel des Quelldatensatzes für Titelabgleich |
    | `Url` | nein | URL (wwwUrl) des Quelldatensatzes – Domain-Matching |
    | `Bezugsquelle` | **ja** | Ziel-Bezugsquelle (exakter Facetten-Wert) |
    | `Spider` | nein | `1` oder `true` = Quelle als Crawler markieren (Vorrang bei Duplikaten) |
    | `Liste` | nein | `whitelist` (Standard/leer) = bevorzugter primärer Datensatz; `blacklist` = bekanntes Duplikat, wird nie primär |

    - Trennzeichen: Komma **oder** Semikolon (auto-erkannt)
    - Encoding: UTF-8 oder UTF-8 BOM (Excel-Export funktioniert direkt)
    - `Bezugsquelle` muss immer befüllt sein; zusätzlich mind. `Node-Id`, `Titel` oder `Url`
    - Wirkung erst nach dem nächsten `POST /jobs/refresh` sichtbar
    - Hat `Node-Id` einen Wert, werden beim nächsten Job Metadaten automatisch von WLO abgerufen
    - `Liste=blacklist`: Der Datensatz mit dieser NodeId wird beim Merging als Duplikat markiert (`isPrimary=False`)
    """
    content = await file.read()
    text    = content.decode("utf-8-sig")

    # Trennzeichen auto-erkennen
    sep = ";" if text.count(";") > text.count(",") else ","

    reader = csv.DictReader(io.StringIO(text), delimiter=sep)
    rows   = []
    for row in reader:
        bq = (row.get("Bezugsquelle") or "").strip()
        if not bq:
            continue   # Zeile ohne Bezugsquelle überspringen
        liste = (row.get("Liste") or "").strip().lower()
        if liste not in ("whitelist", "blacklist", ""):
            liste = ""  # unbekannte Werte ignorieren
        rows.append({
            "Node-Id":     (row.get("Node-Id") or row.get("NodeId") or "").strip(),
            "Titel":       (row.get("Titel") or "").strip(),
            "Url":         (row.get("Url") or row.get("URL") or "").strip(),
            "Bezugsquelle": bq,
            "Spider":      (row.get("Spider") or "").strip(),
            "Liste":       liste,
        })

    jobs_mod.save_corrections(rows)
    return {"saved": len(rows), "message": "Korrekturtabelle gespeichert."}


@app.get(
    "/correction-list/template",
    summary="Korrekturtabellen-Vorlage herunterladen",
    tags=["Korrekturtabelle"],
    response_description="CSV-Vorlage mit Beispielzeile",
)
def correction_list_template():
    """
    Lädt eine leere CSV-Vorlage mit Beispielzeilen zum Befüllen herunter.

    **Spalten:** `Node-Id` | `Titel` | `Url` | `Bezugsquelle` | `Spider` | `Liste`

    - `Node-Id`: WLO nodeId des Quelldatensatzes (z. B. aus dem Redaktions-Backend).
      Beim nächsten Job werden Metadaten (Titel, URL) automatisch abgerufen.
    - `Titel`: Exakter Titel für Titelabgleich (kann leer bleiben, wenn Node-Id gesetzt).
    - `Url`: URL/wwwUrl des Quelldatensatzes für Domain-Matching.
    - `Bezugsquelle`: Ziel-Bezugsquelle (**Pflichtfeld**, exakter Facetten-Wert).
    - `Spider`: `1` = Quelle ist Crawler-erschlossen und hat Vorrang bei Duplikaten.
    - `Liste`: `whitelist` (Standard/leer) = dieser Datensatz wird als bester Vertreter bevorzugt.
      `blacklist` = dieser Datensatz ist ein bekanntes Duplikat und wird nie als primär markiert.
    """
    content = (
        "Node-Id;Titel;Url;Bezugsquelle;Spider;Liste\n"
        "744e3c29-c20f-438e-8841-8c8f44239dc4;;https://www.bpb.de;Bundeszentrale für politische Bildung;0;whitelist\n"
        ";;https://www.zdf.de;ZDF – Zweites Deutsches Fernsehen;0;whitelist\n"
        "abc12345-0000-0000-0000-000000000001;;https://crawler-beispiel.de;Beispiel Crawler-Quelle;1;whitelist\n"
        "dup99999-0000-0000-0000-000000000002;;https://duplikat-beispiel.de;Beispiel Quelle;0;blacklist\n"
        ";Mein Quelldatensatz-Titel;https://beispiel.de;Beispiel Verlag GmbH;0;whitelist\n"
    )
    return StreamingResponse(
        iter([content]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=quellen_korrektur_vorlage.csv"},
    )


# ---------------------------------------------------------------------------
# Routen: Webkomponente
# ---------------------------------------------------------------------------

_PUBLIC_DIR = Path(__file__).parent / "public"
_WC_DIR     = _PUBLIC_DIR / "wc"

_WC_FILES = ["main.js", "polyfills.js", "styles.css"]

_WC_ATTRIBUTES = [
    {"name": "api-base",        "type": "string", "default": '""',      "description": "URL der API. Pflicht bei externer Einbettung (leer = gleicher Origin)."},
    {"name": "view",            "type": "string", "default": '"tile"',   "description": "Startansicht: tile (Kacheln) · list (Tabelle) · stats (Statistiken)."},
    {"name": "min-count",       "type": "number", "default": "5",       "description": "Nur Quellen mit mindestens N Inhalten anzeigen (0 = alle)."},
    {"name": "csv-url",         "type": "string", "default": '""',      "description": "URL zu einer externen CSV-Datenquelle (optional, überschreibt API-Daten)."},
    {"name": "primary-color",   "type": "color",  "default": "#003b7c", "description": "Hauptfarbe (Header, Badges, Buttons)."},
    {"name": "secondary-color", "type": "color",  "default": "#002d5f", "description": "Sekundärfarbe."},
    {"name": "accent-color",    "type": "color",  "default": "#f97316", "description": "Akzentfarbe (Highlights, Hover)."},
    {"name": "bg-color",        "type": "color",  "default": "#f4f7fc", "description": "Hintergrundfarbe der Komponente."},
    {"name": "card-bg",         "type": "color",  "default": "#ffffff", "description": "Hintergrundfarbe der Kacheln/Karten."},
    {"name": "text-color",      "type": "color",  "default": "#12213a", "description": "Textfarbe."},
]


def _wc_file_info(base_url: str) -> list[dict]:
    """Dateigrößen der WC-Dateien ermitteln."""
    infos = []
    for name in _WC_FILES:
        path = _WC_DIR / name
        size_bytes = path.stat().st_size if path.exists() else 0
        size_kb    = round(size_bytes / 1024, 1)
        infos.append({
            "file": name,
            "url":  f"{base_url}/wc/{name}",
            "sizeBytes": size_bytes,
            "sizeKB":    size_kb,
        })
    return infos


@app.get(
    "/wc/info",
    summary="Webkomponente – Einbettungs-Infos und Attribut-Referenz",
    tags=["Webkomponente"],
    response_description="JSON mit Dateien, Einbettungs-Snippet, Attributen und Beispiel-URL",
)
def wc_info(
    base_url: str = Query(
        "",
        description=(
            "Basis-URL der API für die generierten Snippets "
            "(z.B. `https://wlo-quellenliste-api.vercel.app`). "
            "Leer = relative Pfade."
        ),
    ),
):
    """
    Gibt alle Informationen zurück, die zum Einbetten der **`<wlo-sources>`**
    Webkomponente benötigt werden:

    - **files**: Liste der drei Dateien (`main.js`, `polyfills.js`, `styles.css`)
      mit URLs und Dateigrößen
    - **snippet**: Copy-paste-fähiges HTML-Snippet
    - **attributes**: Vollständige Attribut-Referenz mit Typ, Default und Beschreibung
    - **exampleUrl**: Link zur interaktiven Demo-Seite
    - **tag**: HTML-Tag-Name der Webkomponente

    **Beispiel-Aufruf:**
    ```
    GET /wc/info?base_url=https://wlo-quellenliste-api.vercel.app
    ```
    """
    base = base_url.rstrip("/") if base_url else ""
    files = _wc_file_info(base)

    snippet = (
        f'<script src="{base}/wc/polyfills.js"></script>\n'
        f'<script src="{base}/wc/main.js"></script>\n'
        f'<link rel="stylesheet" href="{base}/wc/styles.css">\n\n'
        f'<wlo-sources api-base="{base}"></wlo-sources>'
    )

    snippet_full = (
        '<!DOCTYPE html>\n'
        '<html lang="de">\n'
        '<head>\n'
        '  <meta charset="UTF-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        '  <title>WLO Quellenverzeichnis</title>\n'
        f'  <script src="{base}/wc/polyfills.js"></script>\n'
        f'  <script src="{base}/wc/main.js"></script>\n'
        f'  <link rel="stylesheet" href="{base}/wc/styles.css">\n'
        '</head>\n'
        '<body>\n'
        f'  <wlo-sources api-base="{base}"></wlo-sources>\n'
        '</body>\n'
        '</html>'
    )

    example_url = f"{base}/example.html" if base else "/public/example.html"

    return {
        "tag": "wlo-sources",
        "files": files,
        "snippet": snippet,
        "snippetFullHtml": snippet_full,
        "attributes": _WC_ATTRIBUTES,
        "exampleUrl": example_url,
        "cors": "Access-Control-Allow-Origin: * (alle Dateien unter /wc/)",
    }


# ---------------------------------------------------------------------------
# Statische Dateien (Webkomponente + Example-Seite)
# ---------------------------------------------------------------------------
# Muss NACH allen API-Routen montiert werden, damit API-Pfade Vorrang haben.
# Auf Vercel werden statische Dateien über vercel.json geroutet;
# dieser Mount dient der lokalen Entwicklung mit uvicorn.

if _PUBLIC_DIR.is_dir():
    app.mount("/wc", StaticFiles(directory=_PUBLIC_DIR / "wc"), name="wc")
    app.mount("/public", StaticFiles(directory=_PUBLIC_DIR, html=True), name="public")
