import { create } from 'zustand';
import { clearChatUnreadForParticipant } from '@peers-touch/client-chat-core';
import type { DomainCacheRepository } from '@peers-touch/client-storage';

import type { MobileAuthSession } from '../auth/authSession';
import type { FederationSummary } from '../../gen/proto/domain/federation/federation_projection_service_pb';
import { mobileAuthScope, mobileAuthScopeKey } from '../auth/mobileAuthIdentity';
import {
  createMobileClientStorageRuntime,
  type MobileClientStorageRuntime,
} from '../../storage/mobileClientStorage';
import type {
  FriendConversationSettings,
  UpdateFriendConversationSettingsInput,
} from './socialApiTypes';
import {
  messagingConversationSummary,
  messagingCreateDirect,
  messagingCreateGroup,
  messagingDissolveConversation,
  messagingListConversations,
  messagingListMessages,
  messagingListThreadMessages,
  messagingMembershipTransition,
  messagingCommandStatus,
  messagingSendMessage,
  messagingSubmitEdit,
  messagingSubmitLeaveIntent,
  messagingSubmitMetadataInteraction,
  messagingSubmitReadCursor,
  messagingSubmitTyping,
  messagingTransferOwnership,
  messagingUpdateConversation,
  messagingUpdateMemberAuthority,
  type MessagingAttachmentStageProjection,
  type MessagingCreateGroupResult,
  type MessagingPendingCommandResult,
  type MessagingSubmitCommandResult,
} from '../../services/mobileCommands';
import {
  acknowledgeReliabilityProjection,
  listReliabilityCommands,
  readReliabilityRuntimeStatus,
} from '../../runtimes/commandRuntime';
import {
  createSocialGateway,
  createNotificationGateway,
  createProfileGateway,
  unwrapOutcome,
  type SocialGateway,
  type NotificationGateway,
  type ProfileGateway,
  type EditableProfileInput,
  type ProfileUpdateResult,
} from '../../services/gateways';
import type {
  FriendRequestMutationResult,
} from '../../services/gateways/socialGateway';
import {
  normalizeFriendRequest,
  normalizeNotification,
  normalizePeerProfile,
  normalizeSession,
  normalizeUnreadCounts,
} from './socialNormalizers';
import {
  applyPresenceToMap,
  applyTypingStateToMap,
  mergeNotifications,
  peerPtidFromSession,
  projectAcceptedContacts,
  projectConversations,
  projectOutgoingRequests,
  projectPendingInboundRequests,
  projectUnreadNotificationCount,
  projectUnreadNotifications,
  pruneTypingPeers,
} from './socialProjection';
import type { MessagingConversationProjection } from '../../services/mobileCommands';
import {
  refreshChatMessageCommandOutcomes,
  trackChatMessageCommand,
  type ChatMessageCommandOutcomes,
} from '../chat/messageCommandState';
import { projectMessagingMessage } from '../chat/messageProjection';
import {
  SocialApiError,
  readableErrorMessage,
  type SocialMessage,
  type FriendChatSession,
  type FriendRequest,
  type FriendshipStatus,
  type PeerProfile,
  type SocialConversation,
  type SocialNotification,
  type SocialTimestamp,
  type TypingEntry,
  type UnreadCounts,
  type ActorSearchResult,
} from './socialTypes';

const FEDERATED_HANDLE_RE = /^@?([a-zA-Z0-9._-]+)(?:@([a-zA-Z0-9.-]+(?::\d+)?))?$/;

interface ParsedHandle {
  isFederated: boolean;
  hasHost: boolean;
  canonical: string;
  localPart: string;
}

export interface SocialState {
  sessionKey: string | null;
  authSession: MobileAuthSession | null;
  currentUserPtid: string | null;
  socialGateway: SocialGateway | null;
  notificationGateway: NotificationGateway | null;
  profileGateway: ProfileGateway | null;
  storage: MobileClientStorageRuntime | null;
  sessions: FriendChatSession[];
  messagingConversations: MessagingConversationProjection[];
  conversationSummaries: Record<string, {
    lastMessage?: SocialMessage;
    unreadCount: number;
  }>;
  friendRequests: FriendRequest[];
  messages: Record<string, SocialMessage[]>;
  threadMessages: Record<string, SocialMessage[]>;
  messageCommandOutcomes: ChatMessageCommandOutcomes;
  conversationSettings: Record<string, FriendConversationSettings>;
  notifications: SocialNotification[];
  notificationNextCursor: string;
  notificationHasMore: boolean;
  unreadCounts: UnreadCounts;
  peerOnline: Record<string, boolean>;
  currentUserProfile: PeerProfile | null;
  peerProfiles: Record<string, PeerProfile | null>;
  peerProfileLoading: Record<string, boolean>;
  peerProfileErrors: Record<string, SocialApiError | null>;
  friendshipStatus: Record<string, FriendshipStatus>;
  blockedUsers: FriendshipStatus[];
  typingPeers: Record<string, Record<string, TypingEntry>>;
  peopleSearchResults: ActorSearchResult[];
  peopleSearchFederations: FederationSummary[];
  peopleSearchFederationsError: SocialApiError | null;
  peopleSearchLoading: boolean;
  peopleSearchError: SocialApiError | null;
  activeSessionUlid: string | null;
  loading: boolean;
  error: SocialApiError | null;
  lastReconcileAt: number | null;
  bindSession: (session: MobileAuthSession | null) => void;
  reconcile: () => Promise<void>;
  reconcileActiveSessionMessages: () => Promise<void>;
  refreshFriendRequests: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshBlockedUsers: () => Promise<void>;
  loadFriendshipStatus: (targetPtid: string) => Promise<void>;
  blockUser: (targetPtid: string) => Promise<void>;
  unblockUser: (targetPtid: string) => Promise<void>;
  refreshConversationSettings: () => Promise<void>;
  loadConversationSettings: (sessionUlid: string) => Promise<void>;
  updateConversationSettings: (sessionUlid: string, input: UpdateFriendConversationSettingsInput) => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markActiveSessionRead: (sessionUlid: string, upToUlid?: string) => Promise<void>;
  loadMoreNotifications: () => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  acceptFriendRequest: (requestId: string) => Promise<void>;
  rejectFriendRequest: (requestId: string) => Promise<void>;
  sendFriendRequest: (
    receiverPtid: string,
    receiverHomeStationPeerId: string,
    federationId: string,
    message?: string,
  ) => Promise<FriendRequestMutationResult['command']>;
  openDirectConversation: (peerPtid: string, federationId: string) => Promise<string>;
  createGroup: (input: {
    conversationId: string;
    name: string;
    description?: string;
    memberPtids: string[];
    federationId: string;
  }) => Promise<MessagingCreateGroupResult>;
  updateGroupConversation: (
    conversationId: string,
    input: { name?: string; description?: string },
  ) => Promise<void>;
  addGroupMember: (conversationId: string, targetPtid: string) => Promise<void>;
  removeGroupMember: (conversationId: string, targetPtid: string) => Promise<void>;
  updateGroupMemberAuthority: (
    conversationId: string,
    targetPtid: string,
    input: { role?: 'member' | 'admin'; muted?: boolean },
  ) => Promise<void>;
  transferGroupOwnership: (conversationId: string, nextOwnerPtid: string) => Promise<void>;
  leaveGroup: (conversationId: string) => Promise<void>;
  dissolveGroup: (conversationId: string) => Promise<void>;
  selectSession: (sessionUlid: string | null) => Promise<void>;
  loadMessages: (sessionUlid: string) => Promise<void>;
  loadThreadMessages: (sessionUlid: string, threadRootMessageUlid: string) => Promise<void>;
  refreshMessageCommandOutcomes: () => Promise<void>;
  drainProfileCacheWrites: () => Promise<void>;
  loadCurrentUserProfile: (force?: boolean) => Promise<void>;
  updateCurrentUserProfile: (input: EditableProfileInput) => Promise<ProfileUpdateResult>;
  loadPeerProfile: (peerPtid: string, force?: boolean) => Promise<void>;
  sendMessage: (
    sessionUlid: string,
    content: string,
    attachments?: MessagingAttachmentStageProjection[],
    context?: {
      replyToMessageId?: string;
      threadRootMessageId?: string;
    },
  ) => Promise<MessagingSubmitCommandResult | null>;
  editMessage: (
    sessionUlid: string,
    messageUlid: string,
    content: string,
  ) => Promise<MessagingPendingCommandResult>;
  recallMessage: (
    sessionUlid: string,
    messageUlid: string,
  ) => Promise<MessagingPendingCommandResult>;
  hideMessageForActor: (
    sessionUlid: string,
    messageUlid: string,
  ) => Promise<MessagingPendingCommandResult>;
  moderateMessage: (
    sessionUlid: string,
    messageUlid: string,
    reasonCode: string,
  ) => Promise<MessagingPendingCommandResult>;
  setMessageReaction: (
    sessionUlid: string,
    messageUlid: string,
    reaction: string,
    remove: boolean,
    threadRootMessageUlid?: string,
  ) => Promise<MessagingPendingCommandResult>;
  setMessagePinned: (
    sessionUlid: string,
    messageUlid: string,
    remove: boolean,
    threadRootMessageUlid?: string,
  ) => Promise<MessagingPendingCommandResult>;
  setPeerOnline: (ptid: string, online: boolean) => void;
  applyTypingState: (sessionUlid: string, fromActorPtid: string, typing: boolean) => void;
  sweepTypingPeers: (staleBefore: number) => void;
  sendTypingState: (sessionUlid: string, typing: boolean) => Promise<void>;
  searchPeople: (query: string) => Promise<void>;
  clearPeopleSearch: () => void;
  clearError: () => void;
}

