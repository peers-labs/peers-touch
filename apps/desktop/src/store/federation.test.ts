import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FederationCatalogEntry } from '../services/desktop_api';

const mocks = vi.hoisted(() => ({
  profileGet: vi.fn(),
  federationCatalogSearch: vi.fn(),
  federationListContexts: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    profileGet: mocks.profileGet,
    federationCatalogSearch: mocks.federationCatalogSearch,
    federationListContexts: mocks.federationListContexts,
  },
}));

const session = vi.hoisted(() => ({ sessionEpoch: 1 }));
vi.mock('./session', () => ({ useSessionStore: { getState: () => session } }));

import { resolveFederationStationName, useFederationStore } from './federation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('federation actor Station directory', () => {
  beforeEach(() => {
    session.sessionEpoch++;
    mocks.profileGet.mockReset();
    mocks.federationCatalogSearch.mockReset();
    mocks.federationListContexts.mockReset();
    useFederationStore.getState().clearSession();
  });

  it('loads only the context projection exposed to ordinary clients', async () => {
    mocks.federationListContexts.mockResolvedValue({
      contexts: [{
        federationId: 'federation-1',
        name: 'Development',
        status: 'active',
      }],
    });

    await useFederationStore.getState().refreshFederationContexts();

    expect(useFederationStore.getState().federations).toEqual([{
      federationId: 'federation-1',
      name: 'Development',
      status: 'active',
    }]);
  });

  it('propagates context refresh failures to the runtime owner', async () => {
    mocks.federationListContexts.mockRejectedValue(
      new Error('Station unavailable'),
    );

    await expect(
      useFederationStore.getState().refreshFederationContexts(),
    ).rejects.toThrow('Station unavailable');
    expect(useFederationStore.getState().lastError)
      .toBe('Station unavailable');
  });

  it('retains the authoritative Station name from the matching actor row', async () => {
    mocks.federationCatalogSearch.mockResolvedValue({
      entries: [
        {
          actorPtid: 'ptid:other',
          homeStationPeerId: 'station-other',
          homeStationName: 'Other Station',
        },
        {
          actorPtid: 'ptid:bob',
          homeStationPeerId: 'station-bob',
          homeStationName: 'Aspen Station',
        },
      ],
    });

    await useFederationStore.getState().resolveActorStations([{
      actorPtid: 'ptid:bob',
      federationId: 'federation-1',
      username: 'bob',
    }]);

    expect(mocks.federationCatalogSearch).toHaveBeenCalledWith({
      federation_id: 'federation-1',
      prefix: 'bob',
      page_size: 20,
    });
    expect(useFederationStore.getState().actorStationEntries['ptid:bob'])
      .toMatchObject({
        homeStationPeerId: 'station-bob',
        homeStationName: 'Aspen Station',
      });
  });

  it('does not issue a second lookup after the actor Station is known', async () => {
    useFederationStore.getState().rememberCatalogEntries([{
      actorPtid: 'ptid:bob',
      homeStationPeerId: 'station-bob',
      homeStationName: 'Aspen Station',
    } as FederationCatalogEntry]);

    await useFederationStore.getState().resolveActorStations([{
      actorPtid: 'ptid:bob',
      federationId: 'federation-1',
      username: 'bob',
    }]);

    expect(mocks.federationCatalogSearch).not.toHaveBeenCalled();
  });

  it('resolves a human-readable authority Station only from the actor catalog row', () => {
    expect(resolveFederationStationName({
      actorPtid: 'ptid:bob',
      stationPeerId: 'station-bob',
      actorStationEntries: {
        'ptid:bob': {
          actorPtid: 'ptid:bob',
          homeStationPeerId: 'station-bob',
          homeStationName: 'Aspen Station',
        } as FederationCatalogEntry,
      },
    })).toBe('Aspen Station');

    expect(resolveFederationStationName({
      stationPeerId: 'station-unknown',
      actorStationEntries: {},
    })).toBe('');
  });

  it('does not present a raw Station authority as a friendly name', () => {
    for (const homeStationName of [
      '10.37.221.38:18080',
      'station.example:18080',
      'https://station.example:18080',
    ]) {
      expect(resolveFederationStationName({
        actorPtid: 'ptid:bob',
        stationPeerId: 'station-bob',
        actorStationEntries: {
          'ptid:bob': {
            actorPtid: 'ptid:bob',
            homeStationPeerId: 'station-bob',
            homeStationName,
          } as FederationCatalogEntry,
        },
      })).toBe('');
    }
  });

  it('discards old profile and context responses across an account change', async () => {
    const profile = deferred<unknown>();
    const contexts = deferred<unknown>();
    mocks.profileGet.mockReturnValue(profile.promise);
    mocks.federationListContexts.mockReturnValue(contexts.promise);
    const reads = Promise.all([
      useFederationStore.getState().refreshSelf(),
      useFederationStore.getState().refreshFederationContexts(),
    ]);
    session.sessionEpoch++;
    useFederationStore.getState().clearSession();
    profile.resolve({ ptid: 'old-actor' });
    contexts.resolve({ contexts: [{ federationId: 'old-federation' }] });
    await reads;
    expect(useFederationStore.getState().self).toBeNull();
    expect(useFederationStore.getState().federations).toEqual([]);
  });

  it('discards old failures after same-session teardown', async () => {
    const read = deferred<unknown>();
    mocks.federationListContexts.mockReturnValue(read.promise);
    const pending = useFederationStore.getState().refreshFederationContexts();
    useFederationStore.getState().clearSession();
    read.reject(new Error('old session failure'));
    await pending;
    expect(useFederationStore.getState().lastError).toBeNull();
  });

  it('does not retain catalog identities from a replaced account', async () => {
    const read = deferred<unknown>();
    mocks.federationCatalogSearch.mockReturnValue(read.promise);
    const pending = useFederationStore.getState().resolveActorStations([{
      actorPtid: 'ptid:bob', federationId: 'old', username: 'bob',
    }]);
    session.sessionEpoch++;
    read.resolve({ entries: [{
      actorPtid: 'ptid:bob', homeStationPeerId: 'old-station', homeStationName: 'Old',
    }] });
    await pending;
    expect(useFederationStore.getState().actorStationEntries).toEqual({});
  });
});
