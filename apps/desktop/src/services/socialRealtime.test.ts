import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENT, eventBus } from '../kernel/events';
import {
  installSocialRealtimeBridge,
  refreshSocialProjection,
  teardownSocialRealtimeBridge,
} from './socialRealtime';
import type { RealtimeGroupMembershipChangeKind } from '../kernel/events/types';

class TestWindow extends EventTarget {
  setInterval = globalThis.setInterval.bind(globalThis);
  clearInterval = globalThis.clearInterval.bind(globalThis);
  setTimeout = globalThis.setTimeout.bind(globalThis);
  clearTimeout = globalThis.clearTimeout.bind(globalThis);

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    super.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    super.removeEventListener(type, listener);
  }

  dispatchEvent(event: Event): boolean {
    return super.dispatchEvent(event);
  }
}

const mocks = vi.hoisted(() => ({
  authenticatedActorId: null as string | null,
  sessionSubscriber: null as (() => void) | null,
  selectGroup: vi.fn(),
  loadCurrentUserProfile: vi.fn(),
  loadSessions: vi.fn(),
  loadGroups: vi.fn(),
  loadFriendRequests: vi.fn(),
  loadGroupUnreadCounts: vi.fn(),
  loadGroupMembers: vi.fn(),
  loadConversationPreviews: vi.fn(),
  loadMessages: vi.fn(),
  markGroupRead: vi.fn(),
  ingestRealtimeMessage: vi.fn(),
  prewarmMessages: vi.fn(),
  bumpChatUnread: vi.fn(),
  clearChatUnread: vi.fn(),
}));

const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;

vi.mock('../store/session', () => ({
  currentAuthenticatedActorId: () => mocks.authenticatedActorId,
  useSessionStore: {
    subscribe: vi.fn((subscriber: () => void) => {
      mocks.sessionSubscriber = subscriber;
      return () => {
        mocks.sessionSubscriber = null;
      };
    }),
  },
}));

vi.mock('../store/socialChat', () => ({
  useSocialChatStore: {
    getState: () => ({
      currentUserDid: 'did:peer:self',
      activeTab: 'group',
      sessions: [],
      groups: [],
      conversationMembers: {},
      groupMembers: {},
      conversationLocalState: {},
      messages: {},
      activeGroupUlid: 'group-1',
      selectGroup: mocks.selectGroup,
      loadCurrentUserProfile: mocks.loadCurrentUserProfile,
      loadSessions: mocks.loadSessions,
      loadGroups: mocks.loadGroups,
      loadFriendRequests: mocks.loadFriendRequests,
      loadGroupUnreadCounts: mocks.loadGroupUnreadCounts,
      loadGroupMembers: mocks.loadGroupMembers,
      loadConversationPreviews: mocks.loadConversationPreviews,
      loadMessages: mocks.loadMessages,
      markGroupRead: mocks.markGroupRead,
      ingestRealtimeMessage: mocks.ingestRealtimeMessage,
      bumpChatUnread: mocks.bumpChatUnread,
      clearChatUnread: mocks.clearChatUnread,
      sweepTypingPeers: vi.fn(),
    }),
  },
}));

vi.mock('../store/notification', () => ({
  useNotificationStore: {
    getState: () => ({
      notifications: [],
      loadNotifications: vi.fn(),
      refreshUnreadCounts: vi.fn(),
    }),
    subscribe: vi.fn(() => () => undefined),
  },
}));

vi.mock('../store/navigationBadges', () => ({
  useNavigationBadgeStore: {
    getState: () => ({
      chatSurfaceVisible: true,
      reconcileChatBadge: vi.fn(),
      bumpChatUnread: mocks.bumpChatUnread,
      clearChatUnread: mocks.clearChatUnread,
    }),
  },
}));

vi.mock('./mediaRuntime', () => ({
  useMediaRuntimeStore: {
    getState: () => ({
      mediaCallActive: false,
      prewarmMessages: mocks.prewarmMessages,
    }),
  },
}));

vi.mock('./eventStream', () => ({
  installEventStreamBridge: vi.fn(),
  startEventStream: vi.fn(),
  stopEventStream: vi.fn(),
}));

vi.mock('./desktop_api', () => ({
  api: {
    accountGetDeviceId: vi.fn(() => Promise.resolve({ device_id: 'self-device-1' })),
  },
}));

