import { describe, expect, it } from 'vitest';

import {
  beginMessageReactionMutation,
  messageReactionProjectionMatches,
  reactionMutationForProjection,
  visibleMessageReactions,
  type MessageReactionMutation,
} from './messageReactionState';

describe('message reaction state', () => {
  it('optimistically adds the selected emoji for the current actor', () => {
    const mutation = beginMessageReactionMutation(
      [{ actorId: 'peer', emoji: '👍' }],
      'self',
      '🎉',
      1,
    );

    expect(mutation.remove).toBe(false);
    expect(mutation.optimisticReactions).toEqual([
      { actorId: 'peer', emoji: '👍' },
      { actorId: 'self', emoji: '🎉' },
    ]);
  });

  it('optimistically removes only the selected actor and emoji tuple', () => {
    const mutation = beginMessageReactionMutation(
      [
        { actorId: 'self', emoji: '👍' },
        { actorId: 'peer', emoji: '👍' },
        { actorId: 'self', emoji: '🎉' },
      ],
      'self',
      '👍',
      2,
    );

    expect(mutation.remove).toBe(true);
    expect(mutation.optimisticReactions).toEqual([
      { actorId: 'peer', emoji: '👍' },
      { actorId: 'self', emoji: '🎉' },
    ]);
  });

  it('keeps optimistic state pending until the authoritative projection converges', () => {
    const mutation = beginMessageReactionMutation([], 'self', '❤️', 3);

    expect(messageReactionProjectionMatches([], 'self', mutation)).toBe(false);
    expect(messageReactionProjectionMatches(
      [{ actorId: 'self', emoji: '❤️' }],
      'self',
      mutation,
    )).toBe(true);
  });

  it('rolls visible state back to the projection after failure', () => {
    const projection = [{ actorId: 'peer', emoji: '😂' }];
    const failedMutation: MessageReactionMutation = {
      ...beginMessageReactionMutation(projection, 'self', '🔥', 4),
      phase: 'error',
    };

    expect(visibleMessageReactions(projection, failedMutation)).toBe(projection);
  });

  it('retires settled local state when the projection matches', () => {
    const mutation: MessageReactionMutation = {
      ...beginMessageReactionMutation([], 'self', '👏', 5),
      phase: 'awaiting-projection',
    };

    expect(reactionMutationForProjection(
      [{ actorId: 'self', emoji: '👏' }],
      'self',
      mutation,
    )).toBeUndefined();
  });
});
