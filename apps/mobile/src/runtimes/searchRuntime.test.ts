import { create } from '@bufbuild/protobuf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CancelResponseSchema, ResolvedResourceSchema, ResultItemSchema, SearchKind, SearchReadStateSchema, SearchResponseSchema, SourceState,
  type ResolvedResource, type SearchResponse,
} from '../gen/proto/domain/search/search_pb';

function deferred<T>() {
  let finish!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, fail) => { finish = resolve; reject = fail; });
  return { promise, finish, reject };
}

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
    cancel: vi.fn<typeof import('../services/search').mobileSearchService.cancel>(
      async () => create(CancelResponseSchema),
    ),
    readState: vi.fn(async () => create(SearchReadStateSchema)),
    submit: vi.fn<typeof import('../services/search').mobileSearchService.submit>(
      async () => create(SearchResponseSchema),
    ),
    suggest: vi.fn<typeof import('../services/search').mobileSearchService.suggest>(
      async () => create(SearchResponseSchema),
    ),
  };
  let navigation = { routeId: 'detail:search' };
  let navigationChanged!: (state: typeof navigation, previous: typeof navigation) => void;
  vi.doMock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
  vi.doMock('../app/navigation', () => ({
    activeMobileDetailRoute: (state: typeof navigation) => state,
    useMobileNavigationStore: {
      getState: () => navigation,
      subscribe: (changed: typeof navigationChanged) => {
        navigationChanged = changed;
        return () => {};
      },
    },
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
    runtime, runtimeContext: context, invalidate, finish, reject,
    navigate(routeId: string) {
      const previous = navigation;
      navigation = { routeId };
      navigationChanged(navigation, previous);
    },
    cleanup: () => runtime.teardown({ reason: 'app-unmount' }),
    resolved: create(ResolvedResourceSchema, {
      resource: privatePost.resource, resolverBinding: 'social.device.open',
    }),
  };
}

async function paginatedFixture(filter: 'all' | 'social' | 'messages' = 'social', pageCount = 3) {
  const f = await fixture();
  const source = {
    sourceId: filter === 'messages' ? 'device.messaging' : 'device.social',
    bindingId: 'original.read', readScope: 'device', sourceRevision: '1', policyRevision: '1',
    noStore: filter !== 'messages', state: SourceState.READY,
  };
  const responseAt = (traversal: number, page: number) => create(SearchResponseSchema, {
    partition: 'partition', sources: [source],
    expiresAtUnixMs: BigInt(Date.now() + 60_000),
    coverage: [{ sourceId: source.sourceId, state: SourceState.READY }],
    items: [{
      sourceId: source.sourceId, resource: { kind: 'social-post', id: `page-${page}` },
      snippet: `original-owner traversal ${traversal} page ${page}`,
      readValidity: { readScope: source.readScope, policyRevision: source.policyRevision },
    }],
    nextCursor: page + 1 < pageCount ? `traversal-${traversal}-page-${page + 1}` : '',
    hasMore: page + 1 < pageCount,
  });
  f.service.readState.mockResolvedValue(create(SearchReadStateSchema, {
    partition: 'partition', sources: [source],
  }));
  let traversal = 0;
  const issued = new Map<string, { traversal: number; page: number }>();
  f.service.submit.mockImplementation(async (_query, _id, _locale, _kinds, _conversation, cursor = '') => {
    const position = cursor ? issued.get(cursor) : { traversal: ++traversal, page: 0 };
    if (!position) throw { code: 'SEARCH_CURSOR_EXPIRED' };
    if (cursor) issued.delete(cursor);
    const response = responseAt(position.traversal, position.page);
    if (response.nextCursor) issued.set(response.nextCursor, {
      traversal: position.traversal, page: position.page + 1,
    });
    return response;
  });
  f.store.setState({ query: 'post', filter, response: null });
  f.actions.submit();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.store.getState().status).toBe('ready');
  return { ...f, responseAt, setPageCount: (count: number) => { pageCount = count; } };
}

