/**
 * socialGateway.ts — Social domain API gateway
 *
 * Wraps friend relationships, session metadata, and conversation settings
 * behind a typed gateway with JSON quarantine and command outcome adapters.
 *
 * Temporary JSON compatibility is quarantined inside normalizer calls;
 * once Station endpoints migrate to proto, normalizers become pass-through.
 */

import type { MobileAuthSession } from '../../features/auth/authSession';
import { normalizeFriendRequest } from '../../features/social/socialNormalizers';
import type {
  FriendRequest,
  FriendshipStatus,
} from '../../features/social/socialTypes';
import { readableErrorMessage } from '../../features/social/socialTypes';
import { FriendshipStatus as FriendshipStatusCode } from '../../gen/proto/domain/chat/chat_pb';
import type { ChatBackgroundId, FriendConversationSettings, UpdateFriendConversationSettingsInput } from '../../features/social/socialApiTypes';
import { normalizeChatBackgroundId } from '../../features/social/socialApiTypes';
import {
  socialFriendRequestAccept,
  socialFriendRequestReject,
  socialFriendRequestSend,
} from '../mobileCommands';
import {
  createGatewayTransport,
  type CommandOutcome,
} from './gatewayTypes';

// ---------------------------------------------------------------------------
// JSON quarantine normalizers
// ---------------------------------------------------------------------------

interface ListFriendRequestsRaw {
  requests?: Partial<FriendRequest>[];
  total?: number;
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

type FriendRequestDecisionContext = Pick<
  FriendRequest,
  | 'requestId'
  | 'federationId'
  | 'senderPtid'
  | 'receiverPtid'
  | 'senderHomeStationPeerId'
  | 'receiverHomeStationPeerId'
>;

// ---------------------------------------------------------------------------
// Social gateway interface
// ---------------------------------------------------------------------------

export interface SocialGateway {
  // Friend requests
  listFriendRequests: (status?: number, limit?: number, offset?: number) => Promise<CommandOutcome<SocialFriendRequestsResult>>;
  sendFriendRequest: (receiverPtid: string, receiverHomeStationPeerId: string, federationId: string, message?: string) => Promise<CommandOutcome<{ request?: FriendRequest }>>;
  acceptFriendRequest: (request: FriendRequestDecisionContext) => Promise<CommandOutcome<{ request?: FriendRequest }>>;
  rejectFriendRequest: (request: FriendRequestDecisionContext) => Promise<CommandOutcome<{ request?: FriendRequest }>>;

  // Conversation settings
  getConversationSettings: (sessionUlid: string) => Promise<CommandOutcome<FriendConversationSettings>>;
  updateConversationSettings: (sessionUlid: string, input: UpdateFriendConversationSettingsInput) => Promise<CommandOutcome<FriendConversationSettings>>;

