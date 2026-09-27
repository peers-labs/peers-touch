import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FederationCatalogEntry } from '../services/desktop_api';

const mocks = vi.hoisted(() => ({
  federationCatalogSearch: vi.fn(),
  federationListContexts: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    federationCatalogSearch: mocks.federationCatalogSearch,
    federationListContexts: mocks.federationListContexts,
  },
}));

import { resolveFederationStationName, useFederationStore } from './federation';

describe('federation actor Station directory', () => {
  beforeEach(() => {
    mocks.federationCatalogSearch.mockReset();
    mocks.federationListContexts.mockReset();
    useFederationStore.setState({
      federations: [],
      actorStationEntries: {},
    });
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
});