const emptyUnreadCounts: UnreadCounts = { total: 0, byCategory: {} };
let peopleSearchRequest: object | null = null;
let friendRequestRefresh: object | null = null;
let sessionRefresh: object | null = null;
let socialReconcile: object | null = null;
let messagingScope = {};
const messageLoads = new Map<string, object>();
const summaryReads = new Map<string, object>();
const readCursors = new Map<string, object>();
const friendRequestSubmissions = new WeakMap<MobileAuthSession, Set<string>>();
const profileCacheWrites = new Set<Promise<void>>();
const profileCacheWriteTails = new WeakMap<
  DomainCacheRepository<unknown>,
  Map<string, Promise<void>>
>();

export const useSocialStore = create<SocialState>((set, get) => ({
  sessionKey: null,
  authSession: null,
  currentUserPtid: null,
  socialGateway: null,
  notificationGateway: null,
  profileGateway: null,
  storage: null,
  sessions: [],
  messagingConversations: [],
  conversationSummaries: {},
  friendRequests: [],
  messages: {},
  threadMessages: {},
  messageCommandOutcomes: {},
  conversationSettings: {},
  notifications: [],
  notificationNextCursor: '',
  notificationHasMore: false,
  unreadCounts: emptyUnreadCounts,
  peerOnline: {},
  currentUserProfile: null,
  peerProfiles: {},
  peerProfileLoading: {},
  peerProfileErrors: {},
  friendshipStatus: {},
  blockedUsers: [],
  typingPeers: {},
  peopleSearchResults: [],
  peopleSearchFederations: [],
  peopleSearchFederationsError: null,
  peopleSearchLoading: false,
  peopleSearchError: null,
  activeSessionUlid: null,
  loading: false,
  error: null,
  lastReconcileAt: null,

  bindSession: (session) => {
    if (session && get().sessionKey === mobileAuthScopeKey(session)) return;
    messagingScope = {};
    sessionRefresh = null;
    socialReconcile = null;
    messageLoads.clear();
    summaryReads.clear();
    readCursors.clear();
    if (!session) {
      set({
        sessionKey: null,
        authSession: null,
        currentUserPtid: null,
        socialGateway: null,
        notificationGateway: null,
        profileGateway: null,
        storage: null,
        sessions: [],
        messagingConversations: [],
        conversationSummaries: {},
        friendRequests: [],
        messages: {},
        threadMessages: {},
        messageCommandOutcomes: {},
        conversationSettings: {},
        notifications: [],
        notificationNextCursor: '',
        notificationHasMore: false,
        unreadCounts: emptyUnreadCounts,
        peerOnline: {},
        currentUserProfile: null,
        peerProfiles: {},
        peerProfileLoading: {},
        peerProfileErrors: {},
        friendshipStatus: {},
        blockedUsers: [],
        typingPeers: {},
        peopleSearchResults: [],
        peopleSearchFederations: [],
        peopleSearchFederationsError: null,
        peopleSearchLoading: false,
        peopleSearchError: null,
        activeSessionUlid: null,
        loading: false,
        error: null,
        lastReconcileAt: null,
      });
      return;
    }

    const sessionKey = mobileAuthScopeKey(session);
    const currentUserPtid = resolveActorPtid(session);

    set({
      sessionKey,
      authSession: session,
      currentUserPtid,
      socialGateway: createSocialGateway(session),
      notificationGateway: createNotificationGateway(session),
      profileGateway: createProfileGateway(session),
      storage: createMobileClientStorageRuntime(session),
      sessions: [],
      messagingConversations: [],
      conversationSummaries: {},
      friendRequests: [],
      messages: {},
      threadMessages: {},
      messageCommandOutcomes: {},
      conversationSettings: {},
      notifications: [],
      notificationNextCursor: '',
      notificationHasMore: false,
      unreadCounts: emptyUnreadCounts,
      peerOnline: {},
      currentUserProfile: null,
      peerProfiles: {},
      peerProfileLoading: {},
      peerProfileErrors: {},
      friendshipStatus: {},
      blockedUsers: [],
      typingPeers: {},
      peopleSearchResults: [],
      peopleSearchFederations: [],
      peopleSearchFederationsError: null,
      peopleSearchLoading: false,
      peopleSearchError: null,
      activeSessionUlid: null,
      loading: false,
      error: null,
      lastReconcileAt: null,
    });

    if (currentUserPtid) {
      void hydrateCurrentUserProfileFromCache(
        sessionKey,
        currentUserPtid,
        get,
        set,
      );
    }
  },

  reconcile: async () => {
    const scope = get().authSession;
    const request = {};
    socialReconcile = request;
    const isCurrent = () => socialReconcile === request && get().authSession === scope;
    const { refreshFriendRequests, refreshSessions, refreshBlockedUsers, refreshConversationSettings, refreshNotifications } = get();
    const coldStart = get().sessions.length === 0 && get().friendRequests.length === 0 && get().notifications.length === 0;
    set({ loading: coldStart, error: null });
    try {
      await Promise.all([refreshFriendRequests(), refreshSessions(), refreshBlockedUsers(), refreshNotifications()]);
      if (!isCurrent()) return;
      await refreshConversationSettings();
      if (!isCurrent()) return;
      await get().reconcileActiveSessionMessages();
      if (!isCurrent()) return;
      set({ lastReconcileAt: Date.now(), loading: false });
    } catch (error) {
      if (!isCurrent()) return;
      set({ error: normalizeError(error), loading: false });
    }
  },

  reconcileActiveSessionMessages: async () => {
    const sessionUlid = get().activeSessionUlid;
    if (!sessionUlid) return;
    await get().loadMessages(sessionUlid);
  },

  refreshFriendRequests: async () => {
    const scope = get().authSession;
    const refresh = {};
    friendRequestRefresh = refresh;
    const gw = requireSocialGateway(get());
    const isCurrent = () => friendRequestRefresh === refresh
      && get().authSession === scope
      && get().socialGateway === gw;
    const paginationError = () => new SocialApiError({
      method: 'GET',
      path: '/api/v1/social/friend-requests',
      message: 'mobile.contacts.requestFailed',
    });
    const requests = new Map<string, FriendRequest>();
    const limit = 50;
    let offset = 0;
    let total: number | undefined;
    try {
      while (isCurrent()) {
        const outcome = await gw.listFriendRequests(0, limit, offset);
        if (!isCurrent()) return;
        const result = unwrapOutcome(outcome);
        if (
          !Number.isSafeInteger(result.total)
          || result.total < 0
          || (total !== undefined && total !== result.total)
        ) {
          throw paginationError();
        }
        total = result.total;
        const previousCount = requests.size;
        for (const raw of result.requests) {
          const request = normalizeFriendRequest(raw);
          if (!request.requestId.trim()) throw paginationError();
          requests.set(request.requestId, request);
        }
        if (requests.size > total) throw paginationError();
        if (requests.size === total) break;
        if (requests.size === previousCount) throw paginationError();

        // Server pages may be shorter than requested or overlap prior IDs.
        offset += result.requests.length;
        if (!Number.isSafeInteger(offset)) throw paginationError();
      }
      if (!isCurrent()) return;
      set({ friendRequests: [...requests.values()] });
    } catch (error) {
      if (!isCurrent()) return;
      throw error;
    }
  },

  refreshSessions: async () => {
    const state = get();
    const scope = state.authSession;
    const refresh = {};
    sessionRefresh = refresh;
    const isCurrent = () => sessionRefresh === refresh && get().authSession === scope;
    const account = messagingAccount(state);
    const currentUserPtid = state.currentUserPtid;
    if (!currentUserPtid) return;

    try {
      const conversations = (await messagingListConversations(account))
        .filter((conversation) => conversation.active);
      if (!isCurrent()) return;
      const entries = await Promise.all(conversations.map(async (conversation) => {
        const request = {};
        const readCursor = readCursors.get(conversation.conversationId);
        summaryReads.set(conversation.conversationId, request);
        const summary = await messagingConversationSummary({
          ...account,
          conversationId: conversation.conversationId,
        });
        return { conversation, summary, request, readCursor };
      }));
      if (!isCurrent()) return;
      const conversationIds = new Set(conversations.map((conversation) => conversation.conversationId));
      for (const id of messageLoads.keys()) {
        if (!conversationIds.has(id)) messageLoads.delete(id);
      }
      set((current) => {
        const existing = new Map(current.sessions.map((session) => [session.ulid, session]));
        const conversationSummaries = Object.fromEntries(entries.map(({
          conversation,
          summary,
          request,
          readCursor,
        }) => {
          const previous = current.conversationSummaries[conversation.conversationId];
          if (summaryReads.get(conversation.conversationId) !== request) {
            return [conversation.conversationId, previous ?? {
              unreadCount: 0,
            }];
          }
          return [conversation.conversationId, {
            lastMessage: summary.lastMessage
              ? projectMessagingMessage(conversation.conversationId, summary.lastMessage)
              : undefined,
            unreadCount: current.activeSessionUlid === conversation.conversationId
              ? 0
              : readCursors.get(conversation.conversationId) === readCursor
                ? summary.unreadCount
                : previous?.unreadCount ?? 0,
          }];
        }));
        return {
          messagingConversations: conversations,
          conversationSummaries,
          sessions: entries
            .filter(({ conversation }) => conversation.kind === 1)
            .map(({ conversation, request }) => {
            const session = sessionFromMessaging(
              conversation, currentUserPtid, existing.get(conversation.conversationId),
            );
            // A later history read owns its preview even if this list finishes last.
            if (summaryReads.get(session.ulid) !== request) return session;
            const summary = conversationSummaries[session.ulid];
            const lastMessage = summary?.lastMessage;
            return {
              ...session,
              lastMessage,
              lastMessageUlid: lastMessage?.ulid ?? '',
              lastMessageAt: lastMessage?.sentAt ?? session.lastMessageAt,
              unreadCountA: summary?.unreadCount ?? session.unreadCountA,
            };
          }),
        };
      });
    } catch (error) {
      if (!isCurrent()) return;
      throw error;
    }
  },

  refreshBlockedUsers: async () => {
    const scope = get().authSession;
    const gw = requireSocialGateway(get());
    const blockedUsers = unwrapOutcome(await gw.listBlockedUsers());
    if (get().authSession !== scope) return;
    set((state) => {
      const nextStatus = { ...state.friendshipStatus };
      blockedUsers.forEach((item) => {
        if (item.targetPtid) nextStatus[item.targetPtid] = item;
      });
      return { blockedUsers, friendshipStatus: nextStatus };
    });
  },

  loadFriendshipStatus: async (targetPtid) => {
    const ptid = targetPtid.trim();
    if (!ptid) return;
    const gw = requireSocialGateway(get());
    try {
      const status = unwrapOutcome(await gw.getFriendshipStatus(ptid));
      set((state) => ({
        friendshipStatus: {
          ...state.friendshipStatus,
          [ptid]: { ...status, targetPtid: ptid },
        },
      }));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  blockUser: async (targetPtid) => {
    const ptid = targetPtid.trim();
    if (!ptid) return;
    const current = get();
    const gw = requireSocialGateway(current);
    try {
      const authoritative = unwrapOutcome(
        await gw.getFriendshipStatus(ptid),
      );
      const targetHomeStationPeerId =
        authoritative.targetHomeStationPeerId
        || relationshipTargetHomeStationPeerId(current, ptid);
      const result = unwrapOutcome(
        await gw.blockUser(
          ptid,
          targetHomeStationPeerId,
          authoritative.revision ?? 0,
        ),
      );
      if (result.relationship) {
        set((state) => ({
          friendshipStatus: {
            ...state.friendshipStatus,
            [ptid]: result.relationship!,
          },
          activeSessionUlid: state.sessions.some(
            (session) =>
              session.ulid === state.activeSessionUlid &&
              peerPtidFromSession(session, state.currentUserPtid) === ptid,
          )
            ? null
            : state.activeSessionUlid,
        }));
      }
      await Promise.allSettled([
        get().loadFriendshipStatus(ptid),
        get().refreshSessions(),
        get().refreshFriendRequests(),
        get().refreshBlockedUsers(),
      ]);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  unblockUser: async (targetPtid) => {
    const ptid = targetPtid.trim();
    if (!ptid) return;
    const current = get();
    const gw = requireSocialGateway(current);
    try {
      const authoritative = unwrapOutcome(
        await gw.getFriendshipStatus(ptid),
      );
      const targetHomeStationPeerId =
        authoritative.targetHomeStationPeerId
        || relationshipTargetHomeStationPeerId(current, ptid);
      const result = unwrapOutcome(
        await gw.unblockUser(
          ptid,
          targetHomeStationPeerId,
          authoritative.revision ?? 0,
        ),
      );
      if (result.relationship) {
        set((state) => ({
          friendshipStatus: {
            ...state.friendshipStatus,
            [ptid]: result.relationship!,
          },
        }));
      }
      await Promise.allSettled([
        get().loadFriendshipStatus(ptid),
        get().refreshSessions(),
        get().refreshFriendRequests(),
        get().refreshBlockedUsers(),
      ]);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  refreshConversationSettings: async () => {
    const scope = get().authSession;
    const gw = requireSocialGateway(get());
    const conversations = get().messagingConversations;
    const entries = await Promise.allSettled(conversations.map(async (conversation) => {
      const kind = conversation.kind === 2 ? 'group' : 'friend';
      const settings = unwrapOutcome(await gw.getConversationSettings(
        conversation.conversationId,
        kind,
      ));
      return [conversation.conversationId, settings] as const;
    }));
    if (get().authSession !== scope) return;
    set((state) => {
      const next = { ...state.conversationSettings };
      entries.forEach((entry) => {
        if (entry.status === 'fulfilled') next[entry.value[0]] = entry.value[1];
      });
      return { conversationSettings: next };
    });
  },

  loadConversationSettings: async (sessionUlid) => {
    const kind = conversationKind(get(), sessionUlid);
    const gw = requireSocialGateway(get());
    const settings = unwrapOutcome(await gw.getConversationSettings(sessionUlid, kind));
    set((state) => ({ conversationSettings: { ...state.conversationSettings, [sessionUlid]: settings } }));
  },

  updateConversationSettings: async (sessionUlid, input) => {
    const kind = conversationKind(get(), sessionUlid);
    const gw = requireSocialGateway(get());
    const settings = unwrapOutcome(await gw.updateConversationSettings(sessionUlid, input, kind));
    set((state) => ({ conversationSettings: { ...state.conversationSettings, [sessionUlid]: settings } }));
  },

  refreshNotifications: async () => {
    const scope = get().authSession;
    const notifGw = requireNotificationGateway(get());
    const [notificationResult, unreadResult] = await Promise.all([
      notifGw.listNotifications(),
      notifGw.getUnreadCounts(),
    ]);
    const notificationData = unwrapOutcome(notificationResult);
    const unreadCounts = unwrapOutcome(unreadResult);
    if (get().authSession !== scope) return;
    set({
      notifications: notificationData.notifications.map(normalizeNotification),
      notificationNextCursor: notificationData.nextCursor,
      notificationHasMore: Boolean(notificationData.nextCursor),
      unreadCounts: normalizeUnreadCounts(unreadCounts),
    });
  },

  markActiveSessionRead: async (sessionUlid, upToUlid) => {
    const state = get();
    const currentUserPtid = state.currentUserPtid;
    if (!currentUserPtid || state.activeSessionUlid !== sessionUlid) return;

    readCursors.set(sessionUlid, {});
    set((state) => ({
      sessions: clearSessionUnreadForActor(state.sessions, sessionUlid, currentUserPtid),
      conversationSummaries: state.conversationSummaries[sessionUlid]
        ? {
            ...state.conversationSummaries,
            [sessionUlid]: {
              ...state.conversationSummaries[sessionUlid],
              unreadCount: 0,
            },
          }
        : state.conversationSummaries,
    }));

    const messages = state.messages[sessionUlid] ?? [];
    const target = upToUlid
      ? messages.find((message) => message.ulid === upToUlid)
      : messages.at(-1);
    if (!target?.eventSequence || target.eventSequence <= 0) return;
    await messagingSubmitReadCursor({
      ...messagingAccount(state),
      admissionDomain: mutationDomainForConversation(state, sessionUlid),
      conversationId: sessionUlid,
      lastReadSequence: target.eventSequence,
    });
  },

  loadMoreNotifications: async () => {
    const notifGw = requireNotificationGateway(get());
    const { notificationHasMore, notificationNextCursor } = get();
    if (!notificationHasMore || !notificationNextCursor) return;

    set({ loading: true, error: null });
    try {
      const data = unwrapOutcome(await notifGw.listNotifications(30, notificationNextCursor));
      const incoming = data.notifications.map(normalizeNotification);
      set((state) => ({
        notifications: mergeNotifications(state.notifications, incoming),
        notificationNextCursor: data.nextCursor,
        notificationHasMore: Boolean(data.nextCursor),
        loading: false,
      }));
    } catch (error) {
      set({ error: normalizeError(error), loading: false });
    }
  },

  markNotificationRead: async (notificationId) => {
    const notifGw = requireNotificationGateway(get());
    unwrapOutcome(await notifGw.markNotificationsRead([notificationId]));
    await get().refreshNotifications();
  },

  markAllNotificationsRead: async () => {
    const notifGw = requireNotificationGateway(get());
    unwrapOutcome(await notifGw.markAllNotificationsRead());
    await get().refreshNotifications();
  },

  deleteNotification: async (notificationId) => {
    const notifGw = requireNotificationGateway(get());
    unwrapOutcome(await notifGw.deleteNotifications([notificationId]));
    await get().refreshNotifications();
  },

  acceptFriendRequest: async (requestId) => {
    const state = get();
    const gw = requireSocialGateway(state);
    const request = state.friendRequests.find((item) => requestKey(item) === requestId);
    try {
      if (
        !request
        || request.receiverPtid !== state.currentUserPtid
        || !request.federationId.trim()
        || !request.senderHomeStationPeerId.trim()
        || !request.receiverHomeStationPeerId.trim()
      ) {
        throw new SocialApiError({
          method: 'POST',
          path: '/api/v1/social/friend-request/accept',
          message: 'mobile.contacts.requestFailed',
        });
      }
      const payload = unwrapOutcome(await gw.acceptFriendRequest(request));
      if (get().authSession !== state.authSession) {
        throw new Error('mobile.social.notAuthenticated');
      }
      if (!payload.command.checkpointReady || !payload.request) {
        throw new Error('mobile.contacts.requestUnconfirmed');
      }
      set((state) => ({
        friendRequests: state.friendRequests.map((request) =>
          requestKey(request) === requestId
            ? payload.request!
            : request,
        ),
      }));
      await get().reconcile();
      if (payload.command.checkpointReady) {
        await acknowledgeReliabilityProjection(
          state.authSession!.stationPeerId,
          state.currentUserPtid!,
          payload.command.commandId,
          payload.command.payloadSha256,
        );
      }
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  rejectFriendRequest: async (requestId) => {
    const state = get();
    const gw = requireSocialGateway(state);
    const request = state.friendRequests.find((item) => requestKey(item) === requestId);
    try {
      if (
        !request
        || request.receiverPtid !== state.currentUserPtid
        || !request.federationId.trim()
        || !request.senderHomeStationPeerId.trim()
        || !request.receiverHomeStationPeerId.trim()
      ) {
        throw new SocialApiError({
          method: 'POST',
          path: '/api/v1/social/friend-request/reject',
          message: 'mobile.contacts.requestFailed',
        });
      }
      const payload = unwrapOutcome(await gw.rejectFriendRequest(request));
      if (get().authSession !== state.authSession) {
        throw new Error('mobile.social.notAuthenticated');
      }
      if (!payload.command.checkpointReady || !payload.request) {
        throw new Error('mobile.contacts.requestUnconfirmed');
      }
      set((state) => ({
        friendRequests: state.friendRequests.map((request) =>
          requestKey(request) === requestId
            ? payload.request!
            : request,
        ),
      }));
      await get().reconcile();
      if (payload.command.checkpointReady) {
        await acknowledgeReliabilityProjection(
          state.authSession!.stationPeerId,
          state.currentUserPtid!,
          payload.command.commandId,
          payload.command.payloadSha256,
        );
      }
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  sendFriendRequest: async (receiverPtid, receiverHomeStationPeerId, federationId, message) => {
    const state = get();
    const scope = requireAuthSession(state);
    const gw = requireSocialGateway(state);
    const submissionKey = JSON.stringify([receiverPtid, federationId]);
    const submissions = friendRequestSubmissions.get(scope) ?? new Set<string>();
    if (submissions.has(submissionKey)) {
      throw new Error('mobile.contacts.requestUnconfirmed');
    }
    submissions.add(submissionKey);
    friendRequestSubmissions.set(scope, submissions);
    try {
      if (!receiverHomeStationPeerId.trim() || !federationId.trim()) {
        throw new SocialApiError({
          method: 'POST',
          path: '/api/v1/social/friend-request/send',
          message: 'mobile.contacts.requestFailed',
        });
      }
      const reliability = await readReliabilityRuntimeStatus();
      if (
        get().authSession !== state.authSession
        || !reliability.active
        || !reliability.stationPeerId
        || !reliability.actorPtid
        || reliability.stationPeerId !== state.authSession?.stationPeerId
        || reliability.actorPtid !== state.currentUserPtid
      ) {
        throw new Error('mobile.social.notAuthenticated');
      }
      const commands = await listReliabilityCommands(
        reliability.stationPeerId,
        reliability.actorPtid,
        reliability.runtimeGeneration,
      );
      if (get().authSession !== state.authSession) {
        throw new Error('mobile.social.notAuthenticated');
      }
      const existingCommand = commands.some(({ envelope }) => {
        const body = envelope.payload.case === 'friendRequest'
          ? envelope.payload.value.body
          : undefined;
        return body?.federationId === federationId
          && body.sender?.ptid === state.currentUserPtid
          && body.receiver?.ptid === receiverPtid;
      });
      if (existingCommand) {
        throw new Error('mobile.contacts.requestUnconfirmed');
      }
      const payload = unwrapOutcome(await gw.sendFriendRequest(
        receiverPtid,
        receiverHomeStationPeerId,
        federationId,
        message,
      ));
      if (get().authSession !== state.authSession) {
        throw new Error('mobile.social.notAuthenticated');
      }
      await get().refreshFriendRequests();
      if (payload.command.checkpointReady) {
        await acknowledgeReliabilityProjection(
          state.authSession!.stationPeerId,
          state.currentUserPtid!,
          payload.command.commandId,
          payload.command.payloadSha256,
        );
      }
      return payload.command;
    } catch (error) {
      if (get().authSession === scope) set({ error: normalizeError(error) });
      throw error;
    } finally {
      submissions.delete(submissionKey);
    }
  },

  openDirectConversation: async (peerPtid, federationId) => {
    const state = get();
    const account = messagingAccount(state);
    const contact = projectAcceptedContacts(
      state.friendRequests,
      state.currentUserPtid,
      state.peerOnline,
    ).find((entry) => entry.peerPtid === peerPtid);
    if (!contact?.federationIds.includes(federationId)) {
      throw new Error('mobile.contacts.federationRequired');
    }
    const result = await messagingCreateDirect({ ...account, peerPtid, federationId });
    if (get().authSession !== state.authSession) {
      throw new Error('mobile.social.notAuthenticated');
    }
    if (!result.conversationId.trim()) {
      throw new Error('mobile.contacts.openChatFailed');
    }
    await get().refreshSessions();
    if (get().authSession !== state.authSession) {
      throw new Error('mobile.social.notAuthenticated');
    }
    if (!get().sessions.some((entry) => entry.ulid === result.conversationId)) {
      throw new Error('mobile.contacts.conversationPreparing');
    }
    return result.conversationId;
  },

  createGroup: async (input) => {
    const state = get();
    const result = await messagingCreateGroup({
      ...messagingAccount(state),
      conversationId: input.conversationId,
      name: input.name,
      memberPtids: input.memberPtids,
      federationId: input.federationId,
    });
    if (get().authSession !== state.authSession) {
      throw new Error('mobile.social.notAuthenticated');
    }
    if (result.state === 'failed') {
      throw new Error('mobile.group.operationCreateFailed');
    }
    await get().refreshSessions();
    if (
      input.description?.trim()
      && get().messagingConversations.some(
        (conversation) => conversation.conversationId === result.conversationId,
      )
    ) {
      await get().updateGroupConversation(result.conversationId, {
        description: input.description.trim(),
      });
    }
    return result;
  },

  updateGroupConversation: async (conversationId, input) => {
    const state = get();
    await messagingUpdateConversation({
      ...messagingAccount(state),
      conversationId,
      ...input,
    });
    if (get().authSession === state.authSession) {
      await get().refreshSessions();
    }
  },

  addGroupMember: async (conversationId, targetPtid) => {
    const state = get();
    await messagingMembershipTransition({
      ...messagingAccount(state),
      conversationId,
      action: 'add_actor',
      targetPtid,
      role: 'member',
    });
    if (get().authSession === state.authSession) {
      await get().refreshSessions();
    }
  },

  removeGroupMember: async (conversationId, targetPtid) => {
    const state = get();
    await messagingMembershipTransition({
      ...messagingAccount(state),
      conversationId,
      action: 'remove_actor',
      targetPtid,
    });
    if (get().authSession === state.authSession) {
      await get().refreshSessions();
    }
  },

  updateGroupMemberAuthority: async (conversationId, targetPtid, input) => {
    const state = get();
    const result = await messagingUpdateMemberAuthority({
      ...messagingAccount(state),
      conversationId,
      targetPtid,
      ...input,
    });
    if (get().authSession !== state.authSession) return;
    if (result.members) {
      set((current) => ({
        messagingConversations: current.messagingConversations.map(
          (conversation) => conversation.conversationId === conversationId
            ? {
                ...conversation,
                ownerPtid: result.ownerPtid ?? conversation.ownerPtid,
                memberPtids: result.members!.map((member) => member.ptid),
                members: result.members!,
                membershipEpoch: result.membershipEpoch ?? conversation.membershipEpoch,
                mlsEpoch: result.mlsEpoch ?? conversation.mlsEpoch,
              }
            : conversation,
        ),
      }));
    }
    await get().refreshSessions();
  },

  transferGroupOwnership: async (conversationId, nextOwnerPtid) => {
    const state = get();
    const result = await messagingTransferOwnership({
      ...messagingAccount(state),
      conversationId,
      nextOwnerPtid,
    });
    if (get().authSession !== state.authSession) return;
    if (result.members) {
      set((current) => ({
        messagingConversations: current.messagingConversations.map(
          (conversation) => conversation.conversationId === conversationId
            ? {
                ...conversation,
                ownerPtid: result.ownerPtid ?? nextOwnerPtid,
                memberPtids: result.members!.map((member) => member.ptid),
                members: result.members!,
                membershipEpoch: result.membershipEpoch ?? conversation.membershipEpoch,
                mlsEpoch: result.mlsEpoch ?? conversation.mlsEpoch,
              }
            : conversation,
        ),
      }));
    }
    await get().refreshSessions();
  },

  leaveGroup: async (conversationId) => {
    const state = get();
    await messagingSubmitLeaveIntent({
      ...messagingAccount(state),
      conversationId,
    });
    if (get().authSession === state.authSession) {
      await get().refreshSessions();
    }
  },

  dissolveGroup: async (conversationId) => {
    const state = get();
    await messagingDissolveConversation({
      ...messagingAccount(state),
      conversationId,
    });
    if (get().authSession === state.authSession) {
      await get().refreshSessions();
    }
  },

  selectSession: async (sessionUlid) => {
    set({ activeSessionUlid: sessionUlid });
    if (sessionUlid) {
      await Promise.allSettled([
        get().loadMessages(sessionUlid),
        get().loadConversationSettings(sessionUlid),
      ]);
    }
  },

  loadMessages: async (sessionUlid) => {
    const state = get();
    const scope = state.authSession;
    const generation = messagingScope;
    const request = {};
    const readCursor = readCursors.get(sessionUlid);
    messageLoads.set(sessionUlid, request);
    summaryReads.set(sessionUlid, request);
    const isCurrent = () => get().authSession === scope
      && messagingScope === generation && messageLoads.get(sessionUlid) === request;
    try {
      const projections = await messagingListMessages({
        ...messagingAccount(state),
        conversationId: sessionUlid,
      });
      if (!isCurrent()) return;
      const messages = projections.map((message) => projectMessagingMessage(sessionUlid, message));
      const messageCommandOutcomes = await refreshChatMessageCommandOutcomes(
        get().messageCommandOutcomes,
        messages,
        state.currentUserPtid ?? '',
        (commandId) => messagingCommandStatus({
          ...messagingAccount(state),
          commandId,
        }),
      );
      if (!isCurrent()) return;
      const lastMessage = messages.at(-1);
      const unread = projections.filter((message) =>
        message.senderPtid !== state.currentUserPtid
        && !message.readByPtids.includes(state.currentUserPtid ?? '')
        && !message.retracted,
      ).length;
      set((state) => ({
        messages: { ...state.messages, [sessionUlid]: messages },
        messageCommandOutcomes,
        conversationSummaries: summaryReads.get(sessionUlid) === request
          ? {
              ...state.conversationSummaries,
              [sessionUlid]: {
                lastMessage,
                unreadCount: state.activeSessionUlid === sessionUlid
                  ? 0
                  : readCursors.get(sessionUlid) === readCursor
                    ? unread
                    : state.conversationSummaries[sessionUlid]?.unreadCount ?? 0,
              },
            }
          : state.conversationSummaries,
        sessions: summaryReads.get(sessionUlid) === request
          ? state.sessions.map((session) => session.ulid === sessionUlid ? {
            ...session,
            lastMessage,
            lastMessageUlid: lastMessage?.ulid ?? '',
            lastMessageAt: lastMessage?.sentAt ?? session.lastMessageAt,
            unreadCountA: state.activeSessionUlid === sessionUlid ? 0
              : readCursors.get(sessionUlid) === readCursor ? unread : session.unreadCountA,
          } : session)
          : state.sessions,
      }));
      const lastReadUlid = messages.at(-1)?.ulid;
      if (lastReadUlid) {
        await get().markActiveSessionRead(sessionUlid, lastReadUlid);
      }
    } catch (error) {
      if (!isCurrent()) return;
      set({ error: normalizeError(error) });
      throw error;
    } finally {
      if (messageLoads.get(sessionUlid) === request) messageLoads.delete(sessionUlid);
    }
  },

  loadThreadMessages: async (sessionUlid, threadRootMessageUlid) => {
    const state = get();
    const scope = state.authSession;
    try {
      const messages = (
        await messagingListThreadMessages({
          ...messagingAccount(state),
          conversationId: sessionUlid,
          threadRootMessageId: threadRootMessageUlid,
        })
      ).map((message) => projectMessagingMessage(sessionUlid, message));
      const messageCommandOutcomes = await refreshChatMessageCommandOutcomes(
        get().messageCommandOutcomes,
        [
          ...(get().messages[sessionUlid] ?? []),
          ...messages,
        ],
        state.currentUserPtid ?? '',
        (commandId) => messagingCommandStatus({
          ...messagingAccount(state),
          commandId,
        }),
      );
      if (get().authSession !== scope) return;
      set((state) => ({
        threadMessages: {
          ...state.threadMessages,
          [threadRootMessageUlid]: messages,
        },
        messageCommandOutcomes,
      }));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  refreshMessageCommandOutcomes: async () => {
    const state = get();
    const scope = state.authSession;
    const messages = Object.values(state.messages).flat();
    const threadMessages = Object.values(state.threadMessages).flat();
    const messageCommandOutcomes = await refreshChatMessageCommandOutcomes(
      state.messageCommandOutcomes,
      [...messages, ...threadMessages],
      state.currentUserPtid ?? '',
      (commandId) => messagingCommandStatus({
        ...messagingAccount(state),
        commandId,
      }),
    );
    if (get().authSession !== scope) return;
    set({ messageCommandOutcomes });
  },

  drainProfileCacheWrites: async () => {
    while (profileCacheWrites.size > 0) {
      await Promise.all([...profileCacheWrites]);
    }
  },

  loadCurrentUserProfile: async (force = false) => {
    const state = get();
    const ptid = state.currentUserPtid?.trim() ?? '';
    if (!ptid) return;
    if (!force && state.currentUserProfile) return;
    const owner = captureProfileOperationOwner(state);
    const isCurrent = () => isCurrentProfileOperation(get, owner);

    const repository = owner.storage?.repositories.peerProfiles;
    if (!force && repository) {
      const cached = await readCachedPeerProfile(repository, ptid).catch((error) => {
        if (!isCurrent()) return null;
        throw error;
      });
      if (!isCurrent()) return;
      if (cached?.profile) {
        set((prev) => ({
          currentUserProfile: cached.profile,
          peerProfiles: { ...prev.peerProfiles, [ptid]: cached.profile },
        }));
        if (!cached.stale) return;
      }
    }

    const profileGw = requireProfileGateway(state);
    try {
      const profile = unwrapOutcome(await profileGw.getPeerProfile(ptid));
      if (!isCurrent()) return;
      await persistProfileCache(repository, ptid, profile, isCurrent);
      if (!isCurrent()) return;
      set((prev) => ({
        currentUserProfile: profile,
        peerProfiles: { ...prev.peerProfiles, [ptid]: profile },
      }));
    } catch (error) {
      if (!isCurrent()) return;
      set({ error: normalizeError(error) });
    }
  },

  updateCurrentUserProfile: async (input) => {
    const state = get();
    const ptid = state.currentUserPtid?.trim() ?? '';
    if (!ptid) {
      throw new SocialApiError({
        method: 'POST',
        path: '/actor/profile',
        message: 'mobile.auth.missingIdentityScope',
      });
    }
    const observedRevision = state.currentUserProfile?.profileRevision ?? 0n;
    if (observedRevision === 0n) {
      throw new SocialApiError({
        method: 'POST',
        path: '/actor/profile',
        code: 'PROFILE_REVISION_UNAVAILABLE',
        message: 'mobile.settings.profileUnavailable',
      });
    }
    const owner = captureProfileOperationOwner(state);
    const isCurrent = () => isCurrentProfileOperation(get, owner);

    try {
      const result = unwrapOutcome(
        await requireProfileGateway(state).updateCurrentProfile(
          input,
          observedRevision,
        ),
      );
      const profile = result.profile;
      if (!isCurrent()) throw staleProfileOperationError('POST', '/actor/profile');
      await persistProfileCache(
        owner.storage?.repositories.peerProfiles,
        ptid,
        profile,
        isCurrent,
      );
      if (!isCurrent()) throw staleProfileOperationError('POST', '/actor/profile');
      set((current) => ({
        currentUserProfile: profile,
        peerProfiles: {
          ...current.peerProfiles,
          [ptid]: profile,
        },
        error: null,
      }));
      return result;
    } catch (error) {
      if (!isCurrent()) throw staleProfileOperationError('POST', '/actor/profile');
      throw error;
    }
  },

  loadPeerProfile: async (peerPtid, force = false) => {
    const ptid = peerPtid.trim();
    if (!ptid || ptid === get().currentUserPtid) return;
    const state = get();
    if (!force && ptid in state.peerProfiles) return;
    if (!force && state.peerProfileLoading[ptid]) return;
    const owner = captureProfileOperationOwner(state);
    const isCurrent = () => isCurrentProfileOperation(get, owner);

    const repository = owner.storage?.repositories.peerProfiles;
    if (!force && repository) {
      const cached = await readCachedPeerProfile(repository, ptid).catch((error) => {
        if (!isCurrent()) return null;
        throw error;
      });
      if (!isCurrent()) return;
      if (cached?.profile) {
        set((prev) => ({ peerProfiles: { ...prev.peerProfiles, [ptid]: cached.profile } }));
        if (!cached.stale) return;
      }
    }

    const profileGw = requireProfileGateway(state);
    set((prev) => ({
      peerProfileLoading: { ...prev.peerProfileLoading, [ptid]: true },
      peerProfileErrors: { ...prev.peerProfileErrors, [ptid]: null },
    }));

    try {
      const profile = unwrapOutcome(await profileGw.getPeerProfile(ptid));
      if (!isCurrent()) return;
      await persistProfileCache(repository, ptid, profile, isCurrent);
      if (!isCurrent()) return;
      set((prev) => ({
        peerProfiles: { ...prev.peerProfiles, [ptid]: profile },
        peerProfileLoading: { ...prev.peerProfileLoading, [ptid]: false },
      }));
    } catch (error) {
      if (!isCurrent()) return;
      set((prev) => ({
        peerProfiles: { ...prev.peerProfiles, [ptid]: null },
        peerProfileLoading: { ...prev.peerProfileLoading, [ptid]: false },
        peerProfileErrors: { ...prev.peerProfileErrors, [ptid]: normalizeError(error) },
      }));
    }
  },

  sendMessage: async (sessionUlid, content, attachments, context) => {
    const state = get();
    const trimmed = content.trim();
    if (!trimmed && !attachments?.length) return null;

    try {
      const outcome = await messagingSendMessage({
        ...messagingAccount(state),
        admissionDomain: mutationDomainForConversation(state, sessionUlid),
        conversationId: sessionUlid,
        plaintext: trimmed,
        replyToMessageId: context?.replyToMessageId,
        threadRootMessageId: context?.threadRootMessageId,
        attachmentStageIds: attachments?.map((attachment) => attachment.stageId),
      });
      await get().loadMessages(sessionUlid);
      if (context?.threadRootMessageId) {
        await get().loadThreadMessages(sessionUlid, context.threadRootMessageId);
      }
      return outcome;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  editMessage: async (sessionUlid, messageUlid, content) => {
    const state = get();
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('mobile.messaging.editContentRequired');
    }

    try {
      const submission = await messagingSubmitEdit({
        ...messagingAccount(state),
        admissionDomain: mutationDomainForConversation(state, sessionUlid),
        conversationId: sessionUlid,
        messageId: messageUlid,
        plaintext: trimmed,
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: sessionUlid,
            messageId: messageUlid,
            kind: 'edit',
            submission,
            expectedContent: trimmed,
          },
        ),
      }));
      await Promise.allSettled([get().loadMessages(sessionUlid)]);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  recallMessage: async (sessionUlid, messageUlid) => {
    const state = get();
    try {
      const submission = await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        admissionDomain: mutationDomainForConversation(state, sessionUlid),
        conversationId: sessionUlid,
        messageId: messageUlid,
        interaction: { kind: 'retract' },
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: sessionUlid,
            messageId: messageUlid,
            kind: 'recall',
            submission,
          },
        ),
      }));
      await Promise.allSettled([get().loadMessages(sessionUlid)]);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  hideMessageForActor: async (sessionUlid, messageUlid) => {
    const state = get();
    try {
      const submission = await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        admissionDomain: mutationDomainForConversation(state, sessionUlid),
        conversationId: sessionUlid,
        messageId: messageUlid,
        interaction: { kind: 'hideForActor' },
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: sessionUlid,
            messageId: messageUlid,
            kind: 'hideForActor',
            submission,
          },
        ),
      }));
      await Promise.allSettled([get().loadMessages(sessionUlid)]);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  moderateMessage: async (sessionUlid, messageUlid, reasonCode) => {
    const state = get();
    if (!reasonCode.trim()) {
      throw new Error('mobile.messaging.moderationReasonRequired');
    }
    try {
      const submission = await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        admissionDomain: mutationDomainForConversation(state, sessionUlid),
        conversationId: sessionUlid,
        messageId: messageUlid,
        interaction: { kind: 'moderate', reasonCode },
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: sessionUlid,
            messageId: messageUlid,
            kind: 'moderate',
            submission,
          },
        ),
      }));
      await Promise.allSettled([get().loadMessages(sessionUlid)]);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  setMessageReaction: async (
    sessionUlid,
    messageUlid,
    reaction,
    remove,
    threadRootMessageUlid,
  ) => {
    const state = get();
    try {
      const submission = await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        admissionDomain: mutationDomainForConversation(state, sessionUlid),
        conversationId: sessionUlid,
        messageId: messageUlid,
        interaction: { kind: 'reaction', reaction, remove },
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: sessionUlid,
            messageId: messageUlid,
            kind: 'reaction',
            submission,
            reaction,
            remove,
          },
        ),
      }));
      const refreshes = [get().loadMessages(sessionUlid)];
      if (threadRootMessageUlid) {
        refreshes.push(
          get().loadThreadMessages(sessionUlid, threadRootMessageUlid),
        );
      }
      await Promise.allSettled(refreshes);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  setMessagePinned: async (
    sessionUlid,
    messageUlid,
    remove,
    threadRootMessageUlid,
  ) => {
    const state = get();
    try {
      const submission = await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        admissionDomain: mutationDomainForConversation(state, sessionUlid),
        conversationId: sessionUlid,
        messageId: messageUlid,
        interaction: { kind: 'pin', remove },
      });
      set((current) => ({
        messageCommandOutcomes: trackChatMessageCommand(
          current.messageCommandOutcomes,
          {
            conversationId: sessionUlid,
            messageId: messageUlid,
            kind: 'pin',
            submission,
            remove,
          },
        ),
      }));
      const refreshes = [get().loadMessages(sessionUlid)];
      if (threadRootMessageUlid) {
        refreshes.push(
          get().loadThreadMessages(sessionUlid, threadRootMessageUlid),
        );
      }
      await Promise.allSettled(refreshes);
      return submission;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  setPeerOnline: (ptid, online) =>
    set((state) => {
      const next = applyPresenceToMap(state.peerOnline, ptid, online);
      return next ? { peerOnline: next } : state;
    }),

  applyTypingState: (sessionUlid, fromActorPtid, typing) => {
    if (!sessionUlid || !fromActorPtid) return;
    set((state) => {
      const next = applyTypingStateToMap(state.typingPeers, sessionUlid, fromActorPtid, typing);
      return next ? { typingPeers: next } : state;
    });
  },

  sweepTypingPeers: (staleBefore) =>
    set((state) => {
      const next = pruneTypingPeers(state.typingPeers, staleBefore);
      return next ? { typingPeers: next } : state;
    }),

  sendTypingState: async (sessionUlid, typing) => {
    const state = get();
    if (!sessionUlid) return;
    await messagingSubmitTyping({
      ...messagingAccount(state),
      admissionDomain: mutationDomainForConversation(state, sessionUlid),
      conversationId: sessionUlid,
      isTyping: typing,
    });
  },

  searchPeople: async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      get().clearPeopleSearch();
      return;
    }
    const profileGw = get().profileGateway;
    const request = {};
    peopleSearchRequest = request;
    const isCurrent = () => peopleSearchRequest === request && get().profileGateway === profileGw;
    set({
      peopleSearchLoading: true,
      peopleSearchError: null,
      peopleSearchFederations: [],
      peopleSearchFederationsError: null,
    });
    try {
      if (!profileGw) throw new Error('mobile.social.runtimeUnavailable');
      const parsed = parseHandleInput(trimmed);
      let items: ActorSearchResult[];
      if (parsed.isFederated && parsed.hasHost) {
        const result = unwrapOutcome(await profileGw.resolveFederationHandle(parsed.canonical));
        items = result.asSearchResult ? [result.asSearchResult] : [];
      } else {
        items = unwrapOutcome(await profileGw.searchActors(parsed.localPart || trimmed)).items;
      }
      if (!isCurrent()) return;
      set({ peopleSearchResults: items });
      const federations = await profileGw.listFederations();
      if (!isCurrent()) return;
      set({
        peopleSearchFederations: federations.ok ? federations.data : [],
        peopleSearchFederationsError: federations.ok ? null : new SocialApiError(federations.error),
        peopleSearchLoading: false,
      });
    } catch (error) {
      if (!isCurrent()) return;
      set({ peopleSearchResults: [], peopleSearchLoading: false, peopleSearchError: normalizeError(error) });
    }
  },

  clearPeopleSearch: () => {
    peopleSearchRequest = null;
    set({
      peopleSearchResults: [],
      peopleSearchError: null,
      peopleSearchFederations: [],
      peopleSearchFederationsError: null,
      peopleSearchLoading: false,
    });
  },

  clearError: () => set({ error: null }),
}));

