"""
jobs.py
-------
Asynchrones Job-Management für den Daten-Refresh-Prozess.

Jeder Job durchläuft folgende Status-Kette:
  pending → fetching_quellen → fetching_facets → merging → done
                                                          ↘ error

Jobs werden in-memory gehalten (dict) und beim Start serialisiert
damit der aktuelle Job nach einem Neustart sichtbar bleibt.
"""

import json
import logging
import os
import shutil
import threading
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fetcher
import merger
import stats as stats_mod

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pfade – auf Vercel ist das FS read-only; /tmp/ ist beschreibbar.
# ---------------------------------------------------------------------------

_DEPLOY_DATA = Path(__file__).parent / "data"

if os.environ.get("VERCEL"):
    DATA_DIR = Path("/tmp/data")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Beim Cold-Start: vorhandene Dateien aus dem Deploy-Bundle nach /tmp kopieren
    if _DEPLOY_DATA.is_dir():
        for src_file in _DEPLOY_DATA.iterdir():
            dst = DATA_DIR / src_file.name
            if not dst.exists():
                shutil.copy2(src_file, dst)
                log.info("Vercel cold-start: %s → %s", src_file.name, dst)
else:
    DATA_DIR = _DEPLOY_DATA
    DATA_DIR.mkdir(exist_ok=True)

MERGED_FILE     = DATA_DIR / "quellen_merged.json"
STATS_FILE      = DATA_DIR / "quellen_stats.json"
CORRECTION_FILE = DATA_DIR / "quellen_korrektur.csv"
JOBS_FILE       = DATA_DIR / "jobs.json"


# ---------------------------------------------------------------------------
# Job-Datenstruktur
# ---------------------------------------------------------------------------

# Status-Labels für die Anzeige
STATUS_LABELS = {
    "pending":           "Wartet auf Start …",
    "fetching_quellen":  "Quelldatensätze werden abgerufen …",
    "fetching_facets":   "Bezugsquellen-Facetten werden abgerufen …",
    "merging":           "Daten werden zusammengeführt …",
    "done":              "Fertig",
    "error":             "Fehler",
}


class Job:
    def __init__(self, job_id: str | None = None):
        self.id        = job_id or str(uuid.uuid4())
        self.status    = "pending"
        self.message   = ""
        self.progress  = {"fetched": 0, "total": 0}
        self.created   = _now()
        self.updated   = _now()
        self.error     = None
        self.result_summary: dict = {}
        self.steps:    list[dict] = []   # Schritthistorie

    def _elapsed(self) -> float:
        from datetime import datetime
        try:
            t0 = datetime.fromisoformat(self.created)
            t1 = datetime.fromisoformat(self.updated)
            return round((t1 - t0).total_seconds(), 1)
        except Exception:
            return 0.0

    def to_dict(self) -> dict:
        return {
            "id":              self.id,
            "status":          self.status,
            "statusLabel":     STATUS_LABELS.get(self.status, self.status),
            "message":         self.message,
            "progress":        self.progress,
            "elapsedSeconds":  self._elapsed(),
            "created":         self.created,
            "updated":         self.updated,
            "error":           self.error,
            "steps":           self.steps,
            "resultSummary":   self.result_summary,
        }

    def update(self, status: str, message: str = "", **kwargs):
        # Schritt in Verlauf schreiben wenn sich Status ändert
        if status != self.status:
            self.steps.append({
                "status":  status,
                "label":   STATUS_LABELS.get(status, status),
                "message": message,
                "at":      _now(),
            })
        self.status  = status
        self.message = message
        self.updated = _now()
        for k, v in kwargs.items():
            setattr(self, k, v)
        _save_jobs()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Job-Registry (in-memory)
# ---------------------------------------------------------------------------

_jobs: dict[str, Job] = {}
_lock = threading.Lock()


def _save_jobs():
    try:
        with open(JOBS_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {jid: j.to_dict() for jid, j in _jobs.items()},
                f, ensure_ascii=False, indent=2,
            )
    except Exception:
        pass


def load_jobs_from_disk():
    """Beim Start: bisherige Jobs einlesen."""
    if not JOBS_FILE.exists():
        return
    try:
        with open(JOBS_FILE, encoding="utf-8") as f:
            raw = json.load(f)
        for jid, d in raw.items():
            j = Job(jid)
            j.__dict__.update({k: d[k] for k in d if hasattr(j, k)})
            # Jobs die beim letzten Lauf noch liefen → als error markieren
            if j.status not in ("done", "error"):
                j.status  = "error"
                j.error   = "Server-Neustart während des Jobs"
                j.updated = _now()
            _jobs[jid] = j
        log.info("Jobs aus Disk geladen: %d Einträge", len(_jobs))
    except Exception as exc:
        log.warning("Jobs-Datei nicht lesbar: %s", exc)


