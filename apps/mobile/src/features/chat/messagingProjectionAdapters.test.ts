// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { describe, expect, it } from 'vitest';

import { FriendMessageStatus } from '../../gen/proto/domain/chat/friend_chat_pb';
import {
  friendMessageFromMessaging,
  friendSessionFromMessaging,
  groupFromMessaging,
  groupMessageFromMessaging,
  messageDeliveryDisplayState,
} from './messagingProjectionAdapters';

const directConversation = {
  conversationId: 'direct-1',
  authorityStationId: 'station-one',
  federationId: 'federation-1',
  kind: 1,
  name: '',
  ownerPtid: 'ptid:alice',
  memberPtids: ['ptid:alice', 'ptid:bob'],
  membershipEpoch: 1,
  mlsEpoch: 0,
  active: true,
  updatedAtUnixMs: 1_750_000_000_123,
};

const messageProjection = {
  messageId: 'message-1',
  senderPtid: 'ptid:alice',
  senderDeviceId: 'device-1',
  plaintext: 'hello',
  attachments: [],
  state: 'accepted',
  timestampUnixMs: 1_750_000_000_123,
  retracted: false,
  moderated: false,
  reactions: [],
  readByPtids: [],
};

describe('Messaging conversation projection adapters', () => {
  it('projects a Direct conversation around the active actor', () => {
    const session = friendSessionFromMessaging(
      directConversation,
      'ptid:alice',
    );

    expect(session).toMatchObject({
      ulid: 'direct-1',
      participantAPtid: 'ptid:alice',
      participantBPtid: 'ptid:bob',
      participantBDisplayName: 'ptid:bob',
    });
    expect(session.updatedAt).toEqual({
      seconds: 1_750_000_000,
      nanos: 123_000_000,
    });
  });

  it('preserves known Direct participant metadata', () => {
    const session = friendSessionFromMessaging(
      directConversation,
      'ptid:alice',
      {
        ulid: 'legacy-direct',
        participantAPtid: 'ptid:bob',
        participantBPtid: 'ptid:alice',
        lastMessageUlid: '',
        unreadCountA: 0,
        unreadCountB: 0,
        participantADisplayName: 'Bob',
        participantAAvatar: 'bob-avatar',
        participantBDisplayName: 'Alice',
        participantBAvatar: 'alice-avatar',
        participantAOnline: true,
        participantBOnline: false,
      },
    );

    expect(session.participantADisplayName).toBe('Alice');
    expect(session.participantAAvatar).toBe('alice-avatar');
    expect(session.participantBDisplayName).toBe('Bob');
    expect(session.participantBAvatar).toBe('bob-avatar');
    expect(session.participantBOnline).toBe(true);
  });

  it('projects canonical Group metadata and epochs', () => {
    const group = groupFromMessaging({
      ...directConversation,
      conversationId: 'group-1',
      kind: 2,
      name: 'Release',
      memberPtids: ['ptid:alice', 'ptid:bob', 'ptid:carol'],
      membershipEpoch: 4,
      mlsEpoch: 6,
    });

    expect(group).toMatchObject({
      ulid: 'group-1',
      name: 'Release',
      ownerPtid: 'ptid:alice',
      memberCount: 3,
      membershipEpoch: 4n,
    });
  });
});

describe('Messaging message projection adapters', () => {
  it('never projects a failed message as read even when stale receipts remain', () => {
    const failed = friendMessageFromMessaging('direct-1', {
      ...messageProjection,
      state: 'failed',
      readByPtids: ['ptid:bob'],
    });

    expect(failed.status).toBe(FriendMessageStatus.FAILED);
    expect(failed.messagingState).toBe('failed');
    expect(messageDeliveryDisplayState(failed)).toBe('failed');
  });

  it('projects retry-wait as sending rather than delivered or read', () => {
    const retrying = friendMessageFromMessaging('direct-1', {
      ...messageProjection,
      state: 'retry_wait',
      readByPtids: ['ptid:bob'],
    });

    expect(retrying.status).toBe(FriendMessageStatus.SENDING);
    expect(retrying.messagingState).toBe('retry_wait');
    expect(messageDeliveryDisplayState(retrying)).toBe('retrying');
  });

  it('preserves reply, thread, reaction, and pin metadata for friend and group views', () => {
    const projection = {
      ...messageProjection,
      replyToMessageId: 'message-parent',
      threadRootMessageId: 'message-root',
      reactions: [{
        actorPtid: 'ptid:bob',
        reaction: '👍',
        createdAtUnixMs: 1_750_000_000_456,
      }],
      pinnedByPtid: 'ptid:alice',
      pinnedAtUnixMs: 1_750_000_000_789,
    };

    const friend = friendMessageFromMessaging('direct-1', projection);
    const group = groupMessageFromMessaging('group-1', projection);

    for (const message of [friend, group]) {
      expect(message).toMatchObject({
        replyToUlid: 'message-parent',
        threadRootUlid: 'message-root',
        reactions: projection.reactions,
        pinnedByPtid: 'ptid:alice',
        pinnedAtUnixMs: 1_750_000_000_789,
      });
    }
  });

  it('preserves moderation readback without collapsing it into retract', () => {
    const projection = {
      ...messageProjection,
      plaintext: '',
      moderated: true,
      moderationReasonCode: 'group_policy_violation',
    };

    const friend = friendMessageFromMessaging('direct-1', projection);
    const group = groupMessageFromMessaging('group-1', projection);

    for (const message of [friend, group]) {
      expect(message).toMatchObject({
        recalled: false,
        moderated: true,
        moderationReasonCode: 'group_policy_violation',
      });
    }
  });
});
