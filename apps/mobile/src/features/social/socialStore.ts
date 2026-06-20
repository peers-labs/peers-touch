import { create } from 'zustand';
import { clearChatUnreadForParticipant } from '@peers-touch/client-chat-core';
import type { DomainCacheRepository } from '@peers-touch/client-storage';

import type { MobileAuthSession } from '../auth/authSession';
import {
  createMobileClientStorageRuntime,
  type MobileClientStorageRuntime,
} from '../../storage/mobileClientStorage';
import {
  createSocialApiClient,
  type FriendConversationSettings,
  type ChatAttachmentInput,
  type SocialApiClient,
  type UpdateFriendConversationSettingsInput,
} from './socialApi';
import {
  federationViewToResult,
  normalizeActorSearchResult,
  normalizeFriendRequest,
  normalizeMessage,
  normalizeNotification,
  normalizePeerProfile,
  normalizeSession,
  normalizeUnreadCounts,
} from './socialNormalizers';
import {
  applyMessageMutationToList,
  applyFriendEncryptedPayloadToMessage,
  applyMessageReceiptToList,
  applyPresenceToMap,
  applyTypingStateToMap,
  mergeMessages,
  mergeNotifications,
  type MessageMutationKind,
  peerDidFromSession,
  projectConversations,
  projectOutgoingRequests,
  projectPendingInboundRequests,
  projectUnreadNotificationCount,
  projectUnreadNotifications,
  pruneTypingPeers,
  seedPresenceFromSessions,
  visibleFriendMessages,
} from './socialProjection';
import {
  createFriendEncryptedChatPayload,
  decryptFriendChatPayload,
  encryptFriendChatPayload,
} from './socialFriendE2ee';
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
const FRIEND_MESSAGE_STATUS_DELIVERED = 3;
const FRIEND_MESSAGE_STATUS_READ = 4;
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
  currentUserDid: string | null;
  api: SocialApiClient | null;
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
  loadFriendshipStatus: (targetDid: string) => Promise<void>;
  blockUser: (targetDid: string) => Promise<void>;
  unblockUser: (targetDid: string) => Promise<void>;
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
  sendFriendRequest: (receiverDid: string, message?: string) => Promise<void>;
  selectSession: (sessionUlid: string | null) => Promise<void>;
  loadMessages: (sessionUlid: string) => Promise<void>;
  loadCurrentUserProfile: (force?: boolean) => Promise<void>;
  loadPeerProfile: (peerDid: string, force?: boolean) => Promise<void>;
  sendMessage: (sessionUlid: string, content: string, attachments?: ChatAttachmentInput[], messageType?: number) => Promise<void>;
  editMessage: (sessionUlid: string, messageUlid: string, content: string) => Promise<void>;
  recallMessage: (sessionUlid: string, messageUlid: string) => Promise<void>;
  deleteMessage: (sessionUlid: string, messageUlid: string) => Promise<void>;
  setPeerOnline: (did: string, online: boolean) => void;
  ingestRealtimeMessage: (sessionUlid: string, message: FriendChatMessage) => Promise<void>;
  applyMessageReceipt: (sessionUlid: string, messageUlid: string, kind: number | string) => void;
  applyMessageMutation: (
    sessionUlid: string,
    messageUlid: string,
    kind: MessageMutationKind,
    payload: { newContent?: string; newCiphertext?: Uint8Array; mutatedTsUnixMs?: number },
  ) => void;
  applyTypingState: (sessionUlid: string, fromActorId: string, typing: boolean) => void;
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
  currentUserDid: null,
  api: null,
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
        currentUserDid: null,
        api: null,
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

    const sessionKey = `${session.stationUrl}|${session.sessionId}`;
    if (get().sessionKey === sessionKey) return;

    set({
      sessionKey,
      authSession: session,
      currentUserDid: resolveActorDid(session),
      api: createSocialApiClient(session),
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

    void hydrateCurrentUserProfileFromCache(sessionKey, resolveActorDid(session), get, set);
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
    const api = requireApi(get());
    const payload = await api.listFriendRequests();
    set({ friendRequests: (payload.requests ?? []).map(normalizeFriendRequest) });
  },

  refreshSessions: async () => {
    const api = requireApi(get());
    const payload = await api.listSessions();
    const activeSessionUlid = get().activeSessionUlid;
    const currentUserDid = get().currentUserDid;
    const sessions = (payload.sessions ?? []).map(normalizeSession);
    set((state) => ({
      sessions: activeSessionUlid && currentUserDid
        ? clearSessionUnreadForActor(sessions, activeSessionUlid, currentUserDid)
        : sessions,
      peerOnline: { ...seedPresenceFromSessions(sessions, state.currentUserDid), ...state.peerOnline },
    }));
    await Promise.allSettled(sessions.slice(0, 20).map(async (session) => {
      if ((get().messages[session.ulid] ?? []).length > 0) return;
      const inlineLastMessage = session.lastMessage ? normalizeMessage(session.lastMessage) : null;
      const messages = inlineLastMessage
        ? [inlineLastMessage]
        : session.lastMessageUlid
          ? (await api.listMessages(session.ulid, undefined, 1)).messages?.map(normalizeMessage) ?? []
          : [];
      if (messages.length === 0) return;
      const decrypted = await decryptVisibleMessages(get(), session.ulid, messages);
      if (decrypted.length === 0) return;
      set((state) => {
        if ((state.messages[session.ulid] ?? []).length > 0) return state;
        return { messages: { ...state.messages, [session.ulid]: decrypted } };
      });
    }));
  },

  refreshBlockedUsers: async () => {
    const api = requireApi(get());
    const blockedUsers = await api.listBlockedUsers();
    set((state) => {
      const nextStatus = { ...state.friendshipStatus };
      blockedUsers.forEach((item) => {
        if (item.targetDid) nextStatus[item.targetDid] = item;
      });
      return { blockedUsers, friendshipStatus: nextStatus };
    });
  },

  loadFriendshipStatus: async (targetDid) => {
    const did = targetDid.trim();
    if (!did) return;
    const api = requireApi(get());
    try {
      const status = await api.getFriendshipStatus(did);
      set((state) => ({
        friendshipStatus: {
          ...state.friendshipStatus,
          [did]: { ...status, targetDid: did },
        },
      }));
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  blockUser: async (targetDid) => {
    const did = targetDid.trim();
    if (!did) return;
    const api = requireApi(get());
    try {
      await api.blockUser(did);
      set((state) => ({
        friendshipStatus: { ...state.friendshipStatus, [did]: { targetDid: did, blocked: true } },
        blockedUsers: upsertFriendshipStatus(state.blockedUsers, { targetDid: did, blocked: true }),
        activeSessionUlid: state.sessions.some((session) => session.ulid === state.activeSessionUlid && peerDidFromSession(session, state.currentUserDid) === did)
          ? null
          : state.activeSessionUlid,
      }));
      await Promise.allSettled([get().refreshSessions(), get().refreshFriendRequests(), get().refreshBlockedUsers()]);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  unblockUser: async (targetDid) => {
    const did = targetDid.trim();
    if (!did) return;
    const api = requireApi(get());
    try {
      await api.unblockUser(did);
      set((state) => ({
        friendshipStatus: { ...state.friendshipStatus, [did]: { targetDid: did, blocked: false } },
        blockedUsers: state.blockedUsers.filter((item) => item.targetDid !== did),
      }));
      await Promise.allSettled([get().refreshSessions(), get().refreshFriendRequests(), get().refreshBlockedUsers()]);
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  refreshConversationSettings: async () => {
    const api = requireApi(get());
    const sessions = get().sessions;
    const entries = await Promise.allSettled(sessions.map(async (session) => {
      const settings = await api.getConversationSettings(session.ulid);
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
    const api = requireApi(get());
    const settings = await api.getConversationSettings(sessionUlid);
    set((state) => ({ conversationSettings: { ...state.conversationSettings, [sessionUlid]: settings } }));
  },

  updateConversationSettings: async (sessionUlid, input) => {
    const api = requireApi(get());
    const settings = await api.updateConversationSettings(sessionUlid, input);
    set((state) => ({ conversationSettings: { ...state.conversationSettings, [sessionUlid]: settings } }));
  },

  refreshNotifications: async () => {
    const api = requireApi(get());
    const [notificationPayload, unreadCounts] = await Promise.all([api.listNotifications(), api.getUnreadCounts()]);
    set({
      notifications: (notificationPayload.notifications ?? []).map(normalizeNotification),
      notificationNextCursor: notificationPayload.nextCursor ?? notificationPayload.next_cursor ?? '',
      notificationHasMore: Boolean(notificationPayload.nextCursor ?? notificationPayload.next_cursor),
      unreadCounts: normalizeUnreadCounts(unreadCounts),
    });
  },

  markActiveSessionRead: async (sessionUlid, upToUlid) => {
    const { api, currentUserDid } = get();
    if (!api || !currentUserDid || get().activeSessionUlid !== sessionUlid) return;

    set((state) => ({
      sessions: clearSessionUnreadForActor(state.sessions, sessionUlid, currentUserDid),
    }));

    const messages = get().messages[sessionUlid] ?? [];
    const unreadUlids = messages
      .filter((message) => message.senderDid !== currentUserDid && message.status !== FRIEND_MESSAGE_STATUS_READ)
      .map((message) => message.ulid)
      .filter(Boolean);

    await Promise.allSettled([
      upToUlid ? api.markMessageRead(sessionUlid, upToUlid) : Promise.resolve(),
      unreadUlids.length ? api.ackMessages(unreadUlids, FRIEND_MESSAGE_STATUS_READ) : Promise.resolve(),
    ]);

    await get().refreshSessions().catch((error) => {
      set({ error: normalizeError(error) });
    });
  },

  loadMoreNotifications: async () => {
    const api = requireApi(get());
    const { notificationHasMore, notificationNextCursor } = get();
    if (!notificationHasMore || !notificationNextCursor) return;

    set({ loading: true, error: null });
    try {
      const payload = await api.listNotifications(30, notificationNextCursor);
      const incoming = (payload.notifications ?? []).map(normalizeNotification);
      set((state) => ({
        notifications: mergeNotifications(state.notifications, incoming),
        notificationNextCursor: payload.nextCursor ?? payload.next_cursor ?? '',
        notificationHasMore: Boolean(payload.nextCursor ?? payload.next_cursor),
        loading: false,
      }));
    } catch (error) {
      set({ error: normalizeError(error), loading: false });
    }
  },

  markNotificationRead: async (notificationId) => {
    const api = requireApi(get());
    await api.markNotificationsRead([notificationId]);
    await get().refreshNotifications();
  },

  markAllNotificationsRead: async () => {
    const api = requireApi(get());
    await api.markAllNotificationsRead();
    await get().refreshNotifications();
  },

  deleteNotification: async (notificationId) => {
    const api = requireApi(get());
    await api.deleteNotifications([notificationId]);
    await get().refreshNotifications();
  },

  acceptFriendRequest: async (requestId) => {
    const api = requireApi(get());
    try {
      const payload = await api.acceptFriendRequest(requestId);
      set((state) => ({
        friendRequests: state.friendRequests.map((request) =>
          requestKey(request) === requestId
            ? normalizeFriendRequest(payload.request ?? { ...request, status: FRIEND_REQUEST_STATUS_ACCEPTED })
            : request,
        ),
        sessions: payload.session
          ? [normalizeSession(payload.session), ...state.sessions.filter((item) => item.ulid !== payload.session?.ulid)]
          : state.sessions,
      }));
      await get().reconcile();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  rejectFriendRequest: async (requestId) => {
    const api = requireApi(get());
    try {
      const payload = await api.rejectFriendRequest(requestId);
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

  sendFriendRequest: async (receiverDid, message) => {
    const api = requireApi(get());
    try {
      await api.sendFriendRequest(receiverDid, message);
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
    const api = requireApi(state);
    try {
      const payload = await api.listMessages(sessionUlid);
      const messages = await decryptVisibleMessages(state, sessionUlid, (payload.messages ?? []).map(normalizeMessage));
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
    const did = state.currentUserDid?.trim() ?? '';
    if (!did) return;
    if (!force && state.currentUserProfile) return;

    if (!force && state.storage) {
      const cached = await readCachedPeerProfile(state.storage.repositories.peerProfiles, did);
      if (cached?.profile) {
        set((prev) => ({
          currentUserProfile: cached.profile,
          peerProfiles: { ...prev.peerProfiles, [did]: cached.profile },
        }));
        if (!cached.stale) return;
      }
    }

    const api = requireApi(state);
    try {
      const profile = normalizePeerProfile(await api.getPeerProfile(did));
      await state.storage?.repositories.peerProfiles.write(did, profile).catch(() => undefined);
      set((prev) => ({
        currentUserProfile: profile,
        peerProfiles: { ...prev.peerProfiles, [did]: profile },
      }));
    } catch (error) {
      set({ error: normalizeError(error) });
    }
  },

  loadPeerProfile: async (peerDid, force = false) => {
    const did = peerDid.trim();
    if (!did || did === get().currentUserDid) return;
    const state = get();
    if (!force && did in state.peerProfiles) return;
    if (state.peerProfileLoading[did]) return;

    if (!force && state.storage) {
      const cached = await readCachedPeerProfile(state.storage.repositories.peerProfiles, did);
      if (cached?.profile) {
        set((prev) => ({ peerProfiles: { ...prev.peerProfiles, [did]: cached.profile } }));
        if (!cached.stale) return;
      }
    }

    const api = requireApi(state);
    set((prev) => ({
      peerProfileLoading: { ...prev.peerProfileLoading, [did]: true },
      peerProfileErrors: { ...prev.peerProfileErrors, [did]: null },
    }));

    try {
      const profile = normalizePeerProfile(await api.getPeerProfile(did));
      await state.storage?.repositories.peerProfiles.write(did, profile).catch(() => undefined);
      set((prev) => ({
        peerProfiles: { ...prev.peerProfiles, [did]: profile },
        peerProfileLoading: { ...prev.peerProfileLoading, [did]: false },
      }));
    } catch (error) {
      set((prev) => ({
        peerProfiles: { ...prev.peerProfiles, [did]: null },
        peerProfileLoading: { ...prev.peerProfileLoading, [did]: false },
        peerProfileErrors: { ...prev.peerProfileErrors, [did]: normalizeError(error) },
      }));
    }
  },

  sendMessage: async (sessionUlid, content, attachments, messageType) => {
    const state = get();
    const api = requireApi(state);
    const authSession = requireAuthSession(state);
    const trimmed = content.trim();
    if (!trimmed && !attachments?.length) return;

    const session = state.sessions.find((item) => item.ulid === sessionUlid);
    const receiverDid = session ? peerDidFromSession(session, state.currentUserDid) : '';
    if (!receiverDid) return;

    try {
      const encryptedPlaintext = createFriendEncryptedChatPayload({
        text: trimmed,
        attachments: attachments ?? [],
        messageType,
      });
      const encryptedPayload = await encryptFriendChatPayload(authSession, sessionUlid, receiverDid, encryptedPlaintext);
      const payload = await api.sendEncryptedMessage(sessionUlid, receiverDid, encryptedPayload, encryptedPlaintext.messageType);
      if (payload.message) {
        const message = applyFriendEncryptedPayloadToMessage(normalizeMessage(payload.message), encryptedPlaintext);
        set((state) => ({
          messages: { ...state.messages, [sessionUlid]: [...(state.messages[sessionUlid] ?? []), message] },
        }));
      }
      await get().refreshSessions();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  editMessage: async (sessionUlid, messageUlid, content) => {
    const state = get();
    const api = requireApi(state);
    const authSession = requireAuthSession(state);
    const trimmed = content.trim();
    if (!trimmed) return;

    const session = state.sessions.find((item) => item.ulid === sessionUlid);
    const receiverDid = session ? peerDidFromSession(session, state.currentUserDid) : '';
    if (!receiverDid) return;

    try {
      const encryptedPlaintext = createFriendEncryptedChatPayload({ text: trimmed });
      const encryptedPayload = await encryptFriendChatPayload(authSession, sessionUlid, receiverDid, encryptedPlaintext);
      await api.editMessage(sessionUlid, messageUlid, encryptedPayload);
      get().applyMessageMutation(sessionUlid, messageUlid, 'EDIT', {
        newContent: trimmed,
        newCiphertext: encryptedPayload,
        mutatedTsUnixMs: Date.now(),
      });
      await get().refreshSessions();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  recallMessage: async (sessionUlid, messageUlid) => {
    const api = requireApi(get());
    try {
      await api.recallMessage(sessionUlid, messageUlid);
      get().applyMessageMutation(sessionUlid, messageUlid, 'RECALL', { mutatedTsUnixMs: Date.now() });
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  deleteMessage: async (sessionUlid, messageUlid) => {
    const api = requireApi(get());
    try {
      await api.deleteMessage(sessionUlid, messageUlid);
      get().applyMessageMutation(sessionUlid, messageUlid, 'DELETE', { mutatedTsUnixMs: Date.now() });
      await get().refreshSessions();
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  setPeerOnline: (did, online) =>
    set((state) => {
      const next = applyPresenceToMap(state.peerOnline, did, online);
      return next ? { peerOnline: next } : state;
    }),

  ingestRealtimeMessage: async (sessionUlid, message) => {
    const normalized = await decryptMessage(get(), sessionUlid, normalizeMessage(message));
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionUlid]: mergeMessages(state.messages[sessionUlid] ?? [], normalized),
      },
    }));

    const { api, currentUserDid, activeSessionUlid } = get();
    if (api && currentUserDid && normalized.senderDid !== currentUserDid) {
      if (activeSessionUlid === sessionUlid) {
        await get().markActiveSessionRead(sessionUlid, normalized.ulid);
      } else {
        await api.ackMessages([normalized.ulid], FRIEND_MESSAGE_STATUS_DELIVERED).catch((error) => {
          set({ error: normalizeError(error) });
        });
      }
    }
    await get().refreshSessions().catch((error) => {
      set({ error: normalizeError(error) });
    });
  },

  applyMessageReceipt: (sessionUlid, messageUlid, kind) =>
    set((state) => {
      const nextMessages = applyMessageReceiptToList(state.messages[sessionUlid], messageUlid, kind);
      return nextMessages ? { messages: { ...state.messages, [sessionUlid]: nextMessages } } : state;
    }),

  applyMessageMutation: (sessionUlid, messageUlid, kind, payload) =>
    set((state) => {
      const nextMessages = applyMessageMutationToList(state.messages[sessionUlid], messageUlid, { kind, ...payload });
      return nextMessages ? { messages: { ...state.messages, [sessionUlid]: nextMessages } } : state;
    }),

  applyTypingState: (sessionUlid, fromActorId, typing) => {
    if (!sessionUlid || !fromActorId) return;
    set((state) => {
      const next = applyTypingStateToMap(state.typingPeers, sessionUlid, fromActorId, typing);
      return next ? { typingPeers: next } : state;
    });
  },

  sweepTypingPeers: (staleBefore) =>
    set((state) => {
      const next = pruneTypingPeers(state.typingPeers, staleBefore);
      return next ? { typingPeers: next } : state;
    }),

  sendTypingState: async (sessionUlid, typing) => {
    const { api, currentUserDid, sessions } = get();
    const session = sessions.find((item) => item.ulid === sessionUlid);
    const recipientActorId = session ? peerDidFromSession(session, currentUserDid) : '';
    if (!api || !recipientActorId) return;
    await api.sendTypingState(recipientActorId, sessionUlid, typing).catch(() => {
      // Typing is ephemeral; reconcile and the next pulse heal missed frames.
    });
  },

  searchPeople: async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      set({ peopleSearchResults: [], peopleSearchError: null });
      return;
    }
    const api = requireApi(get());
    set({ peopleSearchLoading: true, peopleSearchError: null });
    try {
      const parsed = parseHandleInput(trimmed);
      if (parsed.isFederated && parsed.hasHost) {
        const view = await api.resolveFederationHandle(parsed.canonical);
        const result = federationViewToResult(view);
        set({ peopleSearchResults: result ? [result] : [], peopleSearchLoading: false });
        return;
      }
      const payload = await api.searchActors(parsed.localPart || trimmed);
      set({
        peopleSearchResults: (payload.items ?? []).map(normalizeActorSearchResult).filter((item) => item.actorId || item.id),
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
  return projectPendingInboundRequests(state.friendRequests, state.currentUserDid);
}

export function outgoingRequests(state: SocialState): FriendRequest[] {
  return projectOutgoingRequests(state.friendRequests, state.currentUserDid);
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
  did: string | null,
  getState: () => SocialState,
  setState: SocialSetState,
) {
  const storage = getState().storage;
  if (!storage || !did) return;

  const cached = await readCachedPeerProfile(storage.repositories.peerProfiles, did);
  if (!cached?.profile || getState().sessionKey !== expectedSessionKey) return;

  setState((state) => ({
    currentUserProfile: state.currentUserProfile ?? cached.profile,
    peerProfiles: did in state.peerProfiles ? state.peerProfiles : { ...state.peerProfiles, [did]: cached.profile },
  }));
}

async function readCachedPeerProfile(
  repository: DomainCacheRepository<unknown>,
  did: string,
): Promise<{ profile: PeerProfile; stale: boolean } | null> {
  const cached = await repository.read(did);
  if (!cached.envelope) return null;
  return { profile: cached.envelope.value as PeerProfile, stale: cached.stale };
}

function requireApi(state: SocialState): SocialApiClient {
  if (!state.api) {
    throw new SocialApiError({ method: 'GET', path: '/social', message: 'mobile.social.notAuthenticated' });
  }
  return state.api;
}

function requireAuthSession(state: SocialState): MobileAuthSession {
  if (!state.authSession) {
    throw new SocialApiError({ method: 'GET', path: '/social', message: 'mobile.social.notAuthenticated' });
  }
  return state.authSession;
}

async function decryptVisibleMessages(
  state: SocialState,
  sessionUlid: string,
  messages: FriendChatMessage[],
): Promise<FriendChatMessage[]> {
  const visibleMessages = visibleFriendMessages(messages);
  return Promise.all(visibleMessages.map((message) => decryptMessage(state, sessionUlid, message)));
}

async function decryptMessage(
  state: SocialState,
  sessionUlid: string,
  message: FriendChatMessage,
): Promise<FriendChatMessage> {
  if (!state.authSession || !state.currentUserDid || !message.encryptedPayload?.byteLength) return message;
  const payload = await decryptFriendChatPayload(state.authSession, {
    sessionUlid,
    senderDid: message.senderDid,
    currentUserDid: state.currentUserDid,
    encryptedPayload: message.encryptedPayload,
  }).catch(() => null);
  return payload ? applyFriendEncryptedPayloadToMessage(message, payload) : message;
}

function normalizeError(error: unknown): SocialApiError {
  if (error instanceof SocialApiError) return error;
  return new SocialApiError({ method: 'GET', path: '/social', message: readableErrorMessage(error) });
}

function resolveActorDid(session: MobileAuthSession): string | null {
  const actor = session.actor;
  const id = actor?.id || (actor?.actorId ? String(actor.actorId) : '');
  return id || null;
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
  const exists = items.some((item) => item.targetDid === nextItem.targetDid);
  return exists
    ? items.map((item) => (item.targetDid === nextItem.targetDid ? nextItem : item))
    : [nextItem, ...items];
}

function clearSessionUnreadForActor(
  sessions: FriendChatSession[],
  sessionUlid: string,
  currentUserDid: string,
): FriendChatSession[] {
  return clearChatUnreadForParticipant(sessions, sessionUlid, currentUserDid);
}
