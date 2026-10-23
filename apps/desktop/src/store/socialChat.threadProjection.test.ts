import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { imServiceV1 } from '../services/im-service';
import type { MessagingProjection } from '../services/im-service-contract';
import { useSessionStore } from './session';
import { useSocialChatStore } from './socialChat';

function message(messageId: string, threadRootMessageId?: string): MessagingProjection {
  return {
    messageId,
    senderPtid: 'ptid:peer:bob',
    senderDeviceId: 'bob-device',
    plaintext: messageId,
    timestampUnixMs: 1_760_500_000_000,
    state: 'delivered',
    attachments: [],
    readByPtids: [],
    reactions: [],
    retracted: false,
    threadRootMessageId,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe('social chat open Thread freshness', () => {
  beforeEach(() => {
    useSessionStore.setState({
      authenticated: true,
      currentUser: {
        actorPtid: 'ptid:peer:alice',
        name: 'Alice',
        email: 'alice@test',
        loginMethod: 'password',
      },
    });
    useSocialChatStore.getState().reset();
    vi.spyOn(imServiceV1.messaging, 'listMessages').mockResolvedValue({
      messages: [message('root')],
      hasMore: false,
    });
    vi.spyOn(imServiceV1.messaging, 'listServiceMessages').mockResolvedValue([]);
    vi.spyOn(imServiceV1.messaging, 'threadCounts').mockResolvedValue({
      counts: [{
        rootUlid: 'root',
        replyCount: 1,
        latestReplyUlid: 'reply',
        latestReplyAt: 1_760_500_000_000,
        unreadCount: 1,
      }],
    });
    vi.spyOn(imServiceV1.messaging, 'listThreadMessages').mockResolvedValue([
      message('root'),
      message('reply', 'root'),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSocialChatStore.getState().reset();
    useSessionStore.setState({ authenticated: false, currentUser: null });
  });

  it.each(['friend', 'group'] as const)(
    'refreshes the open %s Thread from the authoritative reply projection',
    async (kind) => {
      useSocialChatStore.setState({
        activeTab: kind,
        activeSessionUlid: kind === 'friend' ? 'conversation' : null,
        activeGroupUlid: kind === 'group' ? 'conversation' : null,
        openThreadRootUlid: 'root',
      });

      await useSocialChatStore.getState().loadMessages('conversation', kind);

      const state = useSocialChatStore.getState();
      expect(state.messages.conversation.map((value) => value.ulid)).toEqual(['root']);
      expect(state.threadMessages[`${kind}:conversation:root`].map((value) => value.ulid))
        .toEqual(['root', 'reply']);
      expect(state.threadCounts[`${kind}:conversation:root`].replyCount).toBe(1);
    },
  );

  it.each([
    { activeTab: 'friend' as const, activeSessionUlid: 'other', openThreadRootUlid: 'root' },
    { activeTab: 'group' as const, activeGroupUlid: 'conversation', openThreadRootUlid: 'root' },
    { activeTab: 'friend' as const, activeSessionUlid: 'conversation', openThreadRootUlid: null },
  ])('does not fetch a Thread outside the active conversation/kind', async (selection) => {
    useSocialChatStore.setState(selection);
    await useSocialChatStore.getState().loadMessages('conversation', 'friend');
    expect(imServiceV1.messaging.listThreadMessages).not.toHaveBeenCalled();
    expect(useSocialChatStore.getState().threadMessages).toEqual({});
  });

  it('does not repopulate messages after the Messaging scope resets during a read', async () => {
    const pending = deferred<Awaited<ReturnType<typeof imServiceV1.messaging.listMessages>>>();
    vi.mocked(imServiceV1.messaging.listMessages).mockReturnValueOnce(pending.promise);
    const loading = useSocialChatStore.getState().loadMessages('conversation', 'friend');

    useSocialChatStore.getState().resetMessagingProjection();
    pending.resolve({ messages: [message('root')], hasMore: false });
    await loading;

    expect(useSocialChatStore.getState().messages).toEqual({});
    expect(imServiceV1.messaging.listThreadMessages).not.toHaveBeenCalled();
  });

  it('does not repopulate Thread payloads after the same actor changes Messaging scope', async () => {
    const pending = deferred<MessagingProjection[]>();
    vi.mocked(imServiceV1.messaging.listThreadMessages).mockReturnValueOnce(pending.promise);
    const loading = useSocialChatStore.getState().loadThreadMessages('conversation', 'root', 'friend');

    useSocialChatStore.getState().resetMessagingProjection();
    pending.resolve([message('root'), message('reply', 'root')]);
    await loading;

    expect(useSocialChatStore.getState().threadMessages).toEqual({});
    expect(useSocialChatStore.getState().threadLoading).toEqual({});
    expect(useSocialChatStore.getState().threadCounts).toEqual({});
  });

  it('does not repopulate Thread counts after an actor reset', async () => {
    const pending = deferred<Awaited<ReturnType<typeof imServiceV1.messaging.threadCounts>>>();
    vi.mocked(imServiceV1.messaging.threadCounts).mockReturnValueOnce(pending.promise);
    const loading = useSocialChatStore.getState().refreshThreadCounts('conversation', ['root'], 'friend');

    useSocialChatStore.getState().reset();
    pending.resolve({ counts: [{
      rootUlid: 'root', replyCount: 1, latestReplyUlid: 'reply',
      latestReplyAt: 1_760_500_000_000, unreadCount: 1,
    }] });
    await loading;

    expect(useSocialChatStore.getState().threadCounts).toEqual({});
  });
});
