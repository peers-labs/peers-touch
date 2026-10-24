import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { MobileRuntimeDescriptor } from '../app/lifecycle/types';
import { activeMobileDetailRoute, useMobileNavigationStore, type MobileDetailRoute } from '../app/navigation';
import { isAccessGranted } from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import { isMobileAuthSessionValid, mobileAuthScopeKey } from '../features/auth/mobileAuthIdentity';
import {
  emptyMobileSearch, useMobileSearchStore, type MobileSearchFilter,
} from '../features/search/searchStore';
import { SearchKind, SourceState, type ResultItem, type SearchReadState, type SearchResponse } from '../gen/proto/domain/search/search_pb';
import { concealChangedMobileSearchSources, mobileSearchResponseCurrent, mobileSearchService } from '../services/search';
import { resolvedSearchDetailRoute } from '../features/search/openers';
import { subscribeSearchInvalidations } from './searchInvalidations';

let generation = 0;
let requestId: string | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let suspended = true;
let scopeKey = '';
let identityKey = '';
// A single presentation frame, never an independent content/query cache.
let retained: SearchResponse | null = null;
let retainedKey = '';
let stalledTimer: ReturnType<typeof setTimeout> | null = null;

function active(): boolean {
  return !suspended && document.visibilityState !== 'hidden'
    && activeMobileDetailRoute(useMobileNavigationStore.getState())?.routeId === 'detail:search';
}

function currentScope(): string {
  const auth = useAuthStore.getState();
  if (!isAccessGranted(auth.accessDecision) || !isMobileAuthSessionValid(auth.session)) return '';
  return JSON.stringify([mobileAuthScopeKey(auth.session), auth.session.sessionId]);
}

function currentIdentity(): string {
  const session = useAuthStore.getState().session;
  if (!session) return '';
  return JSON.stringify([session.stationPeerId, session.actorRef.ptid, session.deviceId, session.sessionId]);
}

function stop(): void {
  generation++;
  if (debounce) clearTimeout(debounce);
  debounce = null;
  if (stalledTimer) clearTimeout(stalledTimer);
  stalledTimer = null;
  useMobileSearchStore.setState({ stalled: false, opening: false });
  const id = requestId;
  requestId = null;
  if (id) void mobileSearchService.cancel(id).catch(() => undefined);
}

function conceal(): void {
  stop();
  const response = useMobileSearchStore.getState().response ?? retained;
  retained = response?.sources.some(source => source.noStore) ? null : response;
  useMobileSearchStore.setState({ response: null, status: 'concealed', opening: false });
}

export function fenceMobileSearch(): void {
  stop();
  retained = null;
  retainedKey = '';
  scopeKey = '';
  identityKey = '';
  useMobileSearchStore.setState(emptyMobileSearch());
}

function valid(response: SearchResponse, state: SearchReadState): boolean {
  return mobileSearchResponseCurrent(response, state);
}

function reusable(response: SearchResponse, state: SearchReadState): boolean {
  return valid(response, state) && !response.sources.some(source => source.noStore)
    && response.coverage.every(source => source.state === SourceState.READY);
}

function kinds(filter: MobileSearchFilter, conversationId: string): SearchKind[] {
  if (conversationId || filter === 'messages' || filter === 'attachments') return [SearchKind.MESSAGE];
  if (filter === 'social') return [SearchKind.SOCIAL_POST, SearchKind.SOCIAL_COMMENT];
  return [];
}

function errorKey(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  switch (code) {
    case 'SEARCH_INVALID_QUERY': return 'search.error.invalidQuery';
    case 'SEARCH_CURSOR_EXPIRED': return 'search.error.cursorExpired';
    case 'SEARCH_SOURCE_CHANGED': return 'search.error.sourceChanged';
    case 'SEARCH_RESOURCE_UNAVAILABLE': return 'search.error.resourceUnavailable';
    case 'SEARCH_SOURCE_TIMEOUT': return 'search.error.timeout';
    default: return 'search.error.unavailable';
  }
}

