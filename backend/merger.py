"""
merger.py
---------
Mehrstufige Matching-Kaskade (ohne KI):

  Stufe 1  – Korrektur-Override    (NodeId / Titel / URL-Domain aus Korrekturtabelle)
  Stufe 2  – publisher_combined    (exakt, umlaut-normalisiert via _norm())
  Stufe 2b – Spider-Titel          (Spider-Nodes: title = echter Quellenname, publisher = Crawler)
  Stufe 3  – Titel exakt           (normalisiert)
  Stufe 4a – Domain-Match          (normalisierte URL ↔ Facetten-Eintrag der wie Domain aussieht)
  Stufe 4b – Publisher-Containment (BQ-Name als Teilstring im Publisher oder umgekehrt, min 5 Zeichen)
  Stufe 5  – Substring             (Bezugsquelle als Teilstring im Titel, min 5 Zeichen)
  Stufe 5b – Ignored-Publisher     (Titel whitespace-frei gegen Facetten, für WirLernenOnline u.ä.)
  Stufe 6  – Facets-only           (Bezugsquellen ohne eigenen Quelldatensatz)

Kein Fuzzy-/SequenceMatcher-Matching — alle Stufen nutzen exakte
String-Operationen (Dict-Lookups, Containment).
Normalisierung via _norm(): lowercase + NFD + Combining-Marks entfernen (ü→u).

Eingabe:
  records     – Liste von extract_record()-Dicts (aus fetcher.py)
  facets      – Liste von {"value": str, "count": int} (aus fetcher.py)
  corrections – Liste von {"Node-Id": str, "Titel": str, "Url": str,
                            "Bezugsquelle": str, "Spider": str, "Liste": str}
                Spider: "1"/"true" markiert die Quelle als Crawler-Quelle
                Liste:  "whitelist" (Standard/leer) = bevorzugter primärer Record;
                        "blacklist" = NodeId ist bekanntes Duplikat → nie primär
                Node-Id: WLO nodeId → direktes Matching; Metadaten wurden
                         in fetcher.enrich_corrections_from_nodes() vorab
                         abgerufen und in "_fetched_record" hinterlegt

Ausgabe:
  Liste von Dicts mit allen record-Feldern plus:
    name, contentCount, matchStage, matchSource, matchConfidence
"""

import re
import unicodedata
import logging
from urllib.parse import urlparse

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schwellenwerte
# ---------------------------------------------------------------------------

DOMAIN_NOISE = frozenset({
    "com", "org", "net", "edu", "info", "blog", "de", "es", "at", "ch",
    "uk", "io", "gov", "nz", "tv", "www", "https", "http", "co", "int",
})

# Publisher, die bei einer Datenmigration fehlerhaft in ccm:oeh_publisher_combined
# eingetragen wurden und als Bezugsquelle / Facette ignoriert werden müssen.
_IGNORED_PUBLISHERS = frozenset({
    "wirlernenonline",
})

# Plattform-Domains: Hosting-Systeme, die NICHT als Quell-Domain taugen
_PLATFORM_DOMAINS = frozenset({
    "redaktion.openeduhub.net",
    "repository.openeduhub.net",
    "edu-sharing.net",
    "openeduhub.net",
    "github.com",
    "archive.org",
})


# ---------------------------------------------------------------------------
# Text-Hilfsfunktionen
# ---------------------------------------------------------------------------

def _norm(text: str | None) -> str:
    """Lowercase + Diakritika stripppen + Whitespace normalisieren."""
    if not text:
        return ""
    t = str(text).strip().lower()
    # NFD-Normalisierung, dann Combining-Zeichen entfernen (é→e, ñ→n, ü→u …)
    t = unicodedata.normalize("NFD", t)
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t)


def _fix_mojibake(s: str) -> str:
    """Behebt UTF-8-als-Latin-1-Kodierungsfehler (z.B. 'Ã¼' → 'ü', 'â€"' → '–')."""
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


# Trennmuster für Sub-Channel-Erkennung ("YouTube - Lehrerschmidt" → "YouTube")
_SUBCHANNEL_SEPS = (" - ", " – ", " — ", "-Kanal ", " | ")


