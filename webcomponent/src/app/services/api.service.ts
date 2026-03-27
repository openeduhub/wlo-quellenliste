import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SourceFilters, SourcePage, SourceRecord, Stats } from '../models/source.model';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = '';

  constructor(private http: HttpClient) {}

  setBase(base: string): void {
    this.base = base.replace(/\/$/, '');
  }

  loadSources(
    filters: Partial<SourceFilters>,
    page: number,
    pageSize: number,
  ): Observable<SourcePage> {
    let params = new HttpParams()
      .set('fields', 'slim')
      .set('page', String(page))
      .set('page_size', String(pageSize))
      .set('sort', filters.sort ?? 'contentCount')
      .set('order', filters.order ?? 'desc')
      .set('primary_only', String(filters.primaryOnly ?? true));

    if (filters.q)                params = params.set('q',         filters.q);
    if (filters.subject)          params = params.set('subject',   filters.subject);
    if (filters.level)            params = params.set('level',     filters.level);
    if (filters.oer    != null)   params = params.set('oer',       String(filters.oer));
    if (filters.spider != null)   params = params.set('spider',    String(filters.spider));
    if (filters.minCount != null) params = params.set('min_count', String(filters.minCount));

    return this.http.get<SourcePage>(`${this.base}/data/sources`, { params });
  }

  loadSource(name: string): Observable<SourceRecord> {
    return this.http.get<SourceRecord>(
      `${this.base}/data/sources/${encodeURIComponent(name)}`,
    );
  }

  loadStats(): Observable<Stats> {
    return this.http.get<Stats>(`${this.base}/data/stats`);
  }

  loadJobStatus(): Observable<unknown> {
    return this.http.get(`${this.base}/jobs/latest`);
  }

  loadWloContent(publisherNames: string | string[], maxItems = 10, skipCount = 0): Observable<{ nodes: WloNode[]; pagination?: { total?: number } }> {
    const values = Array.isArray(publisherNames) ? publisherNames : [publisherNames];
    return this.http.post<{ nodes: WloNode[]; pagination?: { total?: number } }>(
      `${this.base}/edu-sharing/rest/search/v1/queries/-home-/mds_oeh/ngsearch?contentType=FILES&maxItems=${maxItems}&skipCount=${skipCount}&propertyFilter=-all-`,
      { criteria: [{ property: 'ccm:oeh_publisher_combined', values }] },
    );
  }
}

export interface WloNode {
  ref: { id: string };
  title?: string;
  name?: string;
  preview?: { url?: string };
  content?: { url?: string };
  properties?: Record<string, string[]>;
}
