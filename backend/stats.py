"""
stats.py
--------
Erzeugt Statistiken aus dem zusammengeführten Quellen-Datensatz.

compute(records) gibt ein Dict zurück, das direkt als JSON-Antwort
genutzt werden kann.
"""

from collections import Counter


# ---------------------------------------------------------------------------
# Interne Hilfsfunktionen
# ---------------------------------------------------------------------------

def _top(counter: Counter, n: int = 50) -> list[dict]:
    return [{"value": k, "count": v} for k, v in counter.most_common(n)]


def _parse_oer(val) -> bool:
    if isinstance(val, bool):
        return val
    s = str(val).lower()
    return s in ("true", "1") or "/oer/" in s


# Fields where 0 = good, 1 = bad (inverted binary)
INVERT_FIELDS: set[str] = set()

# Fields where 0 = "Nein - unauffällig" = good (1.0)
ZERO_IS_GOOD: set[str] = {"lawCriminal", "lawPersonal", "lawMinors", "lawCopyright"}

# Extra fallback field (tried when main + Lbl are empty)
FALLBACK_FIELDS: dict[str, str] = {"loginRaw": "loginFallback", "gdprRaw": "gdprFallback"}


def _parse_quality_score(raw, *, invert: bool = False, zero_good: bool = False) -> float | None:
    """Parse score from numeric 0-5, vocab URI, or yes/no text → normalised 0–1."""
    if raw is None or raw == "":
        return None
    s = str(raw).strip()
    if not s or s.lower() in ("null", "todo"):
        return None
    # 1) Numeric
    try:
        n = float(s)
        if invert:
            # Binary 0/1: 0 = good, 1 = bad
            if n == 0:
                return 1.0
            if n == 1:
                return 0.2
            return None
        if zero_good and n == 0:
            return 1.0               # 0 = "Nein - unauffällig" = gut
        if n == 0:
            return None              # 0 = unbewertet
        return min(n / 5.0, 1.0)
    except (ValueError, TypeError):
        pass
    # 2) Vocab URI  (e.g. .../price/no, .../price/yes)
    if "/" in s and " " not in s:
        seg = s.rsplit("/", 1)[-1].lower().strip()
        _URI = {
            "no": 1.0, "free": 1.0, "open": 1.0, "no_login": 1.0,
            "fully_accessible": 1.0,
            "generaldataprotectionregulation": 1.0,
            "login_for_additional_features": 0.0,
            "yes_for_additional": 0.6,
            "partially_accessible": 0.6,
            "aaa": 1.0, "aa": 0.8, "a": 0.6, "wcag": 0.6,
            "yes": 0.2, "fee": 0.2, "closed": 0.2,
            "login_required": 0.0, "login": 0.0,
            "not_accessible": 0.2,
            "nogeneraldataprotectionregulation": 0.0,
            "none": 0.0,
        }
        return _URI.get(seg)
    # 3) Boolean / accessibility level / German text
    lower = s.lower()
    _MAP = {
        "yes": 0.2, "no": 1.0, "true": 0.2, "false": 1.0,
        "ja": 0.2, "nein": 1.0,
        "nein - unauffällig": 1.0, "datensparsam": 1.0,
        "nicht geprüft": 0.0, "nicht dsgvo geprüft": 0.0,
        "aaa": 1.0, "aa": 0.8, "a": 0.6, "wcag": 0.6, "bitv": 0.6,
    }
    return _MAP.get(lower)


def _agg_score_field(records: list[dict], field: str) -> dict:
    invert = field in INVERT_FIELDS
    zero_good = field in ZERO_IS_GOOD
    lbl_field = field + "Lbl"
    fb_field = FALLBACK_FIELDS.get(field)
    known = ok = 0
    total_raw = 0.0
    for r in records:
        raw = r.get(field)
        s = _parse_quality_score(raw, invert=invert, zero_good=zero_good)
        if s is None:
            # Fallback 1: try DISPLAYNAME label field
            s = _parse_quality_score(r.get(lbl_field), invert=invert, zero_good=zero_good)
        if s is None and fb_field:
            # Fallback 2: extra field (login binary or DSGVO vocab)
            fb_raw = r.get(fb_field)
            if field == "loginRaw":
                fb_str = str(fb_raw or "").strip()
                if fb_str == "1":
                    s = 1.0
                elif fb_str == "0":
                    s = 0.0
            else:
                s = _parse_quality_score(fb_raw)
        if s is not None:
            known += 1
            total_raw += s * 5          # back to 1-5 scale
            if s >= 0.70:
                ok += 1
    avg = round(total_raw / known, 1) if known else 0
    return {
        "known":    known,
        "okCount":  ok,
        "average":  avg,
    }


LAW_FIELDS = ["lawMinors", "lawPrivacy", "lawPersonal", "lawCriminal", "lawCopyright"]
Q_FIELDS   = ["qCurrentness", "qNeutralness", "qLanguage", "qCorrectness",
              "qMedial", "qTransparent", "qDidactics"]
ACCESS_FIELDS = [
    "accessRaw",       # Offenheit (ccm:oeh_accessibility_open)
    "priceRaw",        # Kostenpflichtig (ccm:price)
    "qAdvertisement",  # Werbung (ccm:containsAdvertisement)
    "loginRaw",        # Login notwendig (ccm:conditionsOfAccess)
    "gdprRaw",         # DSGVO (ccm:dataProtectionConformity)
    "qBarrier",        # Barrierearmut (ccm:accessibilitySummary)
]