async function run(refresh = false): Promise<void> {
  stop();
  if (!active()) return;
  const view = useMobileSearchStore.getState();
  if (view.filter === 'functions') {
    useMobileSearchStore.setState({ status: 'ready', response: null, errorKey: null });
    return;
  }
  if (!view.query.trim()) {
    retained = null;
    useMobileSearchStore.setState({ status: 'idle', response: null, errorKey: null });
    return;
  }
  const scope = currentScope();
  const admitted = generation;
  const current = () => generation === admitted && active() && !!scope && currentScope() === scope;
  const id = crypto.randomUUID();
  requestId = id;
  useMobileSearchStore.setState({ status: 'loading', errorKey: null });
  stalledTimer = setTimeout(() => {
    if (current()) useMobileSearchStore.setState({ stalled: true });
  }, 200);
  try {
    if (!scope) throw new Error('missing native scope');
    const state = await mobileSearchService.readState();
    if (!current()) return;
    const key = JSON.stringify([view.query, view.mode, view.filter, view.conversationId, view.locale, view.page]);
    if (view.response) useMobileSearchStore.setState({
      response: concealChangedMobileSearchSources(view.response, state),
    });
    let response = !refresh && retained && retainedKey === key && reusable(retained, state) ? retained : null;
    if (!response) {
      response = view.mode === 'suggest'
        ? await mobileSearchService.suggest(
          view.query, id, kinds(view.filter, view.conversationId), view.conversationId, view.filter === 'attachments',
        )
        : await mobileSearchService.submit(
          view.query, id, view.locale, kinds(view.filter, view.conversationId), view.conversationId,
          view.cursors[view.page], refresh, view.filter === 'attachments',
        );
      if (!current()) return;
      const latest = await mobileSearchService.readState();
      if (!current()) return;
      if (!valid(response, latest)) throw { code: 'SEARCH_SOURCE_CHANGED' };
    }
    retained = response.sources.some(source => source.noStore) ? null : response;
    retainedKey = retained ? key : '';
    if (current()) useMobileSearchStore.setState({
      response, status: 'ready', errorKey: null, displayedQuery: view.query, displayedFilter: view.filter,
    });
  } catch (error) {
    if (current() || (generation === admitted && active() && !scope)) {
      retained = null;
      useMobileSearchStore.setState({ status: 'error', response: null, errorKey: errorKey(error) });
    }
  } finally {
    if (stalledTimer) clearTimeout(stalledTimer);
    stalledTimer = null;
    if (generation === admitted) useMobileSearchStore.setState({ stalled: false });
    if (requestId === id) requestId = null;
  }
}

async function revalidate(): Promise<void> {
  if (!active() || requestId || debounce) return;
  const view = useMobileSearchStore.getState();
  if (view.filter === 'functions' || !view.query.trim()) return;
  const admitted = generation;
  try {
    const state = await mobileSearchService.readState();
    if (admitted !== generation || !active()) return;
    if (view.response && reusable(view.response, state)) return;
    if (view.response) useMobileSearchStore.setState({
      response: concealChangedMobileSearchSources(view.response, state),
    });
    await run();
  } catch {
    if (admitted === generation && active()) {
      conceal();
      useMobileSearchStore.setState({ status: 'error', errorKey: 'search.error.unavailable' });
    }
  }
}

