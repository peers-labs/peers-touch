import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENT, eventBus } from '../kernel/events';
import {
  installSocialRealtimeBridge,
  refreshPeerPresence,
  refreshSocialProjection,
  teardownSocialRealtimeBridge,
} from './socialRealtime';

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
  selectGroup: vi.fn(),
  loadSessions: vi.fn(),
  loadGroups: vi.fn(),
  loadFriendRequests: vi.fn(),
  loadGroupUnreadCounts: vi.fn(),
  loadGroupMembers: vi.fn(),
  loadConversationPreviews: vi.fn(),
  loadMessages: vi.fn(),
  markFriendRead: vi.fn(),
  markGroupRead: vi.fn(),
  ingestRealtimeMessage: vi.fn(),
  loadMutualFriends: vi.fn(),
  resetMutualFriends: vi.fn(),
  bumpChatUnread: vi.fn(),
  clearChatUnread: vi.fn(),
  setPeerOnline: vi.fn(),
  clearPeerPresence: vi.fn(),
  presenceQuery: vi.fn(),
  loadCurrentUserProfile: vi.fn(),
  loadPeerProfile: vi.fn(),
  resolveActorStations: vi.fn(),
  currentActorPtid: null as string | null,
  activeTab: 'group' as 'friend' | 'group',
  activeSessionUlid: null as string | null,
  conversations: [] as Array<{
    conversationId: string;
    kind: number;
    federationId: string;
  }>,
  conversationMembers: {} as Record<string, Array<{ ptid: string }>>,
  peerProfiles: {} as Record<string, { username?: string }>,
}));

const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;

vi.mock('../store/session', () => ({
  currentAuthenticatedActorPtid: () => mocks.currentActorPtid,
  useSessionStore: {
    subscribe: vi.fn(() => () => undefined),
  },
}));

vi.mock('../store/relationships', () => ({
  useRelationshipsStore: {
    getState: () => ({
      loadMutualFriends: mocks.loadMutualFriends,
      resetMutualFriends: mocks.resetMutualFriends,
      mutualFriends: [],
    }),
  },
}));

vi.mock('../store/socialChat', () => ({
  useSocialChatStore: {
    getState: () => ({
      currentUserPtid: 'did:peer:self',
      currentUserProfile: null,
      conversations: mocks.conversations,
      conversationMembers: mocks.conversationMembers,
      sessions: [],
      groups: [],
      friendRequests: [],
      peerProfiles: mocks.peerProfiles,
      conversationLocalState: {},
      messages: {},
      activeSessionUlid: mocks.activeSessionUlid,
      activeGroupUlid: 'group-1',
      activeTab: mocks.activeTab,
      selectGroup: mocks.selectGroup,
      loadSessions: mocks.loadSessions,
      loadGroups: mocks.loadGroups,
      loadFriendRequests: mocks.loadFriendRequests,
      loadGroupUnreadCounts: mocks.loadGroupUnreadCounts,
      loadGroupMembers: mocks.loadGroupMembers,
      loadConversationPreviews: mocks.loadConversationPreviews,
      loadMessages: mocks.loadMessages,
      markFriendRead: mocks.markFriendRead,
      markGroupRead: mocks.markGroupRead,
      ingestRealtimeMessage: mocks.ingestRealtimeMessage,
      bumpChatUnread: mocks.bumpChatUnread,
      clearChatUnread: mocks.clearChatUnread,
      setPeerOnline: mocks.setPeerOnline,
      clearPeerPresence: mocks.clearPeerPresence,
      loadCurrentUserProfile: mocks.loadCurrentUserProfile,
      loadPeerProfile: mocks.loadPeerProfile,
      sweepTypingPeers: vi.fn(),
    }),
  },
}));

