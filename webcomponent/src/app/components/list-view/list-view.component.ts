import { Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SourceRecord, qScore, qCls, parseEditorialStatus, editorialStatusColor, editorialStatusLabel, launchUrl as modelLaunchUrl } from '../../models/source.model';
import { SourceService } from '../../services/source.service';

/** Tooltip-Text für einen Qualitätsscore */
function scoreTooltip(label: string, raw: string | null | undefined, lbl: string | null | undefined): string {
  if (!raw && !lbl) return `${label}: unbekannt`;
  if (lbl) return `${label}: ${lbl}`;
  const n = parseFloat(raw!);
  if (!isNaN(n) && n >= 0 && n <= 5) {
    const words = ['–', 'Sehr schlecht', 'Mangelhaft', 'Ausreichend', 'Gut', 'Sehr gut'];
    return `${label}: ${words[n] ?? n} (${n}/5)`;
  }
  return `${label}: ${raw}`;
}

@Component({
  selector: 'app-list-view',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="list-wrap">
      <div class="list-stats">
        <span>{{ src.total() | number }} Quellen</span>
        @if (src.minCount() > 0) {
          <span class="min-badge">mind. {{ src.minCount() }} Inhalte</span>
        }
      </div>

      <table class="list-table">
        <thead>
          <tr>
            <th class="col-avatar"></th>
            <th class="col-name">Quelle</th>
            <th class="col-count" (click)="sortBy('contentCount')" style="cursor:pointer">
              Inhalte <span class="sort-arrow">{{ sortArrow('contentCount') }}</span>
            </th>
            <th class="col-subj">Fach</th>
            <th class="col-edu">Bildungsstufe</th>
            <th class="col-type">Typ</th>
            <th class="col-oer">OER</th>
            <th class="col-es">Erschließung</th>
            <th class="col-qi">Qualität</th>
            <th class="col-launch"></th>
          </tr>
        </thead>
        <tbody>
          @for (r of src.sources(); track r.name) {
            <tr [class.no-node]="!r.nodeId" (click)="open(r)">
              <td class="col-avatar">
                @if (r.previewUrl) {
                  <img class="avatar" [src]="r.previewUrl" [alt]="r.title || r.name" loading="lazy" />
                } @else {
                  <div class="avatar-init">{{ initial(r) }}</div>
                }
              </td>
              <td class="col-name">
                <div class="name-cell">
                  <span class="src-name">{{ r.name }}</span>
                  @if (r.title && r.title !== r.name) {
                    <span class="src-title">{{ r.title }}</span>
                  }
                  <div class="badge-row">
                    @if (r.isPrimary === false){ <span class="badge dup-badge">Duplikat</span> }
                    @if (bqCount(r) > 1)      { <span class="badge bq-badge" [title]="bqTooltip(r)">{{ bqCount(r) }} Bezugsquellen</span> }
                  </div>
                </div>
              </td>
              <td class="col-count">
                <div class="count-cell">
                  <span class="count-n">{{ r.contentCount | number }}</span>
                  <span class="count-l">Inhalte</span>
                </div>
              </td>
              <td class="col-subj">
                @for (s of (r.subjects ?? []).slice(0, 3); track s) {
                  <span class="subj-tag">{{ s }}</span>
                }
              </td>
              <td class="col-edu">
                @for (l of (r.educationalContext ?? []).slice(0, 2); track l) {
                  <span class="edu-tag">{{ l }}</span>
                }
              </td>
              <td class="col-type">
                @if (r.isSpider) {
                  <span class="type-tag spider">Crawler</span>
                }
              </td>
              <td class="col-oer">
                @if (r.oer) { <span class="badge oer-badge">OER</span> }
              </td>

              <!-- Editorial Status (Akku-Anzeige) -->
              <td class="col-es">
                @if (r.editorialStatus) {
                  <div class="es-battery" [title]="esTooltip(r)">
                    @for (i of [1,2,3,4,5,6,7,8,9]; track i) {
                      <span class="es-bar" [class.filled]="i <= esValue(r)" [style.background-color]="i <= esValue(r) ? esColor(r) : ''"></span>
                    }
                  </div>
                }
              </td>

              <!-- 7 Qualitätsindikatoren -->
              <td class="col-qi">
                <div class="qi-row">

                  <!-- 1. Login -->
                  <span class="qi" [class]="qiCls(r.loginRaw)"
                        [title]="'Anmeldung: ' + loginLabel(r.loginRaw)">
                    <svg viewBox="0 0 16 16">
                      <path d="M8 1a3 3 0 1 1 0 6A3 3 0 0 1 8 1zm0 7c3.31 0 6 1.34 6 3v1H2v-1c0-1.66 2.69-3 6-3z" fill="currentColor"/>
                    </svg>
                  </span>

                  <!-- 2. Werbung -->
                  <span class="qi" [class]="qiCls(r.qAdvertisement ?? r.adsRaw)"
                        [title]="'Werbung: ' + adsLabel(r.qAdvertisement ?? r.adsRaw)">
                    <svg viewBox="0 0 16 16">
                      <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/>
                      <text x="8" y="11" text-anchor="middle" font-size="6" font-weight="bold" fill="currentColor">AD</text>
                    </svg>
                  </span>

                  <!-- 3. Kosten -->
                  <span class="qi" [class]="qiCls(r.priceRaw)"
                        [title]="'Kosten: ' + priceLabel(r.priceRaw)">
                    <svg viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2" fill="none"/>
                      <text x="8" y="11.5" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor">€</text>
                    </svg>
                  </span>

                  <!-- 4. Jugendschutz -->
                  <span class="qi" [class]="qiClsLaw(r.lawMinors)"
                        [title]="scoreTip('Jugendschutz', r.lawMinors, r.lawMinorsLbl)">
                    <svg viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 1.5L2.5 4v4.5C2.5 12 5 14.9 8 15.7c3-0.8 5.5-3.7 5.5-7.2V4L8 1.5zm0 2.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm0 4.5c1.66 0 3 .67 3 1.5v.5H5v-.5c0-.83 1.34-1.5 3-1.5z"/>
                    </svg>
                  </span>

                  <!-- 5. DSGVO -->
                  <span class="qi" [class]="qiCls(r.gdprRaw)"
                        [title]="'DSGVO: ' + gdprLabel(r.gdprRaw)">
                    <svg viewBox="0 0 16 16" fill="none">
                      <path d="M8 1L2 4v4c0 3.55 2.57 6.87 6 7.68C11.43 14.87 14 11.55 14 8V4L8 1z" stroke="currentColor" stroke-width="1.2"/>
                    </svg>
                  </span>

                  <!-- 6. Barrierefreiheit -->
                  <span class="qi" [class]="qiCls(r.qBarrier)"
                        [title]="barrierLabel(r.qBarrier)">
                    <svg viewBox="0 0 16 16" fill="currentColor">
                      <circle cx="8" cy="3.5" r="1.5"/>
                      <path d="M5.5 6.5h5l-.8 3H6.3L5.5 6.5zm-1 4l.8 3h.8l.9-2.5.9 2.5h.8l.8-3" stroke="currentColor" stroke-width=".4"/>
                      <path d="M5 7l-1.5 4h1.5M11 7l1.5 4H11" stroke="currentColor" stroke-width=".8" fill="none" stroke-linecap="round"/>
                    </svg>
                  </span>

                </div>
              </td>

              <!-- Absprung-Button -->
              <td class="col-launch">
                @if (launchUrl(r)) {
                  <a class="launch-sm" [href]="launchUrl(r)" target="_blank" rel="noopener" [title]="r.wwwUrl ? 'Originalseite öffnen' : 'In WLO suchen'" (click)="$event.stopPropagation()">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                  </a>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>

      @if (src.hasMore()) {
        <div class="load-more-row">
          <button class="load-more-btn" (click)="src.loadMore()" [disabled]="src.loading()">
            {{ src.loading() ? 'Lädt …' : 'Mehr laden (' + (src.total() - src.sources().length) + ' weitere)' }}
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .list-wrap { overflow-x: auto; }
    .list-stats {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; font-size: 12px;
      color: var(--wsl-text-muted, #888);
      border-bottom: 1px solid var(--wsl-border, #e8eaf0);
      background: var(--wsl-card-bg, #fff);
    }
    .min-badge {
      background: var(--wsl-primary, #003b7c); color: #fff;
      padding: 2px 8px; border-radius: 10px; font-size: 11px;
    }
    .list-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead tr {
      background: var(--wsl-bg, #f8f9ff);
      border-bottom: 2px solid var(--wsl-border, #e8eaf0);
      position: sticky; top: 0; z-index: 1;
    }
    th {
      padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 600;
      color: var(--wsl-text-muted, #888); text-transform: uppercase;
      letter-spacing: .04em; white-space: nowrap;
    }
    td { padding: 10px 12px; border-bottom: 1px solid var(--wsl-border, #f0f2ff); vertical-align: middle; background: var(--wsl-card-bg, #fff); }
    tbody tr { transition: box-shadow .15s, transform .1s; }
    tbody tr:hover td { background: var(--wsl-bg, #f4f7ff); }
    tbody tr:hover { box-shadow: 0 2px 10px rgba(30,64,175,.10); position: relative; z-index: 1; }
    tr.no-node td { opacity: .7; }
    .col-avatar { width: 100px; }
    .col-subj   { width: 120px; }
    .col-edu    { width: 120px; }
    .col-count  { width: 72px; }
    .col-type   { width: 76px; }
    .col-lrt    { width: 120px; }
    .col-oer    { width: 54px; }
    .col-es     { width: 72px; }
    .col-qi     { width: 142px; }
    .col-launch  { width: 36px; text-align: center; }

    .avatar { width: 90px; height: 45px; border-radius: 6px; object-fit: cover; display: block; }
    .avatar-init {
      width: 90px; height: 45px; border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      background: var(--wsl-bg, #f0f4ff); font-size: 18px; font-weight: 700;
      color: var(--wsl-primary, #003b7c);
    }
    .name-cell { display: flex; flex-direction: column; gap: 2px; }
    .src-name  { font-weight: 600; color: var(--wsl-text, #1a1a2e); line-height: 1.3; }
    .src-title { font-size: 11px; color: var(--wsl-text-muted, #888); }
    .badge-row { display: flex; gap: 3px; flex-wrap: wrap; margin-top: 3px; }
    .badge     { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 7px; }
    .oer-badge { background: #d1fae5; color: #065f46; }
    .dup-badge { background: #fff3cd; color: #92400e; }
    .bq-badge  { background: #d0e2f4; color: #003b7c; cursor: help; }
    .subj-tag {
      display: inline-block; font-size: 10px; padding: 2px 8px;
      background: color-mix(in srgb, #003b7c 10%, #f8fafc); color: #003b7c;
      border-radius: 20px; margin: 1px;
    }
    .edu-tag {
      display: inline-block; font-size: 10px; padding: 2px 8px;
      background: color-mix(in srgb, #0d9488 10%, #f8fafc); color: #0b7870;
      border-radius: 20px; margin: 1px;
    }
    .lrt-tag {
      display: inline-block; font-size: 10px; padding: 2px 8px;
      background: color-mix(in srgb, #16a34a 10%, #f8fafc); color: #15803d;
      border-radius: 20px; margin: 1px;
    }
    .count-cell { display: flex; flex-direction: column; align-items: flex-end; }
    .count-n    { font-weight: 700; color: var(--wsl-primary, #003b7c); font-size: 13px; }
    .count-l    { font-size: 9px; color: var(--wsl-text-muted); text-transform: uppercase; letter-spacing:.04em; }
    tbody tr { cursor: pointer; }
    .type-tag  { font-size: 11px; padding: 2px 8px; border-radius: 8px; font-weight: 500; }
    .type-tag.spider { background: #dce8f7; color: #1d4a8c; }
    .type-tag.red    { background: #d0e2f4; color: #003b7c; }
    .type-tag.none   { color: #bbb; }
    .sort-arrow { font-size: 10px; }

    /* ── Quality indicators ───────────────────────────────────────────────── */
    .qi-row { display: flex; gap: 3px; flex-wrap: nowrap; }
    .qi {
      width: 20px; height: 20px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      cursor: default;
    }
    .qi svg { width: 12px; height: 12px; }
    .oer-qi { border-radius: 3px; }

    /* Farben ok=grün, med=orange, off=rot, unk=grau */
    .qi-ok  { background: #d1fae5; color: #065f46; }
    .qi-med { background: #fef3c7; color: #92400e; }
    .qi-off { background: #fee2e2; color: #991b1b; }
    .qi-unk { background: #f1f5f9; color: #94a3b8; }

    /* Editorial Status (Akku) */
    .es-battery {
      display: flex; gap: 2px; align-items: center; height: 18px;
      cursor: help;
    }
    .es-bar {
      width: 5px; height: 12px; border-radius: 1px;
      background: #e2e8f0; flex-shrink: 0;
    }
    .es-bar.filled { border-radius: 1px; }

    .load-more-row { text-align: center; padding: 16px; }
    .load-more-btn {
      padding: 10px 28px; background: var(--wsl-primary, #003b7c);
      color: #fff; border: none; border-radius: 8px;
      font-size: 13px; cursor: pointer;
    }
    .load-more-btn:disabled { opacity: .6; cursor: default; }

    /* Absprung-Button */
    .launch-sm {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 6px;
      color: #94a3b8; background: transparent;
      transition: color .15s, background .15s;
    }
    .launch-sm:hover { color: #2563eb; background: #eff6ff; }
    .launch-sm svg { width: 14px; height: 14px; }
  `],
})
export class ListViewComponent {
  src = inject(SourceService);

  open(r: SourceRecord): void { this.src.selectSource(r); }

  initial(r: SourceRecord): string {
    return (r.name || r.title || '?').charAt(0).toUpperCase();
  }

  bqCount(r: SourceRecord): number { return r.bezugsquellen?.length ?? 0; }

  bqTooltip(r: SourceRecord): string {
    const bqs = r.bezugsquellen ?? [];
    if (bqs.length <= 5) return bqs.join(', ');
    return bqs.slice(0, 5).join(', ') + ` \u2026 (+${bqs.length - 5})`;
  }

  qiCls(raw: string | null | undefined): string {
    return 'qi ' + qCls(qScore(raw, false));
  }

  qiClsScore(raw: string | null | undefined): string {
    return 'qi ' + qCls(qScore(raw, false));
  }

  qiClsLaw(raw: string | null | undefined): string {
    return 'qi ' + qCls(qScore(raw, false, true));
  }

  loginLabel(raw: string | null | undefined): string {
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

  adsLabel(raw: string | null | undefined): string {
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

  priceLabel(raw: string | null | undefined): string {
    if (!raw) return 'unbekannt';
    if (raw.endsWith('/no'))  return 'Kostenlos ✓';
    if (raw.endsWith('/yes')) return 'Kostenpflichtig ✗';
    if (raw.endsWith('/yes_for_additional')) return 'Teilweise kostenpflichtig';
    return raw;
  }

  gdprLabel(raw: string | null | undefined): string {
    if (!raw) return 'unbekannt';
    if (raw.includes('generalDataProtectionRegulation') && !raw.includes('noGeneral')) return 'DSGVO-konform ✓';
    if (raw.includes('noGeneralDataProtectionRegulation')) return 'Nicht DSGVO-konform ✗';
    return raw;
  }

  barrierLabel(raw: string | null | undefined): string {
    if (!raw) return 'Barrierefreiheit: unbekannt';
    const last = raw.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
    if (last === 'aaa')  return 'Barrierefreiheit: AAA (höchste Stufe) ✓';
    if (last === 'aa')   return 'Barrierefreiheit: AA (mittel) ✓';
    if (last === 'a')    return 'Barrierefreiheit: A (niedrigste Stufe)';
    if (last === 'wcag') return 'Barrierefreiheit: WCAG';
    if (last === 'none') return 'Barrierefreiheit: Nicht geprüft';
    return 'Barrierefreiheit: ' + raw;
  }

  scoreTip(label: string, raw?: string | null, lbl?: string | null): string {
    return scoreTooltip(label, raw, lbl);
  }

  sortBy(field: string): void {
    if (this.src.sort() === field) {
      this.src.order.set(this.src.order() === 'desc' ? 'asc' : 'desc');
    } else {
      this.src.sort.set(field);
      this.src.order.set('desc');
    }
    this.src.load();
  }

  sortArrow(field: string): string {
    if (this.src.sort() !== field) return '↕';
    return this.src.order() === 'desc' ? '↓' : '↑';
  }

  launchUrl(r: SourceRecord): string {
    return modelLaunchUrl(r);
  }

  // Editorial Status helpers
  esValue(r: SourceRecord): number {
    return parseEditorialStatus(r.editorialStatus) ?? 0;
  }

  esColor(r: SourceRecord): string {
    return editorialStatusColor(this.esValue(r));
  }

  esTooltip(r: SourceRecord): string {
    const val = this.esValue(r);
    const label = editorialStatusLabel(val);
    const full = r.editorialStatus ?? '';
    return `${label}${full ? ' – ' + full : ''}`;
  }
}