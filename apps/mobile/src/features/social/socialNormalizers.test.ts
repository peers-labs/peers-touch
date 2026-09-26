import { describe, expect, it } from 'vitest';

import {
  federationViewToResult,
  normalizePeerProfile,
} from './socialNormalizers';

describe('federationViewToResult', () => {
  it('reads PTID from the canonical ActorProfile identity fields', () => {
    const result = federationViewToResult({
      federatedHandle: '@bob@station.example',
      homeStationPeerId: 'station-peer',
      homeStationDomain: 'station.example',
      profile: {
        id: 'https://station.example/actors/bob',
        username: 'bob',
        displayName: 'Bob',
        ref: {
          ptid: 'ptid:bob',
        },
      },
    });

    expect(result).toMatchObject({
      id: 'ptid:bob',
      ptid: 'ptid:bob',
      homeStationPeerId: 'station-peer',
      username: 'bob',
      displayName: 'Bob',
    });
  });
});

describe('normalizePeerProfile', () => {
  it('fails closed to hidden for an unknown discoverability value', () => {
    const profile = normalizePeerProfile({
      discoverability: 65538,
    } as unknown as Parameters<typeof normalizePeerProfile>[0]);

    expect(profile.discoverability).toBe('hidden');
  });

  it('preserves canonical discoverability values', () => {
    expect(normalizePeerProfile({ discoverability: 2 }).discoverability)
      .toBe('by_handle');
    expect(normalizePeerProfile({
      discoverability: 'ACTOR_VISIBILITY_INDEXED',
    }).discoverability).toBe('indexed');
  });
});
