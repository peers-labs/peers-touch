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
    handleInboundSkdm: vi.fn(),
  rotateGroupSenderChain: vi.fn(),
  retrySkdmDistributionFor: vi.fn(),
  selectGroup: vi.fn(),
  loadGroups: vi.fn(),
  loadGroupUnreadCounts: vi.fn(),
  loadGroupMembers: vi.fn(),
  loadConversationPreviews: vi.fn(),
  loadMessages: vi.fn(),
  markGroupRead: vi.fn(),
  groupChatSync: vi.fn(),
}));

const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;

vi.mock('../modules/identity/groupSenderKeys', () => ({
  handleInboundSkdm: mocks.handleInboundSkdm,
  rotateGroupSenderChain: mocks.rotateGroupSenderChain,
  retrySkdmDistributionFor: mocks.retrySkdmDistributionFor,
}));

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
      activeGroupUlid: 'group-1',
      selectGroup: mocks.selectGroup,
      loadGroups: mocks.loadGroups,
      loadGroupUnreadCounts: mocks.loadGroupUnreadCounts,
      loadGroupMembers: mocks.loadGroupMembers,
      loadConversationPreviews: mocks.loadConversationPreviews,
      loadMessages: mocks.loadMessages,
      markGroupRead: mocks.markGroupRead,
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
    }),
  },
}));

vi.mock('./mediaRuntime', () => ({
  useMediaRuntimeStore: {
    getState: () => ({
      prewarmMessages: vi.fn(),
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
    friendChatSync: vi.fn(),
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
    mocks.rotateGroupSenderChain.mockResolvedValue(undefined);
    mocks.loadGroups.mockResolvedValue(undefined);
    mocks.loadGroupUnreadCounts.mockResolvedValue(undefined);
    mocks.loadGroupMembers.mockResolvedValue(undefined);
    mocks.loadConversationPreviews.mockResolvedValue(undefined);
    mocks.loadMessages.mockResolvedValue(undefined);
    mocks.markGroupRead.mockResolvedValue(undefined);
    mocks.groupChatSync.mockResolvedValue(undefined);
    mocks.handleInboundSkdm.mockResolvedValue(undefined);
    teardownSocialRealtimeBridge();
    installSocialRealtimeBridge();
  });

  afterEach(() => {
    teardownSocialRealtimeBridge();
    (globalThis as any).window = originalWindow;
    (globalThis as any).CustomEvent = originalCustomEvent;
  });

  it.each([
    ['REMOVED'],
    ['LEFT'],
    ['TRANSFERRED'],
  ] as const)('rotates sender keys after %s membership events', async (kind) => {
    publishGroupMembership(kind, 'did:peer:other');

    await vi.waitFor(() => {
      expect(mocks.rotateGroupSenderChain).toHaveBeenCalledWith('did:peer:self', 'group-1');
    });
  });

  it('installs delivered group SKDM envelopes only for the local device', async () => {
    eventBus.publish(EVENT.REALTIME_GROUP_SKDM_ENVELOPE_DELIVERED, {
      eventId: 'stream-event-1',
      groupUlid: 'group-1',
      membershipEpoch: 3,
      senderDid: 'did:peer:alice',
      senderKeyId: 7,
      recipientDid: 'did:peer:self',
      recipientDeviceId: 'self-device-1',
      idempotencyKey: 'skdm-1',
      encryptedPayloadB64: 'sealed',
      deliveredTsUnixMs: 123,
  });

    await vi.waitFor(() => {
      expect(mocks.handleInboundSkdm).toHaveBeenCalledWith('did:peer:alice', 'sealed', {
        groupUlid: 'group-1',
        senderKeyId: 7,
        recipientDeviceId: 'self-device-1',
      });
    });

    mocks.handleInboundSkdm.mockClear();
    eventBus.publish(EVENT.REALTIME_GROUP_SKDM_ENVELOPE_DELIVERED, {
      eventId: 'stream-event-2',
      groupUlid: 'group-1',
      membershipEpoch: 3,
      senderDid: 'did:peer:alice',
      senderKeyId: 7,
      recipientDid: 'did:peer:self',
      recipientDeviceId: 'other-device',
      idempotencyKey: 'skdm-2',
      encryptedPayloadB64: 'sealed-2',
      deliveredTsUnixMs: 124,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.handleInboundSkdm).not.toHaveBeenCalled();
  });

  it('does not rotate sender keys when the local actor was removed', async () => {
    publishGroupMembership('REMOVED', 'did:peer:self');

    await vi.waitFor(() => {
      expect(mocks.selectGroup).toHaveBeenCalledWith('');
    });
    expect(mocks.rotateGroupSenderChain).not.toHaveBeenCalled();
  });

  it('clears the active group when the group is dissolved', async () => {
    publishGroupMembership('DISSOLVED', 'did:peer:self');

    await vi.waitFor(() => {
      expect(mocks.selectGroup).toHaveBeenCalledWith('');
    });
    expect(mocks.rotateGroupSenderChain).not.toHaveBeenCalled();
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
      expect(mocks.markGroupRead).toHaveBeenCalledWith('group-1');
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
