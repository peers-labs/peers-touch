/**
 * socialGateway.ts — Social domain API gateway
 *
 * Wraps friend-chat, contacts, presence, and typing APIs behind a typed
 * gateway with JSON quarantine and command outcome adapters.
 *
 * Temporary JSON compatibility is quarantined inside normalizer calls;
 * once Station endpoints migrate to proto, normalizers become pass-through.
 */

import type { MobileAuthSession } from '../../features/auth/authSession';
import { mobileAuthScope, mobileAuthScopeKey } from '../../features/auth/mobileAuthIdentity';
import { create, toBinary } from '@bufbuild/protobuf';
import {
  ConversationCommandSchema,
  TypingCommandSchema,
} from '../../gen/proto/domain/chat/conversation_pb';
import { FriendMessageType } from '../../gen/proto/domain/chat/friend_chat_pb';
import {
  normalizeSession,
  normalizeMessage,
  normalizeFriendRequest,
} from '../../features/social/socialNormalizers';
import type {
  FriendChatMessage,
  FriendChatSession,
  FriendRequest,
  FriendshipStatus,
} from '../../features/social/socialTypes';
import { SocialApiError } from '../../features/social/socialTypes';
import { FriendshipStatus as FriendshipStatusCode } from '../../gen/proto/domain/chat/chat_pb';
import type { ChatAttachmentInput, ChatBackgroundId, FriendConversationSettings, UpdateFriendConversationSettingsInput } from '../../features/social/socialApiTypes';
import { normalizeChatBackgroundId } from '../../features/social/socialApiTypes';
import {
  createGatewayTransport,
  gatewayBytesToBase64,
  type CommandOutcome,
} from './gatewayTypes';

// ---------------------------------------------------------------------------
// JSON quarantine normalizers
// ---------------------------------------------------------------------------

interface ListFriendRequestsRaw {
  requests?: Partial<FriendRequest>[];
  total?: number;
}

interface ListSessionsRaw {
  sessions?: Partial<FriendChatSession>[];
  total?: number;
}

interface ListMessagesRaw {
  messages?: Partial<FriendChatMessage>[];
  hasMore?: boolean;
  has_more?: boolean;
}

interface ListBlockedUsersRaw {
  blockedUsers?: Array<{ actorPtid?: string; actor_ptid?: string; status?: number }>;
  blocked_users?: Array<{ actorPtid?: string; actor_ptid?: string; status?: number }>;
  total?: number;
}

interface FriendshipStatusRaw {
  friend?: { actorPtid?: string; actor_ptid?: string; status?: number };
}

// ---------------------------------------------------------------------------
// Gateway output types (clean domain objects)
// ---------------------------------------------------------------------------

export interface SocialFriendRequestsResult {
  readonly requests: FriendRequest[];
  readonly total: number;
}

export interface SocialSessionsResult {
  readonly sessions: FriendChatSession[];
  readonly total: number;
}

export interface SocialMessagesResult {
  readonly messages: FriendChatMessage[];
  readonly hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Social gateway interface
// ---------------------------------------------------------------------------

export interface SocialGateway {
  // Friend requests
  listFriendRequests: (status?: number, limit?: number, offset?: number) => Promise<CommandOutcome<SocialFriendRequestsResult>>;
  sendFriendRequest: (receiverPtid: string, message?: string) => Promise<CommandOutcome<{ request?: FriendRequest }>>;
  acceptFriendRequest: (requestId: string) => Promise<CommandOutcome<{ request?: FriendRequest; session?: FriendChatSession }>>;
  rejectFriendRequest: (requestId: string) => Promise<CommandOutcome<{ request?: FriendRequest }>>;

  // Sessions
  listSessions: (limit?: number, offset?: number) => Promise<CommandOutcome<SocialSessionsResult>>;
  createSession: (participantPtid: string) => Promise<CommandOutcome<{ session?: FriendChatSession; created?: boolean }>>;