export function selectConversations(state: SocialState): SocialConversation[] {
  return projectConversations(state);
}

export function pendingInboundRequests(state: SocialState): FriendRequest[] {
  return projectPendingInboundRequests(state.friendRequests, state.currentUserPtid);
}

export function outgoingRequests(state: SocialState): FriendRequest[] {
  return projectOutgoingRequests(state.friendRequests, state.currentUserPtid);
}

export function unreadNotifications(state: SocialState): SocialNotification[] {
  return projectUnreadNotifications(state.notifications);
}

export function unreadNotificationCount(state: SocialState): number {
  return projectUnreadNotificationCount({ notifications: state.notifications, unreadTotal: state.unreadCounts.total });
}

export function formatSocialError(error: SocialApiError): string {
  const code = error.context.code ? ` (${error.context.code})` : '';
  return `${error.context.message}${code}`;
}

type SocialSetState = (partial: Partial<SocialState> | ((state: SocialState) => Partial<SocialState>)) => void;
type ProfileOperationOwner = Pick<
  SocialState,
  'sessionKey' | 'authSession' | 'currentUserPtid' | 'profileGateway' | 'storage'
>;

function captureProfileOperationOwner(state: SocialState): ProfileOperationOwner {
  return {
    sessionKey: state.sessionKey,
    authSession: state.authSession,
    currentUserPtid: state.currentUserPtid,
    profileGateway: state.profileGateway,
    storage: state.storage,
  };
}

