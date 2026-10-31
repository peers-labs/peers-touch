// Pure Search frame logic: progressive merging, roving keyboard navigation,
// coverage status and authorized copy text. No React, no IPC, no content cache
// here — the runtime owns transport and the component owns rendering.
import {
  SourceState,
  type ResultItem,
  type SearchResponse,
  type SourceCoverage,
} from '../gen/proto/domain/search/search_pb';
import { resourceIdentity } from '../services/search';
import type { SearchContentFilter, SearchMode } from '../store/search';

// UI/core/Station share the 256 Unicode scalar input boundary.
export const MAX_QUERY_CHARS = 256;
// Non-empty input admits one FIND after this stable pause; IME composition and
// rapid typing restart the admission instead of firing partial queries.
export const STABLE_ADMISSION_MS = 200;

export function clampQuery(query: string): string {
  return Array.from(query).slice(0, MAX_QUERY_CHARS).join('');
}

/**
 * Merge one progressive source frame into the accumulated first-page
 * observation. Each source owns exactly one frame per request, so its items
 * replace that source's previous progressive items. Ordering follows the
 * source vector, never a renderer-side ranking. Progressive frames carry no
 * cursor and never become traversal, cache or selection state.
 */
export interface ProgressiveObservation {
  response: SearchResponse;
  deliveredSources: string[];
}

export function mergeProgressiveFrame(
  previous: SearchResponse | null,
  frame: SearchResponse,
  frameSourceId: string,
  previouslyDelivered: readonly string[],
): ProgressiveObservation {
  const deliveredSources = previouslyDelivered.includes(frameSourceId)
    ? [...previouslyDelivered]
    : [...previouslyDelivered, frameSourceId];
  const priorItems = (previous?.items ?? []).filter(item => item.sourceId !== frameSourceId);
  const mergedBySource = new Map<string, ResultItem[]>();
  for (const item of priorItems) {
    const list = mergedBySource.get(item.sourceId) ?? [];
    list.push(item);
    mergedBySource.set(item.sourceId, list);
  }
  mergedBySource.set(frameSourceId, frame.items);
  // Project in the native source-vector order so the renderer cannot invent a
  // ranking. Sources without items simply contribute nothing.
  const items = frame.sources.flatMap(source => mergedBySource.get(source.sourceId) ?? []);
  return {
    response: {
      ...frame,
      items,
      nextCursor: '',
      hasMore: false,
      expiresAtUnixMs: previous
        ? previous.expiresAtUnixMs < frame.expiresAtUnixMs
          ? previous.expiresAtUnixMs
          : frame.expiresAtUnixMs
        : frame.expiresAtUnixMs,
    },
    deliveredSources,
  };
}

/** Source observations still outstanding in a progressive response. */
export function pendingSources(
  response: SearchResponse,
  deliveredSources: readonly string[],
): string[] {
  return response.sources
    .map(source => source.sourceId)
    .filter(sourceId => !deliveredSources.includes(sourceId));
}

export type CoverageStatusKind = 'partial' | 'timeout' | 'denied' | 'preparing';

/** Compact, user-facing status for one source coverage line. */
export function coverageStatus(coverage: SourceCoverage): CoverageStatusKind | null {
  switch (coverage.state) {
    case SourceState.PARTIAL:
      return 'partial';
    case SourceState.INDEXING:
      return 'preparing';
    case SourceState.UNAVAILABLE:
      return coverage.detailKey.includes('timeout') ? 'timeout' : 'denied';
    default:
      return null;
  }
}

// ── Roving keyboard model ─────────────────────────────────────────────────

export type RowFocus = number | null;

/**
 * Move real DOM focus over result rows. `null` means the input owns focus;
 * ArrowUp on the first row returns focus to the input instead of clamping.
 */
export function nextRovingIndex(current: RowFocus, delta: 1 | -1, count: number): RowFocus {
  if (count <= 0) return null;
  if (current === null) return delta === 1 ? 0 : null;
  const next = current + delta;
  if (next < 0 || next >= count) return null;
  return next;
}