  // Messages
  listMessages: (sessionUlid: string, beforeUlid?: string, limit?: number) => Promise<CommandOutcome<SocialMessagesResult>>;
  sendMessage: (sessionUlid: string, receiverPtid: string, content: string, attachments?: ChatAttachmentInput[], messageType?: number) => Promise<CommandOutcome<{ message?: FriendChatMessage }>>;
  sendEncryptedMessage: (sessionUlid: string, receiverPtid: string, encryptedPayload: Uint8Array, messageType?: number) => Promise<CommandOutcome<{ message?: FriendChatMessage }>>;
  sendSenderKeyDistribution: (sessionUlid: string, receiverPtid: string, encryptedPayload: Uint8Array) => Promise<CommandOutcome<{ message?: FriendChatMessage }>>;
  editMessage: (sessionUlid: string, messageUlid: string, newEncryptedPayload: Uint8Array) => Promise<CommandOutcome<Record<string, unknown>>>;
  recallMessage: (sessionUlid: string, messageUlid: string) => Promise<CommandOutcome<Record<string, unknown>>>;
  deleteMessage: (sessionUlid: string, messageUlid: string) => Promise<CommandOutcome<Record<string, unknown>>>;
  ackMessages: (ulids: string[], status: number) => Promise<CommandOutcome<Record<string, unknown>>>;
  markMessageRead: (sessionUlid: string, lastReadUlid?: string) => Promise<CommandOutcome<Record<string, unknown>>>;

  // Conversation settings
  getConversationSettings: (sessionUlid: string) => Promise<CommandOutcome<FriendConversationSettings>>;
  updateConversationSettings: (sessionUlid: string, input: UpdateFriendConversationSettingsInput) => Promise<CommandOutcome<FriendConversationSettings>>;

  // Block
  blockUser: (targetPtid: string) => Promise<CommandOutcome<Record<string, unknown>>>;
  unblockUser: (targetPtid: string) => Promise<CommandOutcome<Record<string, unknown>>>;
  listBlockedUsers: (limit?: number, offset?: number) => Promise<CommandOutcome<FriendshipStatus[]>>;
  getFriendshipStatus: (targetPtid: string) => Promise<CommandOutcome<FriendshipStatus>>;

