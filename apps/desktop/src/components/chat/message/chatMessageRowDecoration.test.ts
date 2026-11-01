import { describe, expect, it } from 'vitest';

import type { ChatMessage } from './chatMessageModel';
import { buildChatRowDecoration } from './chatMessageRowDecoration';
import type { MessageReactionMutation } from './messageReactionState';

const roots = [
  { ulid: 'root-1', threadRootUlid: '', sentAtMs: 10 },
  { ulid: 'root-2', threadRootUlid: '', sentAtMs: 20 },
  { ulid: 'root-3', threadRootUlid: '', sentAtMs: 30 },
] as unknown as ChatMessage[];

function baseInput(overrides: Partial<Parameters<typeof buildChatRowDecoration>[0]> = {}) {
  return {
    messages: roots,
    conversationMessages: roots,
    previous: null,
    reactions: {},
    reactionMutations: {},
    currentUserPtid: 'me',
    activeKind: 'friend' as const,
    activeConversationId: 'conv-1',
    threadCounts: {},
    projectThreadMessages: () => [] as ChatMessage[],
    ...overrides,
  };
}

function pendingAddMutation(
  actorPtid: string,
  emoji: string,
  requestId: number,
): MessageReactionMutation {
  return {
    emoji,
    remove: false,
    optimisticReactions: [{ actorPtid, emoji }],
    phase: 'pending',
    requestId,
  };
}

describe('buildChatRowDecoration', () => {
  it('keeps every row reference when the inputs did not change', () => {
    const first = buildChatRowDecoration(baseInput());
    const projectThreadMessages = () => [] as ChatMessage[];
    const second = buildChatRowDecoration(baseInput({
      previous: first,
      projectThreadMessages,
    }));

    for (const message of roots) {
      expect(second.reactionsByUlid.get(message.ulid))
        .toBe(first.reactionsByUlid.get(message.ulid));
      expect(second.threadStatsByUlid.get(message.ulid))
        .toBe(first.threadStatsByUlid.get(message.ulid));
    }
  });

  it('changes only the row whose reactions mutated', () => {
    const reaction = { actorPtid: 'peer', emoji: '👍' };
    const reactions = { 'root-2': [reaction] };
    const first = buildChatRowDecoration(baseInput({ reactions }));
    const firstRoot2 = first.reactionsByUlid.get('root-2');

    // Unrelated store fan-out (same slice identities) must reuse every row.
    const second = buildChatRowDecoration(baseInput({ previous: first, reactions }));
    expect(second.reactionsByUlid.get('root-2')).toBe(firstRoot2);

    const next = buildChatRowDecoration(baseInput({
      previous: second,
      reactions,
      reactionMutations: {
        'root-2': pendingAddMutation('me', '❤️', 1),
      },
    }));

    expect(next.reactionsByUlid.get('root-2')).not.toBe(firstRoot2);
    expect(next.reactionMutationsByUlid.get('root-2')?.phase).toBe('pending');
    expect(next.reactionsByUlid.get('root-1'))
      .toBe(second.reactionsByUlid.get('root-1'));
    expect(next.reactionsByUlid.get('root-3'))
      .toBe(second.reactionsByUlid.get('root-3'));
    expect(next.reactionMutationsByUlid.has('root-1')).toBe(false);
  });

  it('reuses the reaction list when content is equal despite a new array', () => {
    const reactions = { 'root-1': [{ actorPtid: 'peer', emoji: '👍' }] };
    const first = buildChatRowDecoration(baseInput({ reactions }));
    const second = buildChatRowDecoration(baseInput({
      previous: first,
      reactions: { 'root-1': [{ actorPtid: 'peer', emoji: '👍' }] },
    }));

    expect(second.reactionsByUlid.get('root-1'))
      .toBe(first.reactionsByUlid.get('root-1'));
  });

  it('changes only the row whose thread summary changed', () => {
    const first = buildChatRowDecoration(baseInput());
    const second = buildChatRowDecoration(baseInput({
      previous: first,
      threadCounts: { 'friend:conv-1:root-3': { unreadCount: 2, replyCount: 2 } },
    }));

    expect(second.threadStatsByUlid.get('root-1'))
      .toBe(first.threadStatsByUlid.get('root-1'));
    expect(second.threadStatsByUlid.get('root-2'))
      .toBe(first.threadStatsByUlid.get('root-2'));
    expect(second.threadStatsByUlid.get('root-3')).not
      .toBe(first.threadStatsByUlid.get('root-3'));
    expect(second.threadStatsByUlid.get('root-3')?.unreadCount).toBe(2);
  });

  it('drops rows that disappeared from the message slice', () => {
    const first = buildChatRowDecoration(baseInput());
    const remaining = roots.slice(0, 2);
    const second = buildChatRowDecoration(baseInput({
      messages: remaining,
      conversationMessages: remaining,
      previous: first,
    }));

    expect(second.threadStatsByUlid.has('root-3')).toBe(false);
    expect(second.reactionsByUlid.has('root-3')).toBe(false);
  });
});