/** A printable character typed while a row owns focus returns to the input. */
export function isPrintableCharacterKey(key: string): boolean {
  return key.length === 1;
}

/**
 * Copyable text is only the title/snippet the current read authority issued
 * for this row. No preview cache, no resource fields, no fabricated fallback.
 */
export function authorizedRowCopyText(item: ResultItem): string {
  return [item.title, item.snippet].filter(Boolean).join('\n');
}

export function isSameProgressiveItem(a: ResultItem, b: ResultItem): boolean {
  return a.sourceId === b.sourceId && resourceIdentity(a.resource) === resourceIdentity(b.resource);
}

// ── Progressive presentation decision ────────────────────────────────────

export type SearchGroupTitle =
  | 'search.recent'
  | 'search.suggestions'
  | 'search.results'
  | 'search.tab.functions';

export interface PresentationInput {
  mode: SearchMode;
  draft: string;
  displayedQuery: string;
  contentFilter: SearchContentFilter;
  displayedFilter: SearchContentFilter;
  status: 'idle' | 'loading' | 'ready' | 'error';
  errorKey: string | null;
  response: SearchResponse | null;
  progressive: SearchResponse | null;
  progressiveRequestId: string | null;
  progressiveSources: string[];
}

export interface SearchPresentation {
  /** What the list currently renders: final frame, progressive observation or null. */
  observation: SearchResponse | null;
  /** A FIND whose fused final frame for this draft has not published yet. */
  isProgressive: boolean;
  /** Sources that have not delivered a progressive frame yet. */
  pendingSources: string[];
  /** The qualified final frame for the current draft owns the empty state. */
  showEmpty: boolean;
  /** Quick functions belong to the empty Device-suggestion surface only. */
  showQuickFunctions: boolean;
  groupTitle: SearchGroupTitle;
}

/**
 * Decide what the Search list shows without leaking transient progressive
 * state into terminal UI: a zero-hit partial frame is NOT an empty result
 * (sources are still pending), and a live FIND is never labelled
 * recent/suggestions nor shown alongside quick functions.
 */
export function searchPresentation(input: PresentationInput): SearchPresentation {
  if (input.mode === 'functions') {
    return {
      observation: null, isProgressive: false, pendingSources: [],
      showEmpty: false, showQuickFunctions: false, groupTitle: 'search.tab.functions',
    };
  }
  const draft = input.draft.trim();
  const finalMatches = !!input.response
    && input.displayedQuery === draft
    && input.displayedFilter === input.contentFilter;
  const isProgressive = input.mode === 'submit' && !finalMatches && !!input.progressiveRequestId;
  const observation = finalMatches || !input.progressiveRequestId ? input.response : input.progressive;
  const pending = isProgressive && observation
    ? pendingSources(observation, input.progressiveSources)
    : [];
  const showEmpty = finalMatches
    && input.status !== 'loading'
    && !input.errorKey
    && (observation?.items.length ?? 0) === 0;
  const showQuickFunctions = input.mode === 'suggest' && !draft;
  const groupTitle: SearchGroupTitle = input.mode === 'submit'
    ? 'search.results'
    : draft ? 'search.suggestions' : 'search.recent';
  return { observation, isProgressive, pendingSources: pending, showEmpty, showQuickFunctions, groupTitle };
}

/** Coverage lines a progressive Popover may claim: delivered sources only.
 * Undelivered sources are reported as pending, never as completed coverage. */
export function deliveredCoverage(
  presentation: SearchPresentation,
  deliveredSources: readonly string[],
): SourceCoverage[] {
  const coverage = presentation.observation?.coverage ?? [];
  if (!presentation.isProgressive) return coverage;
  const delivered = new Set(deliveredSources);
  return coverage.filter(source => delivered.has(source.sourceId));
}
