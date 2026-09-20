import { create } from '@bufbuild/protobuf';
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
});
