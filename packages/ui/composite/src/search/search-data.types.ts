/**
 * SearchSurface — serializable data core (the "fixture contract").
 *
 * This is the slice of SearchSurfaceModel that contains NO React nodes and
 * NO callbacks. It is plain, JSON-able data, which means it can be:
 *   - authored directly as prototype fixtures (mock),
 *   - produced by the Desktop adapter from real store state,
 *   - shared verbatim by composite behavior tests and host adapter tests.
 *
 * The host-only, non-serializable pieces (icon/meta ReactNodes, intent
 * callbacks) are deliberately excluded; the adapter attaches them when it
 * upgrades SearchSurfaceData into the full SearchSurfaceModel. Keeping the
 * core React-free is what lets one TypeScript type pin both mock and real
 * data, eliminating field-name / enum / shape drift at compile time.
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
