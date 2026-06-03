import { create } from 'zustand';

import type { MobileAuthSession } from '../auth/authSession';
import { createSocialApiClient, type SocialApiClient } from './socialApi';
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
  applyMessageReceiptToList,
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
  SocialApiError,
  type FriendChatMessage,
  type FriendChatSession,
  type FriendRequest,
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
  currentUserDid: string | null;
  api: SocialApiClient | null;
  sessions: FriendChatSession[];
  friendRequests: FriendRequest[];
  messages: Record<string, FriendChatMessage[]>;
  notifications: SocialNotification[];
  notificationNextCursor: string;
  notificationHasMore: boolean;
  unreadCounts: UnreadCounts;
  peerOnline: Record<string, boolean>;
  peerProfiles: Record<string, PeerProfile | null>;
  peerProfileLoading: Record<string, boolean>;
  peerProfileErrors: Record<string, SocialApiError | null>;
  typingPeers: Record<string, Record<string, TypingEntry>>;
  peopleSearchResults: ActorSearchResult[];
  peopleSearchLoading: boolean;
  peopleSearchError: SocialApiError | null;
  messageSearchResults: FriendChatMessage[];
  messageSearchLoading: boolean;
  messageSearchError: SocialApiError | null;
  activeSessionUlid: string | null;
  loading: boolean;
  error: SocialApiError | null;
  lastReconcileAt: number | null;
  bindSession: (session: MobileAuthSession | null) => void;
  reconcile: () => Promise<void>;
  refreshFriendRequests: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  loadMoreNotifications: () => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  acceptFriendRequest: (requestId: string) => Promise<void>;
  rejectFriendRequest: (requestId: string) => Promise<void>;
  sendFriendRequest: (receiverDid: string, message?: string) => Promise<void>;
  selectSession: (sessionUlid: string | null) => Promise<void>;
  loadMessages: (sessionUlid: string) => Promise<void>;
  loadPeerProfile: (peerDid: string, force?: boolean) => Promise<void>;
  sendMessage: (sessionUlid: string, content: string) => Promise<void>;
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
  searchMessages: (query: string, sessionUlid?: string) => Promise<void>;
  clearMessageSearch: () => void;
  clearError: () => void;
}

const emptyUnreadCounts: UnreadCounts = { total: 0, byCategory: {} };

