import { Injectable, computed, signal } from '@angular/core';
import { ApiService } from './api.service';
import { SourceFilters, SourcePage, SourceRecord, Stats } from '../models/source.model';

@Injectable({ providedIn: 'root' })
export class SourceService {
  private api: ApiService;

  constructor(api: ApiService) {
    this.api = api;
  }

  readonly PAGE_SIZE = 20;

  // ── Data state ────────────────────────────────────────────────────────────
  sources    = signal<SourceRecord[]>([]);
  total      = signal(0);
  pages      = signal(0);
  currentPage = signal(1);
  loading    = signal(false);
  error      = signal<string | null>(null);
  initialized = signal(false);

  stats        = signal<Stats | null>(null);
  statsLoading = signal(false);

  // ── Editorial toggle ──────────────────────────────────────────────────────
  editorial  = signal(true);

  // ── Filter signals ────────────────────────────────────────────────────────
  q          = signal('');
  subject    = signal('');
  level      = signal('');
  oer        = signal<boolean | null>(null);
  spider     = signal<boolean | null>(null);
  minCount   = signal(5);
  primaryOnly = signal(true);
  sort       = signal('contentCount');
  order      = signal<'asc' | 'desc'>('desc');

  filters = computed<Partial<SourceFilters>>(() => ({
    q:          this.q(),
    subject:    this.subject(),
    level:      this.level(),
    oer:        this.oer(),
    spider:     this.spider(),
    minCount:   this.minCount(),
    primaryOnly: this.primaryOnly(),
    sort:       this.sort(),
    order:      this.order(),
  }));

  activeFilterCount = computed(() => {
    let n = 0;
    if (this.q())          n++;
    if (this.subject())    n++;
    if (this.level())      n++;
    if (this.oer()   != null) n++;
    if (this.spider() != null) n++;
    return n;
  });

  hasMore = computed(() => this.currentPage() < this.pages());

  // ── Unique filter options (derived from loaded data) ──────────────────────
  subjectOptions = computed(() => {
    const set = new Set<string>();
    for (const r of this.sources()) {
      for (const s of r.subjects ?? []) set.add(s);
    }
    return [...set].sort();
  });

  levelOptions = computed(() => {
    const set = new Set<string>();
    for (const r of this.sources()) {
      for (const l of r.educationalContext ?? []) set.add(l);
    }
    return [...set].sort();
  });

  // ── Load methods ──────────────────────────────────────────────────────────
  load(page = 1, append = false): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.loadSources(this.filters(), page, this.PAGE_SIZE).subscribe({
      next: (res: SourcePage) => {
        this.total.set(res.total);
        this.pages.set(res.pages);
        this.currentPage.set(res.page);
        if (append) {
          this.sources.update((s: SourceRecord[]) => [...s, ...res.items]);
        } else {
          this.sources.set(res.items);
        }
        this.loading.set(false);
        this.initialized.set(true);
      },
      error: (e: { message?: string }) => {
        this.error.set(e?.message ?? 'Fehler beim Laden der Daten.');
        this.loading.set(false);
        this.initialized.set(true);
      },
    });
  }

  loadMore(): void {
    if (this.hasMore()) {
      this.load(this.currentPage() + 1, true);
    }
  }

  loadStats(): void {
    if (this.statsLoading()) return;
    this.statsLoading.set(true);
    this.api.loadStats().subscribe({
      next:  (s: Stats) => { this.stats.set(s); this.statsLoading.set(false); },
      error: ()        => { this.statsLoading.set(false); },
    });
  }

  // ── Detail view ──────────────────────────────────────────────────────────
  selectedSource = signal<SourceRecord | null>(null);
  selectSource(r: SourceRecord): void { this.selectedSource.set(r); }
  closeDetail(): void { this.selectedSource.set(null); }

  // ── Filter helpers ────────────────────────────────────────────────────────
  setQ(v: string): void       { this.q.set(v); }
  setSubject(v: string): void { this.subject.set(v); }
  setLevel(v: string): void   { this.level.set(v); }
  setOer(v: boolean | null): void    { this.oer.set(v); }
  setSpider(v: boolean | null): void { this.spider.set(v); }
  setMinCount(n: number): void { this.minCount.set(n); this.load(); }

  toggleEditorial(on?: boolean): void {
    const v = on ?? !this.editorial();
    this.editorial.set(v);
    this.minCount.set(v ? 5 : 0);
    this.primaryOnly.set(v);
    this.load();
  }

  clearFilters(): void {
    this.q.set('');
    this.subject.set('');
    this.level.set('');
    this.oer.set(null);
    this.spider.set(null);
  }

  applyFilters(): void {
    this.load(1, false);
  }
}
