import { describe, expect, it } from 'vitest';

import { federationViewToResult, normalizePeerProfile } from './socialNormalizers';

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
  it.each([
    [undefined],
    [0],
    ['ACTOR_CONTACT_POLICY_UNSPECIFIED'],
    ['unexpected'],
  ])('fails closed for an absent or unknown contact policy (%s)', (contactPolicy) => {
    expect(normalizePeerProfile({
      id: 'ptid:alice',
      contactPolicy: contactPolicy as never,
    }).contactPolicy).toBe('nobody');
  });

  it.each([
    [1],
    ['ACTOR_CONTACT_POLICY_ANYONE'],
    ['anyone'],
  ])('accepts only an explicit anyone contact policy (%s)', (contactPolicy) => {
    expect(normalizePeerProfile({
      id: 'ptid:alice',
      contactPolicy: contactPolicy as never,
    }).contactPolicy).toBe('anyone');
  });
});
