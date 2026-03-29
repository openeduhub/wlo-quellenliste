import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { SourceService } from '../../services/source.service';
import { ApiService, WloNode } from '../../services/api.service';
import { SourceRecord, qScore, qCls, qDisplayValue, parseEditorialStatus, editorialStatusColor, editorialStatusLabel, launchUrl as modelLaunchUrl } from '../../models/source.model';

/** Hilfsfunktion: gibt die CSS-Klasse für eine qi-card zurück */
function cardCls(raw: string | null | undefined, invert = false, zeroGood = false): string {
  const s = qScore(raw, invert, zeroGood);
  return s === 'ok' ? 'card-ok' : s === 'med' ? 'card-med' : s === 'bad' ? 'card-bad' : '';
}

@Component({
  selector: 'app-detail-view',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="overlay" (click)="onOverlayClick($event)">
      <div class="drawer">

        <!-- ── Header ──────────────────────────────────────────────────── -->
        <div class="drawer-header">
          <div class="header-preview">
            @if (r().previewUrl) {
              <img [src]="r().previewUrl" [alt]="r().name" loading="lazy" />
            } @else {
              <div class="header-initial">{{ initial() }}</div>
            }
          </div>
          <div class="header-info">
            <div class="header-name">{{ r().name }}</div>
            @if (r().title && r().title !== r().name) {
              <div class="header-title">{{ r().title }}</div>
            }
            <div class="header-badges">
              @if (r().oer)      { <span class="badge oer-badge">OER</span> }
              @if (r().isSpider) { <span class="badge spider-badge">Crawler</span> }
              @if (r().license)  { <span class="badge lic-badge">{{ r().license }}</span> }
            </div>
            @if (launchUrl()) {
              <a class="header-url" [href]="launchUrl()" target="_blank" rel="noopener">
                <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M8 1.5C6 4 5.5 6 5.5 8s.5 4 2.5 6.5M8 1.5C10 4 10.5 6 10.5 8s-.5 4-2.5 6.5M1.5 8h13" stroke="currentColor" stroke-width="1" fill="none"/></svg>
                {{ r().wwwUrl || 'In WLO suchen' }}
              </a>
            }
            @if (r().editorialStatus) {
              <div class="editorial-status">
                <div class="es-battery">
                  @for (i of [1,2,3,4,5,6,7,8,9]; track i) {
                    <span class="es-bar" [class.filled]="i <= esValue()" [style.background-color]="i <= esValue() ? esColor() : ''"></span>
                  }
                </div>
                <span class="es-text">{{ r().editorialStatus }}</span>
              </div>
            }
          </div>
          <div class="header-actions">
            @if (launchUrl()) {
              <a class="launch-btn" [href]="launchUrl()" target="_blank" rel="noopener" [title]="r().wwwUrl ? 'Originalseite öffnen' : 'In WLO suchen'">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
              </a>
            }
            <button class="close-btn" (click)="src.closeDetail()" aria-label="Schließen">
              <svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>

        <div class="drawer-body">

          <!-- ── Inhalte count ─────────────────────────────────────────── -->
          <div class="count-bar">
            <span class="count-big">{{ r().contentCount | number }}</span>
            <span class="count-label">Inhalte in WLO</span>
          </div>

          <!-- ── Bezugsquellen ─────────────────────────────────────────── -->
          @if (r().bezugsquellen?.length && r().bezugsquellen!.length > 1) {
            <div class="bq-section">
              <button class="bq-toggle" (click)="bqOpen.set(!bqOpen())">
                <svg class="bq-chevron" [class.open]="bqOpen()" viewBox="0 0 16 16"><path d="M5 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
                <span class="bq-count">{{ r().bezugsquellen!.length }}</span>
                zusammengefasste Bezugsquellen
              </button>
              @if (bqOpen()) {
                <div class="bq-list">
                  @for (b of r().bezugsquellen!; track b) {
                    <span class="bq-tag">{{ b }}</span>
                  }
                </div>
              }
            </div>
          }

          <!-- ── Metadaten ─────────────────────────────────────────────── -->
          <div class="meta-grid">
            @if (r().subjects?.length) {
              <div class="meta-item">
                <div class="meta-label">Fächer</div>
                <div class="meta-tags">
                  @for (s of r().subjects!; track s) { <span class="tag chip-subj">{{ s }}</span> }
                </div>
              </div>
            }
            @if (r().educationalContext?.length) {
              <div class="meta-item">
                <div class="meta-label">Bildungsstufen</div>
                <div class="meta-tags">
                  @for (l of r().educationalContext!; track l) { <span class="tag chip-level">{{ l }}</span> }
                </div>
              </div>
            }
            @if (r().oehLrt?.length) {
              <div class="meta-item">
                <div class="meta-label">Inhaltstyp</div>
                <div class="meta-tags">
                  @for (t of r().oehLrt!; track t) { <span class="tag chip-lrt">{{ t }}</span> }
                </div>
              </div>
            }
            @if (r().description) {
              <div class="meta-item full">
                <div class="meta-label">Beschreibung</div>
                <div class="meta-desc">{{ r().description }}</div>
              </div>
            }
          </div>

          <!-- ═══════════════════════════════════════════════════════════ -->
          <!-- ── SEKTION 1: Zugänglichkeit ──────────────────────────── -->
          <!-- ═══════════════════════════════════════════════════════════ -->
          @if (hasAny([r().loginRaw, r().qAdvertisement, r().adsRaw, r().priceRaw, r().accessRaw, r().gdprRaw, r().qBarrier])) {
          <div class="qi-section">
            <div class="section-title">
              <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><path d="M9 1a8 8 0 100 16A8 8 0 009 1zm0 2a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm-1 4h2v7H8V7z"/></svg>
              Zugänglichkeit &amp; Zugang
            </div>
            <div class="qi-grid">

              <!-- Anmeldung -->
              @if (r().loginRaw) {
              <div class="qi-card" [class]="cardCls(r().loginRaw)">
                <svg viewBox="0 0 20 20" class="qi-icon"><path d="M3 5a2 2 0 012-2h6v2H5v10h6v2H5a2 2 0 01-2-2V5zm11.293 2.293l3 3a1 1 0 010 1.414l-3 3-1.414-1.414L14.172 11H8v-2h6.172l-1.293-1.293 1.414-1.414z" fill="currentColor"/></svg>
                <span class="qi-lbl">Anmeldung nötig</span>
                <strong>{{ loginLabel(r().loginRaw) }}</strong>
              </div>
              }

              <!-- Werbung -->
              @if (r().qAdvertisement || r().adsRaw) {
              <div class="qi-card" [class]="cardCls(r().qAdvertisement ?? r().adsRaw)">
                <svg viewBox="0 0 20 20" class="qi-icon"><rect x="2" y="5" width="16" height="10" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/><text x="10" y="13" text-anchor="middle" font-size="7" font-weight="bold" fill="currentColor">AD</text></svg>
                <span class="qi-lbl">Werbung</span>
                <strong>{{ disp(r().qAdvertisement ?? r().adsRaw, r().qAdvertisementLbl) }}</strong>
              </div>
              }

              <!-- Kosten -->
              @if (r().priceRaw) {
              <div class="qi-card" [class]="cardCls(r().priceRaw)">
                <svg viewBox="0 0 20 20" class="qi-icon"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5" fill="none"/><text x="10" y="14" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor">€</text></svg>
                <span class="qi-lbl">Kostenpflichtig</span>
                <strong>{{ priceLabel(r().priceRaw) }}</strong>
              </div>
              }

              <!-- Offenheit / OER-Zugänglichkeit -->
              @if (r().accessRaw) {
                <div class="qi-card" [class]="cardCls(r().accessRaw)">
                  <svg viewBox="0 0 20 20" class="qi-icon"><path d="M10 2a4 4 0 014 4v1h2v10H4V7h2V6a4 4 0 014-4zm0 2a2 2 0 00-2 2v1h4V6a2 2 0 00-2-2zm0 7a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" fill="currentColor"/></svg>
                  <span class="qi-lbl">Offenheit</span>
                  <strong>{{ disp(r().accessRaw, undefined) }}</strong>
                </div>
              }

              <!-- DSGVO -->
              @if (r().gdprRaw) {
                <div class="qi-card" [class]="cardCls(r().gdprRaw)">
                  <svg viewBox="0 0 20 20" class="qi-icon"><path d="M10 1l-7 3.5v5C3 13.41 6.13 17.22 10 18.2 13.87 17.22 17 13.41 17 9.5v-5L10 1zm0 3.18l5 2.5V9.5c0 2.91-2.07 5.65-5 6.65-2.93-1-5-3.74-5-6.65V6.68l5-2.5z" fill="currentColor"/></svg>
                  <span class="qi-lbl">DSGVO</span>
                  <strong>{{ disp(r().gdprRaw, undefined) }}</strong>
                </div>
              }

              <!-- Barrierefreiheit -->
              @if (r().qBarrier) {
                <div class="qi-card" [class]="cardCls(r().qBarrier)">
                  <svg viewBox="0 0 20 20" class="qi-icon"><circle cx="10" cy="4" r="2" fill="currentColor"/><path d="M10 7v5l-3 4M10 12l3 4M7 9h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>
                  <span class="qi-lbl">Barrierefreiheit</span>
                  <strong>{{ disp(r().qBarrier, undefined) }}</strong>
                </div>
              }

            </div><!-- /.qi-grid -->
          </div>
          }

          <!-- ═══════════════════════════════════════════════════════════ -->
          <!-- ── SEKTION 2: Rechtliche Merkmale ─────────────────────── -->
          <!-- ═══════════════════════════════════════════════════════════ -->
          @if (hasAny([r().lawMinors, r().lawPrivacy, r().lawPersonal, r().lawCriminal, r().lawCopyright])) {
            <div class="qi-section">
              <div class="section-title">
                <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><path d="M9 1L2 4.5l1 7C3.5 14.5 6 17 9 18c3-1 5.5-3.5 6-6.5l1-7L9 1zm0 4l2.5 2-1 2.5L9 11l-1.5-1.5L6.5 7l2.5-2z"/></svg>
                Rechtliche Merkmale
              </div>
              <div class="qi-grid">

                @if (r().lawMinors || r().lawMinors === '0') {
                  <div class="qi-card" [class]="cardClsLaw(r().lawMinors)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><path d="M10 2L4 5v5c0 3.87 2.6 7.49 6 8.56C13.4 17.49 16 13.87 16 10V5L10 2zm0 3a2 2 0 110 4 2 2 0 010-4zm0 6c2.21 0 4 .9 4 2v.5H6V13c0-1.1 1.79-2 4-2z" fill="currentColor"/></svg>
                    <span class="qi-lbl">Jugendschutz</span>
                    <strong>{{ disp(r().lawMinors, r().lawMinorsLbl) }}</strong>
                  </div>
                }

                @if (r().lawPrivacy || r().lawPrivacy === '0') {
                  <div class="qi-card" [class]="cardClsLaw(r().lawPrivacy)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><path d="M10 1l-7 3.5v5C3 13.41 6.13 17.22 10 18.2 13.87 17.22 17 13.41 17 9.5v-5L10 1zm0 3.18l5 2.5V9.5c0 2.91-2.07 5.65-5 6.65-2.93-1-5-3.74-5-6.65V6.68l5-2.5z" fill="currentColor"/></svg>
                    <span class="qi-lbl">Datenschutz</span>
                    <strong>{{ disp(r().lawPrivacy, r().lawPrivacyLbl) }}</strong>
                  </div>
                }

                @if (r().lawPersonal || r().lawPersonal === '0') {
                  <div class="qi-card" [class]="cardClsLaw(r().lawPersonal)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><path d="M10 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c4.42 0 8 1.79 8 4v1H2v-1c0-2.21 3.58-4 8-4z" fill="currentColor"/></svg>
                    <span class="qi-lbl">Persönlichkeitsrecht</span>
                    <strong>{{ disp(r().lawPersonal, r().lawPersonalLbl) }}</strong>
                  </div>
                }

                @if (r().lawCriminal || r().lawCriminal === '0') {
                  <div class="qi-card" [class]="cardClsLaw(r().lawCriminal)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><rect x="4" y="3" width="12" height="14" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M7 8h6M7 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    <span class="qi-lbl">Strafrecht</span>
                    <strong>{{ disp(r().lawCriminal, r().lawCriminalLbl) }}</strong>
                  </div>
                }

                @if (r().lawCopyright || r().lawCopyright === '0') {
                  <div class="qi-card" [class]="cardClsLaw(r().lawCopyright)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5" fill="none"/><text x="10" y="14" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor">©</text></svg>
                    <span class="qi-lbl">Urheberrecht</span>
                    <strong>{{ disp(r().lawCopyright, r().lawCopyrightLbl) }}</strong>
                  </div>
                }

              </div>
            </div>
          }

          <!-- ═══════════════════════════════════════════════════════════ -->
          <!-- ── SEKTION 3: Inhaltliche Qualität ────────────────────── -->
          <!-- ═══════════════════════════════════════════════════════════ -->
          @if (hasAny([r().qCurrentness, r().qNeutralness, r().qLanguage, r().qCorrectness, r().qMedial, r().qTransparent, r().qDidactics])) {
            <div class="qi-section">
              <div class="section-title">
                <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><path d="M2 14l5-9 4 5 2-3 3 7H2z"/></svg>
                Inhaltliche Qualität
              </div>
              <div class="qi-grid">

                @if (r().qCurrentness) {
                  <div class="qi-card" [class]="cardCls(r().qCurrentness)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    <span class="qi-lbl">Aktualität</span>
                    <strong>{{ disp(r().qCurrentness, r().qCurrentnessLbl) }}</strong>
                  </div>
                }

                @if (r().qNeutralness) {
                  <div class="qi-card" [class]="cardCls(r().qNeutralness)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><path d="M3 10h14M10 3v14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    <span class="qi-lbl">Neutralität</span>
                    <strong>{{ disp(r().qNeutralness, r().qNeutralnessLbl) }}</strong>
                  </div>
                }

                @if (r().qLanguage) {
                  <div class="qi-card" [class]="cardCls(r().qLanguage)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><path d="M4 5h12M4 9h8M4 13h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    <span class="qi-lbl">Sprachl. Verständlichkeit</span>
                    <strong>{{ disp(r().qLanguage, r().qLanguageLbl) }}</strong>
                  </div>
                }

                @if (r().qCorrectness) {
                  <div class="qi-card" [class]="cardCls(r().qCorrectness)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><path d="M4 10l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
                    <span class="qi-lbl">Sachrichtigkeit</span>
                    <strong>{{ disp(r().qCorrectness, r().qCorrectnessLbl) }}</strong>
                  </div>
                }

                @if (r().qMedial) {
                  <div class="qi-card" [class]="cardCls(r().qMedial)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><rect x="2" y="4" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M16 7l-2 2M16 13l-2-2M16 7v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    <span class="qi-lbl">Medial passend</span>
                    <strong>{{ disp(r().qMedial, r().qMedialLbl) }}</strong>
                  </div>
                }

                @if (r().qTransparent) {
                  <div class="qi-card" [class]="cardCls(r().qTransparent)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M10 9v5M10 7v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                    <span class="qi-lbl">Anbieter-Transparenz</span>
                    <strong>{{ disp(r().qTransparent, r().qTransparentLbl) }}</strong>
                  </div>
                }

                @if (r().qDidactics) {
                  <div class="qi-card" [class]="cardCls(r().qDidactics)">
                    <svg viewBox="0 0 20 20" class="qi-icon"><rect x="3" y="3" width="14" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M7 17h6M10 14v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                    <span class="qi-lbl">Didaktik/Methodik</span>
                    <strong>{{ disp(r().qDidactics, r().qDidacticsLbl) }}</strong>
                  </div>
                }

              </div>
            </div>
          }

          <!-- ── Inhaltskacheln ────────────────────────────────────────── -->
          <div class="content-section">
            <div class="section-title">
              <svg viewBox="0 0 18 18" fill="none" width="14" height="14"><rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="2" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="10" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="10" y="10" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>
              Inhalte aus WLO
              @if (contentLoading()) { <span class="loading-dots">…</span> }
            </div>
            @if (contentNodes().length) {
              <div class="content-grid">
                @for (n of contentNodes(); track n.ref.id) {
                  <a class="content-tile" [href]="contentUrl(n)" target="_blank" rel="noopener">
                    <div class="content-tile-preview">
                      @if (n.preview?.url) {
                        <img [src]="n.preview!.url" [alt]="nodeTitle(n)" loading="lazy" />
                      } @else {
                        <div class="content-initial">{{ (nodeTitle(n) || '?').charAt(0) }}</div>
                      }
                    </div>
                    <div class="ct-body">
                      <div class="ct-title">{{ nodeTitle(n) }}</div>
                      @if (nodeDesc(n)) {
                        <div class="ct-desc">{{ nodeDesc(n) }}</div>
                      }
                      @if (nodeSubjects(n).length) {
                        <div class="ct-chips">
                          @for (s of nodeSubjects(n); track s) {
                            <span class="ct-chip chip-subj">{{ s }}</span>
                          }
                        </div>
                      }
                      @if (nodeLevels(n).length) {
                        <div class="ct-chips">
                          @for (l of nodeLevels(n); track l) {
                            <span class="ct-chip chip-level">{{ l }}</span>
                          }
                        </div>
                      }
                      @if (nodeLrt(n).length) {
                        <div class="ct-chips">
                          @for (t of nodeLrt(n); track t) {
                            <span class="ct-chip chip-lrt">{{ t }}</span>
                          }
                        </div>
                      }
                    </div>
                  </a>
                }
              </div>
              @if (contentHasMore()) {
                <div class="load-more-row">
                  <button class="load-more-btn" (click)="loadMoreContent()" [disabled]="contentLoading()">
                    {{ contentLoading() ? 'Lädt …' : 'Weitere Inhalte laden' }}
                  </button>
                </div>
              }
            } @else if (!contentLoading()) {
              <div class="no-content">Keine verknüpften Inhalte gefunden.</div>
            }
          </div>

        </div><!-- /.drawer-body -->
      </div><!-- /.drawer -->
    </div><!-- /.overlay -->
  `,
  styles: [`
    .overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.45);
      z-index: 1000; display: flex; align-items: stretch; justify-content: flex-end;
    }
    .drawer {
      width: min(720px, 100vw);
      background: var(--wsl-card-bg, #fff);
      display: flex; flex-direction: column; overflow: hidden;
      box-shadow: -4px 0 32px rgba(0,0,0,.2);
      animation: slide-in .25s ease;
    }
    @keyframes slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }

    /* ── Header ────────────────────────────────────────────────────────── */
    .drawer-header {
      display: flex; gap: 16px; padding: 20px;
      border-bottom: 1px solid var(--wsl-border, #e2e8f0);
      background: var(--wsl-bg, #f0f4ff); align-items: flex-start;
    }
    .header-preview {
      width: 160px; height: 80px; border-radius: 12px; overflow: hidden;
      flex-shrink: 0; border: 1px solid var(--wsl-border, #e2e8f0);
    }
    .header-preview img { width: 100%; height: 100%; object-fit: cover; }
    .header-initial {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      font-size: 32px; font-weight: 700;
      color: var(--wsl-primary, #003b7c); background: var(--wsl-primary-light, #d0e2f4);
    }
    .header-info { flex: 1; min-width: 0; }
    .header-name  { font-size: 18px; font-weight: 700; color: var(--wsl-text, #0f172a); line-height: 1.3; }
    .header-title { font-size: 13px; color: var(--wsl-text-muted, #64748b); margin-top: 2px; }
    .header-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
    .badge          { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 8px; }
    .oer-badge      { background: #d4f5e9; color: #1a7a4c; }
    .spider-badge   { background: #dce8f7; color: #1d4a8c; }
    .lic-badge      { background: #d0e2f4; color: #003b7c; }
    .header-url {
      display: flex; align-items: center; gap: 4px; margin-top: 8px;
      font-size: 12px; color: var(--wsl-primary, #003b7c);
      text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .header-url svg { width: 12px; height: 12px; flex-shrink: 0; }
    .header-url:hover { text-decoration: underline; }
    .header-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

    /* Editorial Status */
    .editorial-status {
      display: flex; align-items: center; gap: 8px;
      margin-top: 8px; padding: 6px 10px;
      background: var(--wsl-bg, #f0f4ff); border-radius: 8px;
      margin-left: 0; margin-right: auto;
    }
    .es-battery { display: flex; gap: 2px; align-items: center; }
    .es-bar { width: 5px; height: 14px; border-radius: 1px; background: #e2e8f0; flex-shrink: 0; }
    .es-bar.filled { border-radius: 1px; }
    .es-text { font-size: 12px; color: var(--wsl-text, #0f172a); font-weight: 500; }

    .launch-btn {
      width: 36px; height: 36px; border-radius: 10px;
      background: var(--wsl-primary, #003b7c); color: #fff;
      display: flex; align-items: center; justify-content: center;
      transition: opacity .15s;
    }
    .launch-btn:hover { opacity: .85; }
    .close-btn {
      width: 36px; height: 36px; flex-shrink: 0;
      background: none; border: none; cursor: pointer; border-radius: 10px;
      color: var(--wsl-text-muted, #64748b);
      display: flex; align-items: center; justify-content: center;
    }
    .close-btn:hover { background: var(--wsl-border, #e2e8f0); }
    .close-btn svg { width: 16px; height: 16px; }

    /* ── Body ───────────────────────────────────────────────────────────── */
    .drawer-body {
      flex: 1; overflow-y: auto; padding: 20px;
      display: flex; flex-direction: column; gap: 20px;
    }
    .count-bar {
      display: flex; align-items: baseline; gap: 8px;
      padding: 12px 16px; background: var(--wsl-primary-light, #d0e2f4); border-radius: 10px;
    }
    .count-big   { font-size: 28px; font-weight: 700; color: var(--wsl-primary, #003b7c); }
    .count-label { font-size: 13px; color: var(--wsl-primary, #003b7c); opacity: .8; }

    /* ── Bezugsquellen ──────────────────────────────────────────────────── */
    .bq-section { background: #e8f0f9; border-radius: 10px; padding: 10px 14px; }
    .bq-toggle {
      display: flex; align-items: center; gap: 6px;
      background: none; border: none; cursor: pointer;
      font-size: 12px; color: #003b7c; font-weight: 600; padding: 0;
    }
    .bq-toggle:hover { text-decoration: underline; }
    .bq-chevron { width: 12px; height: 12px; flex-shrink: 0; transition: transform .2s; }
    .bq-chevron.open { transform: rotate(90deg); }
    .bq-count {
      background: #003b7c; color: #fff; font-size: 10px; font-weight: 700;
      min-width: 18px; height: 18px; border-radius: 9px;
      display: inline-flex; align-items: center; justify-content: center; padding: 0 5px;
    }
    .bq-list  { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .bq-tag   { font-size: 11px; padding: 3px 9px; border-radius: 8px; background: #d0e2f4; color: #003b7c; }

    /* ── Meta grid ──────────────────────────────────────────────────────── */
    .meta-grid  { display: flex; flex-direction: column; gap: 12px; }
    .meta-item  { display: flex; flex-direction: column; gap: 6px; }
    .meta-item.full { grid-column: 1/-1; }
    .meta-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--wsl-text-muted, #64748b); }
    .meta-tags  { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag        { font-size: 11px; padding: 3px 9px; border-radius: 20px; }
    .meta-desc  { font-size: 13px; color: var(--wsl-text, #0f172a); line-height: 1.5; }

    /* ── Quality sections ───────────────────────────────────────────────── */
    .qi-section {}
    .section-title {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .05em; color: var(--wsl-text-muted, #64748b);
      margin-bottom: 10px;
      display: flex; align-items: center; gap: 6px;
    }
    .loading-dots { font-size: 14px; }

    /* ── Responsive card grid ───────────────────────────────────────────── */
    .qi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }
    @media (max-width: 500px) {
      .qi-grid { grid-template-columns: repeat(2, 1fr); }
    }

    /* ── Quality cards ──────────────────────────────────────────────────── */
    .qi-card {
      display: flex; flex-direction: column; align-items: center;
      gap: 4px; padding: 10px 8px; border-radius: 10px; text-align: center;
      border: 1px solid var(--wsl-border, #e2e8f0);
      font-size: 11px; color: var(--wsl-text-muted, #64748b);
      background: var(--wsl-card-bg, #fff);
    }
    .qi-card .qi-icon { width: 20px; height: 20px; }
    .qi-card .qi-lbl  { font-size: 10px; line-height: 1.3; opacity: .8; }
    .qi-card strong   { font-size: 12px; font-weight: 600; color: var(--wsl-text, #0f172a); }

    /* Farben: ok=grün, med=orange, bad=rot, (kein Modifier = neutral) */
    .card-ok  { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
    .card-ok  .qi-icon { color: #22c55e; }
    .card-ok  strong   { color: #166534; }

    .card-med { background: #fffbeb; border-color: #fde68a; color: #92400e; }
    .card-med .qi-icon { color: #f59e0b; }
    .card-med strong   { color: #92400e; }

    .card-bad { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
    .card-bad .qi-icon { color: #ef4444; }
    .card-bad strong   { color: #991b1b; }

    /* ── Content tiles ──────────────────────────────────────────────────── */
    .content-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px;
    }
    .content-tile {
      background: var(--wsl-card-bg, #fff);
      border: 1.5px solid var(--wsl-border, #e2e8f0);
      border-radius: 14px; overflow: hidden;
      display: flex; flex-direction: column;
      text-decoration: none; color: var(--wsl-text, #0f172a);
      transition: transform .18s, box-shadow .18s, border-color .18s;
    }
    .content-tile:hover {
      transform: translateY(-3px);
      box-shadow: 0 10px 28px color-mix(in srgb, var(--wsl-primary, #003b7c) 14%, transparent);
      border-color: var(--wsl-primary, #003b7c);
    }
    .content-tile-preview {
      position: relative; height: 140px; overflow: hidden; flex-shrink: 0;
      background: linear-gradient(135deg,
        color-mix(in srgb, var(--wsl-primary, #003b7c) 12%, #f8fafc),
        color-mix(in srgb, var(--wsl-primary, #003b7c) 6%, #f8fafc));
    }
    .content-tile-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .content-initial {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
      font-size: 44px; font-weight: 800;
      color: var(--wsl-primary, #003b7c); opacity: .18; user-select: none;
    }
    .ct-body { padding: 10px 12px 12px; flex: 1; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
    .ct-title {
      font-size: 13px; font-weight: 700; color: var(--wsl-text, #1e293b); line-height: 1.35;
      overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .ct-desc {
      font-size: 11.5px; color: var(--wsl-text-muted, #64748b);
      line-height: 1.45; flex: 1;
      overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    }
    .ct-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .ct-chip  { font-size: 10px; padding: 2px 8px; border-radius: 20px; white-space: nowrap; line-height: 1.4; }
    .chip-subj  { background: color-mix(in srgb, var(--wsl-primary, #003b7c) 9%, #f8fafc); color: var(--wsl-primary, #003b7c); }
    .chip-level { background: color-mix(in srgb, #0e7490 9%, #f8fafc); color: #0e7490; }
    .chip-lrt   { background: color-mix(in srgb, #16a34a 9%, #f8fafc); color: #15803d; }
    .no-content { font-size: 13px; color: var(--wsl-text-muted, #64748b); font-style: italic; }
    .load-more-row { text-align: center; padding: 12px 0 4px; }
    .load-more-btn {
      padding: 8px 24px; background: var(--wsl-primary, #003b7c);
      color: #fff; border: none; border-radius: 8px;
      font-size: 13px; cursor: pointer; transition: opacity .15s;
    }
    .load-more-btn:hover { opacity: .88; }
    .load-more-btn:disabled { opacity: .5; cursor: default; }

    @media (max-width: 600px) {
      .drawer { width: 100vw; }
      .content-grid { grid-template-columns: repeat(2, 1fr); }
    }
  `],
})
export class DetailViewComponent implements OnInit {
  src     = inject(SourceService);
  private api = inject(ApiService);

  contentNodes   = signal<WloNode[]>([]);
  contentLoading = signal(false);
  contentTotal   = signal(0);
  contentHasMore = computed(() => this.contentNodes().length < this.contentTotal());
  bqOpen         = signal(false);

  private readonly PAGE_SIZE = 10;
  private publisherValues: string[] = [];

  readonly r = computed(() => this.src.selectedSource()!);

  ngOnInit(): void {
    const rec = this.src.selectedSource();
    if (!rec) return;
    if (!rec.wwwUrl && !rec.description) {
      this.api.loadSource(rec.name).subscribe({
        next: (full) => this.src.selectSource({ ...rec, ...full }),
        error: () => {},
      });
    }
    this.publisherValues = rec.bezugsquellen?.length ? rec.bezugsquellen : [rec.name];
    this.loadContentPage(0);
  }

  loadMoreContent(): void {
    this.loadContentPage(this.contentNodes().length);
  }

  private loadContentPage(skip: number): void {
    this.contentLoading.set(true);
    this.api.loadWloContent(this.publisherValues, this.PAGE_SIZE, skip).subscribe({
      next: (res) => {
        const prev = skip > 0 ? this.contentNodes() : [];
        this.contentNodes.set([...prev, ...(res.nodes ?? [])]);
        if (res.pagination?.total != null) this.contentTotal.set(res.pagination.total);
        this.contentLoading.set(false);
      },
      error: () => { this.contentLoading.set(false); },
    });
  }

  initial(): string {
    return (this.src.selectedSource()?.name || '?').charAt(0).toUpperCase();
  }

  launchUrl(): string {
    return modelLaunchUrl(this.r());
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /** Gibt CSS-Klasse für qi-card basierend auf Rohwert zurück */
  cardCls(raw: string | null | undefined, invert = false): string {
    return cardCls(raw, invert);
  }

  /** Anzeigewert für Detail-Card */
  disp(raw: string | null | undefined, lbl: string | null | undefined): string {
    return qDisplayValue(raw, lbl);
  }

  /** CSS-Klasse für law-Felder wo 0="Nein - unauffällig"=gut */
  cardClsLaw(raw: string | null | undefined): string {
    return cardCls(raw, false, true);
  }

  loginLabel(raw: string | null | undefined): string {
    if (!raw) return '–';
    if (raw.includes('/')) {
      const seg = raw.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
      if (seg === 'no_login') return 'Kein Login nötig';
      if (seg === 'login') return 'Login erforderlich';
      if (seg === 'login_for_additional_features') return 'Login für Extras';
      return seg;
    }
    return raw === '1' ? 'Ja (erforderlich)' : raw === '0' ? 'Nein' : raw;
  }

  priceLabel(raw: string | null | undefined): string {
    if (!raw) return '–';
    if (raw.endsWith('/no')) return 'Kostenlos';
    if (raw.endsWith('/yes')) return 'Kostenpflichtig';
    if (raw.endsWith('/yes_for_additional')) return 'Teilweise kostenpflichtig';
    const last = raw.split('/').filter(Boolean).pop() ?? '';
    return last || raw;
  }

  hasAny(values: Array<string | null | undefined>): boolean {
    return values.some(v => !!v);
  }

  nodeTitle(n: WloNode): string {
    return n.title || n.name || n.properties?.['cclom:title']?.[0] || '–';
  }

  nodeDesc(n: WloNode): string {
    const d = n.properties?.['cclom:general_description']?.[0] ?? '';
    return d.length > 200 ? d.slice(0, 200) + '…' : d;
  }

  private nodeProp(n: WloNode, ...keys: string[]): string[] {
    for (const k of keys) {
      const v = n.properties?.[k];
      if (v?.length) return v;
    }
    return [];
  }

  nodeSubjects(n: WloNode): string[] {
    return this.nodeProp(n,
      'ccm:taxonentry_DISPLAYNAME',
      'ccm:taxonid_DISPLAYNAME',
      'ccm:taxonid_DISPLAYVALUE',
      'ccm:oeh_taxonid_DISPLAYNAME',
      'ccm:oeh_taxonid_DISPLAYVALUE',
    ).slice(0, 4)
      .filter(v => !v.startsWith('http'));
  }

  nodeLevels(n: WloNode): string[] {
    return this.nodeProp(n,
      'ccm:educationalcontext_DISPLAYNAME',
      'ccm:educationalcontext_DISPLAYVALUE',
    ).slice(0, 2)
      .filter(v => !v.startsWith('http'));
  }

  nodeLrt(n: WloNode): string[] {
    return this.nodeProp(n,
      'ccm:oeh_lrt_aggregated_DISPLAYNAME',
      'ccm:oeh_lrt_aggregated_DISPLAYVALUE',
      'ccm:oeh_lrt_DISPLAYNAME',
      'ccm:oeh_lrt_DISPLAYVALUE',
    ).slice(0, 2)
      .filter(v => !v.startsWith('http'));
  }

  nodeKeywords(n: WloNode): string[] {
    return (n.properties?.['cclom:general_keyword'] ?? []).slice(0, 3);
  }

  contentUrl(n: WloNode): string {
    return `https://redaktion.openeduhub.net/edu-sharing/components/render/${n.ref.id}`;
  }

  onOverlayClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).classList.contains('overlay')) {
      this.src.closeDetail();
    }
  }

  // Editorial Status helpers
  esValue(): number {
    return parseEditorialStatus(this.r().editorialStatus) ?? 0;
  }

  esColor(): string {
    return editorialStatusColor(this.esValue());
  }
}
