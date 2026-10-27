import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../services/desktop_api';
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

  it.each(['friend', 'group'] as const)(
    'submits the loaded root sequence when the %s Thread has no replies',
    async (kind) => {
      const cursor = vi.spyOn(api, 'messagingReadCursor').mockResolvedValue({ submitted: true });
      vi.mocked(imServiceV1.messaging.listMessages).mockResolvedValue({
        messages: [
          { ...message('root'), eventSequence: 13 },
          { ...message('unrelated'), eventSequence: 99 },
        ],
        hasMore: false,
      });
      vi.mocked(imServiceV1.messaging.listThreadMessages).mockResolvedValue([]);
      await useSocialChatStore.getState().loadMessages('conversation', kind);
      await useSocialChatStore.getState().loadThreadMessages('conversation', 'root', kind);

      await useSocialChatStore.getState().markThreadRead('conversation', 'root', 'root', kind);

      expect(cursor).toHaveBeenCalledExactlyOnceWith('conversation', 13);
    },
  );

  it.each([
    { selected: 'reply', rootSequence: 13, replies: [17, 21], expected: 17 },
    { selected: 'missing', rootSequence: 13, replies: [17, 21], expected: 21 },
    { selected: 'root', rootSequence: 13, replies: [17, 21], expected: 13 },
    { selected: 'root', rootSequence: 0, replies: [17, 21], expected: 21 },
  ])('uses the authoritative sequence for $selected with root sequence $rootSequence',
    async ({ selected, rootSequence, replies, expected }) => {
      const cursor = vi.spyOn(api, 'messagingReadCursor').mockResolvedValue({ submitted: true });
      vi.mocked(imServiceV1.messaging.listMessages).mockResolvedValue({
        messages: [{ ...message('root'), eventSequence: rootSequence }],
        hasMore: false,
      });
      vi.mocked(imServiceV1.messaging.listThreadMessages).mockResolvedValue(
        replies.map((eventSequence, index) => ({
          ...message(index === 0 ? 'reply' : 'reply-later', 'root'), eventSequence,
        })),
      );
      await useSocialChatStore.getState().loadMessages('conversation', 'friend');
      await useSocialChatStore.getState().loadThreadMessages('conversation', 'root', 'friend');

      await useSocialChatStore.getState().markThreadRead('conversation', 'root', selected, 'friend');

      expect(cursor).toHaveBeenCalledExactlyOnceWith('conversation', expected);
    },
  );

  it.each([undefined, 0])(
    'does not submit a cursor when the root has no committed sequence (%s)',
    async (eventSequence) => {
      const cursor = vi.spyOn(api, 'messagingReadCursor').mockResolvedValue({ submitted: true });
      vi.mocked(imServiceV1.messaging.listMessages).mockResolvedValue({
        messages: [{ ...message('root'), eventSequence }],
        hasMore: false,
      });
      vi.mocked(imServiceV1.messaging.listThreadMessages).mockResolvedValue([]);
      await useSocialChatStore.getState().loadMessages('conversation', 'friend');
      await useSocialChatStore.getState().loadThreadMessages('conversation', 'root', 'friend');
      vi.mocked(imServiceV1.messaging.threadCounts).mockClear();

      await useSocialChatStore.getState().markThreadRead('conversation', 'root', 'root', 'friend');

      expect(cursor).not.toHaveBeenCalled();
      expect(imServiceV1.messaging.threadCounts).not.toHaveBeenCalled();
    },
  );

  it('preserves the Engine rejection for a committed reply read', async () => {
    const failure = new Error('authority rejected cursor');
    const cursor = vi.spyOn(api, 'messagingReadCursor').mockRejectedValue(failure);
    vi.mocked(imServiceV1.messaging.listThreadMessages).mockResolvedValue([
      { ...message('reply', 'root'), eventSequence: 17 },
    ]);
    await useSocialChatStore.getState().loadThreadMessages('conversation', 'root', 'friend');
    vi.mocked(imServiceV1.messaging.threadCounts).mockClear();

    await expect(useSocialChatStore.getState().markThreadRead(
      'conversation', 'root', 'reply', 'friend',
    )).rejects.toBe(failure);

    expect(cursor).toHaveBeenCalledExactlyOnceWith('conversation', 17);
    expect(imServiceV1.messaging.threadCounts).not.toHaveBeenCalled();
  });

  it.each(['friend', 'group'] as const)(
    'opening an empty %s Thread submits its loaded root sequence',
    async (kind) => {
      const cursor = vi.spyOn(api, 'messagingReadCursor').mockResolvedValue({ submitted: true });
      vi.mocked(imServiceV1.messaging.listMessages).mockResolvedValue({
        messages: [{ ...message('root'), eventSequence: 13 }],
        hasMore: false,
      });
      vi.mocked(imServiceV1.messaging.listThreadMessages).mockResolvedValue([]);
      await useSocialChatStore.getState().loadMessages('conversation', kind);
      useSocialChatStore.setState({
        activeTab: kind,
        activeSessionUlid: kind === 'friend' ? 'conversation' : null,
        activeGroupUlid: kind === 'group' ? 'conversation' : null,
      });

      useSocialChatStore.getState().openThread('root');

      await vi.waitFor(() => expect(cursor).toHaveBeenCalledExactlyOnceWith('conversation', 13));
      expect(useSocialChatStore.getState().openThreadRootUlid).toBe('root');
    },
  );
});