export const useSocialStore = create<SocialState>((set, get) => ({
  sessionKey: null,
  currentUserDid: null,
  api: null,
  sessions: [],
  friendRequests: [],
  messages: {},
  notifications: [],
  notificationNextCursor: '',
  notificationHasMore: false,
  unreadCounts: emptyUnreadCounts,
  peerOnline: {},
  peerProfiles: {},
  peerProfileLoading: {},
  peerProfileErrors: {},
  typingPeers: {},
  peopleSearchResults: [],
  peopleSearchLoading: false,
  peopleSearchError: null,
  messageSearchResults: [],
  messageSearchLoading: false,
  messageSearchError: null,
  activeSessionUlid: null,
  loading: false,
  error: null,
  lastReconcileAt: null,

  bindSession: (session) => {
    if (!session) {
      set({
        sessionKey: null,
        currentUserDid: null,
        api: null,
        sessions: [],
        friendRequests: [],
        messages: {},
        notifications: [],
        notificationNextCursor: '',
        notificationHasMore: false,
        unreadCounts: emptyUnreadCounts,
        peerOnline: {},
        peerProfiles: {},
        peerProfileLoading: {},
        peerProfileErrors: {},
        typingPeers: {},
        peopleSearchResults: [],
        peopleSearchLoading: false,
        peopleSearchError: null,
        messageSearchResults: [],
        messageSearchLoading: false,
        messageSearchError: null,
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
      currentUserDid: resolveActorDid(session),
      api: createSocialApiClient(session),
      sessions: [],
      friendRequests: [],
      messages: {},
      notifications: [],
      notificationNextCursor: '',
      notificationHasMore: false,
      unreadCounts: emptyUnreadCounts,
      peerOnline: {},
      peerProfiles: {},
      peerProfileLoading: {},
      peerProfileErrors: {},
      typingPeers: {},
      peopleSearchResults: [],
      peopleSearchLoading: false,
      peopleSearchError: null,
      messageSearchResults: [],
      messageSearchLoading: false,
      messageSearchError: null,
      activeSessionUlid: null,
      loading: false,
      error: null,
      lastReconcileAt: null,
    });
  },

  reconcile: async () => {
    const { refreshFriendRequests, refreshSessions, refreshNotifications } = get();
    set({ loading: true, error: null });
    try {
      await Promise.all([refreshFriendRequests(), refreshSessions(), refreshNotifications()]);
      set({ lastReconcileAt: Date.now(), loading: false });
    } catch (error) {
      set({ error: normalizeError(error), loading: false });
    }
  },

  refreshFriendRequests: async () => {
    const api = requireApi(get());
    const payload = await api.listFriendRequests();
    set({ friendRequests: (payload.requests ?? []).map(normalizeFriendRequest) });
  },

  refreshSessions: async () => {
    const api = requireApi(get());
    const payload = await api.listSessions();
    const sessions = (payload.sessions ?? []).map(normalizeSession);
    set((state) => ({
      sessions,
      peerOnline: { ...seedPresenceFromSessions(sessions, state.currentUserDid), ...state.peerOnline },
    }));
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
    if (sessionUlid) await get().loadMessages(sessionUlid);
  },

  loadMessages: async (sessionUlid) => {
    const api = requireApi(get());
    try {
      const payload = await api.listMessages(sessionUlid);
      const messages = visibleFriendMessages((payload.messages ?? []).map(normalizeMessage));
      set((state) => ({
        messages: { ...state.messages, [sessionUlid]: messages },
      }));
      const lastReadUlid = messages.at(-1)?.ulid;
      if (lastReadUlid) {
        await api.markMessageRead(sessionUlid, lastReadUlid);
        await get().refreshSessions();
      }
    } catch (error) {
      set({ error: normalizeError(error) });
      throw error;
    }
  },

  loadPeerProfile: async (peerDid, force = false) => {
    const did = peerDid.trim();
    if (!did || did === get().currentUserDid) return;
    const state = get();
    if (!force && did in state.peerProfiles) return;
    if (state.peerProfileLoading[did]) return;

    const api = requireApi(state);
    set((prev) => ({
      peerProfileLoading: { ...prev.peerProfileLoading, [did]: true },
      peerProfileErrors: { ...prev.peerProfileErrors, [did]: null },
    }));

    try {
      const profile = normalizePeerProfile(await api.getPeerProfile(did));
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

  sendMessage: async (sessionUlid, content) => {
    const api = requireApi(get());
    const trimmed = content.trim();
    if (!trimmed) return;

    const session = get().sessions.find((item) => item.ulid === sessionUlid);
    const receiverDid = session ? peerDidFromSession(session, get().currentUserDid) : '';
    if (!receiverDid) return;

    try {
      const payload = await api.sendMessage(sessionUlid, receiverDid, trimmed);
      if (payload.message) {
        const message = normalizeMessage(payload.message);
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
    const api = requireApi(get());
    const trimmed = content.trim();
    if (!trimmed) return;

    try {
      await api.editMessage(sessionUlid, messageUlid, trimmed);
      get().applyMessageMutation(sessionUlid, messageUlid, 'EDIT', {
        newContent: trimmed,
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
    set((state) => ({
      peerOnline: { ...state.peerOnline, [did]: online },
    })),

  ingestRealtimeMessage: async (sessionUlid, message) => {
    const normalized = normalizeMessage(message);
    set((state) => ({
      messages: {
        ...state.messages,
        [sessionUlid]: mergeMessages(state.messages[sessionUlid] ?? [], normalized),
      },
    }));

    const { api, currentUserDid, activeSessionUlid } = get();
    if (api && currentUserDid && normalized.senderDid !== currentUserDid) {
      const status = activeSessionUlid === sessionUlid ? FRIEND_MESSAGE_STATUS_READ : FRIEND_MESSAGE_STATUS_DELIVERED;
      await api.ackMessages([normalized.ulid], status).catch((error) => {
        set({ error: normalizeError(error) });
      });
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
      const sessionMap = state.typingPeers[sessionUlid] ?? {};
      if (!typing && !sessionMap[fromActorId]) return state;
      return {
        typingPeers: {
          ...state.typingPeers,
          [sessionUlid]: {
            ...sessionMap,
            [fromActorId]: { typing, lastUpdate: Date.now() },
          },
        },
      };
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

  searchMessages: async (query, sessionUlid) => {
    const trimmed = query.trim();
    if (!trimmed) {
      set({ messageSearchResults: [], messageSearchError: null });
      return;
    }
    const api = requireApi(get());
    set({ messageSearchLoading: true, messageSearchError: null });
    try {
      const payload = await api.searchMessages(trimmed, sessionUlid);
      set({
        messageSearchResults: visibleFriendMessages((payload.messages ?? []).map(normalizeMessage)),
        messageSearchLoading: false,
      });
    } catch (error) {
      set({ messageSearchResults: [], messageSearchLoading: false, messageSearchError: normalizeError(error) });
    }
  },

  clearMessageSearch: () => set({ messageSearchResults: [], messageSearchError: null, messageSearchLoading: false }),

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
  const status = error.context.status ? ` HTTP ${error.context.status}` : '';
  const code = error.context.code ? ` code=${error.context.code}` : '';
  return `${error.context.method} ${error.context.path}${status}${code}: ${error.context.message}`;
}

function requireApi(state: SocialState): SocialApiClient {
  if (!state.api) {
    throw new SocialApiError({ method: 'GET', path: '/social', message: 'mobile.social.notAuthenticated' });
  }
  return state.api;
}

function normalizeError(error: unknown): SocialApiError {
  if (error instanceof SocialApiError) return error;
  return new SocialApiError({ method: 'GET', path: '/social', message: error instanceof Error ? error.message : String(error) });
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
