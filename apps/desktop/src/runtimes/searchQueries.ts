import { keepPreviousData, QueryClient, QueryObserver, type QueryObserverResult } from '@tanstack/query-core';
import { SearchErrorCode, SearchKind, SourceState, type SearchReadState, type SearchResponse } from '../gen/proto/domain/search/search_pb';
import { RustCommandException } from '../services/desktop_api';
import {
  captureSearchIdentity, concealChangedSearchSources, resourceIdentity, searchService,
  searchResponseCurrent, searchResponseDeadline, sourceStateIdentity,
} from '../services/search';
import { useSearchStore, type SearchContentFilter, type SearchMode, type SearchTraversal } from '../store/search';

const MAX_FRAMES = 32;
const MAX_ITEMS = 640;
const MAX_VISIBLE_ITEMS = 200;
const MAX_TRAVERSAL_PAGES = 32;
const TRAVERSAL_DEADLINE_MS = 5_000;
const STALLED_SEARCH_DELAY = 200;
type ContentMode = Exclude<SearchMode, 'functions'>;
interface Frame {
  query: string; mode: ContentMode; filter: SearchContentFilter;
  response: SearchResponse; traversal: SearchTraversal;
}
const client = new QueryClient({ defaultOptions: { queries: {
  retry: false, gcTime: 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false,
  structuralSharing: false,
} } });
let observer: QueryObserver<Frame> | null = null;
let unsubscribe: (() => void) | null = null;
let active: { cancel: () => void } | null = null;
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
  active?.cancel();
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
  useSearchStore.setState({ traversal: null });
  hide();
}

function rowKey(item: SearchResponse['items'][number]): string {
  return JSON.stringify([resourceIdentity(item.resource), item.resource?.anchor]);
}

function presentationPosition(keys: string[], previousKeys: string[]) {
  const view = useSearchStore.getState();
  const stable = keys.length >= previousKeys.length
    && previousKeys.every((key, index) => key === keys[index]);
  const selectedKey = previousKeys[view.selectedIndex];
  const selectedIndex = selectedKey ? keys.indexOf(selectedKey) : -1;
  return {
    selectedIndex: Math.max(0, selectedIndex),
    cursorEngaged: view.cursorEngaged && selectedIndex >= 0,
    scrollTop: stable ? view.scrollTop : 0,
  };
}

function conceal(response: SearchResponse | null): void {
  const view = useSearchStore.getState();
  const keys = response?.items.map(rowKey) ?? [];
  const previousKeys = view.response?.items.map(rowKey) ?? view.traversal?.rowKeys ?? [];
  useSearchStore.setState({
    response, ...presentationPosition(keys, previousKeys),
    traversal: view.traversal ? { ...view.traversal, rowKeys: keys } : null,
  });
}

export function invalidateSearchSources(sourceIds: readonly string[]): boolean {
  const affected = new Set(sourceIds);
  const view = useSearchStore.getState();
  const response = view.response;
  // A pending new intent has no qualified source vector yet. Keep that case
  // conservative; a continuation retains its current response's dependencies.
  const queryAffected = !response?.sources.length
    || view.displayedQuery !== view.query.trim() || view.displayedMode !== view.mode
    || view.displayedFilter !== view.contentFilter
    || response.sources.some(source => affected.has(source.sourceId));
  client.removeQueries({ predicate: query => {
    const frame = query.state.data as Frame | undefined;
    return frame ? frame.response.sources.some(source => affected.has(source.sourceId)) : queryAffected;
  } });
  if (!queryAffected) return false;
  epoch++;
  stopSearchQuery();
  observer?.destroy(); observer = null;
  ownerState = null;
  stateFlight = null;
  if (response) conceal({
    ...response, items: response.items.filter(item => !affected.has(item.sourceId)),
    nextCursor: '', hasMore: false,
    coverage: response.coverage.map(source => affected.has(source.sourceId)
      ? { ...source, state: SourceState.PARTIAL, detailKey: 'search.coverage.partial' } : source),
  });
  return true;
}

