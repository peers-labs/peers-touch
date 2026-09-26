import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installMessagingProjectionBridge,
  teardownMessagingProjectionBridge,
} from './messagingProjection';

type ProjectionHandler = (event: {
  payload: unknown;
}) => void;

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  loadMessages: vi.fn(),
  loadSessions: vi.fn(),
  markFriendRead: vi.fn(),
  clearChatUnread: vi.fn(),
  bumpChatUnread: vi.fn(),
  reconcile: vi.fn(),
  chatSurfaceVisible: true,
  activeSessionUlid: 'direct-1',
  scopeCurrent: true,
  invalidationMatches: true,
  scope: {
    actorPtid: 'ptid:self',
    stationPeerId: 'station-a',
    profileId: 'profile-a',
    endpointId: 'device-a',
    activationGeneration: 1,
  },
}));

vi.mock('../messaging/runtime', () => ({
  messagingDomainRuntime: {
    captureScope: () => mocks.scope,
    isCurrent: () => mocks.scopeCurrent,
    matchesInvalidation: () => mocks.invalidationMatches,
    reconcile: mocks.reconcile,
  },
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
    mocks.scopeCurrent = true;
    mocks.invalidationMatches = true;
    mocks.loadMessages.mockResolvedValue(undefined);
    mocks.loadSessions.mockResolvedValue(undefined);
    mocks.markFriendRead.mockResolvedValue(undefined);
    mocks.reconcile.mockResolvedValue(undefined);
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
        schemaVersion: 1,
        actorPtid: 'ptid:self',
        homeStationPeerId: 'station-a',
        deviceId: 'device-a',
        conversationId: 'direct-1',
        eventId: 'event-1',
        laneSequence: '1',
        kind: 'MESSAGING_PROJECTION_KIND_CONVERSATION',
      },
    });

    await vi.waitFor(() => {
      expect(mocks.loadSessions).toHaveBeenCalledOnce();
      expect(mocks.loadMessages).toHaveBeenCalledWith('direct-1', 'friend');
      expect(mocks.markFriendRead).toHaveBeenCalledWith('direct-1');
      expect(mocks.clearChatUnread).toHaveBeenCalledWith('direct-1');
    });
  });

  it('does not advance the read cursor while Chat is not visible', async () => {
    mocks.chatSurfaceVisible = false;

    projectionHandler({
      payload: {
        schemaVersion: 1,
        actorPtid: 'ptid:self',
        homeStationPeerId: 'station-a',
        deviceId: 'device-a',
        conversationId: 'direct-1',
        eventId: 'event-2',
        laneSequence: '2',
        kind: 'MESSAGING_PROJECTION_KIND_CONVERSATION',
      },
    });

    await vi.waitFor(() => {
      expect(mocks.loadSessions).toHaveBeenCalledOnce();
      expect(mocks.loadMessages).toHaveBeenCalledWith('direct-1', 'friend');
    });
    expect(mocks.markFriendRead).not.toHaveBeenCalled();
  });

  it('drops projection invalidation from a stale identity scope', async () => {
    mocks.invalidationMatches = false;

    projectionHandler({
      payload: {
        schemaVersion: 1,
        actorPtid: 'ptid:other',
        homeStationPeerId: 'station-b',
        deviceId: 'device-b',
        conversationId: 'direct-1',
        eventId: 'event-stale',
        laneSequence: '3',
        kind: 'MESSAGING_PROJECTION_KIND_CONVERSATION',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.loadMessages).not.toHaveBeenCalled();
    expect(mocks.loadSessions).not.toHaveBeenCalled();
  });

  it('reconciles the full projection when an invalidation lane has a gap', async () => {
    projectionHandler({
      payload: {
        schemaVersion: 1,
        actorPtid: 'ptid:self',
        homeStationPeerId: 'station-a',
        deviceId: 'device-a',
        conversationId: 'direct-1',
        eventId: 'event-1',
        laneSequence: '1',
        kind: 'MESSAGING_PROJECTION_KIND_CONVERSATION',
      },
    });
    await vi.waitFor(() => {
      expect(mocks.loadMessages).toHaveBeenCalled();
    });

    projectionHandler({
      payload: {
        schemaVersion: 1,
        actorPtid: 'ptid:self',
        homeStationPeerId: 'station-a',
        deviceId: 'device-a',
        conversationId: 'direct-1',
        eventId: 'event-3',
        laneSequence: '3',
        kind: 'MESSAGING_PROJECTION_KIND_MESSAGE',
      },
    });

    await vi.waitFor(() => {
      expect(mocks.reconcile).toHaveBeenCalledWith('projection-invalidation');
    });
  });

  it('fails closed to a full reconcile for an unknown kind in the active scope', async () => {
    projectionHandler({
      payload: {
        schemaVersion: 1,
        actorPtid: 'ptid:self',
        homeStationPeerId: 'station-a',
        deviceId: 'device-a',
        conversationId: 'direct-1',
        eventId: 'event-future',
        laneSequence: '1',
        kind: 'MESSAGING_PROJECTION_KIND_FUTURE',
      },
    });

    await vi.waitFor(() => {
      expect(mocks.reconcile).toHaveBeenCalledWith('projection-invalidation:decode');
    });
    expect(mocks.loadMessages).not.toHaveBeenCalled();
  });
});
