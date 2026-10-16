import { describe, expect, it } from 'vitest';

import { resolveSocialActorIdentity } from './useSocialActorIdentity';

describe('resolveSocialActorIdentity', () => {
  it('prefers the canonical profile over a degraded comment transport identity', () => {
    expect(
      resolveSocialActorIdentity(
        {
          actorPtid: 'ptid:bob',
          displayName: 'bob@192.0.2.50:18080',
        },
        {
          acct: 'bob@192.0.2.50:18080',
          avatar: 'https://station.example/bob.png',
          displayName: 'Bob',
          username: 'bob',
        },
      ),
    ).toEqual({
      actorPtid: 'ptid:bob',
      avatar: 'https://station.example/bob.png',
      displayName: 'Bob',
    });
  });

  it('preserves a complete post identity while the profile projection loads', () => {
    expect(
      resolveSocialActorIdentity({
        actorPtid: 'ptid:bob',
        avatar: 'data:image/svg+xml;base64,bob',
        displayName: 'Bob',
        username: 'bob',
      }),
    ).toEqual({
      actorPtid: 'ptid:bob',
      avatar: 'data:image/svg+xml;base64,bob',
      displayName: 'Bob',
    });
  });
});
