import { create } from 'zustand';
import { clearChatUnreadForParticipant } from '@peers-touch/client-chat-core';
import type { DomainCacheRepository } from '@peers-touch/client-storage';

import type { MobileAuthSession } from '../auth/authSession';
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
  messagingCreateDirect,
  messagingListConversations,
  messagingListMessages,
  messagingSendMessage,
  messagingSubmitEdit,
  messagingSubmitMetadataInteraction,
  messagingSubmitReadCursor,
  messagingSubmitTyping,
  type MessagingAttachmentStageProjection,
  type MessagingSubmitCommandResult,
} from '../../services/mobileCommands';
import {
  createSocialGateway,
  createNotificationGateway,
  createProfileGateway,
  unwrapOutcome,
  type SocialGateway,
  type NotificationGateway,
  type ProfileGateway,
} from '../../services/gateways';
import {
  federationViewToResult,
  normalizeActorSearchResult,
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
  projectConversations,
  projectOutgoingRequests,
  projectPendingInboundRequests,
  projectUnreadNotificationCount,
  projectUnreadNotifications,
  pruneTypingPeers,
} from './socialProjection';
import {
  friendMessageFromMessaging,
  friendSessionFromMessaging,
} from '../chat/messagingProjectionAdapters';
import {
  SocialApiError,
  readableErrorMessage,
  type FriendChatMessage,
  type FriendChatSession,
  type FriendRequest,
  type FriendshipStatus,
  type PeerProfile,
  type SocialConversation,
  type SocialNotification,
  type TypingEntry,
  type UnreadCounts,
  type ActorSearchResult,
} from './socialTypes';

const FRIEND_REQUEST_STATUS_ACCEPTED = 2;
const FRIEND_REQUEST_STATUS_REJECTED = 3;
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
  friendRequests: FriendRequest[];
  messages: Record<string, FriendChatMessage[]>;
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
  sendFriendRequest: (receiverPtid: string, message?: string) => Promise<void>;
  selectSession: (sessionUlid: string | null) => Promise<void>;
  loadMessages: (sessionUlid: string) => Promise<void>;
  loadCurrentUserProfile: (force?: boolean) => Promise<void>;
  loadPeerProfile: (peerPtid: string, force?: boolean) => Promise<void>;
  sendMessage: (
    sessionUlid: string,
    content: string,
    attachments?: MessagingAttachmentStageProjection[],
  ) => Promise<MessagingSubmitCommandResult | null>;
  editMessage: (sessionUlid: string, messageUlid: string, content: string) => Promise<void>;
  recallMessage: (sessionUlid: string, messageUlid: string) => Promise<void>;
  setPeerOnline: (ptid: string, online: boolean) => void;
  applyTypingState: (sessionUlid: string, fromActorPtid: string, typing: boolean) => void;
  sweepTypingPeers: (staleBefore: number) => void;
  sendTypingState: (sessionUlid: string, typing: boolean) => Promise<void>;
  searchPeople: (query: string) => Promise<void>;
  clearPeopleSearch: () => void;
  clearError: () => void;
}

const emptyUnreadCounts: UnreadCounts = { total: 0, byCategory: {} };