def _build_bq_groups(facets_map: dict[str, int]) -> tuple[
    dict[str, str],        # bq → canonical_bq
    dict[str, int],        # canonical_bq → aggregierter Count
    dict[str, list[str]],  # canonical_bq → [alle bq-Namen der Gruppe]
]:
    """
    Kanonisiert Bezugsquellen: Fasst Varianten und Sub-Channels unter dem
    Haupt-Eintrag zusammen (z.B. alle "YouTube - *" unter "Youtube",
    Mojibake-Varianten wie "zebis - Portal fÃ¼r Lehrpersonen" unter "Zebis").

    Verarbeitet BQs absteigend nach Count, damit der größte Eintrag
    zuerst Canonical wird.

    Matching-Stufen:
      1. Normalisierter Name nach Mojibake-Fix
      2. Prefix-Extraktion vor Sub-Channel-Separator
      3. Suffix-Erweiterung (Canonical ist Prefix des aktuellen BQ)
    """
    sorted_bqs = sorted(facets_map.items(), key=lambda x: x[1], reverse=True)

    bq_to_canonical:  dict[str, str]       = {}
    canonical_counts: dict[str, int]       = {}
    canonical_bqs:    dict[str, list[str]] = {}
    norm_index:       dict[str, str]       = {}  # norm → canonical original

    for bq, count in sorted_bqs:
        canonical = None

        bq_fixed = _fix_mojibake(bq)
        bq_norm  = _norm(bq_fixed)

        # Stufe 1: Normierter Name (nach Mojibake-Fix) direkt im Index
        if bq_norm in norm_index:
            canonical = norm_index[bq_norm]

        # Stufe 2: Sub-Channel-Separator ("YouTube - Lehrerschmidt" → "YouTube")
        if canonical is None:
            for sep in _SUBCHANNEL_SEPS:
                if sep in bq_fixed:
                    prefix      = bq_fixed.split(sep)[0].strip()
                    prefix_norm = _norm(prefix)
                    if prefix_norm in norm_index:
                        canonical = norm_index[prefix_norm]
                        break

        # Stufe 3: Canonical ist Prefix dieses BQ ("WUS Komitee e.V." → "WUS")
        if canonical is None:
            for can_norm, can_orig in norm_index.items():
                if len(bq_norm) > len(can_norm) + 2 and bq_norm.startswith(can_norm + " "):
                    canonical = can_orig
                    break

        if canonical is None:
            # Neuer Canonical
            canonical = bq
            norm_index[bq_norm] = bq
            # Auch Rohform ohne Mojibake-Fix indexieren
            raw_norm = _norm(bq)
            if raw_norm != bq_norm:
                norm_index.setdefault(raw_norm, bq)

        bq_to_canonical[bq] = canonical
        canonical_counts[canonical] = canonical_counts.get(canonical, 0) + count
        canonical_bqs.setdefault(canonical, []).append(bq)

    grouped = sum(1 for bq, can in bq_to_canonical.items() if can != bq)
    log.info(
        "BQ-Kanonisierung: %d Bezugsquellen → %d Gruppen (%d zusammengefasst)",
        len(facets_map), len(canonical_bqs), grouped,
    )
    return bq_to_canonical, canonical_counts, canonical_bqs


def _domain(url: str | None) -> str:
    if not url:
        return ""
    u = str(url).strip()
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    try:
        netloc = urlparse(u).netloc.lower()
        return re.sub(r"^www\.", "", netloc).rstrip(".")
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Fix 1: NodeId-Deduplication (API-Artefakt)
# ---------------------------------------------------------------------------

def dedup_by_node_id(records: list[dict]) -> tuple[list[dict], int]:
    """
    Entfernt API-Artefakt-Dubletten:
    Die WLO-API liefert denselben Node manchmal mehrfach in paginierten
    Ergebnissen (nur 'dontcache' o.ä. verschieden).
    Behält pro nodeId den datenschöpfungsreichsten Eintrag.
    """
    seen:   dict[str, dict] = {}
    no_id:  list[dict]      = []

    for r in records:
        nid = (r.get("nodeId") or "").strip()
        if not nid:
            no_id.append(r)
            continue
        if nid not in seen or _richness(r) > _richness(seen[nid]):
            seen[nid] = r

    removed = len(records) - len(seen) - len(no_id)
    if removed:
        log.info("nodeId-Dedup: %d API-Artefakt-Dubletten entfernt", removed)
    return list(seen.values()) + no_id, removed


# ---------------------------------------------------------------------------
# Haupt-Merge
# ---------------------------------------------------------------------------

