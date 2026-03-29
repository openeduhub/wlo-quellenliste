export interface SourceRecord {
  name: string;
  nodeId?: string;
  title?: string;
  previewUrl?: string;
  contentCount: number;
  bezugsquellen?: string[];
  oer?: boolean;
  isSpider?: boolean;
  subjects?: string[];
  educationalContext?: string[];
  license?: string;
  matchStage?: number;
  matchConfidence?: string;
  isPrimary?: boolean;
  qualityFlags?: string[];
  editorialStatus?: string;  // Quellenerschließungsstatus (0-9)
  // Basis-Qualitätsfelder (Slim-View Icons)
  loginRaw?: string;
  adsRaw?: string;
  priceRaw?: string;
  gdprRaw?: string;
  accessRaw?: string;
  // Rechtliche Qualität (0–5 Skala)
  lawMinors?: string;    lawMinorsLbl?: string;
  lawPrivacy?: string;   lawPrivacyLbl?: string;
  lawPersonal?: string;  lawPersonalLbl?: string;
  lawCriminal?: string;  lawCriminalLbl?: string;
  lawCopyright?: string; lawCopyrightLbl?: string;
  // Inhaltliche Qualität (0–5 Skala)
  qCurrentness?: string;  qCurrentnessLbl?: string;
  qNeutralness?: string;  qNeutralnessLbl?: string;
  qLanguage?: string;     qLanguageLbl?: string;
  qCorrectness?: string;  qCorrectnessLbl?: string;
  qMedial?: string;       qMedialLbl?: string;
  qTransparent?: string;  qTransparentLbl?: string;
  qDidactics?: string;    qDidacticsLbl?: string;
  // Zugänglichkeit
  qInterop?: string;       qInteropLbl?: string;
  qAdvertisement?: string; qAdvertisementLbl?: string;
  qUsability?: string;     qUsabilityLbl?: string;
  qSecurity?: string;      qSecurityLbl?: string;
  qFind?: string;          qFindLbl?: string;
  qBarrier?: string;
  // Full fields — loaded on demand via GET /data/sources/{name}
  description?: string;
  wwwUrl?: string;
  language?: string;
  keywords?: string;
  oehLrt?: string[];
  licenseVersion?: string;
  publisher?: string;
  created?: string;
  modified?: string;
}

export interface SourcePage {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  items: SourceRecord[];
}

export interface StatsDistEntry {
  value: string;
  count: number;
}

export interface Stats {
  total: number;
  totalContents: number;
  withNodeId: number;
  facetsOnly: number;
  oer: { count: number; percent: number };
  erschliessung: { crawler: number; redaktionell: number; spider?: number };
  contentBrackets: StatsDistEntry[];
  matchingStages: Record<string, number>;
  topSubjects: StatsDistEntry[];
  topEducationalContext: StatsDistEntry[];
  topLanguages: StatsDistEntry[];
  topLrt: StatsDistEntry[];
  topByContents: StatsDistEntry[];
  licenseDistribution: StatsDistEntry[];
  quality?: Record<string, number>;
  accessQuality?: Record<string, { known: number; okCount: number; average: number }>;
  legalQuality?: Record<string, { known: number; okCount: number; average: number }>;
  contentQuality?: Record<string, { known: number; okCount: number; average: number }>;
}

export interface SourceFilters {
  q: string;
  subject: string;
  level: string;
  oer: boolean | null;
  spider: boolean | null;
  minCount: number;
  primaryOnly: boolean;
  sort: string;
  order: 'asc' | 'desc';
}

export type ViewMode = 'tile' | 'list' | 'stats';

// ---------------------------------------------------------------------------
// Qualitätsscore: 'ok' (grün) | 'med' (orange) | 'bad' (rot) | 'unk' (grau)
// ---------------------------------------------------------------------------

/**
 * Universelle Qualitätsbewertung für beliebige WLO-Felder.
 *
 * Unterstützte Wertformate:
 *  - URL-Vokabular (ccm:price): letztes Segment "no" / "yes"
 *  - Boolean-String: "true" / "false" / "1" / "0"
 *  - Zahl 0–5: normalisiert auf 0–1, Schwellen 0.7 / 0.35
 *  - Zahl 0–1: direkt als Verhältnis
 *
 * @param raw      Rohwert aus der API
 * @param invert   true = hoher Rohwert ist schlecht (z.B. loginRaw: 1=Pflicht=schlecht)
 */