  // Typing (proto-first)
  sendTypingState: (conversationId: string, typing: boolean) => Promise<CommandOutcome<Record<string, unknown>>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSocialGateway(session: MobileAuthSession): SocialGateway {
  const { command, stationUrl } = createGatewayTransport(session);

  // Typing uses protobuf directly (proto-first)
  async function sendTypingState(
    conversationId: string,
    typing: boolean,
  ): Promise<CommandOutcome<Record<string, unknown>>> {
    const senderPtid = mobileAuthScope(session).ptid;
    const deviceId = `mobile-web-${mobileAuthScopeKey(session)}`;
    if (!senderPtid || !conversationId.trim()) {
      return {
        ok: false,
        error: {
          code: 'SOCIAL_TYPING_INVALID_INPUT',
          message: 'authenticated actor and conversation are required',
          method: 'POST',
          path: '/messaging/typing/submit',
        },
      };
    }

    try {
      const cmd = create(ConversationCommandSchema, {
        conversationId,
        senderPtid,
        senderDeviceId: deviceId,
        payload: {
          case: 'typing',
          value: create(TypingCommandSchema, { isTyping: typing }),
        },
      });
      const response = await fetch(`${stationUrl}/messaging/typing/submit`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Accept: 'application/x-protobuf',
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/x-protobuf',
          'X-Device-ID': deviceId,
        },
        body: toBinary(ConversationCommandSchema, cmd),
      });
      if (!response.ok) {
        return {
          ok: false,
          error: {
            code: 'SOCIAL_TYPING_FAILED',
            message: `typing submit failed with status ${response.status}`,
            status: response.status,
            method: 'POST',
            path: '/messaging/typing/submit',
          },
        };
      }
      return { ok: true, data: {} };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'SOCIAL_TYPING_TRANSPORT_ERROR',
          message: error instanceof Error ? error.message : 'typing_submit_failed',
          method: 'POST',
          path: '/messaging/typing/submit',
        },
      };
    }
  }

  return {
    // --- Friend requests ---
    listFriendRequests: async (status = 0, limit = 50, offset = 0) => {
      const result = await command<ListFriendRequestsRaw>({
        method: 'GET',
        path: '/friend-chat/friend-requests',
        query: { status, limit, offset },
      });
      if (!result.ok) return result;
      // JSON quarantine: normalize raw payloads to typed domain objects
      const requests = (result.data.requests ?? []).map(normalizeFriendRequest);
      return { ok: true, data: { requests, total: result.data.total ?? requests.length } };
    },

    sendFriendRequest: (receiverPtid, message = '') =>
      command({ method: 'POST', path: '/friend-chat/friend-request/send', body: { receiver_ptid: receiverPtid, message } }),

    acceptFriendRequest: (requestId) =>
      command({ method: 'POST', path: '/friend-chat/friend-request/accept', body: { request_id: requestId } }),

    rejectFriendRequest: (requestId) =>
      command({ method: 'POST', path: '/friend-chat/friend-request/reject', body: { request_id: requestId } }),

    // --- Sessions ---
    listSessions: async (limit = 50, offset = 0) => {
      const result = await command<ListSessionsRaw>({
        method: 'GET',
        path: '/friend-chat/sessions',
        query: { limit, offset },
      });
      if (!result.ok) return result;
      const sessions = (result.data.sessions ?? []).map(normalizeSession);
      return { ok: true, data: { sessions, total: result.data.total ?? sessions.length } };
    },

    createSession: (participantPtid) =>
      command({ method: 'POST', path: '/friend-chat/session/create', body: { participant_ptid: participantPtid } }),

    // --- Messages ---
    listMessages: async (sessionUlid, beforeUlid, limit = 50) => {
      const result = await command<ListMessagesRaw>({
        method: 'GET',
        path: '/friend-chat/messages',
        query: { session_ulid: sessionUlid, before_ulid: beforeUlid, limit },
      });
      if (!result.ok) return result;
      const messages = (result.data.messages ?? []).map(normalizeMessage);
      return { ok: true, data: { messages, hasMore: Boolean(result.data.hasMore ?? result.data.has_more) } };
    },

    sendMessage: (sessionUlid, receiverPtid, content, attachments, messageType = 1) =>
      command({
        method: 'POST',
        path: '/friend-chat/message/send',
        body: {
          session_ulid: sessionUlid,
          receiver_ptid: receiverPtid,
          content,
          type: messageType,
          ...(attachments?.length ? { attachments } : {}),
        },
      }),

    sendEncryptedMessage: (sessionUlid, receiverPtid, encryptedPayload, messageType = 1) =>
      command({
        method: 'POST',
        path: '/friend-chat/message/send',
        body: {
          session_ulid: sessionUlid,
          receiver_ptid: receiverPtid,
          content: '',
          type: messageType,
          encrypted_payload: gatewayBytesToBase64(encryptedPayload),
        },
      }),

    sendSenderKeyDistribution: (sessionUlid, receiverPtid, encryptedPayload) =>
      command({
        method: 'POST',
        path: '/friend-chat/message/send',
        body: {
          session_ulid: sessionUlid,
          receiver_ptid: receiverPtid,
          content: '',
          type: FriendMessageType.SENDER_KEY_DISTRIBUTION,
          encrypted_payload: gatewayBytesToBase64(encryptedPayload),
        },
      }),

    editMessage: (sessionUlid, messageUlid, newEncryptedPayload) =>
      command({
        method: 'POST',
        path: '/friend-chat/message/edit',
        body: {
          session_ulid: sessionUlid,
          message_ulid: messageUlid,
          new_content: '',
          new_encrypted_payload: gatewayBytesToBase64(newEncryptedPayload),
        },
      }),

    recallMessage: (sessionUlid, messageUlid) =>
      command({ method: 'POST', path: '/friend-chat/message/recall', body: { session_ulid: sessionUlid, message_ulid: messageUlid } }),

    deleteMessage: (sessionUlid, messageUlid) =>
      command({ method: 'POST', path: '/friend-chat/message/delete', body: { session_ulid: sessionUlid, message_ulid: messageUlid } }),

    ackMessages: (ulids, status) =>
      command({ method: 'POST', path: '/friend-chat/message/ack', body: { ulids, status } }),

    markMessageRead: (sessionUlid, lastReadUlid) =>
      command({ method: 'POST', path: '/friend-chat/message/read', body: { session_ulid: sessionUlid, last_read_ulid: lastReadUlid } }),

    // --- Conversation settings ---
    getConversationSettings: async (sessionUlid) => {
      const result = await command<{ settings?: Record<string, unknown> }>({
        method: 'GET',
        path: '/friend-chat/settings',
        query: { session_ulid: sessionUlid },
      });
      if (!result.ok) return result;
      return { ok: true, data: normalizeConversationSettings(result.data.settings ?? result.data) };
    },

    updateConversationSettings: async (sessionUlid, input) => {
      const result = await command<{ settings?: Record<string, unknown> }>({
        method: 'PUT',
        path: '/friend-chat/settings',
        body: {
          session_ulid: sessionUlid,
          ...(input.isMuted !== undefined ? { is_muted: input.isMuted } : {}),
          ...(input.isPinned !== undefined ? { is_pinned: input.isPinned } : {}),
          ...(input.alertEnabled !== undefined ? { alert_enabled: input.alertEnabled } : {}),
          ...(input.background !== undefined ? { background: input.background } : {}),
          ...(input.clearedAt !== undefined ? { cleared_at_unix_ms: input.clearedAt } : {}),
        },
      });
      if (!result.ok) return result;
      return { ok: true, data: normalizeConversationSettings(result.data.settings ?? result.data) };
    },

    // --- Block ---
    blockUser: (targetPtid) =>
      command({ method: 'POST', path: '/friend-chat/block', body: { target_ptid: targetPtid } }),

    unblockUser: (targetPtid) =>
      command({ method: 'DELETE', path: '/friend-chat/block', body: { target_ptid: targetPtid } }),

    listBlockedUsers: async (limit = 100, offset = 0) => {
      const result = await command<ListBlockedUsersRaw>({
        method: 'GET',
        path: '/friend-chat/blocked',
        query: { limit, offset },
      });
      if (!result.ok) return result;
      const blockedUsers = result.data.blockedUsers ?? result.data.blocked_users ?? [];
      const statuses = blockedUsers
        .map((item) => normalizeFriendshipStatusFromRaw({ friend: item }))
        .filter((item) => item.targetPtid);
      return { ok: true, data: statuses };
    },

    getFriendshipStatus: async (targetPtid) => {
      const result = await command<FriendshipStatusRaw>({
        method: 'GET',
        path: '/friend-chat/friendship/status',
        query: { target_ptid: targetPtid },
      });
      if (!result.ok) return result;
      return { ok: true, data: normalizeFriendshipStatusFromRaw(result.data, targetPtid) };
    },

    sendTypingState,
  };
}

// ---------------------------------------------------------------------------
// JSON quarantine normalizers (private)
// ---------------------------------------------------------------------------

function normalizeConversationSettings(payload: unknown): FriendConversationSettings {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  return {
    sessionUlid: String(record.sessionUlid ?? record.session_ulid ?? ''),
    isMuted: Boolean(record.isMuted ?? record.is_muted),
    isPinned: Boolean(record.isPinned ?? record.is_pinned),
    alertEnabled: (record.alertEnabled ?? record.alert_enabled) !== false,
    background: normalizeChatBackgroundId(record.background),
    clearedAt: Number(record.clearedAtUnixMs ?? record.cleared_at_unix_ms ?? 0),
  };
}

function normalizeFriendshipStatusFromRaw(
  payload: FriendshipStatusRaw,
  fallbackTargetPtid = '',
): FriendshipStatus {
  const friend = payload.friend;
  return {
    targetPtid: String(friend?.actor_ptid ?? friend?.actorPtid ?? fallbackTargetPtid),
    blocked: Number(friend?.status ?? 0) === FriendshipStatusCode.BLOCKED,
  };
}
