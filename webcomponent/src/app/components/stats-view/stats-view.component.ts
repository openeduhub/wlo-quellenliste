import { Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SourceService } from '../../services/source.service';

@Component({
  selector: 'app-stats-view',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="stats-wrap">
      @if (src.statsLoading()) {
        <div class="loading-msg">Statistiken werden geladen …</div>
      } @else if (!src.stats()) {
        <div class="loading-msg">Keine Statistiken verfügbar.</div>
      } @else {
        @let s = src.stats()!;

        <!-- KPI row -->
        <div class="kpi-row">
          <div class="kpi-card">
            <div class="kpi-val">{{ s.total | number }}</div>
            <div class="kpi-label">Bezugsquellen</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">{{ s.totalContents | number }}</div>
            <div class="kpi-label">Inhalte gesamt</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">{{ s.withNodeId | number }}</div>
            <div class="kpi-label">Mit Quelldatensatz</div>
          </div>
          <div class="kpi-card accent">
            <div class="kpi-val">{{ s.oer.percent | number:'1.0-0' }}%</div>
            <div class="kpi-label">OER-Anteil</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val">{{ s.erschliessung.crawler | number }}</div>
            <div class="kpi-label">Crawler-Quellen</div>
          </div>
        </div>

        <!-- Schwimmlinie 1: Inhaltsverteilung -->
        <div class="swim-lane">
          <div class="swim-label">Inhaltsverteilung</div>
          <div class="swim-row">
            <div class="chart-card grow2">
              <div class="chart-title">Top Quellen nach Inhalten</div>
              <div class="bar-list">
                @for (e of s.topByContents.slice(0, 15); track e.value) {
                  <div class="bar-item">
                    <span class="bar-label">{{ e.value }}</span>
                    <div class="bar-track"><div class="bar-fill green" [style.width]="pct(e.count, s.topByContents.length ? s.topByContents[0].count : 1) + '%'"></div></div>
                    <span class="bar-val">{{ e.count | number }}</span>
                  </div>
                }
              </div>
            </div>
            <div class="chart-card grow1">
              <div class="chart-title">Inhalte pro Quelle</div>
              <div class="bar-list">
                @for (e of s.contentBrackets; track e.value) {
                  <div class="bar-item">
                    <span class="bar-label bracket-lbl">{{ e.value }}</span>
                    <div class="bar-track"><div class="bar-fill green" [style.width]="pct(e.count, maxBracket(s)) + '%'"></div></div>
                    <span class="bar-val">{{ e.count | number }}</span>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Schwimmlinie 2: Fächer + Bildungsstufen -->
        <div class="swim-lane">
          <div class="swim-label">Themen &amp; Zielgruppen</div>
          <div class="swim-row">
            <div class="chart-card grow2">
              <div class="chart-title">Top-Fächer</div>
              <div class="bar-list">
                @for (e of s.topSubjects.slice(0, 15); track e.value) {
                  <div class="bar-item">
                    <span class="bar-label">{{ e.value }}</span>
                    <div class="bar-track"><div class="bar-fill green" [style.width]="pct(e.count, s.topSubjects[0].count) + '%'"></div></div>
                    <span class="bar-val">{{ e.count | number }}</span>
                  </div>
                }
              </div>
            </div>
            <div class="chart-card grow1">
              <div class="chart-title">Bildungsstufen</div>
              <div class="bar-list">
                @for (e of s.topEducationalContext.slice(0, 10); track e.value) {
                  <div class="bar-item">
                    <span class="bar-label">{{ e.value }}</span>
                    <div class="bar-track"><div class="bar-fill green" [style.width]="pct(e.count, s.topEducationalContext[0].count) + '%'"></div></div>
                    <span class="bar-val">{{ e.count | number }}</span>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Schwimmlinie 3: Lizenzen + OER -->
        <div class="swim-lane">
          <div class="swim-label">Offenheit &amp; Lizenzen</div>
          <div class="swim-row">
            <div class="chart-card grow2">
              <div class="chart-title">Lizenzen</div>
              <div class="bar-list">
                @for (e of s.licenseDistribution.slice(0, 12); track e.value) {
                  <div class="bar-item">
                    <span class="bar-label">{{ licLabel(e.value) }}</span>
                    <div class="bar-track"><div class="bar-fill" [class]="licCls(e.value)" [style.width]="pct(e.count, s.licenseDistribution[0].count) + '%'"></div></div>
                    <span class="bar-val">{{ e.count | number }}</span>
                  </div>
                }
              </div>
            </div>
            <div class="chart-card grow1 center">
              <div class="chart-title">OER-Anteil</div>
              <div class="donut-wrap">
                <svg class="donut" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="46" fill="none" stroke="var(--wsl-border, #e2e8f0)" stroke-width="14"/>
                  <circle cx="60" cy="60" r="46" fill="none"
                    stroke="#22c55e" stroke-width="14"
                    [attr.stroke-dasharray]="oerDash(s.oer.percent)"
                    stroke-dashoffset="0"
                    transform="rotate(-90 60 60)"/>
                </svg>
                <div class="donut-label">
                  <span class="donut-pct">{{ s.oer.percent | number:'1.0-0' }}%</span>
                  <span class="donut-sub">{{ s.oer.count | number }} OER</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Schwimmlinie 4: Zugänglichkeit -->
        <div class="swim-lane">
          <div class="swim-label">Zugänglichkeit</div>
          <div class="swim-row wrap">
            @for (f of accessFields; track f) {
              @let a = s.accessQuality?.[f];
              <div class="chart-card grow1 center">
                <div class="chart-title">{{ accessLabels[f] }}</div>
                @if (a && a.known) {
                  <div class="avg-donut">
                    <svg viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="30" fill="none" stroke="var(--wsl-border, #e2e8f0)" stroke-width="10"/>
                      <circle cx="40" cy="40" r="30" fill="none"
                        [attr.stroke]="avgColor(a.average)"
                        stroke-width="10"
                        [attr.stroke-dasharray]="avgDash(a.average)"
                        stroke-dashoffset="0" transform="rotate(-90 40 40)"/>
                    </svg>
                    <span class="avg-label">{{ avgWord(a.average) }}</span>
                  </div>
                  <div class="score-sub">Ø {{ a.average }} · {{ a.known | number }} bewertet</div>
                } @else {
                  <div class="score-sub qi-unk">Keine Daten</div>
                }
              </div>
            }
          </div>
        </div>

        <!-- Schwimmlinie 5: Rechtliche Qualität -->
        <div class="swim-lane">
          <div class="swim-label">Rechtliche Qualität</div>
          <div class="swim-row wrap">
            @for (f of lawFields; track f) {
              @let a = s.legalQuality?.[f];
              <div class="chart-card grow1 center">
                <div class="chart-title">{{ lawLabels[f] }}</div>
                @if (a && a.known) {
                  <div class="avg-donut">
                    <svg viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="30" fill="none" stroke="var(--wsl-border, #e2e8f0)" stroke-width="10"/>
                      <circle cx="40" cy="40" r="30" fill="none"
                        [attr.stroke]="avgColor(a.average)"
                        stroke-width="10"
                        [attr.stroke-dasharray]="avgDash(a.average)"
                        stroke-dashoffset="0" transform="rotate(-90 40 40)"/>
                    </svg>
                    <span class="avg-label">{{ avgWord(a.average) }}</span>
                  </div>
                  <div class="score-sub">Ø {{ a.average }} · {{ a.known | number }} bewertet</div>
                } @else {
                  <div class="score-sub qi-unk">Keine Daten</div>
                }
              </div>
            }
          </div>
        </div>

        <!-- Schwimmlinie 6: Inhaltliche Qualität -->
        <div class="swim-lane">
          <div class="swim-label">Inhaltliche Qualität</div>
          <div class="swim-row wrap">
            @for (f of qFields; track f) {
              @let a = s.contentQuality?.[f];
              <div class="chart-card grow1 center">
                <div class="chart-title">{{ qLabels[f] }}</div>
                @if (a && a.known) {
                  <div class="avg-donut">
                    <svg viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="30" fill="none" stroke="var(--wsl-border, #e2e8f0)" stroke-width="10"/>
                      <circle cx="40" cy="40" r="30" fill="none"
                        [attr.stroke]="avgColor(a.average)"
                        stroke-width="10"
                        [attr.stroke-dasharray]="avgDash(a.average)"
                        stroke-dashoffset="0" transform="rotate(-90 40 40)"/>
                    </svg>
                    <span class="avg-label">{{ avgWord(a.average) }}</span>
                  </div>
                  <div class="score-sub">Ø {{ a.average }} · {{ a.known | number }} bewertet</div>
                } @else {
                  <div class="score-sub qi-unk">Keine Daten</div>
                }
              </div>
            }
          </div>
        </div>

      }
    </div>
  `,
  styles: [`
    .stats-wrap { padding: 16px; display: flex; flex-direction: column; gap: 20px; }
    .loading-msg { text-align: center; padding: 40px; color: var(--wsl-text-muted); }
    /* KPI row */
    .kpi-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .kpi-card {
      flex: 1; min-width: 100px;
      background: var(--wsl-card-bg, #fff);
      border: 1px solid var(--wsl-border, #e2e8f0);
      border-radius: 12px; padding: 14px 16px; text-align: center;
    }
    .kpi-card.accent { background: var(--wsl-primary-light, #d0e2f4); border-color: transparent; }
    .kpi-val { font-size: 22px; font-weight: 700; color: var(--wsl-primary, #003b7c); }
    .kpi-label { font-size: 11px; color: var(--wsl-text-muted); margin-top: 3px; }
    /* Swim lanes */
    .swim-lane { display: flex; flex-direction: column; gap: 8px; }
    .swim-label {
      padding: 4px 0;
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .06em; color: var(--wsl-text-muted);
    }
    .swim-row { display: flex; gap: 12px; }
    .swim-row.wrap { flex-wrap: wrap; }
    .chart-card {
      padding: 16px; flex: 1; min-width: 120px;
      background: var(--wsl-card-bg, #fff);
      border: 1px solid var(--wsl-border, #e2e8f0);
      border-radius: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,.04);
      overflow: hidden;
    }
    .chart-card.grow2 { flex: 2; }
    .chart-card.grow1 { flex: 1; }
    .chart-card.center { display: flex; flex-direction: column; align-items: center; }
    .chart-title {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .06em; color: var(--wsl-text-muted);
      margin: -16px -16px 14px -16px;
      padding: 8px 16px;
      background: var(--wsl-bg, #f0f4ff);
      border-bottom: 1px solid var(--wsl-border, #e2e8f0);
      align-self: stretch;
    }
    /* Bar chart */
    .bar-list { display: flex; flex-direction: column; gap: 5px; }
    .bar-item { display: flex; align-items: center; gap: 6px; }
    .bar-label { width: 110px; font-size: 11px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bracket-lbl { width: 60px; font-family: monospace; font-size: 10px; }
    .bar-track { flex: 1; height: 8px; background: var(--wsl-bg, #f0f4ff); border-radius: 4px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width .4s; }
    .bar-fill.primary { background: var(--wsl-primary, #003b7c); }
    .bar-fill.green   { background: #22c55e; }
    .bar-fill.purple  { background: #003b7c; }
    .bar-fill.cyan    { background: #0ea5e9; }
    .bar-fill.teal    { background: #14b8a6; }
    .bar-fill.muted   { background: #94a3b8; }
    .bar-fill.lic-cc  { background: #22c55e; }
    .bar-fill.lic-copy{ background: #f59e0b; }
    .bar-val { width: 38px; font-size: 10px; text-align: right; color: var(--wsl-text-muted); flex-shrink: 0; }
    /* H-bar chart */
    .hbar-group { display: flex; flex-direction: column; gap: 10px; }
    .hbar-item { display: flex; align-items: center; gap: 6px; }
    .hbar-label { width: 90px; font-size: 11px; flex-shrink: 0; }
    .hbar-track { flex: 1; height: 10px; background: var(--wsl-bg, #f0f4ff); border-radius: 5px; overflow: hidden; }
    .hbar-fill { height: 100%; border-radius: 5px; transition: width .4s; }
    .hbar-fill.spider { background: #d97706; }
    .hbar-fill.blue   { background: var(--wsl-primary, #003b7c); }
    .hbar-fill.muted  { background: #94a3b8; }
    .hbar-val { width: 38px; font-size: 10px; text-align: right; color: var(--wsl-text-muted); }
    /* Donut */
    .donut-wrap { position: relative; display: flex; align-items: center; justify-content: center; }
    .donut { width: 110px; height: 110px; }
    .donut-label { position: absolute; display: flex; flex-direction: column; align-items: center; }
    .donut-pct { font-size: 18px; font-weight: 700; color: var(--wsl-text, #0f172a); }
    .donut-sub { font-size: 10px; color: var(--wsl-text-muted); }
    /* Avg-donut */
    .avg-donut { position: relative; display: flex; align-items: center; justify-content: center; }
    .avg-donut svg { width: 80px; height: 80px; }
    .avg-label {
      position: absolute; font-size: 11px; font-weight: 700;
      text-align: center; color: var(--wsl-text, #0f172a);
    }
    .qi-unk { color: var(--wsl-text-muted, #64748b); }
    .score-sub { font-size: 10px; color: var(--wsl-text-muted, #64748b); margin-top: 4px; text-align: center; }
  `],
})
export class StatsViewComponent {
  src = inject(SourceService);

  readonly accessFields = [
    'accessRaw', 'priceRaw', 'qAdvertisement', 'loginRaw',
    'gdprRaw', 'qBarrier',
  ];
  readonly accessLabels: Record<string, string> = {
    accessRaw: 'Offenheit', priceRaw: 'Kostenpflichtig',
    qAdvertisement: 'Werbung', loginRaw: 'Login notwendig',
    gdprRaw: 'DSGVO', qBarrier: 'Barrierearmut',
  };

  readonly lawFields = ['lawMinors', 'lawPrivacy', 'lawPersonal', 'lawCriminal', 'lawCopyright'];
  readonly qFields   = ['qCurrentness', 'qNeutralness', 'qLanguage', 'qCorrectness', 'qMedial', 'qTransparent', 'qDidactics'];

  readonly lawLabels: Record<string, string> = {
    lawMinors: 'Jugendschutz', lawPrivacy: 'Datenschutz',
    lawPersonal: 'Persönlichkeit', lawCriminal: 'Strafrecht',
    lawCopyright: 'Urheberrecht',
  };
  readonly qLabels: Record<string, string> = {
    qCurrentness: 'Aktualität', qNeutralness: 'Neutralität',
    qLanguage: 'Sprache', qCorrectness: 'Korrektheit',
    qMedial: 'Medien', qTransparent: 'Transparenz',
    qDidactics: 'Didaktik',
  };

  oerDash(pct: number): string {
    const circ = 2 * Math.PI * 46;
    return `${(pct / 100) * circ} ${circ}`;
  }

  avgDash(avg: number): string {
    const circ = 2 * Math.PI * 30;
    const frac = avg / 5;
    return `${frac * circ} ${circ}`;
  }

  avgColor(avg: number): string {
    if (avg >= 4) return '#22c55e';
    if (avg >= 3) return '#f59e0b';
    if (avg >= 2) return '#f97316';
    return '#ef4444';
  }

  avgWord(avg: number): string {
    if (avg >= 4.5) return 'Sehr gut';
    if (avg >= 3.5) return 'Gut';
    if (avg >= 2.5) return 'Ausreichend';
    if (avg >= 1.5) return 'Mangelhaft';
    if (avg > 0) return 'Schlecht';
    return '–';
  }

  maxBracket(s: import('../../models/source.model').Stats): number {
    return s.contentBrackets.reduce((m, e) => Math.max(m, e.count), 1);
  }

  pct(val: number, max: number): number {
    if (!max) return 0;
    return Math.round((val / max) * 100);
  }

  licLabel(key: string): string {
    const map: Record<string, string> = {
      CC_BY: 'CC BY', CC_BY_SA: 'CC BY-SA', CC_BY_NC: 'CC BY-NC',
      CC_BY_NC_SA: 'CC BY-NC-SA', CC_BY_ND: 'CC BY-ND', CC0: 'CC0',
      PDM: 'Public Domain', COPYRIGHT: 'Copyright', UNTERRICHTS: 'Unterrichtsmaterial',
    };
    return map[key] ?? key;
  }

  licCls(key: string): string {
    if (key.startsWith('CC') || key === 'CC0' || key === 'PDM') return 'lic-cc';
    return 'lic-copy';
  }
}
