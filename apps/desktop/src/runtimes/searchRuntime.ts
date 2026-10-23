import { fromJson, type JsonValue } from '@bufbuild/protobuf';
import { listen } from '@tauri-apps/api/event';
import { MessagingProjectionInvalidationSchema } from '../gen/proto/domain/chat/event_pb';
import {
  SearchErrorCode, SourceState, type ResourceRef, type SearchReadState, type SearchResponse,
} from '../gen/proto/domain/search/search_pb';
import { messagingDomainRuntime, type MessagingRuntimeScope } from '../messaging/runtime';
import { searchService } from '../services/search';
import { RustCommandException } from '../services/desktop_api';
import { emptySearchState, useSearchStore, type SearchMode } from '../store/search';
import { useSessionStore } from '../store/session';
import type { RuntimeDescriptor } from '../kernel/runtime';
import { EVENT, eventBus } from '../kernel/events';
import type { Page } from '../types/navigation';

const MAX_FRAMES = 32;
const MAX_ITEMS = 640;
const MAX_VISIBLE_ITEMS = 200;
const RECONCILE_MS = 2_000;
interface Frame { response: SearchResponse; }
const frames = new Map<string, Frame>();
let ownerState: SearchReadState | null = null;
let stateFlight: { epoch: number; promise: Promise<SearchReadState> } | null = null;
let epoch = 0;
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

function key(mode: SearchMode, query: string, cursor = ''): string {
  return JSON.stringify([mode, query.trim(), locale, cursor]);
}

function valid(response: SearchResponse, state: SearchReadState): boolean {
  const validity = response.readValidity;
  return response.sourceRevision === state.sourceRevision
    && !!validity && validity.readScope === state.readScope
    && Number(response.expiresAtUnixMs) > Date.now()
    && (!validity.leaseUntilUnixMs || Number(validity.leaseUntilUnixMs) > Date.now());
}

function remember(frameKey: string, response: SearchResponse): void {
  if (response.coverage.some(source => source.state !== SourceState.READY)) return;
  frames.delete(frameKey);
  frames.set(frameKey, { response });
  let size = Array.from(frames.values()).reduce((sum, frame) => sum + frame.response.items.length, 0);
  while (frames.size > MAX_FRAMES || size > MAX_ITEMS) {
    const oldest = frames.keys().next().value;
    if (oldest === undefined) break;
    size -= frames.get(oldest)!.response.items.length;
    frames.delete(oldest);
  }
}

function stopRequest(): void {
  requestGeneration++;
  if (debounce !== null) clearTimeout(debounce);
  debounce = null;
  const cancelled = requestId;
  requestId = null;
  if (cancelled) void searchService.cancel(cancelled).catch(() => {});
}

function reset(): void {
  epoch++;
  stopRequest();
  frames.clear();
  ownerState = null;
  stateFlight = null;
  activeScopeKey = '';
  useSearchStore.setState(emptySearchState());
}

async function readState(): Promise<SearchReadState> {
  if (stateFlight?.epoch === epoch) return stateFlight.promise;
  const capturedEpoch = epoch;
  const scope = messagingDomainRuntime.requireActiveScope();
  const promise = searchService.readState().then(state => {
    if (capturedEpoch !== epoch || !messagingDomainRuntime.isCurrent(scope)) {
      throw new Error('search_scope_changed');
    }
    if (ownerState && (
      ownerState.readScope !== state.readScope || ownerState.sourceRevision !== state.sourceRevision
    )) {
      frames.clear();
      useSearchStore.setState({ response: null });
    }
    ownerState = state;
    return state;
  }).finally(() => {
    if (stateFlight?.promise === promise) stateFlight = null;
  });
  stateFlight = { epoch: capturedEpoch, promise };
  return promise;
}

