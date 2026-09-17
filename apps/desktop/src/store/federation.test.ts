import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FederationCatalogEntry, MemberStationView } from '../services/desktop_api';

const mocks = vi.hoisted(() => ({
  federationCatalogSearch: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    federationCatalogSearch: mocks.federationCatalogSearch,
  },
}));

import { resolveFederationStationName, useFederationStore } from './federation';

describe('federation actor Station directory', () => {
  beforeEach(() => {
    mocks.federationCatalogSearch.mockReset();
    useFederationStore.setState({
      actorStationEntries: {},
      memberStationsByFederation: {},
    });
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

  it('resolves a human-readable authority Station without falling back to its peer ID', () => {
    expect(resolveFederationStationName({
      actorPtid: 'ptid:bob',
      federationId: 'federation-1',
      stationPeerId: 'station-bob',
      actorStationEntries: {},
      memberStationsByFederation: {
        'federation-1': [{
          stationPeerId: 'station-bob',
          stationName: 'Aspen Station',
        } as MemberStationView],
      },
    })).toBe('Aspen Station');

    expect(resolveFederationStationName({
      stationPeerId: 'station-unknown',
      actorStationEntries: {},
      memberStationsByFederation: {},
    })).toBe('');
  });

  it('prefers the actor-specific Station name over a generic member directory label', () => {
    expect(resolveFederationStationName({
      actorPtid: 'ptid:bob',
      federationId: 'federation-1',
      stationPeerId: 'station-bob',
      actorStationEntries: {
        'ptid:bob': {
          actorPtid: 'ptid:bob',
          homeStationPeerId: 'station-bob',
          homeStationName: 'Aspen Station',
        } as FederationCatalogEntry,
      },
      memberStationsByFederation: {
        'federation-1': [{
          stationPeerId: 'station-bob',
          stationName: 'local',
        } as MemberStationView],
      },
    })).toBe('Aspen Station');
  });
});
