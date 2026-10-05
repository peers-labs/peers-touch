import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';

import { EVENT, eventBus } from '../kernel/events';
import {
  FriendChatMessageSchema,
  FriendMessageType,
} from '../gen/proto/domain/chat/friend_chat_pb';
import {
  installSocialRealtimeBridge,
  refreshPeerPresence,
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
  resetRelationships: vi.fn(),
  bumpChatUnread: vi.fn(),
  clearChatUnread: vi.fn(),
  setPeerOnline: vi.fn(),
  clearPeerPresence: vi.fn(),
  presenceQuery: vi.fn(),
  presenceNotify: vi.fn(),
  loadCurrentUserProfile: vi.fn(),
  loadPeerProfile: vi.fn(),
  initEncryption: vi.fn(),
  prewarmMessages: vi.fn(),
  resolveActorStations: vi.fn(),
  startEventStream: vi.fn(),
  stopEventStream: vi.fn(),
  currentActorPtid: null as string | null,
  sessionEpoch: 1,
  sessionListener: undefined as (() => void) | undefined,
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
    getState: () => ({ sessionEpoch: mocks.sessionEpoch }),
    subscribe: vi.fn((listener: () => void) => {
      mocks.sessionListener = listener;
      return () => {
        mocks.sessionListener = undefined;
      };
    }),
  },
}));