function errorKey(error: unknown): string {
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

async function run(refresh = false, more = false): Promise<void> {
  stopRequest();
  const view = useSearchStore.getState();
  if (!view.open || view.mode === 'functions' || (!view.query.trim() && view.mode === 'submit')) return;
  const scope = messagingDomainRuntime.captureScope();
  if (!scope) {
    useSearchStore.setState({ status: 'error', response: null, errorKey: 'search.error.unavailable' });
    return;
  }
  const generation = requestGeneration;
  const capturedEpoch = epoch;
  const current = () => capturedEpoch === epoch && generation === requestGeneration
    && messagingDomainRuntime.isCurrent(scope) && useSearchStore.getState().open;
  const cursor = more ? view.response?.nextCursor ?? '' : '';
  if (more && !cursor) return;
  const frameKey = key(view.mode, view.query, cursor);
  const id = crypto.randomUUID();
  requestId = id;
  useSearchStore.setState({ status: 'loading', errorKey: null, ...(!more ? { response: null } : {}) });
  try {
    const state = await readState();
    if (!current()) return;
    const saved = frames.get(frameKey)?.response;
    let response: SearchResponse;
    if (!refresh && saved && valid(saved, state)) {
      response = saved;
      frames.delete(frameKey);
      frames.set(frameKey, { response });
    } else {
      frames.delete(frameKey);
      response = view.mode === 'suggest'
        ? await searchService.suggest(view.query, id)
        : await searchService.submit(view.query, id, locale, cursor, refresh);
      if (!current()) return;
      const latest = await readState();
      if (!current()) return;
      if (!valid(response, latest)) {
        throw new RustCommandException('search', {
          code: 'CONFLICT', message: 'source changed',
          details: { search_error_code: SearchErrorCode.SOURCE_CHANGED },
        });
      }
      remember(frameKey, response);
    }
    if (more && view.response && !valid(view.response, ownerState ?? state)) {
      throw new RustCommandException('search', {
        code: 'CONFLICT', message: 'source changed',
        details: { search_error_code: SearchErrorCode.SOURCE_CHANGED },
      });
    }
    if (more && view.response) {
      const seen = new Set(view.response.items.map(item => JSON.stringify(item.resource)));
      response = {
        ...response,
        items: [...view.response.items, ...response.items.filter(item => !seen.has(JSON.stringify(item.resource)))]
          .slice(0, MAX_VISIBLE_ITEMS),
        expiresAtUnixMs: response.expiresAtUnixMs < view.response.expiresAtUnixMs
          ? response.expiresAtUnixMs : view.response.expiresAtUnixMs,
      };
      if (response.items.length >= MAX_VISIBLE_ITEMS) response.hasMore = false;
      remember(key(view.mode, view.query), response);
    }
    if (current()) useSearchStore.setState({ response, status: 'ready', errorKey: null });
  } catch (error) {
    if (current()) useSearchStore.setState({ response: null, status: 'error', errorKey: errorKey(error) });
  } finally {
    if (requestId === id) requestId = null;
  }
}

async function reconcile(): Promise<void> {
  const view = useSearchStore.getState();
  if (!view.open || view.opening || view.mode === 'functions') return;
  const capturedEpoch = epoch;
  try {
    const state = await readState();
    if (capturedEpoch !== epoch || !useSearchStore.getState().open) return;
    const current = useSearchStore.getState();
    if (current.status !== 'loading' && current.status !== 'error'
      && (!current.response || !valid(current.response, state))) await run();
  } catch {
    if (capturedEpoch === epoch) {
      useSearchStore.setState({ response: null, status: 'error', errorKey: 'search.error.unavailable' });
    }
  }
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
    if (locale !== nextLocale) frames.clear();
    locale = nextLocale;
    useSearchStore.setState({ open: true, originPage, opening: false, errorKey: null });
    void run();
  },
  close(): void {
    stopRequest();
    useSearchStore.setState({ open: false, opening: false });
  },
  query(query: string, ready = true): void {
    stopRequest();
    const mode = useSearchStore.getState().mode === 'functions' ? 'functions' : 'suggest';
    useSearchStore.setState({
      query, mode, response: null, status: query.trim() && mode !== 'functions' ? 'loading' : 'idle',
      selectedIndex: 0, cursorEngaged: false, scrollTop: 0, errorKey: null,
    });
    if (ready && mode !== 'functions') debounce = setTimeout(() => { void run(); }, 120);
  },
  mode(mode: 'suggest' | 'functions'): void {
    stopRequest();
    useSearchStore.setState({ mode, response: null, status: 'idle', errorKey: null, scrollTop: 0, cursorEngaged: false });
    void run();
  },
  submit(refresh = false): void {
    useSearchStore.setState({ mode: 'submit', cursorEngaged: false });
    void run(refresh);
  },
  more(): void { void run(false, true); },
  async resolve(resource: ResourceRef): Promise<ResourceRef | null> {
    stopRequest();
    const generation = requestGeneration;
    const scope = messagingDomainRuntime.captureScope();
    if (!scope) return null;
    const id = crypto.randomUUID();
    requestId = id;
    useSearchStore.setState({ opening: true, errorKey: null });
    try {
      const resolved = await searchService.resolve(resource, id);
      if (generation !== requestGeneration || !messagingDomainRuntime.isCurrent(scope)) return null;
      if (resolved.resolverBinding !== 'messaging.device.open' || !resolved.resource) throw new Error('unknown resolver');
      return resolved.resource;
    } catch (error) {
      if (generation === requestGeneration && messagingDomainRuntime.isCurrent(scope)) {
        useSearchStore.setState({ errorKey: errorKey(error) });
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
      epoch++;
      stopRequest();
      stateFlight = null;
      useSearchStore.setState({ response: null, status: 'idle', opening: false });
      void reconcile();
    }).then(remove => {
      if (!installed || generation !== installationGeneration) remove();
      else removeEvent = remove;
    }).catch(() => {});
    timer = setInterval(() => { void reconcile(); }, RECONCILE_MS);
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
    await reconcile();
  },
};

function onFocus(): void {
  if (document.visibilityState !== 'hidden') void reconcile();
}