def merge(
    records:     list[dict],
    facets:      list[dict],
    corrections: list[dict],
) -> tuple[list[dict], int]:
    """
    Gibt eine neue Liste von Dicts zurück (records + facets-only Einträge).
    Jeder Dict enthält:
      name, contentCount, matchStage, matchSource, matchConfidence
    plus alle Original-Felder aus records.
    """

    # ── Facetten-Lookups ──────────────────────────────────────────────────
    facets_map: dict[str, int] = {}        # BQ → count  (original case)
    for f in facets:
        v = str(f.get("value") or "").strip()
        if v and v.lower() not in _IGNORED_PUBLISHERS:
            facets_map[v] = int(f.get("count") or 0)

    fac_lower: dict[str, str] = {_norm(k): k for k in facets_map}     # _norm → orig (Umlaut-safe)
    # Mojibake-aware normalized lookup: _norm(_fix_mojibake(key)) → orig
    fac_norm_mj: dict[str, str] = {}
    for k in facets_map:
        nk = _norm(_fix_mojibake(k))
        fac_norm_mj.setdefault(nk, k)   # first (= highest count due to sorted input) wins
    fac_list = list(facets_map.keys())

    # Domains, die wie Bezugsquellen-Einträge aussehen
    fac_domain: dict[str, str] = {}
    for bq in fac_list:
        d = _domain(bq)
        if d and "." in d:
            fac_domain[d] = bq

    # ── Bezugsquellen-Kanonisierung ───────────────────────────────────────
    # Gruppiert Sub-Channels und Varianten unter den häufigsten Haupteintrag
    bq_to_canonical, canonical_counts, canonical_bqs = _build_bq_groups(facets_map)

    # ── Korrektur-Lookups ─────────────────────────────────────────────
    korr_node:  dict[str, str] = {}   # nodeId → Bezugsquelle
    korr_title: dict[str, str] = {}   # norm_title → Bezugsquelle
    korr_url:   dict[str, str] = {}   # domain → Bezugsquelle
    korr_spider_doms:    set[str] = set()  # domains, die als Spider markiert werden
    korr_spider_bqs:     set[str] = set()  # Bezugsquellen, die als Spider markiert werden
    korr_blacklist_nodes: set[str] = set() # nodeIds, die nie primär werden
    korr_whitelist_nodes: set[str] = set() # nodeIds, die bevorzugt primär werden

    for row in corrections:
        nid        = str(row.get("Node-Id") or "").strip()
        bq         = str(row.get("Bezugsquelle") or "").strip()
        spider_raw = str(row.get("Spider") or "").strip()
        # Spider: jeder nicht-leere, nicht-deaktivierte Wert gilt als Markierung –
        # akzeptiert "1", "true", aber auch Script-Namen wie "wirlernenonline_spider"
        spider     = bool(spider_raw) and spider_raw.lower() not in ("0", "false", "no", "nein")
        liste      = str(row.get("Liste") or "").strip().lower()
        is_blacklist = liste == "blacklist"
        # Abwärtskompatibilität: altes Bezugsquelle.1-Format
        bq_alt = str(row.get("Bezugsquelle.1") or "").strip()

        # Blacklist ohne Bezugsquelle: nodeId trotzdem als blacklisted registrieren
        if not bq:
            if is_blacklist and nid:
                korr_blacklist_nodes.add(nid)
            continue

        # Bezugsquelle auflösen, wenn sie nicht direkt in den WLO-Facetten vorkommt
        # 1. Exakte Prüfung (_norm, Umlaut-safe)
        # 2. Mojibake-normalisierte Prüfung (_norm + _fix_mojibake)
        # 3. Publisher-Fallback aus _fetched_record (nur wenn 1+2 fehlschlagen)
        bq_norm = _norm(bq)
        if bq_norm in fac_lower:
            bq = fac_lower[bq_norm]  # exact normalized match (Umlaut-safe)
        elif bq_norm in fac_norm_mj:
            resolved = fac_norm_mj[bq_norm]
            log.debug(
                "Korrektur Node %s: Bezugsquelle '%s' → '%s' (mojibake-norm)",
                nid[:8] if nid else "?", bq, resolved,
            )
            bq = resolved
        elif _norm(_fix_mojibake(bq)) in fac_norm_mj:
            resolved = fac_norm_mj[_norm(_fix_mojibake(bq))]
            log.debug(
                "Korrektur Node %s: Bezugsquelle '%s' → '%s' (mojibake-fix-norm)",
                nid[:8] if nid else "?", bq, resolved,
            )
            bq = resolved
        else:
            # Stufe A: Titel-Feld der Korrektur-Zeile als BQ versuchen
            titel = str(row.get("Titel") or "").strip()
            if titel and _norm(titel) in fac_lower:
                resolved = fac_lower[_norm(titel)]
                log.debug("Korrektur Node %s: Bezugsquelle '%s' → '%s' (Titel exact)", nid[:8] if nid else "?", bq, resolved)
                bq = resolved
            elif titel and _norm(titel) in fac_norm_mj:
                resolved = fac_norm_mj[_norm(titel)]
                log.debug("Korrektur Node %s: Bezugsquelle '%s' → '%s' (Titel mojibake-norm)", nid[:8] if nid else "?", bq, resolved)
                bq = resolved
            else:
                # Stufe B: Titel aus _fetched_record
                fetched = row.get("_fetched_record")
                if fetched:
                    ftitle = (fetched.get("title") or "").strip()
                    if ftitle and _norm(ftitle) in fac_lower:
                        resolved = fac_lower[_norm(ftitle)]
                        log.debug("Korrektur Node %s: Bezugsquelle '%s' → '%s' (fetched title)", nid[:8] if nid else "?", bq, resolved)
                        bq = resolved
                    elif ftitle and _norm(ftitle) in fac_norm_mj:
                        resolved = fac_norm_mj[_norm(ftitle)]
                        log.debug("Korrektur Node %s: Bezugsquelle '%s' → '%s' (fetched title mojibake-norm)", nid[:8] if nid else "?", bq, resolved)
                        bq = resolved
                    else:
                        # Stufe C: Publisher-Fallback (letzter Ausweg)
                        pub = (fetched.get("publisher") or "").strip()
                        if pub and _norm(pub) in fac_lower:
                            resolved = fac_lower[_norm(pub)]
                            log.debug("Korrektur Node %s: Bezugsquelle '%s' → '%s' (WLO publisher)", nid[:8] if nid else "?", bq, resolved)
                            bq = resolved

        if spider:
            korr_spider_bqs.add(bq)
        if nid:
            korr_node[nid] = bq
            if is_blacklist:
                korr_blacklist_nodes.add(nid)
            else:
                korr_whitelist_nodes.add(nid)
        if row.get("Titel"):
            korr_title[_norm(row["Titel"])] = bq
        if row.get("Url"):
            dom = _domain(row["Url"])
            if dom and dom not in _PLATFORM_DOMAINS:
                korr_url[dom] = bq
                if spider:
                    korr_spider_doms.add(dom)
        # Angereicherte Metadaten aus enrich_corrections_from_nodes()
        fetched = row.get("_fetched_record")
        if fetched:
            if fetched.get("title") and not row.get("Titel"):
                korr_title.setdefault(_norm(fetched["title"]), bq)
            if fetched.get("wwwUrl"):
                dom = _domain(fetched["wwwUrl"])
                if dom and dom not in _PLATFORM_DOMAINS:
                    korr_url.setdefault(dom, bq)
                    if spider:
                        korr_spider_doms.add(dom)
        # Abwärtskompatibilität: Bezugsquelle.1 als Spider-Alternativname
        if bq_alt:
            for dom in list(korr_url.keys()):
                if korr_url.get(dom) == bq:
                    korr_url.setdefault(f"__alt__{dom}", bq_alt)

    # ── Hilfsfelder pro Record ─────────────────────────────────────────────
    work = []
    for rec in records:
        r = dict(rec)
        r["_title_norm"] = _norm(r.get("title"))
        r["_domain"]     = _domain(r.get("wwwUrl"))
        r["_pub_norm"]   = _norm(r.get("publisher"))
        r["name"]            = ""
        r["contentCount"]    = 0
        r["bezugsquellen"]   = []
        r["matchStage"]      = None
        r["matchSource"]     = None
        r["matchConfidence"] = None
        work.append(r)

    # ── Whitelist-Injection ──────────────────────────────────────────────
    # Whitelist-Einträge mit _fetched_record, deren nodeId nicht bereits
    # in work ist, werden als synthetische Records injiziert.
    # So erscheinen z.B. BpB, rpi-virtuell auch ohne LRT=Quelle-Tagging.
    existing_nids = {(r.get("nodeId") or "").strip() for r in work}
    injected = 0
    for row in corrections:
        nid = (row.get("Node-Id") or "").strip()
        liste = str(row.get("Liste") or "").strip().lower()
        if liste != "whitelist" or not nid or nid in existing_nids:
            continue
        fetched = row.get("_fetched_record")
        if not fetched:
            continue
        r = dict(fetched)
        r["_title_norm"] = _norm(r.get("title"))
        r["_domain"]     = _domain(r.get("wwwUrl"))
        r["_pub_norm"]   = _norm(r.get("publisher"))
        r["name"]            = ""
        r["contentCount"]    = 0
        r["bezugsquellen"]   = []
        r["matchStage"]      = None
        r["matchSource"]     = None
        r["matchConfidence"] = None
        r["_whitelisted"]    = True
        work.append(r)
        existing_nids.add(nid)
        injected += 1
    if injected:
        log.info("Whitelist-Injection: %d synthetische Records aus Korrekturen eingefügt", injected)

    # ── Blacklist-Filterung ───────────────────────────────────────────────
    # Records mit bekannten Duplikat-NodeIds werden vollständig entfernt;
    # sie dürfen weder primär noch sekundär im Output erscheinen.
    blacklist_removed = 0
    if korr_blacklist_nodes:
        before = len(work)
        work = [r for r in work if (r.get("nodeId") or "").strip() not in korr_blacklist_nodes]
        blacklist_removed = before - len(work)
        if blacklist_removed:
            log.info("Blacklist: %d Records mit explizit geblacklisteten NodeIds entfernt", blacklist_removed)

    matched_bq: set[str] = set()
    stats: dict[int, int] = {}

    def assign(r: dict, bq: str, stage: int, source: str, conf: str = "HIGH") -> None:
        canonical = bq_to_canonical.get(bq, bq)
        r["name"]            = _fix_mojibake(canonical)
        r["contentCount"]    = canonical_counts.get(canonical, facets_map.get(bq, 0))
        r["bezugsquellen"]   = [_fix_mojibake(v) for v in canonical_bqs.get(canonical, [bq])]
        r["matchStage"]      = stage
        r["matchSource"]     = source
        r["matchConfidence"] = conf
        matched_bq.add(canonical)
        stats[stage] = stats.get(stage, 0) + 1

    # ── Stufe 1: Korrektur-Override ───────────────────────────────────────
    for r in work:
        # 1a: Node-Id direkter Treffer (höchste Priorität)
        nid = (r.get("nodeId") or "").strip()
        if nid and nid in korr_node:
            assign(r, korr_node[nid], 1, "korrektur_nodeid")
            if nid in korr_blacklist_nodes:
                r["_blacklisted"] = True   # bekanntes Duplikat → nie primär
            elif nid in korr_whitelist_nodes:
                r["_whitelisted"] = True   # verifiziert → bevorzugt primär
            continue
        # 1b: Titel-Treffer
        tn = r["_title_norm"]
        if tn and tn in korr_title:
            assign(r, korr_title[tn], 1, "korrektur_titel")
            continue
        # 1c: URL-Domain-Treffer
        dom = r["_domain"]
        if dom and dom in korr_url:
            assign(r, korr_url[dom], 1, "korrektur_url")
            if dom in korr_spider_doms:
                r["isSpider"] = True

    # ── Stufe 2: publisher_combined exakt ─────────────────────────────────
    for r in work:
        if r["matchStage"]:
            continue
        pub = r["_pub_norm"]
        if pub and pub not in _IGNORED_PUBLISHERS and pub in fac_lower:
            assign(r, fac_lower[pub], 2, "publisher_combined")

    # ── Stufe 2b: Spider-Titel ────────────────────────────────────────────
    # Spider-/Crawler-Nodes: publisher = Crawler-Name (z.B. "WirLernenOnline"),
    # title = echter Quellenname (z.B. "Khan Academy").
    # Exakter Titelabgleich gegen Facetten, dann Fuzzy-Containment.
    for r in work:
        if r["matchStage"] or not r.get("isSpider"):
            continue
        tn = r["_title_norm"]
        if not tn:
            continue
        # Exakter Treffer
        if tn in fac_lower:
            assign(r, fac_lower[tn], 2, "spider_titel_exakt")
            continue
        # Fuzzy: title in bq oder bq in title (mind. 4 Zeichen)
        if len(tn) >= 4:
            best_bq, best_len = None, 0
            for bq_norm, bq_orig in fac_lower.items():
                if len(bq_norm) >= 4 and (tn in bq_norm or bq_norm in tn) and len(bq_norm) > best_len:
                    best_bq, best_len = bq_orig, len(bq_norm)
            if best_bq:
                assign(r, best_bq, 2, "spider_titel_fuzzy")

    # ── Stufe 3: Titel exakt (case-insensitive) ──────────────────────────────
    for r in work:
        if r["matchStage"]:
            continue
        tn = r["_title_norm"]
        if tn and tn in fac_lower:
            assign(r, fac_lower[tn], 3, "titel_exakt")

    # ── Stufe 4a: Domain-Match ────────────────────────────────────────────
    for r in work:
        if r["matchStage"]:
            continue
        dom = r["_domain"]
        if dom and dom in fac_domain:
            assign(r, fac_domain[dom], 4, "domain_match")

    # ── Stufe 4b: Publisher-Containment ─────────────────────────────────
    # BQ-Name als Teilstring im Publisher oder umgekehrt (mind. 5 Zeichen).
    # Beispiel: Publisher "GPM Deutsche Gesellschaft …" → BQ "GPM Deutsche
    # Gesellschaft für Projektmanagement e. V."
    for r in work:
        if r["matchStage"]:
            continue
        pub = r["_pub_norm"]
        if not pub or len(pub) < 5 or pub in _IGNORED_PUBLISHERS:
            continue
        best_bq, best_len = None, 0
        for bq_norm, bq_orig in fac_lower.items():
            if len(bq_norm) < 5:
                continue
            if (bq_norm in pub or pub in bq_norm) and len(bq_norm) > best_len:
                best_bq, best_len = bq_orig, len(bq_norm)
        if best_bq:
            assign(r, best_bq, 4, "publisher_containment")

    # ── Stufe 5: Substring (Bezugsquelle im Titel) ────────────────────────
    for r in work:
        if r["matchStage"]:
            continue
        title_low = (r.get("title") or "").lower().strip()
        if len(title_low) < 5:
            continue
        best_bq, best_len = None, 0
        for bq in fac_list:
            if len(bq) >= 5 and bq.lower() in title_low and len(bq) > best_len:
                best_bq, best_len = bq, len(bq)
        if best_bq:
            assign(r, best_bq, 5, "substring", "MEDIUM")

    # ── Stufe 5b: Titel→Facette für Ignored-Publisher (WirLernenOnline) ─
    # WirLernenOnline wird als publisher_combined oft falsch eingetragen;
    # der Titel enthält häufig den echten Quellennamen.
    # Vergleich erfolgt whitespace-frei: "Tüftel Akademie" == "TüftelAkademie"
    fac_nospace: dict[str, str] = {}          # _norm ohne Leerzeichen → orig
    for bq in fac_list:
        key = _norm(bq).replace(" ", "")
        if len(key) >= 4:
            fac_nospace.setdefault(key, bq)   # längster/erster gewinnt

    for r in work:
        if r["matchStage"]:
            continue
        pub_norm = r["_pub_norm"]
        if pub_norm and pub_norm not in _IGNORED_PUBLISHERS:
            continue                          # nur Ignored-Publisher oder leerer Publisher
        title = (r.get("title") or "").strip()
        if len(title) < 4:
            continue
        title_ns = _norm(title).replace(" ", "")
        # 5b-1: Titel exakt == Facette (whitespace-frei)
        if title_ns in fac_nospace:
            assign(r, fac_nospace[title_ns], 5, "ignored_pub_title_exact", "MEDIUM")
            continue
        # 5b-2: Facette als Substring im Titel (whitespace-frei)
        # Mindestlänge 10 + ≥40% des Titels, um False Positives wie
        # "IN FORM" in "Informatik" zu vermeiden
        best_bq, best_len = None, 0
        for bq_ns, bq_orig in fac_nospace.items():
            if len(bq_ns) < 10:
                continue
            if bq_ns in title_ns and len(bq_ns) > best_len:
                if len(bq_ns) / len(title_ns) >= 0.4:
                    best_bq, best_len = bq_orig, len(bq_ns)
        if best_bq:
            assign(r, best_bq, 5, "ignored_pub_title_contains", "MEDIUM")

    # ── Qualitäts-Flags initialisieren ───────────────────────────────────
    def _add_flag(r: dict, flag: str) -> None:
        flags = r.get("qualityFlags") or []
        if flag not in flags:
            flags.append(flag)
        r["qualityFlags"] = flags

    for r in work:
        r.setdefault("qualityFlags", [])

    # ── QA 1: Fehlende Pflichtfelder ──────────────────────────────────────
    for r in work:
        if not (r.get("title") or "").strip():
            _add_flag(r, "KEIN_TITEL")
        if not r.get("wwwUrl"):
            _add_flag(r, "KEINE_URL")

    # ── QA 2: Kein Match in Facetten ──────────────────────────────────────
    for r in work:
        if not r["matchStage"]:
            _add_flag(r, "KEIN_MATCH")

    # ── QA 3: URL-Titel-Dubletten (gleiche URL, verschiedene Titel) ───────
    url_title_map: dict[str, list[int]] = {}
    for i, r in enumerate(work):
        url = r.get("wwwUrl") or ""
        if url:
            url_title_map.setdefault(url, []).append(i)
    for url, idxs in url_title_map.items():
        if len(idxs) < 2:
            continue
        titles = {(work[i].get("title") or "").strip() for i in idxs}
        if len(titles) > 1:
            for i in idxs:
                _add_flag(work[i], "URL_MEHRFACH_VERSCH_TITEL")
        else:
            for i in idxs[1:]:
                _add_flag(work[i], "URL_TITEL_DUBLETTE")

    # ── QA 4: publisher_combined → verschiedene Bezugsquellen ────────────
    # publisher grouped only among matched records (Stufe 2–6)
    pub_map: dict[str, set[str]] = {}
    for r in work:
        pub = (r.get("publisher") or "").strip()
        bq  = r.get("name") or ""
        if pub and bq and r["matchStage"]:
            pub_map.setdefault(pub, set()).add(bq)
    for pub, bqs in pub_map.items():
        if len(bqs) <= 1:
            continue
        # Check ob Abweichung nur durch Korrektur (Stufe 1) entsteht
        for r in work:
            if (r.get("publisher") or "").strip() != pub:
                continue
            if r["matchStage"] == 1:
                _add_flag(r, "KORREKTUR_ABWEICHUNG")
            else:
                _add_flag(r, "PUB_INKONSISTENT")

    # ── Cleanup Hilfsfelder ───────────────────────────────────────────────
    for r in work:
        r.pop("_title_norm", None)
        r.pop("_domain", None)
        r.pop("_pub_norm", None)

    # ── Statistik ─────────────────────────────────────────────────────────
    unmatched_count = sum(1 for r in work if not r["matchStage"])
    labels = {1: "Korrektur", 2: "publisher_combined", 3: "Titel exakt",
              4: "Domain", 5: "Substring"}
    log.info("── Matching-Ergebnis ──")
    for s in sorted(stats):
        log.info("  Stufe %d %-20s: %d", s, labels.get(s, ""), stats[s])
    log.info("  %-22s: %d", "Nicht zugeordnet", unmatched_count)
    log.info("  %-22s: %d / %d", "Facetten zugeordnet", len(matched_bq), len(facets_map))

    # ── Stufe 6: Facets-only ──────────────────────────────────────────────
    # Nur kanonische BQs emittieren, die in Stufen 1–5 nicht gemacht wurden.
    # Sub-Varianten (canonical != bq) werden durch ihre Canonical-Gruppe vertreten.
    facets_only: list[dict] = []
    for bq, count in facets_map.items():
        canonical = bq_to_canonical.get(bq, bq)
        if canonical in matched_bq:
            continue  # Gruppe bereits durch Stufe 1-5 vertreten
        if canonical != bq:
            continue  # Sub-Variante; wird durch Canonical emittiert
        # Ungematchte Canonical-BQ → als facets-only eintragen
        agg_count  = canonical_counts.get(bq, count)
        agg_bqs    = canonical_bqs.get(bq, [bq])
        matched_bq.add(bq)  # verhindert Doppel-Emission falls BQ mehrfach in map
        facets_only.append({
            "name":            _fix_mojibake(bq),
            "contentCount":    agg_count,
            "bezugsquellen":   [_fix_mojibake(v) for v in agg_bqs],
            "matchStage":      6,
            "matchSource":     "facets_only",
            "matchConfidence": "HIGH",
            "qualityFlags":    [],
            # alle anderen Felder leer
            "nodeId": "", "title": _fix_mojibake(bq), "description": "", "wwwUrl": "",
            "previewUrl": "", "publisher": "",
            "oer": False,
            "isSpider": bq in korr_spider_bqs or any(v in korr_spider_bqs for v in agg_bqs),
            "subjects": [], "educationalContext": [], "oehLrt": [],
            "license": "", "licenseVersion": "", "language": "", "keywords": "",
            "loginRaw": "", "loginFallback": "", "adsRaw": "", "priceRaw": "", "gdprRaw": "", "gdprRawLbl": "", "gdprFallback": "", "accessRaw": "",
            "lawMinors": "", "lawMinorsLbl": "", "lawPrivacy": "", "lawPrivacyLbl": "",
            "lawPersonal": "", "lawPersonalLbl": "", "lawCriminal": "", "lawCriminalLbl": "",
            "lawCopyright": "", "lawCopyrightLbl": "",
            "qCurrentness": "", "qCurrentnessLbl": "", "qNeutralness": "", "qNeutralnessLbl": "",
            "qLanguage": "", "qLanguageLbl": "", "qCorrectness": "", "qCorrectnessLbl": "",
            "qMedial": "", "qMedialLbl": "", "qTransparent": "", "qTransparentLbl": "",
            "qDidactics": "", "qDidacticsLbl": "",
            "qInterop": "", "qInteropLbl": "", "qAdvertisement": "", "qAdvertisementLbl": "",
            "qUsability": "", "qUsabilityLbl": "", "qSecurity": "", "qSecurityLbl": "",
            "qFind": "", "qFindLbl": "", "qBarrier": "",
            "replicationSource": "", "created": "", "modified": "", "nodeType": "",
        })

    log.info("  %-22s: %d", "Facets-only angehängt", len(facets_only))

    return work + facets_only, blacklist_removed


