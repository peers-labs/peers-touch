import { create, toBinary } from '@bufbuild/protobuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENT, eventBus } from '../kernel/events';
import {
  installSocialRealtimeBridge,
  teardownSocialRealtimeBridge,
} from './socialRealtime';
import type { RealtimeGroupMembershipChangeKind } from '../kernel/events/types';
import { FriendChatMessageSchema } from '../gen/proto/domain/chat/friend_chat_pb';

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
  rotateGroupSenderChain: vi.fn(),
  retrySkdmDistributionFor: vi.fn(),
  handleInboundSkdm: vi.fn(),
  selectGroup: vi.fn(),
  loadGroups: vi.fn(),
  loadGroupUnreadCounts: vi.fn(),
  loadGroupMembers: vi.fn(),
  ingestRealtimeMessage: vi.fn(),
  loadMessages: vi.fn(),
  bumpChatUnread: vi.fn(),
  clearChatUnread: vi.fn(),
  friendChatAckMessages: vi.fn(),
  friendChatSync: vi.fn(),
  groupChatSync: vi.fn(),
}));

const originalWindow = globalThis.window;
const originalCustomEvent = globalThis.CustomEvent;

vi.mock('../modules/identity/groupSenderKeys', () => ({
  FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION: 50,
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
      groups: [],
      conversationLocalState: {},
      messages: {},
      activeGroupUlid: 'group-1',
      selectGroup: mocks.selectGroup,
      loadGroups: mocks.loadGroups,
      loadGroupUnreadCounts: mocks.loadGroupUnreadCounts,
      loadGroupMembers: mocks.loadGroupMembers,
      ingestRealtimeMessage: mocks.ingestRealtimeMessage,
      loadMessages: mocks.loadMessages,
      markGroupRead: vi.fn(),
      loadConversationPreviews: vi.fn(),
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
      chatSurfaceVisible: false,
      reconcileChatBadge: vi.fn(),
      bumpChatUnread: mocks.bumpChatUnread,
      clearChatUnread: mocks.clearChatUnread,
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
    mocks.rotateGroupSenderChain.mockResolvedValue(undefined);
    mocks.handleInboundSkdm.mockResolvedValue(undefined);
    mocks.ingestRealtimeMessage.mockResolvedValue(undefined);
    mocks.friendChatAckMessages.mockResolvedValue(undefined);
    mocks.friendChatSync.mockResolvedValue(undefined);
    mocks.groupChatSync.mockResolvedValue(undefined);
    mocks.loadGroups.mockResolvedValue(undefined);
    mocks.loadGroupUnreadCounts.mockResolvedValue(undefined);
    mocks.loadGroupMembers.mockResolvedValue(undefined);
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
