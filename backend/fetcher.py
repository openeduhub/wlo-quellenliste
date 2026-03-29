"""
fetcher.py
----------
Rohdaten-Abruf von der WLO-Produktion:
  - fetch_quellen()  : alle Quelldatensätze (LRT=Quelle, paginiert)
  - fetch_facets()   : alle Bezugsquellen + Inhaltsanzahl (1 API-Call, Facetten)
"""

import re
import time
import logging
from typing import Callable

import requests

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

WLO_API = (
    "https://redaktion.openeduhub.net"
    "/edu-sharing/rest/search/v1/queries/-home-/mds_oeh/ngsearch"
)
WLO_NODE_API = (
    "https://redaktion.openeduhub.net"
    "/edu-sharing/rest/node/v1/nodes/-home-"
)
LRT_QUELLE = (
    "http://w3id.org/openeduhub/vocabs/new_lrt_aggregated/"
    "2e678af3-1026-4171-b88e-3b3a915d1673"
)

BATCH_SIZE   = 500
FACET_LIMIT  = 100_000
REQUEST_TIMEOUT = 30
PAUSE_S      = 0.05   # Pause zwischen Batch-Anfragen


# ---------------------------------------------------------------------------
# Hilfsextraktoren für Node-Properties
# ---------------------------------------------------------------------------

def _normalize_url(url: str | None) -> str:
    """http→https, www entfernen, trailing slash entfernen."""
    if not url:
        return ""
    u = str(url).strip()
    u = re.sub(r"^http://", "https://", u)
    u = re.sub(r"^(https://)www\.", r"\1", u)
    u = u.rstrip("/")
    return u


def _get(props: dict, key: str) -> str:
    return (props.get(key) or [""])[0]

def _getA(props: dict, key: str) -> list[str]:
    return [str(v) for v in (props.get(key) or []) if v]