# ---------------------------------------------------------------------------
# Deduplizierung
# ---------------------------------------------------------------------------

def _richness(r: dict) -> tuple:
    """
    Score: welcher Quelldatensatz ist der kanonische Vertreter einer Bezugsquelle?
    Höherer Wert = besser. Vergleich über Tuple-Reihenfolge.

    Priorität:
      1. is_whitelist     – Whitelist-Eintrag aus Korrekturtabelle: verifizierter
                            Datensatz mit explizitem Vorrang (Liste=whitelist)
      2. publisher_match  – Nodes eigenes oeh_publisher_combined == Bezugsquelle
      3. is_spider        – Spider-/Crawler-Quellen haben technischen Vorrang:
                            Sie sind direkt mit einem aktiven Crawler verbunden,
                            damit fast immer korrekt und Duplikaten vorzuziehen.
      4. stage_score      – niedrigere Matching-Stufe bevorzugt (negiert)
      5. has_node         – nodeId vorhanden
      6. date_str         – neuester Timestamp (ISO, direkt vergleichbar)
      7. has_preview      – Vorschaubild vorhanden
      8. has_desc         – Beschreibung vorhanden
      9. filled           – Anzahl gefüllter Felder (Vollständigkeit)
    """
    is_whitelist = 1 if r.get("_whitelisted") else 0  # Whitelist hat höchste Priorität
    pub_match    = 1 if _norm(r.get("publisher") or "") == _norm(r.get("name") or "") and r.get("name") else 0
    is_spider    = 1 if r.get("isSpider") else 0      # Spider-Quellen haben technischen Vorrang
    stage        = r.get("matchStage") or 9
    stage_score  = -stage                              # -2 > -5 → Stufe 2 > Stufe 5
    has_node     = 1 if r.get("nodeId") else 0
    date_str     = (r.get("modified") or r.get("created") or "")[:10]  # "YYYY-MM-DD"
    has_preview  = 1 if r.get("previewUrl") else 0
    has_desc     = 1 if r.get("description") else 0
    filled       = sum(
        1 for v in r.values()
        if v is not None and v != "" and v != [] and v is not False
    )
    return (is_whitelist, pub_match, is_spider, stage_score, has_node, date_str, has_preview, has_desc, filled)


