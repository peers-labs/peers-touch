import { create } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ConversationKind,
  ConversationMemberSchema,
  ConversationSchema,
  ConversationStatus,
  MemberRole,
  MemberStatus,
} from '../gen/proto/domain/chat/conversation_pb';
import { resolveMessageSearchTargets, useSocialChatStore } from './socialChat';
import { mergeConversationMessages, type SocialMessage } from './socialProjection';

describe('social chat conversation projection', () => {
  beforeEach(() => {
    useSocialChatStore.getState().reset();
    useSocialChatStore.setState({
      currentUserPtid: 'ptid:peer:alice',
      conversations: [
        create(ConversationSchema, {
          conversationId: 'direct-conversation',
          kind: ConversationKind.DIRECT,
          authorityStationPeerId: 'station-four',
          federationId: 'federation-chat',
          status: ConversationStatus.ACTIVE,
        }),
        create(ConversationSchema, {
          conversationId: 'group-conversation',
          kind: ConversationKind.GROUP,
          authorityStationPeerId: 'station-four',
          federationId: 'federation-chat',
          status: ConversationStatus.ACTIVE,
          name: 'Group',
        }),
      ],
      conversationMembers: {
        'direct-conversation': [
          create(ConversationMemberSchema, {
            conversationId: 'direct-conversation',
            ptid: 'ptid:peer:alice',
            role: MemberRole.MEMBER,
            memberStatus: MemberStatus.ACTIVE,
          }),
          create(ConversationMemberSchema, {
            conversationId: 'direct-conversation',
            ptid: 'ptid:peer:bob',
            role: MemberRole.MEMBER,
            memberStatus: MemberStatus.ACTIVE,
          }),
        ],
      },
    });
  });

  afterEach(() => {
    useSocialChatStore.getState().reset();
  });

  it('retains Conversation authority for Direct and Group UI projections', () => {
    const conversations = useSocialChatStore.getState().getIMConversations();

    expect(conversations).toHaveLength(2);
    expect(conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'direct-conversation',
        authorityStationId: 'station-four',
        federationId: 'federation-chat',
      }),
      expect.objectContaining({
        id: 'group-conversation',
        authorityStationId: 'station-four',
        federationId: 'federation-chat',
      }),
    ]));
  });

  it('derives message-search targets from canonical Conversation projections', () => {
    const conversations = useSocialChatStore.getState().conversations;

    expect(resolveMessageSearchTargets(
      conversations,
      'friend',
      'direct-conversation',
    )).toEqual([{
      conversationId: 'direct-conversation',
      scope: 'friend',
    }]);
    expect(resolveMessageSearchTargets(conversations)).toEqual([
      { conversationId: 'direct-conversation', scope: 'friend' },
      { conversationId: 'group-conversation', scope: 'group' },
    ]);
  });

  it('keeps an immediate background preview ephemeral and conversation-scoped', () => {
    const store = useSocialChatStore.getState();
    store.setConversationBackgroundPreview(
      'friend',
      'direct-conversation',
      'asset://localhost/background.png',
    );

    expect(useSocialChatStore.getState().conversationBackgroundPreviews).toEqual({
      'friend:direct-conversation': 'asset://localhost/background.png',
    });

    useSocialChatStore.getState().setConversationBackgroundPreview(
      'friend',
      'direct-conversation',
      null,
    );
    expect(useSocialChatStore.getState().conversationBackgroundPreviews).toEqual({});
  });

  it('keeps committed messages in authority sequence when timestamps reconcile', () => {
    const first = {
      ulid: '01-first',
      groupSeq: 1n,
      sentAt: timestampFromDate(new Date(2_000)),
    } as unknown as SocialMessage;
    const second = {
      ulid: '01-second',
      groupSeq: 2n,
      sentAt: timestampFromDate(new Date(1_000)),
    } as unknown as SocialMessage;

    const merged = mergeConversationMessages([second], first);
    expect(merged.map(message => message.ulid)).toEqual([
      '01-first',
      '01-second',
    ]);

    const reconciledFirst = {
      ...first,
      sentAt: timestampFromDate(new Date(3_000)),
    } as unknown as SocialMessage;
    expect(
      mergeConversationMessages(merged, reconciledFirst)
        .map(message => message.ulid),
    ).toEqual(['01-first', '01-second']);
  });

  it('preserves confirmed order when an unconfirmed message is merged', () => {
    const a = {
      ulid: '01-a',
      groupSeq: 3n,
      sentAt: timestampFromDate(new Date(100)),
    } as unknown as SocialMessage;
    const b = {
      ulid: '01-b',
      groupSeq: 4n,
      sentAt: timestampFromDate(new Date(90)),
    } as unknown as SocialMessage;
    const realtime = {
      ulid: '01-c',
      sentAt: timestampFromDate(new Date(95)),
    } as unknown as SocialMessage;

    const merged = mergeConversationMessages(
      mergeConversationMessages([a], b),
      realtime,
    );
    expect(merged.map(message => message.ulid)).toEqual([
      '01-a',
      '01-b',
      '01-c',
    ]);
  });
});