async function traversalBudgetFixture(filter: 'all' | 'social') {
  const f = await paginatedFixture(filter, 32);
  for (let page = 1; page < 32; page++) {
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
  }
  f.store.setState({ selectedId: 'page-31', scrollTop: 480, locale: 'zh-CN' });
  f.navigate('detail:moment');
  const context = {
    query: 'post', mode: 'submit', filter, page: 31,
    selectedId: 'page-31', scrollTop: 480, locale: 'zh-CN', conversationId: '',
    cursors: [...f.store.getState().cursors],
  };
  const read = f.service.submit.getMockImplementation()!;
  const replies: Array<ReturnType<typeof deferred<SearchResponse>> & { response: SearchResponse }> = [];
  f.service.submit.mockImplementation(async (...args) => {
    const response = await read(...args);
    const reply = deferred<SearchResponse>();
    replies.push({ ...reply, response });
    return reply.promise;
  });
  f.service.submit.mockClear();
  f.service.readState.mockClear();
  f.service.cancel.mockClear();
  const published: SearchResponse[] = [];
  const release = f.store.subscribe((state, previous) => {
    if (state.response && state.response !== previous.response) published.push(state.response);
  });
  return { ...f, context, replies, published, release };
}

async function periodicBudgetFixture(filter: 'all' | 'social') {
  const f = await paginatedFixture(filter);
  f.actions.page(1);
  await vi.advanceTimersByTimeAsync(0);
  f.store.setState({ selectedId: 'page-1', scrollTop: 240, locale: 'zh-CN' });
  const context = {
    query: 'post', mode: 'submit', filter, page: 1, conversationId: '', locale: 'zh-CN',
    selectedId: 'page-1', scrollTop: 240, cursors: [...f.store.getState().cursors],
    displayedQuery: 'post', displayedMode: 'submit', displayedFilter: filter,
  };
  expect(f.store.getState()).toMatchObject({ ...context, status: 'ready' });
  expect(f.store.getState().response?.sources[0].noStore).toBe(true);
  const state = create(SearchReadStateSchema, {
    partition: 'partition', sources: f.responseAt(1, 1).sources,
  });
  const firstState = deferred<typeof state>();
  f.service.readState.mockClear().mockImplementationOnce(() => firstState.promise);
  const read = f.service.submit.getMockImplementation()!;
  const replies: Array<ReturnType<typeof deferred<SearchResponse>> & { response: SearchResponse }> = [];
  f.service.submit.mockClear().mockImplementation(async (...args) => {
    const response = await read(...args);
    const reply = deferred<SearchResponse>();
    replies.push({ ...reply, response });
    return reply.promise;
  });
  f.service.cancel.mockClear();
  f.service.suggest.mockClear();
  const admissions = vi.spyOn(crypto, 'randomUUID');
  const published: SearchResponse[] = [];
  const release = f.store.subscribe((next, previous) => {
    if (next.response && next.response !== previous.response) published.push(next.response);
  });
  const started = Date.now();
  return {
    ...f, context, state, firstState, replies, admissions, published, started,
    async cleanup() {
      release();
      admissions.mockRestore();
      await f.cleanup();
      firstState.finish(state);
      replies.forEach(reply => reply.finish(reply.response));
      await vi.advanceTimersByTimeAsync(0);
    },
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

describe('Mobile Search single-use traversal lifetime', () => {
  it.each(['all', 'social'] as const)('reauthorizes %s at the displayed ordinal on every periodic tick', async (filter) => {
    const f = await paginatedFixture(filter);
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    f.store.setState({ selectedId: 'page-1', scrollTop: 240 });
    expect(f.store.getState().response?.items[0].snippet).toContain('traversal 1 page 1');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.store.getState()).toMatchObject({
      query: 'post', mode: 'submit', filter, page: 1, selectedId: 'page-1', scrollTop: 240,
      status: 'ready', errorKey: null, cursors: ['', 'traversal-2-page-1'],
    });
    expect(f.store.getState().response?.items[0].snippet).toContain('traversal 2 page 1');
    expect(f.service.submit.mock.calls.map(call => [call[5], call[6]])).toEqual([
      ['', false], ['traversal-1-page-1', false], ['', true], ['traversal-2-page-1', false],
    ]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.store.getState().response?.items[0].snippet).toContain('traversal 3 page 1');
    expect(f.service.submit).toHaveBeenCalledTimes(6);
    await f.cleanup();
  });

  it.each(['back', 'resume'] as const)('retains metadata without private rows during %s, then reacquires page two', async (transition) => {
    const f = await paginatedFixture();
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    f.store.setState({ selectedId: 'page-2', scrollTop: 480 });
    if (transition === 'back') f.navigate('detail:moment');
    else await f.runtime.suspend();
    expect(f.store.getState()).toMatchObject({
      response: null, status: 'concealed', page: 2, selectedId: 'page-2', scrollTop: 480,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.service.submit).toHaveBeenCalledTimes(3);
    if (transition === 'back') f.navigate('detail:search');
    else await f.runtime.resume(f.runtimeContext);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.store.getState()).toMatchObject({
      query: 'post', filter: 'social', page: 2, selectedId: 'page-2', scrollTop: 480, status: 'ready',
      cursors: ['', 'traversal-2-page-1', 'traversal-2-page-2'],
    });
    expect(f.store.getState().response?.items[0].snippet).toContain('traversal 2 page 2');
    expect(f.service.submit).toHaveBeenCalledTimes(6);
    await f.cleanup();
  });

  it('reconstructs Previous and advances only the newly issued Next', async () => {
    const f = await paginatedFixture();
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    f.actions.page(-1);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.store.getState().response?.items[0].snippet).toContain('traversal 2 page 1');
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.service.submit.mock.calls.map(call => call[5])).toEqual([
      '', 'traversal-1-page-1', 'traversal-1-page-2', '', 'traversal-2-page-1', 'traversal-2-page-2',
    ]);
    expect(f.store.getState().page).toBe(2);
    await f.cleanup();
  });

  it('does not publish intermediate pages or reset the ordinal when the new traversal is shorter', async () => {
    const f = await paginatedFixture();
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    f.store.setState({ selectedId: 'page-2', scrollTop: 480 });
    f.setPageCount(1);
    const published: string[] = [];
    const release = f.store.subscribe((state, previous) => {
      if (state.status === 'ready' && state.response && state.response !== previous.response) {
        published.push(state.response.items[0].resource!.id);
      }
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.store.getState()).toMatchObject({
      page: 2, selectedId: 'page-2', scrollTop: 480, response: null,
      status: 'error', errorKey: 'search.error.sourceChanged',
    });
    expect(published).toEqual([]);
    f.setPageCount(3);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.store.getState().response?.items[0].snippet).toContain('traversal 3 page 2');
    release();
    await f.cleanup();
  });

  it('validates original-owner state before consuming each reconstructed page', async () => {
    const f = await paginatedFixture();
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    f.navigate('detail:moment');
    f.service.readState.mockResolvedValue(create(SearchReadStateSchema, {
      partition: 'partition', sources: [{
        ...f.responseAt(1, 0).sources[0], policyRevision: 'revoked', state: SourceState.UNAVAILABLE,
      }],
    }));
    f.navigate('detail:search');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.store.getState()).toMatchObject({
      response: null, page: 1, status: 'error', errorKey: 'search.error.sourceChanged',
    });
    expect(f.service.submit).toHaveBeenCalledTimes(3);
    await f.cleanup();
  });

  it('keeps healthy local frames reusable but never replays consumed Previous cursors', async () => {
    const f = await paginatedFixture('messages');
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.service.submit).toHaveBeenCalledTimes(2);
    f.navigate('detail:chat');
    f.navigate('detail:search');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.service.submit).toHaveBeenCalledTimes(2);
    f.actions.page(-1);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.store.getState().response?.items[0].snippet).toContain('traversal 2 page 0');
    await f.cleanup();
  });

  it('bounds a fresh traversal to the existing 32 page slots', async () => {
    const f = await paginatedFixture('social', 33);
    for (let page = 1; page < 32; page++) {
      f.actions.page(1);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(f.store.getState().page).toBe(31);
    expect(f.service.submit).toHaveBeenCalledTimes(32);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.store.getState().page).toBe(31);
    expect(f.store.getState().cursors).toHaveLength(32);
    expect(f.service.submit).toHaveBeenCalledTimes(64);
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.service.submit).toHaveBeenCalledTimes(64);
    await f.cleanup();
  });

  it.each(['identity', 'query'] as const)('fences a pending reconstruction at a new %s without publishing it', async (fence) => {
    const f = await paginatedFixture();
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    let finish!: (response: SearchResponse) => void;
    f.service.submit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.service.submit).toHaveBeenCalledTimes(3);
    if (fence === 'identity') {
      const { fenceMobileSearch } = await import('./searchRuntime');
      fenceMobileSearch();
    } else f.actions.query('new intent');
    finish(f.responseAt(2, 0));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.service.submit).toHaveBeenCalledTimes(3);
    expect(f.service.cancel).toHaveBeenCalledOnce();
    expect(f.store.getState().response?.items[0].snippet ?? '').not.toContain('traversal 2');
    if (fence === 'identity') expect(f.store.getState()).toMatchObject({
      query: '', response: null, page: 0, cursors: [''],
    });
    else expect(f.store.getState()).toMatchObject({ query: 'new intent', page: 0 });
    await f.cleanup();
  });

  it('does not retry an expired forward cursor as a first page', async () => {
    const f = await paginatedFixture();
    f.service.submit.mockRejectedValueOnce({ code: 'SEARCH_CURSOR_EXPIRED' });
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.service.submit).toHaveBeenCalledTimes(2);
    expect(f.service.submit.mock.calls[1][5]).toBe('traversal-1-page-1');
    expect(f.store.getState()).toMatchObject({
      page: 1, query: 'post', response: null, status: 'error', errorKey: 'search.error.cursorExpired',
    });
    await f.cleanup();
  });

  it('admits only one Next while its continuation is pending', async () => {
    const f = await paginatedFixture();
    let finish!: (response: SearchResponse) => void;
    f.service.submit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.actions.page(1);
    f.actions.page(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.service.submit).toHaveBeenCalledTimes(2);
    expect(f.store.getState().page).toBe(1);
    finish(f.responseAt(1, 1));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.store.getState()).toMatchObject({ page: 1, status: 'ready' });
    await f.cleanup();
  });
});

