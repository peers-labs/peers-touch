// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it, vi } from 'vitest';

import {
  isChatMessageCommandBusy,
  refreshChatMessageCommandOutcomes,
  trackChatMessageCommand,
} from './messageCommandState';

function message(overrides = {}) {
  return {
    ulid: 'message-1',
    sessionUlid: 'conversation-1',
    senderPtid: 'ptid:alice',
    receiverPtid: 'ptid:bob',
    type: 1,
    content: 'original',
    status: 2,
    recalled: false,
    reactions: [],
    encryptedPayload: new Uint8Array(),
    attachments: [],
    ...overrides,
  };
}

function pendingOutcome(kind, extra = {}) {
  return trackChatMessageCommand({}, {
    conversationId: 'conversation-1',
    messageId: 'message-1',
    kind,
    submission: {
      commandId: `command-${kind}`,
      messageId: 'message-1',
      attachmentIds: [],
      state: 'pending',
    },
    ...extra,
  });
}

describe('Chat message command outcomes', () => {
  it.each([
    ['pending', 'pending'],
    ['retry_wait', 'uncertain'],
    ['submitted', 'uncertain'],
    ['failed', 'failed'],
    ['superseded', 'failed'],
  ])('maps Messaging Engine %s status to %s UI state', async (state, expected) => {
    const outcomes = pendingOutcome('recall');
    const refreshed = await refreshChatMessageCommandOutcomes(
      outcomes,
      [message()],
      'ptid:alice',
      vi.fn(async () => ({
        commandId: 'command-recall',
        conversationId: 'conversation-1',
        state,
        lastErrorCode: state === 'failed' ? 'authority_rejected' : '',
      })),
    );

    expect(refreshed['message-1']).toMatchObject({
      kind: 'recall',
      state: expected,
    });
    expect(isChatMessageCommandBusy(refreshed['message-1'])).toBe(
      expected !== 'failed',
    );
  });

  it('keeps a committed edit pending until the authoritative message projection arrives', async () => {
    const outcomes = pendingOutcome('edit', { expectedContent: 'edited' });
    const readStatus = vi.fn(async () => ({
      commandId: 'command-edit',
      conversationId: 'conversation-1',
      state: 'committed',
      lastErrorCode: '',
    }));

    await expect(refreshChatMessageCommandOutcomes(
      outcomes,
      [message()],
      'ptid:alice',
      readStatus,
    )).resolves.toMatchObject({
      'message-1': { kind: 'edit', state: 'pending' },
    });
    await expect(refreshChatMessageCommandOutcomes(
      outcomes,
      [message({ content: 'edited', editedAt: { seconds: 1n, nanos: 0 } })],
      'ptid:alice',
      readStatus,
    )).resolves.toEqual({});
  });

  it('clears reaction and pin outcomes only from authoritative projections', async () => {
    const reaction = pendingOutcome('reaction', {
      reaction: '👍',
      remove: false,
    });
    const pin = pendingOutcome('pin', { remove: false });
    const committed = vi.fn(async (commandId) => ({
      commandId,
      conversationId: 'conversation-1',
      state: 'committed',
      lastErrorCode: '',
    }));

    await expect(refreshChatMessageCommandOutcomes(
      reaction,
      [message({
        reactions: [{
          actorPtid: 'ptid:alice',
          reaction: '👍',
          createdAtUnixMs: 10,
        }],
      })],
      'ptid:alice',
      committed,
    )).resolves.toEqual({});
    await expect(refreshChatMessageCommandOutcomes(
      pin,
      [message({ pinnedByPtid: 'ptid:alice' })],
      'ptid:alice',
      committed,
    )).resolves.toEqual({});
  });

  it('clears hide and moderation outcomes only from their distinct projections', async () => {
    const committed = vi.fn(async (commandId) => ({
      commandId,
      conversationId: 'conversation-1',
      state: 'committed',
      lastErrorCode: '',
    }));

    await expect(refreshChatMessageCommandOutcomes(
      pendingOutcome('hideForActor'),
      [],
      'ptid:alice',
      committed,
    )).resolves.toEqual({});
    await expect(refreshChatMessageCommandOutcomes(
      pendingOutcome('moderate'),
      [message({
        moderated: true,
        moderationReasonCode: 'group_policy_violation',
      })],
      'ptid:alice',
      committed,
    )).resolves.toEqual({});
  });

  it('marks status read failure and mismatched binding as uncertain', async () => {
    const outcomes = pendingOutcome('recall');
    await expect(refreshChatMessageCommandOutcomes(
      outcomes,
      [message()],
      'ptid:alice',
      vi.fn(async () => {
        throw new Error('status unavailable');
      }),
    )).resolves.toMatchObject({
      'message-1': { state: 'uncertain' },
    });
    await expect(refreshChatMessageCommandOutcomes(
      outcomes,
      [message()],
      'ptid:alice',
      vi.fn(async () => ({
        commandId: 'different',
        conversationId: 'conversation-1',
        state: 'failed',
        lastErrorCode: '',
      })),
    )).resolves.toMatchObject({
      'message-1': { state: 'uncertain' },
    });
  });
});
