import type { MobileAuthSession } from '../auth/authSession';
import {
  SocialApiError,
  type ActorSearchResult,
  type FederationResolveView,
  type FriendChatMessage,
  type FriendChatSession,
  type FriendRequest,
  type PeerProfile,
  type SocialNotification,
  type StationErrorEnvelope,
  type StationSuccessEnvelope,
  type UnreadCounts,
} from './socialTypes';

type HttpMethod = 'GET' | 'POST';

interface SocialRequestOptions {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
}

interface ListFriendRequestsPayload {
  requests?: FriendRequest[];
  total?: number;
}

interface ListSessionsPayload {
  sessions?: FriendChatSession[];
  total?: number;
}

interface ListMessagesPayload {
  messages?: FriendChatMessage[];
  hasMore?: boolean;
  has_more?: boolean;
}

interface SearchMessagesPayload {
  messages?: FriendChatMessage[];
  total?: number;
}

interface ListNotificationsPayload {
  notifications?: SocialNotification[];
  nextCursor?: string;
  next_cursor?: string;
  totalCount?: number;
  total_count?: number;
  unreadCount?: number;
  unread_count?: number;
}

interface ActorSearchPayload {
  items?: ActorSearchResult[];
  total?: number;
}

export interface SocialApiClient {
  listFriendRequests: (status?: number, limit?: number, offset?: number) => Promise<ListFriendRequestsPayload>;
  acceptFriendRequest: (requestId: string) => Promise<{ request?: FriendRequest; session?: FriendChatSession }>;
  rejectFriendRequest: (requestId: string) => Promise<{ request?: FriendRequest }>;
  sendFriendRequest: (receiverDid: string, message?: string) => Promise<{ request?: FriendRequest }>;
  listSessions: (limit?: number, offset?: number) => Promise<ListSessionsPayload>;
  createSession: (participantDid: string) => Promise<{ session?: FriendChatSession; created?: boolean }>;
  listMessages: (sessionUlid: string, beforeUlid?: string, limit?: number) => Promise<ListMessagesPayload>;
  searchMessages: (query: string, sessionUlid?: string, limit?: number, offset?: number) => Promise<SearchMessagesPayload>;
  sendMessage: (sessionUlid: string, receiverDid: string, content: string) => Promise<{ message?: FriendChatMessage }>;
  editMessage: (sessionUlid: string, messageUlid: string, newContent: string) => Promise<Record<string, unknown>>;
  recallMessage: (sessionUlid: string, messageUlid: string) => Promise<Record<string, unknown>>;
  deleteMessage: (sessionUlid: string, messageUlid: string) => Promise<Record<string, unknown>>;
  ackMessages: (ulids: string[], status: number) => Promise<Record<string, unknown>>;
  markMessageRead: (sessionUlid: string, lastReadUlid?: string) => Promise<Record<string, unknown>>;
  sendTypingState: (recipientActorId: string, sessionUlid: string, typing: boolean) => Promise<Record<string, unknown>>;
  listNotifications: (limit?: number, cursor?: string) => Promise<ListNotificationsPayload>;
  getUnreadCounts: () => Promise<UnreadCounts>;
  markNotificationsRead: (notificationIds: string[]) => Promise<Record<string, unknown>>;
  markAllNotificationsRead: (category?: number) => Promise<Record<string, unknown>>;
  deleteNotifications: (notificationIds: string[]) => Promise<Record<string, unknown>>;
  searchActors: (query: string) => Promise<ActorSearchPayload>;
  getPeerProfile: (did: string) => Promise<PeerProfile>;
  resolveFederationHandle: (handle: string) => Promise<FederationResolveView>;
}

