import { create } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResolvedResourceSchema, ResultItemSchema, SearchReadStateSchema, SearchResponseSchema,
  type ResolvedResource,
} from '../gen/proto/domain/search/search_pb';

async function fixture() {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('document', {
    visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
  });
  let invalidate!: (sources: readonly string[]) => void;
  let finish!: (value: ResolvedResource) => void;
  let reject!: (error: unknown) => void;
  const pending = new Promise<ResolvedResource>((resolve, fail) => {
    finish = resolve;
    reject = fail;
  });
  const service = {
    resolve: vi.fn(() => pending),
    cancel: vi.fn(async () => undefined),
    readState: vi.fn(async () => create(SearchReadStateSchema)),
    submit: vi.fn(async () => create(SearchResponseSchema)),
  };
  vi.doMock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
  vi.doMock('../app/navigation', () => ({
    activeMobileDetailRoute: () => ({ routeId: 'detail:search' }),
    useMobileNavigationStore: { getState: () => ({}), subscribe: () => () => {} },
  }));
  vi.doMock('../features/auth/authSession', () => ({ isAccessGranted: () => true }));
  vi.doMock('../features/auth/mobileAuthIdentity', () => ({
    isMobileAuthSessionValid: () => true, mobileAuthScopeKey: () => 'scope',
  }));
  vi.doMock('../features/auth/authStore', () => ({ useAuthStore: {
    getState: () => ({ accessDecision: {}, session: {
      sessionId: 'session', stationPeerId: 'station',
      actorRef: { ptid: 'actor' }, deviceId: 'device',
    } }),
    subscribe: () => () => {},
  } }));
  vi.doMock('../features/social/socialStore', () => ({
    useSocialStore: { getState: () => ({ messagingConversations: [], sessions: [] }) },
  }));
  vi.doMock('../services/search', async () => ({
    ...await vi.importActual('../services/search'), mobileSearchService: service,
  }));
  vi.doMock('./searchInvalidations', () => ({
    subscribeSearchInvalidations: async (changed: typeof invalidate) => {
      invalidate = changed;
      return () => {};
    },
  }));
  const { createSearchRuntimeDescriptor, mobileSearchActions } = await import('./searchRuntime');
  const { useMobileSearchStore } = await import('../features/search/searchStore');
  const runtime = createSearchRuntimeDescriptor();
  const context = {} as Parameters<typeof runtime.bootstrap>[0];
  await runtime.bootstrap(context);
  const privatePost = create(ResultItemSchema, {
    resource: { kind: 'social-post', id: 'post' }, sourceId: 'device.social',
  });
  const publicPost = create(ResultItemSchema, {
    resource: { kind: 'social-post', id: 'public-post' }, sourceId: 'station.social.public',
  });
  useMobileSearchStore.setState({
    query: 'post', mode: 'submit', status: 'ready',
    response: create(SearchResponseSchema, { items: [privatePost, publicPost] }),
  });
  return {
    actions: mobileSearchActions, store: useMobileSearchStore, service, privatePost,
    invalidate, finish, reject, cleanup: () => runtime.teardown({ reason: 'app-unmount' }),
    resolved: create(ResolvedResourceSchema, {
      resource: privatePost.resource, resolverBinding: 'social.device.open',
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('@tauri-apps/api/event');
  vi.doUnmock('../app/navigation');
  vi.doUnmock('../features/auth/authSession');
  vi.doUnmock('../features/auth/mobileAuthIdentity');
  vi.doUnmock('../features/auth/authStore');
  vi.doUnmock('../features/social/socialStore');
  vi.doUnmock('../services/search');
  vi.doUnmock('./searchInvalidations');
});

describe('Mobile Search original Open lifetime', () => {
  it.each(['device.social', 'station.social.public'])('hides %s without cancelling a pending original Open', async (sourceId) => {
    const f = await fixture();
    const navigate = vi.fn();
    const open = f.actions.open(f.privatePost, navigate);
    f.invalidate([sourceId]);
    expect(f.store.getState().response?.items.map(item => item.sourceId))
      .toEqual([sourceId === 'device.social' ? 'station.social.public' : 'device.social']);
    expect(f.store.getState().opening).toBe(true);
    expect(f.service.cancel).not.toHaveBeenCalled();
    expect(f.service.submit).not.toHaveBeenCalled();
    f.finish(f.resolved);
    await open;
    expect(navigate).toHaveBeenCalledWith({
      routeId: 'detail:moment', postId: 'post', readSource: 'device',
    });
    await f.cleanup();
  });

  it('keeps original-owner denial authoritative after source invalidation', async () => {
    const f = await fixture();
    const navigate = vi.fn();
    const open = f.actions.open(f.privatePost, navigate);
    f.invalidate(['device.social']);
    f.reject({ code: 'SEARCH_RESOURCE_UNAVAILABLE' });
    await open;
    expect(navigate).not.toHaveBeenCalled();
    expect(f.store.getState().errorKey).toBe('search.error.resourceUnavailable');
    expect(f.store.getState().opening).toBe(false);
    await f.cleanup();
  });

  it('still cancels a superseded user intent', async () => {
    const f = await fixture();
    const navigate = vi.fn();
    const open = f.actions.open(f.privatePost, navigate);
    f.actions.query('new query');
    f.finish(f.resolved);
    await open;
    expect(f.service.cancel).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(f.store.getState().opening).toBe(false);
    await f.cleanup();
  });

  it('still cancels at the identity fence', async () => {
    const f = await fixture();
    const navigate = vi.fn();
    const open = f.actions.open(f.privatePost, navigate);
    const { fenceMobileSearch } = await import('./searchRuntime');
    fenceMobileSearch();
    f.finish(f.resolved);
    await open;
    expect(f.service.cancel).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(f.store.getState().response).toBeNull();
    await f.cleanup();
  });

  it('finishes a Messaging continuation across an unrelated Social invalidation', async () => {
    const f = await fixture();
    const source = {
      sourceId: 'device.messaging', bindingId: 'messaging.read',
      readScope: 'device', sourceRevision: '1', policyRevision: '1',
    };
    const response = create(SearchResponseSchema, {
      partition: 'partition', sources: [source],
      expiresAtUnixMs: BigInt(Date.now() + 60_000), nextCursor: 'next', hasMore: true,
      items: [{
        sourceId: source.sourceId, resource: { kind: 'message', id: 'message' },
        readValidity: { readScope: source.readScope, policyRevision: source.policyRevision },
      }],
    });
    f.service.readState.mockResolvedValue(create(SearchReadStateSchema, {
      partition: response.partition, sources: response.sources,
    }));
    let finishPage!: (value: typeof response) => void;
    f.service.submit.mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve; }));
    f.store.setState({
      query: 'message', displayedQuery: 'message', mode: 'submit', displayedMode: 'submit',
      filter: 'messages', displayedFilter: 'messages', response,
    });
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.service.submit).toHaveBeenCalledOnce();
    f.invalidate(['device.social']);
    expect(f.service.cancel).not.toHaveBeenCalled();
    expect(f.store.getState().response?.nextCursor).toBe('next');
    expect(f.store.getState().status).toBe('loading');
    const finalPage = create(SearchResponseSchema, { ...response, nextCursor: '', hasMore: false });
    finishPage(finalPage);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.store.getState().response).toEqual(finalPage);
    expect(f.store.getState().status).toBe('ready');
    expect(f.service.submit).toHaveBeenCalledOnce();
    await f.cleanup();
  });
});
