import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actorSearchActors: vi.fn(),
  peerProfileGet: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    actorGetMyProfile: vi.fn(),
    actorSearchActors: mocks.actorSearchActors,
    peerProfileGet: mocks.peerProfileGet,
  },
}));

vi.mock('../storage/desktopClientStorage', () => ({
  readDesktopPreferenceSync: vi.fn(() => undefined),
}));

import { useDiscoveryStore } from './discovery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('discovery store request isolation', () => {
  beforeEach(() => {
    mocks.actorSearchActors.mockReset();
    mocks.peerProfileGet.mockReset();
    useDiscoveryStore.getState().reset();
  });

  it('does not restore stale search results after the query is cleared', async () => {
    const pending = deferred<{
      items: Array<{
        actorPtid: string;
        username: string;
        displayName: string;
        homeStationPeerId: string;
      }>;
      total: number;
    }>();
    mocks.actorSearchActors.mockReturnValueOnce(pending.promise);

    const search = useDiscoveryStore.getState().searchUsers('alice');
    await useDiscoveryStore.getState().searchUsers('');
    pending.resolve({
      items: [{
        actorPtid: 'ptid:alice',
        username: 'alice',
        displayName: 'Alice',
        homeStationPeerId: 'station-one',
      }],
      total: 1,
    });
    await search;

    expect(useDiscoveryStore.getState()).toMatchObject({
      query: '',
      results: [],
      searching: false,
      total: 0,
    });
  });

  it('does not write a peer profile after the actor-scoped store resets', async () => {
    const pending = deferred<{
      id: string;
      username: string;
      display_name: string;
      avatar: string;
    }>();
    mocks.peerProfileGet.mockReturnValueOnce(pending.promise);

    const load = useDiscoveryStore.getState().loadUserProfile('ptid:alice');
    useDiscoveryStore.getState().reset();
    pending.resolve({
      id: 'ptid:alice',
      username: 'alice',
      display_name: 'Alice',
      avatar: '',
    });
    await load;

    expect(useDiscoveryStore.getState().usersById).toEqual({});
    expect(useDiscoveryStore.getState().profileLoadingById).toEqual({});
  });

  it('keeps search failure distinct from an empty result', async () => {
    mocks.actorSearchActors.mockRejectedValueOnce(new Error('search unavailable'));

    await useDiscoveryStore.getState().searchUsers('alice');

    expect(useDiscoveryStore.getState()).toMatchObject({
      query: 'alice',
      results: [],
      searching: false,
      total: 0,
      searchError: 'Error: search unavailable',
    });
  });
});
