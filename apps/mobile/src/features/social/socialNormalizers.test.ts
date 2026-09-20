import { describe, expect, it } from 'vitest';

import { federationViewToResult } from './socialNormalizers';

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
