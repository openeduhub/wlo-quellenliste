import { Component, EventEmitter, inject, Output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SourceService } from '../../services/source.service';

@Component({
  selector: 'app-filter-bar',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  template: `
    <div class="filter-bar">
      <div class="search-row">
        <div class="search-wrap">
          <svg class="search-icon" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.5" fill="none"/><line x1="13" y1="13" x2="18" y2="18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <input
            type="search"
            class="search-input"
            placeholder="Quellen suchen …"
            [ngModel]="src.q()"
            (ngModelChange)="onSearch($event)"
          />
        </div>

        <select class="filter-select" [ngModel]="src.subject()" (ngModelChange)="onSubject($event)">
          <option value="">Alle Fächer</option>
          @for (s of src.subjectOptions(); track s) {
            <option [value]="s">{{ s }}</option>
          }
        </select>

        <select class="filter-select" [ngModel]="src.level()" (ngModelChange)="onLevel($event)">
          <option value="">Alle Stufen</option>
          @for (l of src.levelOptions(); track l) {
            <option [value]="l">{{ l }}</option>
          }
        </select>
      </div>

      <div class="toggle-row">
        <label class="wsl-toggle" title="Nur Quellen mit mind. 5 Inhalten und zugeordneter Bezugsquelle">
          <input type="checkbox" [checked]="src.editorial()" (change)="onEditorialToggle()">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span class="toggle-text">Redaktionelle Quellenauswahl</span>
        </label>

        <span class="toggle-sep"></span>

        <label class="wsl-toggle" title="Nur Open Educational Resources anzeigen">
          <input type="checkbox" [checked]="src.oer() === true" (change)="onOerToggle()">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span class="toggle-text">Nur OER</span>
        </label>

        <span class="toggle-sep"></span>

        <label class="wsl-toggle" title="Nur per Crawler erschlossene Quellen anzeigen">
          <input type="checkbox" [checked]="src.spider() === true" (change)="onSpiderToggle()">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span class="toggle-text">Nur Crawler</span>
        </label>

        <span class="results-info">{{ src.total() | number }} Quellen</span>
      </div>
    </div>
  `,
  styles: [`
    .filter-bar {
      background: var(--wsl-card-bg, #fff);
      border-bottom: 1px solid var(--wsl-border, #e8eaf0);
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .search-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .search-wrap {
      position: relative;
      flex: 1;
      min-width: 200px;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: var(--wsl-text-muted, #888);
    }
    .search-input {
      width: 100%;
      padding: 8px 10px 8px 34px;
      border: 1px solid var(--wsl-border, #dde1f0);
      border-radius: 8px;
      font-size: 13px;
      background: var(--wsl-bg, #f8f9ff);
      color: var(--wsl-text, #1a1a2e);
      outline: none;
      transition: border-color .15s;
    }
    .search-input:focus { border-color: var(--wsl-primary, #003b7c); }
    .filter-select {
      padding: 8px 10px;
      border: 1px solid var(--wsl-border, #dde1f0);
      border-radius: 8px;
      font-size: 13px;
      background: var(--wsl-bg, #f8f9ff);
      color: var(--wsl-text, #1a1a2e);
      cursor: pointer;
      min-width: 130px;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .results-info {
      margin-left: auto;
      font-size: 12px;
      color: var(--wsl-text-muted, #888);
    }
    /* Unified toggle switch */
    .wsl-toggle {
      display: flex;
      align-items: center;
      gap: 7px;
      cursor: pointer;
      user-select: none;
    }
    .wsl-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
    .toggle-track {
      position: relative;
      width: 32px;
      height: 17px;
      background: var(--wsl-border, #dde1f0);
      border-radius: 9px;
      transition: background .2s;
      flex-shrink: 0;
    }
    .toggle-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 13px;
      height: 13px;
      background: #fff;
      border-radius: 50%;
      transition: transform .2s;
      box-shadow: 0 1px 2px rgba(0,0,0,.15);
    }
    .wsl-toggle input:checked + .toggle-track {
      background: var(--wsl-primary, #003b7c);
    }
    .wsl-toggle input:checked + .toggle-track .toggle-thumb {
      transform: translateX(15px);
    }
    .toggle-text {
      font-size: 12px;
      font-weight: 500;
      color: var(--wsl-text-muted, #888);
      white-space: nowrap;
    }
    .wsl-toggle input:checked ~ .toggle-text {
      color: var(--wsl-primary, #003b7c);
    }
    .toggle-sep {
      width: 1px;
      height: 18px;
      background: var(--wsl-border, #dde1f0);
      margin: 0 6px;
    }
  `],
})
export class FilterBarComponent {
  src = inject(SourceService);

  @Output() filtersChanged = new EventEmitter<void>();

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  onSearch(val: string): void {
    this.src.setQ(val);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.emit(), 350);
  }

  onSubject(val: string): void { this.src.setSubject(val); this.emit(); }
  onLevel(val: string): void   { this.src.setLevel(val);   this.emit(); }

  onEditorialToggle(): void {
    this.src.toggleEditorial();
  }

  onOerToggle(): void {
    this.src.setOer(this.src.oer() === true ? null : true);
    this.emit();
  }

  onSpiderToggle(): void {
    this.src.setSpider(this.src.spider() === true ? null : true);
    this.emit();
  }

  onReset(): void {
    this.src.clearFilters();
    this.emit();
  }

  private emit(): void {
    this.filtersChanged.emit();
  }
}
