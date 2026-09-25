/**
 * socialGateway.ts — Social domain API gateway
 *
 * Wraps friend relationships, session metadata, and conversation settings
 * behind a typed gateway with JSON quarantine and command outcome adapters.
 *
 * Temporary JSON compatibility is quarantined inside normalizer calls;
 * once Station endpoints migrate to proto, normalizers become pass-through.
 */

import type { JsonValue } from '@bufbuild/protobuf';

import type { MobileAuthSession } from '../../features/auth/authSession';
import {
  GetSocialRelationshipStatusResponseSchema,
  ListBlockedActorsResponseSchema,
  type SocialRelationshipProjection,
} from '../../gen/proto/domain/social/relationship_pb';
import { normalizeFriendRequest } from '../../features/social/socialNormalizers';
import type {
  FriendRequest,
  FriendshipStatus,
} from '../../features/social/socialTypes';
import { readableErrorMessage } from '../../features/social/socialTypes';
import type { ChatBackgroundId, FriendConversationSettings, UpdateFriendConversationSettingsInput } from '../../features/social/socialApiTypes';
import { normalizeChatBackgroundId } from '../../features/social/socialApiTypes';
import {
  socialFriendRequestAccept,
  socialFriendRequestReject,
  socialFriendRequestSend,
  socialRelationshipBlock,
  socialRelationshipUnblock,
  type ReliableFriendRequestResult,
  type ReliableRelationshipResult,
} from '../mobileCommands';
import type { CommandState } from '../../runtimes/commandRuntime';
import {
  createGatewayTransport,
  decodeProtoJsonOutcome,
  type CommandOutcome,
} from './gatewayTypes';

// ---------------------------------------------------------------------------
// JSON quarantine normalizers
// ---------------------------------------------------------------------------

interface ListFriendRequestsRaw {
  requests?: Partial<FriendRequest>[];
  total?: number;
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

export interface FriendRequestMutationResult {
  readonly request?: FriendRequest;
  readonly command: {
    readonly commandId: string;
    readonly requestId: string;
    readonly payloadSha256: readonly number[];
    readonly state: CommandState;
    readonly checkpointReady: boolean;
  };
}

export interface RelationshipMutationResult {
  readonly relationship?: FriendshipStatus;
  readonly command: {
    readonly commandId: string;
    readonly targetPtid: string;
    readonly payloadSha256: readonly number[];
    readonly state: CommandState;
    readonly checkpointReady: boolean;
  };
}

// ---------------------------------------------------------------------------
// Social gateway interface
// ---------------------------------------------------------------------------

export interface SocialGateway {
  // Friend requests
  listFriendRequests: (status?: number, limit?: number, offset?: number) => Promise<CommandOutcome<SocialFriendRequestsResult>>;
  sendFriendRequest: (receiverPtid: string, receiverHomeStationPeerId: string, federationId: string, message?: string) => Promise<CommandOutcome<FriendRequestMutationResult>>;
  acceptFriendRequest: (request: FriendRequestDecisionContext) => Promise<CommandOutcome<FriendRequestMutationResult>>;
  rejectFriendRequest: (request: FriendRequestDecisionContext) => Promise<CommandOutcome<FriendRequestMutationResult>>;

  // Conversation settings
  getConversationSettings: (
    conversationId: string,
    kind?: 'friend' | 'group',
  ) => Promise<CommandOutcome<FriendConversationSettings>>;
  updateConversationSettings: (
    conversationId: string,
    input: UpdateFriendConversationSettingsInput,
    kind?: 'friend' | 'group',
  ) => Promise<CommandOutcome<FriendConversationSettings>>;