export function createSocialApiClient(session: MobileAuthSession): SocialApiClient {
  const stationUrl = session.stationUrl.replace(/\/+$/, '');

  async function request<T>(options: SocialRequestOptions): Promise<T> {
    const url = buildUrl(stationUrl, options.path, options.query);
    let response: Response;

    try {
      response = await fetch(url, {
        method: options.method,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      throw new SocialApiError({
        method: options.method,
        path: options.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw buildApiError(options.method, options.path, response.status, payload);
    }

    return unwrapPayload<T>(payload);
  }

  return {
    listFriendRequests: (status = 0, limit = 50, offset = 0) =>
      request<ListFriendRequestsPayload>({
        method: 'GET',
        path: '/friend-chat/friend-requests',
        query: { status, limit, offset },
      }),
    acceptFriendRequest: (requestId) =>
      request({
        method: 'POST',
        path: '/friend-chat/friend-request/accept',
        body: { request_id: requestId },
      }),
    rejectFriendRequest: (requestId) =>
      request({
        method: 'POST',
        path: '/friend-chat/friend-request/reject',
        body: { request_id: requestId },
      }),
    sendFriendRequest: (receiverDid, message = '') =>
      request({
        method: 'POST',
        path: '/friend-chat/friend-request/send',
        body: { receiver_did: receiverDid, message },
      }),
    listSessions: (limit = 50, offset = 0) =>
      request<ListSessionsPayload>({
        method: 'GET',
        path: '/friend-chat/sessions',
        query: { limit, offset },
      }),
    createSession: (participantDid) =>
      request({
        method: 'POST',
        path: '/friend-chat/session/create',
        body: { participant_did: participantDid },
      }),
    listMessages: (sessionUlid, beforeUlid, limit = 50) =>
      request<ListMessagesPayload>({
        method: 'GET',
        path: '/friend-chat/messages',
        query: { session_ulid: sessionUlid, before_ulid: beforeUlid, limit },
      }),
    searchMessages: (query, sessionUlid = '', limit = 50, offset = 0) =>
      request<SearchMessagesPayload>({
        method: 'GET',
        path: '/friend-chat/messages/search',
        query: { query, session_ulid: sessionUlid, limit, offset },
      }),
    sendMessage: (sessionUlid, receiverDid, content) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/send',
        body: { session_ulid: sessionUlid, receiver_did: receiverDid, content, type: 1 },
      }),
    editMessage: (sessionUlid, messageUlid, newContent) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/edit',
        body: { session_ulid: sessionUlid, message_ulid: messageUlid, new_content: newContent },
      }),
    recallMessage: (sessionUlid, messageUlid) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/recall',
        body: { session_ulid: sessionUlid, message_ulid: messageUlid },
      }),
    deleteMessage: (sessionUlid, messageUlid) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/delete',
        body: { session_ulid: sessionUlid, message_ulid: messageUlid },
      }),
    markMessageRead: (sessionUlid, lastReadUlid) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/read',
        body: { session_ulid: sessionUlid, last_read_ulid: lastReadUlid },
      }),
    ackMessages: (ulids, status) =>
      request({
        method: 'POST',
        path: '/friend-chat/message/ack',
        body: { ulids, status },
      }),
    sendTypingState: (recipientActorId, sessionUlid, typing) =>
      request({
        method: 'POST',
        path: '/realtime/typing',
        body: { recipient_actor_id: recipientActorId, session_ulid: sessionUlid, typing },
      }),
    listNotifications: (limit = 30, cursor) =>
      request<ListNotificationsPayload>({
        method: 'GET',
        path: '/notification/list',
        query: { limit, cursor },
      }),
    getUnreadCounts: () =>
      request<UnreadCounts>({
        method: 'GET',
        path: '/notification/unread-counts',
      }),
    markNotificationsRead: (notificationIds) =>
      request({
        method: 'POST',
        path: '/notification/mark-read',
        body: { notification_ids: notificationIds },
      }),
    markAllNotificationsRead: (category = 0) =>
      request({
        method: 'POST',
        path: '/notification/mark-all-read',
        body: { category },
      }),
    deleteNotifications: (notificationIds) =>
      request({
        method: 'POST',
        path: '/notification/delete',
        body: { notification_ids: notificationIds },
      }),
    searchActors: (query) =>
      request<ActorSearchPayload>({
        method: 'GET',
        path: '/api/v1/social/users/search',
        query: { q: query },
      }),
    getPeerProfile: (did) =>
      request<PeerProfile>({
        method: 'GET',
        path: `/actor/actors/${encodeURIComponent(did)}/profile`,
      }),
    resolveFederationHandle: (handle) =>
      request<FederationResolveView>({
        method: 'GET',
        path: '/actor/federation/resolve',
        query: { handle },
      }),
  };
}

function buildUrl(stationUrl: string, path: string, query?: SocialRequestOptions['query']): string {
  const url = new URL(path, `${stationUrl}/`);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function unwrapPayload<T>(payload: unknown): T {
  const envelope = payload as StationSuccessEnvelope<T>;
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    return (envelope.data ?? {}) as T;
  }
  return (payload ?? {}) as T;
}

function buildApiError(method: HttpMethod, path: string, status: number, payload: unknown): SocialApiError {
  const envelope = payload as StationErrorEnvelope;
  const message = envelope?.message || envelope?.msg || envelope?.detail || envelope?.code || 'request_failed';
  return new SocialApiError({
    method,
    path,
    status,
    code: envelope?.code ? String(envelope.code) : undefined,
    message: String(message),
  });
}
