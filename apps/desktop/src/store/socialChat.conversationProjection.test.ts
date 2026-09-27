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
import type { SocialMessage } from './socialProjection';

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

  it('removes a durably hidden message from the cached projection', () => {
    const visible = {
      ulid: 'message-visible',
      senderPtid: 'ptid:peer:bob',
      content: 'visible',
      type: 1,
      attachments: [],
    } satisfies SocialMessage;
    const hidden = {
      ulid: 'message-hidden',
      senderPtid: 'ptid:peer:bob',
      content: 'hidden',
      type: 1,
      attachments: [],
    } satisfies SocialMessage;
    useSocialChatStore.setState({
      messages: {
        'direct-conversation': [visible, hidden],
      },
      lastPreviews: {
        'direct-conversation': {
          content: hidden.content,
          type: hidden.type,
          senderPtid: hidden.senderPtid,
        },
      },
      openThreadRootUlid: hidden.ulid,
    });

    useSocialChatStore.getState().applyMessageMutation(
      'direct-conversation',
      hidden.ulid,
      'DELETE',
      {
        newContent: '',
        newCiphertext: new Uint8Array(),
        mutatedTsUnixMs: 0,
      },
    );

    const state = useSocialChatStore.getState();
    expect(state.messages['direct-conversation']).toEqual([visible]);
    expect(state.lastPreviews['direct-conversation']).toEqual({
      content: visible.content,
      type: visible.type,
      senderPtid: visible.senderPtid,
    });
    expect(state.openThreadRootUlid).toBeNull();
  });
});