# ---------------------------------------------------------------------------
# Haupt-Statistik-Funktion
# ---------------------------------------------------------------------------

def compute(records: list[dict]) -> dict:
    """
    Erwartet die Ausgabe von merger.merge().
    Gibt ein strukturiertes Statistik-Dict zurück.
    """
    # Deduplicate by name: keep best (isPrimary) record per unique name
    _seen: dict[str, dict] = {}
    for r in records:
        key = (r.get("name") or "").strip().lower()
        if key not in _seen or (not _seen[key].get("isPrimary") and r.get("isPrimary")):
            _seen[key] = r
    records = list(_seen.values())

    total = len(records)
    if total == 0:
        return {"total": 0}

    # Erschließungsstatus
    with_node     = sum(1 for r in records if r.get("nodeId"))
    facets_only   = sum(1 for r in records if r.get("matchStage") == 7)
    with_contents = sum(1 for r in records if (r.get("contentCount") or 0) > 0)
    no_contents   = total - with_contents

    # Inhalte gesamt – pro kanonischer Bezugsquelle nur einmal zählen,
    # da mehrere Records dieselbe canonical contentCount tragen können.
    _name_cnt: dict[str, int] = {}
    for r in records:
        n = (r.get("name") or "").strip()
        if n not in _name_cnt:
            _name_cnt[n] = r.get("contentCount") or 0
    total_contents = sum(_name_cnt.values())

    top_by_contents = sorted(
        [{"value": k, "count": v} for k, v in _name_cnt.items() if v > 0],
        key=lambda x: x["count"],
        reverse=True,
    )[:20]

    # OER
    oer_count = sum(1 for r in records if r.get("oer"))

    # Spider / Crawler
    spider_count = sum(1 for r in records if r.get("isSpider"))

    # Fächer
    subj_counter: Counter = Counter()
    for r in records:
        for s in (r.get("subjects") or []):
            if s and str(s).strip():
                subj_counter[str(s).strip()] += 1

    # Bildungsstufen
    level_counter: Counter = Counter()
    for r in records:
        for lv in (r.get("educationalContext") or []):
            if lv and str(lv).strip():
                level_counter[str(lv).strip()] += 1

    # Lizenz
    lic_counter: Counter = Counter()
    for r in records:
        lic = (r.get("license") or "").strip()
        if lic:
            lic_counter[lic] += 1

    # Sprache
    lang_counter: Counter = Counter()
    for r in records:
        lang = (r.get("language") or "").strip()
        if lang:
            lang_counter[lang] += 1

    # LRT
    lrt_counter: Counter = Counter()
    for r in records:
        for lrt in (r.get("oehLrt") or []):
            if lrt and str(lrt).strip():
                lrt_counter[str(lrt).strip()] += 1

    # Zugänglichkeitsfelder (flexible Aggregation)
    access_quality = {f: _agg_score_field(records, f) for f in ACCESS_FIELDS}

    # Inhaltsmenge-Verteilung (Brackets)
    BRACKET_ORDER = ["0", "1–4", "5–9", "10–49", "50–99", "100–499", "500–999", "1k–9.9k", "≥10k"]

    def bracket(n: int) -> str:
        if n == 0:
            return "0"
        if n < 5:
            return "1–4"
        if n < 10:
            return "5–9"
        if n < 50:
            return "10–49"
        if n < 100:
            return "50–99"
        if n < 500:
            return "100–499"
        if n < 1000:
            return "500–999"
        if n < 10000:
            return "1k–9.9k"
        return "≥10k"

    content_dist: Counter = Counter()
    for r in records:
        content_dist[bracket(r.get("contentCount") or 0)] += 1

    # Matching-Stufen
    stage_counter: Counter = Counter()
    for r in records:
        s = r.get("matchStage")
        stage_counter[str(s) if s is not None else "none"] += 1

    return {
        # Übersicht
        "total":               total,
        "totalContents":       total_contents,
        "withNodeId":          with_node,
        "facetsOnly":          facets_only,
        "withContents":        with_contents,
        "withoutContents":     no_contents,

        # Erschließung
        "erschliessung": {
            "mitQuelldatensatz":   with_node,
            "nurFacets":           facets_only,
            "mitInhalten":         with_contents,
            "ohneInhalte":         no_contents,
            "crawler":             spider_count,
            "redaktionell":        with_node - spider_count,
        },

        # Inhaltsmenge-Brackets (array, geordnet)
        "contentBrackets": [
            {"value": k, "count": content_dist[k]}
            for k in BRACKET_ORDER if content_dist.get(k)
        ],

        # Matching
        "matchingStages": dict(stage_counter),

        # OER / Lizenz
        "oer": {
            "count":       oer_count,
            "percent":     round(oer_count / total * 100, 1) if total else 0,
        },
        "licenseDistribution": _top(lic_counter, 30),

        # Zugänglichkeit
        "accessQuality": access_quality,

        # Rechtliche Qualität (0–5 Skala)
        "legalQuality": {f: _agg_score_field(records, f) for f in LAW_FIELDS},

        # Inhaltliche Qualität (0–5 Skala)
        "contentQuality": {f: _agg_score_field(records, f) for f in Q_FIELDS},

        # Klassifikation
        "topSubjects":          _top(subj_counter, 50),
        "topEducationalContext": _top(level_counter, 30),
        "topLanguages":         _top(lang_counter, 30),
        "topLrt":               _top(lrt_counter, 30),
        "topByContents":        top_by_contents,
    }