describe('social realtime group membership side effects', () => {
  beforeEach(() => {
    (globalThis as any).window = new TestWindow();
    if (typeof globalThis.CustomEvent === 'undefined') {
      (globalThis as any).CustomEvent = class<T = unknown> extends Event {
        detail: T;

        constructor(type: string, init?: CustomEventInit<T>) {
          super(type);
          this.detail = init?.detail as T;
        }
      };
    }
    vi.clearAllMocks();
    mocks.authenticatedActorId = null;
    mocks.sessionSubscriber = null;
    mocks.ingestRealtimeMessage.mockResolvedValue(undefined);
    mocks.loadCurrentUserProfile.mockResolvedValue(undefined);
    mocks.loadSessions.mockResolvedValue(undefined);
    mocks.loadGroups.mockResolvedValue(undefined);
    mocks.loadFriendRequests.mockResolvedValue(undefined);
    mocks.loadGroupUnreadCounts.mockResolvedValue(undefined);
    mocks.loadGroupMembers.mockResolvedValue(undefined);
    mocks.loadConversationPreviews.mockResolvedValue(undefined);
    mocks.loadMessages.mockResolvedValue(undefined);
    mocks.markGroupRead.mockResolvedValue(undefined);
    teardownSocialRealtimeBridge();
    installSocialRealtimeBridge();
  });

  afterEach(() => {
    teardownSocialRealtimeBridge();
    (globalThis as any).window = originalWindow;
    (globalThis as any).CustomEvent = originalCustomEvent;
  });

  it('clears the active group when the local actor is removed', async () => {
    publishGroupMembership('REMOVED', 'did:peer:self');

    await vi.waitFor(() => {
      expect(mocks.selectGroup).toHaveBeenCalledWith('');
    });
  });

  it('clears the active group when the group is dissolved', async () => {
    publishGroupMembership('DISSOLVED', 'did:peer:self');

    await vi.waitFor(() => {
      expect(mocks.selectGroup).toHaveBeenCalledWith('');
    });
  });

  it('refreshes group projection after a follower federation event', async () => {
    eventBus.publish(EVENT.REALTIME_GROUP_FEDERATION_EVENT, {
      eventId: 'stream-event-1',
      groupUlid: 'group-1',
      groupEventUlid: 'group-event-2',
      seq: 2,
      eventType: 'group.proposal.accepted',
      authorityStationPeerId: 'station-a',
      authorityEpoch: 1,
      eventHash: 'hash-2',
      messageUlid: 'message-1',
      membershipEpoch: 1,
      committedTsUnixMs: 123,
      actorDid: 'did:peer:bob',
    });

    await vi.waitFor(() => {
      expect(mocks.loadMessages).toHaveBeenCalledWith('group-1', 'group');
      expect(mocks.markGroupRead).toHaveBeenCalled();
      expect(mocks.loadGroups).toHaveBeenCalled();
      expect(mocks.loadGroupUnreadCounts).toHaveBeenCalled();
      expect(mocks.loadConversationPreviews).toHaveBeenCalled();
    });
  });

  it('coalesces overlapping realtime resync requests into a serial cold resync lane', async () => {
    const firstColdResync = deferred<void>();
    mocks.loadSessions.mockImplementationOnce(() => firstColdResync.promise);

    eventBus.publish(EVENT.REALTIME_RESYNC, {
      newestEventId: '',
      reason: 'browser-dev-gateway-resync',
    });

    await vi.waitFor(() => {
      expect(mocks.loadSessions).toHaveBeenCalledTimes(1);
    });

    eventBus.publish(EVENT.REALTIME_RESYNC, {
      newestEventId: 'event-2',
      reason: 'browser-dev-gateway-resync',
    });
    eventBus.publish(EVENT.REALTIME_RESYNC, {
      newestEventId: 'event-3',
      reason: 'browser-dev-gateway-resync',
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.loadSessions).toHaveBeenCalledTimes(1);

    firstColdResync.resolve();

    await vi.waitFor(() => {
      expect(mocks.loadSessions).toHaveBeenCalledTimes(2);
    });
    expect(mocks.loadGroups).not.toHaveBeenCalled();
  });

  it('hydrates the actor profile before reconciling Station conversation settings', async () => {
    const calls: string[] = [];
    mocks.authenticatedActorId = 'ptid:peer:self';
    mocks.loadCurrentUserProfile.mockImplementation(async () => {
      calls.push('profile');
    });
    mocks.loadSessions.mockImplementation(async () => {
      calls.push('sessions');
    });

    await refreshSocialProjection('test');

    expect(calls).toEqual(['profile', 'sessions']);
  });

  it('coalesces authenticated bootstrap with an explicit projection refresh', async () => {
    const profileLoad = deferred<void>();
    mocks.authenticatedActorId = 'ptid:peer:self';
    mocks.loadCurrentUserProfile.mockImplementationOnce(() => profileLoad.promise);

    mocks.sessionSubscriber?.();
    const explicitRefresh = refreshSocialProjection('acceptance hydration', true);

    await vi.waitFor(() => {
      expect(mocks.loadCurrentUserProfile).toHaveBeenCalledTimes(1);
    });
    profileLoad.resolve();
    await explicitRefresh;

    expect(mocks.loadSessions).toHaveBeenCalledTimes(1);
    expect(mocks.prewarmMessages).toHaveBeenCalledTimes(1);
  });


  it('continues Station reconciliation when profile hydration fails', async () => {
    mocks.authenticatedActorId = 'ptid:peer:self';
    mocks.loadCurrentUserProfile.mockRejectedValue(new Error('profile unavailable'));

    await refreshSocialProjection('test');

    expect(mocks.loadSessions).toHaveBeenCalledOnce();
  });
});

function publishGroupMembership(kind: RealtimeGroupMembershipChangeKind, actorDid: string): void {
  eventBus.publish(EVENT.REALTIME_GROUP_MEMBERSHIP_CHANGE, {
    eventId: 'stream-event-1',
    changeEventId: 'membership-change-1',
    groupUlid: 'group-1',
    actorDid,
    kind,
    changedTsUnixMs: 123,
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
