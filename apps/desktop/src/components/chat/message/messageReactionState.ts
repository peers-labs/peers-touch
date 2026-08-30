export interface MessageReaction {
  actorPtid: string;
  emoji: string;
}

export type MessageReactionMutationPhase = 'pending' | 'awaiting-projection' | 'error';

export interface MessageReactionMutation {
  emoji: string;
  remove: boolean;
  optimisticReactions: MessageReaction[];
  phase: MessageReactionMutationPhase;
  requestId: number;
}

export function blocksMessageActionOverlay(
  phase: MessageReactionMutationPhase | undefined,
): boolean {
  return phase !== undefined;
}

export function beginMessageReactionMutation(
  reactions: readonly MessageReaction[],
  actorPtid: string,
  emoji: string,
  requestId: number,
): MessageReactionMutation {
  const remove = reactions.some(
    reaction => reaction.actorPtid === actorPtid && reaction.emoji === emoji,
  );
  const optimisticReactions = remove
    ? reactions.filter(reaction => (
      reaction.actorPtid !== actorPtid || reaction.emoji !== emoji
    ))
    : [...reactions, { actorPtid, emoji }];

  return {
    emoji,
    remove,
    optimisticReactions,
    phase: 'pending',
    requestId,
  };
}

export function messageReactionProjectionMatches(
  reactions: readonly MessageReaction[],
  actorPtid: string,
  mutation: MessageReactionMutation,
): boolean {
  const projectionContainsReaction = reactions.some(
    reaction => reaction.actorPtid === actorPtid && reaction.emoji === mutation.emoji,
  );

  return mutation.remove ? !projectionContainsReaction : projectionContainsReaction;
}

export function visibleMessageReactions(
  reactions: readonly MessageReaction[],
  mutation: MessageReactionMutation | undefined,
): readonly MessageReaction[] {
  if (!mutation || mutation.phase === 'error') return reactions;
  return mutation.optimisticReactions;
}

export function reactionMutationForProjection(
  reactions: readonly MessageReaction[],
  actorPtid: string | null,
  mutation: MessageReactionMutation | undefined,
): MessageReactionMutation | undefined {
  if (
    actorPtid
    && mutation
    && mutation.phase !== 'pending'
    && messageReactionProjectionMatches(reactions, actorPtid, mutation)
  ) {
    return undefined;
  }
  return mutation;
}