export function qScore(
  raw: string | null | undefined,
  invert = false,
  zeroGood = false,
): 'ok' | 'med' | 'bad' | 'unk' {
  if (raw === null || raw === undefined || raw === '') return 'unk';
  const s = raw.trim();

  // URL-basiertes Vokabular (kein Leerzeichen, enthält /)
  if (s.includes('/') && !s.includes(' ')) {
    const last = s.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
    if (last === 'no' || last === 'free' || last === 'open' || last === 'no_login'
        || last === 'fully_accessible'
        || last === 'generaldataprotectionregulation') return 'ok';
    if (last === 'yes' || last === 'fee' || last === 'login_required'
        || last === 'login' || last === 'login_for_additional_features'
        || last === 'not_accessible'
        || last === 'nogeneraldataprotectionregulation') return 'bad';
    if (last === 'partially_accessible' || last === 'yes_for_additional') return 'med';
    if (last === 'aaa') return 'ok';
    if (last === 'aa') return 'ok';
    if (last === 'a' || last === 'wcag') return 'med';
    if (last === 'none') return 'unk'; // nicht geprüft
    return 'unk'; // unbekanntes Segment
  }

  // Boolean-Strings
  const lower = s.toLowerCase();
  if (lower === 'true'  || lower === 'yes') return invert ? 'bad' : 'ok';
  if (lower === 'false' || lower === 'no')  return invert ? 'ok'  : 'bad';

  // Numerisch (0–5 oder 0–1)
  const n = parseFloat(s);
  if (isNaN(n)) return 'unk';
  if (n === 0 && zeroGood) return 'ok';             // 0 = "Nein - unauffällig" = gut
  if (n === 0 && !invert) return 'unk';              // 0 = nicht bewertet (WLO-Skala)
  const normalized = n > 1 ? n / 5 : n;          // 0–5 → 0–1
  const score = invert ? 1 - normalized : normalized;
  if (score >= 0.70) return 'ok';
  if (score >= 0.35) return 'med';
  return 'bad';
}

/** CSS-Klasse für qi-Elemente basierend auf qScore-Ergebnis */
export function qCls(score: 'ok' | 'med' | 'bad' | 'unk', prefix = 'qi'): string {
  return `${prefix}-${score === 'ok' ? 'ok' : score === 'med' ? 'med' : score === 'bad' ? 'off' : 'unk'}`;
}

/**
 * Anzeigebeschriftung für Detail-View.
 *
 * Nutzt den optionalen DISPLAYNAME wenn vorhanden, berechnet sonst
 * einen lesbaren Fallback aus dem Rohwert.
 */
export function qDisplayValue(
  raw: string | null | undefined,
  displayName: string | null | undefined,
  invert = false,
): string {
  if (displayName) return displayName;
  if (!raw || raw === '') return '–';
  const s = raw.trim();
  if (s === '' || s === 'null') return '–';

  // URL-Vokabular
  if (s.includes('/') && !s.includes(' ')) {
    const last = s.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      no: 'Nein', yes: 'Ja', free: 'Kostenlos', fee: 'Kostenpflichtig',
      open: 'Offen', closed: 'Geschlossen',
      no_login: 'Kein Login nötig', login_required: 'Login erforderlich',
      login: 'Login erforderlich', login_for_additional_features: 'Login für Extras',
      yes_for_additional: 'Teilweise kostenpflichtig',
      generaldataprotectionregulation: 'DSGVO-konform',
      nogeneraldataprotectionregulation: 'Nicht DSGVO-konform',
      fully_accessible: 'Barrierefrei', partially_accessible: 'Teilweise barrierefrei',
      not_accessible: 'Nicht barrierefrei', none: 'Nicht geprüft',
      aaa: 'AAA', aa: 'AA', a: 'A', wcag: 'WCAG',
    };
    return map[last] ?? last;
  }

  // Boolean
  if (s.toLowerCase() === 'true')  return invert ? 'Ja (vorhanden)' : 'Ja';
  if (s.toLowerCase() === 'false') return invert ? 'Nein' : 'Nein';

  // Numerisch
  const n = parseFloat(s);
  if (!isNaN(n) && n >= 0 && n <= 5 && Number.isInteger(n)) {
    const labels = ['–', 'Sehr schlecht', 'Mangelhaft', 'Ausreichend', 'Gut', 'Sehr gut'];
    return `${labels[n] ?? n} (${n}/5)`;
  }
  if (!isNaN(n) && n >= 0 && n <= 1) return `${(n * 100).toFixed(0)} %`;

  return s.length > 30 ? s.substring(0, 30) + '…' : s;
}

