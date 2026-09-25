import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchSearchMessages } from './chatCommands';
import { useSocialStore } from '../social/socialStore';
import type { MobileAuthSession } from '../auth/authSession';
import { messagingSearchMessages, type MessagingMessageProjection } from '../../services/mobileCommands';

vi.mock('../../services/mobileCommands', async (original) => ({
  ...await original<typeof import('../../services/mobileCommands')>(),
  messagingSearchMessages: vi.fn(),
}));

const session: MobileAuthSession = {
  stationPeerId: 'station', stationUrl: 'https://station.example',
  sessionId: 'session', actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

function row(index: number): MessagingMessageProjection {
  return {
    messageId: `message-${index}`, senderPtid: 'ptid:bob', senderDeviceId: 'device',
    plaintext: 'Indexed history', timestampUnixMs: 10000 - index,
    attachments: [], state: 'accepted', retracted: false, moderated: false,
    reactions: [], readByPtids: [],
  };
}

describe('Mobile indexed history search dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSocialStore.setState({ authSession: session });
  });

  it('reads the native index even when no message rows are mounted/projected', async () => {
    useSocialStore.setState({ messages: {} });
    vi.mocked(messagingSearchMessages).mockResolvedValue([row(0)]);
    const result = await dispatchSearchMessages(session, 'friend', 'conversation', 'Indexed');
    expect(messagingSearchMessages).toHaveBeenCalledWith({
      stationPeerId: 'station', actorPtid: 'ptid:alice',
      conversationId: 'conversation', query: 'Indexed', limit: 100,
    });
    expect(result.messages[0]).toMatchObject({ ulid: 'message-0', content: 'Indexed history' });
    expect(result.nextCursor).toBeNull();
    expect(useSocialStore.getState().messages).toEqual({});
  });

  it('continues using the last native timestamp and message ID, including ties', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => row(index));
    vi.mocked(messagingSearchMessages).mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    const first = await dispatchSearchMessages(session, 'group', 'conversation', 'Indexed');
    expect(first.nextCursor).toEqual({ beforeTimestampUnixMs: 9901, beforeMessageId: 'message-99' });
    expect(first.messages[0]).toMatchObject({ ulid: 'message-0' });
    await dispatchSearchMessages(session, 'group', 'conversation', 'Indexed', first.nextCursor!);
    expect(messagingSearchMessages).toHaveBeenLastCalledWith(expect.objectContaining(first.nextCursor));
  });

  it('rejects a repeated/non-advancing native cursor', async () => {
    vi.mocked(messagingSearchMessages).mockResolvedValue(Array.from({ length: 100 }, (_, index) => row(index)));
    await expect(dispatchSearchMessages(session, 'friend', 'conversation', 'Indexed', {
      beforeTimestampUnixMs: 9901, beforeMessageId: 'message-99',
    })).rejects.toThrow('mobile.chat.searchFailed');
  });

  it('rejects an old account before and after the native read', async () => {
    useSocialStore.setState({ authSession: null });
    await expect(dispatchSearchMessages(session, 'friend', 'conversation', 'Indexed'))
      .rejects.toThrow('mobile.social.notAuthenticated');
    expect(messagingSearchMessages).not.toHaveBeenCalled();
    useSocialStore.setState({ authSession: session });
    vi.mocked(messagingSearchMessages).mockImplementation(async () => {
      useSocialStore.setState({ authSession: { ...session } });
      return [row(0)];
    });
    await expect(dispatchSearchMessages(session, 'friend', 'conversation', 'Indexed'))
      .rejects.toThrow('mobile.social.notAuthenticated');
  });

  it('propagates native failures instead of returning false empty history', async () => {
    vi.mocked(messagingSearchMessages).mockRejectedValue(new Error('native-unavailable'));
    await expect(dispatchSearchMessages(session, 'friend', 'conversation', 'Indexed'))
      .rejects.toThrow('native-unavailable');
  });
});