def get_job(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def list_jobs(limit: int = 20) -> list[dict]:
    with _lock:
        jobs = sorted(_jobs.values(), key=lambda j: j.created, reverse=True)
        return [j.to_dict() for j in jobs[:limit]]


def latest_job() -> dict | None:
    with _lock:
        if not _jobs:
            return None
        j = max(_jobs.values(), key=lambda j: j.created)
        return j.to_dict()


# ---------------------------------------------------------------------------
# Korrekturtabelle laden
# ---------------------------------------------------------------------------

def load_corrections() -> list[dict]:
    if not CORRECTION_FILE.exists():
        return []
    import csv
    try:
        with open(CORRECTION_FILE, newline="", encoding="utf-8-sig") as f:
            text = f.read()
        sep = ";" if text.count(";") > text.count(",") else ","
        import io
        return list(csv.DictReader(io.StringIO(text), delimiter=sep))
    except Exception as exc:
        log.warning("Korrekturtabelle nicht lesbar: %s", exc)
        return []


def save_corrections(rows: list[dict]) -> None:
    import csv
    fieldnames = ["Node-Id", "Titel", "Url", "Bezugsquelle", "Spider", "Liste"]
    with open(CORRECTION_FILE, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


# ---------------------------------------------------------------------------
# Persistierter Merged-Datensatz
# ---------------------------------------------------------------------------

def load_merged() -> list[dict] | None:
    if not MERGED_FILE.exists():
        return None
    try:
        with open(MERGED_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def load_stats() -> dict | None:
    if not STATS_FILE.exists():
        return None
    try:
        with open(STATS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_merged(records: list[dict], job: Job) -> None:
    with open(MERGED_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False)
    log.info("Merged-Datensatz gespeichert: %d Einträge", len(records))


def _save_stats(data: dict) -> None:
    with open(STATS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Hintergrund-Job
# ---------------------------------------------------------------------------

def _run_job(job: Job) -> None:
    try:
        # ── Stufe 1: Quelldatensätze ──────────────────────────────────────
        job.update("fetching_quellen", "Rufe Quelldatensätze ab …")

        def _prog(fetched: int, total: int):
            job.progress = {"fetched": fetched, "total": total}
            job.updated  = _now()
            _save_jobs()

        quellen = fetcher.fetch_quellen(progress_cb=_prog)
        job.update("fetching_quellen",
                   f"{len(quellen)} Quelldatensätze geladen",
                   progress={"fetched": len(quellen), "total": len(quellen)})

        # ── Stufe 2: Facetten ─────────────────────────────────────────────
        job.update("fetching_facets", "Rufe Bezugsquellen-Facetten ab …")
        facets = fetcher.fetch_facets()
        job.update("fetching_facets",
                   f"{len(facets)} Bezugsquellen-Facetten geladen")

        # ── Stufe 3a: NodeId-Dedup (API-Artefakt) ────────────────────────
        job.update("merging", "Entferne API-Artefakt-Dubletten (gleiche nodeId) …")
        quellen_deduped, node_dups = merger.dedup_by_node_id(quellen)
        if node_dups:
            job.update("merging",
                       f"{node_dups} API-Artefakt-Dubletten entfernt "
                       f"({len(quellen_deduped)} verbleibend)")

        # ── Stufe 3b: Korrekturen laden + anreichern ────────────────────────
        corrections_raw = load_corrections()
        # Nur Whitelist-Einträge mit Node-Id benötigen Metadaten-Abruf;
        # Blacklist-Einträge werden beim Merge vollständig entfernt
        whitelist_with_id = [
            r for r in corrections_raw
            if (r.get("Node-Id") or "").strip()
            and str(r.get("Liste") or "").strip().lower() != "blacklist"
        ]
        if whitelist_with_id:
            job.update("merging",
                       f"Rufe WLO-Metadaten für {len(whitelist_with_id)} Whitelist-Einträge ab …")
            corrections = fetcher.enrich_corrections_from_nodes(corrections_raw)
        else:
            corrections = corrections_raw

        # ── Stufe 3c: Merge ───────────────────────────────────────────────
        job.update("merging", "Führe Daten zusammen …")
        merged_raw, blacklist_removed = merger.merge(quellen_deduped, facets, corrections)

        # ── Stufe 3d: Metadaten-Anreicherung für Top-Facets-only ────────
        job.update("enriching", "Reichere Top-Quellen mit Metadaten an …")
        fetcher.enrich_facets_only(
            merged_raw, min_count=5, max_enrich=500,
            progress_cb=lambda done, total: job.update(
                "enriching", f"Metadaten: {done}/{total} …"
            ),
        )

        # ── Stufe 3e: Primär-Markierung (alle Records behalten) ──────────
        job.update("merging", "Primär-Markierung läuft …")
        merged, non_primary = merger.assign_primary(merged_raw)
        report       = merger.match_report(merged)

        # ── Stufe 4: Statistiken ──────────────────────────────────────────
        job.update("merging", "Berechne Statistiken …")
        stat_data = stats_mod.compute(merged)

        # ── Speichern ─────────────────────────────────────────────────────
        _save_merged(merged, job)
        _save_stats(stat_data)

        primary_count = len(merged) - non_primary
        summary: dict[str, Any] = {
            "total":                    len(merged),
            "primaryRecords":           primary_count,
            "secondaryRecords":         non_primary,
            "withNodeId":               report["withNodeId"],
            "facetsOnly":               report["facetsOnly"],
            "nodeDuplicatesRemoved":    node_dups,
            "blacklistRemoved":         blacklist_removed,
            "matchReport":              report,
            "generated":                _now(),
        }
        job.update("done", "Fertig", result_summary=summary)
        log.info("Job %s abgeschlossen: %d Quellen", job.id, len(merged))

    except Exception as exc:
        tb = traceback.format_exc()
        log.error("Job %s fehlgeschlagen: %s\n%s", job.id, exc, tb)
        job.update("error", str(exc), error=tb)


def start_job(sync: bool = False) -> Job:
    """Startet einen neuen Refresh-Job.

    Args:
        sync: ``True`` = Job blockierend im aktuellen Thread ausführen
              (nötig auf Vercel, wo Hintergrund-Threads nach der Response
              beendet werden).  ``False`` (Default) = Hintergrund-Thread.
    """
    job = Job()
    with _lock:
        _jobs[job.id] = job
    _save_jobs()

    if sync:
        log.info("Job %s gestartet (synchron)", job.id)
        _run_job(job)
    else:
        t = threading.Thread(target=_run_job, args=(job,), daemon=True)
        t.start()
        log.info("Job %s gestartet (async)", job.id)
    return job
