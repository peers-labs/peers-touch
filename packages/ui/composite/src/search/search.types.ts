/**
 * Port contract for GlobalSearchSurface (composite package public surface).
 *
 * All data flows in through view-model props (SearchSurfaceModel), never via
 * store subscription or runtime hooks. All side-effects flow out through
 * SearchSurfaceIntents callbacks. The component owns ONLY UI-transient state:
 * roving cursor, IME composing phase, scrim closing phase.
 *
 * Design references:
 *   design.md CMP-D02 (pure display + UI transients)
 *   design.md CMP-D03 (SurfaceHooks for legacy DOM-契约保全)
 *   data-model.md §2 (port contract draft, verified against searchFrames.ts)
 */

import type { ReactNode } from 'react';
import type { CompositeTranslate } from '../i18n';
import type { SurfaceHooks } from '../hooks';

// ── View model (pure data, no runtime types, no callbacks) ────────────────

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

/** One row of the results list — pure view data, no resource identity parsing. */
export interface SearchResultRow {
  /** Stable row key across renders (host-owned: searchRowKey or person-xxx). */
  rowKey: string;
  kind: 'person' | 'conversation' | 'message' | 'moment' | 'function' | 'content';
  /** Plain text only; highlight is computed by the component against `query`. */
  title: string;
  snippet?: string;
  meta?: string;
  /** Optional resource identity gate hooks (passed through to data attributes). */
  resource?: { id?: string; sourceId?: string; kind?: string };
}

export interface SearchGroup {
  key: string;
  labelKey: string;
  rows: SearchResultRow[];
}

export interface SearchSurfaceModel {
  query: string;
  status: SearchStatus;
  /** True when the host has entered a progressive-wait period. */
  isProgressive: boolean;
  /** Empty query shows recents/quick; non-empty shows grouped results. */
  groups: SearchGroup[];
  quickFunctions?: SearchResultRow[];
  recentItems?: SearchResultRow[];
  showEmpty: boolean;
  emptyTitleKey?: string;
  errorKey?: string | null;
  /** Filter tabs; functions tab is represented as a filter here. */
  filters: { id: string; labelKey: string; active: boolean }[];
  /** Pending progressive sources (host-computed from progressiveSources). */
  pendingSources: string[];
  /** Coverage zone labels the footer and popover claim. */
  coverage: { zoneKey: string; detailKey?: string; status?: string }[];
  hasMore: boolean;
  opening: boolean;
  /** Group title key the host chose for this mode (e.g. search.results). */
  groupTitleKey: string;
  displayedQuery?: string;
}

// ── Intents (all side-effects flow out through these callbacks) ───────────

export interface SearchSurfaceIntents {
  onQueryChange(query: string, admissionSettled?: boolean): void;
  onFilterChange(filterId: string): void;
  onSubmit(): void;
  onRetry(): void;
  onMore(): void;
  onOpenRow(rowKey: string): void;
  onCopyRow?(rowKey: string): void;
  onClose(): void;
}

// ── Surface hooks region keys (see CMP-D03 / data-model.md §2.3) ──────────

export type SearchRegionKey =
  | 'overlay' | 'scrim' | 'panel' | 'field' | 'input' | 'close'
  | 'intents' | 'body' | 'group' | 'row' | 'rowTarget' | 'rowIcon'
  | 'rowTitle' | 'rowSnippet' | 'rowZone' | 'rowOpen' | 'copyButton'
  | 'empty' | 'error' | 'more' | 'footer' | 'statusline' | 'statusChip'
  | 'statusPending' | 'footerActions' | 'infoButton' | 'popoverSlot';

// ── Component props ────────────────────────────────────────────────────────

export interface GlobalSearchSurfaceProps {
  open: boolean;
  model: SearchSurfaceModel;
  intents: SearchSurfaceIntents;
  t: CompositeTranslate;
  /** Host-injected legacy class names and data hooks (see CMP-D03). */
  hooks?: SurfaceHooks<SearchRegionKey>;
  /** Host-rendered coverage popover content; composite does NOT render popover body. */
  infoPopoverSlot?: ReactNode;
}

export type { ReactNode };