function isCurrentProfileOperation(
  getState: () => SocialState,
  owner: ProfileOperationOwner,
): boolean {
  const current = getState();
  return current.sessionKey === owner.sessionKey
    && current.authSession === owner.authSession
    && current.currentUserPtid === owner.currentUserPtid
    && current.profileGateway === owner.profileGateway
    && current.storage === owner.storage;
}

function staleProfileOperationError(method: 'GET' | 'POST', path: string): SocialApiError {
  return new SocialApiError({
    method,
    path,
    message: 'mobile.social.notAuthenticated',
  });
}

async function persistProfileCache(
  repository: DomainCacheRepository<unknown> | undefined,
  ptid: string,
  profile: PeerProfile,
  isCurrent: () => boolean,
): Promise<void> {
  if (!repository || !isCurrent()) return;
  let tails = profileCacheWriteTails.get(repository);
  if (!tails) {
    tails = new Map<string, Promise<void>>();
    profileCacheWriteTails.set(repository, tails);
  }
  const previous = tails.get(ptid) ?? Promise.resolve();
  const write = previous
    .then(async () => {
      if (!isCurrent()) return;
      await repository.write(ptid, profile);
    })
    .catch(() => undefined);
  tails.set(ptid, write);
  profileCacheWrites.add(write);
  void write.then(() => {
    profileCacheWrites.delete(write);
    if (tails?.get(ptid) === write) tails.delete(ptid);
  });
  await write;
}