  // Block
  blockUser: (targetPtid: string) => Promise<CommandOutcome<Record<string, unknown>>>;
  unblockUser: (targetPtid: string) => Promise<CommandOutcome<Record<string, unknown>>>;
  listBlockedUsers: (limit?: number, offset?: number) => Promise<CommandOutcome<FriendshipStatus[]>>;
  getFriendshipStatus: (targetPtid: string) => Promise<CommandOutcome<FriendshipStatus>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSocialGateway(session: MobileAuthSession): SocialGateway {
  const { command } = createGatewayTransport(session);

  const getConversationSettings = async (
    conversationId: string,
  ): Promise<CommandOutcome<FriendConversationSettings>> => {
    const result = await command<{ settings?: Record<string, unknown> }>({
      method: 'GET',
      path: '/conversation/member/settings',
      query: { conversation_id: conversationId },
    });
    if (!result.ok) return result;
    return {
      ok: true,
      data: normalizeConversationSettings(
        result.data.settings ?? result.data,
        conversationId,
      ),
    };
  };

  return {
    // --- Friend requests ---
    listFriendRequests: async (status = 0, limit = 50, offset = 0) => {
      const result = await command<ListFriendRequestsRaw>({
        method: 'GET',
        path: '/api/v1/social/friend-requests',
        query: { state: status, limit, offset },
      });
      if (!result.ok) return result;
      // JSON quarantine: normalize raw payloads to typed domain objects
      const requests = (result.data.requests ?? []).map(normalizeFriendRequest);
      return { ok: true, data: { requests, total: result.data.total ?? requests.length } };
    },

    sendFriendRequest: (receiverPtid, receiverHomeStationPeerId, federationId, message = '') =>
      invokeFriendRequestCommand('/api/v1/social/friend-request/send', async () => {
        const response = await socialFriendRequestSend({
          stationPeerId: session.stationPeerId,
          actorPtid: session.actorRef.ptid,
          receiverPtid,
          receiverHomeStationPeerId,
          federationId,
          message,
        });
        return {
          request: response.request
            ? normalizeFriendRequest(response.request as unknown as Partial<FriendRequest>)
            : undefined,
        };
      }),

    acceptFriendRequest: (request) =>
      invokeFriendRequestCommand('/api/v1/social/friend-request/accept', async () => {
        const response = await socialFriendRequestAccept({
          stationPeerId: session.stationPeerId,
          actorPtid: session.actorRef.ptid,
          requestId: request.requestId,
          senderPtid: request.senderPtid,
          receiverPtid: request.receiverPtid,
          senderHomeStationPeerId: request.senderHomeStationPeerId,
          receiverHomeStationPeerId: request.receiverHomeStationPeerId,
          federationId: request.federationId,
        });
        return {
          request: response.request
            ? normalizeFriendRequest(response.request as unknown as Partial<FriendRequest>)
            : undefined,
        };
      }),

    rejectFriendRequest: (request) =>
      invokeFriendRequestCommand('/api/v1/social/friend-request/reject', async () => {
        const response = await socialFriendRequestReject({
          stationPeerId: session.stationPeerId,
          actorPtid: session.actorRef.ptid,
          requestId: request.requestId,
          senderPtid: request.senderPtid,
          receiverPtid: request.receiverPtid,
          senderHomeStationPeerId: request.senderHomeStationPeerId,
          receiverHomeStationPeerId: request.receiverHomeStationPeerId,
          federationId: request.federationId,
        });
        return {
          request: response.request
            ? normalizeFriendRequest(response.request as unknown as Partial<FriendRequest>)
            : undefined,
        };
      }),

    // --- Conversation settings ---
    getConversationSettings,

    updateConversationSettings: async (conversationId, input) => {
      const result = await command<Record<string, unknown>>({
        method: 'PUT',
        path: '/conversation/member/settings',
        body: {
          conversation_id: conversationId,
          settings: {
            ...(input.isMuted !== undefined ? { muted: input.isMuted } : {}),
            ...(input.isPinned !== undefined ? { pinned: input.isPinned } : {}),
            ...(input.alertEnabled !== undefined ? { alert_enabled: input.alertEnabled } : {}),
            ...(input.background !== undefined ? { background: input.background } : {}),
            ...(input.clearedAt !== undefined ? { cleared_at_ms: input.clearedAt } : {}),
          },
        },
      });
      if (!result.ok) return result;
      return getConversationSettings(conversationId);
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
  };
}

// ---------------------------------------------------------------------------
// JSON quarantine normalizers (private)
// ---------------------------------------------------------------------------

async function invokeFriendRequestCommand<T>(
  path: string,
  invokeCommand: () => Promise<T>,
): Promise<CommandOutcome<T>> {
  try {
    return { ok: true, data: await invokeCommand() };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'SOCIAL_FRIEND_REQUEST_COMMAND_FAILED',
        message: readableErrorMessage(error),
        method: 'POST',
        path,
      },
    };
  }
}

function normalizeConversationSettings(
  payload: unknown,
  fallbackConversationId = '',
): FriendConversationSettings {
  const record = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  return {
    sessionUlid: String(
      record.conversationId
      ?? record.conversation_id
      ?? record.sessionUlid
      ?? record.session_ulid
      ?? fallbackConversationId,
    ),
    isMuted: Boolean(record.muted ?? record.isMuted ?? record.is_muted),
    isPinned: Boolean(record.pinned ?? record.isPinned ?? record.is_pinned),
    alertEnabled: (record.alertEnabled ?? record.alert_enabled) !== false,
    background: normalizeChatBackgroundId(record.background),
    clearedAt: Number(
      record.clearedAtMs
      ?? record.cleared_at_ms
      ?? record.clearedAtUnixMs
      ?? record.cleared_at_unix_ms
      ?? 0,
    ),
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
