import { keepPreviousData, QueryClient, QueryObserver, type QueryObserverResult } from '@tanstack/query-core';
import { SearchErrorCode, SearchKind, SourceState, type SearchReadState, type SearchResponse } from '../gen/proto/domain/search/search_pb';
import { RustCommandException } from '../services/desktop_api';
import {
  captureSearchIdentity, concealChangedSearchSources, resourceIdentity, searchService,
  searchResponseCurrent, searchResponseDeadline, sourceStateIdentity,
} from '../services/search';
import { useSearchStore, type SearchContentFilter, type SearchMode } from '../store/search';

const MAX_FRAMES = 32;
const MAX_ITEMS = 640;
const MAX_VISIBLE_ITEMS = 200;
const STALLED_SEARCH_DELAY = 200;
type ContentMode = Exclude<SearchMode, 'functions'>;
interface Frame { query: string; mode: ContentMode; filter: SearchContentFilter; response: SearchResponse; }
const client = new QueryClient({ defaultOptions: { queries: {
  retry: false, gcTime: 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false,
  structuralSharing: false,
} } });
let observer: QueryObserver<Frame> | null = null;
let unsubscribe: (() => void) | null = null;
let active: object | null = null;
let ownerState: SearchReadState | null = null;
let stateFlight: Promise<SearchReadState> | null = null;
let epoch = 0;
let activeLocale = 'en';
let stalledTimer: ReturnType<typeof setTimeout> | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function deadline(response: SearchResponse): number {
  return searchResponseDeadline(response);
}

function valid(response: SearchResponse): boolean {
  return !!ownerState && searchResponseCurrent(response, ownerState);
}

function reusable(response: SearchResponse): boolean {
  return valid(response) && !response.sources.some(source => source.noStore)
    && response.coverage.every(source => source.state === SourceState.READY);
}

function kinds(filter: SearchContentFilter): SearchKind[] {
  switch (filter) {
    case 'messages': return [SearchKind.MESSAGE, SearchKind.CONVERSATION];
    case 'attachments': return [SearchKind.MESSAGE];
    case 'social': return [SearchKind.SOCIAL_POST, SearchKind.SOCIAL_COMMENT];
    default: return [];
  }
}

export function searchErrorKey(error: unknown): string {
  const code = error instanceof RustCommandException ? error.details?.search_error_code : undefined;
  switch (code) {
    case SearchErrorCode.CURSOR_EXPIRED: return 'search.error.cursorExpired';
    case SearchErrorCode.RESOURCE_UNAVAILABLE: return 'search.error.resourceUnavailable';
    case SearchErrorCode.SOURCE_CHANGED: return 'search.error.sourceChanged';
    case SearchErrorCode.SOURCE_TIMEOUT: return 'search.error.timeout';
    case SearchErrorCode.INVALID_QUERY: return 'search.error.invalidQuery';
    default: return 'search.error.unavailable';
  }
}

function hide(): void {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
  useSearchStore.setState({ response: null, displayedQuery: '', displayedMode: 'suggest' });
}

export function stopSearchQuery(): void {
  active = null;
  unsubscribe?.(); unsubscribe = null;
  client.removeQueries({ predicate: query => {
    const frame = query.state.data as Frame | undefined;
    return query.getObserversCount() === 0 && !!frame?.response.sources.some(source => source.noStore);
  } });
  if (stalledTimer !== null) clearTimeout(stalledTimer);
  stalledTimer = null;
  // Removing the last subscriber consumes Query's AbortSignal and cancels native IPC.
  useSearchStore.setState({ stalled: false });
}

export function clearSearchQueries(): void {
  epoch++;
  stopSearchQuery();
  observer?.destroy(); observer = null;
  client.clear();
  ownerState = null;
  stateFlight = null;
  hide();
}

export function invalidateSearchSources(sourceIds: readonly string[]): void {
  epoch++;
  stopSearchQuery();
  observer?.destroy(); observer = null;
  const affected = new Set(sourceIds);
  client.removeQueries({ predicate: query => {
    const frame = query.state.data as Frame | undefined;
    return !frame || frame.response.sources.some(source => affected.has(source.sourceId));
  } });
  ownerState = null;
  stateFlight = null;
  const response = useSearchStore.getState().response;
  if (response) useSearchStore.setState({ response: {
    ...response, items: response.items.filter(item => !affected.has(item.sourceId)),
    nextCursor: '', hasMore: false,
    coverage: response.coverage.map(source => affected.has(source.sourceId)
      ? { ...source, state: SourceState.PARTIAL, detailKey: 'search.coverage.partial' } : source),
  } });
}