def assign_primary(merged: list[dict]) -> tuple[list[dict], int]:
    """
    Behält ALLE Records.  Statt zu löschen wird `isPrimary` gesetzt:

      isPrimary = True   → bester Record pro name (höchster Richness-Score,
                           nodeId bevorzugt), oder URL-disambiguierter Eintrag
      isPrimary = False  → weiterer Record derselben Bezugsquelle, oder
                           als _blacklisted markierter Record

    Fix 2: Gleicher name, verschiedene URLs → beide Records erhalten
    einen Domain-Suffix im name und sind beide primär.

    Rückgabe: (alle Records mit isPrimary-Flag, Anzahl non-primary)
    """
    # Erst-Durchlauf: besten Record pro name ermitteln + URL-Disambiguierung
    # Blacklist-Records werden vollständig übersprungen (nie primär)
    best: dict[str, dict] = {}   # name → bisher bester record (Objekt-Referenz)

    for r in merged:
        if r.get("_blacklisted"):
            continue  # bekanntes Duplikat → nie primär
        name = (r.get("name") or "").strip()
        if not name:
            continue  # namenlos → in Zweitem Durchlauf behandelt

        if name not in best:
            best[name] = r
        else:
            existing = best[name]
            url_new = _domain(r.get("wwwUrl") or "")
            url_ex  = _domain(existing.get("wwwUrl") or "")

            if url_new and url_ex and url_new != url_ex:
                # Fix 2: echte verschiedene Quelle → Domain-Suffix
                if not existing.get("_disambiguated"):
                    existing["name"]           = f"{existing['name']} [{url_ex}]"
                    existing["_disambiguated"] = True
                    # Nur eintragen wenn noch nicht belegt (Richness-Vergleich)
                    new_key = existing["name"]
                    if new_key not in best or _richness(existing) >= _richness(best[new_key]):
                        best[new_key] = existing
                    del best[name]
                r["name"]           = f"{name} [{url_new}]"
                r["_disambiguated"] = True
                new_key = r["name"]
                if new_key not in best or _richness(r) >= _richness(best[new_key]):
                    best[new_key] = r
            else:
                # Gleiche Bezugsquelle → besten Record behalten.
                # Whitelist-Einträge haben immer Vorrang vor nicht-verifizierten.
                new_wl = r.get("_whitelisted", False)
                ex_wl  = existing.get("_whitelisted", False)
                if new_wl and not ex_wl:
                    best[name] = r
                elif not new_wl and ex_wl:
                    pass  # bestehender Whitelist-Eintrag bleibt
                elif _richness(r) > _richness(existing):
                    best[name] = r

    # Zweiter Durchlauf: isPrimary per Objekt-Identität setzen
    # → verhindert false positives wenn mehrere Records denselben disambiguierten Namen tragen
    best_ids: set[int] = {id(r) for r in best.values()}
    non_primary = 0
    for r in merged:
        r.pop("_disambiguated", None)
        name = (r.get("name") or "").strip()
        if not name:
            r["isPrimary"] = True   # namenlose Records immer primär
        else:
            r["isPrimary"] = id(r) in best_ids
        if not r["isPrimary"]:
            non_primary += 1

    log.info(
        "assign_primary: %d gesamt, %d primär, %d sekundär (alle behalten)",
        len(merged), len(best_ids), non_primary,
    )
    return merged, non_primary


# ---------------------------------------------------------------------------
# Matching-Bericht (für /jobs/{id}/report)
# ---------------------------------------------------------------------------

def match_report(merged: list[dict]) -> dict:
    stage_counts: dict[str, int] = {}
    conf_counts:  dict[str, int] = {}
    unmatched = 0

    for r in merged:
        s = r.get("matchStage")
        c = r.get("matchConfidence") or "NONE"
        if s is None:
            unmatched += 1
        else:
            stage_counts[str(s)] = stage_counts.get(str(s), 0) + 1
        conf_counts[c] = conf_counts.get(c, 0) + 1

    total_with_node   = sum(1 for r in merged if r.get("nodeId"))
    total_facets_only = sum(1 for r in merged if r.get("matchStage") == 6)
    primary_count     = sum(1 for r in merged if r.get("isPrimary", True))

    return {
        "total":            len(merged),
        "primaryRecords":   primary_count,
        "secondaryRecords": len(merged) - primary_count,
        "withNodeId":       total_with_node,
        "facetsOnly":       total_facets_only,
        "unmatched":        unmatched,
        "byStage":          stage_counts,
        "byConfidence":     conf_counts,
    }