// ---------------------------------------------------------------------------
// Legacy parseQuality – Rückwärtskompatibilität
// ---------------------------------------------------------------------------
/** Parse quality raw values → typed booleans (null = unknown) */
export function parseQuality(r: SourceRecord): {
  loginRequired: boolean | null;
  noAds: boolean | null;
  free: boolean | null;
  gdprOk: boolean | null;
  oer: boolean;
} {
  return {
    loginRequired: r.loginRaw?.endsWith('/no_login') ? false
                 : (r.loginRaw?.endsWith('/login') || r.loginRaw?.endsWith('/login_for_additional_features')) ? true : null,
    free:          r.priceRaw?.endsWith('/no')  ? true
                 : (r.priceRaw?.endsWith('/yes') || r.priceRaw?.endsWith('/yes_for_additional')) ? false : null,
    noAds:         r.adsRaw === '0' ? true : r.adsRaw === '1' ? false : null,
    gdprOk:        r.gdprRaw?.includes('/generalDataProtectionRegulation') ? true
                 : r.gdprRaw?.includes('/noGeneralDataProtectionRegulation') ? false : null,
    oer:           r.oer === true,
  };
}

// ---------------------------------------------------------------------------
// Editorial Status (Quellenerschließungsstatus 0-9)
// ---------------------------------------------------------------------------

/**
 * Parst den editorialStatus String zu einer Zahl 0-9.
 * Erwartet Format wie "9" oder "9. In Suche aufgenommen, Tool wird angeschlossen"
 * Gibt null zurück wenn kein Status vorhanden.
 */
export function parseEditorialStatus(status: string | null | undefined): number | null {
  if (!status || status.trim() === '') return null;
  const match = status.trim().match(/^(\d)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Gibt die Farbe für einen Status-Wert zurück (immer grün, 0/null=grau) */
export function editorialStatusColor(status: number | null): string {
  if (status === null || status === 0) return '#9ca3af'; // gray-400
  return '#22c55e'; // green-500
}

/** Gibt die CSS-Klasse für den Status zurück */
export function editorialStatusClass(status: number | null): string {
  if (status === null || status === 0) return 'es-unk';
  if (status <= 2) return 'es-bad';
  if (status <= 4) return 'es-med';
  if (status <= 6) return 'es-ok';
  return 'es-good';
}

/**
 * Gibt die beste verfügbare Absprung-URL für einen Record zurück:
 * 1. wwwUrl (Originalseite)
 * 2. WLO Render-Link (nodeId)
 * 3. WLO-Suche nach publisher_combined (Fallback)
 */
export function launchUrl(r: SourceRecord): string {
  if (r.wwwUrl) return r.wwwUrl;
  if (r.nodeId) return `https://redaktion.openeduhub.net/edu-sharing/components/render/${r.nodeId}`;
  const bq = r.name || r.title || '';
  if (!bq) return '';
  const filters = JSON.stringify({ 'ccm:oeh_publisher_combined': [bq] });
  return `https://redaktion.openeduhub.net/edu-sharing/components/search?filters=${encodeURIComponent(filters)}`;
}

/** Label für den Status */
export function editorialStatusLabel(status: number | null): string {
  if (status === null) return 'Keine Angabe';
  const labels: Record<number, string> = {
    0: 'Keine Angabe',
    1: 'Nicht erschlossen',
    2: 'In Suche aufgenommen',
    3: 'Metadaten angereichert',
    4: 'Qualität geprüft',
    5: 'Redaktionell überarbeitet',
    6: 'Vollständig erschlossen',
    7: 'Hervorragend erschlossen',
    8: 'Exzellent erschlossen',
    9: 'Vollständig redaktionell',
  };
  return labels[status] ?? `Status ${status}`;
}