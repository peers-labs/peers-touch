import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  conversationPreferenceState,
  conversationTitle,
  conversationUnread,
  conversationUpdatedAt,
  selectConversationTypingPeers,
  type MobileConversation,
} from './chatSelectors';

describe('Chat typing snapshots', () => {
  it('reuses the empty snapshot across unselected and missing conversations', () => {
    const state = { typingPeers: {} };
    const empty = selectConversationTypingPeers(state, '');
    expect(selectConversationTypingPeers(state, '')).toBe(empty);
    expect(selectConversationTypingPeers(state, 'conversation-1')).toBe(empty);
    expect(selectConversationTypingPeers({ typingPeers: {} }, 'conversation-2')).toBe(empty);
  });

  it('preserves the selected conversation reference and observes its replacement', () => {
    const peers = { 'ptid:bob': { typing: true, lastUpdate: 10 } };
    const state = { typingPeers: { 'conversation-1': peers } };
    expect(selectConversationTypingPeers(state, 'conversation-1')).toBe(peers);
    const updated = { 'ptid:bob': { typing: false, lastUpdate: 20 } };
    expect(selectConversationTypingPeers({
      typingPeers: { 'conversation-1': updated },
    }, 'conversation-1')).toBe(updated);
  });

  it('uses the stable selector in Chat and leaves render retry to user intent', () => {
    const source = readFileSync(new URL('../../pages/ChatPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('return selectConversationTypingPeers(s, id)');
    const boundary = source.slice(source.indexOf('class ChatMountGuard'), source.indexOf('interface ChatPageProps'));
    expect(boundary).not.toContain('setTimeout');
    expect(boundary).not.toContain('return null');
    expect(boundary).toContain('this.props.fallback(this.retry)');
    expect(source).toContain('data-testid="chat-render-error" role="alert"');
    expect(source).toContain('onClick={retry}');
  });

  it('projects Group list metadata from the canonical Messaging conversation', () => {
    const conversation: MobileConversation = {
      kind: 'group',
      key: 'group:group-1',
      conversation: {
        projection: {
          conversationId: 'group-1',
          authorityStationId: 'station-a',
          federationId: 'federation-a',
          kind: 2,
          name: 'Design',
          description: '',
          ownerPtid: 'ptid:alice',
          memberPtids: ['ptid:alice', 'ptid:bob'],
          members: [],
          membershipEpoch: 2,
          mlsEpoch: 3,
          active: true,
          updatedAtUnixMs: 42,
        },
        unread: 4,
      },
    };

    expect(conversationTitle(conversation)).toBe('Design');
    expect(conversationUnread(conversation)).toBe(4);
    expect(conversationUpdatedAt(conversation)).toBe(42);
    expect(conversationPreferenceState(conversation, {}, {
      'group-1': {
        sessionUlid: 'group-1',
        isMuted: true,
        isPinned: true,
        alertEnabled: false,
        background: 'paper',
        clearedAt: 21,
      },
    })).toMatchObject({
      muted: true,
      sticky: true,
      alertEnabled: false,
      background: 'paper',
      clearedAt: 21,
    });
  });
});
