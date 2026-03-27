import {
  Component, ElementRef, Input, OnInit, OnDestroy,
  effect, inject,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ApiService } from './services/api.service';
import { SourceService } from './services/source.service';
import { FilterBarComponent } from './components/filter-bar/filter-bar.component';
import { TileViewComponent } from './components/tile-view/tile-view.component';
import { ListViewComponent } from './components/list-view/list-view.component';
import { StatsViewComponent } from './components/stats-view/stats-view.component';
import { DetailViewComponent } from './components/detail-view/detail-view.component';
import { ViewMode } from './models/source.model';

/** Template registry — add new layout variants here without changing component logic */
const LAYOUTS: string[] = ['default'];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    FormsModule,
    DecimalPipe,
    FilterBarComponent,
    TileViewComponent,
    ListViewComponent,
    StatsViewComponent,
    DetailViewComponent,
  ],
  template: `
    <!-- Template: default -->
    @if (layout === 'default') {
      <div class="wsl-host" [class]="'wsl-view-' + currentView">

        <!-- Header -->
        <div class="wsl-header">
          <div class="wsl-header-inner">
            <div class="wsl-title-area">
              <div class="wlo-logo">
                <div class="wlo-brand"><span class="wlo-dark">Wissen</span><span class="wlo-red">Lebt</span><span class="wlo-dark">Online</span></div>
                <div class="wlo-sub">Freie Bildung zum Mitmachen</div>
              </div>
              <span class="wsl-title-sep"></span>
              <span class="wsl-title">Quellenverzeichnis</span>
              @if (src.initialized() && !src.loading()) {
                <span class="wsl-total-badge">{{ src.total() | number }}</span>
              }
            </div>

            <div class="wsl-view-tabs">
              <button class="tab-btn" [class.active]="currentView === 'tile'" (click)="switchView('tile')">
                <svg viewBox="0 0 16 16"><rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor"/><rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor"/></svg>
                Kacheln
              </button>
              <button class="tab-btn" [class.active]="currentView === 'list'" (click)="switchView('list')">
                <svg viewBox="0 0 16 16"><rect x="4" y="2" width="10" height="2" rx="1" fill="currentColor"/><rect x="4" y="7" width="10" height="2" rx="1" fill="currentColor"/><rect x="4" y="12" width="10" height="2" rx="1" fill="currentColor"/><circle cx="2" cy="3" r="1" fill="currentColor"/><circle cx="2" cy="8" r="1" fill="currentColor"/><circle cx="2" cy="13" r="1" fill="currentColor"/></svg>
                Liste
              </button>
              <button class="tab-btn" [class.active]="currentView === 'stats'" (click)="switchView('stats')">
                <svg viewBox="0 0 16 16"><rect x="1" y="8" width="3" height="7" rx="1" fill="currentColor"/><rect x="6" y="4" width="3" height="11" rx="1" fill="currentColor"/><rect x="11" y="1" width="3" height="14" rx="1" fill="currentColor"/></svg>
                Statistiken
              </button>
            </div>
          </div>
        </div>

        <!-- Filter bar (hidden for stats) -->
        @if (currentView !== 'stats') {
          <app-filter-bar (filtersChanged)="onFiltersChanged()" />
        }

        <!-- Loading / Error state -->
        @if (src.loading() && src.sources().length === 0) {
          <div class="state-msg">
            <div class="spinner"></div>
            <span>Lädt Quellenverzeichnis …</span>
          </div>
        } @else if (src.error()) {
          <div class="state-msg error">
            <span>⚠ {{ src.error() }}</span>
            <button class="retry-btn" (click)="src.load()">Erneut versuchen</button>
          </div>
        } @else if (src.initialized() && src.sources().length === 0 && currentView !== 'stats') {
          <div class="state-msg">Keine Quellen gefunden.</div>
        } @else {
          <!-- Main views -->
          @switch (currentView) {
            @case ('tile') {
              <app-tile-view />
            }
            @case ('list') {
              <app-list-view />
            }
            @case ('stats') {
              <app-stats-view />
            }
          }
        }

        <!-- Detail overlay -->
        @if (src.selectedSource()) {
          <app-detail-view />
        }

        <!-- Footer -->
        <div class="wsl-footer">
          <span>WLO Quellenverzeichnis</span>
          <span class="footer-sep">·</span>
          <span>Daten: WissenLebtOnline Produktion</span>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      /* CSS Custom Properties — overridable via web component attributes */
      --wsl-primary:      var(--wsl-primary-input,      #003b7c);
      --wsl-primary-dark: var(--wsl-primary-dark-input,  #002d5f);
      --wsl-primary-light:var(--wsl-primary-light-input, #d0e2f4);
      --wsl-secondary:    var(--wsl-secondary-input,    #002d5f);
      --wsl-accent:       var(--wsl-accent-input,       #f97316);
      --wsl-bg:           var(--wsl-bg-input,           #f4f7fc);
      --wsl-card-bg:      var(--wsl-card-bg-input,      #ffffff);
      --wsl-text:         var(--wsl-text-input,         #12213a);
      --wsl-text-muted:   var(--wsl-text-muted-input,   #5e7291);
      --wsl-border:       var(--wsl-border-input,       #dae2ee);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      color: var(--wsl-text);
    }
    .wsl-host {
      background: var(--wsl-bg);
      min-height: 200px;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--wsl-border);
      border-radius: 12px;
      overflow: hidden;
    }
    /* Header */
    .wsl-header {
      background: var(--wsl-card-bg);
      border-bottom: 1px solid var(--wsl-border);
      padding: 0 16px;
    }
    .wsl-header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 52px;
      gap: 16px;
    }
    .wsl-title-area {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .wlo-logo { display: flex; flex-direction: column; gap: 1px; line-height: 1; }
    .wlo-brand { display: flex; font-size: 15px; font-weight: 800; letter-spacing: -.3px; }
    .wlo-dark  { color: #003b7c; }
    .wlo-red   { color: #e8354a; }
    .wlo-sub   { font-size: 9px; color: var(--wsl-text-muted); letter-spacing: .01em; font-weight: 400; white-space: nowrap; }
    .wsl-title-sep {
      width: 1px; height: 24px;
      background: var(--wsl-border);
      margin: 0 4px;
      flex-shrink: 0;
    }
    .wsl-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--wsl-text);
      white-space: nowrap;
    }
    .wsl-total-badge {
      background: var(--wsl-primary-light, #d0e2f4);
      color: var(--wsl-primary);
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
    }
    /* View tabs */
    .wsl-view-tabs {
      display: flex;
      gap: 2px;
    }
    .tab-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 6px 12px;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      background: transparent;
      color: var(--wsl-text-muted);
      transition: all .15s;
    }
    .tab-btn svg { width: 13px; height: 13px; }
    .tab-btn:hover { background: var(--wsl-bg); color: var(--wsl-text); }
    .tab-btn.active {
      background: var(--wsl-primary-light, #d0e2f4);
      color: var(--wsl-primary);
    }
    /* State messages */
    .state-msg {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      gap: 14px;
      color: var(--wsl-text-muted);
      font-size: 14px;
    }
    .state-msg.error { color: #c0392b; }
    .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid var(--wsl-border);
      border-top-color: var(--wsl-primary);
      border-radius: 50%;
      animation: spin .7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .retry-btn {
      padding: 8px 20px;
      background: var(--wsl-primary);
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
    }
    /* Footer */
    .wsl-footer {
      margin-top: auto;
      padding: 10px 16px;
      background: var(--wsl-card-bg);
      border-top: 1px solid var(--wsl-border);
      font-size: 11px;
      color: var(--wsl-text-muted);
      display: flex;
      gap: 6px;
    }
    .footer-sep { opacity: .4; }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  src   = inject(SourceService);
  private api   = inject(ApiService);
  private elRef = inject(ElementRef);

  currentView: ViewMode = 'tile';
  layout = 'default';

  private initialized = false;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Web Component Inputs ──────────────────────────────────────────────────

  @Input('api-base')
  set apiBase(v: string) {
    this.api.setBase(v || '');
  }

  @Input()
  set view(v: string) {
    if (v === 'tile' || v === 'list' || v === 'stats') {
      this.currentView = v;
    }
  }

  @Input('layout-template')
  set layoutTemplate(v: string) {
    this.layout = LAYOUTS.includes(v) ? v : 'default';
  }

  @Input('min-count')
  set minCount(v: string | number) {
    const n = Number(v);
    if (!isNaN(n)) this.src.minCount.set(n);
  }

  @Input('primary-color')
  set primaryColor(v: string) {
    if (v) this.elRef.nativeElement.style.setProperty('--wsl-primary-input', v);
  }

  @Input('secondary-color')
  set secondaryColor(v: string) {
    if (v) this.elRef.nativeElement.style.setProperty('--wsl-secondary-input', v);
  }

  @Input('accent-color')
  set accentColor(v: string) {
    if (v) this.elRef.nativeElement.style.setProperty('--wsl-accent-input', v);
  }

  @Input('bg-color')
  set bgColor(v: string) {
    if (v) this.elRef.nativeElement.style.setProperty('--wsl-bg-input', v);
  }

  @Input('card-bg')
  set cardBg(v: string) {
    if (v) this.elRef.nativeElement.style.setProperty('--wsl-card-bg-input', v);
  }

  @Input('text-color')
  set textColor(v: string) {
    if (v) this.elRef.nativeElement.style.setProperty('--wsl-text-input', v);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.src.load();
    this.initialized = true;
    // Pre-load stats if stats view is default
    if (this.currentView === 'stats') this.src.loadStats();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  // ── View & Filter handlers ────────────────────────────────────────────────

  switchView(view: ViewMode): void {
    this.currentView = view;
    if (view === 'stats') this.src.loadStats();
  }

  onFiltersChanged(): void {
    this.src.load(1, false);
  }
}