async function readState(): Promise<SearchReadState> {
  if (stateFlight) return stateFlight;
  const capturedEpoch = epoch;
  const identity = captureSearchIdentity();
  if (!identity) throw new Error('search.error.unavailable');
  const promise = searchService.readState().then(state => {
    if (capturedEpoch !== epoch || captureSearchIdentity() !== identity) {
      throw new Error('search_scope_changed');
    }
    if (ownerState && sourceStateIdentity(ownerState) !== sourceStateIdentity(state)) {
      client.removeQueries({ predicate: query => query.getObserversCount() === 0 });
      const response = useSearchStore.getState().response;
      if (response) useSearchStore.setState({ response: concealChangedSearchSources(response, state) });
    }
    ownerState = state;
    return state;
  }).finally(() => {
    if (stateFlight === promise) stateFlight = null;
  });
  stateFlight = promise;
  return promise;
}

function budgetCache(): void {
  const queries = client.getQueryCache().findAll().sort((a, b) =>
    b.getObserversCount() - a.getObserversCount() || b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  let items = 0;
  let frames = 0;
  for (const query of queries) {
    const frame = query.state.data as Frame | undefined;
    if (!frame) continue;
    if (query.getObserversCount() === 0 && (
      !reusable(frame.response)
      || frames + 1 > MAX_FRAMES || items + frame.response.items.length > MAX_ITEMS
    )) client.getQueryCache().remove(query);
    else { items += frame.response.items.length; frames++; }
  }
}

function publish(frame: Frame): void {
  const previous = useSearchStore.getState();
  const changed = previous.displayedQuery !== frame.query || previous.displayedMode !== frame.mode
    || previous.displayedFilter !== frame.filter;
  useSearchStore.setState({
    response: frame.response, displayedQuery: frame.query, displayedMode: frame.mode,
    displayedFilter: frame.filter,
    ...(changed ? { selectedIndex: 0, cursorEngaged: false, scrollTop: 0 } : {}),
  });
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => {
    hide();
    if (useSearchStore.getState().open) void reconcileSearchQuery(activeLocale);
  }, Math.max(0, deadline(frame.response) - Date.now()));
}

