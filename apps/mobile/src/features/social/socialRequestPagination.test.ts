import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';
import { FriendRequestState } from '../../gen/proto/domain/social/relationship_pb';
import { createSocialGateway, type SocialGateway } from '../../services/gateways/socialGateway';
import { normalizeFriendRequest } from './socialNormalizers';
import { projectAcceptedContacts } from './socialProjection';
import { useSocialStore } from './socialStore';
import type { FriendRequest } from './socialTypes';

const session: MobileAuthSession = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

function request(index: number, status = FriendRequestState.PENDING) {
  return normalizeFriendRequest({
    requestId: `request-${index}`,
    senderPtid: session.actorRef.ptid,
    receiverPtid: `ptid:peer-${index}`,
    senderHomeStationPeerId: 'station-a',
    receiverHomeStationPeerId: 'station-a',
    federationId: 'fed-a',
    status,
  });
}

type RequestOutcome = Awaited<ReturnType<SocialGateway['listFriendRequests']>>;

function page(requests: FriendRequest[], total = requests.length): RequestOutcome {
  return { ok: true, data: { requests, total } };
}

function deferredPage() {
  let resolve!: (value: RequestOutcome) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RequestOutcome>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const failedPage: RequestOutcome = {
  ok: false,
  error: {
    code: 'UNAVAILABLE',
    message: 'mobile.contacts.requestFailed',
    method: 'GET',
    path: '/api/v1/social/friend-requests',
    status: 503,
  },
};
const previousRequests = [request(999, FriendRequestState.ACCEPTED)];

describe('Social request pagination', () => {
  let debugReports: Promise<Response>[];
  let gateway: SocialGateway;
  let list: MockInstance<SocialGateway['listFriendRequests']>;

  beforeEach(() => {
    gateway = createSocialGateway(session);
    list = vi.spyOn(gateway, 'listFriendRequests')
      .mockRejectedValue(new Error('Unexpected request page'));
    vi.spyOn(gateway, 'sendFriendRequest')
      .mockRejectedValue(new Error('Unexpected request submission'));
    vi.spyOn(gateway, 'acceptFriendRequest')
      .mockRejectedValue(new Error('Unexpected request acceptance'));
    vi.spyOn(gateway, 'rejectFriendRequest')
      .mockRejectedValue(new Error('Unexpected request rejection'));
    useSocialStore.setState(useSocialStore.getInitialState(), true);
    useSocialStore.setState({
      authSession: session,
      currentUserPtid: session.actorRef.ptid,
      socialGateway: gateway,
    });
    debugReports = [];
    const fetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (input !== import.meta.env.VITE_MOBILE_DEBUG_COLLECTOR) {
        throw new Error('Unexpected transport during request pagination');
      }
      const report = fetch(input, init);
      debugReports.push(report);
      return report;
    });
  });

  afterEach(async () => {
    await Promise.allSettled(debugReports);
    try {
      expect(gateway.sendFriendRequest).not.toHaveBeenCalled();
      expect(gateway.acceptFriendRequest).not.toHaveBeenCalled();
      expect(gateway.rejectFriendRequest).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      useSocialStore.setState(useSocialStore.getInitialState(), true);
    }
  });

  it('loads all 120 records and exposes the accepted contact on the last page', async () => {
    const requests = Array.from({ length: 120 }, (_, index) =>
      request(index, index === 119 ? FriendRequestState.ACCEPTED : FriendRequestState.PENDING),
    );
    list.mockImplementation(async (_status = 0, limit = 50, offset = 0) =>
      page(requests.slice(offset, offset + limit), requests.length),
    );

    await useSocialStore.getState().refreshFriendRequests();

    const state = useSocialStore.getState();
    expect(state.friendRequests).toHaveLength(120);
    expect(state.friendRequests).toEqual(requests);
    expect(list.mock.calls).toEqual([[0, 50, 0], [0, 50, 50], [0, 50, 100]]);
    expect(projectAcceptedContacts(state.friendRequests, state.currentUserPtid, state.peerOnline))
      .toEqual([{
        peerPtid: 'ptid:peer-119',
        peerName: 'ptid:peer-119',
        peerAvatar: '',
        peerOnline: false,
        federationIds: ['fed-a'],
      }]);
    expect(state.sessions).toEqual([]);
  });

  it('advances by the actual short server page while total is larger', async () => {
    const requests = Array.from({ length: 7 }, (_, index) => request(index));
    list.mockImplementation(async (_status = 0, _limit = 50, offset = 0) =>
      page(requests.slice(offset, offset + 2), requests.length),
    );

    await useSocialStore.getState().refreshFriendRequests();

    expect(useSocialStore.getState().friendRequests).toEqual(requests);
    expect(list.mock.calls).toEqual([[0, 50, 0], [0, 50, 2], [0, 50, 4], [0, 50, 6]]);
  });

  it('publishes once after the final page without exposing an intermediate snapshot', async () => {
    const requests = [request(0), request(1), request(2)];
    const last = deferredPage();
    list.mockResolvedValueOnce(page(requests.slice(0, 2), 3))
      .mockReturnValueOnce(last.promise);
    useSocialStore.setState({ friendRequests: previousRequests });
    const publish = vi.fn();
    const unsubscribe = useSocialStore.subscribe(publish);
    const pending = useSocialStore.getState().refreshFriendRequests();
    try {
      await Promise.resolve();
      expect(list).toHaveBeenCalledTimes(2);
      expect(useSocialStore.getState().friendRequests).toBe(previousRequests);
      expect(publish).not.toHaveBeenCalled();

      last.resolve(page(requests.slice(2), 3));
      await pending;

      expect(publish).toHaveBeenCalledOnce();
      expect(useSocialStore.getState().friendRequests).toEqual(requests);
    } finally {
      unsubscribe();
      last.resolve(page(requests.slice(2), 3));
      await pending;
    }
  });

  it.each(['outcome', 'rejection'] as const)(
    'preserves the prior snapshot when a later page fails with %s',
    async (failure) => {
      useSocialStore.setState({ friendRequests: previousRequests });
      list.mockResolvedValueOnce(page([request(0)], 2));
      if (failure === 'outcome') list.mockResolvedValueOnce(failedPage);
      else list.mockRejectedValueOnce(new Error('mobile.contacts.requestFailed'));
      const before = useSocialStore.getState();

      await expect(before.refreshFriendRequests()).rejects.toThrow('mobile.contacts.requestFailed');

      expect(useSocialStore.getState()).toBe(before);
      expect(list).toHaveBeenCalledTimes(2);
    },
  );

  it('deduplicates request IDs within and across pages without merging different requests', async () => {
    const first = request(0);
    const second = { ...request(1), receiverPtid: first.receiverPtid };
    const acceptedSecond = { ...second, status: FriendRequestState.ACCEPTED };
    const third = request(2);
    const fourth = request(3);
    list.mockResolvedValueOnce(page([first, first, second], 4))
      .mockResolvedValueOnce(page([acceptedSecond, third, fourth], 4));

    await useSocialStore.getState().refreshFriendRequests();

    expect(useSocialStore.getState().friendRequests).toEqual([first, acceptedSecond, third, fourth]);
    expect(list.mock.calls).toEqual([[0, 50, 0], [0, 50, 3]]);
  });

  it('preserves every canonical request state', async () => {
    const requests = [
      FriendRequestState.UNSPECIFIED,
      FriendRequestState.PENDING,
      FriendRequestState.ACCEPTED,
      FriendRequestState.REJECTED,
      FriendRequestState.EXPIRED,
    ].map((status, index) => request(index, status));
    list.mockResolvedValueOnce(page(requests));

    await useSocialStore.getState().refreshFriendRequests();

    expect(useSocialStore.getState().friendRequests).toEqual(requests);
  });

  it.each([
    { label: 'empty initial page', first: [], next: [], calls: 1 },
    { label: 'empty later page', first: [request(0)], next: [], calls: 2 },
    { label: 'repeated page', first: [request(0)], next: [request(0)], calls: 2 },
    {
      label: 'duplicate-only later page',
      first: [request(0), request(1)],
      next: [request(1), request(0), request(1)],
      calls: 2,
    },
  ])('fails explicitly on $label without publishing partial results', async ({ first, next, calls }) => {
    useSocialStore.setState({ friendRequests: previousRequests });
    list.mockResolvedValueOnce(page(first, 3)).mockResolvedValueOnce(page(next, 3));

    await expect(useSocialStore.getState().refreshFriendRequests()).rejects.toMatchObject({
      context: { method: 'GET', path: '/api/v1/social/friend-requests', message: 'mobile.contacts.requestFailed' },
    });

    expect(useSocialStore.getState().friendRequests).toBe(previousRequests);
    expect(list).toHaveBeenCalledTimes(calls);
  });

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed total %s without replacing the prior snapshot',
    async (total) => {
      useSocialStore.setState({ friendRequests: previousRequests });
      list.mockResolvedValueOnce(page([request(0)], total));

      await expect(useSocialStore.getState().refreshFriendRequests())
        .rejects.toThrow('mobile.contacts.requestFailed');

      expect(useSocialStore.getState().friendRequests).toBe(previousRequests);
      expect(list).toHaveBeenCalledOnce();
    },
  );

  it('rejects a total smaller than the unique rows already received', async () => {
    useSocialStore.setState({ friendRequests: previousRequests });
    list.mockResolvedValueOnce(page([request(0), request(1)], 1));

    await expect(useSocialStore.getState().refreshFriendRequests())
      .rejects.toThrow('mobile.contacts.requestFailed');

    expect(useSocialStore.getState().friendRequests).toBe(previousRequests);
    expect(list).toHaveBeenCalledOnce();
  });

  it.each([1, 4])('rejects a changing total of %s instead of chasing a moving snapshot', async (total) => {
    useSocialStore.setState({ friendRequests: previousRequests });
    list.mockResolvedValueOnce(page([request(0)], 3))
      .mockResolvedValueOnce(page([request(1)], total));

    await expect(useSocialStore.getState().refreshFriendRequests())
      .rejects.toThrow('mobile.contacts.requestFailed');

    expect(useSocialStore.getState().friendRequests).toBe(previousRequests);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each(['', '   '])('rejects a missing request ID (%j) without inventing one', async (requestId) => {
    useSocialStore.setState({ friendRequests: previousRequests });
    list.mockResolvedValueOnce(page([{ ...request(0), requestId }]));

    await expect(useSocialStore.getState().refreshFriendRequests())
      .rejects.toThrow('mobile.contacts.requestFailed');

    expect(useSocialStore.getState().friendRequests).toBe(previousRequests);
    expect(list).toHaveBeenCalledOnce();
  });

  it.each([0, 50])('finishes a complete %s-row result without requesting an extra page', async (total) => {
    const requests = Array.from({ length: total }, (_, index) => request(index));
    useSocialStore.setState({ friendRequests: previousRequests });
    list.mockResolvedValueOnce(page(requests));

    await useSocialStore.getState().refreshFriendRequests();

    expect(useSocialStore.getState().friendRequests).toEqual(requests);
    expect(list.mock.calls).toEqual([[0, 50, 0]]);
  });

  it.each(['account', 'gateway'] as const)(
    'stops after %s replacement mid-page without publishing or requesting more',
    async (replacement) => {
      const next = deferredPage();
      list.mockResolvedValueOnce(page([request(0)], 3)).mockReturnValueOnce(next.promise);
      const pending = useSocialStore.getState().refreshFriendRequests();
      await Promise.resolve();
      expect(list).toHaveBeenCalledTimes(2);
      useSocialStore.setState({
        friendRequests: previousRequests,
        ...(replacement === 'account'
          ? { authSession: { ...session, sessionId: 'replacement' } }
          : { socialGateway: createSocialGateway(session) }),
      });
      const before = useSocialStore.getState();
      next.resolve(page([request(1)], 3));

      await expect(pending).resolves.toBeUndefined();

      expect(useSocialStore.getState()).toBe(before);
      expect(list).toHaveBeenCalledTimes(2);
    },
  );

  it('discards a first page after gateway replacement in the same session', async () => {
    const first = deferredPage();
    list.mockReturnValueOnce(first.promise);
    const pending = useSocialStore.getState().refreshFriendRequests();
    useSocialStore.setState({
      socialGateway: createSocialGateway(session),
      friendRequests: previousRequests,
    });
    const before = useSocialStore.getState();
    first.resolve(page([request(0)]));

    await pending;

    expect(useSocialStore.getState()).toBe(before);
    expect(list).toHaveBeenCalledOnce();
  });

  it('does not repopulate requests after logout', async () => {
    const first = deferredPage();
    list.mockReturnValueOnce(first.promise);
    const pending = useSocialStore.getState().refreshFriendRequests();
    useSocialStore.getState().bindSession(null);
    const before = useSocialStore.getState();
    first.resolve(page([request(0)], 2));

    await pending;

    expect(useSocialStore.getState()).toBe(before);
    expect(useSocialStore.getState().friendRequests).toEqual([]);
    expect(list).toHaveBeenCalledOnce();
  });

  it.each(['outcome', 'rejection'] as const)(
    'discards a stale %s after account replacement',
    async (failure) => {
      const first = deferredPage();
      list.mockReturnValueOnce(first.promise);
      const pending = useSocialStore.getState().refreshFriendRequests();
      useSocialStore.setState({
        authSession: { ...session, sessionId: 'replacement' },
        friendRequests: previousRequests,
      });
      const before = useSocialStore.getState();
      if (failure === 'outcome') first.resolve(failedPage);
      else first.reject(new Error('mobile.contacts.requestFailed'));

      await expect(pending).resolves.toBeUndefined();

      expect(useSocialStore.getState()).toBe(before);
      expect(list).toHaveBeenCalledOnce();
    },
  );

  it('keeps the newer refresh when an older refresh finishes last', async () => {
    const first = deferredPage();
    const newerRequests = [request(100, FriendRequestState.ACCEPTED)];
    list.mockReturnValueOnce(first.promise).mockResolvedValueOnce(page(newerRequests));
    const older = useSocialStore.getState().refreshFriendRequests();
    await useSocialStore.getState().refreshFriendRequests();
    const before = useSocialStore.getState();
    first.resolve(page([request(0)], 3));

    await older;

    expect(useSocialStore.getState()).toBe(before);
    expect(useSocialStore.getState().friendRequests).toEqual(newerRequests);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('fences an older refresh as soon as a newer refresh starts', async () => {
    const first = deferredPage();
    const next = deferredPage();
    list.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    useSocialStore.setState({ friendRequests: previousRequests });
    const older = useSocialStore.getState().refreshFriendRequests();
    const newer = useSocialStore.getState().refreshFriendRequests();
    first.resolve(page([request(0)], 3));
    try {
      await older;
      expect(useSocialStore.getState().friendRequests).toBe(previousRequests);
      expect(list).toHaveBeenCalledTimes(2);
    } finally {
      next.resolve(page([request(100)]));
      await newer;
    }
    expect(useSocialStore.getState().friendRequests).toEqual([request(100)]);
  });

  it('does not revive an older refresh after a newer refresh fails', async () => {
    const first = deferredPage();
    list.mockReturnValueOnce(first.promise).mockResolvedValueOnce(failedPage);
    useSocialStore.setState({ friendRequests: previousRequests });
    const older = useSocialStore.getState().refreshFriendRequests();

    await expect(useSocialStore.getState().refreshFriendRequests())
      .rejects.toThrow('mobile.contacts.requestFailed');
    first.resolve(page([request(0)]));
    await older;

    expect(useSocialStore.getState().friendRequests).toBe(previousRequests);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each(['outcome', 'rejection'] as const)(
    'ignores an older refresh %s after the newer snapshot is published',
    async (failure) => {
      const first = deferredPage();
      list.mockReturnValueOnce(first.promise).mockResolvedValueOnce(page([request(100)]));
      const older = useSocialStore.getState().refreshFriendRequests();
      await useSocialStore.getState().refreshFriendRequests();
      const before = useSocialStore.getState();
      if (failure === 'outcome') first.resolve(failedPage);
      else first.reject(new Error('mobile.contacts.requestFailed'));

      await expect(older).resolves.toBeUndefined();

      expect(useSocialStore.getState()).toBe(before);
      expect(list).toHaveBeenCalledTimes(2);
    },
  );

  it('rejects an unavailable gateway without issuing a request', async () => {
    useSocialStore.setState({ socialGateway: null, friendRequests: previousRequests });

    await expect(useSocialStore.getState().refreshFriendRequests())
      .rejects.toThrow('mobile.social.notAuthenticated');

    expect(useSocialStore.getState().friendRequests).toBe(previousRequests);
    expect(list).not.toHaveBeenCalled();
  });
});
