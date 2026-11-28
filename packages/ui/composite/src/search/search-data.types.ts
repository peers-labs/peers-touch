/**
 * SearchSurfaceData — the serializable subset of SearchSurfaceModel.
 *
 * These are the component's props with NO React nodes and NO callbacks: plain,
 * JSON-able data. Both hosts build this same shape, from different sources:
 *   - prototype: local mock constants,
 *   - Desktop: real response data.
 *
 * The container (host) keeps the non-serializable pieces — icon/meta React
 * nodes and the click callbacks — and attaches them when building the full
 * SearchSurfaceModel. Because this type holds no React, one TypeScript type
 * pins both mock and real data, so field-name / enum / shape drift fails at
 * compile time instead of surfacing at runtime.
 */
import type { SearchResultRow, SearchGroup, SearchSurfaceModel } from './search.types';

/** One result row as pure data. Where the full row carries a ReactNode icon,
 *  the core carries a stable iconId the host resolves to a node. */
export interface SearchResultRowData extends Omit<SearchResultRow, 'icon' | 'meta'> {
  /** Plain-text meta only; rich meta is composed by the host at assembly time. */
  metaText?: string;
  /** Host-resolved icon token; never a node, so it survives JSON serialization. */
  iconId?: string;
  /** Current native read authority's copy result, recorded for prototype replay. */
  copyText?: string;
}

export interface SearchGroupData extends Omit<SearchGroup, 'rows'> {
  rows: SearchResultRowData[];
}

export interface SearchSurfaceData extends Omit<SearchSurfaceModel, 'groups' | 'quickFunctions' | 'recentItems'> {
  groups: SearchGroupData[];
  quickFunctions?: SearchResultRowData[];
  recentItems?: SearchResultRowData[];
}

/** Recorded native presentation, replayed by the existing prototype entry. */
export interface SearchSurfaceCapture {
  model: SearchSurfaceData;
  labels: Record<string, string>;
  theme: Record<string, string>;
}
