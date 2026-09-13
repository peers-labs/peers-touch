import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DesktopIMConversationProjection } from '../../store/socialProjection';
import {
  beginDirectConversationOpen,
  failDirectConversationOpen,
  findContactConversation,
  friendContactSelection,
  type ContactSelection,
} from './contactSelection';
import type { ChatActorIdentityProjection } from '../../store/friendshipProjection';

function identity(
  actorPtid: string,
  displayName: string,
): ChatActorIdentityProjection {
  return {
    actorPtid,
    username: displayName.toLowerCase(),
    displayName,
    avatarUrl: 'avatar',
    federatedHandle: `@${displayName.toLowerCase()}@station.example`,
    homeStationDomain: 'station.example',
    homeStationPeerId: 'station-peer',
    federationId: 'federation-1',
    federationName: 'Federation One',
  };
}

function conversation(
  id: string,
  kind: 'friend' | 'group',
  peerPtid?: string,
): DesktopIMConversationProjection {
  return {
    id,
    kind,
    peerPtid,
    title: id,
    avatar: '',
    lastActivityMs: 0,
    unread: 0,
    visibleUnread: 0,
    muted: false,
    alertEnabled: true,
    hidden: false,
    syncStatus: 'live',
  };
}

describe('findContactConversation', () => {
  const conversations = [
    conversation('dm-1', 'friend', 'ptid:alice'),
    conversation('group-1', 'group'),
  ];

  it('does not treat a peer PTID as a conversation ID', () => {
    const selection: ContactSelection = {
      kind: 'friend',
      peerPtid: 'ptid:bob',
      federationId: 'federation-1',
      federationName: 'Federation One',
      displayName: 'Bob',
      username: 'bob',
      federatedHandle: '@bob@station.example',
      homeStationDomain: 'station.example',
      homeStationPeerId: 'station-peer',
    };

    expect(findContactConversation(selection, conversations)).toBeUndefined();
  });

  it('resolves an accepted contact after its direct conversation exists', () => {
    const selection: ContactSelection = {
      kind: 'friend',
      peerPtid: 'ptid:alice',
      federationId: 'federation-1',
      federationName: 'Federation One',
      displayName: 'Alice',
      username: 'alice',
      federatedHandle: '@alice@station.example',
      homeStationDomain: 'station.example',
      homeStationPeerId: 'station-peer',
    };

    expect(findContactConversation(selection, conversations)?.id).toBe('dm-1');
  });

  it('resolves saved groups by conversation ID', () => {
    const selection: ContactSelection = {
      kind: 'group',
      conversationId: 'group-1',
      displayName: 'Group',
      memberCount: 2,
    };

    expect(findContactConversation(selection, conversations)?.id).toBe('group-1');
  });

  it('links an accepted request actor to an existing direct conversation', () => {
    expect(friendContactSelection(
      identity('ptid:alice', 'Alice'),
      conversations,
    )).toEqual({
      kind: 'friend',
      conversationId: 'dm-1',
      peerPtid: 'ptid:alice',
      federationId: 'federation-1',
      federationName: 'Federation One',
      displayName: 'Alice',
      avatar: 'avatar',
      username: 'alice',
      federatedHandle: '@alice@station.example',
      homeStationDomain: 'station.example',
      homeStationPeerId: 'station-peer',
    });
  });

  it('keeps an accepted request actor selectable before a DM exists', () => {
    expect(friendContactSelection(
      {
        ...identity('ptid:bob', 'Bob'),
        avatarUrl: '',
      },
      conversations,
    )).toEqual({
      kind: 'friend',
      peerPtid: 'ptid:bob',
      federationId: 'federation-1',
      federationName: 'Federation One',
      displayName: 'Bob',
      avatar: '',
      username: 'bob',
      federatedHandle: '@bob@station.example',
      homeStationDomain: 'station.example',
      homeStationPeerId: 'station-peer',
    });
  });

  it('keeps failed Direct-open intent bound to the selected peer', () => {
    const creating = beginDirectConversationOpen({
      kind: 'friend',
      peerPtid: 'ptid:bob',
      federationId: 'federation-1',
      federationName: 'Federation One',
      displayName: 'Bob',
      avatar: 'avatar',
      username: 'bob',
      federatedHandle: '@bob@station.example',
      homeStationDomain: 'station.example',
      homeStationPeerId: 'station-peer',
    });
    const failed = failDirectConversationOpen(creating, {
      code: 'chat.conversationActionFailed',
      title: 'Error',
      message: 'Conversation action failed',
      severity: 'error',
      recoverable: true,
    });

    expect(creating).toEqual({
      phase: 'creating',
      peerPtid: 'ptid:bob',
      federationId: 'federation-1',
      federationName: 'Federation One',
      displayName: 'Bob',
      avatar: 'avatar',
      username: 'bob',
      federatedHandle: '@bob@station.example',
      homeStationDomain: 'station.example',
      homeStationPeerId: 'station-peer',
    });
    expect(failed).toMatchObject({
      phase: 'failed',
      peerPtid: 'ptid:bob',
      federationId: 'federation-1',
      displayName: 'Bob',
      avatar: 'avatar',
      error: {
        code: 'chat.conversationActionFailed',
        recoverable: true,
      },
    });
  });
});

describe('contacts panel projection subscriptions', () => {
  const source = readFileSync(new URL('./ChatContactsPanel.tsx', import.meta.url), 'utf8');

  it('subscribes to unified Conversation and member projection changes', () => {
    expect(source).toContain('conversationRecords: s.conversations');
    expect(source).toContain('conversationMembers: s.conversationMembers');
    expect(source).toContain('groupMembers: s.groupMembers');
  });
});

describe('contact message routing', () => {
  const source = readFileSync(
    new URL('../../pages/SocialChatPage.tsx', import.meta.url),
    'utf8',
  );

  it('clears a stale conversation before rendering a new Direct-open intent', () => {
    const begin = source.indexOf('const intent = beginDirectConversationOpen(contact);');
    const clear = source.indexOf("selectSession('');", begin);
    const showChats = source.indexOf("setSubPage('chats');", begin);

    expect(begin).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(begin);
    expect(clear).toBeLessThan(showChats);
    expect(source).toContain('data-chat-active-peer-ptid={activePeerDid ??');
  });
});