async function hydrateCurrentUserProfileFromCache(
  expectedSessionKey: string,
  ptid: string | null,
  getState: () => SocialState,
  setState: SocialSetState,
) {
  const storage = getState().storage;
  if (!storage || !ptid) return;

  const cached = await readCachedPeerProfile(storage.repositories.peerProfiles, ptid);
  if (
    !cached?.profile
    || getState().sessionKey !== expectedSessionKey
  ) return;

  setState((state) => ({
    currentUserProfile: state.currentUserProfile ?? cached.profile,
    peerProfiles: ptid in state.peerProfiles ? state.peerProfiles : { ...state.peerProfiles, [ptid]: cached.profile },
  }));
}

async function readCachedPeerProfile(
  repository: DomainCacheRepository<unknown>,
  ptid: string,
): Promise<{ profile: PeerProfile; stale: boolean } | null> {
  const cached = await repository.read(ptid);
  if (!cached.envelope) return null;
  return { profile: cached.envelope.value as PeerProfile, stale: cached.stale };
}

function requireSocialGateway(state: SocialState): SocialGateway {
  if (!state.socialGateway) {
    throw new SocialApiError({ method: 'GET', path: '/social', message: 'mobile.social.notAuthenticated' });
  }
  return state.socialGateway;
}

function requireNotificationGateway(state: SocialState): NotificationGateway {
  if (!state.notificationGateway) {
    throw new SocialApiError({ method: 'GET', path: '/notification', message: 'mobile.social.notAuthenticated' });
  }
  return state.notificationGateway;
}