describe('Mobile Search aggregate query budget', () => {
  it.each(['all', 'social'] as const)('stops a 32-slot %s reconstruction at the original 5s deadline', async (filter) => {
    const f = await traversalBudgetFixture(filter);
    const started = Date.now();
    f.navigate('detail:search');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.replies).toHaveLength(1);
    expect(f.service.submit.mock.calls[0]).toEqual([
      'post', expect.any(String), 'zh-CN',
      filter === 'social' ? [SearchKind.SOCIAL_POST, SearchKind.SOCIAL_COMMENT] : [],
      '', '', true, false,
    ]);
    const id = f.service.submit.mock.calls[0][1];
    await vi.advanceTimersByTimeAsync(2_600);
    f.replies[0].finish(f.replies[0].response);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.replies).toHaveLength(2);
    expect(f.service.submit.mock.calls[1]).toEqual([
      'post', id, 'zh-CN',
      filter === 'social' ? [SearchKind.SOCIAL_POST, SearchKind.SOCIAL_COMMENT] : [],
      '', 'traversal-2-page-1', false, false,
    ]);
    expect(f.store.getState()).toMatchObject({ ...f.context, status: 'loading', response: null });
    expect(f.published).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_399);
    expect(Date.now() - started).toBe(4_999);
    expect(f.service.cancel).not.toHaveBeenCalled();
    expect(f.store.getState().status).toBe('loading');
    await vi.advanceTimersByTimeAsync(1);
    expect(f.service.cancel).toHaveBeenCalledExactlyOnceWith(id);
    expect(f.store.getState()).toMatchObject({
      ...f.context, status: 'error', errorKey: 'search.error.timeout', stalled: false, response: null,
    });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    f.replies[1].finish(f.replies[1].response);
    await vi.advanceTimersByTimeAsync(0);
    expect(Date.now() - started).toBe(5_200);
    expect(f.service.submit).toHaveBeenCalledTimes(2);
    expect(f.service.readState).toHaveBeenCalledTimes(2);
    expect(f.published).toEqual([]);
    expect(f.store.getState()).toMatchObject({
      ...f.context, status: 'error', errorKey: 'search.error.timeout', response: null,
    });
    f.release();
    await f.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('publishes only the addressed page when all 32 deferred replies complete inside 5s', async () => {
    const f = await traversalBudgetFixture('social');
    const started = Date.now();
    f.navigate('detail:search');
    await vi.advanceTimersByTimeAsync(0);
    for (let page = 0; page < 32; page++) {
      expect(f.replies).toHaveLength(page + 1);
      expect(f.published).toEqual([]);
      await vi.advanceTimersByTimeAsync(150);
      f.replies[page].finish(f.replies[page].response);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(Date.now() - started).toBe(4_800);
    expect(f.service.submit).toHaveBeenCalledTimes(32);
    expect(new Set(f.service.submit.mock.calls.map(call => call[1])).size).toBe(1);
    expect(f.store.getState()).toMatchObject({
      ...f.context, cursors: ['', ...Array.from({ length: 31 }, (_, page) => `traversal-2-page-${page + 1}`)],
      status: 'ready', errorKey: null, stalled: false,
    });
    expect(f.published).toEqual([f.replies[31].response]);
    expect(f.store.getState().response?.items[0].resource?.id).toBe('page-31');
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(201);
    expect(f.service.cancel).not.toHaveBeenCalled();
    expect(f.store.getState().status).toBe('ready');
    f.release();
    await f.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['first read state', 'submit', 'submit read state', 'suggest', 'suggest read state'] as const)(
    'finishes at 5s even when cancelled %s never settles, and fences its late reply',
    async (phase) => {
      const f = await paginatedFixture();
      const response = f.responseAt(2, 0);
      const readState = create(SearchReadStateSchema, {
        partition: response.partition, sources: response.sources,
      });
      const stateReply = deferred<typeof readState>();
      const queryReply = deferred<SearchResponse>();
      const suggestion = phase.startsWith('suggest');
      f.store.setState({ mode: suggestion ? 'suggest' : 'submit', response: null });
      f.service.submit.mockClear();
      f.service.suggest.mockResolvedValue(response);
      f.service.readState.mockClear();
      f.service.cancel.mockClear();
      if (phase === 'first read state') f.service.readState.mockImplementationOnce(() => stateReply.promise);
      else if (phase.endsWith('read state')) f.service.readState
        .mockResolvedValueOnce(readState).mockImplementationOnce(() => stateReply.promise);
      else if (suggestion) f.service.suggest.mockImplementationOnce(() => queryReply.promise);
      else f.service.submit.mockImplementationOnce(() => queryReply.promise);
      const published: SearchResponse[] = [];
      const release = f.store.subscribe((state, previous) => {
        if (state.response && state.response !== previous.response) published.push(state.response);
      });
      let completed = false;
      const completion = f.runtime.resume(f.runtimeContext).then(() => { completed = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(f.service.readState).toHaveBeenCalledTimes(phase.endsWith('read state') && phase !== 'first read state' ? 2 : 1);
      expect(f.service.submit).toHaveBeenCalledTimes(!suggestion && phase !== 'first read state' ? 1 : 0);
      expect(f.service.suggest).toHaveBeenCalledTimes(suggestion ? 1 : 0);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(completed).toBe(false);
      expect(f.service.cancel).not.toHaveBeenCalled();
      expect(f.store.getState()).toMatchObject({ status: 'loading', stalled: true, response: null });
      await vi.advanceTimersByTimeAsync(1);
      expect(completed).toBe(true);
      expect(f.service.cancel).toHaveBeenCalledOnce();
      expect(f.store.getState()).toMatchObject({
        query: 'post', filter: 'social', page: 0, status: 'error',
        errorKey: 'search.error.timeout', stalled: false, response: null,
      });
      expect(vi.getTimerCount()).toBe(1);
      const calls = [f.service.readState.mock.calls.length, f.service.submit.mock.calls.length, f.service.suggest.mock.calls.length];
      await vi.advanceTimersByTimeAsync(200);
      stateReply.finish(readState);
      queryReply.finish(response);
      await vi.advanceTimersByTimeAsync(0);
      expect([f.service.readState.mock.calls.length, f.service.submit.mock.calls.length, f.service.suggest.mock.calls.length]).toEqual(calls);
      expect(published).toEqual([]);
      expect(f.store.getState()).toMatchObject({ status: 'error', errorKey: 'search.error.timeout', response: null });
      await completion;
      release();
      await f.cleanup();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['submit', 'read state'] as const)('checks the absolute Date.now deadline after %s before a delayed timer dispatch', async (phase) => {
    const f = await paginatedFixture();
    f.navigate('detail:moment');
    f.store.setState({ page: 1, response: null, selectedId: 'page-1', scrollTop: 240 });
    const response = f.responseAt(2, 0);
    const readState = create(SearchReadStateSchema, { partition: response.partition, sources: response.sources });
    const queryReply = deferred<SearchResponse>();
    const stateReply = deferred<typeof readState>();
    f.service.submit.mockClear();
    f.service.readState.mockClear();
    f.service.cancel.mockClear();
    if (phase === 'submit') f.service.submit.mockImplementationOnce(() => queryReply.promise);
    else f.service.readState.mockResolvedValueOnce(readState).mockImplementationOnce(() => stateReply.promise);
    const started = Date.now();
    f.navigate('detail:search');
    await vi.advanceTimersByTimeAsync(0);
    // Wall time may reach the deadline before the event loop dispatches its timer.
    vi.setSystemTime(started + 5_000);
    queryReply.finish(response);
    stateReply.finish(readState);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.service.cancel).not.toHaveBeenCalled();
    expect(f.service.submit).toHaveBeenCalledOnce();
    expect(f.service.readState).toHaveBeenCalledTimes(phase === 'submit' ? 1 : 2);
    expect(f.store.getState()).toMatchObject({
      page: 1, query: 'post', filter: 'social', selectedId: 'page-1', scrollTop: 240,
      response: null, status: 'error', errorKey: 'search.error.timeout', stalled: false,
    });
    expect(vi.getTimerCount()).toBe(1);
    await f.cleanup();
  });

  it.each(['resolve', 'reject'] as const)('keeps B alive when stale A expires and later %ss', async (settlement) => {
    const f = await paginatedFixture();
    const replyA = deferred<SearchResponse>();
    const replyB = deferred<SearchResponse>();
    f.store.setState({ response: null });
    f.service.submit.mockClear();
    f.service.cancel.mockClear();
    f.service.submit.mockImplementationOnce(() => replyA.promise).mockImplementationOnce(() => replyB.promise);
    f.actions.submit();
    await vi.advanceTimersByTimeAsync(0);
    const idA = f.service.submit.mock.calls[0][1];
    await vi.advanceTimersByTimeAsync(1_000);
    f.actions.submit();
    await vi.advanceTimersByTimeAsync(0);
    const idB = f.service.submit.mock.calls[1][1];
    expect(idB).not.toBe(idA);
    expect(f.service.cancel).toHaveBeenCalledExactlyOnceWith(idA);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(f.service.cancel.mock.calls.every(([id]) => id === idA)).toBe(true);
    expect(f.store.getState()).toMatchObject({ status: 'loading', stalled: true, errorKey: null, response: null });
    if (settlement === 'resolve') replyA.finish(f.responseAt(2, 0));
    else replyA.reject({ code: 'SEARCH_SOURCE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(999);
    expect(f.service.cancel.mock.calls.some(([id]) => id === idB)).toBe(false);
    expect(f.store.getState()).toMatchObject({ status: 'loading', stalled: true, errorKey: null });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.service.cancel.mock.calls.filter(([id]) => id === idB)).toEqual([[idB]]);
    expect(f.store.getState()).toMatchObject({ status: 'error', stalled: false, errorKey: 'search.error.timeout' });
    const calls = f.service.readState.mock.calls.length;
    replyB.finish(f.responseAt(3, 0));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.service.readState).toHaveBeenCalledTimes(calls);
    expect(f.store.getState().response).toBeNull();
    await f.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['success', 'failure'] as const)('clears the request budget timer on terminal %s', async (terminal) => {
    const f = await paginatedFixture('messages');
    const reply = deferred<SearchResponse>();
    f.service.submit.mockImplementationOnce(() => reply.promise);
    f.service.cancel.mockClear();
    f.actions.submit();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(3);
    await vi.advanceTimersByTimeAsync(250);
    if (terminal === 'success') reply.finish(f.responseAt(2, 0));
    else reply.reject({ code: 'SEARCH_SOURCE_CHANGED' });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.store.getState()).toMatchObject({
      status: terminal === 'success' ? 'ready' : 'error', stalled: false,
      errorKey: terminal === 'success' ? null : 'search.error.sourceChanged',
    });
    expect(vi.getTimerCount()).toBe(1);
    f.navigate('detail:moment');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.service.cancel).not.toHaveBeenCalled();
    await f.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Mobile Search periodic query budget', () => {
  it.each(['all', 'social'] as const)('admits one %s periodic read before preflight and coalesces later intervals', async (filter) => {
    const f = await periodicBudgetFixture(filter);
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(f.service.readState).toHaveBeenCalledOnce();
      expect.soft(f.admissions).toHaveBeenCalledOnce();
      expect.soft(f.store.getState()).toMatchObject({ ...f.context, status: 'loading', errorKey: null });
      expect(f.service.submit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2_000);
      expect.soft(f.service.readState).toHaveBeenCalledOnce();
      expect.soft(f.admissions).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(2_000);
      expect.soft(f.service.readState).toHaveBeenCalledOnce();
      expect.soft(f.admissions).toHaveBeenCalledOnce();
      expect.soft(f.service.submit).not.toHaveBeenCalled();
      expect(f.published).toEqual([]);
      expect(f.service.suggest).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['all', 'social'] as const)('times out %s 5s from periodic entry without waiting for its first state reply', async (filter) => {
    const f = await periodicBudgetFixture(filter);
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(f.service.cancel).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(Date.now() - f.started).toBe(7_000);
      expect.soft(f.admissions).toHaveBeenCalledOnce();
      expect.soft(f.service.cancel).toHaveBeenCalledExactlyOnceWith(f.admissions.mock.results[0]?.value);
      expect.soft(f.store.getState()).toMatchObject({
        ...f.context, status: 'error', errorKey: 'search.error.timeout', stalled: false, response: null,
      });
      expect.soft(vi.getTimerCount()).toBe(1);
      const calls = [f.service.readState.mock.calls.length, f.service.submit.mock.calls.length];
      await vi.advanceTimersByTimeAsync(200);
      f.firstState.finish(f.state);
      await vi.advanceTimersByTimeAsync(0);
      expect([f.service.readState.mock.calls.length, f.service.submit.mock.calls.length]).toEqual(calls);
      expect(f.published).toEqual([]);
      expect.soft(f.store.getState()).toMatchObject({
        ...f.context, status: 'error', errorKey: 'search.error.timeout', response: null,
      });
    } finally {
      await f.cleanup();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['all', 'social'] as const)('charges delayed %s preflight and reconstruction to the same periodic budget', async (filter) => {
    const f = await periodicBudgetFixture(filter);
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(2_600);
      expect.soft(f.service.submit).not.toHaveBeenCalled();
      f.firstState.finish(f.state);
      await vi.advanceTimersByTimeAsync(0);
      expect(f.replies).toHaveLength(1);
      expect(f.service.submit.mock.calls[0]).toEqual([
        'post', expect.any(String), 'zh-CN',
        filter === 'social' ? [SearchKind.SOCIAL_POST, SearchKind.SOCIAL_COMMENT] : [],
        '', '', true, false,
      ]);
      const id = f.service.submit.mock.calls[0][1];
      await vi.advanceTimersByTimeAsync(2_399);
      expect(f.service.cancel).not.toHaveBeenCalled();
      expect(f.published).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(Date.now() - f.started).toBe(7_000);
      expect.soft(f.service.cancel).toHaveBeenCalledExactlyOnceWith(id);
      expect.soft(f.store.getState()).toMatchObject({
        ...f.context, status: 'error', errorKey: 'search.error.timeout', stalled: false, response: null,
      });
      const calls = f.service.readState.mock.calls.length;
      await vi.advanceTimersByTimeAsync(200);
      f.replies[0].finish(f.replies[0].response);
      await vi.advanceTimersByTimeAsync(0);
      expect.soft(f.service.submit).toHaveBeenCalledOnce();
      expect.soft(f.service.readState).toHaveBeenCalledTimes(calls);
      expect(f.published).toEqual([]);
      expect.soft(f.store.getState()).toMatchObject({
        ...f.context, status: 'error', errorKey: 'search.error.timeout', response: null,
      });
    } finally {
      await f.cleanup();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['all', 'social'] as const)('publishes only fresh %s page two when periodic preflight and traversal finish inside 5s', async (filter) => {
    const f = await periodicBudgetFixture(filter);
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(1_500);
      f.firstState.finish(f.state);
      await vi.advanceTimersByTimeAsync(0);
      for (let page = 0; page < 2; page++) {
        expect(f.replies).toHaveLength(page + 1);
        expect(f.published).toEqual([]);
        await vi.advanceTimersByTimeAsync(1_500);
        f.replies[page].finish(f.replies[page].response);
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(Date.now() - f.started).toBe(6_500);
      expect(f.admissions).toHaveBeenCalledOnce();
      const id = f.admissions.mock.results[0].value;
      const selectedKinds = filter === 'social' ? [SearchKind.SOCIAL_POST, SearchKind.SOCIAL_COMMENT] : [];
      expect(f.service.submit.mock.calls).toEqual([
        ['post', id, 'zh-CN', selectedKinds, '', '', true, false],
        ['post', id, 'zh-CN', selectedKinds, '', 'traversal-2-page-1', false, false],
      ]);
      expect(f.service.readState).toHaveBeenCalledTimes(3);
      expect(f.store.getState()).toMatchObject({
        ...f.context, cursors: ['', 'traversal-2-page-1'], status: 'ready', errorKey: null, stalled: false,
      });
      expect(f.published).toEqual([f.replies[1].response]);
      expect(f.store.getState().response?.items[0].snippet).toBe('original-owner traversal 2 page 1');
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(501);
      expect(f.service.cancel).not.toHaveBeenCalled();
      expect(f.store.getState().status).toBe('ready');
      expect(f.service.submit).toHaveBeenCalledTimes(2);
      expect(f.service.suggest).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Mobile Search delayed progress ownership', () => {
  it.each(['resolve', 'reject'] as const)('keeps B progress armed when superseded A %ss', async (settlement) => {
    const f = await fixture();
    let finishA!: (value: SearchResponse) => void;
    let rejectA!: (reason: unknown) => void;
    let finishB!: (value: SearchResponse) => void;
    f.service.submit.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finishA = resolve;
      rejectA = reject;
    }));
    f.service.suggest.mockImplementationOnce(() => new Promise(resolve => { finishB = resolve; }));
    f.actions.submit();
    await vi.advanceTimersByTimeAsync(0);
    f.actions.query('B');
    await vi.advanceTimersByTimeAsync(120);
    expect(f.service.suggest).toHaveBeenCalledOnce();
    if (settlement === 'resolve') finishA(create(SearchResponseSchema));
    else rejectA({ code: 'SEARCH_SOURCE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(199);
    expect(f.store.getState().stalled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.store.getState()).toMatchObject({ query: 'B', status: 'loading', stalled: true, errorKey: null });
    finishB(create(SearchResponseSchema, { expiresAtUnixMs: BigInt(Date.now() + 60_000) }));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.store.getState()).toMatchObject({ status: 'ready', stalled: false });
    await f.cleanup();
  });
});
