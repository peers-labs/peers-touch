import { fromJson, type JsonValue } from '@bufbuild/protobuf';
import { listen } from '@tauri-apps/api/event';
import { MessagingProjectionInvalidationSchema } from '../gen/proto/domain/chat/event_pb';
import type { ResourceRef } from '../gen/proto/domain/search/search_pb';
import { messagingDomainRuntime, type MessagingRuntimeScope } from '../messaging/runtime';
import { searchService } from '../services/search';
import { emptySearchState, useSearchStore } from '../store/search';
import { useSessionStore } from '../store/session';
import type { RuntimeDescriptor } from '../kernel/runtime';
import { EVENT, eventBus } from '../kernel/events';
import type { Page } from '../types/navigation';
import { clearSearchQueries, reconcileSearchQuery, runSearchQuery, searchErrorKey, stopSearchQuery } from './searchQueries';

const RECONCILE_MS = 2_000;
let requestGeneration = 0;
let requestId: string | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let removeScope: (() => void) | null = null;
let removeSession: (() => void) | null = null;
let removeStation: (() => void) | null = null;
let removeEvent: (() => void) | null = null;
let installed = false;
let installationGeneration = 0;
let locale = 'en';
let activeScopeKey = '';

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
  activeScopeKey = '';
  useSearchStore.setState(emptySearchState());
}

function scopeChanged(scope: MessagingRuntimeScope | null): void {
  const next = scope ? JSON.stringify(scope) : '';
  if (next === activeScopeKey) return;
  reset();
  activeScopeKey = next;
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
    useSearchStore.setState({ open: false, opening: false });
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
  submit(refresh = false): void {
    stopRequest();
    useSearchStore.setState({ mode: 'submit' });
    void runSearchQuery(locale, refresh);
  },
  more(): void { void runSearchQuery(locale, false, true); },
  async resolve(resource: ResourceRef): Promise<ResourceRef | null> {
    stopRequest();
    const generation = requestGeneration;
    const scope = messagingDomainRuntime.captureScope();
    if (!scope) return null;
    const id = crypto.randomUUID();
    requestId = id;
    useSearchStore.setState({
      opening: true, errorKey: null,
      status: useSearchStore.getState().response ? 'ready' : 'idle',
    });
    try {
      const resolved = await searchService.resolve(resource, id);
      if (generation !== requestGeneration || !messagingDomainRuntime.isCurrent(scope)) return null;
      if (resolved.resolverBinding !== 'messaging.device.open' || !resolved.resource) throw new Error('unknown resolver');
      return resolved.resource;
    } catch (error) {
      if (generation === requestGeneration && messagingDomainRuntime.isCurrent(scope)) {
        useSearchStore.setState({ errorKey: searchErrorKey(error) });
      }
      return null;
    } finally {
      if (generation === requestGeneration) useSearchStore.setState({ opening: false });
      if (requestId === id) requestId = null;
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
    removeScope = messagingDomainRuntime.subscribeScope(scopeChanged);
    removeStation = eventBus.subscribe(EVENT.STATION_ACTIVE_CHANGED, payload => {
      if (payload.stationPeerId !== messagingDomainRuntime.captureScope()?.stationPeerId) reset();
    });
    removeSession = useSessionStore.subscribe((state, previous) => {
      if (state.sessionEpoch !== previous.sessionEpoch
        || state.currentUser?.actorPtid !== previous.currentUser?.actorPtid) reset();
    });
    void listen<JsonValue>('messaging:projection-changed', ({ payload }) => {
      try {
        const event = fromJson(MessagingProjectionInvalidationSchema, payload);
        if (!messagingDomainRuntime.matchesInvalidation(event)) return;
      } catch { return; }
      // Hide prior authorization immediately; owner reconciliation decides reuse.
      stopRequest();
      clearSearchQueries();
      useSearchStore.setState({ status: 'idle', opening: false });
      void reconcileSearchQuery(locale);
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
    removeScope?.(); removeScope = null;
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
    scopeChanged(messagingDomainRuntime.captureScope());
  },
  async reconcile(): Promise<void> {
    await reconcileSearchQuery(locale);
  },
};

function onFocus(): void {
  if (document.visibilityState !== 'hidden') void reconcileSearchQuery(locale);
}
