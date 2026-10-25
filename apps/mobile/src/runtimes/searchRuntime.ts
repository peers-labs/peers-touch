import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { MobileRuntimeDescriptor } from '../app/lifecycle/types';
import { activeMobileDetailRoute, useMobileNavigationStore } from '../app/navigation';
import { isAccessGranted } from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import { isMobileAuthSessionValid, mobileAuthScopeKey } from '../features/auth/mobileAuthIdentity';
import {
  emptyMobileSearch, useMobileSearchStore, type MobileSearchFilter,
} from '../features/search/searchStore';
import { SearchKind, type ResourceRef, type SearchReadState, type SearchResponse } from '../gen/proto/domain/search/search_pb';
import { mobileSearchService } from '../services/search';
import {
  currentMessagingProjectionScope, subscribeMessagingProjectionScope,
  MOBILE_MESSAGING_PROJECTION_CHANGED_EVENT, MOBILE_MESSAGING_RECONCILED_EVENT,
} from './messagingRuntime';

let generation = 0;
let requestId: string | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let suspended = true;
let scopeKey = '';
let identityKey = '';
// A single presentation frame, never an independent content/query cache.
let retained: SearchResponse | null = null;

function active(): boolean {
  return !suspended && document.visibilityState !== 'hidden'
    && activeMobileDetailRoute(useMobileNavigationStore.getState())?.routeId === 'detail:search';
}

function currentScope(): string {
  const auth = useAuthStore.getState();
  const scope = currentMessagingProjectionScope();
  if (!isAccessGranted(auth.accessDecision) || !isMobileAuthSessionValid(auth.session) || !scope
    || scope.actorPtid !== auth.session.actorRef.ptid
    || scope.stationPeerId !== auth.session.stationPeerId) return '';
  return JSON.stringify([mobileAuthScopeKey(auth.session), auth.session.sessionId, scope]);
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
  const id = requestId;
  requestId = null;
  if (id) void mobileSearchService.cancel(id).catch(() => undefined);
}

function conceal(): void {
  stop();
  retained = useMobileSearchStore.getState().response ?? retained;
  useMobileSearchStore.setState({ response: null, status: 'concealed', opening: false });
}

export function fenceMobileSearch(): void {
  stop();
  retained = null;
  scopeKey = '';
  identityKey = '';
  useMobileSearchStore.setState(emptyMobileSearch());
}

function valid(response: SearchResponse, state: SearchReadState): boolean {
  return response.sourceRevision === state.sourceRevision
    && response.readValidity?.readScope === state.readScope
    && Number(response.expiresAtUnixMs) > Date.now()
    && (!response.readValidity.leaseUntilUnixMs
      || Number(response.readValidity.leaseUntilUnixMs) > Date.now());
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
  useMobileSearchStore.setState({ status: 'loading', response: null, errorKey: null });
  try {
    if (!scope) throw new Error('missing native scope');
    const state = await mobileSearchService.readState();
    if (!current()) return;
    let response = !refresh && retained && valid(retained, state) ? retained : null;
    if (!response) {
      response = view.mode === 'suggest'
        ? await mobileSearchService.suggest(
          view.query, id, SearchKind.MESSAGE, view.conversationId, view.filter === 'attachments',
        )
        : await mobileSearchService.submit(
          view.query, id, view.locale, SearchKind.MESSAGE, view.conversationId,
          view.cursors[view.page], refresh, view.filter === 'attachments',
        );
      if (!current()) return;
      const latest = await mobileSearchService.readState();
      if (!current()) return;
      if (!valid(response, latest)) throw { code: 'SEARCH_SOURCE_CHANGED' };
    }
    retained = response;
    if (current()) useMobileSearchStore.setState({ response, status: 'ready', errorKey: null });
  } catch (error) {
    if (current() || (generation === admitted && active() && !scope)) {
      retained = null;
      useMobileSearchStore.setState({ status: 'error', response: null, errorKey: errorKey(error) });
    }
  } finally {
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
    if (view.response && valid(view.response, state)) return;
    conceal();
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
      query, mode: 'suggest', response: null, errorKey: null, selectedId: '',
      scrollTop: 0, cursors: [''], page: 0, status: query.trim() ? 'loading' : 'idle',
    });
    debounce = setTimeout(() => { debounce = null; void run(); }, 120);
  },
  filter(filter: MobileSearchFilter): void {
    stop();
    retained = null;
    useMobileSearchStore.setState({ filter, response: null, cursors: [''], page: 0, scrollTop: 0, selectedId: '' });
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
  async resolve(resource: ResourceRef): Promise<ResourceRef | null> {
    stop();
    const admitted = generation;
    const scope = currentScope();
    const current = () => admitted === generation && active() && !!scope && currentScope() === scope;
    if (!current()) return null;
    const id = crypto.randomUUID();
    requestId = id;
    useMobileSearchStore.setState({ opening: true, selectedId: resource.id, errorKey: null });
    try {
      const resolved = await mobileSearchService.resolve(resource, id);
      if (!current()) return null;
      if (resolved.resolverBinding !== 'messaging.device.open' || !resolved.resource) {
        throw { code: 'SEARCH_RESOURCE_UNAVAILABLE' };
      }
      return resolved.resource;
    } catch (error) {
      if (current()) useMobileSearchStore.setState({ errorKey: errorKey(error) });
      return null;
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
  const invalidated = () => { conceal(); void run(); };
  const visibility = () => {
    conceal();
    if (document.visibilityState !== 'hidden') void run();
  };
  return {
    id: 'search',
    title: 'Search',
    responsibility: 'Owns private Search presentation, original-owner revalidation and cancellation.',
    dependsOn: ['messaging'],
    async bootstrap() {
      suspended = false;
      scopeChanged();
      releases.push(subscribeMessagingProjectionScope(scopeChanged));
      releases.push(useAuthStore.subscribe(scopeChanged));
      releases.push(useMobileNavigationStore.subscribe((state, previous) => {
        if (activeMobileDetailRoute(state)?.routeId === activeMobileDetailRoute(previous)?.routeId) return;
        conceal();
        if (active()) void run();
      }));
      nativeRelease = await listen<{
        stationPeerId: string; actorPtid: string; activationGeneration: number;
      }>(MOBILE_MESSAGING_PROJECTION_CHANGED_EVENT, ({ payload }) => {
        const scope = currentMessagingProjectionScope();
        if (scope && scope.stationPeerId === payload.stationPeerId
          && scope.actorPtid === payload.actorPtid
          && scope.activationGeneration === payload.activationGeneration) invalidated();
      });
      lifecycleRelease = await listen<{ state: string }>('mobile:lifecycle', ({ payload }) => {
        if (payload.state === 'background') { suspended = true; conceal(); }
      });
      window.addEventListener(MOBILE_MESSAGING_RECONCILED_EVENT, invalidated);
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
      window.removeEventListener(MOBILE_MESSAGING_RECONCILED_EVENT, invalidated);
      document.removeEventListener('visibilitychange', visibility);
      fenceMobileSearch();
      return { runtimeId: 'search', success: true, durationMs: performance.now() - start };
    },
  };
}
