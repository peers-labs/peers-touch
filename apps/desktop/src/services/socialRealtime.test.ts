import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENT, eventBus } from '../kernel/events';
import {
  installSocialRealtimeBridge,
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
  markGroupRead: vi.fn(),
  ingestRealtimeMessage: vi.fn(),
  bumpChatUnread: vi.fn(),
  clearChatUnread: vi.fn(),
  friendChatAckMessages: vi.fn(),
  friendChatSync: vi.fn(),
  groupChatSync: vi.fn(),
}));

const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;

vi.mock('../store/session', () => ({
  currentAuthenticatedActorId: () => null,
  useSessionStore: {
    subscribe: vi.fn(() => () => undefined),
  },
}));

vi.mock('../store/socialChat', () => ({
  useSocialChatStore: {
    getState: () => ({
      currentUserDid: 'did:peer:self',
      activeTab: 'group',
      sessions: [],
      groups: [],
      conversationLocalState: {},
      messages: {},
      activeGroupUlid: 'group-1',
      selectGroup: mocks.selectGroup,
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
      friendChatAckMessages: mocks.friendChatAckMessages,
      friendChatSync: mocks.friendChatSync,
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
    friendChatAckMessages: mocks.friendChatAckMessages,
    friendChatSync: mocks.friendChatSync,
    groupChatSync: mocks.groupChatSync,
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
    mocks.friendChatAckMessages.mockResolvedValue(undefined);
    mocks.friendChatSync.mockResolvedValue(undefined);
    mocks.groupChatSync.mockResolvedValue(undefined);
    mocks.loadSessions.mockResolvedValue(undefined);
    mocks.loadGroups.mockResolvedValue(undefined);
    mocks.loadFriendRequests.mockResolvedValue(undefined);
    mocks.loadGroupUnreadCounts.mockResolvedValue(undefined);
    mocks.loadGroupMembers.mockResolvedValue(undefined);
    mocks.loadConversationPreviews.mockResolvedValue(undefined);
    mocks.loadMessages.mockResolvedValue(undefined);
    mocks.markGroupRead.mockResolvedValue(undefined);
    mocks.groupChatSync.mockResolvedValue(undefined);
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
      expect(mocks.groupChatSync).toHaveBeenCalledWith('group-1', 50, 1);
      expect(mocks.loadMessages).toHaveBeenCalledWith('group-1', 'group');
      expect(mocks.markGroupRead).toHaveBeenCalled();
      expect(mocks.loadGroups).toHaveBeenCalled();
      expect(mocks.loadGroupUnreadCounts).toHaveBeenCalled();
      expect(mocks.loadConversationPreviews).toHaveBeenCalled();
    });
  });

  it('consumes realtime friend SKDM before ack badge or visible message ingest', async () => {
    const controlMessage = create(FriendChatMessageSchema, {
      ulid: 'skdm-msg-1',
      senderDid: 'did:peer:friend',
      receiverDid: 'did:peer:self',
      content: 'sender-key-payload',
      type: 50,
    });

    eventBus.publish(EVENT.REALTIME_MESSAGE_RECEIVED, {
      eventId: 'stream-event-skdm',
      sessionUlid: 'session-1',
      messageUlid: 'skdm-msg-1',
      senderActorId: 'did:peer:friend',
      recipientActorId: 'did:peer:self',
      ciphertext: toBinary(FriendChatMessageSchema, controlMessage),
      sentTsUnixMs: 123,
    });

    await vi.waitFor(() => {
      expect(mocks.handleInboundSkdm).toHaveBeenCalledWith('did:peer:friend', 'sender-key-payload');
    });
    expect(mocks.friendChatAckMessages).not.toHaveBeenCalled();
    expect(mocks.bumpChatUnread).not.toHaveBeenCalled();
    expect(mocks.clearChatUnread).not.toHaveBeenCalled();
    expect(mocks.ingestRealtimeMessage).not.toHaveBeenCalled();
    expect(mocks.friendChatSync).not.toHaveBeenCalled();
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
