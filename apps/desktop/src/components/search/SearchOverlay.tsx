/**
 * SearchOverlay — Desktop production adapter for @peers-touch/ui-composite.
 *
 * This file OWNS:
 *   - Store subscription (useSearchStore) + searchPresentation derivation
 *   - ResultItem / SearchFunction → CompositeRow conversion (toCompositeRow)
 *   - SearchSurfaceModel + SearchSurfaceIntents construction
 *   - Legacy pt-search-* class injection via SurfaceHooks (CMP-D03)
 *   - Authority explanation text (model.info)
 *   - Suppress opener restoration when navigation transfers focus
 *   - openRow / copyRow business logic (resolve → navigate → close)
 *
 * This file does NOT own:
 *   - Overlay/panel/input/row/groups/info DOM rendering — GlobalSearchSurface renders ptc-* tree
 *   - Keyboard navigation — GlobalSearchSurface handles ArrowUp/Down/Enter/Escape/IME
 *   - Focus management — GlobalSearchSurface handles input focus + roving row focus
 *   - Highlight mark rendering — GlobalSearchSurface renders <mark> against displayedQuery
 *
 * See docs/architecture/platform/client/ui-system/composite-promotion/integration.md
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
  Hash, MessageCircle, Newspaper, Wrench,
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
    copyable: !!authorizedRowCopyText(item),
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
  const navigating = useRef(false);

  const view = useSearchStore(useShallow(state => ({
    open: state.open,
    query: state.query, mode: state.mode, status: state.status, response: state.response,
    displayedQuery: state.displayedQuery, displayedMode: state.displayedMode, stalled: state.stalled,
    errorKey: state.errorKey, opening: state.opening, selectedKey: state.selectedKey,
    contentFilter: state.contentFilter, displayedFilter: state.displayedFilter,
    progressive: state.progressive, progressiveRequestId: state.progressiveRequestId,
    progressiveSources: state.progressiveSources, scrollTop: state.scrollTop,
  })));
  useLayoutEffect(() => { if (view.open) navigating.current = false; }, [view.open]);

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
  const quickRows = useMemo<HostRow[]>(() => presentation.showQuickFunctions
    ? SEARCH_FUNCTIONS.slice(0, 4).map(item => ({ type: 'function', item })) : [],
  [presentation.showQuickFunctions]);
  const actionableRows = useMemo(() => [...hostRows, ...quickRows], [hostRows, quickRows]);

  // ── Open / copy handlers ─────────────────────────────────────────────────

  async function openRow(rowKey: string): Promise<void> {
    if (view.opening) return;
    useSearchStore.setState({ selectedKey: rowKey });
    const row = actionableRows.find(r => rowKeyOf(r) === rowKey);
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
    const row = actionableRows.find(r => rowKeyOf(r) === rowKey);
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
    const quickFunctions = quickRows.map(row => toCompositeRow(row, t));

    return {
      query: view.query,
      displayedQuery: view.mode === 'functions' ? view.query : view.displayedQuery,
      draftMatches: view.mode === 'functions' || (view.query.trim() === view.displayedQuery
        && view.contentFilter === view.displayedFilter),
      functionsMode: view.mode === 'functions',
      loadingVisible: view.stalled,
      selectedKey: view.selectedKey,
      scrollTop: view.scrollTop,
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
      info: {
        title: t('search.popover.title'),
        sections: [
          { title: t('search.popover.scopeTitle'), paragraphs: [
            t('search.scope'), t('search.boundary'), t('search.popover.realtime'),
            t('search.popover.privateCheck'), t('search.coverage.historyBoundary'),
          ] },
          { title: t('search.popover.coverageTitle'),
            paragraphs: [
              ...(!claimedCoverage.length && !presentation.isProgressive ? [t('search.coverage.device')] : []),
              ...(presentation.pendingSources.length ? [t('search.coverage.pending')] : []),
            ],
            items: claimedCoverage.map(source => t(source.detailKey || 'search.coverage.device')),
          },
          { title: t('search.popover.keyboardTitle'),
            paragraphs: [t('search.popover.keyboard'), t('search.popover.copy')] },
        ],
      },
    };
  }, [presentation, view, compositeRows, quickRows, t]);

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
    onRefresh() { searchActions.submit(true); },
    onMore() { searchActions.more(); },
    onOpenRow(rowKey) { void openRow(rowKey); },
    onCopyRow(rowKey) { void copyRow(rowKey); },
    onClose() { searchActions.close(); },
    onSelectionChange(selectedKey) { useSearchStore.setState({ selectedKey }); },
    onScrollChange(scrollTop) { searchActions.scroll(scrollTop); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [actionableRows, view.opening, view.errorKey, navigation, view.mode]);

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
      statusline: 'pt-search-statusline pt-search-coverage',
      loading: 'pt-search-status',
      statusChip: 'pt-search-status-chip',
      statusPending: 'pt-search-status-pending',
      footerActions: 'pt-search-footer-actions',
      infoButton: 'pt-search-info',
    },
    dataAttributes: {},
  }), []);

  return (
    <GlobalSearchSurface
      open={view.open}
      model={model}
      intents={intents}
      t={t}
      hooks={hooks}
      shouldRestoreFocus={() => !navigating.current}
    />
  );
}