function requireProfileGateway(state: SocialState): ProfileGateway {
  if (!state.profileGateway) {
    throw new SocialApiError({ method: 'GET', path: '/profile', message: 'mobile.social.notAuthenticated' });
  }
  return state.profileGateway;
}

function requireAuthSession(state: SocialState): MobileAuthSession {
  if (!state.authSession) {
    throw new SocialApiError({ method: 'GET', path: '/social', message: 'mobile.social.notAuthenticated' });
  }
  return state.authSession;
}

function messagingAccount(state: SocialState) {
  const session = requireAuthSession(state);
  const actorPtid = state.currentUserPtid?.trim();
  if (!actorPtid) {
    throw new SocialApiError({
      method: 'INVOKE',
      path: 'messaging',
      message: 'mobile.social.notAuthenticated',
    });
  }
  return {
    stationPeerId: session.stationPeerId,
    actorPtid,
  };
}

function conversationKind(
  state: SocialState,
  conversationId: string,
): 'friend' | 'group' {
  const kind = state.messagingConversations.find(
    (conversation) => conversation.conversationId === conversationId,
  )?.kind;
  if (kind === 2) return 'group';
  if (kind === 1 || state.sessions.some((session) => session.ulid === conversationId)) {
    return 'friend';
  }
  throw new Error('mobile.chat.conversationUnavailable');
}