vi.mock('../store/federation', () => ({
  useFederationStore: {
    getState: () => ({
      resolveActorStations: mocks.resolveActorStations,
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
    getState: () => ({ mediaCallActive: false }),
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
    presenceQuery: mocks.presenceQuery,
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
    mocks.ingestRealtimeMessage.mockResolvedValue(undefined);
    mocks.loadMutualFriends.mockResolvedValue(undefined);
    mocks.loadSessions.mockResolvedValue(undefined);
    mocks.loadGroups.mockResolvedValue(undefined);
    mocks.loadFriendRequests.mockResolvedValue(undefined);
    mocks.loadGroupUnreadCounts.mockResolvedValue(undefined);
    mocks.loadGroupMembers.mockResolvedValue(undefined);
    mocks.loadConversationPreviews.mockResolvedValue(undefined);
    mocks.loadMessages.mockResolvedValue(undefined);
    mocks.markFriendRead.mockResolvedValue(undefined);
    mocks.markGroupRead.mockResolvedValue(undefined);
    mocks.presenceQuery.mockResolvedValue([]);
    mocks.loadCurrentUserProfile.mockResolvedValue(undefined);
    mocks.loadPeerProfile.mockResolvedValue(undefined);
    mocks.resolveActorStations.mockResolvedValue(undefined);
    mocks.currentActorPtid = null;
    mocks.activeTab = 'group';
    mocks.activeSessionUlid = null;
    mocks.conversations = [];
    mocks.conversationMembers = {};
    mocks.peerProfiles = {};
    teardownSocialRealtimeBridge();
    installSocialRealtimeBridge();
  });

  afterEach(() => {
    teardownSocialRealtimeBridge();
    (globalThis as any).window = originalWindow;
    (globalThis as any).CustomEvent = originalCustomEvent;
  });

  it('refreshes mutual friends after friendship acceptance', async () => {
    mocks.currentActorPtid = 'ptid:self';

    eventBus.publish(EVENT.REALTIME_SOCIAL_GRAPH_EVENT, {
      eventId: 'social-event-1',
      kind: 'friend_request_accepted',
      actorPtid: 'ptid:alice',
      targetPtid: 'ptid:self',
      requestId: 'request-1',
      conversationId: '',
      actorDisplayName: 'Alice',
    });

    await vi.waitFor(() => {
      expect(mocks.loadMutualFriends).toHaveBeenCalledWith('ptid:self', true);
    });
  });

  it('reconciles peer presence from the authoritative Station snapshot', async () => {
    mocks.presenceQuery.mockResolvedValue([
      { actorPtid: 'ptid:alice', online: true },
      { actorPtid: 'ptid:bob', online: false },
    ]);

    await refreshPeerPresence(['ptid:alice', 'ptid:bob', 'ptid:alice']);

    expect(mocks.presenceQuery).toHaveBeenCalledWith(['ptid:alice', 'ptid:bob']);
    expect(mocks.setPeerOnline).toHaveBeenCalledWith('ptid:alice', true);
    expect(mocks.setPeerOnline).toHaveBeenCalledWith('ptid:bob', false);
  });

  it('removes stale presence when the authoritative snapshot omits a peer', async () => {
    mocks.presenceQuery.mockResolvedValue([]);

    await refreshPeerPresence(['ptid:alice']);

    expect(mocks.clearPeerPresence).toHaveBeenCalledWith(['ptid:alice']);
  });

  it('hydrates peer profiles before resolving their Station identities', async () => {
    const profileLoaded = deferred<void>();
    mocks.currentActorPtid = 'ptid:self';
    mocks.conversations = [{
      conversationId: 'direct-1',
      kind: 1,
      federationId: 'federation-1',
    }];
    mocks.conversationMembers = {
      'direct-1': [{ ptid: 'ptid:bob' }],
    };
    mocks.loadPeerProfile.mockImplementation(async (ptid: string) => {
      await profileLoaded.promise;
      mocks.peerProfiles[ptid] = { username: 'bob' };
    });

    const refresh = refreshSocialProjection('test');
    await vi.waitFor(() => {
      expect(mocks.loadPeerProfile).toHaveBeenCalledWith('ptid:bob', true);
    });
    expect(mocks.resolveActorStations).not.toHaveBeenCalled();

    profileLoaded.resolve();
    await refresh;

    expect(mocks.resolveActorStations).toHaveBeenCalledWith([{
      actorPtid: 'ptid:bob',
      federationId: 'federation-1',
      username: 'bob',
    }]);
  });

  it('does not mutate Messaging-owned projections during social reconciliation', async () => {
    mocks.currentActorPtid = 'ptid:self';

    await refreshSocialProjection('ownership-test', true);

    expect(mocks.loadFriendRequests).toHaveBeenCalledOnce();
    expect(mocks.loadMutualFriends).toHaveBeenCalledWith('ptid:self', true);
    expect(mocks.loadSessions).not.toHaveBeenCalled();
    expect(mocks.loadGroups).not.toHaveBeenCalled();
    expect(mocks.loadMessages).not.toHaveBeenCalled();
    expect(mocks.loadGroupUnreadCounts).not.toHaveBeenCalled();
    expect(mocks.loadConversationPreviews).not.toHaveBeenCalled();
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
