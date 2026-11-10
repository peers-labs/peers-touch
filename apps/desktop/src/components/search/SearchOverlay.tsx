/**
 * SearchOverlay — Desktop production adapter for @peers-touch/ui-composite.
 *
 * This file OWNS:
 *   - Store subscription (useSearchStore) + searchPresentation derivation
 *   - ResultItem / SearchFunction → CompositeRow conversion (toCompositeRow)
 *   - SearchSurfaceModel + SearchSurfaceIntents construction
 *   - Legacy pt-search-* class injection via SurfaceHooks (CMP-D03)
 *   - Coverage popover content (infoPopoverSlot)
 *   - Focus restore on close (via useLayoutEffect + opener ref)
 *   - openRow / copyRow business logic (resolve → navigate → close)
 *
 * This file does NOT own:
 *   - Overlay/panel/input/row/groups DOM rendering — GlobalSearchSurface renders ptc-* tree
 *   - Keyboard navigation — GlobalSearchSurface handles ArrowUp/Down/Enter/Escape/IME
 *   - Focus management — GlobalSearchSurface handles input focus + roving row focus
 *   - Highlight mark rendering — GlobalSearchSurface renders <mark> against displayedQuery
 *
 * See docs/architecture/platform/client/ui-system/composite-promotion/P1-5-desktop-adapter.md
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Popover as PeersPopover } from '@peers-touch/ui';
import {
  ArrowUpRight, Copy, Hash, HelpCircle, Lock, MessageCircle, Newspaper, Search, Wrench, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSearchStore } from '../../store/search';
import { searchActions } from '../../runtimes/searchRuntime';
import { searchRowKey } from '../../services/search';
import type { Navigation } from '../../types/navigation';
import { SEARCH_FUNCTIONS, openSearchFunction, type SearchFunction } from './functions';
import { SearchResultMeta } from './SearchResultMeta';
import { SearchKind, SearchZone, type ResultItem } from '../../gen/proto/domain/search/search_pb';
import {
  authorizedRowCopyText, coverageStatus, deliveredCoverage,
  searchPresentation,
} from '../../runtimes/searchFrames';

// Composite package imports — thin adapter boundary (CMP-D01 / CMP-D06)
import { GlobalSearchSurface } from '@peers-touch/ui-composite';
import type {
  SearchSurfaceModel, SearchSurfaceIntents, SearchRegionKey,
  SurfaceHooks, SearchResultRow as CompositeRow,
} from '@peers-touch/ui-composite';

import './SearchOverlay.css';

const KIND_ICON: Record<string, LucideIcon> = {
  conversation: Hash,
  message: MessageCircle,
  content: Newspaper,
  function: Wrench,
};

// ── Helper: proto SearchKind → CompositeRow.kind ────────────────────────

function kindFromProto(kind: SearchKind): CompositeRow['kind'] {
  switch (kind) {
    case SearchKind.PERSON: return 'person';
    case SearchKind.CONVERSATION: return 'conversation';
    case SearchKind.MESSAGE: return 'message';
    case SearchKind.SOCIAL_POST:
    case SearchKind.SOCIAL_COMMENT: return 'content';
    default: return 'content';
  }
}

// ── Helper: proto SearchZone → zone label key ────────────────────────────

function zoneKeyFromProto(item: ResultItem): string {
  if (item.zone === SearchZone.STATION) return 'search.zone.station';
  if (item.zone === SearchZone.FEDERATION) return 'search.zone.federation';
  return 'search.zone.device';
}

// ── Host row shapes ──────────────────────────────────────────────────────

type HostRow =
  | { type: 'content'; item: ResultItem }
  | { type: 'function'; item: SearchFunction };

function rowKeyOf(row: HostRow): string {
  return row.type === 'function' ? `function:${row.item.id}` : searchRowKey(row.item.resource);
}

// ── Host row → composite row ────────────────────────────────────────────

function toCompositeRow(
  row: HostRow,
  t: (key: string, options?: Record<string, unknown>) => string,
): CompositeRow {
  if (row.type === 'function') {
    const Icon = Wrench;
    return {
      rowKey: rowKeyOf(row),
      kind: 'function',
      title: t(row.item.titleKey),
      snippet: t(row.item.detailKey),
      meta: undefined,
      icon: <Icon size={15} />,
    };
  }
  // content row
  const item = row.item;
  const kind = kindFromProto(item.kind);
  const Icon = KIND_ICON[kind] ?? MessageCircle;
  const title = item.title || t('search.kind.message');
  return {
    rowKey: rowKeyOf(row),
    kind,
    title,
    snippet: item.snippet,
    // SearchResultMeta is a rich host-owned component (needs social store subscriptions)
    meta: <SearchResultMeta item={item} />,
    zoneKey: zoneKeyFromProto(item),
    icon: <Icon size={15} />,
    resource: item.resource ? {
      id: item.resource.id,
      sourceId: item.sourceId,
      kind: item.resource.kind,
    } : undefined,
  };
}

// ── Component ────────────────────────────────────────────────────────────

export function SearchOverlay({ navigation }: { navigation: Navigation }) {
  const { t } = useTranslation('search');
  const opener = useRef(document.activeElement);
  const navigating = useRef(false);

  const view = useSearchStore(useShallow(state => ({
    query: state.query, mode: state.mode, status: state.status, response: state.response,
    displayedQuery: state.displayedQuery, displayedMode: state.displayedMode, stalled: state.stalled,
    errorKey: state.errorKey, opening: state.opening, selectedKey: state.selectedKey,
    contentFilter: state.contentFilter, displayedFilter: state.displayedFilter,
    progressive: state.progressive, progressiveRequestId: state.progressiveRequestId,
    progressiveSources: state.progressiveSources, scrollTop: state.scrollTop,
  })));

  // ── Presentation + host rows ──────────────────────────────────────────────

  const presentation = useMemo(() => searchPresentation({
    mode: view.mode, draft: view.query, displayedQuery: view.displayedQuery,
    contentFilter: view.contentFilter, displayedFilter: view.displayedFilter,
    status: view.status, errorKey: view.errorKey, response: view.response,
    progressive: view.progressive, progressiveRequestId: view.progressiveRequestId,
    progressiveSources: view.progressiveSources,
  }), [view.mode, view.query, view.displayedQuery, view.contentFilter, view.displayedFilter,
    view.status, view.errorKey, view.response, view.progressive,
    view.progressiveRequestId, view.progressiveSources]);

  // Host-side SEARCH_FUNCTIONS filter (before conversion)
  const functions = useMemo(() => {
    const query = view.query.normalize('NFKC').trim().toLowerCase();
    return SEARCH_FUNCTIONS.filter(item => !query
      || `${t(item.titleKey)} ${t(item.detailKey)} ${item.keywords}`.toLowerCase().includes(query));
  }, [view.query, t]);

  const hostRows: HostRow[] = useMemo(() => view.mode === 'functions'
    ? functions.map(item => ({ type: 'function' as const, item }))
    : (presentation.observation?.items ?? []).map(item => ({ type: 'content' as const, item })),
  [view.mode, functions, presentation]);

  // Flat composite rows (single group — Desktop does NOT multi-group results)
  const compositeRows = useMemo(() =>
    hostRows.map(row => toCompositeRow(row, t)),
  [hostRows, t]);

  // ── Open / copy handlers ─────────────────────────────────────────────────

  async function openRow(rowKey: string): Promise<void> {
    if (view.opening) return;
    useSearchStore.setState({ selectedKey: rowKey });
    const row = hostRows.find(r => rowKeyOf(r) === rowKey);
    if (!row) return;
    if (row.type === 'function') {
      navigating.current = true;
      searchActions.close();
      openSearchFunction(row.item, navigation);
      return;
    }
    navigating.current = true;
    if (!await searchActions.openResult(row.item, navigation)) navigating.current = false;
  }

  async function copyRow(rowKey: string): Promise<void> {
    const row = hostRows.find(r => rowKeyOf(r) === rowKey);
    if (row?.type !== 'content') return;
    const text = authorizedRowCopyText(row.item);
    if (!text || !navigator.clipboard) return;
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard denial is non-modal */ }
  }

  // ── Build composite SearchSurfaceModel ────────────────────────────────────

  const model: SearchSurfaceModel = useMemo(() => {
    const observation = presentation.observation;
    const claimedCoverage = deliveredCoverage(presentation, view.progressiveSources);
    const hasStation = (observation?.sources ?? []).some(source => source.sourceId === 'station.social.public');
    // Function-mode → single function-only group
    const groups = view.mode === 'functions' && compositeRows.length > 0
      ? [{ key: 'functions', labelKey: 'search.tab.functions', rows: compositeRows }]
      : (compositeRows.length > 0 ? [{ key: 'results', labelKey: presentation.groupTitle, rows: compositeRows }] : []);

    // quick functions shown on empty-Device suggestion surface
    const quickFunctions = presentation.showQuickFunctions
      ? SEARCH_FUNCTIONS.slice(0, 4).map(item => toCompositeRow({ type: 'function', item }, t))
      : undefined;

    return {
      query: view.query,
      displayedQuery: view.mode === 'functions' ? view.query : view.displayedQuery,
      status: view.status,
      isProgressive: presentation.isProgressive,
      groups,
      quickFunctions,
      recentItems: undefined, // Desktop prototype-parity does not render recent
      showEmpty: presentation.showEmpty,
      errorKey: view.errorKey,
      filters: [
        { id: 'all', labelKey: 'search.tab.all', active: view.mode !== 'functions' && view.contentFilter === 'all' },
        { id: 'messages', labelKey: 'search.tab.messages', active: view.mode !== 'functions' && view.contentFilter === 'messages' },
        { id: 'social', labelKey: 'search.tab.social', active: view.mode !== 'functions' && view.contentFilter === 'social' },
        { id: 'attachments', labelKey: 'search.tab.attachments', active: view.mode !== 'functions' && view.contentFilter === 'attachments' },
        { id: 'functions', labelKey: 'search.tab.functions', active: view.mode === 'functions' },
      ],
      pendingSources: presentation.pendingSources,
      coverage: [
        ...(hasStation ? [{ zoneKey: 'station', detailKey: 'search.zone.station', status: undefined }] : []),
        ...claimedCoverage.map(source => ({
          zoneKey: source.sourceId,
          detailKey: source.detailKey ?? 'search.zone.device',
          status: coverageStatus(source) ?? undefined,
        })),
      ],
      hasMore: view.displayedMode === 'submit' && view.mode !== 'functions' && !!view.response?.hasMore,
      opening: view.opening,
      groupTitleKey: presentation.groupTitle,
    };
  }, [presentation, view, compositeRows, t]);

  // ── Build composite SearchSurfaceIntents ──────────────────────────────────

  const intents: SearchSurfaceIntents = useMemo(() => ({
    onQueryChange(next, admissionSettled) {
      searchActions.query(next, admissionSettled ?? true);
    },
    onFilterChange(filterId) {
      if (filterId === 'functions') searchActions.mode('functions');
      else searchActions.filter(filterId as Parameters<typeof searchActions.filter>[0]);
    },
    onSubmit() { searchActions.submit(); },
    onRetry() { if (view.errorKey) searchActions.submit(true); },
    onMore() { searchActions.more(); },
    onOpenRow(rowKey) { void openRow(rowKey); },
    onCopyRow(rowKey) { void copyRow(rowKey); },
    onClose() { searchActions.close(); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [hostRows, view.opening, view.errorKey, navigation, view.mode]);

  // ── SurfaceHooks: inject legacy pt-search-* classes + data attrs ──────────

  const hooks: SurfaceHooks<SearchRegionKey> = useMemo(() => ({
    classNames: {
      overlay: 'pt-search-overlay',
      scrim: 'pt-search-scrim',
      panel: 'pt-search-panel',
      field: 'pt-search-field',
      input: 'pt-search-input',
      close: 'pt-search-close',
      intents: 'pt-search-intents',
      body: 'pt-search-body',
      group: 'pt-search-group',
      row: 'pt-search-row',
      rowTarget: 'pt-search-row-target',
      rowIcon: 'pt-search-row-icon',
      rowTitle: 'pt-search-title',
      rowSnippet: 'pt-search-snippet',
      rowZone: 'pt-search-zone',
      rowOpen: 'pt-search-row-open',
      copyButton: 'pt-search-copy',
      empty: 'pt-search-empty',
      error: 'pt-search-error',
      more: 'pt-search-more',
      footer: 'pt-search-footer',
      statusline: 'pt-search-statusline',
      statusChip: 'pt-search-status-chip',
      statusPending: 'pt-search-status-pending',
      footerActions: 'pt-search-footer-actions',
      infoButton: 'pt-search-info',
    },
    dataAttributes: {},
  }), []);

  // ── infoPopoverSlot: Desktop coverage popover + info button ───────────────

  const pending = presentation.pendingSources;
  const claimedCoverage = deliveredCoverage(presentation, view.progressiveSources);

  const popoverContent = (
    <div className="pt-search-popover">
      <h5 className="pt-search-popover-title">{t('search.popover.title')}</h5>
      <section>
        <h6>{t('search.popover.scopeTitle')}</h6>
        <p>{t('search.scope')}</p>
        <p>{t('search.boundary')}</p>
        <p>{t('search.popover.realtime')}</p>
        <p>{t('search.popover.privateCheck')}</p>
        <p>{t('search.coverage.historyBoundary')}</p>
      </section>
      <section>
        <h6>{t('search.popover.coverageTitle')}</h6>
        {claimedCoverage.length
          ? <ul>{claimedCoverage.map(source => <li key={source.sourceId}>{t(source.detailKey
            || 'search.coverage.device')}</li>)}</ul>
          : !presentation.isProgressive && <p>{t('search.coverage.device')}</p>}
        {pending.length > 0
          && <p className="pt-search-popover-pending">{t('search.coverage.pending')}</p>}
      </section>
      <section>
        <h6>{t('search.popover.keyboardTitle')}</h6>
        <p>{t('search.popover.keyboard')}</p>
        <p>{t('search.popover.copy')}</p>
      </section>
    </div>
  );

  const infoPopoverSlot = (
    <PeersPopover placement="bottom" label={t('search.moreInfo')} content={popoverContent}>
      <button type="button" className="pt-search-info" aria-label={t('search.moreInfo')}>
        <HelpCircle size={14} aria-hidden="true" />
      </button>
    </PeersPopover>
  );

  // ── Focus restore on unmount ────────────────────────────────────────────

  useLayoutEffect(() => {
    opener.current = document.activeElement;
    return () => {
      if (!navigating.current && opener.current instanceof HTMLElement && opener.current.isConnected) {
        opener.current.focus();
      }
    };
  }, []);

  return (
    <GlobalSearchSurface
      open
      model={model}
      intents={intents}
      t={t}
      hooks={hooks}
      infoPopoverSlot={infoPopoverSlot}
    />
  );
}

// Legacy copy helper — kept for potential future use by non-composite consumers
export { authorizedRowCopyText };

// Re-export the Lucide icons that were previously used inline
export { ArrowUpRight, Copy, Hash, HelpCircle, Lock, MessageCircle, Newspaper, Search, Wrench, X };