  // Block
  blockUser: (targetPtid: string, targetHomeStationPeerId: string, observedRevision: number) => Promise<CommandOutcome<RelationshipMutationResult>>;
  unblockUser: (targetPtid: string, targetHomeStationPeerId: string, observedRevision: number) => Promise<CommandOutcome<RelationshipMutationResult>>;
  listBlockedUsers: (limit?: number, cursor?: string) => Promise<CommandOutcome<FriendshipStatus[]>>;
  getFriendshipStatus: (targetPtid: string) => Promise<CommandOutcome<FriendshipStatus>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSocialGateway(session: MobileAuthSession): SocialGateway {
  const { command } = createGatewayTransport(session, 'social');
  const { command: groupCommand } = createGatewayTransport(session, 'group');

  const getConversationSettings = async (
    conversationId: string,
    kind: 'friend' | 'group' = 'friend',
  ): Promise<CommandOutcome<FriendConversationSettings>> => {
    const result = await (kind === 'group' ? groupCommand : command)<{
      settings?: Record<string, unknown>;
    }>({
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
        return friendRequestMutationResult(response);
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
        return friendRequestMutationResult(response);
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
        return friendRequestMutationResult(response);
      }),

    // --- Conversation settings ---
    getConversationSettings,

    updateConversationSettings: async (conversationId, input, kind = 'friend') => {
      const result = await (kind === 'group' ? groupCommand : command)<Record<string, unknown>>({
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
      return getConversationSettings(conversationId, kind);
    },

    // --- Block ---
    blockUser: (targetPtid, targetHomeStationPeerId, observedRevision) =>
      invokeRelationshipCommand('/api/v1/social/relationships/block', async () => {
        const response = await socialRelationshipBlock({
          stationPeerId: session.stationPeerId,
          actorPtid: session.actorRef.ptid,
          targetPtid,
          targetHomeStationPeerId,
          observedRevision,
        });
        return relationshipMutationResult(response, targetPtid);
      }),

    unblockUser: (targetPtid, targetHomeStationPeerId, observedRevision) =>
      invokeRelationshipCommand('/api/v1/social/relationships/unblock', async () => {
        const response = await socialRelationshipUnblock({
          stationPeerId: session.stationPeerId,
          actorPtid: session.actorRef.ptid,
          targetPtid,
          targetHomeStationPeerId,
          observedRevision,
        });
        return relationshipMutationResult(response, targetPtid);
      }),

    listBlockedUsers: async (limit = 100, cursor = '') => {
      const raw = await command<JsonValue>({
        method: 'GET',
        path: '/api/v1/social/relationships/blocked',
        query: { limit, cursor },
      });
      const result = decodeProtoJsonOutcome(
        raw,
        ListBlockedActorsResponseSchema,
        {
          code: 'SOCIAL_BLOCKED_LIST_INVALID',
          message: 'Station returned an invalid blocked-actor projection',
          method: 'GET',
          path: '/api/v1/social/relationships/blocked',
        },
      );
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data.items
          .map((item) => ({
            targetPtid: item.actor?.ptid ?? '',
            targetHomeStationPeerId: item.homeStationPeerId,
            blocked: true,
            interactionAllowed: false,
            revision: Number(item.revision),
          }))
          .filter((item) => item.targetPtid),
      };
    },

    getFriendshipStatus: async (targetPtid) => {
      const raw = await command<JsonValue>({
        method: 'GET',
        path: '/api/v1/social/relationships/status',
        query: { target_ptid: targetPtid },
      });
      const result = decodeProtoJsonOutcome(
        raw,
        GetSocialRelationshipStatusResponseSchema,
        {
          code: 'SOCIAL_RELATIONSHIP_STATUS_INVALID',
          message: 'Station returned an invalid relationship projection',
          method: 'GET',
          path: '/api/v1/social/relationships/status',
        },
      );
      if (!result.ok) return result;
      return {
        ok: true,
        data: normalizeRelationshipProjection(
          result.data.relationship,
          targetPtid,
        ),
      };
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

async function invokeRelationshipCommand<T>(
  path: string,
  invokeCommand: () => Promise<T>,
): Promise<CommandOutcome<T>> {
  try {
    return { ok: true, data: await invokeCommand() };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'SOCIAL_RELATIONSHIP_COMMAND_FAILED',
        message: readableErrorMessage(error),
        method: 'POST',
        path,
      },
    };
  }
}

function friendRequestMutationResult<Response extends { readonly request?: unknown }>(
  result: ReliableFriendRequestResult<Response>,
): FriendRequestMutationResult {
  return {
    request: result.response?.request
      ? normalizeFriendRequest(result.response.request as unknown as Partial<FriendRequest>)
      : undefined,
    command: {
      commandId: result.commandId,
      requestId: result.requestId,
      payloadSha256: result.payloadSha256,
      state: result.state,
      checkpointReady: result.checkpointReady,
    },
  };
}

function relationshipMutationResult<
  Response extends {
    readonly result?: {
      readonly projection?: SocialRelationshipProjection;
    };
  },
>(
  result: ReliableRelationshipResult<Response>,
  fallbackTargetPtid: string,
): RelationshipMutationResult {
  if (result.state === 'failed-terminal') {
    throw new Error('mobile.social.relationshipCommandRejected');
  }
  return {
    relationship: result.response?.result?.projection
      ? normalizeRelationshipProjection(
          result.response.result.projection,
          fallbackTargetPtid,
        )
      : undefined,
    command: {
      commandId: result.commandId,
      targetPtid: result.targetPtid,
      payloadSha256: result.payloadSha256,
      state: result.state,
      checkpointReady: result.checkpointReady,
    },
  };
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

function normalizeRelationshipProjection(
  projection: SocialRelationshipProjection | undefined,
  fallbackTargetPtid = '',
): FriendshipStatus {
  return {
    targetPtid: projection?.targetActor?.ptid ?? fallbackTargetPtid,
    targetHomeStationPeerId: projection?.targetHomeStationPeerId,
    blocked: projection?.blockedByViewer ?? false,
    following: projection?.following ?? false,
    followedBy: projection?.followedBy ?? false,
    interactionAllowed: projection?.interactionAllowed ?? false,
    deniedReason: projection?.deniedReason,
    allowedActions: projection?.allowedActions,
    revision: Number(projection?.revision ?? 0),
  };
}