export const mobileSearchActions = {
  prepare(conversationId: string, locale: string): void {
    const view = useMobileSearchStore.getState();
    if (conversationId !== view.conversationId || locale !== view.locale) {
      retained = null;
      useMobileSearchStore.setState({
        ...emptyMobileSearch(), conversationId, locale,
      });
    }
  },
  query(query: string): void {
    stop();
    retained = null;
    useMobileSearchStore.setState({
      query, mode: 'suggest', errorKey: null, selectedId: '',
      scrollTop: 0, cursors: [''], page: 0, status: query.trim() ? 'loading' : 'idle',
    });
    debounce = setTimeout(() => { debounce = null; void run(); }, 120);
  },
  filter(filter: MobileSearchFilter): void {
    stop();
    retained = null;
    useMobileSearchStore.setState({
      filter, mode: 'submit', conversationId: filter === 'social' ? '' : useMobileSearchStore.getState().conversationId,
      cursors: [''], page: 0, scrollTop: 0, selectedId: '',
    });
    void run();
  },
  allConversations(): void {
    stop();
    retained = null;
    useMobileSearchStore.setState({ conversationId: '', response: null, cursors: [''], page: 0, scrollTop: 0 });
    void run();
  },
  submit(refresh = false): void {
    retained = null;
    useMobileSearchStore.setState({ mode: 'submit', cursors: [''], page: 0 });
    void run(refresh);
  },
  page(direction: -1 | 1): void {
    const view = useMobileSearchStore.getState();
    const cursor = view.response?.nextCursor;
    if (direction < 0 && view.page === 0 || direction > 0 && (!cursor || view.page >= 31)) return;
    retained = null;
    useMobileSearchStore.setState({
      page: view.page + direction, scrollTop: 0, selectedId: '',
      cursors: direction > 0 ? [...view.cursors.slice(0, view.page + 1), cursor!] : view.cursors,
    });
    void run();
  },
  async open(item: ResultItem, onOpenDetail: (route: MobileDetailRoute) => void): Promise<void> {
    if (!item.resource || !item.sourceId) return;
    stop();
    const admitted = generation;
    const scope = currentScope();
    const current = () => admitted === generation && active() && !!scope && currentScope() === scope;
    if (!current()) return;
    const id = crypto.randomUUID();
    requestId = id;
    useMobileSearchStore.setState({ opening: true, selectedId: item.resource.id, errorKey: null });
    try {
      const resolved = await mobileSearchService.resolve(item.resource, item.sourceId, id);
      if (!current()) return;
      const route = resolvedSearchDetailRoute(resolved);
      useMobileSearchStore.setState({ opening: false });
      onOpenDetail(route);
    } catch (error) {
      if (current()) useMobileSearchStore.setState({ errorKey: errorKey(error) });
    } finally {
      if (current()) useMobileSearchStore.setState({ opening: false });
      if (requestId === id) requestId = null;
    }
  },
};

export function createSearchRuntimeDescriptor(): MobileRuntimeDescriptor {
  const releases: Array<() => void> = [];
  let nativeRelease: UnlistenFn | null = null;
  let lifecycleRelease: UnlistenFn | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const scopeChanged = () => {
    const next = currentScope();
    const identity = currentIdentity();
    if (identity !== identityKey) {
      fenceMobileSearch();
      identityKey = identity;
    } else if (scopeKey !== next) {
      // Resume may advance the lifecycle generation of the same identity.
      // Preserve the user's presentation metadata while rejecting old content.
      retained = null;
      conceal();
    } else return;
    scopeKey = next;
    if (active()) void run();
  };
  const invalidated = (sourceIds: readonly string[]) => {
    stop();
    retained = null;
    const response = useMobileSearchStore.getState().response;
    if (response) useMobileSearchStore.setState({ response: {
      ...response, items: response.items.filter(item => !sourceIds.includes(item.sourceId)),
      nextCursor: '', hasMore: false,
    } });
    void run();
  };
  const visibility = () => {
    conceal();
    if (document.visibilityState !== 'hidden') void run();
  };
  return {
    id: 'search',
    title: 'Search',
    responsibility: 'Owns Search presentation, source validity and cancellation under the native Session.',
    dependsOn: [],
    async bootstrap() {
      suspended = false;
      scopeChanged();
      releases.push(useAuthStore.subscribe(scopeChanged));
      releases.push(useMobileNavigationStore.subscribe((state, previous) => {
        if (activeMobileDetailRoute(state)?.routeId === activeMobileDetailRoute(previous)?.routeId) return;
        conceal();
        if (active()) void run();
      }));
      nativeRelease = await subscribeSearchInvalidations(invalidated);
      lifecycleRelease = await listen<{ state: string }>('mobile:lifecycle', ({ payload }) => {
        if (payload.state === 'background') { suspended = true; conceal(); }
      });
      document.addEventListener('visibilitychange', visibility);
      timer = setInterval(() => { scopeChanged(); void revalidate(); }, 2_000);
    },
    async suspend() { suspended = true; conceal(); },
    async resume() { suspended = false; scopeChanged(); conceal(); await run(); },
    async teardown() {
      const start = performance.now();
      suspended = true;
      releases.splice(0).forEach(release => release());
      nativeRelease?.(); lifecycleRelease?.();
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      fenceMobileSearch();
      return { runtimeId: 'search', success: true, durationMs: performance.now() - start };
    },
  };
}
