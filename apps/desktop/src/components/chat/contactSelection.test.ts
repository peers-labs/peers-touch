import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DesktopIMConversationProjection } from '../../store/socialProjection';
import {
  findContactConversation,
  friendContactSelection,
  type ContactSelection,
} from './contactSelection';

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
      displayName: 'Bob',
    };

    expect(findContactConversation(selection, conversations)).toBeUndefined();
  });

  it('resolves an accepted contact after its direct conversation exists', () => {
    const selection: ContactSelection = {
      kind: 'friend',
      peerPtid: 'ptid:alice',
      displayName: 'Alice',
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
      'ptid:alice',
      'Alice',
      'avatar',
      conversations,
    )).toEqual({
      kind: 'friend',
      conversationId: 'dm-1',
      peerPtid: 'ptid:alice',
      displayName: 'Alice',
      avatar: 'avatar',
    });
  });

  it('keeps an accepted request actor selectable before a DM exists', () => {
    expect(friendContactSelection(
      'ptid:bob',
      'Bob',
      undefined,
      conversations,
    )).toEqual({
      kind: 'friend',
      peerPtid: 'ptid:bob',
      displayName: 'Bob',
      avatar: undefined,
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
