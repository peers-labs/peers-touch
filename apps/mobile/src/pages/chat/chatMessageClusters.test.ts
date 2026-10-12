import { describe, expect, it } from 'vitest';

import type { ChatMessageCommandOutcomes } from '../../features/chat/messageCommandState';
import type { SocialMessage } from '../../features/social/socialTypes';
import { projectChatMessageClusters } from './chatMessageClusters';

const ACTOR = 'ptid:alice';

function message(
  ulid: string,
  senderPtid: string,
  overrides: Partial<SocialMessage> = {},
): SocialMessage {
  return {
    ulid,
    sessionUlid: 'conversation-1',
    senderPtid,
    receiverPtid: senderPtid === ACTOR ? 'ptid:bob' : ACTOR,
    type: 1,
    content: ulid,
    status: 3,
    messagingState: 'delivered',
    ...overrides,
  };
}

describe('projectChatMessageClusters', () => {
  it('keeps one avatar and one metadata row at the end of a sender cluster', () => {
    const projected = projectChatMessageClusters([
      message('one', 'ptid:bob'),
      message('two', 'ptid:bob'),
      message('three', 'ptid:bob'),
    ], ACTOR, {});

    expect(projected.map(({ position, showAvatar, showMetadata }) => ({
      position,
      showAvatar,
      showMetadata,
    }))).toEqual([
      { position: 'start', showAvatar: false, showMetadata: false },
      { position: 'middle', showAvatar: false, showMetadata: false },
      { position: 'end', showAvatar: true, showMetadata: true },
    ]);
    expect(new Set(projected.map((entry) => entry.clusterId))).toEqual(
      new Set(['one']),
    );
  });

  it('starts a new cluster when the sender changes', () => {
    const projected = projectChatMessageClusters([
      message('one', 'ptid:bob'),
      message('two', ACTOR),
      message('three', ACTOR),
    ], ACTOR, {});

    expect(projected.map((entry) => entry.position)).toEqual([
      'single',
      'start',
      'end',
    ]);
    expect(projected.map((entry) => entry.clusterId)).toEqual([
      'one',
      'two',
      'two',
    ]);
  });

  it.each([
    ['failed delivery', message('two', ACTOR, { messagingState: 'failed' }), {}],
    ['unknown command', message('two', ACTOR), {
      two: {
        commandId: 'command-2',
        conversationId: 'conversation-1',
        messageId: 'two',
        kind: 'pin',
        state: 'uncertain',
      },
    }],
  ])('isolates %s so local recovery remains visible', (
    _name,
    middle,
    outcomes,
  ) => {
    const projected = projectChatMessageClusters([
      message('one', ACTOR),
      middle as SocialMessage,
      message('three', ACTOR),
    ], ACTOR, outcomes as ChatMessageCommandOutcomes);

    expect(projected.map((entry) => entry.position)).toEqual([
      'single',
      'single',
      'single',
    ]);
    expect(projected.every((entry) => entry.showMetadata)).toBe(true);
  });
});
