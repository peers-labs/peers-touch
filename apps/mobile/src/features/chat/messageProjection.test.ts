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

  it.each([
    { durationMs: 2400, codec: 'audio/mp4;codecs=mp4a.40.2', waveform: [8, 15, 8] },
    undefined,
  ])('preserves canonical voice metadata without deriving it from content kind', (voiceNote) => {
    const projected = projectMessagingMessage('conversation-1', {
      messageId: 'voice-message',
      senderPtid: 'ptid:alice',
      senderDeviceId: 'device-a',
      plaintext: '',
      attachments: [{
        attachmentId: 'voice-attachment',
        filename: 'recording.m4a',
        mimeType: 'audio/mp4',
        plaintextSize: 9800,
        contentKind: voiceNote ? 0 : 2,
        durationMs: voiceNote ? 0 : 2400,
        voiceNote,
      }],
      state: 'delivered',
      timestampUnixMs: 1_700_000_000_123,
      retracted: false,
      moderated: false,
      reactions: [],
      readByPtids: [],
    });
    expect(projected.attachments[0].voiceNote).toEqual(voiceNote);
    if (voiceNote) {
      projected.attachments[0].voiceNote.waveform.push(99);
      expect(voiceNote.waveform).toEqual([8, 15, 8]);
    }
  });
});
