// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it } from 'vitest';

import {
  messageDeliveryDisplayState,
  messageProjectionMetadata,
  projectMessagingMessage,
} from './messageProjection';

function message(overrides = {}) {
  return {
    ulid: 'message-1',
    sessionUlid: 'conversation-1',
    senderPtid: 'ptid:alice',
    receiverPtid: 'ptid:bob',
    type: 1,
    content: 'hello',
    status: 5,
    encryptedPayload: new Uint8Array(),
    attachments: [],
    ...overrides,
  };
}

describe('canonical message projection', () => {
  it.each([
    ['draft', 'sending'],
    ['pending', 'sending'],
    ['prepared', 'sending'],
    ['submitted', 'sending'],
    ['retry_wait', 'retrying'],
    ['accepted', 'sent'],
    ['delivered', 'delivered'],
    ['read', 'read'],
    ['failed', 'failed'],
    ['terminal', 'failed'],
  ])('maps Messaging state %s to %s', (messagingState, expected) => {
    expect(messageDeliveryDisplayState(message({ messagingState }))).toBe(expected);
  });

  it('does not revive the removed numeric friend-message status fallback', () => {
    expect(messageDeliveryDisplayState(message({ messagingState: undefined }))).toBe(
      'sending',
    );
  });

  it('projects moderation, reaction, and pin metadata without local defaults leaking', () => {
    expect(messageProjectionMetadata(message({
      eventSequence: 7,
      messagingState: 'accepted',
      moderated: true,
      moderationReasonCode: 'policy',
      reactions: [{
        actorPtid: 'ptid:bob',
        reaction: 'like',
        createdAtUnixMs: 10,
      }],
      pinnedByPtid: 'ptid:alice',
      pinnedAtUnixMs: 11,
    }))).toEqual({
      eventSequence: 7,
      messagingState: 'accepted',
      moderated: true,
      moderationReasonCode: 'policy',
      reactions: [{
        actorPtid: 'ptid:bob',
        reaction: 'like',
        createdAtUnixMs: 10,
      }],
      pinnedByPtid: 'ptid:alice',
      pinnedAtUnixMs: 11,
    });
  });

  it('maps canonical search results into the shared Chat presentation projection', () => {
    expect(projectMessagingMessage('conversation-1', {
      messageId: 'message-1',
      senderPtid: 'ptid:alice',
      senderDeviceId: 'device-a',
      plaintext: 'hello',
      attachments: [],
      state: 'accepted',
      timestampUnixMs: 1_700_000_000_123,
      retracted: false,
      moderated: false,
      reactions: [],
      readByPtids: [],
    })).toMatchObject({
      ulid: 'message-1',
      sessionUlid: 'conversation-1',
      senderPtid: 'ptid:alice',
      content: 'hello',
      messagingState: 'accepted',
    });
  });
});