export const useSocialStore = create<SocialState>((set, get) => ({
  sessionKey: null,
  authSession: null,
  currentUserPtid: null,
  socialGateway: null,
  notificationGateway: null,
  profileGateway: null,
  storage: null,
  sessions: [],
  friendRequests: [],
  messages: {},
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
  peopleSearchLoading: false,
  peopleSearchError: null,
  activeSessionUlid: null,
  loading: false,
  error: null,
  lastReconcileAt: null,

  bindSession: (session) => {
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
        friendRequests: [],
        messages: {},
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
    if (get().sessionKey === sessionKey) return;

    set({
      sessionKey,
      authSession: session,
      currentUserPtid: resolveActorPtid(session),
      socialGateway: createSocialGateway(session),
      notificationGateway: createNotificationGateway(session),
      profileGateway: createProfileGateway(session),
      storage: createMobileClientStorageRuntime(session),
      sessions: [],
      friendRequests: [],
      messages: {},
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
      peopleSearchLoading: false,
      peopleSearchError: null,
      activeSessionUlid: null,
      loading: false,
      error: null,
      lastReconcileAt: null,
    });

    void hydrateCurrentUserProfileFromCache(sessionKey, resolveActorPtid(session), get, set);
  },

  reconcile: async () => {
    const { refreshFriendRequests, refreshSessions, refreshBlockedUsers, refreshConversationSettings, refreshNotifications } = get();
    const coldStart = get().sessions.length === 0 && get().friendRequests.length === 0 && get().notifications.length === 0;
    set({ loading: coldStart, error: null });
    try {
      await Promise.all([refreshFriendRequests(), refreshSessions(), refreshBlockedUsers(), refreshNotifications()]);
      await refreshConversationSettings();
      await get().reconcileActiveSessionMessages();
      set({ lastReconcileAt: Date.now(), loading: false });
    } catch (error) {
      set({ error: normalizeError(error), loading: false });
    }
  },

  reconcileActiveSessionMessages: async () => {
    const sessionUlid = get().activeSessionUlid;
    if (!sessionUlid) return;
    await get().loadMessages(sessionUlid);
  },

  refreshFriendRequests: async () => {
    const gw = requireSocialGateway(get());
    const result = unwrapOutcome(await gw.listFriendRequests());
    set({ friendRequests: result.requests.map(normalizeFriendRequest) });
  },

  refreshSessions: async () => {
    const state = get();
    const account = messagingAccount(state);
    const currentUserPtid = state.currentUserPtid;
    if (!currentUserPtid) return;

    const existing = new Map(state.sessions.map((session) => [session.ulid, session]));
    const conversations = (await messagingListConversations(account))
      .filter((conversation) => conversation.active && conversation.kind === 1);
    const messageEntries = await Promise.all(conversations.map(async (conversation) => {
      const projections = await messagingListMessages({
        ...account,
        conversationId: conversation.conversationId,
      });
      return [
        conversation.conversationId,
        projections,
      ] as const;
    }));
    const messages = Object.fromEntries(messageEntries.map(([conversationId, projections]) => [
      conversationId,
      projections.map((message) => friendMessageFromMessaging(conversationId, message)),
    ]));
    const sessions = conversations.map((conversation) => {
      const session = friendSessionFromMessaging(
        conversation,
        currentUserPtid,
        existing.get(conversation.conversationId),
      );
      const projections = messageEntries.find(
        ([conversationId]) => conversationId === conversation.conversationId,
      )?.[1] ?? [];
      const lastMessage = messages[conversation.conversationId]?.at(-1);
      const unread = projections.filter((message) =>
        message.senderPtid !== currentUserPtid
        && !message.readByPtids.includes(currentUserPtid)
        && !message.retracted,
      ).length;
      return {
        ...session,
        lastMessage,
        lastMessageUlid: lastMessage?.ulid ?? '',
        lastMessageAt: lastMessage?.sentAt ?? session.lastMessageAt,
        unreadCountA: state.activeSessionUlid === conversation.conversationId ? 0 : unread,
      };
    });
    set((current) => ({
      messages: { ...current.messages, ...messages },
      sessions,
    }));
  },

  refreshBlockedUsers: async () => {
    const gw = requireSocialGateway(get());
    const blockedUsers = unwrapOutcome(await gw.listBlockedUsers());
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
    const gw = requireSocialGateway(get());
    try {
      unwrapOutcome(await gw.blockUser(ptid));
      set((state) => ({
        friendshipStatus: { ...state.friendshipStatus, [ptid]: { targetPtid: ptid, blocked: true } },
        blockedUsers: upsertFriendshipStatus(state.blockedUsers, { targetPtid: ptid, blocked: true }),
        activeSessionUlid: state.sessions.some((session) => session.ulid === state.activeSessionUlid && peerPtidFromSession(session, state.currentUserPtid) === ptid)
          ? null
          : state.activeSessionUlid,
      }));
      await Promise.allSettled([get().refreshSessions(), get().refreshFriendRequests(), get().refreshBlockedUsers()]);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  unblockUser: async (targetPtid) => {
    const ptid = targetPtid.trim();
    if (!ptid) return;
    const gw = requireSocialGateway(get());
    try {
      unwrapOutcome(await gw.unblockUser(ptid));
      set((state) => ({
        friendshipStatus: { ...state.friendshipStatus, [ptid]: { targetPtid: ptid, blocked: false } },
        blockedUsers: state.blockedUsers.filter((item) => item.targetPtid !== ptid),
      }));
      await Promise.allSettled([get().refreshSessions(), get().refreshFriendRequests(), get().refreshBlockedUsers()]);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  refreshConversationSettings: async () => {
    const gw = requireSocialGateway(get());
    const sessions = get().sessions;
    const entries = await Promise.allSettled(sessions.map(async (session) => {
      const settings = unwrapOutcome(await gw.getConversationSettings(session.ulid));
      return [session.ulid, settings] as const;
    }));
    set((state) => {
      const next = { ...state.conversationSettings };
      entries.forEach((entry) => {
        if (entry.status === 'fulfilled') next[entry.value[0]] = entry.value[1];
      });
      return { conversationSettings: next };
    });
  },

  loadConversationSettings: async (sessionUlid) => {
    const gw = requireSocialGateway(get());
    const settings = unwrapOutcome(await gw.getConversationSettings(sessionUlid));
    set((state) => ({ conversationSettings: { ...state.conversationSettings, [sessionUlid]: settings } }));
  },

  updateConversationSettings: async (sessionUlid, input) => {
    const gw = requireSocialGateway(get());
    const settings = unwrapOutcome(await gw.updateConversationSettings(sessionUlid, input));
    set((state) => ({ conversationSettings: { ...state.conversationSettings, [sessionUlid]: settings } }));
  },

  refreshNotifications: async () => {
    const notifGw = requireNotificationGateway(get());
    const [notificationResult, unreadResult] = await Promise.all([
      notifGw.listNotifications(),
      notifGw.getUnreadCounts(),
    ]);
    const notificationData = unwrapOutcome(notificationResult);
    const unreadCounts = unwrapOutcome(unreadResult);
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

    set((state) => ({
      sessions: clearSessionUnreadForActor(state.sessions, sessionUlid, currentUserPtid),
    }));

    const messages = state.messages[sessionUlid] ?? [];
    const target = upToUlid
      ? messages.find((message) => message.ulid === upToUlid)
      : messages.at(-1);
    if (!target?.eventSequence || target.eventSequence <= 0) return;
    await messagingSubmitReadCursor({
      ...messagingAccount(state),
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
      const payload = unwrapOutcome(await gw.acceptFriendRequest(requestId));
      const peerPtid = request?.senderPtid === state.currentUserPtid
        ? request.receiverPtid
        : request?.senderPtid;
      if (!peerPtid) {
        throw new SocialApiError({
          method: 'POST',
          path: '/conversation/direct',
          message: 'mobile.social.friendRequestPeerMissing',
        });
      }
      const created = await messagingCreateDirect({
        ...messagingAccount(state),
        peerPtid,
      });
      const legacySession = payload.session
        ? normalizeSession(payload.session)
        : undefined;
      const canonicalSession = friendSessionFromMessaging({
        conversationId: created.conversationId,
        authorityStationId: state.authSession?.stationPeerId ?? '',
        kind: 1,
        name: '',
        ownerPtid: state.currentUserPtid ?? '',
        memberPtids: [state.currentUserPtid ?? '', peerPtid].filter(Boolean),
        membershipEpoch: 1,
        mlsEpoch: 0,
        active: true,
        updatedAtUnixMs: Date.now(),
      }, state.currentUserPtid ?? '', legacySession);
      set((state) => ({
        friendRequests: state.friendRequests.map((request) =>
          requestKey(request) === requestId
            ? normalizeFriendRequest(payload.request ?? { ...request, status: FRIEND_REQUEST_STATUS_ACCEPTED })
            : request,
        ),
        sessions: [
          canonicalSession,
          ...state.sessions.filter((item) => item.ulid !== canonicalSession.ulid),
        ],
      }));
      if (created.state === 'projected') await get().reconcile();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  rejectFriendRequest: async (requestId) => {
    const gw = requireSocialGateway(get());
    try {
      const payload = unwrapOutcome(await gw.rejectFriendRequest(requestId));
      set((state) => ({
        friendRequests: state.friendRequests.map((request) =>
          requestKey(request) === requestId
            ? normalizeFriendRequest(payload.request ?? { ...request, status: FRIEND_REQUEST_STATUS_REJECTED })
            : request,
        ),
      }));
      await get().reconcile();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  sendFriendRequest: async (receiverPtid, message) => {
    const gw = requireSocialGateway(get());
    try {
      unwrapOutcome(await gw.sendFriendRequest(receiverPtid, message));
      await get().refreshFriendRequests();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
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
    try {
      const messages = (
        await messagingListMessages({
          ...messagingAccount(state),
          conversationId: sessionUlid,
        })
      ).map((message) => friendMessageFromMessaging(sessionUlid, message));
      set((state) => ({
        messages: { ...state.messages, [sessionUlid]: messages },
      }));
      const lastReadUlid = messages.at(-1)?.ulid;
      if (lastReadUlid) {
        await get().markActiveSessionRead(sessionUlid, lastReadUlid);
      }
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  loadCurrentUserProfile: async (force = false) => {
    const state = get();
    const ptid = state.currentUserPtid?.trim() ?? '';
    if (!ptid) return;
    if (!force && state.currentUserProfile) return;

    if (!force && state.storage) {
      const cached = await readCachedPeerProfile(state.storage.repositories.peerProfiles, ptid);
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
      await state.storage?.repositories.peerProfiles.write(ptid, profile).catch(() => undefined);
      set((prev) => ({
        currentUserProfile: profile,
        peerProfiles: { ...prev.peerProfiles, [ptid]: profile },
      }));
    } catch (error) {
      set({ error: normalizeError(error) });
    }
  },

  loadPeerProfile: async (peerPtid, force = false) => {
    const ptid = peerPtid.trim();
    if (!ptid || ptid === get().currentUserPtid) return;
    const state = get();
    if (!force && ptid in state.peerProfiles) return;
    if (state.peerProfileLoading[ptid]) return;

    if (!force && state.storage) {
      const cached = await readCachedPeerProfile(state.storage.repositories.peerProfiles, ptid);
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
      await state.storage?.repositories.peerProfiles.write(ptid, profile).catch(() => undefined);
      set((prev) => ({
        peerProfiles: { ...prev.peerProfiles, [ptid]: profile },
        peerProfileLoading: { ...prev.peerProfileLoading, [ptid]: false },
      }));
    } catch (error) {
      set((prev) => ({
        peerProfiles: { ...prev.peerProfiles, [ptid]: null },
        peerProfileLoading: { ...prev.peerProfileLoading, [ptid]: false },
        peerProfileErrors: { ...prev.peerProfileErrors, [ptid]: normalizeError(error) },
      }));
    }
  },

  sendMessage: async (sessionUlid, content, attachments) => {
    const state = get();
    const trimmed = content.trim();
    if (!trimmed && !attachments?.length) return null;

    try {
      const outcome = await messagingSendMessage({
        ...messagingAccount(state),
        conversationId: sessionUlid,
        plaintext: trimmed,
        attachmentStageIds: attachments?.map((attachment) => attachment.stageId),
      });
      await get().loadMessages(sessionUlid);
      return outcome;
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  editMessage: async (sessionUlid, messageUlid, content) => {
    const state = get();
    const trimmed = content.trim();
    if (!trimmed) return;

    try {
      await messagingSubmitEdit({
        ...messagingAccount(state),
        conversationId: sessionUlid,
        messageId: messageUlid,
        plaintext: trimmed,
      });
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  recallMessage: async (sessionUlid, messageUlid) => {
    const state = get();
    try {
      await messagingSubmitMetadataInteraction({
        ...messagingAccount(state),
        conversationId: sessionUlid,
        messageId: messageUlid,
        interaction: { kind: 'retract' },
      });
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
      conversationId: sessionUlid,
      isTyping: typing,
    });
  },

  searchPeople: async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      set({ peopleSearchResults: [], peopleSearchError: null });
      return;
    }
    const profileGw = requireProfileGateway(get());
    set({ peopleSearchLoading: true, peopleSearchError: null });
    try {
      const parsed = parseHandleInput(trimmed);
      if (parsed.isFederated && parsed.hasHost) {
        const result = unwrapOutcome(await profileGw.resolveFederationHandle(parsed.canonical));
        set({ peopleSearchResults: result.asSearchResult ? [result.asSearchResult] : [], peopleSearchLoading: false });
        return;
      }
      const result = unwrapOutcome(await profileGw.searchActors(parsed.localPart || trimmed));
      set({
        peopleSearchResults: result.items.filter((item) => item.ptid),
        peopleSearchLoading: false,
      });
    } catch (error) {
      set({ peopleSearchResults: [], peopleSearchLoading: false, peopleSearchError: normalizeError(error) });
    }
  },

  clearPeopleSearch: () => set({ peopleSearchResults: [], peopleSearchError: null, peopleSearchLoading: false }),

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

async function hydrateCurrentUserProfileFromCache(
  expectedSessionKey: string,
  ptid: string | null,
  getState: () => SocialState,
  setState: SocialSetState,
) {
  const storage = getState().storage;
  if (!storage || !ptid) return;

  const cached = await readCachedPeerProfile(storage.repositories.peerProfiles, ptid);
  if (!cached?.profile || getState().sessionKey !== expectedSessionKey) return;

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