export async function runSearchQuery(locale: string, refresh = false, more = false): Promise<void> {
  if (useSearchStore.getState().opening) return;
  stopSearchQuery();
  activeLocale = locale;
  const view = useSearchStore.getState();
  if (!view.open || view.mode === 'functions' || (!view.query.trim() && view.mode === 'submit')) return;
  const identity = captureSearchIdentity();
  const token = {};
  active = token;
  const current = () => active === token && !!identity && captureSearchIdentity() === identity
    && useSearchStore.getState().open && !useSearchStore.getState().opening;
  const query = view.query.trim();
  const mode = view.mode;
  const cursor = more ? view.response?.nextCursor ?? '' : '';
  if (more && (!cursor || view.displayedQuery !== query || view.displayedMode !== mode
    || view.displayedFilter !== view.contentFilter)) return;
  useSearchStore.setState({ status: 'loading', errorKey: null });
  stalledTimer = setTimeout(() => {
    if (current()) useSearchStore.setState({ stalled: true });
  }, STALLED_SEARCH_DELAY);
  try {
    await readState();
    if (!current()) return;
    if (view.response && !valid(view.response)) {
      useSearchStore.setState({ response: concealChangedSearchSources(view.response, ownerState!) });
    }
    const queryKey = [epoch, sourceStateIdentity(ownerState!), mode, view.contentFilter, query, locale, cursor];
    const baseKey = [...queryKey.slice(0, -1), ''];
    const cached = client.getQueryData<Frame>(queryKey);
    if (cached && !reusable(cached.response)) {
      client.removeQueries({ queryKey, exact: true });
    }
    const options = {
      queryKey, enabled: false,
      placeholderData: (previous: Frame | undefined) =>
        previous && reusable(previous.response) ? keepPreviousData(previous) : undefined,
      staleTime: (entry: { state: { data: unknown; dataUpdatedAt: number } }) => {
        const data = entry.state.data as Frame | undefined;
        return data && reusable(data.response)
          ? Math.max(0, deadline(data.response) - entry.state.dataUpdatedAt) : 0;
      },
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Frame> => {
        const id = crypto.randomUUID();
        const cancel = () => { void searchService.cancel(id).catch(() => {}); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          const response = mode === 'suggest'
            ? await searchService.suggest(query, id, kinds(view.contentFilter), view.contentFilter === 'attachments')
            : await searchService.submit(query, id, locale, cursor, refresh, kinds(view.contentFilter), view.contentFilter === 'attachments');
          await readState();
          if (signal.aborted || !current()) throw new Error('search_cancelled');
          if (!valid(response) || (more && view.response && !valid(view.response))) {
            throw new RustCommandException('search', {
              code: 'CONFLICT', message: 'source changed',
              details: { search_error_code: SearchErrorCode.SOURCE_CHANGED },
            });
          }
          if (!more || !view.response || response.sources.some(source => source.noStore)) {
            return { query, mode, filter: view.contentFilter, response };
          }
          const seen = new Set(view.response.items.map(item => resourceIdentity(item.resource)));
          const combined = {
            ...response,
            items: [...view.response.items, ...response.items.filter(item => !seen.has(resourceIdentity(item.resource)))]
              .slice(0, MAX_VISIBLE_ITEMS),
            expiresAtUnixMs: response.expiresAtUnixMs < view.response.expiresAtUnixMs
              ? response.expiresAtUnixMs : view.response.expiresAtUnixMs,
          };
          if (combined.items.length >= MAX_VISIBLE_ITEMS) combined.hasMore = false;
          return { query, mode, filter: view.contentFilter, response: combined };
        } finally {
          signal.removeEventListener('abort', cancel);
        }
      },
    };
    if (observer) observer.setOptions(options);
    else observer = new QueryObserver<Frame>(client, options);
    const project = (result: QueryObserverResult<Frame>) => {
      if (!current()) return;
      if (result.data && valid(result.data.response)) publish(result.data);
      if (!result.isFetching && !result.isPlaceholderData && result.status !== 'pending') {
        if (stalledTimer !== null) clearTimeout(stalledTimer);
        stalledTimer = null;
        useSearchStore.setState({
          status: result.isError ? 'error' : 'ready', stalled: false,
          errorKey: result.isError ? searchErrorKey(result.error) : null,
        });
        if (more && result.isSuccess && result.data && reusable(result.data.response)) client.setQueryData(baseKey, result.data);
        budgetCache();
      }
    };
    unsubscribe = observer.subscribe(project);
    // An explicit native read-state check always precedes Query cache admission.
    const saved = client.getQueryData<Frame>(queryKey);
    if (!refresh && saved && reusable(saved.response)) project(observer.getCurrentResult());
    else void observer.refetch();
  } catch (error) {
    if (!current()) return;
    hide();
    if (stalledTimer !== null) clearTimeout(stalledTimer);
    stalledTimer = null;
    useSearchStore.setState({ status: 'error', stalled: false, errorKey: searchErrorKey(error) });
  }
}

export async function reconcileSearchQuery(locale: string): Promise<void> {
  const view = useSearchStore.getState();
  if (!view.open || view.opening || view.mode === 'functions') return;
  const capturedEpoch = epoch;
  try {
    await readState();
    const latest = useSearchStore.getState();
    if (capturedEpoch !== epoch || !latest.open || latest.opening) return;
    if (latest.response && !valid(latest.response)) {
      useSearchStore.setState({ response: concealChangedSearchSources(latest.response, ownerState!) });
    }
    if (latest.status !== 'loading' && latest.status !== 'error'
      && (!latest.response || !reusable(latest.response))) await runSearchQuery(locale);
  } catch {
    if (capturedEpoch === epoch && !useSearchStore.getState().opening) {
      hide();
      useSearchStore.setState({ status: 'error', stalled: false, errorKey: 'search.error.unavailable' });
    }
  }
}