vi.mock('../store/relationships', () => ({
  useRelationshipsStore: {
    getState: () => ({
      loadMutualFriends: mocks.loadMutualFriends,
      reset: mocks.resetRelationships,
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
      initEncryption: mocks.initEncryption,
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
    getState: () => ({
      mediaCallActive: false,
      prewarmMessages: mocks.prewarmMessages,
    }),
  },
}));

vi.mock('./eventStream', () => ({
  installEventStreamBridge: vi.fn(),
  startEventStream: mocks.startEventStream,
  stopEventStream: mocks.stopEventStream,
}));

vi.mock('./desktop_api', () => ({
  api: {
    accountGetDeviceId: vi.fn(() => Promise.resolve({ device_id: 'self-device-1' })),
    presenceNotify: mocks.presenceNotify,
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
    mocks.presenceNotify.mockResolvedValue({
      command: 'presence_notify',
      status: '{"accepted":true}',
    });
    mocks.loadCurrentUserProfile.mockResolvedValue(undefined);
    mocks.loadPeerProfile.mockResolvedValue(undefined);
    mocks.initEncryption.mockResolvedValue(undefined);
    mocks.resolveActorStations.mockResolvedValue(undefined);
    mocks.startEventStream.mockResolvedValue(undefined);
    mocks.stopEventStream.mockResolvedValue(undefined);
    mocks.currentActorPtid = null;
    mocks.sessionEpoch = 1;
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
      actorPtid: 'did:peer:bob',
    });

    await vi.waitFor(() => {
      expect(mocks.loadMessages).toHaveBeenCalledWith('group-1', 'group');
      expect(mocks.markGroupRead).toHaveBeenCalled();
      expect(mocks.loadGroups).toHaveBeenCalled();
      expect(mocks.loadGroupUnreadCounts).toHaveBeenCalled();
      expect(mocks.loadConversationPreviews).toHaveBeenCalled();
    });
  });

  it('advances the read cursor when a Direct message arrives in the visible conversation', async () => {
    mocks.activeTab = 'friend';
    mocks.activeSessionUlid = 'direct-1';

    eventBus.publish(EVENT.REALTIME_MESSAGE_RECEIVED, {
      eventId: 'stream-event-direct-1',
      sessionUlid: 'direct-1',
      messageUlid: 'message-direct-1',
      senderActorPtid: 'ptid:bob',
      recipientActorPtid: 'did:peer:self',
      ciphertext: toBinary(FriendChatMessageSchema, create(FriendChatMessageSchema, {
        ulid: 'message-direct-1',
        sessionUlid: 'direct-1',
        senderPtid: 'ptid:bob',
        receiverPtid: 'did:peer:self',
        type: FriendMessageType.TEXT,
        content: 'hello',
      })),
      sentTsUnixMs: 123,
    });

    await vi.waitFor(() => {
      expect(mocks.loadMessages).toHaveBeenCalledWith('direct-1', 'friend');
      expect(mocks.markFriendRead).toHaveBeenCalledWith('direct-1');
    });
  });

  it('does not advance the read cursor for an inactive Direct conversation', async () => {
    mocks.activeTab = 'friend';
    mocks.activeSessionUlid = 'direct-active';

    eventBus.publish(EVENT.REALTIME_MESSAGE_RECEIVED, {
      eventId: 'stream-event-direct-2',
      sessionUlid: 'direct-inactive',
      messageUlid: 'message-direct-2',
      senderActorPtid: 'ptid:bob',
      recipientActorPtid: 'did:peer:self',
      ciphertext: toBinary(FriendChatMessageSchema, create(FriendChatMessageSchema, {
        ulid: 'message-direct-2',
        sessionUlid: 'direct-inactive',
        senderPtid: 'ptid:bob',
        receiverPtid: 'did:peer:self',
        type: FriendMessageType.TEXT,
        content: 'hello',
      })),
      sentTsUnixMs: 124,
    });

    await vi.waitFor(() => {
      expect(mocks.loadConversationPreviews).toHaveBeenCalled();
    });
    expect(mocks.markFriendRead).not.toHaveBeenCalled();
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
    expect(mocks.loadGroups).toHaveBeenCalledTimes(2);
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
    expect(mocks.setPeerOnline).toHaveBeenCalledWith(
      'ptid:alice',
      true,
      expect.any(Number),
    );
    expect(mocks.setPeerOnline).toHaveBeenCalledWith(
      'ptid:bob',
      false,
      expect.any(Number),
    );
  });

  it('removes stale presence when the authoritative snapshot omits a peer', async () => {
    mocks.presenceQuery.mockResolvedValue([]);

    await refreshPeerPresence(['ptid:alice']);

    expect(mocks.clearPeerPresence).toHaveBeenCalledWith(
      ['ptid:alice'],
      expect.any(Number),
    );
  });

  it('orders a realtime presence event after an older in-flight snapshot', async () => {
    const snapshot = deferred<Array<{ actorPtid: string; online: boolean }>>();
    mocks.presenceQuery.mockReturnValueOnce(snapshot.promise);

    const refresh = refreshPeerPresence(['ptid:alice']);
    await vi.waitFor(() => {
      expect(mocks.presenceQuery).toHaveBeenCalledWith(['ptid:alice']);
    });

    eventBus.publish(EVENT.REALTIME_PRESENCE_FLIP, {
      actorPtid: 'ptid:alice',
      online: true,
    });
    snapshot.resolve([{ actorPtid: 'ptid:alice', online: false }]);
    await refresh;

    const eventCall = mocks.setPeerOnline.mock.calls.find((call) => call[1] === true);
    const snapshotCall = mocks.setPeerOnline.mock.calls.find((call) => call[1] === false);
    expect(eventCall?.[2]).toBeGreaterThan(snapshotCall?.[2]);
  });

  it('renews own presence and reconciles peers after realtime reconnect', async () => {
    mocks.currentActorPtid = 'ptid:self';
    mocks.conversationMembers = {
      'direct-1': [{ ptid: 'ptid:bob' }],
    };
    mocks.presenceQuery.mockResolvedValue([
      { actorPtid: 'ptid:bob', online: true },
    ]);

    eventBus.publish(EVENT.REALTIME_CONNECTION_STATE, {
      connected: true,
      reason: 'connected',
    });

    await vi.waitFor(() => {
      expect(mocks.presenceNotify).toHaveBeenCalledWith('heartbeat');
      expect(mocks.presenceQuery).toHaveBeenCalledWith(['ptid:bob']);
    });
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

  it('restarts the scoped stream after session renewal and Station switch', async () => {
    mocks.currentActorPtid = 'ptid:self';
    mocks.sessionListener?.();
    await vi.waitFor(() => {
      expect(mocks.startEventStream).toHaveBeenCalledWith(1);
    });

    mocks.sessionEpoch = 2;
    mocks.sessionListener?.();
    await vi.waitFor(() => {
      expect(mocks.stopEventStream).toHaveBeenCalledTimes(1);
      expect(mocks.startEventStream).toHaveBeenLastCalledWith(2);
    });

    eventBus.publish(EVENT.STATION_ACTIVE_CHANGED, {
      stationUrl: 'https://station-b.test',
    });
    await vi.waitFor(() => {
      expect(mocks.stopEventStream).toHaveBeenCalledTimes(2);
      expect(mocks.startEventStream).toHaveBeenCalledTimes(3);
      expect(mocks.startEventStream).toHaveBeenLastCalledWith(2);
    });
  });

  it('clears relationship candidates when the authenticated actor changes', async () => {
    mocks.currentActorPtid = 'ptid:alice';
    mocks.sessionListener?.();
    await vi.waitFor(() => {
      expect(mocks.loadMutualFriends).toHaveBeenCalledWith('ptid:alice', true);
    });
    const resetsBeforeSwitch = mocks.resetRelationships.mock.calls.length;

    mocks.currentActorPtid = 'ptid:bob';
    mocks.sessionListener?.();
    await vi.waitFor(() => {
      expect(mocks.resetRelationships).toHaveBeenCalledTimes(
        resetsBeforeSwitch + 1,
      );
      expect(mocks.loadMutualFriends).toHaveBeenCalledWith('ptid:bob', true);
    });
  });
});

function publishGroupMembership(kind: RealtimeGroupMembershipChangeKind, actorPtid: string): void {
  eventBus.publish(EVENT.REALTIME_GROUP_MEMBERSHIP_CHANGE, {
    eventId: 'stream-event-1',
    changeEventId: 'membership-change-1',
    groupUlid: 'group-1',
    actorPtid,
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