function mutationDomainForConversation(
  state: SocialState,
  conversationId: string,
): 'social' | 'group' {
  return conversationKind(state, conversationId) === 'group' ? 'group' : 'social';
}

function relationshipTargetHomeStationPeerId(
  state: SocialState,
  targetPtid: string,
): string {
  const projected = state.friendshipStatus[targetPtid]?.targetHomeStationPeerId;
  if (projected) return projected;
  for (const request of state.friendRequests) {
    if (request.senderPtid === targetPtid && request.senderHomeStationPeerId) {
      return request.senderHomeStationPeerId;
    }
    if (
      request.receiverPtid === targetPtid &&
      request.receiverHomeStationPeerId
    ) {
      return request.receiverHomeStationPeerId;
    }
  }
  throw new SocialApiError({
    method: 'POST',
    path: '/api/v1/social/relationships',
    message: 'mobile.social.relationshipAuthorityUnavailable',
  });
}

function normalizeError(error: unknown): SocialApiError {
  if (error instanceof SocialApiError) return error;
  return new SocialApiError({ method: 'GET', path: '/social', message: readableErrorMessage(error) });
}

function resolveActorPtid(session: MobileAuthSession): string | null {
  return mobileAuthScope(session).ptid;
}

function parseHandleInput(raw: string): ParsedHandle {
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith('@')) {
    return { isFederated: false, hasHost: false, canonical: '', localPart: '' };
  }
  const match = FEDERATED_HANDLE_RE.exec(trimmed);
  if (!match?.[1]) return { isFederated: false, hasHost: false, canonical: '', localPart: '' };
  const local = match[1];
  const host = match[2];
  if (!host) return { isFederated: true, hasHost: false, canonical: '', localPart: local };
  return {
    isFederated: true,
    hasHost: true,
    canonical: `@${local.toLowerCase()}@${host.toLowerCase()}`,
    localPart: local,
  };
}

