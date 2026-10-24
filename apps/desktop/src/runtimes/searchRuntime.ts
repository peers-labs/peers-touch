import type { ResultItem } from '../gen/proto/domain/search/search_pb';
import { captureSearchIdentity, searchService } from '../services/search';
import { emptySearchState, useSearchStore, type SearchContentFilter } from '../store/search';
import { useSessionStore } from '../store/session';
import type { RuntimeDescriptor } from '../kernel/runtime';
import { EVENT, eventBus } from '../kernel/events';
import type { Navigation, Page } from '../types/navigation';
import { clearSearchQueries, invalidateSearchSources, reconcileSearchQuery, runSearchQuery, searchErrorKey, stopSearchQuery } from './searchQueries';
import { openSearchResource } from './searchOpeners';
import { subscribeSearchInvalidations } from './searchInvalidations';

const RECONCILE_MS = 2_000;
let requestGeneration = 0;
let requestId: string | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let removeSession: (() => void) | null = null;
let removeStation: (() => void) | null = null;
let removeEvent: (() => void) | null = null;
let installed = false;
let installationGeneration = 0;
let locale = 'en';

function stopRequest(): void {
  requestGeneration++;
  stopSearchQuery();
  if (debounce !== null) clearTimeout(debounce);
  debounce = null;
  const cancelled = requestId;
  requestId = null;
  if (cancelled) void searchService.cancel(cancelled).catch(() => {});
}

function reset(): void {
  stopRequest();
  clearSearchQueries();
  useSearchStore.setState(emptySearchState());
}

export const searchActions = {
  generation(): number { return requestGeneration; },
  open(originPage: Page, nextLocale: string): void {
    if (locale !== nextLocale) clearSearchQueries();
    locale = nextLocale;
    useSearchStore.setState({ open: true, originPage, opening: false, errorKey: null });
    void runSearchQuery(locale);
  },
  close(): void {
    stopRequest();
    const response = useSearchStore.getState().response;
    useSearchStore.setState({
      open: false, opening: false,
      ...(response?.sources.some(source => source.noStore) ? { response: null } : {}),
    });
  },
  query(query: string, ready = true): void {
    stopRequest();
    const mode = useSearchStore.getState().mode === 'functions' ? 'functions' : 'suggest';
    useSearchStore.setState({
      query, mode, status: mode !== 'functions' ? 'loading' : 'idle',
      errorKey: null,
    });
    if (ready && mode !== 'functions') debounce = setTimeout(() => { void runSearchQuery(locale); }, 120);
  },
  mode(mode: 'suggest' | 'functions'): void {
    stopRequest();
    clearSearchQueries();
    useSearchStore.setState({ mode, status: 'idle', errorKey: null, scrollTop: 0, cursorEngaged: false });
    void runSearchQuery(locale);
  },
  filter(contentFilter: SearchContentFilter): void {
    stopRequest();
    useSearchStore.setState({ contentFilter, mode: 'submit', status: 'idle', errorKey: null });
    void runSearchQuery(locale);
  },
  submit(refresh = false): void {
    stopRequest();
    useSearchStore.setState({ mode: 'submit' });
    void runSearchQuery(locale, refresh);
  },
  more(): void { void runSearchQuery(locale, false, true); },
  async openResult(item: ResultItem, navigation: Navigation): Promise<boolean> {
    if (!item.resource || !item.sourceId) return false;
    stopRequest();
    const generation = requestGeneration;
    const identity = captureSearchIdentity();
    if (!identity) return false;
    const id = crypto.randomUUID();
    requestId = id;
    useSearchStore.setState({
      opening: true, errorKey: null,
      status: useSearchStore.getState().response ? 'ready' : 'idle',
    });
    try {
      const current = () => generation === requestGeneration && captureSearchIdentity() === identity
        && useSearchStore.getState().open;
      const resolved = await searchService.resolve(item.resource, item.sourceId, id);
      if (!current()) return false;
      await openSearchResource(resolved, navigation, current);
      if (!current()) return false;
      useSearchStore.setState({ returnAvailable: true });
      searchActions.close();
      return true;
    } catch (error) {
      if (generation === requestGeneration && captureSearchIdentity() === identity) {
        useSearchStore.setState({ errorKey: searchErrorKey(error) });
      }
      return false;
    } finally {
      if (generation === requestGeneration) useSearchStore.setState({ opening: false });
      if (requestId === id) requestId = null;
      if (generation === requestGeneration && useSearchStore.getState().open) {
        void reconcileSearchQuery(locale);
      }
    }
  },
};

export const searchRuntime: RuntimeDescriptor = {
  id: 'search',
  scope: 'session',
  install(): void {
    if (installed) return;
    installed = true;
    const generation = ++installationGeneration;
    removeStation = eventBus.subscribe(EVENT.STATION_ACTIVE_CHANGED, reset);
    removeSession = useSessionStore.subscribe((state, previous) => {
      if (state.sessionEpoch !== previous.sessionEpoch
        || state.currentUser?.actorPtid !== previous.currentUser?.actorPtid) reset();
    });
    void subscribeSearchInvalidations(sourceIds => {
      // Hide prior authorization immediately; owner reconciliation decides reuse.
      // Original-domain materialization can publish a projection during Open.
      // Its read authority still decides availability; do not cancel that Open.
      const opening = useSearchStore.getState().opening;
      if (!opening) stopRequest();
      invalidateSearchSources(sourceIds);
      useSearchStore.setState({ status: 'idle' });
      if (!opening) void reconcileSearchQuery(locale);
    }).then(remove => {
      if (!installed || generation !== installationGeneration) remove();
      else removeEvent = remove;
    }).catch(() => {});
    timer = setInterval(() => { void reconcileSearchQuery(locale); }, RECONCILE_MS);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
  },
  teardown(): void {
    installed = false;
    installationGeneration++;
    removeSession?.(); removeSession = null;
    removeStation?.(); removeStation = null;
    removeEvent?.(); removeEvent = null;
    if (timer !== null) clearInterval(timer);
    timer = null;
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
    reset();
  },
  async bootstrap(): Promise<void> {
    reset();
  },
  async reconcile(): Promise<void> {
    await reconcileSearchQuery(locale);
  },
};

function onFocus(): void {
  if (document.visibilityState !== 'hidden') void reconcileSearchQuery(locale);
}
