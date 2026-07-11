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
  loadGroups: vi.fn(),
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
      groups: [],
      conversationLocalState: {},
      messages: {},
      activeGroupUlid: 'group-1',
      selectGroup: mocks.selectGroup,
      loadGroups: mocks.loadGroups,
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
    mocks.loadGroups.mockResolvedValue(undefined);
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
