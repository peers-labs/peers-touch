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
import type { SearchStatus } from './search.types';

/** One result row as pure data. Where the full row carries a ReactNode icon,
 *  the core carries a stable iconId the host resolves to a node. */
export interface SearchResultRowData {
  rowKey: string;
  kind: 'person' | 'conversation' | 'message' | 'moment' | 'function' | 'content';
  title: string;
  snippet?: string;
  /** Plain-text meta only; rich meta is composed by the host at assembly time. */
  metaText?: string;
  /** Host-resolved icon token; never a node, so it survives JSON serialization. */
  iconId?: string;
  zoneKey?: string;
  /** Serializable gate identity (the full row's `resource` object). */
  resource?: { id?: string; sourceId?: string; kind?: string };
}

export interface SearchGroupData {
  key: string;
  labelKey: string;
  rows: SearchResultRowData[];
}

export interface SearchSurfaceData {
  query: string;
  status: SearchStatus;
  isProgressive: boolean;
  groups: SearchGroupData[];
  quickFunctions?: SearchResultRowData[];
  recentItems?: SearchResultRowData[];
  showEmpty: boolean;
  emptyTitleKey?: string;
  errorKey?: string | null;
  filters: { id: string; labelKey: string; active: boolean }[];
  pendingSources: string[];
  coverage: { zoneKey: string; detailKey?: string; status?: string }[];
  hasMore: boolean;
  opening: boolean;
  groupTitleKey: string;
  displayedQuery?: string;
}
