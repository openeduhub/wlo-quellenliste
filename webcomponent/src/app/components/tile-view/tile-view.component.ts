import { Component, inject, AfterViewInit, OnDestroy, ElementRef, computed, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SourceRecord, qScore, qCls } from '../../models/source.model';
import { SourceService } from '../../services/source.service';

@Component({
  selector: 'app-tile-view',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="tile-grid" #tileGrid>
      @for (r of visibleSources(); track r.name) {
        <div class="tile" [class.no-node]="!r.nodeId" [class.spider]="r.isSpider" [class.oer]="r.oer" (click)="open(r)">

          <!-- Preview image with overlays -->
          <div class="tile-preview">
            @if (r.previewUrl) {
              <img [src]="r.previewUrl" [alt]="r.title || r.name" loading="lazy" />
            } @else {
              <div class="tile-initial">{{ initial(r) }}</div>
            }
            <!-- Top-left: OER + Crawler overlay badges -->
            <div class="overlay-badges">
              @if (r.oer) { <span class="ov-badge oer">OER</span> }
              @if (r.isSpider) { <span class="ov-badge crawler">⚙ Crawler</span> }
            </div>
            <!-- Bottom-left: grouped sub-sources badge -->
            @if (bqCount(r) > 1) {
              <div class="bq-badge" [title]="bqTooltip(r)">{{ bqCount(r) }} Quellen</div>
            }
            <!-- Dark gradient behind count -->
            <div class="count-bg"></div>
            <!-- Bottom-right: count overlay -->
            <div class="count-overlay">
              <span class="co-num">{{ r.contentCount | number }}</span>
              <span class="co-label">Inhalte</span>
            </div>
          </div>

          <!-- Card body -->
          <div class="tile-body">
            <div class="tile-name">{{ r.name }}</div>
            @if (r.title && r.title !== r.name) {
              <div class="tile-subtitle">{{ r.title }}</div>
            }
            @if (r.description) {
              <div class="tile-desc">{{ r.description }}</div>
            }

            @if (r.subjects?.length) {
              <div class="chip-row">
                @for (s of r.subjects!.slice(0, 4); track s) {
                  <span class="chip chip-subj">{{ s }}</span>
                }
                @if (r.subjects!.length > 4) {
                  <span class="chip chip-more">+{{ r.subjects!.length - 4 }}</span>
                }
              </div>
            }

            <!-- Levels in footer row -->
            <div class="tile-footer">
              <div class="tile-levels">
                @for (l of (r.educationalContext ?? []).slice(0, 2); track l) {
                  <span class="chip chip-level">{{ l }}</span>
                }
              </div>
            </div>

            @if (r.oehLrt?.length) {
              <div class="chip-row">
                @for (t of r.oehLrt!.slice(0, 3); track t) {
                  <span class="chip chip-lrt">{{ t }}</span>
                }
              </div>
            }
          </div>

          <!-- Quality footer: 6 Indikatoren -->
          <div class="quality-row">

            <!-- 1. Login -->
            <span class="qi-sq" [class]="qiCls(r.loginRaw)"
                  [title]="'Anmeldung: ' + qiLoginLabel(r.loginRaw)">
              <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11">
                <path d="M3 5a2 2 0 012-2h6v2H5v10h6v2H5a2 2 0 01-2-2V5zm11.293 2.293l3 3a1 1 0 010 1.414l-3 3-1.414-1.414L14.172 11H8v-2h6.172l-1.293-1.293 1.414-1.414z"/>
              </svg>
            </span>

            <!-- 2. Werbung (containsAdvertisement) -->
            <span class="qi-sq" [class]="qiCls(r.qAdvertisement ?? r.adsRaw)"
                  [title]="'Werbung: ' + qiAdsLabel(r.qAdvertisement ?? r.adsRaw)">
              <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11">
                <rect x="2" y="5" width="16" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
                <text x="10" y="13" text-anchor="middle" font-size="6" font-weight="bold" fill="currentColor">AD</text>
              </svg>
            </span>

            <!-- 3. Kosten -->
            <span class="qi-sq" [class]="qiCls(r.priceRaw)"
                  [title]="'Kosten: ' + qiPriceLabel(r.priceRaw)">
              <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11">
                <circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
                <text x="10" y="14" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor">€</text>
              </svg>
            </span>

            <!-- 4. Jugendschutz -->
            <span class="qi-sq" [class]="qiClsLaw(r.lawMinors)"
                  [title]="'Jugendschutz: ' + qiScoreLabel(r.lawMinors, r.lawMinorsLbl)">
              <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11">
                <path d="M10 2L4 5v5c0 3.87 2.6 7.49 6 8.56C13.4 17.49 16 13.87 16 10V5L10 2zm0 3a2 2 0 110 4 2 2 0 010-4zm0 6c2.21 0 4 .9 4 2v.5H6V13c0-1.1 1.79-2 4-2z"/>
              </svg>
            </span>

            <!-- 5. DSGVO -->
            <span class="qi-sq" [class]="qiCls(r.gdprRaw)"
                  [title]="'DSGVO: ' + qiGdprLabel(r.gdprRaw)">
              <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11">
                <path d="M10 1l-7 3.5v5C3 13.41 6.13 17.22 10 18.2 13.87 17.22 17 13.41 17 9.5v-5L10 1zm0 3.18l5 2.5V9.5c0 2.91-2.07 5.65-5 6.65-2.93-1-5-3.74-5-6.65V6.68l5-2.5z"/>
              </svg>
            </span>

            <!-- 6. Barrierefreiheit -->
            <span class="qi-sq" [class]="qiCls(r.qBarrier)"
                  [title]="'Barrierefreiheit: ' + qiBarrierLabel(r.qBarrier)">
              <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11">
                <circle cx="10" cy="4" r="2"/>
                <path d="M7 8h6l-1 4H8L7 8zm-1 5l1 4h1l1-3 1 3h1l1-4" stroke="currentColor" stroke-width=".5"/>
                <path d="M6 9l-2 5h2m8-5l2 5h-2" stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round"/>
              </svg>
            </span>

            @if (r.license) {
              <span class="lic-tag" [class]="licCls(r.license)">{{ licIcon(r.license) }}</span>
            }
            @if (r.isPrimary === false) {
              <span class="dup-tag">Dup</span>
            }
          </div>

        </div>
      }
    </div>

    @if (src.hasMore()) {
      <div class="load-more-row">
        <button class="load-more-btn" (click)="src.loadMore()" [disabled]="src.loading()">
          {{ src.loading() ? 'Lädt …' : 'Mehr laden (' + (src.total() - src.sources().length) + ' weitere)' }}
        </button>
      </div>
    }
  `,
  styles: [`
    /* ── Grid ────────────────────────────────────────────────────────────── */
    .tile-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 24px; padding: 16px;
    }
    @media (max-width: 520px) { .tile-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 340px) { .tile-grid { grid-template-columns: 1fr; } }

    /* ── Card ────────────────────────────────────────────────────────────── */
    .tile {
      background: var(--wsl-card-bg, #fff);
      border: 1.5px solid var(--wsl-border, #e2e8f0);
      border-radius: 14px; overflow: hidden; cursor: pointer;
      transition: transform .18s, box-shadow .18s, border-color .18s;
      display: flex; flex-direction: column;
    }
    .tile:hover {
      transform: translateY(-3px);
      box-shadow: 0 10px 28px color-mix(in srgb, var(--wsl-primary, #003b7c) 14%, transparent);
      border-color: var(--wsl-primary, #003b7c);
    }
    .tile.spider { border-left: 3px solid #d97706; }
    .tile.oer    { border-left: 3px solid #0d9488; }
    .tile.no-node { opacity: .78; }

    /* ── Preview ─────────────────────────────────────────────────────────── */
    .tile-preview {
      position: relative; height: 140px;
      background: linear-gradient(135deg,
        color-mix(in srgb, var(--wsl-primary, #003b7c) 12%, #f8fafc),
        color-mix(in srgb, var(--wsl-primary, #003b7c) 6%, #f8fafc));
      overflow: hidden; flex-shrink: 0;
    }
    .tile-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .tile-initial {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      font-size: 44px; font-weight: 800;
      color: var(--wsl-primary, #003b7c); opacity: .18; user-select: none;
    }
    .overlay-badges { position: absolute; top: 8px; left: 8px; display: flex; gap: 4px; }
    .ov-badge {
      font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 20px;
      letter-spacing: .4px; backdrop-filter: blur(4px);
    }
    .ov-badge.oer     { background: rgba(13,148,136,.85);  color: #fff; }
    .ov-badge.crawler { background: rgba(217,119,6,.85);   color: #fff; }
    .count-bg {
      position: absolute; bottom: 0; left: 0; right: 0; height: 72px;
      background: linear-gradient(to bottom, transparent, rgba(0,0,0,.58));
      pointer-events: none;
    }
    .bq-badge {
      position: absolute; bottom: 8px; left: 8px; z-index: 1;
      font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 20px;
      background: rgba(0,59,124,.82); color: #fff; cursor: help;
      backdrop-filter: blur(4px); letter-spacing: .3px;
    }
    .count-overlay {
      position: absolute; bottom: 8px; right: 10px; z-index: 1;
      display: flex; flex-direction: column; align-items: flex-end;
    }
    .co-num   { font-size: 22px; font-weight: 900; color: #fff; line-height: 1; text-shadow: 0 1px 6px rgba(0,0,0,.7); }
    .co-label { font-size: 9px; color: rgba(255,255,255,.9); font-weight: 700; letter-spacing: .6px; text-transform: uppercase; text-shadow: 0 1px 4px rgba(0,0,0,.6); }

    /* ── Body ────────────────────────────────────────────────────────────── */
    .tile-body { padding: 12px 14px 12px; flex: 1; display: flex; flex-direction: column; gap: 5px; min-height: 0; }
    .tile-name {
      font-size: 13px; font-weight: 700; color: var(--wsl-text, #1e293b);
      margin: 0; line-height: 1.35;
      overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .tile-subtitle { font-size: 11px; color: var(--wsl-text-muted, #94a3b8); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tile-desc {
      font-size: 11.5px; color: var(--wsl-text-muted, #64748b);
      margin: 0; line-height: 1.45; flex: 1;
      overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    }
    .chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
    .chip { font-size: 10px; padding: 2px 8px; border-radius: 20px; white-space: nowrap; line-height: 1.4; }
    .chip-subj  { background: color-mix(in srgb, var(--wsl-primary, #003b7c) 9%, #f8fafc); color: var(--wsl-primary, #003b7c); }
    .chip-level { background: color-mix(in srgb, #0e7490 9%, #f8fafc); color: #0e7490; }
    .chip-lrt   { background: color-mix(in srgb, #16a34a 9%, #f8fafc); color: #15803d; }
    .chip-more  { background: var(--wsl-bg, #f1f5f9); color: var(--wsl-text-muted, #94a3b8); }
    .tile-footer { display: flex; align-items: center; gap: 6px; margin-top: auto; padding-top: 4px; }
    .tile-levels { display: flex; flex-wrap: wrap; gap: 3px; flex: 1; min-width: 0; }

    /* ── Quality Row (6 Indikatoren) ───────────────────────────────────── */
    .quality-row {
      display: flex; gap: 3px; align-items: center; flex-wrap: wrap;
      padding: 6px 10px 8px;
      border-top: 1px solid var(--wsl-border, #e2e8f0);
    }
    .qi-sq {
      width: 20px; height: 20px; border-radius: 4px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      cursor: default;
    }

    /* ── Farben: ok=grün, med=orange, off=rot, unk=grau ──────────────────── */
    .qi-ok  { background: #d1fae5; color: #065f46; }
    .qi-med { background: #fef3c7; color: #92400e; }
    .qi-off { background: #fee2e2; color: #991b1b; }
    .qi-unk { background: var(--wsl-bg, #f1f5f9); color: #cbd5e1; }

    .lic-tag {
      font-size: 9px; padding: 2px 5px; border-radius: 4px; font-weight: 700; margin-left: 2px;
      background: var(--wsl-bg, #f1f5f9); color: var(--wsl-text-muted, #64748b);
    }
    .lic-tag.oer-lic { background: #d1fae5; color: #065f46; }
    .lic-tag.cc      { background: #d0e2f4; color: #003b7c; }
    .lic-tag.copy    { background: #fef9c3; color: #713f12; }
    .dup-tag { font-size: 9px; font-weight: 600; background: #fff3cd; color: #92400e; padding: 1px 5px; border-radius: 4px; }

    /* ── Load more ───────────────────────────────────────────────────────── */
    .load-more-row { text-align: center; padding: 16px; }
    .load-more-btn {
      padding: 10px 28px; background: var(--wsl-primary, #003b7c);
      color: #fff; border: none; border-radius: 8px;
      font-size: 13px; cursor: pointer; transition: opacity .15s;
    }
    .load-more-btn:hover { opacity: .88; }
    .load-more-btn:disabled { opacity: .5; cursor: default; }
  `],
})
export class TileViewComponent implements AfterViewInit, OnDestroy {
  src = inject(SourceService);

  private gridRef = viewChild<ElementRef>('tileGrid');
  private containerWidth = signal(1200);
  private ro: ResizeObserver | null = null;

  /** Spalten pro Zeile basierend auf Container-Breite */
  colsPerRow = computed(() => {
    const minW = 220, gap = 24;
    return Math.max(1, Math.floor((this.containerWidth() + gap) / (minW + gap)));
  });

  /** Nur volle Zeilen anzeigen */
  visibleSources = computed(() => {
    const all = this.src.sources();
    const cols = this.colsPerRow();
    const fullRows = Math.max(1, Math.floor(all.length / cols));
    return all.length % cols === 0 ? all : all.slice(0, fullRows * cols);
  });

  ngAfterViewInit(): void {
    const el = this.gridRef()?.nativeElement;
    if (el) {
      this.ro = new ResizeObserver(entries => {
        this.containerWidth.set(entries[0].contentRect.width);
      });
      this.ro.observe(el);
    }
  }

  ngOnDestroy(): void {
    this.ro?.disconnect();
  }

  open(r: SourceRecord): void { this.src.selectSource(r); }

  initial(r: SourceRecord): string {
    return (r.name || r.title || '?').charAt(0).toUpperCase();
  }

  bqCount(r: SourceRecord): number { return r.bezugsquellen?.length ?? 0; }

  bqTooltip(r: SourceRecord): string {
    const bqs = r.bezugsquellen ?? [];
    if (bqs.length <= 5) return bqs.join(', ');
    return bqs.slice(0, 5).join(', ') + ` … (+${bqs.length - 5})`;
  }

  // ─── Quality helpers ──────────────────────────────────────────────────────

  /** CSS-Klasse für boolean-basierte Felder (login, ads, price …) */
  qiCls(raw: string | null | undefined, invert = false): string {
    return 'qi-sq ' + qCls(qScore(raw, invert));
  }

  /** CSS-Klasse für 0–5-Skala-Felder */
  qiClsScore(raw: string | null | undefined): string {
    return 'qi-sq ' + qCls(qScore(raw, false));
  }

  /** CSS-Klasse für law-Felder wo 0="Nein - unauffällig"=gut */
  qiClsLaw(raw: string | null | undefined): string {
    return 'qi-sq ' + qCls(qScore(raw, false, true));
  }

  qiLoginLabel(raw: string | null | undefined): string {
    if (!raw) return 'unbekannt';
    if (raw.includes('/')) {
      const seg = raw.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
      if (seg === 'no_login') return 'Kein Login nötig ✓';
      if (seg === 'login') return 'Login erforderlich ✗';
      if (seg === 'login_for_additional_features') return 'Login für Extras';
      return seg;
    }
    return raw === '1' ? 'Erforderlich ✗' : raw === '0' ? 'Nicht nötig ✓' : raw;
  }

  qiAdsLabel(raw: string | null | undefined): string {
    if (!raw) return 'unbekannt';
    if (raw.includes('/')) {
      const seg = raw.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
      if (seg === 'no') return 'Keine Werbung ✓';
      if (seg === 'yes') return 'Werbung vorhanden ✗';
      return seg;
    }
    const n = parseFloat(raw);
    if (!isNaN(n)) {
      if (n >= 4) return 'Kaum/keine Werbung ✓';
      if (n >= 3) return 'Zurückhaltend';
      return 'Werbung vorhanden ✗';
    }
    return raw;
  }

  qiPriceLabel(raw: string | null | undefined): string {
    if (!raw) return 'unbekannt';
    if (raw.endsWith('/no'))  return 'Kostenlos ✓';
    if (raw.endsWith('/yes')) return 'Kostenpflichtig ✗';
    if (raw.endsWith('/yes_for_additional')) return 'Teilweise kostenpflichtig';
    return raw;
  }

  qiGdprLabel(raw: string | null | undefined): string {
    if (!raw) return 'unbekannt';
    if (raw.includes('generalDataProtectionRegulation') && !raw.includes('noGeneral')) return 'DSGVO-konform ✓';
    if (raw.includes('noGeneralDataProtectionRegulation')) return 'Nicht DSGVO-konform ✗';
    return raw;
  }

  qiBarrierLabel(raw: string | null | undefined): string {
    if (!raw) return 'unbekannt';
    const last = raw.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
    if (last === 'fully_accessible')    return 'Barrierefrei ✓';
    if (last === 'partially_accessible') return 'Teilweise barrierefrei';
    if (last === 'not_accessible')      return 'Nicht barrierefrei ✗';
    if (last === 'aaa')  return 'AAA (höchste Stufe) ✓';
    if (last === 'aa')   return 'AA (mittel) ✓';
    if (last === 'a')    return 'A (niedrigste Stufe)';
    if (last === 'wcag') return 'WCAG';
    if (last === 'none') return 'Nicht geprüft';
    return raw;
  }

  qiScoreLabel(raw: string | null | undefined, lbl: string | null | undefined): string {
    if (lbl) return lbl;
    if (!raw) return 'unbekannt';
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 0 && n <= 5) {
      const stars = ['–', '★☆☆☆☆', '★★☆☆☆', '★★★☆☆', '★★★★☆', '★★★★★'][n] ?? `${n}`;
      return `${n}/5 ${stars}`;
    }
    return raw;
  }

  licIcon(license: string): string {
    const l = (license ?? '').toUpperCase();
    if (l === 'CC_0' || l === 'CC0') return 'CC0';
    if (l.startsWith('CC_BY')) return 'CC';
    if (l === 'COPYRIGHT_FREE') return '✓';
    return '©';
  }

  licCls(license: string): string {
    const l = (license ?? '').toUpperCase();
    if (l === 'CC_0' || l === 'CC0' || l.startsWith('CC_BY') || l === 'COPYRIGHT_FREE') return 'lic-tag oer-lic';
    if (l.startsWith('CC')) return 'lic-tag cc';
    return 'lic-tag copy';
  }
}