async function readState(): Promise<SearchReadState> {
  if (stateFlight) return stateFlight;
  const capturedEpoch = epoch;
  const identity = captureSearchIdentity();
  if (!identity) throw new Error('search.error.unavailable');
  let timer!: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new RustCommandException('search', {
      code: 'CONFLICT', message: 'search read-state timeout',
      details: { search_error_code: SearchErrorCode.SOURCE_TIMEOUT },
    })), TRAVERSAL_DEADLINE_MS);
  });
  const promise = Promise.race([searchService.readState(), expired]).then(state => {
    if (capturedEpoch !== epoch || captureSearchIdentity() !== identity) {
      throw new Error('search_scope_changed');
    }
    if (ownerState && sourceStateIdentity(ownerState) !== sourceStateIdentity(state)) {
      client.removeQueries({ predicate: query => query.getObserversCount() === 0 });
      const response = useSearchStore.getState().response;
      if (response) conceal(concealChangedSearchSources(response, state));
    }
    ownerState = state;
    return state;
  }).finally(() => {
    clearTimeout(timer);
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
  const context = previous.traversal;
  const changed = !context || context.identity !== frame.traversal.identity
    || context.query !== frame.query || context.mode !== frame.mode
    || context.filter !== frame.filter || context.locale !== frame.traversal.locale;
  useSearchStore.setState({
    response: frame.response, displayedQuery: frame.query, displayedMode: frame.mode,
    displayedFilter: frame.filter, traversal: frame.traversal,
    ...(changed ? { selectedIndex: 0, cursorEngaged: false, scrollTop: 0 }
      : presentationPosition(frame.traversal.rowKeys, context.rowKeys)),
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
  const query = view.query.trim();
  const mode = view.mode;
  const context = view.traversal;
  const sameTraversal = !!context && context.identity === identity && context.query === query
    && context.mode === mode && context.filter === view.contentFilter && context.locale === locale;
  const freshTraversal = !more && sameTraversal && context.noStore && mode === 'submit';
  const ordinal = more ? (sameTraversal ? context.ordinal : 0) + 1
    : freshTraversal ? context.ordinal : 0;
  const cursor = more ? view.response?.nextCursor ?? '' : '';
  if (more && (!cursor || view.displayedQuery !== query || view.displayedMode !== mode
    || view.displayedFilter !== view.contentFilter)) return;
  if (ordinal >= MAX_TRAVERSAL_PAGES) {
    useSearchStore.setState({ status: 'error', errorKey: 'search.error.cursorExpired' });
    return;
  }
  let id: string | null = null;
  let timedOut = false;
  const until = Date.now() + TRAVERSAL_DEADLINE_MS;
  const cancelNative = () => { if (id) void searchService.cancel(id).catch(() => {}); };
  let rejectDeadline!: (error: unknown) => void;
  const expired = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  void expired.catch(() => {});
  const timeout = setTimeout(() => {
    timedOut = true;
    cancelNative();
    rejectDeadline(new RustCommandException('search', {
      code: 'CONFLICT', message: 'search traversal timeout',
      details: { search_error_code: SearchErrorCode.SOURCE_TIMEOUT },
    }));
  }, TRAVERSAL_DEADLINE_MS);
  const token = { cancel: () => {
    clearTimeout(timeout);
    cancelNative();
    rejectDeadline(new Error('search_cancelled'));
  } };
  active = token;
  const current = () => active === token && !!identity && captureSearchIdentity() === identity
    && useSearchStore.getState().open && !useSearchStore.getState().opening;
  useSearchStore.setState({ status: 'loading', errorKey: null });
  stalledTimer = setTimeout(() => {
    if (current()) useSearchStore.setState({ stalled: true });
  }, STALLED_SEARCH_DELAY);
  try {
    await Promise.race([readState(), expired]);
    if (!current()) return;
    if (view.response && !valid(view.response)) {
      conceal(concealChangedSearchSources(view.response, ownerState!));
    }
    const queryKey = [epoch, sourceStateIdentity(ownerState!), mode, view.contentFilter, query, locale,
      freshTraversal ? `fresh:${ordinal}` : cursor];
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
        signal.addEventListener('abort', cancelNative, { once: true });
        const failure = (code: SearchErrorCode): never => {
          throw new RustCommandException('search', {
            code: 'CONFLICT', message: 'search traversal failed', details: { search_error_code: code },
          });
        };
        const read = async (nextCursor: string, force: boolean): Promise<SearchResponse> => {
          if (timedOut || Date.now() >= until) failure(SearchErrorCode.SOURCE_TIMEOUT);
          if (signal.aborted || !current()) throw new Error('search_cancelled');
          id = crypto.randomUUID();
          const response = await Promise.race([expired, mode === 'suggest'
            ? searchService.suggest(query, id, kinds(view.contentFilter), view.contentFilter === 'attachments')
            : searchService.submit(query, id, locale, nextCursor, force, kinds(view.contentFilter), view.contentFilter === 'attachments')]);
          await Promise.race([readState(), expired]);
          if (signal.aborted || !current()) throw new Error('search_cancelled');
          if (timedOut || Date.now() >= until) failure(SearchErrorCode.SOURCE_TIMEOUT);
          if (!valid(response)) failure(SearchErrorCode.SOURCE_CHANGED);
          return response;
        };
        try {
          let response = await read(cursor, refresh || freshTraversal);
          // Only freshly issued continuations are consumed; intermediate no-store
          // pages never enter Query storage or the visible projection.
          for (let page = 0; freshTraversal && page < ordinal; page++) {
            if (!response.hasMore || !response.nextCursor) failure(SearchErrorCode.SOURCE_CHANGED);
            response = await read(response.nextCursor, false);
          }
          if (more && view.response && !valid(view.response)) failure(SearchErrorCode.SOURCE_CHANGED);
          const frame = (value: SearchResponse): Frame => ({
            query, mode, filter: view.contentFilter, response: value,
            traversal: {
              identity, query, mode, filter: view.contentFilter, locale, ordinal,
              noStore: value.sources.some(source => source.noStore), rowKeys: value.items.map(rowKey),
            },
          });
          if (ordinal + 1 >= MAX_TRAVERSAL_PAGES) response = { ...response, hasMore: false, nextCursor: '' };
          if (!more || !view.response || response.sources.some(source => source.noStore)) {
            return frame(response);
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
          return frame(combined);
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener('abort', cancelNative);
        }
      },
    };
    if (observer) observer.setOptions(options);
    else observer = new QueryObserver<Frame>(client, options);
    const project = (result: QueryObserverResult<Frame>) => {
      if (!current()) return;
      if (result.data && valid(result.data.response)) publish(result.data);
      if (!current()) return;
      if (!result.isFetching && !result.isPlaceholderData && result.status !== 'pending') {
        clearTimeout(timeout);
        if (stalledTimer !== null) clearTimeout(stalledTimer);
        stalledTimer = null;
        useSearchStore.setState({
          status: result.isError ? 'error' : 'ready', stalled: false,
          errorKey: result.isError ? searchErrorKey(result.error) : null,
        });
        if (!current()) return;
        if (result.isError && freshTraversal) conceal(null);
        if (more && result.isSuccess && result.data && reusable(result.data.response)) client.setQueryData(baseKey, result.data);
        if (result.isSuccess && result.data?.traversal.noStore) {
          unsubscribe?.(); unsubscribe = null;
          observer?.destroy(); observer = null;
          client.removeQueries({ queryKey, exact: true });
        }
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
    clearTimeout(timeout);
    hide();
    if (stalledTimer !== null) clearTimeout(stalledTimer);
    stalledTimer = null;
    useSearchStore.setState({ status: 'error', stalled: false, errorKey: searchErrorKey(error) });
  }
}

export async function reconcileSearchQuery(locale: string): Promise<void> {
  const view = useSearchStore.getState();
  if (!view.open || view.opening || view.mode === 'functions') return;
  if (view.status !== 'loading' && view.status !== 'error'
    && (!view.response || view.response.sources.some(source => source.noStore))) {
    await runSearchQuery(locale);
    return;
  }
  const capturedEpoch = epoch;
  try {
    await readState();
    const latest = useSearchStore.getState();
    if (capturedEpoch !== epoch || !latest.open || latest.opening) return;
    if (latest.response && !valid(latest.response)) {
      conceal(concealChangedSearchSources(latest.response, ownerState!));
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