function requestKey(request: FriendRequest): string {
  return request.requestId || request.id || '';
}

function upsertFriendshipStatus(items: FriendshipStatus[], nextItem: FriendshipStatus): FriendshipStatus[] {
  const exists = items.some((item) => item.targetPtid === nextItem.targetPtid);
  return exists
    ? items.map((item) => (item.targetPtid === nextItem.targetPtid ? nextItem : item))
    : [nextItem, ...items];
}

function clearSessionUnreadForActor(
  sessions: FriendChatSession[],
  sessionUlid: string,
  currentUserPtid: string,
): FriendChatSession[] {
  return clearChatUnreadForParticipant(sessions, sessionUlid, currentUserPtid);
}

function sessionFromMessaging(
  conversation: MessagingConversationProjection,
  currentActorPtid: string,
  previous?: FriendChatSession,
): FriendChatSession {
  const peerPtid = conversation.memberPtids.find((ptid) => ptid !== currentActorPtid) ?? '';
  const timestamp = socialTimestampFromUnixMs(conversation.updatedAtUnixMs);
  return {
    ulid: conversation.conversationId,
    participantAPtid: currentActorPtid,
    participantBPtid: peerPtid,
    lastMessageUlid: previous?.lastMessageUlid ?? '',
    lastMessageAt: previous?.lastMessageAt ?? timestamp,
    unreadCountA: previous?.unreadCountA ?? 0,
    unreadCountB: 0,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
    participantADisplayName: participantDisplayName(previous, currentActorPtid),
    participantAAvatar: participantAvatar(previous, currentActorPtid),
    participantBDisplayName:
      participantDisplayName(previous, peerPtid) || peerPtid,
    participantBAvatar: participantAvatar(previous, peerPtid),
    participantAOnline: participantOnline(previous, currentActorPtid),
    participantBOnline: participantOnline(previous, peerPtid),
    lastMessage: previous?.lastMessage,
  };
}

function socialTimestampFromUnixMs(unixMs: number): SocialTimestamp {
  return {
    seconds: Math.floor(unixMs / 1000),
    nanos: (unixMs % 1000) * 1_000_000,
  };
}

function participantDisplayName(
  session: FriendChatSession | undefined,
  ptid: string,
): string {
  if (!session || !ptid) return '';
  if (session.participantAPtid === ptid) return session.participantADisplayName;
  if (session.participantBPtid === ptid) return session.participantBDisplayName;
  return '';
}

function participantAvatar(
  session: FriendChatSession | undefined,
  ptid: string,
): string {
  if (!session || !ptid) return '';
  if (session.participantAPtid === ptid) return session.participantAAvatar;
  if (session.participantBPtid === ptid) return session.participantBAvatar;
  return '';
}

function participantOnline(
  session: FriendChatSession | undefined,
  ptid: string,
): boolean {
  if (!session || !ptid) return false;
  if (session.participantAPtid === ptid) return session.participantAOnline;
  if (session.participantBPtid === ptid) return session.participantBOnline;
  return false;
}
