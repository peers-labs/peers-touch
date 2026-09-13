import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installMessagingProjectionBridge,
  teardownMessagingProjectionBridge,
} from './messagingProjection';

type ProjectionHandler = (event: {
  payload: {
    conversationId: string;
    eventId: string;
    laneSequence: number;
  };
}) => void;

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  loadMessages: vi.fn(),
  loadSessions: vi.fn(),
  markFriendRead: vi.fn(),
  clearChatUnread: vi.fn(),
  bumpChatUnread: vi.fn(),
  chatSurfaceVisible: true,
  activeSessionUlid: 'direct-1',
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('../store/navigationBadges', () => ({
  useNavigationBadgeStore: {
    getState: () => ({
      chatSurfaceVisible: mocks.chatSurfaceVisible,
      clearChatUnread: mocks.clearChatUnread,
      bumpChatUnread: mocks.bumpChatUnread,
    }),
  },
}));

vi.mock('../store/socialChat', () => ({
  useSocialChatStore: {
    getState: () => ({
      currentUserPtid: 'ptid:self',
      activeSessionUlid: mocks.activeSessionUlid,
      activeGroupUlid: null,
      conversations: [{ conversationId: 'direct-1', kind: 1 }],
      messages: {},
      loadMessages: mocks.loadMessages,
      loadSessions: mocks.loadSessions,
      markFriendRead: mocks.markFriendRead,
    }),
  },
}));

describe('messaging projection read cursor', () => {
  let projectionHandler: ProjectionHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.chatSurfaceVisible = true;
    mocks.activeSessionUlid = 'direct-1';
    mocks.loadMessages.mockResolvedValue(undefined);
    mocks.loadSessions.mockResolvedValue(undefined);
    mocks.markFriendRead.mockResolvedValue(undefined);
    mocks.listen.mockImplementation(async (_eventName: string, handler: ProjectionHandler) => {
      projectionHandler = handler;
      return () => undefined;
    });
    teardownMessagingProjectionBridge();
    await installMessagingProjectionBridge();
  });

  afterEach(() => {
    teardownMessagingProjectionBridge();
  });

  it('advances the read cursor after refreshing the visible Direct conversation', async () => {
    projectionHandler({
      payload: {
        conversationId: 'direct-1',
        eventId: 'event-1',
        laneSequence: 1,
      },
    });

    await vi.waitFor(() => {
      expect(mocks.loadMessages).toHaveBeenCalledWith('direct-1', 'friend');
      expect(mocks.markFriendRead).toHaveBeenCalledWith('direct-1');
      expect(mocks.clearChatUnread).toHaveBeenCalledWith('direct-1');
    });
  });

  it('does not advance the read cursor while Chat is not visible', async () => {
    mocks.chatSurfaceVisible = false;

    projectionHandler({
      payload: {
        conversationId: 'direct-1',
        eventId: 'event-2',
        laneSequence: 2,
      },
    });

    await vi.waitFor(() => {
      expect(mocks.loadMessages).toHaveBeenCalledWith('direct-1', 'friend');
    });
    expect(mocks.markFriendRead).not.toHaveBeenCalled();
  });
});