def extract_record(node: dict) -> dict:
    """Normalisiert einen rohen API-Node zu einem flachen Record-Dict."""
    p       = node.get("properties", {})
    ref     = node.get("ref") or {}
    content = node.get("content") or {}
    preview = node.get("preview") or {}

    title   = _get(p, "cclom:title") or node.get("title") or node.get("name") or ""
    wwwurl  = _normalize_url(content.get("url") or _get(p, "ccm:wwwurl") or "")

    # OER-Erkennung
    oer_raw = _get(p, "ccm:license_oer").lower()
    oer     = oer_raw in ("true", "1") or "/oer/" in oer_raw

    # Erschließung / Spider
    repl = _get(p, "ccm:replicationsource")
    is_spider = bool(repl and repl.strip())

    return {
        # Identifikation
        "nodeId":            ref.get("id") or _get(p, "sys:node-uuid") or "",
        "publisher":         _get(p, "ccm:oeh_publisher_combined"),
        # Angezeigte Felder
        "title":             title,
        "description":       _get(p, "cclom:general_description"),
        "wwwUrl":            wwwurl,
        "previewUrl":        preview.get("url") or "",
        # Klassifikation
        "subjects":          _getA(p, "ccm:taxonid_DISPLAYNAME"),
        "educationalContext":_getA(p, "ccm:educationalcontext_DISPLAYNAME"),
        "oehLrt":            _getA(p, "ccm:oeh_lrt_aggregated_DISPLAYNAME"),
        # Lizenz
        "license":           _get(p, "ccm:commonlicense_key"),
        "licenseVersion":    _get(p, "ccm:commonlicense_cc_version"),
        "oer":               oer,
        # Qualität (Roh-Werte für parseQualityFlags in der Webkomponente)
        "loginRaw":          _get(p, "ccm:conditionsOfAccess"),
        "loginRawLbl":       _get(p, "ccm:conditionsOfAccess_DISPLAYNAME"),
        "loginFallback":     _get(p, "ccm:oeh_quality_login"),
        "adsRaw":            _get(p, "ccm:oeh_quality_advertising"),
        "priceRaw":          _get(p, "ccm:price"),
        "priceRawLbl":       _get(p, "ccm:price_DISPLAYNAME"),
        "gdprRaw":           _get(p, "ccm:dataProtectionConformity"),
        "gdprRawLbl":        _get(p, "ccm:dataProtectionConformity_DISPLAYNAME"),
        "gdprFallback":      _get(p, "ccm:oeh_quality_dataProtectionConform"),
        "accessRaw":         _get(p, "ccm:oeh_accessibility_open"),
        "accessRawLbl":      _get(p, "ccm:oeh_accessibility_open_DISPLAYNAME"),
        # Rechtliche Qualität (Skala 0–5 + optionaler DISPLAYNAME)
        "lawMinors":         _get(p, "ccm:oeh_quality_protection_of_minors"),
        "lawMinorsLbl":      _get(p, "ccm:oeh_quality_protection_of_minors_DISPLAYNAME"),
        "lawPrivacy":        _get(p, "ccm:oeh_quality_data_privacy"),
        "lawPrivacyLbl":     _get(p, "ccm:oeh_quality_data_privacy_DISPLAYNAME"),
        "lawPersonal":       _get(p, "ccm:oeh_quality_personal_law"),
        "lawPersonalLbl":    _get(p, "ccm:oeh_quality_personal_law_DISPLAYNAME"),
        "lawCriminal":       _get(p, "ccm:oeh_quality_criminal_law"),
        "lawCriminalLbl":    _get(p, "ccm:oeh_quality_criminal_law_DISPLAYNAME"),
        "lawCopyright":      _get(p, "ccm:oeh_quality_copyright_law"),
        "lawCopyrightLbl":   _get(p, "ccm:oeh_quality_copyright_law_DISPLAYNAME"),
        # Inhaltliche Qualität (Skala 0–5)
        "qCurrentness":      _get(p, "ccm:oeh_quality_currentness"),
        "qCurrentnessLbl":   _get(p, "ccm:oeh_quality_currentness_DISPLAYNAME"),
        "qNeutralness":      _get(p, "ccm:oeh_quality_neutralness"),
        "qNeutralnessLbl":   _get(p, "ccm:oeh_quality_neutralness_DISPLAYNAME"),
        "qLanguage":         _get(p, "ccm:oeh_quality_language"),
        "qLanguageLbl":      _get(p, "ccm:oeh_quality_language_DISPLAYNAME"),
        "qCorrectness":      _get(p, "ccm:oeh_quality_correctness"),
        "qCorrectnessLbl":   _get(p, "ccm:oeh_quality_correctness_DISPLAYNAME"),
        "qMedial":           _get(p, "ccm:oeh_quality_medial"),
        "qMedialLbl":        _get(p, "ccm:oeh_quality_medial_DISPLAYNAME"),
        "qTransparent":      _get(p, "ccm:oeh_quality_transparentness"),
        "qTransparentLbl":   _get(p, "ccm:oeh_quality_transparentness_DISPLAYNAME"),
        "qDidactics":        _get(p, "ccm:oeh_quality_didactics"),
        "qDidacticsLbl":     _get(p, "ccm:oeh_quality_didactics_DISPLAYNAME"),
        # Zugänglichkeit (verschiedene Skalen)
        "qInterop":          _get(p, "ccm:oeh_interoperability"),
        "qInteropLbl":       _get(p, "ccm:oeh_interoperability_DISPLAYNAME"),
        "qAdvertisement":    _get(p, "ccm:containsAdvertisement"),
        "qAdvertisementLbl": _get(p, "ccm:containsAdvertisement_DISPLAYNAME"),
        "qUsability":        _get(p, "ccm:oeh_usability"),
        "qUsabilityLbl":     _get(p, "ccm:oeh_usability_DISPLAYNAME"),
        "qSecurity":         _get(p, "ccm:oeh_accessibility_security"),
        "qSecurityLbl":      _get(p, "ccm:oeh_accessibility_security_DISPLAYNAME"),
        "qFind":             _get(p, "ccm:oeh_accessibility_find"),
        "qFindLbl":          _get(p, "ccm:oeh_accessibility_find_DISPLAYNAME"),
        "qBarrier":          _get(p, "ccm:accessibilitySummary"),
        # Erschließung
        "isSpider":          is_spider,
        "replicationSource": repl,
        "editorialStatus":   _get(p, "ccm:editorial_checklist_DISPLAYNAME"),
        # Sprache / Keywords
        "language":          _get(p, "cclom:general_language_DISPLAYNAME") or _get(p, "cclom:general_language"),
        "keywords":          " | ".join(_getA(p, "cclom:general_keyword")[:10]),
        # Zeitstempel
        "created":           node.get("createdAt") or "",
        "modified":          node.get("modifiedAt") or "",
        "nodeType":          node.get("nodeType") or "",
    }


# ---------------------------------------------------------------------------
# Einzelner Knoten per nodeId
# ---------------------------------------------------------------------------

