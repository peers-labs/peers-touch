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

  it('projects the same readable author from a private post and a comment', () => {
    const actorPtid =
      'ptid:v1:actor:peers:p:alice:12203e0f255f835ecd0abd93aa0ea6f11bcd7580bcb1e7fcc0977567f44493fb62f7';
    const postIdentity = resolveSocialActorIdentity({
      actorPtid,
      displayName: actorPtid,
    });
    expect(postIdentity.displayName).toBe('Alice');
    expect(resolveSocialActorIdentity({ actorPtid })).toEqual(postIdentity);
    expect(
      resolveSocialActorIdentity(
        { actorPtid, displayName: actorPtid },
        { displayName: 'Alice Smith', username: 'alice', acct: 'alice', avatar: '' },
      ).displayName,
    ).toBe('Alice Smith');
  });
});