def fetch_node_metadata(node_id: str) -> dict | None:
    """
    Ruft Metadaten eines einzelnen WLO-Knotens per nodeId ab.

    GET /edu-sharing/rest/node/v1/nodes/-home-/{nodeId}/metadata?propertyFilter=-all-

    Gibt einen extract_record()-Dict zurück oder None bei Fehler / nicht gefunden.
    """
    nid = (node_id or "").strip()
    if not nid:
        return None
    url = f"{WLO_NODE_API}/{nid}/metadata?propertyFilter=-all-"
    try:
        resp = requests.get(
            url,
            headers={"Accept": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code == 200:
            node = resp.json().get("node") or {}
            if node:
                return extract_record(node)
        elif resp.status_code == 404:
            log.warning("fetch_node_metadata: nodeId %s nicht gefunden (404)", nid)
        else:
            log.warning("fetch_node_metadata: nodeId %s → HTTP %d", nid, resp.status_code)
    except Exception as exc:
        log.warning("fetch_node_metadata(%s) Fehler: %s", nid, exc)
    return None


def enrich_corrections_from_nodes(corrections: list[dict]) -> list[dict]:
    """
    Reichert Korrektur-Einträge mit 'Node-Id' durch WLO-API-Metadaten an.

    Für jeden Eintrag mit gesetzter 'Node-Id' wird
    ``fetch_node_metadata()`` aufgerufen. Fehlende Felder (Titel, Url)
    werden aus den API-Daten ergänzt. Der vollständige Record wird
    unter ``_fetched_record`` hinterlegt, damit der Merger darauf
    zugreifen kann.

    Gibt die angereicherte Liste zurück (in-place + Rückgabe).
    """
    enriched = 0
    for row in corrections:
        nid = (row.get("Node-Id") or "").strip()
        if not nid:
            continue
        # Blacklist-Einträge werden beim Merge entfernt → kein API-Abruf nötig
        if str(row.get("Liste") or "").strip().lower() == "blacklist":
            continue
        rec = fetch_node_metadata(nid)
        if not rec:
            continue
        if not row.get("Titel") and rec.get("title"):
            row["Titel"] = rec["title"]
        if not row.get("Url") and rec.get("wwwUrl"):
            row["Url"] = rec["wwwUrl"]
        row["_fetched_record"] = rec
        enriched += 1
        log.info(
            "Korrektur angereichert: nodeId=%s title=%s url=%s",
            nid, rec.get("title", "")[:60], rec.get("wwwUrl", ""),
        )
        time.sleep(PAUSE_S)
    if enriched:
        log.info(
            "enrich_corrections_from_nodes: %d / %d Eintr\u00e4ge angereichert",
            enriched, len(corrections),
        )
    return corrections


# ---------------------------------------------------------------------------
# Quelldatensätze abrufen (paginiert)
# ---------------------------------------------------------------------------

def fetch_quellen(
    progress_cb: Callable[[int, int], None] | None = None
) -> list[dict]:
    """
    Ruft alle Quelldatensätze via LRT-Filter ab (paginiert).
    Gibt eine Liste von extract_record()-Dicts zurück.

    progress_cb(fetched, total) wird nach jedem Batch aufgerufen.
    """
    records: list[dict] = []
    skip    = 0
    total   = None

    log.info("Starte Quelldatensatz-Abruf …")

    while True:
        params = (
            f"contentType=ALL"
            f"&maxItems={BATCH_SIZE}"
            f"&skipCount={skip}"
            f"&propertyFilter=-all-"
            f"&sortProperties=sys%3Anode-uuid"
            f"&sortAscending=true"
        )
        body = {
            "criteria": [
                {"property": "ccm:oeh_lrt_aggregated", "values": [LRT_QUELLE]}
            ]
        }

        resp = requests.post(
            f"{WLO_API}?{params}",
            json=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()

        if total is None:
            total = data.get("pagination", {}).get("total", 0)
            log.info("API meldet %d Quelldatensätze gesamt", total)

        nodes = data.get("nodes", [])
        if not nodes:
            break

        for node in nodes:
            records.append(extract_record(node))

        skip += len(nodes)
        if progress_cb:
            progress_cb(skip, total or skip)

        log.debug("  %d / %d geladen", skip, total)

        if skip >= (total or 0):
            break

        time.sleep(PAUSE_S)

    log.info("Quelldatensatz-Abruf abgeschlossen: %d Datensätze", len(records))
    return records


# ---------------------------------------------------------------------------
# Bezugsquellen + Inhaltsanzahl via Facetten (1 API-Call)
# ---------------------------------------------------------------------------

def fetch_facets() -> list[dict]:
    """
    Gibt eine Liste von {"value": "Publisher Name", "count": 42} zurück.
    Umfasst ALLE Bezugsquellen mit mindestens 1 Inhalt.
    """
    log.info("Starte Facetten-Abruf …")

    body = {
        "criteria": [{"property": "ngsearchword", "values": ["*"]}],
        "facetLimit":    FACET_LIMIT,
        "facetMinCount": 1,
        "facets":        [{"property": "ccm:oeh_publisher_combined"}],
    }
    resp = requests.post(
        f"{WLO_API}?contentType=ALL&maxItems=1&skipCount=0",
        json=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()

    groups = data.get("facets", [])
    if not groups:
        raise ValueError("Keine Facetten in der API-Antwort.")

    values = groups[0].get("values", [])
    log.info("Facetten-Abruf: %d Bezugsquellen", len(values))
    return values


# ---------------------------------------------------------------------------
# Metadaten-Anreicherung für Facets-only-Records
# ---------------------------------------------------------------------------

def enrich_facets_only(
    records: list[dict],
    min_count: int = 50,
    max_enrich: int = 300,
    progress_cb: Callable[[int, int], None] | None = None,
) -> int:
    """
    Reichert Facets-only-Records an, die mindestens *min_count* Inhalte haben.

    Für jeden Record wird 1 Content-Node per Publisher-Suche abgerufen
    und Metadaten (Vorschau, Beschreibung, Fächer, Bildungsstufe, Lizenz,
    Spider-Status, Qualitäts-Rohdaten) daraus übernommen.

    Gibt die Anzahl angereicherter Records zurück.
    """
    candidates = [
        r for r in records
        if r.get("matchStage") == 7
        and r.get("contentCount", 0) >= min_count
        and not r.get("previewUrl")
    ]
    # Absteigend nach contentCount → wichtigste zuerst
    candidates.sort(key=lambda r: r.get("contentCount", 0), reverse=True)
    candidates = candidates[:max_enrich]

    if not candidates:
        return 0

    log.info(
        "enrich_facets_only: %d Facets-only-Records (contentCount >= %d) anreichern …",
        len(candidates), min_count,
    )

    enriched = 0
    for i, rec in enumerate(candidates):
        publisher = rec.get("name") or ""
        if not publisher:
            continue

        # Alle BQ-Varianten des Records als Suchbegriffe nutzen
        bqs = rec.get("bezugsquellen") or [publisher]

        try:
            body = {
                "criteria": [
                    {"property": "ccm:oeh_publisher_combined", "values": bqs}
                ]
            }
            resp = requests.post(
                f"{WLO_API}?contentType=FILES&maxItems=1&skipCount=0&propertyFilter=-all-",
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code != 200:
                continue

            nodes = resp.json().get("nodes", [])
            if not nodes:
                continue

            meta = extract_record(nodes[0])

            # Metadaten übernehmen (nur nicht-leere Werte)
            if meta.get("previewUrl"):
                rec["previewUrl"] = meta["previewUrl"]
            if meta.get("description"):
                rec["description"] = meta["description"]
            if meta.get("subjects"):
                rec["subjects"] = meta["subjects"]
            if meta.get("educationalContext"):
                rec["educationalContext"] = meta["educationalContext"]
            if meta.get("oehLrt"):
                rec["oehLrt"] = meta["oehLrt"]
            if meta.get("license"):
                rec["license"] = meta["license"]
                rec["licenseVersion"] = meta.get("licenseVersion", "")
            if meta.get("language"):
                rec["language"] = meta["language"]
            if meta.get("isSpider"):
                rec["isSpider"] = True
                rec["replicationSource"] = meta.get("replicationSource", "")
            if meta.get("oer"):
                rec["oer"] = True
            # Qualitäts-Rohdaten (alle Felder)
            _q_fields = (
                "loginRaw", "loginRawLbl", "loginFallback", "adsRaw",
                "priceRaw", "priceRawLbl", "gdprRaw", "gdprRawLbl", "gdprFallback",
                "accessRaw", "accessRawLbl",
                "lawMinors", "lawMinorsLbl", "lawPrivacy", "lawPrivacyLbl",
                "lawPersonal", "lawPersonalLbl", "lawCriminal", "lawCriminalLbl",
                "lawCopyright", "lawCopyrightLbl",
                "qCurrentness", "qCurrentnessLbl", "qNeutralness", "qNeutralnessLbl",
                "qLanguage", "qLanguageLbl", "qCorrectness", "qCorrectnessLbl",
                "qMedial", "qMedialLbl", "qTransparent", "qTransparentLbl",
                "qDidactics", "qDidacticsLbl",
                "qInterop", "qInteropLbl", "qAdvertisement", "qAdvertisementLbl",
                "qUsability", "qUsabilityLbl", "qSecurity", "qSecurityLbl",
                "qFind", "qFindLbl", "qBarrier",
                "editorialStatus",
            )
            for qf in _q_fields:
                if meta.get(qf):
                    rec[qf] = meta[qf]

            enriched += 1

        except Exception as exc:
            log.warning("enrich_facets_only(%s) Fehler: %s", publisher[:40], exc)

        if progress_cb and (i + 1) % 50 == 0:
            progress_cb(i + 1, len(candidates))

        time.sleep(PAUSE_S)

    log.info("enrich_facets_only: %d / %d Records angereichert", enriched, len(candidates))
    return enriched
