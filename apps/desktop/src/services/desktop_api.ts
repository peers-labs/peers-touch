import { invoke } from '@tauri-apps/api/core';
import {
  create,
  fromBinary,
  fromJsonString,
  toBinary,
  toJson,
} from '@bufbuild/protobuf';
import type { JsonValue, Message as ProtoMessage } from '@bufbuild/protobuf';
import type { GenMessage } from '@bufbuild/protobuf/codegenv2';
import { log } from '../utils/logger';
import { resolvePresenceOnline } from './chatPresence';
import { throttleInvoke } from '../kernel/invokeThrottler';
import { eventBus } from '../kernel/events/bus';
import { EVENT } from '../kernel/events/catalog';
import { readDesktopPreferenceSync } from '../storage/desktopClientStorage';
import type { AccessDecision } from './accessGate';
import type {
  DesktopFrontendTelemetryEvent,
  FrontendTelemetryUploadResult,
} from '../kernel/frontendTelemetry';
import type {
  AgentTurnStreamEventPayload,
  RealtimeCallSignalKind,
  SessionRevokedPayload,
  SessionRevokedReason,
} from '../kernel/events/types';
import {
  AcceptSocialFriendRequestResponseSchema,
  ListSocialFriendRequestsResponseSchema,
  RejectSocialFriendRequestResponseSchema,
  SendSocialFriendRequestResponseSchema,
} from '../gen/proto/domain/social/relationship_pb';
import {
  ChatStorageConversationRequestSchema,
  ChatStorageResultSchema,
  ChatStorageRetentionRequestSchema,
  ChatStorageSnapshotRequestSchema,
  ChatStorageSnapshotSchema,
  type ChatRetentionPreset,
} from '../gen/proto/domain/chat/storage_pb';
export type {
  ChatRetentionPreset,
  ChatStorageResult,
  ChatStorageSnapshot,
  ConversationStorageUsage,
} from '../gen/proto/domain/chat/storage_pb';
export type {
  ActorList,
  ActorProfile,
  Actor,
} from '../gen/proto/domain/actor/actor_pb';
import {
  FederationSelfViewSchema,
} from '../gen/proto/domain/federation/federation_self_pb';
import {
  FederationResolveViewSchema,
} from '../gen/proto/domain/federation/federation_resolve_pb';
import {
  FederationHealthViewSchema,
} from '../gen/proto/domain/federation/federation_health_pb';
import {
  FederationCatalogSearchResponseSchema,
} from '../gen/proto/domain/federation/federation_discovery_pb';
import {
  CreateFederationResponseSchema,
  DeleteFederationResponseSchema,
  JoinFederationResponseSchema,
  LeaveFederationResponseSchema,
  ListFederationsResponseSchema,
  ListMemberStationsResponseSchema,
} from '../gen/proto/domain/federation/federation_projection_service_pb';
import type {
  Conversation as ProtoAgentConversation,
  ExportTurnDiagnosticsResponse,
  GetTurnTraceResponse,
  ListTurnFeedbackResponse,
  ListTurnTracesResponse,
  RecordFeedbackResponse,
  ResetConversationRuntimeResponse,
} from '../gen/proto/domain/agent/agent_pb';
import {
  ExportTurnDiagnosticsResponseSchema,
  ListTurnFeedbackResponseSchema,
  RecordFeedbackResponseSchema,
  ResetConversationRuntimeResponseSchema,
} from '../gen/proto/domain/agent/agent_pb';
import type {
  AdvanceCapabilityAcceptanceScenarioClockRequest,
  AgentPackageUnresolvedDependency,
  ArmCapabilityAcceptanceExecutorHookRequest,
  CapabilityCatalogIssue,
  CapabilityApprovalPolicy,
  CapabilityManifest,
  CapabilityReadiness as ProtoCapabilityReadiness,
  CapabilityReadinessSnapshot as ProtoCapabilityReadinessSnapshot,
  CapabilitySourceKind,
  CleanupCapabilityAcceptanceScenarioRequest,
  CreateKnowledgeResourceDescriptorRequest,
  ConnectorResourceManifest,
  InterruptCapabilityAcceptanceWorkerRequest,
  ListConnectorResourceManifestsRequest,
  ListKnowledgeResourceDescriptorsRequest,
  PrepareCapabilityAcceptanceScenarioRequest,
  ReleaseCapabilityAcceptanceBarrierRequest,
  TakeOverCapabilityCleanupRequest,
  TakeOverCapabilityOperationRequest,
  TombstoneKnowledgeResourceDescriptorRequest,
  UpdateKnowledgeResourceDescriptorRequest,
  WaitCapabilityAcceptanceBarrierRequest,
} from '../gen/proto/domain/agent/capability_pb';
import {
  AgentCapabilityBindingSchema,
  AgentPackageDocumentSchema,
  ArmCapabilityAcceptanceExecutorHookRequestSchema,
  ArmCapabilityAcceptanceExecutorHookResponseSchema,
  CancelCapabilityOperationRequestSchema,
  CancelCapabilityOperationResponseSchema,
  AdvanceCapabilityAcceptanceScenarioClockRequestSchema,
  AdvanceCapabilityAcceptanceScenarioClockResponseSchema,
  CleanupCapabilityAcceptanceScenarioRequestSchema,
  CleanupCapabilityAcceptanceScenarioResponseSchema,
  CreateKnowledgeResourceDescriptorRequestSchema,
  CreateKnowledgeResourceDescriptorResponseSchema,
  DeleteAgentCapabilityBindingResponseSchema,
  ExportAgentPackageRequestSchema,
  ExportAgentPackageResponseSchema,
  GetCapabilityOperationRequestSchema,
  GetCapabilityOperationResponseSchema,
  GetCapabilityReadinessResponseSchema,
  ImportAgentPackageRequestSchema,
  ImportAgentPackageResponseSchema,
  InterruptCapabilityAcceptanceWorkerRequestSchema,
  InterruptCapabilityAcceptanceWorkerResponseSchema,
  ListAgentCapabilityBindingsResponseSchema,
  ListCapabilityManifestsResponseSchema,
  ListConnectorResourceManifestsRequestSchema,
  ListConnectorResourceManifestsResponseSchema,
  ListKnowledgeResourceDescriptorsRequestSchema,
  ListKnowledgeResourceDescriptorsResponseSchema,
  PrepareCapabilityAcceptanceScenarioRequestSchema,
  PrepareCapabilityAcceptanceScenarioResponseSchema,
  ReconcileCapabilityOperationRequestSchema,
  ReconcileCapabilityOperationResponseSchema,
  ReleaseCapabilityAcceptanceBarrierRequestSchema,
  ReleaseCapabilityAcceptanceBarrierResponseSchema,
  SyncConnectorResourceManifestsResponseSchema,
  TakeOverCapabilityCleanupRequestSchema,
  TakeOverCapabilityCleanupResponseSchema,
  TakeOverCapabilityOperationRequestSchema,
  TakeOverCapabilityOperationResponseSchema,
  TombstoneKnowledgeResourceDescriptorRequestSchema,
  TombstoneKnowledgeResourceDescriptorResponseSchema,
  UpdateKnowledgeResourceDescriptorRequestSchema,
  UpdateKnowledgeResourceDescriptorResponseSchema,
  UpsertAgentCapabilityBindingResponseSchema,
  WaitCapabilityAcceptanceBarrierRequestSchema,
  WaitCapabilityAcceptanceBarrierResponseSchema,
} from '../gen/proto/domain/agent/capability_pb';
import type {
  HomeWorkProjection,
  SubmitHomeChatCommandResponse,
  SubmitHomeTaskCommandResponse,
} from '../gen/proto/domain/agent/home_pb';
import {
  GetHomeWorkProjectionRequestSchema,
  GetHomeWorkProjectionResponseSchema,
  SubmitHomeChatCommandRequestSchema,
  SubmitHomeChatCommandResponseSchema,
  SubmitHomeTaskCommandRequestSchema,
  SubmitHomeTaskCommandResponseSchema,
} from '../gen/proto/domain/agent/home_pb';
import * as EvaluationModel from '../gen/proto/domain/agent/evaluation_pb';
import type {
  ClaimDesktopExecutorTaskResponse,
  CollaborationTask,
  ExecutorLease,
  GetCollaborationTaskResponse,
  ListCollaborationTasksResponse,
  ListTaskEventsResponse,
} from '../gen/proto/domain/agent/orchestration_pb';
export {
  FederationVisibility,
  FederationVisibilityRequestSchema,
} from '../gen/proto/domain/federation/federation_self_pb';
export type {
  FederationSelfView,
  FederationVisibilityRequest,
} from '../gen/proto/domain/federation/federation_self_pb';
export type {
  FederationResolveView,
} from '../gen/proto/domain/federation/federation_resolve_pb';
export type {
  FederationHealthView,
} from '../gen/proto/domain/federation/federation_health_pb';
export type {
  FederationCatalogSearchResponse,
  FederationCatalogEntry,
} from '../gen/proto/domain/federation/federation_discovery_pb';
export type {
  ListFederationsResponse,
  FederationSummary,
  ActorCapability,
  CreateFederationResponse,
  DeleteFederationResponse,
  JoinFederationResponse,
  LeaveFederationResponse,
  ListMemberStationsResponse,
  MemberStationView,
} from '../gen/proto/domain/federation/federation_projection_service_pb';
export type {
  Friend,
} from '../gen/proto/domain/chat/chat_pb';
export type {
  FriendChatSession,
  FriendChatMessage,
} from '../gen/proto/domain/chat/friend_chat_pb';
export type {
  Group,
  GroupMessage,
  ListGroupsResponse,
  GetGroupMessagesResponse,
  GetUnreadCountResponse,
  MarkGroupReadResponse,
  GroupMember,
  GroupInvitation,
  CreateGroupResponse,
  GetGroupResponse,
  UpdateGroupResponse,
  InviteToGroupResponse,
  JoinGroupResponse,
  LeaveGroupResponse,
  TransferGroupOwnershipResponse,
  DissolveGroupResponse,
  GetGroupMembersResponse,
  RemoveMemberResponse,
  UpdateMemberResponse,
  RecallGroupMessageResponse,
  DeleteGroupMessageResponse,
  SearchGroupMessagesResponse,
  UpdateMyNicknameResponse,
  GetGroupSettingsResponse,
  UpdateGroupSettingsResponse,
  GetOfflineMessagesResponse,
  AckOfflineMessagesResponse,
  GetGroupStatsResponse,
} from '../gen/proto/domain/chat/group_chat_pb';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export type RustErrorCode =
  | 'NOT_IMPLEMENTED'
  | 'INVALID_ARGUMENT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export interface RustCommandError {
  code: RustErrorCode;
  message: string;
  details?: Record<string, any>;
}

export interface RustCommandResult<T = Record<string, any>> {
  ok: boolean;
  data?: T;
  error?: RustCommandError;
}

export class RustCommandException extends Error {
  code: RustErrorCode;
  details?: Record<string, any>;

  constructor(command: string, error?: RustCommandError) {
    super(error?.message || `${command} failed`);
    this.name = 'RustCommandException';
    this.code = error?.code ?? 'INTERNAL_ERROR';
    this.details = error?.details;
  }
}

export interface ChatThreadCount {
  rootUlid: string;
  replyCount: number;
  latestReplyUlid: string;
  latestReplyAt: number;
  unreadCount: number;
}

export interface DesktopNativeHostEventInput {
  kind: 'resume' | 'app-resume' | 'tray-open' | 'notification-tap';
  target?: string;
  sessionUlid?: string;
  notificationId?: string;
  reason?: string;
}

// Always-quiet (regardless of mode): commands that fire many times per
// second and would drown out everything else.
const ALWAYS_QUIET_COMMANDS = new Set([
  'logs_tail',
  'frontend_log',
  'visitor_heartbeat',
  'oss_upload_agent_attachment_bytes',
  'ice_session_candidates_get',
  'ice_session_candidate_post',
  'ice_session_offer_get',
  'ice_session_offer_post',
  'ice_session_answer_get',
  'ice_session_answer_post',
  'ice_peer_register',
  'frontend_telemetry_upload',
  'notification_list',
  'applets_action',
  'applets_invoke',
  'applets_set_config',
]);

// Quiet only in production. In dev we want timing for these so we can
// debug cold-start performance ("first chat tab click is slow") and the
// 60s background sync loop. Toggle through the desktop config preference store.
// if the noise becomes a problem during a specific session.
const PROD_QUIET_COMMANDS = new Set<string>([]);

const APPLET_AUDIT_FLUSH_COMMANDS = new Set([
  'applets_create_session',
  'applets_invoke',
  'applets_action',
]);
const APPLET_AUDIT_FLUSH_DELAY_MS = 1_000;
let appletAuditFlushTimer: ReturnType<typeof setTimeout> | null = null;
let appletAuditFlushInFlight = false;

function isQuietCommand(command: string): boolean {
  if (ALWAYS_QUIET_COMMANDS.has(command)) return true;
  if (PROD_QUIET_COMMANDS.has(command)) {
    const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;
    let userOverride = false;
    try {
      userOverride = readDesktopPreferenceSync<string>('pt.debug.quietChat') === '1';
    } catch { /* no storage in some contexts */ }
    return !isDev || userOverride;
  }
  return false;
}

function scheduleAppletAuditFlush(command: string): void {
  if (!APPLET_AUDIT_FLUSH_COMMANDS.has(command) || appletAuditFlushTimer) return;
  appletAuditFlushTimer = setTimeout(() => {
    appletAuditFlushTimer = null;
    void flushAppletAuditRecords();
  }, APPLET_AUDIT_FLUSH_DELAY_MS);
}

async function flushAppletAuditRecords(): Promise<void> {
  if (appletAuditFlushInFlight) {
    scheduleAppletAuditFlush('applets_invoke');
    return;
  }
  appletAuditFlushInFlight = true;
  try {
    await invokeRustCommand<Record<string, unknown>, TauriStubPayload>(
      'applets_store_upload_audit',
      {},
    );
  } catch (error) {
    log.warn('api', 'applet audit auto flush failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    appletAuditFlushInFlight = false;
  }
}

function publishSessionRevoked(payload: SessionRevokedPayload) {
  eventBus.publish(EVENT.AUTH_SESSION_REVOKED, payload);
}

function extractSessionRevoked(error?: RustCommandError): SessionRevokedPayload | null {
  const details = error?.details;
  if (
    error?.code !== 'UNAUTHORIZED'
    || details?.code !== 'session_revoked'
  ) return null;

  const reason = details.reason;
  const normalizedReason: SessionRevokedReason =
    reason === 'expired'
    || reason === 'kicked'
    || reason === 'not_found'
      ? reason
      : 'unknown';

  return {
    reason: normalizedReason,
    raw: typeof details.raw === 'string' ? details.raw : undefined,
    device_type: typeof details.device_type === 'string' ? details.device_type : undefined,
  };
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof AuthCommandException && error.code === 'UNAUTHORIZED';
}

/**
 * Subscribe to session-revoked events.
 * Returns an unsubscribe function.
 */
export function onSessionRevoked(handler: (payload: SessionRevokedPayload) => void): () => void {
  return eventBus.subscribe(EVENT.AUTH_SESSION_REVOKED, handler);
}

async function invokeRustCommand<TInput, TData>(
  command: string,
  input?: TInput,
): Promise<RustCommandResult<TData>> {
  const quiet = isQuietCommand(command);
  const start = Date.now();
  if (!quiet) {
    log.info('api', `→ ${command}`, input != null ? { req: input } : undefined);
  }

  const executeFn = async (): Promise<RustCommandResult<TData>> => {
    const payload = input === undefined ? undefined : { input };
    return invoke<RustCommandResult<TData>>(command, payload);
  };

  try {
    const { deferred, promise } = throttleInvoke<RustCommandResult<TData>>(command, executeFn);
    const result = await promise;
    const elapsed = Date.now() - start;
    if (!result.ok) {
      const revoked = extractSessionRevoked(result.error);
      if (revoked) {
        publishSessionRevoked(revoked);
        if (!quiet) {
          log.info('api', `← ${command} UNAUTHORIZED (${elapsed}ms)`, { reason: revoked.reason, deferred });
        }
        return result;
      }
      const detailsReason = (result.error?.details as any)?.reason;
      log.warn('api', `← ${command} FAIL (${elapsed}ms)`, {
        error: result.error?.message,
        code: result.error?.code,
        deferred,
        ...(detailsReason ? { reason: detailsReason } : {}),
      });
    } else if (!quiet) {
      log.info('api', `← ${command} OK (${elapsed}ms)${deferred ? ' [deferred]' : ''}`);
    }
    scheduleAppletAuditFlush(command);
    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    const msg = error instanceof Error ? error.message : String(error);
    log.error('api', `← ${command} ERROR (${elapsed}ms)`, { error: msg });
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: msg,
      },
    };
  }
}

export class AuthCommandException extends Error {
  code: RustErrorCode;
  details?: Record<string, any>;

  constructor(error: RustCommandError) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
    this.name = 'AuthCommandException';
  }
}

async function invokeAuthCommand<TInput>(
  command: string,
  input?: TInput,
): Promise<AuthSessionResponse> {
  const response = await invokeRustCommand<TInput, AuthSessionResponse>(command, input);
  if (!response.ok || !response.data) {
    throw new AuthCommandException(
      response.error ?? {
        code: 'INTERNAL_ERROR',
        message: 'auth command failed',
      },
    );
  }
  return response.data;
}

/// Drive an interactive access-gate step that returns a Station decision
/// (rather than a landed session). Shares `AuthCommandException` semantics so
/// callers handle FORBIDDEN/INVALID_ARGUMENT/UNAUTHORIZED uniformly.
async function invokeAccessCommand<TInput>(
  command: string,
  input?: TInput,
): Promise<AccessDecisionResponse> {
  const response = await invokeRustCommand<TInput, AccessDecisionResponse>(command, input);
  if (!response.ok || !response.data) {
    throw new AuthCommandException(
      response.error ?? {
        code: 'INTERNAL_ERROR',
        message: 'access command failed',
      },
    );
  }
  return response.data;
}

async function invokeRustDataFromStatus<TInput, TOut>(
  command: string,
  input?: TInput,
): Promise<TOut> {
  const response = await invokeRustCommand<TInput, TauriStubPayload>(command, input);
  if (response.ok && response.data) {
    return parseJSONSafe(response.data.status) as TOut;
  }
  if (response.error?.code === 'UNAUTHORIZED') {
    throw new AuthCommandException(response.error);
  }
  const err = new RustCommandException(command, response.error);
  log.error('api', `Command error: ${command}`, { error: err.message, code: err.code });
  throw err;
}

async function invokeRustData<TInput, TOut>(
  command: string,
  input?: TInput,
): Promise<TOut> {
  const response = await invokeRustCommand<TInput, TOut>(command, input);
  if (response.ok && response.data !== undefined) {
    return response.data;
  }
  if (response.error?.code === 'UNAUTHORIZED') {
    throw new AuthCommandException(response.error);
  }
  const err = new RustCommandException(command, response.error);
  log.error('api', `Command error: ${command}`, { error: err.message, code: err.code });
  throw err;
}

export async function uploadFrontendTelemetryEvents(
  events: DesktopFrontendTelemetryEvent[],
): Promise<FrontendTelemetryUploadResult> {
  if (events.length === 0) {
    return { accepted: 0, failed: 0, rejected: 0, uploaded: false };
  }
  return invokeRustDataFromStatus<{ events: DesktopFrontendTelemetryEvent[] }, FrontendTelemetryUploadResult>(
    'frontend_telemetry_upload',
    { events },
  );
}

export async function invokeRustProto<TInput, TMsg extends ProtoMessage>(
  command: string,
  schema: GenMessage<TMsg>,
  input?: TInput,
): Promise<TMsg> {
  const response = await invokeRustCommand<TInput, number[] | Uint8Array | TauriStubPayload>(command, input);
  if (response.ok && response.data) {
    if (Array.isArray(response.data) || response.data instanceof Uint8Array) {
      const bytes = new Uint8Array(response.data);
      return fromBinary(schema, bytes);
    }
    if (typeof response.data.status === 'string') {
      return fromJsonString(schema, response.data.status, { ignoreUnknownFields: true });
    }
		throw new Error(`${command} returned invalid proto payload`);
  }
  if (response.error?.code === 'UNAUTHORIZED') {
    throw new AuthCommandException(response.error);
  }
  throw new RustCommandException(command, response.error);
}

async function invokeRustProtoRequest<
  TRequest extends ProtoMessage,
  TResponse extends ProtoMessage,
>(
  command: string,
  requestSchema: GenMessage<TRequest>,
  responseSchema: GenMessage<TResponse>,
  request: TRequest,
): Promise<TResponse> {
  return invokeRustProto(
    command,
    responseSchema,
    { requestBytes: Array.from(toBinary(requestSchema, request)) },
  );
}

async function invokeAppResultStub<TOut>(command: string, payload?: Record<string, unknown>): Promise<TOut> {
  const quiet = isQuietCommand(command);
  const start = Date.now();
  if (!quiet) {
    log.info('api', `→ ${command}`, payload != null ? { req: payload } : undefined);
  }
  try {
    const result = payload === undefined
      ? await invoke<RustCommandResult<TauriStubPayload>>(command)
      : await invoke<RustCommandResult<TauriStubPayload>>(command, payload);
    const elapsed = Date.now() - start;
    if (!result.ok || !result.data) {
      log.warn('api', `← ${command} FAIL (${elapsed}ms)`, { error: result.error?.message });
      const err = new Error(result.error?.message || `${command} failed`);
      throw err;
    }
    if (!quiet) {
      log.info('api', `← ${command} OK (${elapsed}ms)`);
    }
    return parseJSONSafe(result.data.status) as TOut;
  } catch (error) {
    const elapsed = Date.now() - start;
    log.error('api', `← ${command} ERROR (${elapsed}ms)`, { error: error instanceof Error ? error.message : String(error) });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Wire form for presence triggers (mirrors `domain::presence::PresenceTrigger`
 * in the Rust crate). Frontend modules emit one of these strings; the Rust
 * supervisor decides whether the trigger warrants a reconcile.
 */
export type PresenceTrigger =
  | 'app_launch'
  | 'app_foreground'
  | 'app_shutdown'
  | 'identity_restored'
  | 'identity_switched'
  | 'identity_logged_out'
  | 'network_online'
  | 'network_offline'
  | 'heartbeat'
  | 'manual';

/** Payload emitted by Rust on `presence:transition` Tauri events. */
export interface PresenceTransitionEvent {
  actor_ptid: string;
  from: 'offline' | 'online';
  to: 'offline' | 'online';
  trigger: PresenceTrigger;
  reconciled_count: number;
  affected_sessions: string[];
}

export interface PresenceStatusProjection {
  actorPtid: string;
  online: boolean | null;
}

export interface RealtimeCallResolutionProjection {
  call_id: string;
  state: 'OPEN' | 'ACCEPTED' | 'REJECTED' | 'NO_ANSWER';
  winning_device_id?: string;
  terminal_action?: 'accept' | 'reject' | 'no_answer';
  ring_deadline_unix_ms: number;
  resolved_at_unix_ms?: number;
  expires_at_unix_ms: number;
}

/**
 * Input for `oss_upload_local_file` (field names match the Rust
 * `OssUploadAttachmentInput`). Chat uploads always carry a `bucket`
 * and `visibility`; `chat_session_id` is required when
 * `visibility === 'chat'` and ignored otherwise.
 */
export interface OssUploadLocalFileInput {
  file_path: string;
  bucket: string;
  visibility: 'public' | 'chat' | 'private';
  /** Required when `visibility` is `chat`. */
  chat_session_id?: string | null;
}

export interface OssUploadAttachmentBytesInput {
  filename: string;
  mime_type: string;
  bytes: number[];
  conversation_id: string;
}

/** Portable Agent attachment wire shape defined by `AgentAttachmentRef`. */
export interface AgentAttachmentRefInput {
  attachment_id: string;
  object_ref: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  filename: string;
  authorization_scope: string;
  expires_at: string;
  extracted_content_ref: string;
}

export type AgentUploadAttachmentBytesInput = OssUploadAttachmentBytesInput;

/**
 * Payload returned by `oss_upload_local_file` /
 * `oss_upload_attachment_social`.
 *
 * `cid` is the federated URI (`oss://{host}/{key}`) the message /
 * Moments post must carry. `preview_url` is a convenience absolute URL
 * for the renderer to display the file *immediately* without going
 * through `oss_resolve_url`; it is `null` for backends that require
 * signed URLs.
 */
export interface OssAttachmentUploaded {
  cid: string;
  key: string;
  host: string;
  filename: string;
  mime_type: string;
  size: number;
  preview_url?: string | null;
  /**
   * Hex sha256 of the uploaded bytes. Populated only when the
   * Station runs the `cas` key strategy; empty otherwise. Use it
   * to verify the attachment downloaded from peers matches what
   * the sender claimed it was — meaningful end-to-end integrity
   * once federation lands. */
  sha256?: string;
  /** Echoed or inferred OSS visibility: `public` | `chat` | `private`. */
  visibility?: string;
}

export interface SocialEncryptedMediaDescriptorWire {
  encrypted: true;
  version: number;
  suite: string;
  key_b64: string;
  nonce_b64: string;
  plaintext_sha256_b64: string;
  ciphertext_sha256_b64: string;
  plaintext_size: number;
  ciphertext_size: number;
  chunking?: string;
  chunk_size?: number;
  chunk_count?: number;
  tag_size?: number;
  nonce_strategy?: string;
}

export interface SocialEncryptedAttachmentUploaded extends OssAttachmentUploaded {
  media_encryption: SocialEncryptedMediaDescriptorWire;
}

/**
 * @deprecated Use `OssAttachmentUploaded`. Kept as alias for
 * downstream callers that have not migrated yet.
 */
export type ChatAttachmentUploaded = OssAttachmentUploaded;

/**
 * Capabilities reported by the OSS subserver at `/sub-oss/capabilities`.
 * Cached on the Tauri side; the frontend uses `max_file_size` to
 * pre-validate uploads instead of waiting for a server-side rejection.
 */
export interface OssCapabilities {
  version: number;
  host: string;
  path_base: string;
  backend: string;
  max_file_size: number;
  max_files_per_message: number;
  signed_url: boolean;
  upload_endpoint: string;
  file_endpoint: string;
  meta_endpoint: string;
}

/**
 * Result of `oss_resolve_url`. The renderer should prefer `data_url`
 * for inline image previews when present, then `local_path` (served
 * via Tauri's `convertFileSrc`), and finally `url`.
 */
export interface OssResolved {
  local_path?: string | null;
  url: string;
  data_url?: string | null;
  host: string;
  key: string;
}

// ────────────────────────────────────────────────────────────────────
// OSS — owner-side lifecycle (S16). All endpoints below operate on
// the caller's own files; cross-actor mutation lives behind the
// dashboard admin surface.
// ────────────────────────────────────────────────────────────────────

/**
 * Visibility tiers exposed by the OSS subserver. Mirrors the Go-side
 * whitelist in `service.PatchRequest`. Use the union type so callers
 * cannot accidentally PATCH an unknown value.
 */
export type OssVisibility = 'public' | 'chat' | 'private';

/** Filter envelope for `api.ossListMyFiles`. All fields optional. */
export interface OssListMyFilesQuery {
  bucket?: string;
  visibility?: OssVisibility | string;
  /**
   * Server `LIKE '<prefix>%'` over `oss_files.mime`. Pass plain
   * prefixes like `image/`; the server escapes LIKE metacharacters.
   */
  mime?: string;
  include_deleted?: boolean;
  page?: number;
  page_size?: number;
}

/**
 * Mirrors `oss_files` row shape verbatim. We expose the columns the
 * MyFiles UI needs; richer fields (e.g. `Sha256`) are still present
 * in the underlying response but are typed as `unknown` here so the
 * UI layer treats them as opaque metadata.
 */
export interface OssFileMeta {
  id: string;
  key: string;
  name: string;
  size: number;
  mime: string;
  backend: string;
  bucket_id: string;
  owner_actor_ptid: string;
  visibility: OssVisibility | string;
  chat_session_id?: string;
  expires_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  sha256?: string;
}

export interface OssMyFilesResponse {
  files: OssFileMeta[];
  total: number;
  page: number;
  page_size: number;
}

export interface OssDeleteResponse {
  key: string;
  deleted_at: string | null;
  already_deleted: boolean;
}

export interface OssRestoreResponse {
  key: string;
  deleted_at: string | null;
  expires_at: string | null;
  updated_at: string;
}

/**
 * PATCH body. `clear_expires_at` is the explicit "set the column to
 * NULL" intent — distinct from omitting `expires_at` (leave alone)
 * or sending a stamp (set to value). The server accepts at most one
 * of the two; we collapse the precedence in the Rust adapter.
 */
export interface OssPatchFileBody {
  visibility?: OssVisibility | string;
  chat_session_id?: string;
  bucket?: string;
  filename?: string;
  /** RFC3339 stamp; omit to leave column unchanged. */
  expires_at?: string;
  /** When true, force the column to NULL regardless of `expires_at`. */
  clear_expires_at?: boolean;
}

export interface OssPatchResponse {
  key: string;
  visibility: OssVisibility | string;
  chat_session_id?: string;
  bucket_id: string;
  filename: string;
  expires_at?: string | null;
  updated_at: string;
  fields_changed: string[];
  /** Present only when the patch tightened visibility. */
  capability_version?: string;
}

export interface Session {
  id: string;
  key: string;
  agent_name: string;
  title: string;
  message_count: number;
  version?: number;
  model_override?: string;
  created_at: string;
  updated_at: string;
  pinned?: boolean;
  favorite?: boolean;
}

export interface MessageAttachment {
  type: string;
  url: string;
  mime_type: string;
  filename?: string;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  content_type?: 'text' | 'card';
  attachments?: MessageAttachment[];
  model?: string;
  created_at: string;
  tool_calls?: string;
}

export interface AgentMemoryConfig {
  enabled?: boolean;
  effort?: 'low' | 'medium' | 'high';
}

export type AgentThinkingMode = 'auto' | 'enabled' | 'disabled';

export interface AgentWorkspaceConfig {
  root?: string;
  policy?: 'workspace-only';
  updatedAt?: string;
}

export interface AgentProviderFallbackConfig {
  enabled?: boolean;
  maxRetries?: number;
}

export interface AgentChatConfig {
  historyCount?: number;
  enableHistoryCount?: boolean;
  enableAutoCreateTopic?: boolean;
  autoCreateTopicThreshold?: number;
  enableMaxTokens?: boolean;
  enableStreaming?: boolean;
  enableContextCompression?: boolean;
  compressionModelId?: string;
  contextWindowSize?: number;
  searchMode?: 'off' | 'auto' | 'on';
  useModelBuiltinSearch?: boolean;
  memory?: AgentMemoryConfig;
  providerFallback?: AgentProviderFallbackConfig;
  workspace?: AgentWorkspaceConfig;
}

export interface Agent {
  id: string;
  name: string;
  title: string;
  description: string;
  avatar: string;
  backgroundColor: string;
  systemPrompt: string;
  soulMd: string;
  agentsMd: string;
  model: string;
  provider: string;
  effort: string;
  thinkingMode?: AgentThinkingMode;
  visibility: string;
  isolationEnabled: boolean;
  isolationMode: string;
  isolationRetentionDays: number;
  workspaceMode: string;
  allowedRoots: string;
  tags: string;
  pinned: boolean;
  favorite: boolean;
  sortOrder: number;
  openingMessage: string;
  openingQuestions: string;
  chatConfig: string;
  isDefault: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentCreate {
  name: string;
  title?: string;
  description?: string;
  avatar?: string;
  backgroundColor?: string;
  systemPrompt?: string;
  soulMd?: string;
  agentsMd?: string;
  model?: string;
  provider?: string;
  effort?: string;
  thinkingMode?: AgentThinkingMode;
  visibility?: string;
  isolationEnabled?: boolean;
  isolationMode?: string;
  isolationRetentionDays?: number;
  workspaceMode?: string;
  allowedRoots?: string;
  tags?: string;
  pinned?: boolean;
  favorite?: boolean;
  sortOrder?: number;
  openingMessage?: string;
  openingQuestions?: string;
  chatConfig?: string;
  version?: number;
}

export type AgentWorkspaceCleanScope = 'tasks' | 'artifacts' | 'logs' | 'all_workspace';

export interface AgentWorkspaceInfo {
  agent_id: string;
  workspace_root: string;
  profile_dir: string;
  total_bytes: number;
  workspace_bytes: number;
  profile_bytes: number;
  task_count: number;
  last_modified_at?: string;
}

export type AgentPackage = JsonValue;

export interface AgentPackageExportResult {
  package: AgentPackage;
  unresolvedDependencies: AgentPackageUnresolvedDependency[];
}

export interface AgentPackageImportResult {
  agent?: Agent;
  unresolvedDependencies: AgentPackageUnresolvedDependency[];
}

export interface AgentListResult {
  agents: Agent[];
  selectedAgent?: string;
  defaultAgent?: string;
}

export interface AgentCollaborationCreateInput {
  title: string;
  description: string;
  engine_type: number;
  agent_ids: string[];
  judge_agent_id?: string;
  workspace_id?: string;
  budget_tokens?: number;
  budget_money?: number;
  budget_time_ms?: number;
}

export interface AgentCollaborationGetInput {
  task_id: string;
}

export interface AgentCollaborationListInput {
  status?: number;
  page?: number;
  page_size?: number;
}

export interface AgentCollaborationListEventsInput {
  task_id: string;
  after_event_seq?: number;
  page_size?: number;
}

export interface AgentCollaborationSubscribeInput {
  stream_id?: string;
  agent_id: string;
  task_id?: string;
  after_event_seq?: number;
}

export interface AgentCollaborationCancelTaskInput {
  task_id: string;
}

export interface AgentCollaborationResumeTaskInput {
  task_id: string;
}

export interface AgentCollaborationSubmitNodeResultInput {
  task_id: string;
  node_id: string;
  result_summary: string;
  status?: 'completed' | 'failed';
  turn_id?: string;
  lease_id?: string;
  executor_id?: string;
}

export interface AgentCollaborationClaimExecutorInput {
  executor_id: string;
  lease_ttl_ms?: number;
  task_id?: string;
  agent_id?: string;
  node_id?: string;
  capabilities?: string[];
}

export interface AgentCollaborationHeartbeatLeaseInput {
  lease_id: string;
  executor_id: string;
  lease_ttl_ms?: number;
}

export interface AgentCollaborationReleaseLeaseInput {
  lease_id: string;
  executor_id: string;
  status?: string;
}

export interface AgentCollaborationStreamPayload {
  streamId: string;
  agentId: string;
  event: string;
  data: Record<string, any>;
}

export interface AgentAuthorityStreamPayload {
  streamId: string;
  agentId: string;
  event: string;
  data: Record<string, unknown>;
}

export function parseAgentChatConfig(agent: Agent): AgentChatConfig {
  if (!agent.chatConfig) return {};
  try { return JSON.parse(agent.chatConfig); } catch { return {}; }
}

export interface ToolInfo {
  name: string;
  category: string;
  needs_approval: boolean;
  enabled?: boolean;
  source?: 'builtin' | 'mcp' | string;
  serverName?: string;
  transport?: 'stdio' | 'http' | 'sse';
  displayName?: string;
  description?: string;
  executable?: boolean;
  executionOwner?: 'client-local' | 'station' | string;
  riskLevel?: 'low' | 'medium' | 'high' | string;
  schema?: Record<string, unknown>;
}

export interface AvailableModel {
  id: string;
  display_name: string;
  provider_id: string;
  provider_name: string;
  type: string;
  context_window: number;
  enabled: boolean;
  streaming?: boolean;
  function_call?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  search?: boolean;
  image_output?: boolean;
  video?: boolean;
  protocol_override?: string;
}

interface AvailableModelWire {
  id?: unknown;
  display_name?: unknown;
  provider_id?: unknown;
  provider_name?: unknown;
  type?: unknown;
  context_window?: unknown;
  enabled?: unknown;
  capabilities?: unknown;
}

export interface ProviderListItem {
  id: string;
  name: string;
  description: string;
  logo?: string;
  enabled: boolean;
  builtin: boolean;
  has_api_key: boolean;
  requires_api_key: boolean;
  credential_status: string;
  runtime_kind: string;
  version: number;
}

export interface ModelItem {
  id: string;
  display_name: string;
  type: string;
  enabled: boolean;
  context_window: number;
  streaming?: boolean;
  function_call?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  search?: boolean;
  image_output?: boolean;
  video?: boolean;
}

export interface ProviderModelConfigInput {
  display_name?: string;
  type?: string;
  context_window?: number;
  enabled?: boolean;
  streaming?: boolean;
  function_call?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  search?: boolean;
  image_output?: boolean;
  video?: boolean;
}

export interface ProviderModelCreateData extends ProviderModelConfigInput {
  id: string;
}

export interface ProviderDetail extends ProviderListItem {
  home_url: string;
  api_key_url: string;
  api_key: string;
  base_url: string;
  default_base_url: string;
  show_api_key?: boolean;
  show_checker: boolean;
  check_model?: string;
  models: ModelItem[];
}

export interface HelpItem {
  id: string;
  category: string;
  title: string;
  description: string;
  usage?: string;
  icon?: string;
  source: string;
  applet_id?: string;
}

export interface HelpCategoryMeta {
  id: string;
  title: string;
  icon?: string;
  description?: string;
}

export interface HelpCategoryGroup {
  category: HelpCategoryMeta;
  items: HelpItem[];
}

export interface AppletManifest {
  manifestVersion: 2;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  capabilities: string[];
  permissions: string[];
  load: {
    type: 'lynx';
    entry: string;
  };
  bridge: {
    version: 2;
    protocol: 'peers-touch.applet.bridge.v2';
  };
  config_schema?: Record<string, unknown>;
}

export interface AppletInfo {
  manifest: AppletManifest;
  status: 'installed' | 'active' | 'stopped' | 'error';
  error?: string;
}

export interface AppletImportDirectoryResult {
  directory: string;
  manifest: unknown;
}

export type AppletStoreSource = 'station' | 'cache';

export interface AppletStoreInfo {
  id?: string;
  name?: string;
  description?: string;
  iconUrl?: string;
  icon_url?: string;
  developerId?: string;
  developer_id?: string;
  status?: number | string;
}

export interface AppletStoreVersion {
  appletId?: string;
  applet_id?: string;
  version?: string;
  bundleUrl?: string;
  bundle_url?: string;
  bundleHash?: string;
  bundle_hash?: string;
  status?: number | string;
  channel?: number | string;
  manifest?: AppletStoreManifestSnapshot;
  bundle?: AppletStoreBundleStorage;
}

export interface AppletStoreManifestSnapshot {
  manifestJson?: string;
  manifest_json?: string;
  targetPlatforms?: string[];
  target_platforms?: string[];
  permissions?: string[];
  capabilities?: string[];
  integrity?: Record<string, string>;
  bridgeProtocol?: string;
  bridge_protocol?: string;
  runtimeType?: string;
  runtime_type?: string;
}

export interface AppletStoreBundleStorage {
  bundleUri?: string;
  bundle_uri?: string;
  bundleSha256?: string;
  bundle_sha256?: string;
  bundleSizeBytes?: number | string;
  bundle_size_bytes?: number | string;
  assets?: Array<{ path: string; sha256: string; sizeBytes?: number | string; size_bytes?: number | string; contentType?: string; content_type?: string }>;
}

export interface AppletStoreInstallState {
  actorPtid?: string;
  actor_ptid?: string;
  deviceId?: string;
  device_id?: string;
  appletId?: string;
  applet_id?: string;
  version?: string;
  channel?: number | string;
  status?: number | string;
  statusReason?: string;
  status_reason?: string;
}

export interface AppletStoreCatalogItem {
  info?: AppletStoreInfo;
  version?: AppletStoreVersion;
  installState?: AppletStoreInstallState;
  install_state?: AppletStoreInstallState;
}

export interface AppletStoreCatalogResponse {
  items?: AppletStoreCatalogItem[];
  totalCount?: number;
  total_count?: number;
  source?: AppletStoreSource;
  stale?: boolean;
  stationUnavailable?: boolean;
  stationError?: string;
}

export interface AppletStoreInstalledResponse {
  states?: AppletStoreInstallState[];
  source?: AppletStoreSource;
  stale?: boolean;
  stationUnavailable?: boolean;
  stationError?: string;
}

export interface AppletStoreInstallResponse {
  state?: AppletStoreInstallState;
  source?: AppletStoreSource;
}

export interface AppletStoreGetVersionResponse {
  version?: AppletStoreVersion;
  policy?: unknown;
  source?: AppletStoreSource;
  stale?: boolean;
}

export interface AppletStoreUploadAuditResponse {
  acceptedCount?: number;
  accepted_count?: number;
  rejectedAuditIds?: string[];
  rejected_audit_ids?: string[];
  source?: AppletStoreSource | 'local';
}

export interface AppletStoreMaterializeBundleResponse {
  directory: string;
  entry: string;
  filePath?: string;
  sha256: string;
  assets?: Array<{ path: string; filePath?: string; sha256: string }>;
  source?: AppletStoreSource;
}

export interface StatisticsRankItem {
  name: string;
  count: number;
}

export interface StatisticsActivityDay {
  date: string;
  count: number;
}

export interface StatisticsData {
  summary: {
    sessions: number;
    messages: number;
    total_words: number;
    agents: number;
    days_with_us: number;
    first_date: string;
  };
  activity: StatisticsActivityDay[];
  model_rank: StatisticsRankItem[] | null;
  agent_rank: StatisticsRankItem[] | null;
  topic_rank: StatisticsRankItem[] | null;
}

export interface SearchSource {
  id: string;
  name: string;
  icon: string;
  description?: string;
  builtin: boolean;
  applet_id?: string;
}

export interface SearchResultItem {
  id: string;
  source: string;
  title: string;
  snippet: string;
  url?: string;
  icon?: string;
  metadata?: Record<string, string>;
}

export interface SearchSourceGroup {
  source: SearchSource;
  items: SearchResultItem[];
  total: number;
}

export interface AISearchResponse {
  query: string;
  answer: string;
  web: boolean;
  sources: Array<{ title: string; source: string; url: string }>;
}

export interface TTSVoice {
  id: string;
  name: string;
  provider: string;
  language: string;
  gender: string;
}

// ── Skill types ──

export interface BuiltinSkillInfo {
  identifier: string;
  name: string;
  description: string;
  keywords: string[];
  avatar: string;
  useCount: number;
  lastUsedAt?: string;
}

export interface BuiltinSkillRecord extends BuiltinSkillInfo {
  content: string;
}

export interface SkillListItem {
  id: string;
  identifier: string;
  name: string;
  description: string;
  version: string;
  authorName: string;
  metaAvatar: string;
  metaTitle: string;
  metaTags: string[];
  source: string;
  trustLevel?: string;
  scanVerdict?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  useCount: number;
  lastUsedAt?: string;
}

export interface SkillResourceNode {
  id: string;
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'section';
  role?: string;
  mime?: string;
  bytes: number;
  lineCount: number;
  sha256?: string;
  loadedAtRuntime: boolean;
  loadTrigger: string;
  summary?: string;
  children?: SkillResourceNode[];
}

export interface SkillResourceTree {
  root: SkillResourceNode;
  resources: SkillResourceNode[];
}

export interface SkillRuntimeLoad {
  systemPrompt: {
    policy: string;
    loadedResources: string[];
    description: string;
  };
  skillView: {
    policy: string;
    toolName: string;
    loadedResources: string[];
    bytes: number;
    lineCount: number;
    sha256: string;
  };
  runtimeTrace: {
    skillId: string;
    version: number;
    enabled: boolean;
    trustLevel: string;
    scanVerdict: string;
  };
}

export interface SkillVersionItem {
  version_id?: string;
  versionId?: string;
  skill_id?: string;
  skillId?: string;
  agent_id?: string;
  agentId?: string;
  version: number;
  trigger: string;
  created_at?: string;
  createdAt?: string;
}

export interface SkillVersionsOutput {
  versions: SkillVersionItem[];
  total: number;
  rollbackPolicy?: {
    owner: string;
    reversible: boolean;
    preRollbackSnapshot?: string;
  };
}

export interface SkillVersionsInput {
  agent_id?: string;
  id: string;
  limit?: number;
  offset?: number;
}

export interface SkillRollbackInput {
  agent_id?: string;
  id: string;
  target_version: number;
}

export interface SkillRecord extends SkillListItem {
  authorUrl: string;
  license: string;
  repository: string;
  sourceUrl: string;
  permissions: string[];
  content: string;
  metaDescription: string;
  metaBackgroundColor: string;
  keywords: string[];
  globs: string[];
  agentOnly: string[];
  sourceUri: string;
  zipFileHash: string;
  resourceTree?: SkillResourceTree;
  runtimeLoad?: SkillRuntimeLoad;
}

export interface SkillImportResult {
  id: string;
  identifier: string;
  name: string;
  isNew: boolean;
  packageType?: string;
  scanVerdict?: string;
  targetAuthority?: string;
  targetReadback?: boolean;
}

export interface SkillImportBatchResult {
  kind: 'url' | 'git';
  imported: SkillImportResult[];
  total: number;
}

export interface SkillZipValidation {
  valid: boolean;
  skillPath: string;
  skillName: string;
  skillCount: number;
  error?: string;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

// ── Skill Market types ──

export interface MarketSource {
  id: string;
  name: string;
  transportKind: 'official_station' | 'user_pinned_github';
  url: string;
  branch?: string;
  manifestPath: string;
  publisherId: string;
  signingKeyId: string;
  publicKeyFingerprint: string;
  trustLevel: 'official' | 'user-pinned' | 'unknown';
  builtIn: boolean;
  enabled: boolean;
  catalogRevision: string;
  generatedAt: string;
  signatureStatus: 'verified' | 'invalid' | 'pending';
  syncState: 'bootstrap_verified' | 'fresh_verified' | 'stale_verified' | 'invalid_rejected';
  revoked: boolean;
  revokedAt?: string;
}

export interface MarketSummary extends MarketSource {
  skillCount: number;
  lastSynced?: string;
  synced: boolean;
  stale: boolean;
  error?: string;
}

export interface MarketSkillEntry {
  marketId?: string;
  identifier: string;
  name: string;
  description: string;
  filePath: string;
  installed: boolean;
  installedSkillId?: string;
  installedAt?: string;
  scanVerdict?: string;
  version?: string;
  author?: string;
  license?: string;
  keywords?: string[];
  trustLevel?: string;
  riskLevel?: string;
  packageType?: string;
  source?: string;
  contentHash?: string;
  signatureStatus?: 'verified' | 'invalid';
  signingKeyId?: string;
  installPolicy?: 'allowed' | 'confirmation_required' | 'blocked';
  revoked?: boolean;
  revokedAt?: string;
  targetAuthority?: 'station-agent' | 'station-skill' | 'desktop-mcp' | string;
  targetReadbackAt?: string;
}

export interface MarketSkillDetail extends MarketSkillEntry {
  content: string;
  authorUrl: string;
  avatar: string;
  tags: string[];
  publisher: string;
  homepage: string;
  repository: string;
}

export interface MarketSkillPage {
  skills: MarketSkillEntry[];
  total: number;
  nextCursor?: string;
  catalogRevision: string;
}

// ── MCP Server types ──

export interface MCPServerItem {
  serverId: string;
  name: string;
  title: string;
  description: string;
  type: 'stdio' | 'http' | 'sse';
  executionOwner: 'station' | 'client';
  source: string;
  enabled: boolean;
  revision: number;
  metaAvatar: string;
  metaTags: string[];
  toolCount: number;
  status?: 'unknown' | 'pending' | 'connected' | 'disconnected' | 'cancelled' | 'timed_out' | 'failed' | 'unknown_side_effect';
  lastTestedAt?: string;
  lastError?: string;
  operationId?: string;
  operationKind?: McpLifecycleOperationKind;
}

export type McpLifecycleOperationKind =
  | 'install'
  | 'configure'
  | 'test'
  | 'connect'
  | 'reconnect'
  | 'uninstall';

export interface MCPServerRecord {
  serverId: string;
  name: string;
  title: string;
  description: string;
  version: string;
  type: 'stdio' | 'http' | 'sse';
  executionOwner: 'station' | 'client';
  command: string;
  args: string[];
  env: Record<string, string>;
  envKeys?: string[];
  url: string;
  headers: Record<string, string>;
  headersKeys?: string[];
  authType: string;
  authToken: string;
  hasAuthToken?: boolean;
  authAccessToken: string;
  hasAuthAccessToken?: boolean;
  configSchema: Record<string, unknown>;
  settings: Record<string, string>;
  metaAvatar: string;
  metaTags: string[];
  source: string;
  homepage: string;
  repository: string;
  enabled: boolean;
  status?: MCPServerItem['status'];
  lastTestedAt?: string;
  lastError?: string;
  tools?: Array<string | {
    name: string;
    providerToolName: string;
    description: string;
    inputSchema: Record<string, unknown>;
    capabilityId: string;
    capabilityVersion: string;
  }>;
  revision: number;
  operationId?: string;
  operationKind?: McpLifecycleOperationKind;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookDocument {
  id: string;
  title: string;
  content: string;
  description: string;
  type: string;
  source: string;
  source_type: string;
  created_at: string;
  updated_at: string;
}

export interface NotebookDocumentWithTopic extends NotebookDocument {
  topic_id: string;
  topic_title: string;
  agent_id: string;
}

// ── Cron types ──

export interface CronJob {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scheduleKind: string; // 'cron' | 'interval' | 'once'
  cronExpr: string;
  intervalSec: number;
  runAt: string;
  timezone: string;
  execKind: string; // 'shell' | 'agent'
  shellCmd: string;
  agentPrompt: string;
  agentName: string;
  modelOverride: string;
  timeoutSec: number;
  deleteAfterRun: boolean;
  nextRunAt: string;
  lastRunAt: string;
  lastStatus: string;
  lastError: string;
  lastDurationMs: number;
  consecErrors: number;
  deliveryMode: string;
  deliveryChannelId: string;
  deliveryTargetId: string;
  deliveryTargetType: string;
  failureChannelId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobCreate {
  name: string;
  description?: string;
  scheduleKind: string;
  cronExpr?: string;
  intervalSec?: number;
  runAt?: string;
  timezone?: string;
  execKind: string;
  shellCmd?: string;
  agentPrompt?: string;
  agentName?: string;
  modelOverride?: string;
  timeoutSec?: number;
  deleteAfterRun?: boolean;
  deliveryMode?: string;
  deliveryChannelId?: string;
  deliveryTargetId?: string;
  deliveryTargetType?: string;
  failureChannelId?: string;
}

// ── Model Service types ──

export interface ModelRef {
  provider: string;
  model: string;
}

export interface ModelServiceConfig {
  default?: ModelRef;
  topicNaming?: ModelRef;
  translation?: ModelRef;
  historyCompress?: ModelRef;
  cronDefault?: ModelRef;
  agentRouter?: ModelRef;
}

export interface ModelServiceReference {
  slot?: string;
  service?: string;
  key?: string;
  model: string;
}

// ── Channel types ──

export interface BotStatus {
  connected: boolean;
  botName?: string;
  error?: string;
}

export interface Channel {
  id: string;
  name: string;
  type: 'telegram' | 'lark' | 'slack' | 'webhook' | 'discord';
  enabled: boolean;
  config: string;
  createdAt: string;
  updatedAt: string;
  botStatus?: BotStatus;
}

export interface ChatTarget {
  id: string;
  name: string;
  type: 'group' | 'p2p';
}

export interface ChannelEvent {
  id: string;
  channelId: string;
  direction: 'inbound' | 'outbound';
  phase: 'received' | 'processing' | 'replied' | 'delivered' | 'failed';
  timestamp: string;
  msgType?: string;
  msgText?: string;
  senderId?: string;
  senderName?: string;
  targetId?: string;
  targetType?: string;
  sessionId?: string;
  latencyMs?: number;
  error?: string;
  botType?: string;
}

export interface ChannelEventStats {
  totalInbound: number;
  totalOutbound: number;
  totalErrors: number;
  avgLatencyMs: number;
  todayInbound: number;
  todayOutbound: number;
}

export interface CronRun {
  id: number;
  jobId: string;
  startedAt: string;
  endedAt: string;
  status: string;
  error: string;
  output: string;
  durationMs: number;
}

export interface CronStatus {
  enabled: boolean;
  total: number;
  active: number;
  paused: number;
  nextRunAt: string;
  nextJobName: string;
}

export interface CronScheduleParsed {
  scheduleKind: string;
  cronExpr?: string;
  intervalSec?: number;
  runAt?: string;
  timezone?: string;
  name?: string;
  description?: string;
  agentPrompt?: string;
  execKind?: string;
}

export interface LogTailResponse {
  file: string;
  cursor: number;
  size: number;
  lines: string[];
  truncated: boolean;
  reset: boolean;
}

// --- User preferences ---

export interface UserPreferences {
  pinned_applets?: string[];
  wide_screen?: boolean;
  user_name?: string;
  user_avatar?: string;
  user_avatar_provider?: string;
  tts_provider?: 'browser' | 'edge' | 'openai';
  tts_voice?: string;
  tts_speed?: number;
  tts_auto_read?: boolean;
  stt_provider?: 'browser' | 'openai';
  stt_language?: string;
  stt_auto_stop?: boolean;
  web_search_enabled?: boolean;
}

export interface AccountIdentity {
  id: string;
  provider: string;
  provider_user_id: string;
  name: string;
  email: string;
  avatar_url: string;
  avatar_local_path?: string;
  profile_url: string;
  created_at: string;
  last_login_at: string;
  has_pin: boolean;
  has_session: boolean;
}

export interface AccountSetPinInput {
  account_id: string;
  pin: string;
}

export interface AccountUnlockInput {
  account_id: string;
  pin: string;
}

export interface SearchProviderInfo {
  name: string;
  available: boolean;
  is_primary: boolean;
}

// --- OAuth2 types ---

export interface OAuth2Environment {
  id: string;
  name: string;
  authorize_url: string;
  token_url: string;
  userinfo_url?: string;
  default?: boolean;
}

export interface OAuth2ProviderSummary {
  id: string;
  name: string;
  description: string;
  icon: string;
  icon_url?: string;
  color: string;
  category: string;
  builtin: boolean;
  enabled: boolean;
  status: string;
  has_credentials: boolean;
  connected: boolean;
  callback_url: string;
  environments?: OAuth2Environment[];
  auth_hosts?: string[]; // hosts this provider can authenticate for (skill import)
}

export interface OAuth2ProviderDetail {
  id: string;
  name: string;
  description: string;
  icon: string;
  icon_url?: string;
  color: string;
  category: string;
  builtin: boolean;
  enabled: boolean;
  oauth2: {
    authorize_url: string;
    token_url: string;
    revoke_url?: string;
    userinfo_url?: string;
    scopes: string[];
    pkce: boolean;
    [key: string]: unknown;
  };
  resources?: Record<string, {
    name: string;
    description: string;
    endpoint: string;
    method: string;
  }>;
  page_template?: {
    title?: string;
    subtitle?: string;
    features?: Array<{ icon: string; title: string; description: string }>;
    disclaimer?: string;
  };
}

export interface OAuth2Connection {
  connection_id: string;
  revision: number;
  projected_revision: number;
  provider_id: string;
  provider_name: string;
  user_id: string;
  user_name: string;
  email: string;
  avatar_url: string;
  profile_url: string;
  connected_at: string;
  expires_at?: string;
  scopes: string[];
  status: 'active' | 'expired' | 'disconnected' | 'revoked' | 'revocation_unconfirmed' | 'error';
}

export interface OAuthDisconnectResult {
  status: 'revoked' | 'revocation_unconfirmed';
  provider_revoke: {
    status: 'revoked' | 'unconfirmed';
    error_code: string;
    idempotency_key: string;
  };
}

export interface SimulateLoginStart {
  session_id: string;
  qr_value: string;
  expires_in: number;
}

export interface LarkBotCredentials {
  app_id: string;
  app_secret: string;
  app_name?: string;
  /** When true, user must publish the app in Lark console before WebSocket will work */
  publish_required?: boolean;
}

export interface SimulateLoginPoll {
  status: 'pending' | 'success' | 'expired' | 'error' | 'not_found';
  connection?: OAuth2Connection;
  bot?: LarkBotCredentials;
  /** Channel ID when bot was created and persisted */
  channel_id?: string;
  error?: string;
}

// ── Memory types ──

export interface Memory {
  id: string;
  layer: 'identity' | 'context' | 'experience' | 'preference' | 'activity';
  agent_id: string;
  session_id: string;
  source: 'turn' | 'review' | 'flush' | 'manual' | 'extraction' | 'agent_tool';
  content: Record<string, any>;
  summary: string;
  relevance: number;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Persona {
  tagline: string;
  narrative: string;
  updated_at: string;
}

export interface MemoryStats {
  total: number;
  by_layer: Record<string, number>;
  storage_bytes: number;
}

export interface ScoredMemory {
  memory: Memory;
  score: number;
  explain?: {
    vector_score: number;
    keyword_score: number;
    weighted_score: number;
    decay_factor?: number;
    after_decay?: number;
    after_rerank?: number;
    final_score: number;
  };
}

export interface MemoryTimeFilter {
  since?: string;
  until?: string;
  period?: '24h' | '7d' | '30d' | '90d';
}

export interface MemoryEvent {
  id: string;
  type: string;
  memory_id: string;
  session_id: string;
  agent_id: string;
  layer: string;
  detail: Record<string, any>;
  latency_ms: number;
  timestamp: string;
}

export interface ExportData {
  version: string;
  exported_at: string;
  memories: Memory[];
  persona?: Persona;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  total: number;
}

export interface TauriStubPayload {
  command: string;
  status: string;
}

export interface SettingsGetPayload extends TauriStubPayload {
  value?: unknown;
}

export interface AuthSessionResponse extends TauriStubPayload {
  actor_ptid: string | null;
  name?: string;
  email?: string;
  avatar_url?: string;
  avatar_local_path?: string;
  login_method?: string;
}

export interface MessagingAcceptanceInteractionSnapshot {
  actorPtid: string;
  conversationId: string;
  messageId: string;
  projection: Record<string, unknown> | null;
  intent: Record<string, unknown> | null;
  outbox: Record<string, unknown> | null;
  directSessions: Array<Record<string, unknown>>;
  commandLedger: Array<Record<string, unknown>>;
  reactions: Array<Record<string, unknown>>;
  pins: Array<Record<string, unknown>>;
  readCursors: Array<Record<string, unknown>>;
  redactionTombstones: Array<Record<string, unknown>>;
  searchEntryCount: number;
  attachmentProjectionCount: number;
  attachmentTransferCount: number;
  redactionCleanup: Array<Record<string, unknown>>;
  consumptionCount: number;
  laneSequence: number;
  consumerEpoch: number;
}

export interface MessagingAcceptancePreparedCommand {
  actorPtid: string;
  snapshot: MessagingAcceptanceInteractionSnapshot;
}

export interface MessagingAcceptanceRestorableCommand
  extends MessagingAcceptancePreparedCommand {
  conversationId: string;
  messageId: string;
  commandId: string;
}

export interface ChatStorageAcceptanceConversationClearFixture {
  actorPtid: string;
  conversationId: string;
  messageId: string;
}

export const DESKTOP_TAURI_CONTRACT_VERSION = '2026-03-24.desktop-tauri-rust.v1';

export interface AccessDecisionResponse extends TauriStubPayload {
  decision: AccessDecision;
}

export interface AccessDecisionInput {
  attempt_id: string;
}

export interface AccessSubmitInviteInput {
  attempt_id: string;
  gate_id: string;
  gate_type: number;
  action_id: string;
  schema_revision: number;
  schema_digest: string;
  submission_id: string;
  invite_code: string;
}

export interface AccessSubmitLoginInput {
  attempt_id: string;
  gate_id: string;
  gate_type: number;
  action_id: string;
  schema_revision: number;
  schema_digest: string;
  submission_id: string;
  account: string;
  password: string;
}

export interface AuthValidateTokenInput {
  token?: string;
}

export interface SettingsGetInput {
  key: string;
}

export interface SettingsSetInput {
  key: string;
  value: any;
}

export interface ChatScreenshotShortcutRegisterInput {
  shortcut: string;
}

export interface ChatListMessagesInput {
  conversation_id: string;
  cursor?: string;
  limit?: number;
}

export interface ChatSendMessageInput {
  conversation_id: string;
  content: string;
  client_message_id?: string;
}

export interface ChatMarkReadInput {
  conversation_id: string;
  message_id: string;
}

export interface ChatConversationInput {
  conversation_id: string;
}

export interface ChatRenameConversationInput {
  conversation_id: string;
  title: string;
}

export interface ChatSetConversationModelInput {
  conversation_id: string;
  model: string;
}

export interface ChatMessageInput {
  message_id: string;
}

export interface ChatUpdateMessageInput {
  message_id: string;
  content: string;
}

export interface TimelineListInput {
  cursor?: string;
  limit?: number;
}

export interface TimelineActionInput {
  post_id: string;
  content?: string;
}

export interface ProfileUpdateInput {
  display_name?: string;
  note?: string;
  avatar?: string;
  header?: string;
  region?: string;
  timezone?: string;
  tags?: string[];
  links?: AccountProfileLink[];
  observed_revision: number;
}

export interface AccountProfileLink {
  label: string;
  url: string;
}

export interface AccountProfile {
  id: string;
  profile_revision: number;
  username: string;
  acct: string;
  display_name: string;
  note: string;
  url: string;
  avatar: string;
  header: string;
  locked: boolean;
  created_at: string;
  statuses_count: number;
  following_count: number;
  followers_count: number;
  region: string;
  timezone: string;
  tags: string[];
  links: AccountProfileLink[];
  default_visibility: string;
  manually_approves_followers: boolean;
  message_permission: string;
  auto_expire_days: number;
  peers_touch: {
    network_id: string;
  };
}

export type ProfileUpdateOutcome =
  | 'PROFILE_UPDATE_OUTCOME_APPLIED'
  | 'PROFILE_UPDATE_OUTCOME_UNCHANGED'
  | 'PROFILE_UPDATE_OUTCOME_CONFLICT';

export interface ProfileUpdateResult {
  outcome: ProfileUpdateOutcome;
  profile: AccountProfile;
}

export interface ProfilePrivacyInput {
  visibility: string;
  allow_direct_message: boolean;
}

export interface FileUploadInput {
  file_path: string;
}

export interface AdminNetworkProbeInput {
  target: string;
}

export interface AdminExecuteActionInput {
  action: string;
  payload?: Record<string, any>;
}

export interface ProviderIdInput {
  id: string;
}

export interface ProviderUpdateInput {
  id: string;
  enabled: boolean;
  key_vaults?: string;
  config_json?: string;
  runtime_kind?: string;
  protocol?: string;
  version?: number;
}

export interface ProviderCheckInput {
  id: string;
  key_vaults?: string;
  config_json?: string;
}

export interface ProviderCreateInput {
  name: string;
  description: string;
  logo: string;
  key_vaults: string;
  config_json: string;
  runtime_kind?: string;
  protocol?: string;
}

export interface ProviderModelAddInput {
  provider_id: string;
  data: Record<string, any>;
}

export interface ProviderModelUpdateInput {
  provider_id: string;
  model_id: string;
  data: Record<string, any>;
}

export interface ProviderModelDeleteInput {
  provider_id: string;
  model_id: string;
}

export interface ProviderModelFetchInput {
  provider_id: string;
  data?: Record<string, any>;
}

export interface ProviderModelToggleInput {
  provider_id: string;
  model_id: string;
  enabled: boolean;
}

export interface ProviderModelToggleAllInput {
  provider_id: string;
  enabled: boolean;
}

export interface ChatCompletionInput {
  session_id: string;
  provider_id?: string;
  model?: string;
  message: string;
}

export interface SkillsListInput {
  agent_id?: string;
  source?: string;
}

export interface SkillsSearchInput {
  agent_id?: string;
  q: string;
  limit?: number;
}

export interface SkillIdInput {
  agent_id?: string;
  id: string;
}

export interface BuiltinSkillIdInput {
  identifier: string;
}

export interface SkillCreateInput {
  agent_id?: string;
  name: string;
  content: string;
}

export interface SkillUpdateInput {
  agent_id?: string;
  id: string;
  name?: string;
  description?: string;
  content?: string;
  enabled?: boolean;
}

export interface SkillToggleInput {
  agent_id?: string;
  id: string;
  enabled: boolean;
}

export interface McpNameInput {
  name: string;
}

export interface McpCreateInput {
  data: Partial<MCPServerRecord>;
}

export interface McpUpdateInput {
  name: string;
  data: Partial<MCPServerRecord>;
}

export interface McpToggleInput {
  name: string;
  enabled: boolean;
}

export interface AgentToolDecisionIntentInput {
  approval_id: string;
  tool_call_id: string;
  decision_id: string;
  expected_revision: number;
  approved: boolean;
  idempotency_key: string;
}

export interface AgentTypedErrorPayload {
  error: string;
  error_type: string;
  locale_key: string;
  retryable: boolean;
  terminal: boolean;
  details: Record<string, string>;
}

export type AgentTerminalMutationStatus =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface AgentErrorResolutionAction {
  type:
    | 'reauthCli'
    | 'openProviderSettings'
    | 'checkConnection'
    | 'openOriginal'
    | 'editQueue'
    | 'selectRuntime'
    | 'confirmReset'
    | 'retryLater'
    | 'retry'
    | 'switchAccount'
    | 'chooseCompatibleModel'
    | 'chooseTool'
    | 'inspectBudget'
    | 'chooseResourceAgain'
    | 'removeReference'
    | 'reconcile'
    | 'openPermissionSettings'
    | 'recover'
    | 'reloadLatest'
    | 'openResult';
  cliId?: string;
  providerId?: string;
  modelId?: string;
  existingCommandId?: string;
  conversationId?: string;
  capacity?: number;
  runtimeKind?: string;
  runtimeProfileId?: string;
  retryAfterMs?: number;
  deadline?: string;
  resourceKind?: string;
  resourceRefHash?: string;
  resourceId?: string;
  referenceKind?: string;
  referenceHash?: string;
  capabilityId?: string;
  permissionKind?: AgentCapabilityPermissionKind;
  toolId?: string;
  toolVersion?: string;
  budgetKind?: AgentRuntimeBudgetKind;
  limit?: string;
  sessionId?: string;
  leaseId?: string;
  expiredAt?: string;
  turnId?: string;
  reasonCode?: string;
  expectedRevision?: number;
  actualRevision?: number;
  terminalStatus?: AgentTerminalMutationStatus;
  label: string;
}

export const AGENT_ATTACHMENT_REJECTED_ERROR_TYPE =
  'CONTEXT_ATTACHMENT_REJECTED';
export const AGENT_QUEUE_FULL_ERROR_TYPE = 'ADMISSION_QUEUE_FULL';
export const AGENT_QUEUE_FULL_LOCALE_KEY = 'agent.errors.queueFull';
export const AGENT_RUNTIME_UNAVAILABLE_ERROR_TYPE = 'RUNTIME_UNAVAILABLE';
export const AGENT_RUNTIME_UNAVAILABLE_LOCALE_KEY =
  'agent.errors.runtimeUnavailable';
export const AGENT_RUNTIME_RESUME_UNAVAILABLE_ERROR_TYPE =
  'RUNTIME_RESUME_UNAVAILABLE';
export const AGENT_RUNTIME_RESUME_UNAVAILABLE_LOCALE_KEY =
  'agent.errors.resumeUnavailable';
export const AGENT_PROVIDER_RATE_LIMIT_ERROR_TYPE = 'PROVIDER_RATE_LIMIT';
export const AGENT_PROVIDER_RATE_LIMIT_LOCALE_KEY =
  'agent.errors.providerRateLimit';
export const AGENT_PROVIDER_MODEL_UNAVAILABLE_ERROR_TYPE =
  'PROVIDER_MODEL_UNAVAILABLE';
export const AGENT_PROVIDER_MODEL_UNAVAILABLE_LOCALE_KEY =
  'agent.errors.providerModelUnavailable';
export const AGENT_PROVIDER_TIMEOUT_ERROR_TYPE = 'PROVIDER_TIMEOUT';
export const AGENT_PROVIDER_TIMEOUT_LOCALE_KEY =
  'agent.errors.providerTimeout';
export const AGENT_TOOL_UNKNOWN_ERROR_TYPE = 'TOOL_UNKNOWN';
export const AGENT_TOOL_UNKNOWN_LOCALE_KEY = 'agent.errors.toolUnknown';
export const AGENT_TOOL_LOOP_BUDGET_EXHAUSTED_ERROR_TYPE =
  'TOOL_LOOP_BUDGET_EXHAUSTED';
export const AGENT_TOOL_LOOP_BUDGET_EXHAUSTED_LOCALE_KEY =
  'agent.errors.toolLoopBudgetExhausted';
export const AGENT_CONTEXT_LIMIT_ERROR_TYPE = 'CONTEXT_OVERFLOW';
export const AGENT_INVALID_REFERENCE_ERROR_TYPE = 'CONTEXT_INVALID_REFERENCE';
export const AGENT_INVALID_REFERENCE_LOCALE_KEY =
  'agent.errors.contextInvalidReference';
export const AGENT_INVALID_RESOURCE_REFERENCE_ERROR_TYPE =
  'CLIENT_INVALID_RESOURCE_REFERENCE';
export const AGENT_INVALID_RESOURCE_REFERENCE_LOCALE_KEY =
  'agent.errors.invalidResourceReference';
export const AGENT_CLIENT_LEASE_EXPIRED_ERROR_TYPE =
  'CLIENT_LEASE_EXPIRED';
export const AGENT_CLIENT_LEASE_EXPIRED_LOCALE_KEY =
  'agent.errors.clientLeaseExpired';
export const AGENT_CLIENT_PERMISSION_DENIED_ERROR_TYPE =
  'CLIENT_PERMISSION_DENIED';
export const AGENT_CLIENT_PERMISSION_DENIED_LOCALE_KEY =
  'agent.errors.clientPermissionDenied';
export const AGENT_FORBIDDEN_ACTOR_ERROR_TYPE = 'OWNERSHIP_FORBIDDEN_ACTOR';
export const AGENT_FORBIDDEN_ACTOR_LOCALE_KEY = 'agent.errors.forbiddenActor';
export const AGENT_INCOMPATIBLE_CAPABILITY_ERROR_TYPE =
  'RUNTIME_INCOMPATIBLE_CAPABILITY';
export const AGENT_INCOMPATIBLE_CAPABILITY_LOCALE_KEY =
  'agent.errors.incompatibleCapability';
export const AGENT_LIFECYCLE_INTERRUPTED_ERROR_TYPE = 'LIFECYCLE_INTERRUPTED';
export const AGENT_LIFECYCLE_INTERRUPTED_LOCALE_KEY =
  'agent.errors.lifecycleInterrupted';
export const AGENT_LIFECYCLE_STALE_VERSION_ERROR_TYPE =
  'LIFECYCLE_STALE_VERSION';
export const AGENT_LIFECYCLE_STALE_VERSION_LOCALE_KEY =
  'agent.errors.lifecycleStaleVersion';
export const AGENT_LIFECYCLE_TERMINAL_MUTATION_ERROR_TYPE =
  'LIFECYCLE_TERMINAL_MUTATION';
export const AGENT_LIFECYCLE_TERMINAL_MUTATION_LOCALE_KEY =
  'agent.errors.lifecycleTerminalMutation';

export type AgentForbiddenActorError = AgentTypedErrorPayload & {
  details: {
    resource_kind: string;
    resource_id: string;
  };
};

export type AgentQueueFullError = AgentTypedErrorPayload & {
  details: {
    conversation_id: string;
    capacity: string;
  };
};

export type AgentRuntimeUnavailableError = AgentTypedErrorPayload & {
  details: {
    runtime_kind: string;
    reason_code: string;
  };
};

export type AgentRuntimeResumeUnavailableError = AgentTypedErrorPayload & {
  details: {
    runtime_profile_id: string;
    reason_code: string;
  };
};

export type AgentProviderRateLimitError = AgentTypedErrorPayload & {
  details: {
    provider_id: string;
    retry_after_ms: string;
  };
};

export type AgentProviderModelUnavailableError = AgentTypedErrorPayload & {
  details: {
    provider_id: string;
    model_id: string;
  };
};

export type AgentProviderTimeoutError = AgentTypedErrorPayload & {
  details: {
    provider_id: string;
    model_id: string;
    deadline: string;
  };
};

export type AgentToolUnknownError = AgentTypedErrorPayload & {
  details: {
    tool_id: string;
    tool_version: string;
  };
};

export type AgentRuntimeBudgetKind =
  | 'tool_calls'
  | 'identical_tool_calls'
  | 'wall_time'
  | 'attempts'
  | 'agent_steps'
  | 'delegation_depth'
  | 'input_tokens'
  | 'output_tokens'
  | 'attachments'
  | 'cost';

export type AgentToolLoopBudgetExhaustedError = AgentTypedErrorPayload & {
  details: {
    turn_id: string;
    budget_kind: AgentRuntimeBudgetKind;
    limit: string;
  };
};

export type AgentIncompatibleCapabilityError = AgentTypedErrorPayload & {
  details: {
    capability_id: string;
    reason_code: string;
  };
};

export type AgentCapabilityPermissionKind =
  | 'clipboard'
  | 'filesystem'
  | 'camera'
  | 'microphone'
  | 'notifications'
  | 'screen_capture';

export type AgentClientPermissionDeniedError = AgentTypedErrorPayload & {
  details: {
    capability_id: string;
    permission_kind: AgentCapabilityPermissionKind;
  };
};

export type AgentLifecycleInterruptedError = AgentTypedErrorPayload & {
  details: {
    turn_id: string;
    reason_code: string;
  };
};

export type AgentLifecycleStaleVersionError = AgentTypedErrorPayload & {
  details: {
    resource_id: string;
    expected_revision: string;
    actual_revision: string;
  };
};

export type AgentLifecycleTerminalMutationError = AgentTypedErrorPayload & {
  details: {
    resource_id: string;
    terminal_status: AgentTerminalMutationStatus;
  };
};

export type AgentInvalidReferenceError = AgentTypedErrorPayload & {
  details: {
    reference_kind: string;
    reference_hash: string;
  };
};

export type AgentInvalidResourceReferenceError = AgentTypedErrorPayload & {
  details: {
    resource_kind: string;
    resource_ref_hash: string;
  };
};

export type AgentClientLeaseExpiredError = AgentTypedErrorPayload & {
  details: {
    session_id: string;
    lease_id: string;
    expired_at: string;
  };
};

const AGENT_TYPED_ERROR_FLAT_DETAIL_FIELDS = [
  'resource_kind',
  'resource_ref_hash',
  'resource_id',
  'conversation_id',
  'capacity',
  'runtime_kind',
  'runtime_profile_id',
  'provider_id',
  'model_id',
  'deadline',
  'retry_after_ms',
  'tool_id',
  'tool_version',
  'expected_revision',
  'actual_revision',
  'terminal_status',
  'capability_id',
  'capability_version',
  'expected_version',
  'actual_version',
  'schema_field',
  'binding_id',
  'target_device_id',
  'permission_kind',
  'policy_kind',
  'turn_id',
  'budget_kind',
  'limit',
  'reason_code',
  'reference_kind',
  'reference_hash',
  'session_id',
  'lease_id',
  'expired_at',
] as const;

const AGENT_INVALID_REFERENCE_KINDS = new Set([
  'file',
  'folder',
  'url',
  'diff',
  'staged',
  'git',
]);
const AGENT_CLIENT_RESOURCE_KINDS = new Set([
  'file',
  'folder',
  'image',
  'workspace',
]);
const AGENT_RUNTIME_BUDGET_KINDS = new Set<AgentRuntimeBudgetKind>([
  'tool_calls',
  'identical_tool_calls',
  'wall_time',
  'attempts',
  'agent_steps',
  'delegation_depth',
  'input_tokens',
  'output_tokens',
  'attachments',
  'cost',
]);
const AGENT_TERMINAL_MUTATION_STATUSES = new Set<AgentTerminalMutationStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const RFC3339_UTC_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u;

function isFiniteRFC3339UTC(value: string): boolean {
  const match = RFC3339_UTC_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction = ''] = match;
  const components = [year, month, day, hour, minute, second].map(Number);
  const [yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] =
    components;
  const date = new Date(0);
  date.setUTCFullYear(yearValue, monthValue - 1, dayValue);
  date.setUTCHours(
    hourValue,
    minuteValue,
    secondValue,
    Number(fraction.padEnd(3, '0').slice(0, 3)),
  );
  return (
    Number.isFinite(date.getTime())
    && date.getUTCFullYear() === yearValue
    && date.getUTCMonth() === monthValue - 1
    && date.getUTCDate() === dayValue
    && date.getUTCHours() === hourValue
    && date.getUTCMinutes() === minuteValue
    && date.getUTCSeconds() === secondValue
  );
}

function agentTypedErrorBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function agentTypedErrorDetails(
  data: Record<string, unknown>,
): Record<string, string> | undefined {
  if (data.details && typeof data.details === 'object' && !Array.isArray(data.details)) {
    const entries = Object.entries(data.details as Record<string, unknown>);
    if (entries.some(([, value]) => typeof value !== 'string')) {
      return undefined;
    }
    return Object.fromEntries(entries) as Record<string, string>;
  }
  return Object.fromEntries(
    AGENT_TYPED_ERROR_FLAT_DETAIL_FIELDS
      .map((field) => [field, data[field]] as const)
      .filter((entry): entry is [typeof AGENT_TYPED_ERROR_FLAT_DETAIL_FIELDS[number], string] => (
        typeof entry[1] === 'string'
      )),
  );
}

export function projectAgentTypedErrorPayload(
  data: Record<string, unknown>,
): AgentTypedErrorPayload | undefined {
  const errorType = typeof (data.error_type ?? data.errorType ?? data.error_code) === 'string'
    ? String(data.error_type ?? data.errorType ?? data.error_code)
    : '';
  const localeKey = typeof (data.locale_key ?? data.localeKey) === 'string'
    ? String(data.locale_key ?? data.localeKey)
    : '';
  const retryable = agentTypedErrorBoolean(data.retryable);
  const terminal = agentTypedErrorBoolean(data.terminal);
  if (!errorType || !localeKey || retryable === undefined || terminal === undefined) {
    return undefined;
  }
  const details = agentTypedErrorDetails(data);
  if (!details) {
    return undefined;
  }
  return {
    error: typeof data.error === 'string' ? data.error : localeKey,
    error_type: errorType,
    locale_key: localeKey,
    retryable,
    terminal,
    details,
  };
}

export function projectAgentTurnOutcomeErrorPayload(
  data: Record<string, unknown>,
): AgentTypedErrorPayload | undefined {
  const outcome = data.outcome_error ?? data.outcomeError;
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
    return undefined;
  }
  return projectAgentTypedErrorPayload(outcome as Record<string, unknown>);
}

export function projectAgentTurnErrorPayload(
  data: Record<string, unknown>,
): AgentTypedErrorPayload | undefined {
  if (data.outcome_error !== undefined || data.outcomeError !== undefined) {
    return projectAgentTurnOutcomeErrorPayload(data);
  }
  return projectAgentTypedErrorPayload(data);
}

export function isAgentForbiddenActorError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentForbiddenActorError {
  if (
    error?.error_type !== AGENT_FORBIDDEN_ACTOR_ERROR_TYPE
    || error.locale_key !== AGENT_FORBIDDEN_ACTOR_LOCALE_KEY
    || error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'resource_id'
    && detailKeys[1] === 'resource_kind'
    && error.details.resource_kind.trim().length > 0
    && error.details.resource_id.trim().length > 0
  );
}

export function isAgentQueueFullError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentQueueFullError {
  if (
    error?.error_type !== AGENT_QUEUE_FULL_ERROR_TYPE
    || error.locale_key !== AGENT_QUEUE_FULL_LOCALE_KEY
    || !error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  const capacity = Number(error.details.capacity);
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'capacity'
    && detailKeys[1] === 'conversation_id'
    && error.details.conversation_id.trim().length > 0
    && Number.isInteger(capacity)
    && capacity > 0
  );
}

export function isAgentRuntimeUnavailableError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentRuntimeUnavailableError {
  if (
    error?.error_type !== AGENT_RUNTIME_UNAVAILABLE_ERROR_TYPE
    || error.locale_key !== AGENT_RUNTIME_UNAVAILABLE_LOCALE_KEY
    || !error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'reason_code'
    && detailKeys[1] === 'runtime_kind'
    && error.details.runtime_kind.trim().length > 0
    && error.details.reason_code.trim().length > 0
  );
}

export function isAgentRuntimeResumeUnavailableError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentRuntimeResumeUnavailableError {
  if (
    error?.error_type !== AGENT_RUNTIME_RESUME_UNAVAILABLE_ERROR_TYPE
    || error.locale_key !== AGENT_RUNTIME_RESUME_UNAVAILABLE_LOCALE_KEY
    || !error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'reason_code'
    && detailKeys[1] === 'runtime_profile_id'
    && error.details.runtime_profile_id.trim().length > 0
    && error.details.reason_code.trim().length > 0
  );
}

export function isAgentProviderRateLimitError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentProviderRateLimitError {
  if (
    error?.error_type !== AGENT_PROVIDER_RATE_LIMIT_ERROR_TYPE
    || error.locale_key !== AGENT_PROVIDER_RATE_LIMIT_LOCALE_KEY
    || !error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  const retryAfterMs = Number(error.details.retry_after_ms);
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'provider_id'
    && detailKeys[1] === 'retry_after_ms'
    && error.details.provider_id.trim().length > 0
    && Number.isInteger(retryAfterMs)
    && retryAfterMs >= 0
  );
}

export function isAgentProviderModelUnavailableError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentProviderModelUnavailableError {
  if (
    error?.error_type !== AGENT_PROVIDER_MODEL_UNAVAILABLE_ERROR_TYPE
    || error.locale_key !== AGENT_PROVIDER_MODEL_UNAVAILABLE_LOCALE_KEY
    || !error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'model_id'
    && detailKeys[1] === 'provider_id'
    && error.details.provider_id.trim().length > 0
    && error.details.model_id.trim().length > 0
  );
}

export function isAgentProviderTimeoutError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentProviderTimeoutError {
  if (
    error?.error_type !== AGENT_PROVIDER_TIMEOUT_ERROR_TYPE
    || error.locale_key !== AGENT_PROVIDER_TIMEOUT_LOCALE_KEY
    || !error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 3
    && detailKeys[0] === 'deadline'
    && detailKeys[1] === 'model_id'
    && detailKeys[2] === 'provider_id'
    && error.details.provider_id.trim().length > 0
    && error.details.model_id.trim().length > 0
    && isFiniteRFC3339UTC(error.details.deadline)
  );
}

export function isAgentToolUnknownError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentToolUnknownError {
  if (
    error?.error_type !== AGENT_TOOL_UNKNOWN_ERROR_TYPE
    || error.locale_key !== AGENT_TOOL_UNKNOWN_LOCALE_KEY
    || error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'tool_id'
    && detailKeys[1] === 'tool_version'
    && error.details.tool_id.trim().length > 0
    && error.details.tool_version.trim().length > 0
  );
}

export function isAgentToolLoopBudgetExhaustedError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentToolLoopBudgetExhaustedError {
  if (
    error?.error_type !== AGENT_TOOL_LOOP_BUDGET_EXHAUSTED_ERROR_TYPE
    || error.locale_key !== AGENT_TOOL_LOOP_BUDGET_EXHAUSTED_LOCALE_KEY
    || error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  const limit = Number(error.details.limit);
  return (
    detailKeys.length === 3
    && detailKeys[0] === 'budget_kind'
    && detailKeys[1] === 'limit'
    && detailKeys[2] === 'turn_id'
    && error.details.turn_id.trim().length > 0
    && AGENT_RUNTIME_BUDGET_KINDS.has(
      error.details.budget_kind as AgentRuntimeBudgetKind,
    )
    && Number.isFinite(limit)
    && limit > 0
  );
}

export function isAgentIncompatibleCapabilityError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentIncompatibleCapabilityError {
  if (
    error?.error_type !== AGENT_INCOMPATIBLE_CAPABILITY_ERROR_TYPE
    || error.locale_key !== AGENT_INCOMPATIBLE_CAPABILITY_LOCALE_KEY
    || error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'capability_id'
    && detailKeys[1] === 'reason_code'
    && error.details.capability_id.trim().length > 0
    && error.details.reason_code.trim().length > 0
  );
}

const AGENT_CAPABILITY_PERMISSION_KINDS = new Set<AgentCapabilityPermissionKind>([
  'clipboard',
  'filesystem',
  'camera',
  'microphone',
  'notifications',
  'screen_capture',
]);

export function isAgentClientPermissionDeniedError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentClientPermissionDeniedError {
  if (
    error?.error_type !== AGENT_CLIENT_PERMISSION_DENIED_ERROR_TYPE
    || error.locale_key !== AGENT_CLIENT_PERMISSION_DENIED_LOCALE_KEY
    || error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'capability_id'
    && detailKeys[1] === 'permission_kind'
    && error.details.capability_id.trim().length > 0
    && AGENT_CAPABILITY_PERMISSION_KINDS.has(
      error.details.permission_kind as AgentCapabilityPermissionKind,
    )
  );
}

export function isAgentLifecycleInterruptedError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentLifecycleInterruptedError {
  if (
    error?.error_type !== AGENT_LIFECYCLE_INTERRUPTED_ERROR_TYPE
    || error.locale_key !== AGENT_LIFECYCLE_INTERRUPTED_LOCALE_KEY
    || !error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'reason_code'
    && detailKeys[1] === 'turn_id'
    && error.details.turn_id.trim().length > 0
    && error.details.reason_code.trim().length > 0
  );
}

export function isAgentInvalidReferenceError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentInvalidReferenceError {
  if (
    error?.error_type !== AGENT_INVALID_REFERENCE_ERROR_TYPE
    || error.locale_key !== AGENT_INVALID_REFERENCE_LOCALE_KEY
    || error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'reference_hash'
    && detailKeys[1] === 'reference_kind'
    && AGENT_INVALID_REFERENCE_KINDS.has(error.details.reference_kind)
    && SHA256_HEX_PATTERN.test(error.details.reference_hash)
  );
}

export function isAgentInvalidResourceReferenceError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentInvalidResourceReferenceError {
  if (
    error?.error_type !== AGENT_INVALID_RESOURCE_REFERENCE_ERROR_TYPE
    || error.locale_key !== AGENT_INVALID_RESOURCE_REFERENCE_LOCALE_KEY
    || error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'resource_kind'
    && detailKeys[1] === 'resource_ref_hash'
    && AGENT_CLIENT_RESOURCE_KINDS.has(error.details.resource_kind)
    && SHA256_HEX_PATTERN.test(error.details.resource_ref_hash)
  );
}

export function isAgentClientLeaseExpiredError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentClientLeaseExpiredError {
  if (
    error?.error_type !== AGENT_CLIENT_LEASE_EXPIRED_ERROR_TYPE
    || error.locale_key !== AGENT_CLIENT_LEASE_EXPIRED_LOCALE_KEY
    || !error.retryable
    || error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 3
    && detailKeys[0] === 'expired_at'
    && detailKeys[1] === 'lease_id'
    && detailKeys[2] === 'session_id'
    && error.details.session_id.trim().length > 0
    && error.details.lease_id.trim().length > 0
    && Number.isFinite(Date.parse(error.details.expired_at))
  );
}

export function isAgentLifecycleStaleVersionError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentLifecycleStaleVersionError {
  if (
    error?.error_type !== AGENT_LIFECYCLE_STALE_VERSION_ERROR_TYPE
    || error.locale_key !== AGENT_LIFECYCLE_STALE_VERSION_LOCALE_KEY
    || !error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  const expectedRevision = Number(error.details.expected_revision);
  const actualRevision = Number(error.details.actual_revision);
  return (
    detailKeys.length === 3
    && detailKeys[0] === 'actual_revision'
    && detailKeys[1] === 'expected_revision'
    && detailKeys[2] === 'resource_id'
    && error.details.resource_id.trim().length > 0
    && /^[1-9]\d*$/u.test(error.details.expected_revision)
    && /^[1-9]\d*$/u.test(error.details.actual_revision)
    && Number.isSafeInteger(expectedRevision)
    && Number.isSafeInteger(actualRevision)
    && actualRevision > expectedRevision
  );
}

export function isAgentLifecycleTerminalMutationError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentLifecycleTerminalMutationError {
  if (
    error?.error_type !== AGENT_LIFECYCLE_TERMINAL_MUTATION_ERROR_TYPE
    || error.locale_key !== AGENT_LIFECYCLE_TERMINAL_MUTATION_LOCALE_KEY
    || error.retryable
    || !error.terminal
  ) {
    return false;
  }
  const detailKeys = Object.keys(error.details).sort();
  return (
    detailKeys.length === 2
    && detailKeys[0] === 'resource_id'
    && detailKeys[1] === 'terminal_status'
    && error.details.resource_id.trim().length > 0
    && AGENT_TERMINAL_MUTATION_STATUSES.has(
      error.details.terminal_status as AgentTerminalMutationStatus,
    )
  );
}

export function resolveAgentTypedErrorAction(
  error: AgentTypedErrorPayload | null | undefined,
): AgentErrorResolutionAction | undefined {
  if (isAgentProviderTimeoutError(error)) {
    return {
      type: 'retry',
      providerId: error.details.provider_id,
      modelId: error.details.model_id,
      deadline: error.details.deadline,
      label: 'agent.recovery.retry',
    };
  }
  if (isAgentProviderRateLimitError(error)) {
    return {
      type: 'retryLater',
      providerId: error.details.provider_id,
      retryAfterMs: Number(error.details.retry_after_ms),
      label: 'agent.recovery.retryLater',
    };
  }
  if (isAgentProviderModelUnavailableError(error)) {
    return {
      type: 'chooseCompatibleModel',
      providerId: error.details.provider_id,
      modelId: error.details.model_id,
      label: 'agent.recovery.chooseCompatibleModel',
    };
  }
  if (isAgentToolUnknownError(error)) {
    return {
      type: 'chooseTool',
      toolId: error.details.tool_id,
      toolVersion: error.details.tool_version,
      label: 'agent.recovery.chooseTool',
    };
  }
  if (isAgentToolLoopBudgetExhaustedError(error)) {
    return {
      type: 'inspectBudget',
      turnId: error.details.turn_id,
      budgetKind: error.details.budget_kind,
      limit: error.details.limit,
      label: 'agent.recovery.inspectBudget',
    };
  }
  if (isAgentRuntimeUnavailableError(error)) {
    return {
      type: 'selectRuntime',
      runtimeKind: error.details.runtime_kind,
      reasonCode: error.details.reason_code,
      label: 'agent.recovery.selectRuntime',
    };
  }
  if (isAgentRuntimeResumeUnavailableError(error)) {
    return {
      type: 'confirmReset',
      runtimeProfileId: error.details.runtime_profile_id,
      reasonCode: error.details.reason_code,
      label: 'agent.recovery.confirmReset',
    };
  }
  if (isAgentQueueFullError(error)) {
    return {
      type: 'editQueue',
      conversationId: error.details.conversation_id,
      capacity: Number(error.details.capacity),
      label: 'agent.recovery.editQueue',
    };
  }
  if (isAgentForbiddenActorError(error)) {
    return {
      type: 'switchAccount',
      resourceKind: error.details.resource_kind,
      resourceId: error.details.resource_id,
      label: 'agent.recovery.switchAccount',
    };
  }
  if (isAgentIncompatibleCapabilityError(error)) {
    return {
      type: 'chooseCompatibleModel',
      capabilityId: error.details.capability_id,
      reasonCode: error.details.reason_code,
      label: 'agent.recovery.chooseCompatibleModel',
    };
  }
  if (isAgentClientPermissionDeniedError(error)) {
    return {
      type: 'openPermissionSettings',
      capabilityId: error.details.capability_id,
      permissionKind: error.details.permission_kind,
      label: 'agent.recovery.openPermissionSettings',
    };
  }
  if (isAgentLifecycleInterruptedError(error)) {
    return {
      type: 'recover',
      turnId: error.details.turn_id,
      reasonCode: error.details.reason_code,
      label: 'agent.recovery.recover',
    };
  }
  if (isAgentLifecycleStaleVersionError(error)) {
    return {
      type: 'reloadLatest',
      resourceId: error.details.resource_id,
      expectedRevision: Number(error.details.expected_revision),
      actualRevision: Number(error.details.actual_revision),
      label: 'agent.recovery.reloadLatest',
    };
  }
  if (isAgentLifecycleTerminalMutationError(error)) {
    return {
      type: 'openResult',
      resourceId: error.details.resource_id,
      turnId: error.details.resource_id,
      terminalStatus: error.details.terminal_status,
      label: 'agent.recovery.openResult',
    };
  }
  if (isAgentInvalidResourceReferenceError(error)) {
    return {
      type: 'chooseResourceAgain',
      resourceKind: error.details.resource_kind,
      resourceRefHash: error.details.resource_ref_hash,
      label: 'agent.recovery.chooseResourceAgain',
    };
  }
  if (isAgentClientLeaseExpiredError(error)) {
    return {
      type: 'reconcile',
      sessionId: error.details.session_id,
      leaseId: error.details.lease_id,
      expiredAt: error.details.expired_at,
      label: 'agent.recovery.reconcile',
    };
  }
  if (isAgentInvalidReferenceError(error)) {
    return {
      type: 'removeReference',
      referenceKind: error.details.reference_kind,
      referenceHash: error.details.reference_hash,
      label: 'agent.recovery.removeReference',
    };
  }
  if (
    error?.error_type === 'PROVIDER_CREDENTIAL_MISSING'
    && error.details.provider_id
  ) {
    return {
      type: 'openProviderSettings',
      providerId: error.details.provider_id,
      label: 'agent.recovery.configureCredential',
    };
  }
  if (
    error?.error_type === 'ADMISSION_DUPLICATE_CONFLICT'
    && error.details.existing_command_id
  ) {
    return {
      type: 'openOriginal',
      existingCommandId: error.details.existing_command_id,
      label: 'agent.recovery.openOriginal',
    };
  }
  return undefined;
}

export function isAgentAttachmentRejectedError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentTypedErrorPayload {
  return error?.error_type === AGENT_ATTACHMENT_REJECTED_ERROR_TYPE;
}

export function isAgentContextOverflowError(
  error: AgentTypedErrorPayload | null | undefined,
): error is AgentTypedErrorPayload {
  return error?.error_type === AGENT_CONTEXT_LIMIT_ERROR_TYPE;
}

export interface AgentTurnStreamError extends Error {
  typedError?: AgentTypedErrorPayload;
  resolution?: AgentErrorResolutionAction;
  errorDetail?: string;
  providerId?: string;
}

export interface AgentToolDecisionIntentResponse {
  accepted: boolean;
  decision_revision: number;
  approval_id: string;
  tool_call_id: string;
  decision_id: string;
  approved: boolean;
  idempotency_key: string;
  payload_hash: string;
  error_code: string;
  outcome_error?: AgentTypedErrorPayload | null;
}

export interface McpToolSchemaEntry {
  name: string;
  description: string;
  parameters_schema: string;
  server_name: string;
  source: 'mcp';
}

export interface AgentExecuteTurnInput {
  stream_id?: string;
  client_idempotency_key: string;
  conversation_id: string;
  agent_id: string;
  user_input: string;
  attachments?: AgentAttachmentRefInput[];
  requested_budget?: AgentRuntimeBudgetInput;
  provider?: string;
  model?: string;
  identity?: string;
  agent_config_prompt?: string;
  effort?: string;
  thinking_mode?: AgentThinkingMode;
  context_window_size?: number;
  max_retries?: number;
  client_capability_session_id?: string;
  available_tools?: McpToolSchemaEntry[];
  memory_disabled?: boolean;
}

function createAgentTurnStreamId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `agent-turn-${randomId}`;
}

let agentTurnStreamGeneration = Date.now();

function nextAgentTurnStreamGeneration(): number {
  agentTurnStreamGeneration += 1;
  return agentTurnStreamGeneration;
}

export interface AgentTurnStreamCancelInput {
  turn_id: string;
}

export interface AgentTurnTransportCancelInput {
  stream_id: string;
}

export interface AgentTurnReplayStreamInput {
  stream_id: string;
  conversation_id: string;
  turn_id: string;
  after_seq: number;
  attempt_id?: string;
}

export interface AgentTurnReplayStreamCancelInput {
  stream_id: string;
}

export function toAgentTurnReplayWireInput(input: Omit<AgentTurnReplayStreamInput, 'stream_id'>): {
  conversation_id: string;
  turn_id: string;
  afterSequence: number;
  attempt_id?: string;
} {
  return {
    conversation_id: input.conversation_id,
    turn_id: input.turn_id,
    afterSequence: input.after_seq,
    ...(input.attempt_id ? { attempt_id: input.attempt_id } : {}),
  };
}

export interface AgentTurnQueueEntry {
  queue_entry_id: string;
  conversation_id: string;
  agent_id: string;
  client_idempotency_key: string;
  status: string;
  queue_sequence: number;
  queue_position: number;
  admitted_turn_id: string;
  user_input: string;
}

export interface AgentTurnQueueListOutput {
  entries: AgentTurnQueueEntry[];
  queue_capacity: number;
  conversation_version: number;
}

export interface AgentTurnQueueCancelInput {
  conversation_id: string;
  queue_entry_id: string;
  idempotency_key: string;
  expected_conversation_version: number;
}

export interface AgentTurnTraceListInput {
  agent_id: string;
  conversation_id?: string;
  page?: number;
  page_size?: number;
}

export interface AgentTurnTraceGetInput {
  trace_id?: string;
  turn_id?: string;
}

export interface AgentTurnDiagnosticsInput {
  turn_id: string;
}

export interface AgentRuntimeProfileInput {
  agent_id: string;
}

export interface AgentCapabilityReadinessInput {
  agent_id: string;
  runtime_snapshot_id?: string;
  client_capability_session_id?: string;
}

type SnakeCase<S extends string> =
  S extends `${infer Head}${infer Tail}`
    ? Tail extends Uncapitalize<Tail>
      ? `${Lowercase<Head>}${SnakeCase<Tail>}`
      : `${Lowercase<Head>}_${SnakeCase<Uncapitalize<Tail>>}`
    : S;

type ProtoJsonProjection<T> =
  T extends bigint ? string
    : T extends Uint8Array ? string
      : T extends ReadonlyArray<infer Item> ? ProtoJsonProjection<Item>[]
        : T extends object
          ? {
              [Key in keyof T as Key extends '$typeName'
                ? never
                : Key extends string
                  ? SnakeCase<Key>
                  : Key]: ProtoJsonProjection<T[Key]>
            }
          : T;

type AgentCapabilityReadinessStateJson =
  | 'CAPABILITY_READINESS_STATE_UNSPECIFIED'
  | 'CAPABILITY_READINESS_STATE_READY'
  | 'CAPABILITY_READINESS_STATE_DEGRADED'
  | 'CAPABILITY_READINESS_STATE_UNAVAILABLE'
  | 'CAPABILITY_READINESS_STATE_BLOCKED'
  | 'CAPABILITY_READINESS_STATE_UNKNOWN';

type AgentCapabilityReadiness = Omit<
  ProtoJsonProjection<ProtoCapabilityReadiness>,
  'state'
> & {
  state: AgentCapabilityReadinessStateJson;
};

export type AgentCapabilityReadinessSnapshot = Omit<
  ProtoJsonProjection<ProtoCapabilityReadinessSnapshot>,
  'capabilities'
> & {
  capabilities: AgentCapabilityReadiness[];
};

export function isAgentCapabilityReady(
  capability: AgentCapabilityReadiness,
): boolean {
  return capability.state === 'CAPABILITY_READINESS_STATE_READY';
}

export interface AgentCapabilityBindingInput {
  bindingId?: string;
  agentId: string;
  capabilityId: string;
  capabilityVersion: string;
  enabled: boolean;
  approvalPolicy: CapabilityApprovalPolicy;
  expectedAgentVersion: number | bigint;
}

function toRustUint64(value: number | bigint, field: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`agent.capabilityInvalidUint64:${field}`);
  }
  return numeric;
}

function toPositiveRustUint64(value: number | bigint, field: string): number {
  const numeric = toRustUint64(value, field);
  if (numeric === 0) {
    throw new Error(`agent.capabilityInvalidUint64:${field}`);
  }
  return numeric;
}

export interface AgentRuntimeActivityInput {
  runtime_kind: 1 | 2;
  runtime_id: 'trae-cli' | 'external-agent';
}

export interface AgentRuntimeAdvertisement {
  runtime_kind: string;
  runtime_id: string;
  state: string;
  reason_code: string;
}

export interface AgentEffectiveRuntimeProfile {
  snapshot_id: string;
  ptid: string;
  agent_id: string;
  profile_id: string;
  profile_revision: number;
  readiness_snapshot_id: string;
  runtimes: AgentRuntimeAdvertisement[];
  observed_at: { seconds: number; nanos: number } | null;
}

export interface AgentRuntimeActivitySnapshot {
  snapshot_id: string;
  owner: string;
  owner_instance_id: string;
  ptid: string;
  runtime_kind: string;
  runtime_id: string;
  counter_epoch: string;
  counters: {
    runtime_bindings_created: number;
    external_sessions_created: number;
    runtime_homes_created: number;
    processes_started: number;
    workspaces_created: number;
  };
  observed_at?: { seconds: number; nanos: number } | null;
  observed_at_unix_ms?: number;
}

export interface AgentCapabilitySessionSnapshot {
  active_session_count: number;
  sessions: Array<{
    actor_id_hash: string;
    device_id_hash: string;
    capability_session_id_hash: string;
    lease_id_hash: string;
    lease_revision: number;
    capability_set_hash: string;
    platform: string;
    capability_ids: string[];
    local_execution_attempt_count: number;
    local_side_effect_count: number;
    tool_call_side_effect_counts: Array<{
      tool_call_id: string;
      side_effect_count: number;
    }>;
    expires_at_ms: number;
  }>;
}

export type AgentCapabilityNegativeControl =
  | 'unsupported'
  | 'unauthorized'
  | 'signatureTamper'
  | 'schemaMismatch'
  | 'crossDevice'
  | 'leasePause'
  | 'leaseExpired'
  | 'permissionDenied'
  | 'permissionGranted';

export interface AgentCapabilityNegativeControlFact {
  control: AgentCapabilityNegativeControl;
  availability: 'available' | 'unavailable';
  unavailableReason?: string;
  capabilitySessionIdHash: string;
  workerPaused?: boolean;
  before: {
    localExecutionAttemptCount: number;
    localSideEffectCount: number;
  };
  station?: {
    endpoint: string;
    requestSent: boolean;
    responseReceived: boolean;
    commandErrorCode?: string;
    httpStatus?: number;
    transportErrorKind?: string;
    stationErrorDetails?: Record<string, unknown>;
    requestHash?: string;
  };
  sourceStation?: AgentCapabilityNegativeControlFact['station'];
  replayStation?: AgentCapabilityNegativeControlFact['station'];
  leaseTransition?: {
    sourceCapabilitySessionIdHash: string;
    sourceLeaseIdHash: string;
    sourceLeaseRevision: number;
    sourceExpiresAtMs: number;
    currentCapabilitySessionIdHash: string;
    currentLeaseIdHash: string;
    currentExpiresAtMs: number;
    currentLeaseRevision: number;
    currentPullCursor: number;
  };
  after: {
    localExecutionAttemptCount: number;
    localSideEffectCount: number;
  };
}

export interface AgentCapabilitySessionList {
  sessions: Array<{
    session_id: string;
    ptid: string;
    device_id: string;
    platform: string;
    typed_capabilities: Array<{
      capability_id: string;
      schema_version: string;
      permission: string;
      permission_kind: string;
      constraints: {
        max_request_bytes: number;
        max_result_bytes: number;
        allowed_resource_kinds: string[];
      } | null;
    }>;
    expires_at: { seconds: number; nanos: number } | null;
    connection_id: string;
    lease_id: string;
    lease_revision: number;
  }>;
}

export interface AgentConversation {
  conversation_id: string;
  agent_id: string;
  ptid: string;
  title: string;
  description?: string;
  provider_id?: string;
  model_name?: string;
  status: string;
  parent_id?: string;
  active_branch_message_id: string;
  queued_turn_count: number;
  version: number;
  runtime_binding?: {
    runtime_kind: number;
    provider_id: string;
    model_id: string;
    runtime_profile_id: string;
    external_session_id: string;
    external_session_epoch: number;
    runtime_home_ref: string;
    capability_snapshot_hash: string;
    config_snapshot_hash: string;
    bound_at: { seconds: number; nanos: number } | null;
    state: number;
    last_error_code: string;
    updated_at: { seconds: number; nanos: number } | null;
  };
  meta?: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  message_id: string;
  conversation_id: string;
  turn_id?: string;
  model_name?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  status: string;
  content: string;
  seq: number;
  branch_id?: string;
  parent_message_id?: string;
  replaces_message_id?: string;
  thread_id?: string;
  reasoning_json?: string;
  tool_calls_json?: string;
  metadata_json?: string;
  error_json?: string;
  attachments?: AgentAttachmentRefInput[];
  created_at: string;
  updated_at: string;
}

export interface AgentConversationListInput {
  agent_id: string;
  status?: string;
  page?: number;
  page_size?: number;
}

export interface AgentConversationGetInput {
  conversation_id: string;
}

export interface AgentConversationCreateInput {
  agent_id: string;
  title?: string;
  description?: string;
  model_name?: string;
  provider_id?: string;
}

export interface AgentConversationMessagesInput {
  conversation_id: string;
  after_seq?: number;
  before_seq?: number;
  limit?: number;
}

export interface AgentConversationArchiveInput {
  conversation_id: string;
  permanent?: boolean;
  expected_version: number;
}

export interface AgentConversationUpdateInput {
  conversation_id: string;
  expected_version: number;
  title?: string;
  description?: string;
  model_name?: string;
  meta?: Record<string, string>;
  active_branch_message_id?: string;
}

export interface AgentConversationRestoreInput {
  conversation_id: string;
  expected_version: number;
}

export interface AgentConversationRuntimeResetInput {
  conversation_id: string;
  expected_conversation_version: number;
  client_idempotency_key: string;
  destructive_confirmed: boolean;
}

export interface AgentConversationRuntimeResetResult {
  conversation: AgentConversation;
  closed_external_session_epoch: number;
  replayed: boolean;
}

function agentProtoTimestamp(
  value: ProtoAgentConversation['createdAt'],
): { seconds: number; nanos: number } | null {
  if (!value) return null;
  return {
    seconds: toRustUint64(value.seconds, 'timestamp.seconds'),
    nanos: value.nanos,
  };
}

function agentProtoTimestampISO(
  value: ProtoAgentConversation['createdAt'],
): string {
  if (!value) return '';
  const milliseconds = (
    toRustUint64(value.seconds, 'timestamp.seconds') * 1_000
    + Math.floor(value.nanos / 1_000_000)
  );
  return new Date(milliseconds).toISOString();
}

function agentConversationFromProto(
  conversation: ProtoAgentConversation,
): AgentConversation {
  const binding = conversation.runtimeBinding;
  return {
    conversation_id: conversation.conversationId,
    agent_id: conversation.agentId,
    ptid: conversation.ptid || conversation.actorPtid,
    title: conversation.title,
    description: conversation.description,
    provider_id: conversation.providerId,
    model_name: conversation.modelName,
    status: conversation.status,
    parent_id: conversation.parentId,
    active_branch_message_id: conversation.activeBranchMessageId,
    queued_turn_count: conversation.queuedTurnCount,
    version: toRustUint64(conversation.version, 'conversation.version'),
    runtime_binding: binding
      ? {
          runtime_kind: binding.runtimeKind,
          provider_id: binding.providerId,
          model_id: binding.modelId,
          runtime_profile_id: binding.runtimeProfileId,
          external_session_id: binding.externalSessionId,
          external_session_epoch: toRustUint64(
            binding.externalSessionEpoch,
            'runtime_binding.external_session_epoch',
          ),
          runtime_home_ref: binding.runtimeHomeRef,
          capability_snapshot_hash: binding.capabilitySnapshotHash,
          config_snapshot_hash: binding.configSnapshotHash,
          bound_at: agentProtoTimestamp(binding.boundAt),
          state: binding.state,
          last_error_code: binding.lastErrorCode,
          updated_at: agentProtoTimestamp(binding.updatedAt),
        }
      : undefined,
    meta: conversation.meta,
    created_at: agentProtoTimestampISO(conversation.createdAt),
    updated_at: agentProtoTimestampISO(conversation.updatedAt),
  };
}

function agentRuntimeResetResultFromProto(
  response: ResetConversationRuntimeResponse,
): AgentConversationRuntimeResetResult {
  if (!response.conversation) {
    throw new Error('agent.runtimeResetConversationMissing');
  }
  return {
    conversation: agentConversationFromProto(response.conversation),
    closed_external_session_epoch: toRustUint64(
      response.closedExternalSessionEpoch,
      'closed_external_session_epoch',
    ),
    replayed: response.replayed,
  };
}

export interface AgentRuntimeBudgetInput {
  max_attempts?: number;
  max_agent_steps?: number;
  max_tool_calls?: number;
  max_identical_tool_calls?: number;
  max_delegation_depth?: number;
  wall_time_ms?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_attachment_bytes?: number;
  max_cost?: number;
}

export interface AgentRetryTurnInput {
  conversation_id: string;
  source_turn_id: string;
  client_idempotency_key: string;
  expected_conversation_version: number;
  requested_budget?: AgentRuntimeBudgetInput;
}

export interface AgentRegenerateTurnInput {
  conversation_id: string;
  source_assistant_message_id: string;
  client_idempotency_key: string;
  expected_conversation_version: number;
  requested_budget?: AgentRuntimeBudgetInput;
}

export interface AgentEditAndResendInput {
  conversation_id: string;
  source_user_message_id: string;
  revised_content: string;
  attachments?: AgentAttachmentRefInput[];
  client_idempotency_key: string;
  expected_conversation_version: number;
  requested_budget?: AgentRuntimeBudgetInput;
}

export interface AgentSelectActiveBranchInput {
  conversation_id: string;
  active_branch_message_id: string;
  client_idempotency_key: string;
  expected_conversation_version: number;
}

export interface AgentTombstoneMessageInput {
  conversation_id: string;
  message_id: string;
  client_idempotency_key: string;
  expected_conversation_version: number;
  destructive_confirmed: boolean;
  reason?: string;
}

export interface AgentThread {
  thread_id: string;
  conversation_id: string;
  source_message_id: string;
  title: string;
  source_seq: number;
  created_at: string;
  updated_at: string;
}

export interface AgentThreadCreateInput {
  conversation_id: string;
  source_message_id: string;
  title?: string;
}

export interface AgentThreadListInput {
  conversation_id: string;
}

export interface AgentThreadMessagesInput {
  thread_id: string;
  after_seq?: number;
}

export interface AgentGroupCreateInput {
  name: string;
  description?: string;
  member_agent_ids?: string[];
  orchestration_mode?: string;
}

export interface AgentGroupUpdateInput {
  id: string;
  name?: string;
  description?: string;
  member_agent_ids?: string[];
  orchestration_mode?: string;
}

export interface AgentGroupDeleteInput {
  id: string;
}

export interface StationAgentGroupRow {
  ID: string;
  Name: string;
  Description: string;
  MemberAgentIDs: string;
  OrchestrationMode: string;
  OwnerActorID: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface TopicCommentCreateInput {
  topic_key: string;
  content: string;
}

export interface TopicCommentDeleteInput {
  topic_key: string;
  comment_id: string;
}

export interface TopicCommentListInput {
  topic_key: string;
}

export interface StationTopicCommentRow {
  ID: string;
  TopicKey: string;
  Content: string;
  AuthorID: string;
  CreatedAt: string;
}

export interface AgentTaskCreateInput {
  title: string;
  description?: string;
  agent_id: string;
  priority?: string;
  topic_key?: string;
}

export interface AgentTaskListInput {
  agent_id?: string;
}

export interface AgentTaskStatusInput {
  id: string;
  status: string;
  result?: string;
  error?: string;
}

export interface AgentTaskDeleteInput {
  id: string;
}

export interface AgentTaskSubtaskAddInput {
  task_id: string;
  title: string;
}

export interface AgentTaskSubtaskCompleteInput {
  task_id: string;
  subtask_id: string;
}

export interface AgentMessageTranslateInput {
  message_id: string;
  translation: string;
}

export interface StationAgentSubtaskRow {
  id: string;
  title: string;
  status: string;
  completed_at?: number;
}

export interface StationAgentTaskRow {
  id: string;
  title: string;
  description: string;
  agent_id: string;
  status: string;
  priority: string;
  progress: number;
  subtasks: StationAgentSubtaskRow[];
  topic_key: string;
  result: string;
  error: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface AgentTurnStreamPayload {
  streamId: string;
  ptid: string;
  event: string;
  data: Record<string, unknown>;
}

export interface CronIdInput {
  id: string;
}

export interface CronCreateInput {
  data: CronJobCreate;
}

export interface CronUpdateInput {
  id: string;
  data: Partial<CronJobCreate>;
}

export interface CronToggleInput {
  id: string;
  enabled: boolean;
}

export interface CronRunsInput {
  job_id: string;
}

export interface CronParseScheduleInput {
  text: string;
}

export interface ModelConfigKeyInput {
  key: string;
}

export interface ModelConfigSetInput {
  key: string;
  ref: ModelRef | null;
}

export interface ProviderIdInputV2 {
  provider_id: string;
}

export interface ChannelIdInput {
  id: string;
}

export interface ChannelCreateInput {
  name: string;
  type: string;
  config: string;
  enabled?: boolean;
}

export interface ChannelUpdateInput {
  id: string;
  name?: string;
  type?: string;
  config?: string;
  enabled?: boolean;
}

export interface ChannelSendMessageInput {
  id: string;
  text: string;
  title?: string;
  target_id?: string;
  target_type?: string;
}

export interface ChannelEventsInput {
  id: string;
  limit?: number;
  offset?: number;
}

export interface OAuthIdInput {
  id: string;
}

export interface OAuthSetCredentialsInput {
  id: string;
  client_id: string;
  client_secret: string;
}

export interface OAuthAuthorizeInput {
  id: string;
  environment?: string;
  return_to?: string;
}

export interface OAuthLoopbackStartInput {
  id: string;
  environment?: string;
  purpose: 'account_login' | 'connector_link';
}

export interface OAuthLoopbackPollInput {
  session_id: string;
}

export interface AccountUpsertOAuthInput {
  provider: string;
  provider_user_id: string;
  name?: string;
  created_at?: string;
  email?: string;
  avatar_url?: string;
  profile_url?: string;
}

interface AccountIdInput {
  id: string;
}

export interface OAuthResourceInput {
  id: string;
  resource: string;
  params?: Record<string, string>;
}

export interface MemoryIdInput {
  id: string;
}

export interface MemoryListInput {
  params?: Record<string, any>;
}

export interface MemorySearchInput {
  query: string;
  layers?: string[];
  limit?: number;
  agent_id?: string;
  since?: string;
  until?: string;
  period?: string;
}

export interface MemoryEventsInput {
  params?: Record<string, any>;
}

export interface MemoryExportInput {
  params?: Record<string, any>;
}

export interface MemoryImportInput {
  data: ExportData;
  skip_duplicates?: boolean;
}

export interface MemoryPersonaInput {
  agent_id?: string;
}

export interface TtsInput {
  text: string;
  voice?: string;
  speed?: number;
}

export interface TopicIdInput {
  topic_id: string;
}

export interface NotebookIdInput {
  id: string;
}

export interface NotebookCreateInput {
  topic_id: string;
  title: string;
  content: string;
  type?: string;
}

export interface NotebookUpdateInput {
  id: string;
  title: string;
  content: string;
}

export interface AppletIdInput {
  id: string;
}

export interface AppletConfigSetInput {
  id: string;
  config: Record<string, unknown>;
}

export interface AppletActionInput {
  id: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface AppletCreateSessionInput {
  id: string;
  sessionId?: string;
  manifest: {
    id: string;
    permissions: string[];
    services?: unknown[];
    skills?: unknown[];
  };
}

export interface AppletInvokeInput {
  id: string;
  sessionId: string;
  capability: string;
  action?: string;
  params?: Record<string, unknown>;
  manifest: {
    id: string;
    permissions: string[];
    services?: unknown[];
    skills?: unknown[];
  };
}

export interface AppletProductWindowLaunchContext {
  enabled: boolean;
  appletId?: string;
  actorPtid?: string;
  name?: string;
  email?: string;
  loginMethod?: string;
  mode?: 'product-shell' | 'lifecycle-smoothness';
  secondaryAppletId?: string;
  startPage?: string;
  closeAfterRender?: boolean;
  closeAfterRenderDelayMs?: number;
}

export interface AppletProductWindowRenderedInput {
  appletId: string;
  readySource?: 'lifecycle.reportReady' | 'host-render-fallback' | string;
}

export interface AppletProductWindowLifecycleInput {
  evidence: Record<string, unknown>;
}

export interface SkillImportAddressInput {
  agent_id?: string;
  address: string;
  oauth_provider?: string;
}

export interface SkillImportGitHubInput {
  agent_id?: string;
  owner: string;
  repo: string;
  branch?: string;
  file_path?: string;
}

export interface SkillImportZipInput {
  agent_id?: string;
  file_name: string;
  data_base64: string;
}

export interface SkillMarketIdInput {
  id: string;
}

export interface SkillMarketAddInput {
  source_id?: string;
  url: string;
  name?: string;
  branch?: string;
  manifest_path?: string;
  publisher_id?: string;
  signing_key_id?: string;
  public_key_base64?: string;
}

export interface SkillMarketSyncInput {
  market_id: string;
}

export interface SkillMarketListInput {
  market_id: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface SkillMarketDetailInput {
  agent_id?: string;
  market_id: string;
  file_path: string;
  risk_acknowledged?: boolean;
}

export interface AgentIdInput {
  id: string;
  include_local_paths?: boolean;
  includeLocalPaths?: boolean;
}

export interface AgentCreateInput {
  data: AgentCreate;
}

export interface AgentUpdateInput {
  id: string;
  data: Partial<AgentCreate>;
}

export interface AgentDuplicateInput {
  id: string;
  name: string;
}

export interface AgentSearchInput {
  q: string;
}

export interface AgentSelectInput {
  name: string;
}

export interface SearchPrimaryInput {
  provider: string;
}

export interface SearchQueryInput {
  query: string;
  source?: string;
  limit?: number;
}

export interface AiSearchInput {
  query: string;
  web?: boolean;
}

export interface PreferencesSetInput {
  prefs: Partial<UserPreferences>;
}

export interface ExternalUrlInput {
  url: string;
}

export interface ShareSessionInput {
  session_key: string;
}

export interface ShareIdInput {
  share_id: string;
}

export interface LogsTailInput {
  cursor: number;
  limit?: number;
  max_bytes?: number;
}

export interface OAuthSimulateStartInput {
  create_bot?: boolean;
  app_name?: string;
}

export interface OAuthSessionInput {
  session_id: string;
}

export interface OAuthCreateBotSessionInput {
  app_name?: string;
}

export interface ConfigSectionInput {
  section: string;
}

export interface ConfigSectionSetInput {
  section: string;
  values: Record<string, any>;
}

export interface ConfigFieldResetInput {
  section: string;
  field: string;
}

export interface ConfigPostgresTestInput {
  dsn: string;
}

export interface ContextSnapshotGetInput {
  slices?: string[];
}

export interface ContextActionDispatchInput {
  action: string;
  payload?: Record<string, unknown>;
}

export interface ChatScopeCursorSetInput {
  scope: string;
  cursor: string;
}

export interface ChatScopeCursorGetInput {
  scope: string;
}

export interface ChatKeyRotateInput {
  next_version: number;
}

export interface ContextCapabilitiesOutput {
  capability: Record<string, boolean>;
  updatedAt: number;
}

export interface ContextHealthOutput {
  status: 'booting' | 'ready' | 'degraded';
  runtimeState: string;
  networkOnline: boolean;
  degraded: boolean;
  issues: string[];
  updatedAt: number;
}

// ── Station registry types ──

export interface StationEntry {
  url: string;
  label?: string;
  peer_id?: string;
  peers_count?: number;
  last_probe?: string;
  online: boolean;
}

export interface StationListResponse {
  entries: StationEntry[];
  active_url?: string | null;
  binding: StationBindingState;
}

export type StationBindingPhase =
  | 'unbound'
  | 'connecting'
  | 'access_gate'
  | 'bound'
  | 'switching'
  | 'failed';

export interface StationBindingError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface StationBindingState {
  phase: StationBindingPhase;
  selected_url?: string | null;
  bound_url?: string | null;
  target_url?: string | null;
  generation: number;
  error?: StationBindingError | null;
}

export interface StationProbeResult {
  url: string;
  online: boolean;
  label?: string;
  peer_id?: string;
  peers_count?: number;
  error?: string;
}

function requireEvaluationValue<T>(
  value: T | undefined,
  errorKey: string,
): T {
  if (!value) throw new Error(errorKey);
  return value;
}

export const api = {
  accessStart: () =>
    invokeAccessCommand<void>('access_start'),

  accessSubmitInviteCode: (input: AccessSubmitInviteInput) =>
    invokeAccessCommand<AccessSubmitInviteInput>('access_submit_invite_code', input),

  accessSubmitLogin: (input: AccessSubmitLoginInput) =>
    invokeAuthCommand<AccessSubmitLoginInput>('access_submit_login', input),

  accessDecision: (attemptId: string) =>
    invokeAccessCommand<AccessDecisionInput>('access_decision', { attempt_id: attemptId }),

  accessCancel: (attemptId: string) =>
    invokeAccessCommand<AccessDecisionInput>('access_cancel', { attempt_id: attemptId }),

  authLogout: () =>
    invokeAuthCommand<void>('auth_logout'),

  acceptanceLogoutWindowSession: (expectedActorPtid: string) =>
    invokeAuthCommand<{ expected_actor_ptid: string }>(
      'acceptance_logout_window_session',
      { expected_actor_ptid: expectedActorPtid },
    ),

  authRestoreSession: () =>
    invokeAuthCommand<void>('auth_restore_session'),

  authValidateToken: (input: AuthValidateTokenInput) =>
    invokeAuthCommand<AuthValidateTokenInput>('auth_validate_token', input),

  ensureStationSession: () =>
    invokeAuthCommand<void>('ensure_station_session'),

  settingsGet: (input: SettingsGetInput) =>
    invokeRustCommand<SettingsGetInput, SettingsGetPayload>('settings_get', input),

  settingsSet: (input: SettingsSetInput) =>
    invokeRustCommand<SettingsSetInput, TauriStubPayload>('settings_set', input),

  settingsReset: () =>
    invokeRustCommand<void, TauriStubPayload>('settings_reset'),

  chatScreenshotShortcutRegister: (input: ChatScreenshotShortcutRegisterInput) =>
    invokeRustCommand<ChatScreenshotShortcutRegisterInput, TauriStubPayload>(
      'chat_screenshot_shortcut_register',
      input,
    ),

  timelineList: (input: TimelineListInput) =>
    invokeRustCommand<TimelineListInput, TauriStubPayload>('timeline_list', input),

  timelineLike: (input: TimelineActionInput) =>
    invokeRustCommand<TimelineActionInput, TauriStubPayload>('timeline_like', input),

  timelineComment: (input: TimelineActionInput) =>
    invokeRustCommand<TimelineActionInput, TauriStubPayload>('timeline_comment', input),

  timelineRepost: (input: TimelineActionInput) =>
    invokeRustCommand<TimelineActionInput, TauriStubPayload>('timeline_repost', input),

  profileGet: () =>
    invokeRustDataFromStatus<void, AccountProfile>('profile_get'),

  // Fetch a peer actor's public profile by canonical PTID.
  // Used by Contacts/Chat detail panels to render rich peer profile cards.
  peerProfileGet: (actorPtid: string) =>
    invokeRustDataFromStatus<{ actor_ptid: string }, AccountProfile>('peer_profile_get', { actor_ptid: actorPtid }),

  profileUpdate: (input: ProfileUpdateInput) =>
    invokeRustDataFromStatus<ProfileUpdateInput, ProfileUpdateResult>('profile_update', {
      ...input,
      observed_revision: toPositiveRustUint64(
        input.observed_revision,
        'observed_revision',
      ),
    }),

  profileUploadAvatar: (input: FileUploadInput) =>
    invokeRustCommand<FileUploadInput, TauriStubPayload>('profile_upload_avatar', input),

  profileUploadHeader: (input: FileUploadInput) =>
    invokeRustCommand<FileUploadInput, TauriStubPayload>('profile_upload_header', input),

  profileUploadAvatarOss: (input: FileUploadInput) =>
    invokeRustDataFromStatus<FileUploadInput, ProfileUpdateResult>('profile_upload_avatar_oss', input),

  profileUploadHeaderOss: (input: FileUploadInput) =>
    invokeRustDataFromStatus<FileUploadInput, ProfileUpdateResult>('profile_upload_header_oss', input),

  pickImageFile: async (): Promise<string> => {
    const response = await invokeRustCommand<void, TauriStubPayload>('pick_image_file');
    if (response.ok && response.data?.status) {
      return response.data.status;
    }
    throw new Error(response.error?.message || 'pick_image_file failed');
  },

  // ── OSS attachments (主模块=oss / 消费方=chat|social) ──────────
  //
  // Naming convention `oss<Verb><Consumer>` mirrors the Rust-side
  // `oss_<verb>_<consumer>` Tauri command names so the call site reads
  // as one unit. Generic helpers (no consumer-specific behavior) drop
  // the suffix.

  /**
   * Chat consumer — open the native picker (any MIME) and return the
   * absolute path of the selected file. Rejects when the user cancels.
   */
  ossPickLocalFile: async (): Promise<string> => {
    const response = await invokeRustCommand<void, TauriStubPayload>(
      'oss_pick_local_file',
    );
    if (response.ok && response.data?.status) {
      return response.data.status;
    }
    throw new Error(
      response.error?.message || 'oss_pick_local_file failed',
    );
  },

  ossPickLocalFolder: async (): Promise<string> => {
    const response = await invokeRustCommand<void, TauriStubPayload>(
      'oss_pick_local_folder',
    );
    if (response.ok && response.data?.status) {
      return response.data.status;
    }
    throw new Error(
      response.error?.message || 'oss_pick_local_folder failed',
    );
  },

  /**
   * Chat consumer — push the local file to the bound Station's OSS
   * subserver and return the canonical attachment payload (`cid`,
   * `key`, `host`, …). Chat uploads carry the full chat-scope params
   * (`bucket`, `visibility`, `chat_session_id`) so the server can
   * apply per-conversation quotas / ACLs. See
   * `application/oss/mod.rs::ChatAttachmentUploaded` for the
   * authoritative shape.
   */
  ossUploadLocalFile: (input: OssUploadLocalFileInput) =>
    invokeRustDataFromStatus<OssUploadLocalFileInput, OssAttachmentUploaded>(
      'oss_upload_local_file',
      input,
    ),

  ossUploadAttachmentBytes: (input: OssUploadAttachmentBytesInput) =>
    invokeRustDataFromStatus<OssUploadAttachmentBytesInput, OssAttachmentUploaded>(
      'oss_upload_attachment_bytes',
      input,
    ),

  ossUploadAgentAttachmentBytes: (input: AgentUploadAttachmentBytesInput) =>
    invokeRustDataFromStatus<AgentUploadAttachmentBytesInput, AgentAttachmentRefInput>(
      'oss_upload_agent_attachment_bytes',
      input,
    ),

  ossDeleteAgentAttachment: (objectRef: string) =>
    invokeRustDataFromStatus<{ key: string }, OssDeleteResponse>(
      'oss_delete_file',
      { key: objectRef },
    ),

  /**
   * Social/Moments consumer — open a multi-select picker scoped to
   * image MIME types. The `maxCount` cap is enforced at the Tauri
   * layer (silent truncation) so the renderer never has to defend
   * against it. Resolves with the picked absolute paths in sorted
   * order; rejects when the user cancels.
   */
  ossPickImageSocial: async (maxCount: number): Promise<string[]> => {
    const response = await invokeRustCommand<
      { max_count: number },
      TauriStubPayload
    >('oss_pick_image_social', { max_count: maxCount });
    if (response.ok && response.data?.status) {
      try {
        const parsed = JSON.parse(response.data.status) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((p): p is string => typeof p === 'string');
        }
        return [];
      } catch {
        return [];
      }
    }
    throw new Error(
      response.error?.message || 'oss_pick_image_social failed',
    );
  },

  /**
   * Social/Moments consumer — upload a single image and return the
   * canonical attachment payload. Composer calls this once per picked
   * image (sequential to bound peak memory on the Rust side).
   */
  ossUploadAttachmentSocial: (filePath: string) =>
    invokeRustDataFromStatus<{ file_path: string }, OssAttachmentUploaded>(
      'oss_upload_attachment_social',
      { file_path: filePath },
    ),

  ossUploadEncryptedAttachmentSocial: (filePath: string) =>
    invokeRustDataFromStatus<{ file_path: string }, SocialEncryptedAttachmentUploaded>(
      'oss_upload_encrypted_attachment_social',
      { file_path: filePath },
    ),

  /**
   * Generic — resolve an `oss://` URI (or bare key) to a local cached
   * path and an absolute URL. Renderer should prefer `local_path`
   * when present and fall back to `url`. No consumer suffix: the
   * resolution logic is identical across modules.
   */
  ossResolveUrl: (uri: string) =>
    invokeRustDataFromStatus<{ uri: string }, OssResolved>('oss_resolve_url', { uri }),

  // ── OSS owner-side lifecycle (S16) ──
  //
  // Each mutation transparently invalidates the local oss_cache
  // copy on the Rust side, so callers do NOT need to call
  // `ossInvalidateCache` after a successful patch / delete /
  // restore. The standalone helper exists for the rare cases
  // where the renderer learns about an out-of-band change
  // (e.g. a dashboard force-delete announced via SSE).

  ossListMyFiles: (query?: OssListMyFilesQuery) =>
    invokeRustDataFromStatus<OssListMyFilesQuery, OssMyFilesResponse>(
      'oss_list_my_files',
      query ?? {},
    ),

  ossDeleteFile: (key: string) =>
    invokeRustDataFromStatus<{ key: string }, OssDeleteResponse>(
      'oss_delete_file',
      { key },
    ),

  ossRestoreFile: (key: string) =>
    invokeRustDataFromStatus<{ key: string }, OssRestoreResponse>(
      'oss_restore_file',
      { key },
    ),

  ossPatchFile: (key: string, body: OssPatchFileBody) =>
    invokeRustDataFromStatus<OssPatchFileBody & { key: string }, OssPatchResponse>(
      'oss_patch_file',
      { key, ...body },
    ),

  ossInvalidateCache: (uri: string) =>
    invokeRustDataFromStatus<{ uri: string }, { ok: boolean; uri: string }>(
      'oss_invalidate_cache',
      { uri },
    ),

  accountSyncAvatar: (avatarUrl: string) =>
    invokeRustCommand<{ avatar_url: string }, TauriStubPayload>('account_sync_avatar', { avatar_url: avatarUrl }),

  avatarResolveLocal: (remoteUrl: string) =>
    invokeRustDataFromStatus<{ url: string }, { local_path?: string | null }>(
      'avatar_resolve_local',
      { url: remoteUrl },
    ),

  syncUserProfile: () =>
    invokeRustDataFromStatus<void, {
      name: string;
      email: string;
      avatar_url: string;
      avatar_local_path?: string;
      profile_url: string;
      synced: boolean;
    }>('sync_user_profile'),

  profileUpdatePrivacy: (input: ProfilePrivacyInput) =>
    invokeRustCommand<ProfilePrivacyInput, TauriStubPayload>('profile_update_privacy', input),

  adminHealth: () =>
    invokeRustCommand<void, TauriStubPayload>('admin_health'),

  adminNetworkProbe: (input: AdminNetworkProbeInput) =>
    invokeRustCommand<AdminNetworkProbeInput, TauriStubPayload>('admin_network_probe', input),

  adminExecuteAction: (input: AdminExecuteActionInput) =>
    invokeRustCommand<AdminExecuteActionInput, TauriStubPayload>('admin_execute_action', input),

  getContractVersion: () =>
    invokeRustDataFromStatus<void, { version: string }>('meta_contract_version'),

  health: () => invokeRustDataFromStatus<void, { status: string }>('system_health'),

  contextSnapshotGet: (input?: ContextSnapshotGetInput) =>
    invokeRustDataFromStatus<ContextSnapshotGetInput | void, Record<string, unknown>>('context_snapshot_get', input),

  contextActionDispatch: (input: ContextActionDispatchInput) =>
    invokeRustDataFromStatus<ContextActionDispatchInput, { ok?: boolean; action?: string; snapshot?: Record<string, unknown> }>(
      'context_action_dispatch',
      input,
    ),

  contextCapabilities: () =>
    invokeRustDataFromStatus<void, ContextCapabilitiesOutput>('context_capabilities'),

  contextHealth: () =>
    invokeRustDataFromStatus<void, ContextHealthOutput>('context_health'),

  openExternalUrl: (url: string) =>
    invokeRustDataFromStatus<ExternalUrlInput, { ok: boolean }>('open_external_url', { url }),

  listSessions: () =>
    invokeRustDataFromStatus<void, { conversations?: any[] }>(
      'chat_list_conversations',
      undefined,
    ).then((r): Session[] =>
      (r.conversations || []).map(mapAIChatSessionToSession),
    ),

  deleteSession: (key: string) =>
    invokeRustDataFromStatus<ChatConversationInput, { ok: boolean }>(
      'chat_delete_conversation',
      { conversation_id: key },
    ),

  renameSession: (key: string, title: string) =>
    invokeRustDataFromStatus<ChatRenameConversationInput, { ok: boolean; title: string }>(
      'chat_rename_conversation',
      { conversation_id: key, title },
    ),

  duplicateSession: (key: string) =>
    invokeRustDataFromStatus<ChatConversationInput, { ok: boolean; conversationId: string }>(
      'chat_duplicate_conversation',
      { conversation_id: key },
    ),

  smartRenameSession: (key: string) =>
    invokeRustDataFromStatus<ChatConversationInput, { ok: boolean; title: string }>(
      'chat_smart_rename_conversation',
      { conversation_id: key },
    ),

  pinSession: (key: string, pinned: boolean) =>
    invokeRustDataFromStatus<{ conversation_id: string; pinned: boolean }, { ok: boolean }>(
      'chat_pin_conversation',
      { conversation_id: key, pinned },
    ),

  favoriteSession: (key: string, favorite: boolean) =>
    invokeRustDataFromStatus<{ conversation_id: string; favorite: boolean }, { ok: boolean }>(
      'chat_favorite_conversation',
      { conversation_id: key, favorite },
    ),

  setSessionModel: (key: string, model: string) =>
    invokeRustDataFromStatus<ChatSetConversationModelInput, { ok: boolean; model: string }>(
      'chat_set_conversation_model',
      { conversation_id: key, model },
    ),

  getMessages: (key: string) =>
    invokeRustDataFromStatus<ChatListMessagesInput, { messages?: any[] }>(
      'chat_list_messages',
      { conversation_id: key },
    ).then((r) =>
      (r.messages || []).map(mapAIChatMessageToMessage),
    ),

  deleteMessage: (id: string) =>
    invokeRustDataFromStatus<ChatMessageInput, { ok: boolean }>(
      'chat_delete_message',
      { message_id: id },
    ),

  stopChat: (sessionKey: string) =>
    invokeRustDataFromStatus<ChatConversationInput, { ok: boolean; stopped: boolean }>('chat_stop', {
      conversation_id: sessionKey,
    }),

  updateMessage: (id: string, content: string) =>
    invokeRustDataFromStatus<ChatUpdateMessageInput, { ok: boolean }>('chat_update_message', {
      message_id: id,
      content,
    }),

  listAgents: () =>
    invokeRustDataFromStatus<void, { agents: Agent[] }>('agents_list').then((r) => r.agents),

  listAgentsWithMeta: () =>
    invokeRustDataFromStatus<void, AgentListResult>('agents_list'),

  getSelectedAgent: () =>
    invokeRustDataFromStatus<void, { selectedAgent: string }>('agents_get_selected')
      .then((r) => r.selectedAgent),

  setSelectedAgent: (name: string) =>
    invokeRustDataFromStatus<AgentSelectInput, { selectedAgent: string }>(
      'agents_set_selected',
      { name },
    ),

  getDefaultAgent: () =>
    invokeRustDataFromStatus<void, { defaultAgent: string; agent: Agent }>('agents_get_default'),

  setDefaultAgent: (id: string) =>
    invokeRustDataFromStatus<AgentIdInput, { defaultAgent: string }>('agents_set_default', { id }),

  getAgent: (id: string) => invokeRustDataFromStatus<AgentIdInput, Agent>('agents_get', { id }),

  createAgent: (data: AgentCreate) =>
    invokeRustDataFromStatus<AgentCreateInput, Agent>('agents_create', { data }),

  updateAgent: (id: string, data: Partial<AgentCreate>) =>
    invokeRustDataFromStatus<AgentUpdateInput, Agent>('agents_update', { id, data }),

  deleteAgent: (id: string) =>
    invokeRustDataFromStatus<AgentIdInput, { ok: boolean }>('agents_delete', { id }),

  duplicateAgent: (id: string, name: string) =>
    invokeRustDataFromStatus<AgentDuplicateInput, Agent>('agents_duplicate', { id, name }),

  exportAgentPackage: async (
    id: string,
    _options?: { includeLocalPaths?: boolean },
  ): Promise<AgentPackageExportResult> => {
    const response = await invokeRustProtoRequest(
      'agent_package_export',
      ExportAgentPackageRequestSchema,
      ExportAgentPackageResponseSchema,
      create(ExportAgentPackageRequestSchema, { agentId: id }),
    );
    if (!response.package) {
      throw new Error('agent.packageExportResponseMissing');
    }
    return {
      package: toJson(AgentPackageDocumentSchema, response.package, {
        enumAsInteger: true,
      }) as unknown as AgentPackage,
      unresolvedDependencies: response.unresolvedDependencies,
    };
  },

  importAgentPackage: async (
    pkg: AgentPackage | Record<string, unknown>,
    name?: string,
  ): Promise<AgentPackageImportResult> => {
    const document = fromJsonString(
      AgentPackageDocumentSchema,
      JSON.stringify(pkg),
      { ignoreUnknownFields: false },
    );
    const response = await invokeRustProtoRequest(
      'agent_package_import',
      ImportAgentPackageRequestSchema,
      ImportAgentPackageResponseSchema,
      create(ImportAgentPackageRequestSchema, {
        package: document,
        name: name ?? '',
        idempotencyKey: globalThis.crypto.randomUUID(),
      }),
    );
    return {
      agent: response.agent
        ? await api.getAgent(response.agent.agentId)
        : undefined,
      unresolvedDependencies: response.unresolvedDependencies,
    };
  },

  searchAgents: (q: string) =>
    invokeRustDataFromStatus<AgentSearchInput, { agents: Agent[] }>('agents_search', { q }).then((r) => r.agents),

  listAgentSessions: (id: string) =>
    invokeRustDataFromStatus<AgentIdInput, { sessions: (Session & { agent_id?: string })[] }>(
      'agents_list_sessions',
      { id },
    ).then((r) =>
      r.sessions.map((s) => ({ ...s, agent_name: s.agent_name ?? s.agent_id ?? '' })),
    ),

  getHomeWorkProjection: async (
    afterRevision: number | bigint = 0n,
  ): Promise<HomeWorkProjection> => {
    const response = await invokeRustProtoRequest(
      'agent_home_projection_get',
      GetHomeWorkProjectionRequestSchema,
      GetHomeWorkProjectionResponseSchema,
      create(GetHomeWorkProjectionRequestSchema, {
        afterRevision: BigInt(afterRevision),
      }),
    );
    if (!response.projection) {
      throw new Error('agent.homeProjectionMissing');
    }
    return response.projection;
  },

  submitHomeChatCommand: async (input: {
    agentId: string;
    input: string;
    runtimeProfileId: string;
    clientIdempotencyKey: string;
    conversationId?: string;
    expectedAgentVersion: bigint;
    readinessSnapshotId: string;
  }): Promise<SubmitHomeChatCommandResponse> =>
    invokeRustProtoRequest(
      'agent_home_chat_submit',
      SubmitHomeChatCommandRequestSchema,
      SubmitHomeChatCommandResponseSchema,
      create(SubmitHomeChatCommandRequestSchema, input),
    ),

  submitHomeTaskCommand: async (input: {
    agentId: string;
    input: string;
    runtimeProfileId: string;
    clientIdempotencyKey: string;
    expectedAgentVersion: bigint;
    readinessSnapshotId: string;
    topicRef?: string;
  }): Promise<SubmitHomeTaskCommandResponse> =>
    invokeRustProtoRequest(
      'agent_home_task_submit',
      SubmitHomeTaskCommandRequestSchema,
      SubmitHomeTaskCommandResponseSchema,
      create(SubmitHomeTaskCommandRequestSchema, input),
    ),

  createEvaluationBenchmark: async (
    request: EvaluationModel.CreateEvaluationBenchmarkRequest,
  ): Promise<EvaluationModel.EvaluationBenchmark> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_benchmark_create',
      EvaluationModel.CreateEvaluationBenchmarkRequestSchema,
      EvaluationModel.CreateEvaluationBenchmarkResponseSchema,
      request,
    );
    return requireEvaluationValue(
      response.benchmark,
      'agent.evaluationBenchmarkResponseMissing',
    );
  },

  updateEvaluationBenchmark: async (
    request: EvaluationModel.UpdateEvaluationBenchmarkRequest,
  ): Promise<EvaluationModel.EvaluationBenchmark> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_benchmark_update',
      EvaluationModel.UpdateEvaluationBenchmarkRequestSchema,
      EvaluationModel.UpdateEvaluationBenchmarkResponseSchema,
      request,
    );
    return requireEvaluationValue(
      response.benchmark,
      'agent.evaluationBenchmarkResponseMissing',
    );
  },

  deleteEvaluationBenchmark: (
    request: EvaluationModel.DeleteEvaluationBenchmarkRequest,
  ): Promise<EvaluationModel.DeleteEvaluationBenchmarkResponse> =>
    invokeRustProtoRequest(
      'agent_evaluation_benchmark_delete',
      EvaluationModel.DeleteEvaluationBenchmarkRequestSchema,
      EvaluationModel.DeleteEvaluationBenchmarkResponseSchema,
      request,
    ),

  listEvaluationBenchmarks: async (): Promise<EvaluationModel.EvaluationBenchmark[]> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_benchmark_list',
      EvaluationModel.ListEvaluationBenchmarksRequestSchema,
      EvaluationModel.ListEvaluationBenchmarksResponseSchema,
      create(EvaluationModel.ListEvaluationBenchmarksRequestSchema),
    );
    return response.benchmarks;
  },

  createEvaluationDataset: async (
    request: EvaluationModel.CreateEvaluationDatasetRequest,
  ): Promise<{
    dataset: EvaluationModel.EvaluationDataset;
    benchmark: EvaluationModel.EvaluationBenchmark;
  }> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_dataset_create',
      EvaluationModel.CreateEvaluationDatasetRequestSchema,
      EvaluationModel.CreateEvaluationDatasetResponseSchema,
      request,
    );
    return {
      dataset: requireEvaluationValue(
        response.dataset,
        'agent.evaluationDatasetResponseMissing',
      ),
      benchmark: requireEvaluationValue(
        response.benchmark,
        'agent.evaluationBenchmarkResponseMissing',
      ),
    };
  },

  updateEvaluationDataset: async (
    request: EvaluationModel.UpdateEvaluationDatasetRequest,
  ): Promise<EvaluationModel.EvaluationDataset> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_dataset_update',
      EvaluationModel.UpdateEvaluationDatasetRequestSchema,
      EvaluationModel.UpdateEvaluationDatasetResponseSchema,
      request,
    );
    return requireEvaluationValue(
      response.dataset,
      'agent.evaluationDatasetResponseMissing',
    );
  },

  deleteEvaluationDataset: (
    request: EvaluationModel.DeleteEvaluationDatasetRequest,
  ): Promise<EvaluationModel.DeleteEvaluationDatasetResponse> =>
    invokeRustProtoRequest(
      'agent_evaluation_dataset_delete',
      EvaluationModel.DeleteEvaluationDatasetRequestSchema,
      EvaluationModel.DeleteEvaluationDatasetResponseSchema,
      request,
    ),

  listEvaluationDatasets: async (
    benchmarkId: string,
  ): Promise<EvaluationModel.EvaluationDataset[]> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_dataset_list',
      EvaluationModel.ListEvaluationDatasetsRequestSchema,
      EvaluationModel.ListEvaluationDatasetsResponseSchema,
      create(EvaluationModel.ListEvaluationDatasetsRequestSchema, {
        benchmarkId,
      }),
    );
    return response.datasets;
  },

  createEvaluationTestCase: async (
    request: EvaluationModel.CreateEvaluationTestCaseRequest,
  ): Promise<{
    testCase: EvaluationModel.EvaluationTestCase;
    dataset: EvaluationModel.EvaluationDataset;
  }> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_case_create',
      EvaluationModel.CreateEvaluationTestCaseRequestSchema,
      EvaluationModel.CreateEvaluationTestCaseResponseSchema,
      request,
    );
    return {
      testCase: requireEvaluationValue(
        response.testCase,
        'agent.evaluationCaseResponseMissing',
      ),
      dataset: requireEvaluationValue(
        response.dataset,
        'agent.evaluationDatasetResponseMissing',
      ),
    };
  },

  updateEvaluationTestCase: async (
    request: EvaluationModel.UpdateEvaluationTestCaseRequest,
  ): Promise<{
    testCase: EvaluationModel.EvaluationTestCase;
    dataset: EvaluationModel.EvaluationDataset;
  }> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_case_update',
      EvaluationModel.UpdateEvaluationTestCaseRequestSchema,
      EvaluationModel.UpdateEvaluationTestCaseResponseSchema,
      request,
    );
    return {
      testCase: requireEvaluationValue(
        response.testCase,
        'agent.evaluationCaseResponseMissing',
      ),
      dataset: requireEvaluationValue(
        response.dataset,
        'agent.evaluationDatasetResponseMissing',
      ),
    };
  },

  deleteEvaluationTestCase: async (
    request: EvaluationModel.DeleteEvaluationTestCaseRequest,
  ): Promise<{
    deleted: boolean;
    dataset: EvaluationModel.EvaluationDataset;
  }> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_case_delete',
      EvaluationModel.DeleteEvaluationTestCaseRequestSchema,
      EvaluationModel.DeleteEvaluationTestCaseResponseSchema,
      request,
    );
    return {
      deleted: response.deleted,
      dataset: requireEvaluationValue(
        response.dataset,
        'agent.evaluationDatasetResponseMissing',
      ),
    };
  },

  listEvaluationTestCases: async (
    datasetId: string,
  ): Promise<EvaluationModel.EvaluationTestCase[]> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_case_list',
      EvaluationModel.ListEvaluationTestCasesRequestSchema,
      EvaluationModel.ListEvaluationTestCasesResponseSchema,
      create(EvaluationModel.ListEvaluationTestCasesRequestSchema, {
        datasetId,
      }),
    );
    return response.testCases;
  },

  createEvaluationRun: async (
    request: EvaluationModel.CreateEvaluationRunRequest,
  ): Promise<EvaluationModel.EvaluationRun> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_run_create',
      EvaluationModel.CreateEvaluationRunRequestSchema,
      EvaluationModel.CreateEvaluationRunResponseSchema,
      request,
    );
    return requireEvaluationValue(
      response.run,
      'agent.evaluationRunResponseMissing',
    );
  },

  startEvaluationRun: async (
    request: EvaluationModel.StartEvaluationRunRequest,
  ): Promise<EvaluationModel.EvaluationRun> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_run_start',
      EvaluationModel.StartEvaluationRunRequestSchema,
      EvaluationModel.StartEvaluationRunResponseSchema,
      request,
    );
    return requireEvaluationValue(
      response.run,
      'agent.evaluationRunResponseMissing',
    );
  },

  cancelEvaluationRun: async (
    request: EvaluationModel.CancelEvaluationRunRequest,
  ): Promise<EvaluationModel.EvaluationRun> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_run_cancel',
      EvaluationModel.CancelEvaluationRunRequestSchema,
      EvaluationModel.CancelEvaluationRunResponseSchema,
      request,
    );
    return requireEvaluationValue(
      response.run,
      'agent.evaluationRunResponseMissing',
    );
  },

  retryEvaluationCases: async (
    request: EvaluationModel.RetryEvaluationCasesRequest,
  ): Promise<EvaluationModel.EvaluationRun> => {
    const response = await invokeRustProtoRequest(
      'agent_evaluation_run_retry',
      EvaluationModel.RetryEvaluationCasesRequestSchema,
      EvaluationModel.RetryEvaluationCasesResponseSchema,
      request,
    );
    return requireEvaluationValue(
      response.childRun,
      'agent.evaluationChildRunResponseMissing',
    );
  },

  getEvaluationRun: (
    runId: string,
  ): Promise<EvaluationModel.GetEvaluationRunResponse> =>
    invokeRustProtoRequest(
      'agent_evaluation_run_get',
      EvaluationModel.GetEvaluationRunRequestSchema,
      EvaluationModel.GetEvaluationRunResponseSchema,
      create(EvaluationModel.GetEvaluationRunRequestSchema, { runId }),
    ),

  listEvaluationRuns: (
    page = 1,
    pageSize = 100,
    parentRunId?: string,
  ): Promise<EvaluationModel.ListEvaluationRunsResponse> =>
    invokeRustProtoRequest(
      'agent_evaluation_run_list',
      EvaluationModel.ListEvaluationRunsRequestSchema,
      EvaluationModel.ListEvaluationRunsResponseSchema,
      create(EvaluationModel.ListEvaluationRunsRequestSchema, {
        page,
        pageSize,
        parentRunId,
      }),
    ),

  listEvaluationRunEvents: (
    runId: string,
    afterSequence: bigint,
  ): Promise<EvaluationModel.ListEvaluationRunEventsResponse> =>
    invokeRustProtoRequest(
      'agent_evaluation_run_events_list',
      EvaluationModel.ListEvaluationRunEventsRequestSchema,
      EvaluationModel.ListEvaluationRunEventsResponseSchema,
      create(EvaluationModel.ListEvaluationRunEventsRequestSchema, {
        runId,
        afterSequence,
      }),
    ),

  deleteEvaluationRun: (
    request: EvaluationModel.DeleteEvaluationRunRequest,
  ): Promise<EvaluationModel.DeleteEvaluationRunResponse> =>
    invokeRustProtoRequest(
      'agent_evaluation_run_delete',
      EvaluationModel.DeleteEvaluationRunRequestSchema,
      EvaluationModel.DeleteEvaluationRunResponseSchema,
      request,
    ),

  getAgentWorkspaceInfo: (agentId: string) =>
    invokeRustDataFromStatus<{ agent_id: string }, AgentWorkspaceInfo>(
      'agent_workspace_info',
      { agent_id: agentId },
    ),

  cleanAgentWorkspace: (agentId: string, scope: AgentWorkspaceCleanScope, retentionDays?: number) =>
    invokeRustDataFromStatus<
      { agent_id: string; scope: string; retention_days?: number },
      { freed_bytes: number }
    >('agent_workspace_clean', {
      agent_id: agentId,
      scope,
      retention_days: retentionDays,
    }),

  listAgentTurnTraces: (agentId: string, options?: { conversationId?: string; page?: number; pageSize?: number }) =>
    invokeRustDataFromStatus<AgentTurnTraceListInput, ListTurnTracesResponse>(
      'agent_turn_trace_list',
      {
        agent_id: agentId,
        conversation_id: options?.conversationId,
        page: options?.page,
        page_size: options?.pageSize,
      },
    ),

  getAgentTurnTrace: (input: { traceId?: string; turnId?: string }) =>
    invokeRustDataFromStatus<AgentTurnTraceGetInput, GetTurnTraceResponse>(
      'agent_turn_trace_get',
      {
        trace_id: input.traceId,
        turn_id: input.turnId,
      },
    ),

  exportAgentTurnDiagnostics: (turnId: string) =>
    invokeRustProto(
      'agent_turn_diagnostics_export',
      ExportTurnDiagnosticsResponseSchema,
      { turn_id: turnId },
    ),

  listAgentTurnFeedback: (turnId: string) =>
    invokeRustProto(
      'agent_list_turn_feedback',
      ListTurnFeedbackResponseSchema,
      { turn_id: turnId },
    ),

  createAgentCollaborationTask: (input: AgentCollaborationCreateInput) =>
    invokeRustDataFromStatus<AgentCollaborationCreateInput, { task?: CollaborationTask }>(
      'agent_collaboration_create',
      input,
    ),

  getAgentCollaborationTask: (taskId: string) =>
    invokeRustDataFromStatus<AgentCollaborationGetInput, GetCollaborationTaskResponse>(
      'agent_collaboration_get',
      { task_id: taskId },
    ),

  listAgentCollaborationTasks: (input?: AgentCollaborationListInput) =>
    invokeRustDataFromStatus<AgentCollaborationListInput, ListCollaborationTasksResponse>(
      'agent_collaboration_list',
      input || {},
    ),

  listAgentCollaborationEvents: (input: AgentCollaborationListEventsInput) =>
    invokeRustDataFromStatus<AgentCollaborationListEventsInput, ListTaskEventsResponse>(
      'agent_collaboration_list_events',
      input,
    ),

  startAgentCollaborationStream: (input: AgentCollaborationSubscribeInput) =>
    invokeRustDataFromStatus<AgentCollaborationSubscribeInput, { stream_id: string }>(
      'agent_collaboration_subscribe',
      input,
    ),

  cancelAgentCollaborationStream: (streamId: string) =>
    invokeRustDataFromStatus<{ stream_id: string }, { stream_id: string }>(
      'agent_collaboration_cancel_stream',
      { stream_id: streamId },
    ),

  startAgentEventStream: (agentId: string, streamId: string) =>
    invokeRustDataFromStatus<
      { agent_id: string; stream_id: string },
      { stream_id: string }
    >('agent_events_subscribe', { agent_id: agentId, stream_id: streamId }),

  cancelAgentEventStream: (streamId: string) =>
    invokeRustDataFromStatus<{ stream_id: string }, { stream_id: string }>(
      'agent_events_cancel',
      { stream_id: streamId },
    ),

  cancelAgentCollaborationTask: (taskId: string) =>
    invokeRustDataFromStatus<AgentCollaborationCancelTaskInput, { task?: CollaborationTask }>(
      'agent_collaboration_cancel_task',
      { task_id: taskId },
    ),

  resumeAgentCollaborationTask: (taskId: string) =>
    invokeRustDataFromStatus<AgentCollaborationResumeTaskInput, { task?: CollaborationTask }>(
      'agent_collaboration_resume_task',
      { task_id: taskId },
    ),

  submitAgentCollaborationNodeResult: (input: AgentCollaborationSubmitNodeResultInput) =>
    invokeRustDataFromStatus<AgentCollaborationSubmitNodeResultInput, { task?: CollaborationTask }>(
      'agent_collaboration_submit_node_result',
      input,
    ),

  claimAgentCollaborationExecutorTask: (input: AgentCollaborationClaimExecutorInput) =>
    invokeRustDataFromStatus<AgentCollaborationClaimExecutorInput, ClaimDesktopExecutorTaskResponse>(
      'agent_collaboration_claim_executor_task',
      input,
    ),

  heartbeatAgentCollaborationExecutorLease: (input: AgentCollaborationHeartbeatLeaseInput) =>
    invokeRustDataFromStatus<AgentCollaborationHeartbeatLeaseInput, { lease?: ExecutorLease }>(
      'agent_collaboration_heartbeat_executor_lease',
      input,
    ),

  releaseAgentCollaborationExecutorLease: (input: AgentCollaborationReleaseLeaseInput) =>
    invokeRustDataFromStatus<AgentCollaborationReleaseLeaseInput, { lease?: ExecutorLease }>(
      'agent_collaboration_release_executor_lease',
      input,
    ),

  listTools: () =>
    invokeRustDataFromStatus<void, { tools: ToolInfo[] }>('tools_list').then((r) => r.tools),

  listSearchProviders: () =>
    invokeRustDataFromStatus<void, { providers: SearchProviderInfo[]; primary: string }>('tools_search_providers'),

  setSearchPrimary: (provider: string) =>
    invokeRustDataFromStatus<SearchPrimaryInput, { ok: boolean; primary: string }>('tools_set_search_primary', {
      provider,
    }),

  listAvailableModels: async () => {
    const r = await invokeRustDataFromStatus<void, { models?: AvailableModelWire[] }>('provider_list_available_models');
    const models: AvailableModel[] = Array.isArray(r.models)
      ? r.models.map((model) => ({
        id: String(model.id || ''),
        display_name: String(model.display_name || model.id || ''),
        provider_id: String(model.provider_id || ''),
        provider_name: String(model.provider_name || model.provider_id || ''),
        type: String(model.type || ''),
        context_window: Number(model.context_window || 0),
        enabled: Boolean(model.enabled),
        streaming: modelCapabilityFlag(model, 'streaming'),
        function_call: modelCapabilityFlag(model, 'native-tools'),
        vision: modelCapabilityFlag(model, 'image-input'),
        reasoning: modelCapabilityFlag(model, 'reasoning'),
        image_output: modelCapabilityFlag(model, 'image-output'),
      }))
      : [];
    return { models, default: models[0]?.id || '' };
  },

  listProviders: () =>
    invokeRustDataFromStatus<void, { providers?: any[] }>('provider_list').then((r) =>
      (r.providers || []).map(mapAIChatProviderToListItem),
    ),

  getProvider: (id: string) =>
    invokeRustDataFromStatus<ProviderIdInput, { provider?: any }>('provider_get', { id }).then((r) =>
      mapAIChatProviderToDetail(r.provider || {}),
    ),

  updateProvider: (id: string, data: { api_key?: string; base_url: string; enabled: boolean; version?: number }) =>
    invokeRustDataFromStatus<ProviderUpdateInput, { provider: any }>('provider_update', {
        id,
        enabled: data.enabled,
        ...(data.api_key ? { key_vaults: JSON.stringify({ api_key: data.api_key }) } : {}),
        config_json: JSON.stringify({ base_url: data.base_url || '' }),
        version: data.version ?? 0,
    }),

  checkProvider: (id: string, data: { api_key?: string; base_url?: string; model?: string }) =>
    invokeRustDataFromStatus<ProviderCheckInput, { ok: boolean; message?: string; error?: string }>('provider_check', {
        id,
        key_vaults: data.api_key ? JSON.stringify({ api_key: data.api_key }) : undefined,
        config_json: data.base_url ? JSON.stringify({ base_url: data.base_url, model: data.model || '' }) : undefined,
    }),

  applyPreset: (id: string) =>
    invokeRustDataFromStatus<ProviderIdInput, { ok: boolean; provider_id: string }>('provider_apply_preset', { id }),

  createProvider: (data: { id: string; name: string; description?: string; logo?: string; base_url: string; api_key?: string }) =>
    invokeRustDataFromStatus<ProviderCreateInput, { provider: any }>('provider_create', {
        name: data.name,
        description: data.description || '',
        logo: data.logo || '',
        key_vaults: JSON.stringify({ api_key: data.api_key || '' }),
        config_json: JSON.stringify({ base_url: data.base_url || '' }),
    }),

  deleteProvider: (id: string) =>
    invokeRustDataFromStatus<ProviderIdInput, { success: boolean }>('provider_delete', { id }),

  addModel: (providerId: string, data: ProviderModelCreateData) =>
    invokeRustDataFromStatus<ProviderModelAddInput, { ok: boolean }>('model_add', {
      provider_id: providerId,
      data: withModelCapabilityConfig(data),
    }),

  updateModel: (providerId: string, modelId: string, data: ProviderModelConfigInput) =>
    invokeRustDataFromStatus<ProviderModelUpdateInput, { ok: boolean }>('model_update', {
      provider_id: providerId,
      model_id: modelId,
      data: withModelCapabilityConfig(data),
    }),

  deleteModel: (providerId: string, modelId: string) =>
    invokeRustDataFromStatus<ProviderModelDeleteInput, { ok: boolean }>('model_delete', {
      provider_id: providerId,
      model_id: modelId,
    }),

  fetchRemoteModels: (providerId: string, data?: { api_key?: string; base_url?: string }) =>
    invokeRustDataFromStatus<ProviderModelFetchInput, { ok: boolean; models: string[] }>('model_fetch_remote', {
      provider_id: providerId,
      data,
    }),

  toggleModel: (providerId: string, modelId: string, enabled: boolean) =>
    invokeRustDataFromStatus<ProviderModelToggleInput, { ok: boolean }>('model_toggle', {
      provider_id: providerId,
      model_id: modelId,
      enabled,
    }),

  toggleAllModels: (providerId: string, enabled: boolean) =>
    invokeRustDataFromStatus<ProviderModelToggleAllInput, { ok: boolean }>('model_toggle_all', {
      provider_id: providerId,
      enabled,
    }),

  getHelp: () =>
    invokeRustDataFromStatus<void, { categories: HelpCategoryGroup[] }>('help_get').then((r) => r.categories),

  searchSources: () =>
    invokeRustDataFromStatus<void, { sources: SearchSource[] }>('search_sources').then((r) => r.sources),

  search: (query: string, source = 'all', limit = 20) =>
    invokeRustDataFromStatus<SearchQueryInput, { query: string; source: string; groups?: SearchSourceGroup[]; results?: SearchResultItem[]; count?: number }>(
      'search_query',
      { query, source, limit },
    ),

  aiSearch: (query: string, web = false) =>
    invokeRustDataFromStatus<AiSearchInput, AISearchResponse>('search_ai', { query, web }),

  resetOnboarding: () =>
    invokeRustDataFromStatus<void, { ok: boolean }>('onboarding_reset'),

  getStatistics: () =>
    Promise.reject(new Error('legacy_statistics_removed')),

  getPreferences: () =>
    invokeRustDataFromStatus<void, UserPreferences>('preferences_get'),

  setPreferences: (prefs: Partial<UserPreferences>) =>
    invokeRustDataFromStatus<PreferencesSetInput, { ok: boolean }>('preferences_set', { prefs }),

  accountList: () =>
    invokeRustDataFromStatus<void, { accounts: AccountIdentity[]; active_account_id?: string }>('account_list'),

  accountListRestorable: () =>
    invokeRustDataFromStatus<void, { accounts: AccountIdentity[] }>('account_list_restorable').then((r) => r.accounts),

  accountGetActive: () =>
    invokeRustDataFromStatus<void, { account: AccountIdentity | null }>('account_get_active').then((r) => r.account),

  accountSwitch: (id: string) =>
    invokeRustDataFromStatus<AccountIdInput, { ok: boolean }>('account_switch', { id }),

  accountUpsertOAuth: (input: AccountUpsertOAuthInput) =>
    invokeRustDataFromStatus<AccountUpsertOAuthInput, { ok: boolean; active_account_id: string }>('account_upsert_oauth', input),

  accountSetPin: (accountId: string, pin: string) =>
    invokeRustDataFromStatus<AccountSetPinInput, { ok: boolean }>('account_set_pin', {
      account_id: accountId,
      pin,
    }),

  accountUnlock: (accountId: string, pin: string) =>
    invokeAuthCommand<AccountUnlockInput>('account_unlock', {
      account_id: accountId,
      pin,
    }),

  // Drop the encrypted session blob for an account. Used after the backend
  // tells us the stored token is dead (server restart, kicked, expired) so
  // the next launch routes the user to the right login form instead of
  // popping the PIN screen against a token that can never validate.
  accountClearSession: (accountId: string) =>
    invokeRustDataFromStatus<AccountIdInput, { ok: boolean }>('account_clear_session', { id: accountId }),

  // Remove PIN protection from account — reuses AccountSetPinInput (same shape: account_id + pin)
  accountRemovePin: (accountId: string, pin: string) =>
    invokeRustDataFromStatus<AccountSetPinInput, { ok: boolean }>('account_remove_pin', {
      account_id: accountId,
      pin,
    }),

  // Re-link an existing PIN to the freshly issued session token. Used after a
  // password / OAuth login on an account whose PIN protection survived but
  // whose encrypted_session was wiped — the user enters the same PIN they
  // already configured and the backend re-encrypts the new token under it.
  // Errors map to UNAUTHORIZED (wrong PIN) / FORBIDDEN (locked out).
  accountRelinkPin: (accountId: string, pin: string) =>
    invokeRustDataFromStatus<AccountUnlockInput, { ok: boolean; account_id: string }>('account_relink_pin', {
      account_id: accountId,
      pin,
    }),

  accountBeginPinRecovery: (accountId: string) =>
    invokeRustDataFromStatus<{ id: string }, { recovery_id: string; provider: string }>('account_begin_pin_recovery', {
      id: accountId,
    }),

  accountAuthorizePinRecovery: (recoveryId: string) =>
    invokeRustDataFromStatus<{ recovery_id: string }, { ok: boolean }>('account_authorize_pin_recovery', {
      recovery_id: recoveryId,
    }),

  accountResetPin: (recoveryId: string, newPin: string) =>
    invokeRustDataFromStatus<{ recovery_id: string; new_pin: string }, { ok: boolean; local_account_id: string }>('account_reset_pin', {
      recovery_id: recoveryId,
      new_pin: newPin,
    }),

  // Notebook / Documents
  listDocuments: (topicId: string) =>
    invokeRustDataFromStatus<TopicIdInput, { documents: NotebookDocument[] }>('notebook_list_documents', { topic_id: topicId }).then(r => r.documents),

  getDocument: (id: string) =>
    invokeRustDataFromStatus<NotebookIdInput, NotebookDocument>('notebook_get_document', { id }),

  createDocument: (topicId: string, title: string, content: string, type?: string) =>
    invokeRustDataFromStatus<NotebookCreateInput, NotebookDocument>('notebook_create_document', {
      topic_id: topicId,
      title,
      content,
      type: type || 'note',
    }),

  updateDocument: (id: string, title: string, content: string) =>
    invokeRustDataFromStatus<NotebookUpdateInput, { ok: boolean }>('notebook_update_document', { id, title, content }),

  deleteDocument: (id: string) =>
    invokeRustDataFromStatus<NotebookIdInput, { ok: boolean }>('notebook_delete_document', { id }),

  listAllDocuments: () =>
    invokeRustDataFromStatus<void, { documents: NotebookDocumentWithTopic[] }>('notebook_list_all_documents').then(r => r.documents),

  // Share
  createShare: (sessionKey: string) =>
    invokeRustDataFromStatus<ShareSessionInput, { share_id: string; session_key: string; title: string; visibility: string }>(
      'share_create',
      { session_key: sessionKey },
    ),

  deleteShare: (sessionKey: string) =>
    invokeRustDataFromStatus<ShareSessionInput, { ok: boolean }>('share_delete', { session_key: sessionKey }),

  getSharedSession: (shareId: string) =>
    invokeRustDataFromStatus<ShareIdInput, { share_id: string; title: string; messages: Message[] }>('share_get', { share_id: shareId }),

  listApplets: () =>
    invokeRustDataFromStatus<void, { applets: AppletInfo[] }>('applets_list').then((r) => r.applets),

  getApplet: (id: string) =>
    invokeRustDataFromStatus<AppletIdInput, AppletInfo>('applets_get', { id }),

  appletStoreListCatalog: () =>
    invokeRustDataFromStatus<Record<string, unknown>, AppletStoreCatalogResponse>(
      'applets_store_list_catalog',
      { targetPlatform: 'desktop', channel: 'stable', limit: 100, offset: 0 },
    ),

  appletStoreListInstalled: () =>
    invokeRustDataFromStatus<Record<string, unknown>, AppletStoreInstalledResponse>(
      'applets_store_list_installed',
      { includeDisabled: true },
    ),

  appletStoreInstall: (appletId: string, channel = 'stable') =>
    invokeRustDataFromStatus<Record<string, unknown>, AppletStoreInstallResponse>(
      'applets_store_install',
      { appletId, channel },
    ),

  appletStoreUninstall: (appletId: string) =>
    invokeRustDataFromStatus<Record<string, unknown>, AppletStoreInstallResponse>(
      'applets_store_uninstall',
      { appletId },
    ),

  appletStoreGetVersion: (appletId: string, channel = 'stable') =>
    invokeRustDataFromStatus<Record<string, unknown>, AppletStoreGetVersionResponse>(
      'applets_store_get_version',
      { appletId, channel },
    ),

  appletStoreMaterializeBundle: (input: {
    appletId: string;
    version?: string;
    bundleUrl: string;
    bundleSha256?: string;
    entry: string;
    assets?: Array<{ path: string; sha256: string }>;
  }) =>
    invokeRustDataFromStatus<Record<string, unknown>, AppletStoreMaterializeBundleResponse>(
      'applets_store_materialize_bundle',
      input,
    ),

  appletStoreUploadAudit: () =>
    invokeRustDataFromStatus<Record<string, unknown>, AppletStoreUploadAuditResponse>(
      'applets_store_upload_audit',
      {},
    ),

  activateApplet: (id: string) =>
    invokeRustDataFromStatus<AppletIdInput, { ok: boolean }>('applets_activate', { id }),

  deactivateApplet: (id: string) =>
    invokeRustDataFromStatus<AppletIdInput, { ok: boolean }>('applets_deactivate', { id }),

  getAppletConfig: (id: string) =>
    invokeRustDataFromStatus<AppletIdInput, { config: Record<string, unknown> }>('applets_get_config', { id }).then((r) => r.config),

  setAppletConfig: (id: string, config: Record<string, unknown>) =>
    invokeRustDataFromStatus<AppletConfigSetInput, { ok: boolean }>('applets_set_config', { id, config }),

  appletAction: <T = unknown>(id: string, action: string, params?: Record<string, unknown>) =>
    invokeRustDataFromStatus<AppletActionInput, T>('applets_action', { id, action, params }),

  appletCreateSession: (input: AppletCreateSessionInput) =>
    invokeRustDataFromStatus<AppletCreateSessionInput, { ok: boolean; appletId: string; sessionId: string }>(
      'applets_create_session',
      input,
    ),

  appletInvoke: <T = unknown>(input: AppletInvokeInput) =>
    invokeRustDataFromStatus<AppletInvokeInput, T>('applets_invoke', input),

  pickAppletImportDirectory: () =>
    invokeRustDataFromStatus<void, AppletImportDirectoryResult>('applets_pick_import_directory'),

  appletsProductWindowLaunchContext: () =>
    invokeRustDataFromStatus<void, AppletProductWindowLaunchContext>('applets_product_window_launch_context'),

  appletsReadinessProbeContext: () =>
    invokeRustDataFromStatus<void, AppletProductWindowLaunchContext>('applets_readiness_probe_context'),

  appletsProductWindowReportRendered: (input: AppletProductWindowRenderedInput) =>
    invokeRustDataFromStatus<AppletProductWindowRenderedInput, { recorded: boolean; path?: string; reason?: string }>(
      'applets_product_window_report_rendered',
      input,
    ),

  appletsProductWindowReportLifecycle: (input: AppletProductWindowLifecycleInput) =>
    invokeRustDataFromStatus<AppletProductWindowLifecycleInput, { recorded: boolean; path?: string; reason?: string }>(
      'applets_product_window_report_lifecycle',
      input,
    ),

  // ── Skills API ──

  listSkills: (source?: string) =>
    invokeRustDataFromStatus<SkillsListInput, { skills: SkillListItem[]; builtin: BuiltinSkillInfo[] }>(
      'skills_list',
      { source },
    ),

  // Backend BM25 full-text search on skills (name + description + content + keywords).
  // Frontend calls this for deep/content-level search; for instant UI filtering,
  // use client-side fuzzy match on the already-loaded list.
  searchSkills: (q: string, limit?: number) =>
    invokeRustDataFromStatus<SkillsSearchInput, { skills: SkillListItem[] }>('skills_search', { q, limit }),

  getSkill: (id: string) => invokeRustDataFromStatus<SkillIdInput, SkillRecord>('skills_get', { id }),
  getBuiltinSkill: (identifier: string) =>
    invokeRustDataFromStatus<BuiltinSkillIdInput, BuiltinSkillRecord>('skills_get_builtin', { identifier }),

  createSkill: (name: string, content: string) =>
    invokeRustDataFromStatus<SkillCreateInput, SkillImportResult>('skills_create', { name, content }),

  updateSkill: (id: string, data: Partial<SkillRecord>) =>
    invokeRustDataFromStatus<SkillUpdateInput, { ok: boolean }>('skills_update', {
      id,
      name: data.name,
      description: data.description,
      content: data.content,
      enabled: data.enabled,
    }),

  deleteSkill: (id: string) =>
    invokeRustDataFromStatus<SkillIdInput, { ok: boolean }>('skills_delete', { id }),

  toggleSkill: (id: string, enabled: boolean) =>
    invokeRustDataFromStatus<SkillToggleInput, { ok: boolean }>('skills_toggle', { id, enabled }),

  listSkillVersions: (id: string, limit = 20, offset = 0) =>
    invokeRustDataFromStatus<SkillVersionsInput, SkillVersionsOutput>('skills_versions', {
      id,
      limit,
      offset,
    }),

  rollbackSkill: (id: string, targetVersion: number) =>
    invokeRustDataFromStatus<SkillRollbackInput, { ok: boolean }>('skills_rollback', {
      id,
      target_version: targetVersion,
    }),

  importSkillFromAddress: (address: string, oauthProvider?: string) =>
    invokeRustDataFromStatus<SkillImportAddressInput, SkillImportBatchResult>('skills_import_url', {
      address,
      oauth_provider: oauthProvider,
    }),

  importSkillFromGitHub: (owner: string, repo: string, branch?: string, filePath?: string) =>
    invokeRustDataFromStatus<SkillImportGitHubInput, SkillImportResult>('skills_import_github', {
      owner,
      repo,
      branch,
      file_path: filePath,
    }),

  importSkillFromZIP: async (file: File): Promise<SkillImportResult> => {
    return invokeRustDataFromStatus<SkillImportZipInput, SkillImportResult>('skills_import_zip', {
      file_name: file.name,
      data_base64: await fileToBase64(file),
    });
  },

  validateSkillZIP: async (file: File): Promise<SkillZipValidation> => {
    return invokeRustDataFromStatus<SkillImportZipInput, SkillZipValidation>('skills_validate_zip', {
      file_name: file.name,
      data_base64: await fileToBase64(file),
    });
  },

  // ── Skill Market API ──

  getSkillsDir: () =>
    invokeRustDataFromStatus<void, { path: string }>('skills_market_dir'),

  openSkillsDir: () =>
    invokeRustDataFromStatus<void, { ok: boolean; path: string }>('skills_market_open_dir'),

  listSkillMarkets: () =>
    invokeRustDataFromStatus<void, { markets: MarketSummary[] }>('skills_market_list').then(r => r.markets),

  addSkillMarketSource: (
    url: string,
    name?: string,
    branch?: string,
    governance?: {
      sourceId?: string;
      manifestPath?: string;
      publisherId?: string;
      signingKeyId?: string;
      publicKeyBase64?: string;
    },
  ) =>
    invokeRustDataFromStatus<SkillMarketAddInput, { ok: boolean; id: string }>('skills_market_add', {
      url,
      name,
      branch,
      source_id: governance?.sourceId,
      manifest_path: governance?.manifestPath,
      publisher_id: governance?.publisherId,
      signing_key_id: governance?.signingKeyId,
      public_key_base64: governance?.publicKeyBase64,
    }),

  removeSkillMarketSource: (id: string) =>
    invokeRustDataFromStatus<SkillMarketIdInput, { ok: boolean }>('skills_market_remove', { id }),

  syncSkillMarket: (marketId: string) =>
    invokeRustDataFromStatus<
      SkillMarketSyncInput,
      MarketSkillPage & {
        signatureStatus: string;
        syncState: MarketSource['syncState'];
        transportKind: MarketSource['transportKind'];
        transportEndpoint: string;
        distributionId: string;
        envelopeSha256: string;
        stale: boolean;
        error?: string;
      }
    >(
      'skills_market_sync',
      { market_id: marketId },
    ),

  listMarketSkills: (marketId: string, q?: string, cursor?: string, limit?: number) => {
    return invokeRustDataFromStatus<SkillMarketListInput, MarketSkillPage>(
      'skills_market_list_skills',
      { market_id: marketId, q, cursor, limit },
    );
  },

  getMarketSkillDetail: (marketId: string, filePath: string) =>
    invokeRustDataFromStatus<SkillMarketDetailInput, MarketSkillDetail>('skills_market_detail', {
      market_id: marketId,
      file_path: filePath,
    }),

  installMarketSkill: (marketId: string, filePath: string, riskAcknowledged = false) =>
    invokeRustDataFromStatus<SkillMarketDetailInput, SkillImportResult>('skills_market_install', {
      market_id: marketId,
      file_path: filePath,
      risk_acknowledged: riskAcknowledged,
    }),

  uninstallMarketSkill: (marketId: string, filePath: string) =>
    invokeRustDataFromStatus<SkillMarketDetailInput, { ok: boolean; skillId: string }>(
      'skills_market_uninstall',
      {
        market_id: marketId,
        file_path: filePath,
      },
    ),

  // ── MCP Servers API ──

  listMCPServers: () =>
    invokeRustDataFromStatus<void, { servers: MCPServerItem[] }>('mcp_list_servers').then((r) => r.servers),

  getMCPServer: (name: string) =>
    invokeRustDataFromStatus<McpNameInput, MCPServerRecord>('mcp_get_server', { name }),

  createMCPServer: (data: Partial<MCPServerRecord>) =>
    invokeRustDataFromStatus<McpCreateInput, MCPServerRecord>(
      'mcp_create_server',
      { data },
    ),

  updateMCPServer: (name: string, data: Partial<MCPServerRecord>) =>
    invokeRustDataFromStatus<McpUpdateInput, MCPServerRecord>(
      'mcp_update_server',
      { name, data },
    ),

  deleteMCPServer: (name: string) =>
    invokeRustDataFromStatus<McpNameInput, { ok: boolean; server?: MCPServerRecord }>(
      'mcp_delete_server',
      { name },
    ),

  toggleMCPServer: (name: string, enabled: boolean) =>
    invokeRustDataFromStatus<McpToggleInput, MCPServerRecord>(
      'mcp_toggle_server',
      { name, enabled },
    ),

  refreshMCPServer: (name: string) =>
    invokeRustDataFromStatus<McpNameInput, MCPServerRecord>(
      'mcp_refresh_server',
      { name },
    ),

  getCapabilityOperation: (operationId: string) =>
    invokeRustProtoRequest(
      'agent_capability_operation_get',
      GetCapabilityOperationRequestSchema,
      GetCapabilityOperationResponseSchema,
      create(GetCapabilityOperationRequestSchema, { operationId }),
    ).then((response) => {
      if (!response.operation) {
        throw new Error('agent.capabilityOperationResponseMissing');
      }
      return response.operation;
    }),

  cancelCapabilityOperation: (
    operationId: string,
    expectedRevision: number | bigint,
    idempotencyKey: string,
  ) =>
    invokeRustProtoRequest(
      'agent_capability_operation_cancel',
      CancelCapabilityOperationRequestSchema,
      CancelCapabilityOperationResponseSchema,
      create(CancelCapabilityOperationRequestSchema, {
        operationId,
        expectedRevision: BigInt(expectedRevision),
        idempotencyKey,
      }),
    ).then((response) => {
      if (!response.operation) {
        throw new Error('agent.capabilityOperationResponseMissing');
      }
      return response.operation;
    }),

  reconcileCapabilityOperation: (operationId: string, afterSequence = 0n) =>
    invokeRustProtoRequest(
      'agent_capability_operation_reconcile',
      ReconcileCapabilityOperationRequestSchema,
      ReconcileCapabilityOperationResponseSchema,
      create(ReconcileCapabilityOperationRequestSchema, {
        operationId,
        afterSequence,
      }),
    ),

  takeOverCapabilityOperation: (request: TakeOverCapabilityOperationRequest) =>
    invokeRustProtoRequest(
      'agent_capability_operation_takeover',
      TakeOverCapabilityOperationRequestSchema,
      TakeOverCapabilityOperationResponseSchema,
      request,
    ).then((response) => {
      if (!response.operation) {
        throw new Error('agent.capabilityOperationResponseMissing');
      }
      return response.operation;
    }),

  takeOverCapabilityOperationCleanup: (request: TakeOverCapabilityCleanupRequest) =>
    invokeRustProtoRequest(
      'agent_capability_operation_cleanup_takeover',
      TakeOverCapabilityCleanupRequestSchema,
      TakeOverCapabilityCleanupResponseSchema,
      request,
    ).then((response) => {
      if (!response.operation) {
        throw new Error('agent.capabilityOperationResponseMissing');
      }
      return response.operation;
    }),

  executeGuardedCanvasTurnOnce: (input: AgentExecuteTurnInput) =>
    invokeRustDataFromStatus<AgentExecuteTurnInput, Record<string, unknown>>(
      'agent_execute_turn',
      input,
    ),

  startAgentTurnStream: (input: AgentExecuteTurnInput) =>
    invokeRustDataFromStatus<AgentExecuteTurnInput, { stream_id: string }>(
      'agent_execute_turn_stream',
      input,
    ),

  cancelAgentTurnStream: (streamId: string) =>
    invokeRustDataFromStatus<AgentTurnTransportCancelInput, { stream_id: string }>(
      'agent_cancel_turn_stream',
      { stream_id: streamId },
    ),

  cancelAgentTurn: (turnId: string) =>
    invokeRustDataFromStatus<AgentTurnStreamCancelInput, { turn_id: string; status: string }>(
      'agent_cancel_turn',
      { turn_id: turnId },
    ),

  disconnectAgentTurnStream: (streamId: string) =>
    invokeRustDataFromStatus<AgentTurnTransportCancelInput, { stream_id: string }>(
      'agent_disconnect_turn_stream',
      { stream_id: streamId },
    ),

  startAgentTurnReplayStream: (input: AgentTurnReplayStreamInput) =>
    invokeRustDataFromStatus<AgentTurnReplayStreamInput, { stream_id: string }>(
      'agent_replay_turn_stream',
      input,
    ),

  cancelAgentTurnReplayStream: (streamId: string) =>
    invokeRustDataFromStatus<AgentTurnReplayStreamCancelInput, { stream_id: string }>(
      'agent_cancel_turn_replay_stream',
      { stream_id: streamId },
    ),

  listAgentTurnQueue: (conversationId: string) =>
    invokeRustDataFromStatus<{ conversation_id: string }, AgentTurnQueueListOutput>(
      'agent_turn_queue_list',
      { conversation_id: conversationId },
    ),

  cancelQueuedAgentTurn: (input: AgentTurnQueueCancelInput) =>
    invokeRustDataFromStatus<AgentTurnQueueCancelInput, {
      entry: AgentTurnQueueEntry;
      conversation_version: number;
      replayed: boolean;
    }>('agent_turn_queue_cancel', input),

  submitAgentToolDecision: (input: AgentToolDecisionIntentInput) =>
    invokeRustDataFromStatus<AgentToolDecisionIntentInput, AgentToolDecisionIntentResponse>(
      'agent_submit_tool_decision',
      input,
    ),

  getAgentEffectiveRuntimeProfile: (input: AgentRuntimeProfileInput) =>
    invokeRustDataFromStatus<AgentRuntimeProfileInput, AgentEffectiveRuntimeProfile>(
      'agent_runtime_profile_effective',
      input,
    ),

  listCapabilityManifests: (sourceKinds: readonly CapabilitySourceKind[] = []) =>
    invokeRustProto(
      'agent_capability_manifest_list',
      ListCapabilityManifestsResponseSchema,
      { sourceKinds: [...sourceKinds] },
    ).then((response) => response.manifests),

  listCapabilityManifestInventory: (
    sourceKinds: readonly CapabilitySourceKind[] = [],
  ): Promise<{
    manifests: CapabilityManifest[];
    issues: CapabilityCatalogIssue[];
  }> =>
    invokeRustProto(
      'agent_capability_manifest_list',
      ListCapabilityManifestsResponseSchema,
      { sourceKinds: [...sourceKinds] },
    ),

  prepareCapabilityAcceptanceScenario: (
    request: PrepareCapabilityAcceptanceScenarioRequest,
  ) => invokeRustProtoRequest(
    'agent_capability_acceptance_scenario_prepare',
    PrepareCapabilityAcceptanceScenarioRequestSchema,
    PrepareCapabilityAcceptanceScenarioResponseSchema,
    request,
  ),

  armCapabilityAcceptanceExecutorHook: (
    request: ArmCapabilityAcceptanceExecutorHookRequest,
  ) => invokeRustProtoRequest(
    'agent_capability_acceptance_scenario_arm',
    ArmCapabilityAcceptanceExecutorHookRequestSchema,
    ArmCapabilityAcceptanceExecutorHookResponseSchema,
    request,
  ),

  waitCapabilityAcceptanceBarrier: (
    request: WaitCapabilityAcceptanceBarrierRequest,
  ) => invokeRustProtoRequest(
    'agent_capability_acceptance_scenario_wait',
    WaitCapabilityAcceptanceBarrierRequestSchema,
    WaitCapabilityAcceptanceBarrierResponseSchema,
    request,
  ),

  releaseCapabilityAcceptanceBarrier: (
    request: ReleaseCapabilityAcceptanceBarrierRequest,
  ) => invokeRustProtoRequest(
    'agent_capability_acceptance_scenario_release',
    ReleaseCapabilityAcceptanceBarrierRequestSchema,
    ReleaseCapabilityAcceptanceBarrierResponseSchema,
    request,
  ),

  advanceCapabilityAcceptanceScenarioClock: (
    request: AdvanceCapabilityAcceptanceScenarioClockRequest,
  ) => invokeRustProtoRequest(
    'agent_capability_acceptance_scenario_clock_advance',
    AdvanceCapabilityAcceptanceScenarioClockRequestSchema,
    AdvanceCapabilityAcceptanceScenarioClockResponseSchema,
    request,
  ),

  interruptCapabilityAcceptanceWorker: (
    request: InterruptCapabilityAcceptanceWorkerRequest,
  ) => invokeRustProtoRequest(
    'agent_capability_acceptance_scenario_interrupt',
    InterruptCapabilityAcceptanceWorkerRequestSchema,
    InterruptCapabilityAcceptanceWorkerResponseSchema,
    request,
  ),

  cleanupCapabilityAcceptanceScenario: (
    request: CleanupCapabilityAcceptanceScenarioRequest,
  ) => invokeRustProtoRequest(
    'agent_capability_acceptance_scenario_cleanup',
    CleanupCapabilityAcceptanceScenarioRequestSchema,
    CleanupCapabilityAcceptanceScenarioResponseSchema,
    request,
  ),

  syncOAuthConnectorManifests: () =>
    invokeRustProto(
      'oauth2_sync_connector_manifests',
      SyncConnectorResourceManifestsResponseSchema,
    ),

  listConnectorResourceManifests: (
    request: ListConnectorResourceManifestsRequest,
  ): Promise<ConnectorResourceManifest[]> => invokeRustProtoRequest(
    'agent_connector_manifest_list',
    ListConnectorResourceManifestsRequestSchema,
    ListConnectorResourceManifestsResponseSchema,
    request,
  ).then((response) => response.manifests),

  listAgentCapabilityBindings: (agentId: string) =>
    invokeRustProto(
      'agent_capability_binding_list',
      ListAgentCapabilityBindingsResponseSchema,
      { agentId },
    ).then((response) => response.bindings),

  upsertAgentCapabilityBinding: (
    input: AgentCapabilityBindingInput,
    expectedBindingRevision: number | bigint,
    idempotencyKey: string,
  ) => {
    const expectedAgentVersion = toRustUint64(
      input.expectedAgentVersion,
      'expectedAgentVersion',
    );
    const binding = create(AgentCapabilityBindingSchema, {
      ...input,
      bindingId: input.bindingId ?? '',
      expectedAgentVersion: BigInt(expectedAgentVersion),
    });
    return invokeRustProto(
      'agent_capability_binding_upsert',
      UpsertAgentCapabilityBindingResponseSchema,
      {
        binding: {
          bindingId: binding.bindingId,
          agentId: binding.agentId,
          capabilityId: binding.capabilityId,
          capabilityVersion: binding.capabilityVersion,
          enabled: binding.enabled,
          approvalPolicy: binding.approvalPolicy,
          expectedAgentVersion,
        },
        idempotencyKey,
        expectedBindingRevision: toRustUint64(
          expectedBindingRevision,
          'expectedBindingRevision',
        ),
      },
    ).then((response) => {
      if (!response.binding) {
        throw new Error('agent.capabilityBindingResponseMissing');
      }
      return response.binding;
    });
  },

  deleteAgentCapabilityBinding: (
    bindingId: string,
    expectedBindingRevision: number | bigint,
    idempotencyKey: string,
    reason: string,
  ) =>
    invokeRustProto(
      'agent_capability_binding_delete',
      DeleteAgentCapabilityBindingResponseSchema,
      {
        bindingId,
        expectedBindingRevision: toRustUint64(
          expectedBindingRevision,
          'expectedBindingRevision',
        ),
        idempotencyKey,
        reason,
      },
    ).then((response) => {
      if (!response.binding) {
        throw new Error('agent.capabilityBindingResponseMissing');
      }
      return response.binding;
    }),

  createKnowledgeResourceDescriptor: (
    request: CreateKnowledgeResourceDescriptorRequest,
  ) => invokeRustProtoRequest(
    'agent_knowledge_descriptor_create',
    CreateKnowledgeResourceDescriptorRequestSchema,
    CreateKnowledgeResourceDescriptorResponseSchema,
    request,
  ),

  updateKnowledgeResourceDescriptor: (
    request: UpdateKnowledgeResourceDescriptorRequest,
  ) => invokeRustProtoRequest(
    'agent_knowledge_descriptor_update',
    UpdateKnowledgeResourceDescriptorRequestSchema,
    UpdateKnowledgeResourceDescriptorResponseSchema,
    request,
  ),

  listKnowledgeResourceDescriptors: (
    request: ListKnowledgeResourceDescriptorsRequest,
  ) => invokeRustProtoRequest(
    'agent_knowledge_descriptor_list',
    ListKnowledgeResourceDescriptorsRequestSchema,
    ListKnowledgeResourceDescriptorsResponseSchema,
    request,
  ),

  tombstoneKnowledgeResourceDescriptor: (
    request: TombstoneKnowledgeResourceDescriptorRequest,
  ) => invokeRustProtoRequest(
    'agent_knowledge_descriptor_tombstone',
    TombstoneKnowledgeResourceDescriptorRequestSchema,
    TombstoneKnowledgeResourceDescriptorResponseSchema,
    request,
  ),

  readAgentCapabilityReadiness: (input: AgentCapabilityReadinessInput) =>
    invokeRustProto(
      'agent_capability_readiness',
      GetCapabilityReadinessResponseSchema,
      input,
    ).then((response) => {
      if (!response.snapshot) {
        throw new Error('agent.capabilityReadinessSnapshotMissing');
      }
      return response.snapshot;
    }),

  getAgentCapabilityReadiness: async (
    input: AgentCapabilityReadinessInput,
  ): Promise<AgentCapabilityReadinessSnapshot> => {
    const response = await invokeRustProto(
      'agent_capability_readiness',
      GetCapabilityReadinessResponseSchema,
      input,
    );
    const json = toJson(GetCapabilityReadinessResponseSchema, response, {
      useProtoFieldName: true,
    });
    if (json === null || Array.isArray(json) || typeof json !== 'object') {
      throw new Error('agent.capabilityReadinessResponseInvalid');
    }
    const snapshot = json.snapshot;
    if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== 'object') {
      throw new Error('agent.capabilityReadinessSnapshotMissing');
    }
    return {
      ...snapshot,
      capabilities: Array.isArray(snapshot.capabilities)
        ? snapshot.capabilities
        : [],
    } as unknown as AgentCapabilityReadinessSnapshot;
  },

  getAgentStationRuntimeActivity: (input: AgentRuntimeActivityInput) =>
    invokeRustDataFromStatus<AgentRuntimeActivityInput, AgentRuntimeActivitySnapshot>(
      'agent_runtime_activity_station',
      input,
    ),

  getAgentLocalRuntimeActivity: (input: AgentRuntimeActivityInput) =>
    invokeRustDataFromStatus<AgentRuntimeActivityInput, AgentRuntimeActivitySnapshot>(
      'agent_runtime_activity_local',
      input,
    ),

  getAgentCapabilitySessionSnapshot: () =>
    invokeRustDataFromStatus<Record<string, never>, AgentCapabilitySessionSnapshot>(
      'agent_capability_session_snapshot',
      {},
    ),

  runAgentCapabilityNegativeControl: (
    control: AgentCapabilityNegativeControl,
    capabilitySessionIdHash: string,
    crossDeviceSessionId?: string,
    capabilityId?: string,
    permissionKind?: AgentCapabilityPermissionKind,
  ) =>
    invokeRustDataFromStatus<
      {
        negativeControl: {
          control: AgentCapabilityNegativeControl;
          capabilitySessionIdHash: string;
          crossDeviceSessionId?: string;
          capabilityId?: string;
          permissionKind?: AgentCapabilityPermissionKind;
        };
      },
      AgentCapabilityNegativeControlFact
    >('agent_capability_session_snapshot', {
      negativeControl: {
        control,
        capabilitySessionIdHash,
        crossDeviceSessionId,
        capabilityId,
        permissionKind,
      },
    }),

  listAgentCapabilitySessions: () =>
    invokeRustDataFromStatus<Record<string, never>, AgentCapabilitySessionList>(
      'agent_capability_sessions',
      {},
    ),

  startAgentClientExecutorSupervisor: () =>
    invokeRustDataFromStatus<Record<string, never>, { available: boolean; state: string }>(
      'agent_client_executor_supervisor_start',
      {},
    ),

  stopAgentClientExecutorSupervisor: () =>
    invokeRustDataFromStatus<Record<string, never>, { available: boolean; state: string }>(
      'agent_client_executor_supervisor_stop',
      {},
    ),

  listAgentConversations: (agentId: string, options?: { status?: string; page?: number; pageSize?: number }) =>
    invokeRustDataFromStatus<AgentConversationListInput, { ok: boolean; conversations: AgentConversation[]; total: number }>(
      'agent_conversation_list',
      {
        agent_id: agentId,
        status: options?.status,
        page: options?.page,
        page_size: options?.pageSize,
      },
    ).then((r) => r.conversations),

  getAgentConversation: (conversationId: string) =>
    invokeRustDataFromStatus<AgentConversationGetInput, { ok: boolean; conversation: AgentConversation }>(
      'agent_conversation_get',
      { conversation_id: conversationId },
    ).then((r) => r.conversation),

  createAgentConversation: (input: AgentConversationCreateInput) =>
    invokeRustDataFromStatus<AgentConversationCreateInput, { ok: boolean; conversation: AgentConversation }>(
      'agent_conversation_create',
      input,
    ).then((r) => r.conversation),

  listAgentConversationMessages: (input: AgentConversationMessagesInput) =>
    invokeRustDataFromStatus<
      AgentConversationMessagesInput,
      { ok: boolean; messages: AgentMessage[]; next_cursor: number; has_more: boolean }
    >('agent_conversation_messages', input),

  updateAgentConversation: (input: AgentConversationUpdateInput) =>
    invokeRustDataFromStatus<AgentConversationUpdateInput, { ok: boolean; conversation: AgentConversation }>(
      'agent_conversation_update',
      input,
    ).then((r) => r.conversation),

  archiveAgentConversation: (conversationId: string, expectedVersion: number, permanent?: boolean) =>
    invokeRustDataFromStatus<AgentConversationArchiveInput, { ok: boolean }>(
      'agent_conversation_archive',
      {
        conversation_id: conversationId,
        expected_version: expectedVersion,
        permanent,
      },
    ),

  restoreAgentConversation: (conversationId: string, expectedVersion: number) =>
    invokeRustDataFromStatus<
      AgentConversationRestoreInput,
      { ok: boolean; conversation: AgentConversation }
    >(
      'agent_conversation_restore',
      {
        conversation_id: conversationId,
        expected_version: expectedVersion,
      },
    ).then((result) => result.conversation),

  resetAgentConversationRuntime: (input: AgentConversationRuntimeResetInput) =>
    invokeRustProto<
      AgentConversationRuntimeResetInput,
      ResetConversationRuntimeResponse
    >(
      'agent_conversation_runtime_reset',
      ResetConversationRuntimeResponseSchema,
      input,
    ).then(agentRuntimeResetResultFromProto),

  retryAgentTurn: (input: AgentRetryTurnInput) =>
    invokeRustDataFromStatus<AgentRetryTurnInput, Record<string, unknown>>('agent_retry_turn', input),

  regenerateAgentTurn: (input: AgentRegenerateTurnInput) =>
    invokeRustDataFromStatus<AgentRegenerateTurnInput, Record<string, unknown>>('agent_regenerate_turn', input),

  editAndResendAgentMessage: (input: AgentEditAndResendInput) =>
    invokeRustDataFromStatus<AgentEditAndResendInput, Record<string, unknown>>('agent_edit_and_resend', input),

  selectAgentActiveBranch: (input: AgentSelectActiveBranchInput) =>
    invokeRustDataFromStatus<AgentSelectActiveBranchInput, Record<string, unknown>>('agent_select_active_branch', input),

  tombstoneAgentMessage: (input: AgentTombstoneMessageInput) =>
    invokeRustDataFromStatus<AgentTombstoneMessageInput, Record<string, unknown>>('agent_tombstone_message', input),

  createAgentThread: (input: AgentThreadCreateInput) =>
    invokeRustDataFromStatus<AgentThreadCreateInput, { ok: boolean; thread: AgentThread }>(
      'agent_thread_create',
      input,
    ).then((r) => r.thread),

  listAgentThreads: (conversationId: string) =>
    invokeRustDataFromStatus<AgentThreadListInput, { ok: boolean; threads: AgentThread[] }>(
      'agent_thread_list',
      { conversation_id: conversationId },
    ).then((r) => r.threads),

  listAgentThreadMessages: (input: AgentThreadMessagesInput) =>
    invokeRustDataFromStatus<AgentThreadMessagesInput, { ok: boolean; messages: AgentMessage[] }>(
      'agent_thread_messages',
      input,
    ).then((r) => r.messages),

  createAgentGroupRemote: (input: AgentGroupCreateInput) =>
    invokeRustDataFromStatus<AgentGroupCreateInput, { ok: boolean; group: StationAgentGroupRow }>(
      'agent_group_create',
      input,
    ).then((r) => r.group),

  updateAgentGroupRemote: (input: AgentGroupUpdateInput) =>
    invokeRustDataFromStatus<AgentGroupUpdateInput, { ok: boolean }>('agent_group_update', input),

  deleteAgentGroupRemote: (id: string) =>
    invokeRustDataFromStatus<AgentGroupDeleteInput, { ok: boolean }>('agent_group_delete', { id }),

  listAgentGroupsRemote: () =>
    invokeRustDataFromStatus<void, { ok: boolean; groups: StationAgentGroupRow[] | null }>(
      'agent_group_list',
    ).then((r) => r.groups ?? []),

  createTopicCommentRemote: (input: TopicCommentCreateInput) =>
    invokeRustDataFromStatus<TopicCommentCreateInput, { ok: boolean; comment: StationTopicCommentRow }>(
      'topic_comment_create',
      input,
    ).then((r) => r.comment),

  deleteTopicCommentRemote: (input: TopicCommentDeleteInput) =>
    invokeRustDataFromStatus<TopicCommentDeleteInput, { ok: boolean }>('topic_comment_delete', input),

  listTopicCommentsRemote: (topicKey: string) =>
    invokeRustDataFromStatus<TopicCommentListInput, { ok: boolean; comments: StationTopicCommentRow[] | null }>(
      'topic_comment_list',
      { topic_key: topicKey },
    ).then((r) => r.comments ?? []),

  createAgentTaskRemote: (input: AgentTaskCreateInput) =>
    invokeRustDataFromStatus<AgentTaskCreateInput, { ok: boolean; task: StationAgentTaskRow }>(
      'agent_task_create',
      input,
    ).then((r) => r.task),

  listAgentTasksRemote: (agentId?: string) =>
    invokeRustDataFromStatus<AgentTaskListInput, { ok: boolean; tasks: StationAgentTaskRow[] | null }>(
      'agent_task_list',
      { agent_id: agentId },
    ).then((r) => r.tasks ?? []),

  updateAgentTaskStatusRemote: (input: AgentTaskStatusInput) =>
    invokeRustDataFromStatus<AgentTaskStatusInput, { ok: boolean; task: StationAgentTaskRow }>(
      'agent_task_status',
      input,
    ).then((r) => r.task),

  deleteAgentTaskRemote: (id: string) =>
    invokeRustDataFromStatus<AgentTaskDeleteInput, { ok: boolean }>('agent_task_delete', { id }),

  addAgentSubtaskRemote: (input: AgentTaskSubtaskAddInput) =>
    invokeRustDataFromStatus<AgentTaskSubtaskAddInput, { ok: boolean; task: StationAgentTaskRow }>(
      'agent_task_subtask_add',
      input,
    ).then((r) => r.task),

  completeAgentSubtaskRemote: (input: AgentTaskSubtaskCompleteInput) =>
    invokeRustDataFromStatus<AgentTaskSubtaskCompleteInput, { ok: boolean; task: StationAgentTaskRow }>(
      'agent_task_subtask_complete',
      input,
    ).then((r) => r.task),

  updateMessageTranslate: (messageId: string, translation: string) =>
    invokeRustDataFromStatus<AgentMessageTranslateInput, { ok: boolean }>('agent_message_translate', {
      message_id: messageId,
      translation,
    }),

  // ── Cron Jobs API ──

  cronStatus: () =>
    invokeRustDataFromStatus<void, CronStatus>('cron_status'),

  listCronJobs: () =>
    invokeRustDataFromStatus<void, { jobs: CronJob[] }>('cron_list_jobs').then((r) => r.jobs),

  createCronJob: (data: CronJobCreate) =>
    invokeRustDataFromStatus<CronCreateInput, { job: CronJob }>('cron_create_job', { data }).then((r) => r.job),

  updateCronJob: (id: string, data: Partial<CronJobCreate>) =>
    invokeRustDataFromStatus<CronUpdateInput, { job: CronJob }>('cron_update_job', { id, data }).then((r) => r.job),

  deleteCronJob: (id: string) =>
    invokeRustDataFromStatus<CronIdInput, { ok: boolean }>('cron_delete_job', { id }),

  toggleCronJob: (id: string, enabled: boolean) =>
    invokeRustDataFromStatus<CronToggleInput, { ok: boolean }>('cron_toggle_job', { id, enabled }),

  runCronJob: (id: string) =>
    invokeRustDataFromStatus<CronIdInput, { ok: boolean }>('cron_run_job', { id }),

  listCronRuns: (jobId: string) =>
    invokeRustDataFromStatus<CronRunsInput, { runs: CronRun[] }>('cron_list_runs', { job_id: jobId }).then((r) => r.runs),

  parseCronSchedule: (text: string) =>
    invokeRustDataFromStatus<CronParseScheduleInput, CronScheduleParsed>('cron_parse_schedule', { text }),

  // ── Model Service ──

  // Model config registry (key-based)
  listModelConfig: () =>
    invokeRustDataFromStatus<void, { config: Record<string, ModelRef> }>('model_config_list').then((r) => r.config),

  getModelConfig: (key: string) =>
    invokeRustDataFromStatus<ModelConfigKeyInput, { key: string; ref: ModelRef | null; resolved: ModelRef | null }>(
      'model_config_get',
      { key },
    ),

  setModelConfig: (key: string, ref: ModelRef | null) =>
    invokeRustDataFromStatus<ModelConfigSetInput, { key: string; ref: ModelRef | null }>('model_config_set', { key, ref }),

  deleteModelConfig: (key: string) =>
    invokeRustDataFromStatus<ModelConfigKeyInput, { ok: boolean }>('model_config_delete', { key }),

  getProviderReferences: (providerId: string) =>
    invokeRustDataFromStatus<ProviderIdInputV2, { references: ModelServiceReference[] }>(
      'model_config_provider_references',
      { provider_id: providerId },
    ).then((r) => r.references),

  // ── Channels (Bot/Webhook) ──

  listChannels: () =>
    invokeRustDataFromStatus<void, { channels: Channel[] }>('channels_list').then((r) => r.channels),

  getChannel: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, Channel>('channels_get', { id }),

  createChannel: (data: { name: string; type: string; config: string; enabled?: boolean }) =>
    invokeRustDataFromStatus<ChannelCreateInput, Channel>('channels_create', data),

  updateChannel: (id: string, data: Partial<{ name: string; type: string; config: string; enabled: boolean }>) =>
    invokeRustDataFromStatus<ChannelUpdateInput, Channel>('channels_update', { id, ...data }),

  deleteChannel: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, { ok: boolean }>('channels_delete', { id }),

  testChannel: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, { ok: boolean }>('channels_test', { id }),

  sendChannelMessage: (id: string, text: string, title?: string, targetId?: string, targetType?: string) =>
    invokeRustDataFromStatus<ChannelSendMessageInput, { ok: boolean }>('channels_send', {
      id,
      text,
      title,
      target_id: targetId,
      target_type: targetType,
    }),

  listChannelChats: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, { chats: ChatTarget[] }>('channels_list_chats', { id }),

  startBot: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, { ok: boolean }>('channels_start_bot', { id }),

  stopBot: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, { ok: boolean }>('channels_stop_bot', { id }),

  getBotStatus: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, BotStatus>('channels_bot_status', { id }),

  listChannelEvents: (id: string, limit = 50, offset = 0) =>
    invokeRustDataFromStatus<ChannelEventsInput, { events: ChannelEvent[]; total: number }>('channels_list_events', {
      id,
      limit,
      offset,
    }),

  getChannelStats: (id: string) =>
    invokeRustDataFromStatus<ChannelIdInput, ChannelEventStats>('channels_stats', { id }),

  tailLogs: (cursor: number, limit: number = 1000, maxBytes: number = 102400) =>
    invokeRustDataFromStatus<LogsTailInput, LogTailResponse>('logs_tail', {
      cursor,
      limit,
      max_bytes: maxBytes,
    }),

  uploadFile: async (file: File): Promise<UploadResult> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },

  // OAuth2
  oauth2ListProviders: () =>
    invokeRustDataFromStatus<void, OAuth2ProviderSummary[]>('oauth2_list_providers'),

  oauth2GetProvider: (id: string) =>
    invokeRustDataFromStatus<OAuthIdInput, OAuth2ProviderDetail>('oauth2_get_provider', { id }),

  oauth2GetCredentialInfo: (id: string) =>
    invokeRustDataFromStatus<OAuthIdInput, { client_id: string; secret_masked: string; source: string; yaml_has_conf: boolean }>(
      'oauth2_get_credential_info',
      { id },
    ),

  oauth2SetCredentials: (id: string, clientId: string, clientSecret: string) =>
    invokeRustDataFromStatus<OAuthSetCredentialsInput, { status: string }>('oauth2_set_credentials', {
      id,
      client_id: clientId,
      client_secret: clientSecret,
    }),

  oauth2Authorize: (id: string, environment?: string, returnTo?: string) =>
    invokeRustDataFromStatus<OAuthAuthorizeInput, { auth_url: string }>('oauth2_authorize', { id, environment, return_to: returnTo }),

  oauth2StartLoopback: (
    id: string,
    environment?: string,
    purpose: OAuthLoopbackStartInput['purpose'] = 'connector_link',
  ) =>
    invokeRustDataFromStatus<OAuthLoopbackStartInput, {
      auth_url: string;
      session_id: string;
      expires_in_ms: number;
    }>(
      'oauth2_start_loopback',
      { id, environment, purpose },
    ),

  oauth2PollLoopback: (sessionId: string) =>
    invokeRustDataFromStatus<OAuthLoopbackPollInput, {
      completed: boolean;
      status: 'pending' | 'action_required' | 'acknowledgement_pending' | 'cancelling' | 'completed' | 'failed' | 'expired';
      callback_url?: string;
      error?: string;
      access_decision?: AccessDecision;
    }>(
      'oauth2_poll_loopback',
      { session_id: sessionId },
    ),

  oauth2ResumeLoopback: (sessionId: string) =>
    invokeRustDataFromStatus<OAuthLoopbackPollInput, {
      status: 'action_required' | 'acknowledgement_pending' | 'completed';
      access_decision?: AccessDecision;
    }>(
      'oauth2_resume_loopback',
      { session_id: sessionId },
    ),

  oauth2CancelLoopback: (sessionId: string) =>
    invokeRustDataFromStatus<OAuthLoopbackPollInput, { status: 'cancelled' | 'completed' }>(
      'oauth2_cancel_loopback',
      { session_id: sessionId },
    ),

  oauth2ListConnections: () =>
    invokeRustDataFromStatus<void, OAuth2Connection[]>('oauth2_list_connections'),

  oauth2GetConnection: (id: string) =>
    invokeRustDataFromStatus<OAuthIdInput, OAuth2Connection>('oauth2_get_connection', { id }),

  oauth2Disconnect: (id: string) =>
    invokeRustDataFromStatus<OAuthIdInput, OAuthDisconnectResult>(
      'oauth2_disconnect',
      { id },
    ),

  oauth2RefreshToken: (id: string) =>
    invokeRustDataFromStatus<OAuthIdInput, { status: string }>('oauth2_refresh_token', { id }),

  oauth2CallResource: (id: string, resource: string, params?: Record<string, string>) =>
    invokeRustDataFromStatus<OAuthResourceInput, unknown>('oauth2_call_resource', { id, resource, params }),

  oauth2Reload: () =>
    invokeRustDataFromStatus<void, { status: string }>('oauth2_reload'),

  oauth2GetPage: (id: string) =>
    invokeRustDataFromStatus<OAuthIdInput, { provider: OAuth2ProviderDetail; has_credentials: boolean }>('oauth2_get_page', { id }),

  oauthSimulateLarkStart: (opts?: { create_bot?: boolean; app_name?: string }) =>
    invokeRustDataFromStatus<OAuthSimulateStartInput, SimulateLoginStart>('oauth_simulate_lark_start', opts || {}),

  oauthSimulateLarkPoll: (sessionId: string) =>
    invokeRustDataFromStatus<OAuthSessionInput, SimulateLoginPoll>('oauth_simulate_lark_poll', { session_id: sessionId }),

  oauthSimulateLarkCreateBotSession: (appName?: string) =>
    invokeRustDataFromStatus<OAuthCreateBotSessionInput, { status: string; bot: LarkBotCredentials; channel_id?: string; error?: string }>(
      'oauth_simulate_lark_create_bot_session',
      { app_name: appName || 'Lark Bot' },
    ),

  // ── Memory API ──

  listMemories: (params?: { layer?: string; page?: number; page_size?: number; order_by?: string; agent_id?: string; since?: string; until?: string; period?: '24h' | '7d' | '30d' | '90d' }) =>
    invokeRustDataFromStatus<MemoryListInput, { memories: Memory[]; total: number }>('memory_list', { params }),

  getMemory: (id: string) => invokeRustDataFromStatus<MemoryIdInput, Memory>('memory_get', { id }),

  deleteMemory: (id: string) => invokeRustDataFromStatus<MemoryIdInput, { ok: boolean }>('memory_delete', { id }),

  updateMemory: (id: string, content: string) =>
    invokeRustDataFromStatus<{ id: string; content: string }, { ok: boolean; item: Memory | null }>('memory_update', { id, content }),

  searchMemories: (
    query: string,
    layers?: string[],
    limit?: number,
    agentId?: string,
    timeFilter?: MemoryTimeFilter,
  ) =>
    invokeRustDataFromStatus<MemorySearchInput, { results: ScoredMemory[] }>('memory_search', {
        query,
        layers,
        limit,
        agent_id: agentId || undefined,
        since: timeFilter?.since,
        until: timeFilter?.until,
        period: timeFilter?.period,
    }),

  getPersona: (agentId?: string) =>
    invokeRustDataFromStatus<MemoryPersonaInput, { persona: Persona | null }>('memory_persona', {
      agent_id: agentId,
    }),

  getMemoryStats: () => invokeRustDataFromStatus<void, MemoryStats>('memory_stats'),

  getMemoryEvents: (params?: { type?: string; limit?: number; offset?: number; agent_id?: string; since?: string; until?: string; period?: '24h' | '7d' | '30d' | '90d' }) =>
    invokeRustDataFromStatus<MemoryEventsInput, { events: MemoryEvent[] }>('memory_events', { params }),

  exportMemories: (params?: { layer?: string; agent_id?: string }) =>
    invokeRustDataFromStatus<MemoryExportInput, ExportData>('memory_export', { params }),

  importMemories: (data: ExportData, skipDuplicates?: boolean) =>
    invokeRustDataFromStatus<MemoryImportInput, ImportResult>('memory_import', {
      data,
      skip_duplicates: skipDuplicates !== false,
    }),

  getEmbeddingStatus: () =>
    invokeRustDataFromStatus<void, { provider: string; model: string; dimensions: number; vector_count: number }>('memory_embedding_status'),

  reEmbed: () =>
    invokeRustDataFromStatus<void, { ok: boolean; reembedded_count: number }>('memory_reembed'),

  tts: (text: string, voice?: string, speed?: number) =>
    invokeRustDataFromStatus<TtsInput, { url: string }>('tts_synthesize', { text, voice, speed }),

  ttsVoices: () =>
    invokeRustDataFromStatus<void, { voices: TTSVoice[] }>('tts_voices'),

  stt: async (file: Blob, language?: string): Promise<{ text: string }> => {
    const formData = new FormData();
    formData.append('file', file, 'recording.webm');
    if (language) formData.append('language', language);
    const res = await fetch(`${BASE_URL}/stt`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },

  // ── Config Sections (override mechanism) ──

  getConfigSection: (section: string) =>
    invokeRustDataFromStatus<ConfigSectionInput, Record<string, ConfigFieldMeta>>('config_section_get', { section }),

  setConfigSection: (section: string, values: Record<string, any>) =>
    invokeRustDataFromStatus<ConfigSectionSetInput, { ok: boolean }>('config_section_set', { section, values }),

  resetConfigField: (section: string, field: string) =>
    invokeRustDataFromStatus<ConfigFieldResetInput, { ok: boolean }>('config_field_reset', { section, field }),

  testPostgresConnection: (dsn: string) =>
    invokeRustDataFromStatus<ConfigPostgresTestInput, { ok: boolean; has_pgvector?: boolean; error?: string; warning?: string }>(
      'config_test_postgres',
      { dsn },
    ),

  listEmbeddingModels: () =>
    invokeRustDataFromStatus<void, {
      models: EmbeddingModelInfo[];
      resolved: { provider_id: string; provider_name: string; model: string };
      configured: { provider: string; model: string };
    }>('embedding_models_list'),

  // Visitor / online count
  visitorHeartbeat: () =>
    invokeRustDataFromStatus<void, { online: number; ip: string }>('visitor_heartbeat'),

  getOnlineCount: () =>
    invokeRustDataFromStatus<void, { online: number }>('visitor_online'),

  // ── Actor API ──

  actorSearchActors: async (query: string) => {
    const data = await invokeRustDataFromStatus<
      { q: string },
      {
        items: Array<{
          actorPtid: string;
          username: string;
          displayName: string;
          email?: string;
          avatar?: string;
          homeStationPeerId: string;
        }>;
        total: number;
      }
    >(
      'actor_search_actors', { q: query },
    );
    return { items: data?.items || [], total: data?.total || 0 };
  },

  actorGetMyProfile: async () => {
    const data = await invokeRustDataFromStatus<void, { actorPtid: string; displayName: string; username: string; avatar: string }>(
      'actor_get_my_profile',
    );
    return data;
  },

  // Federation API (Tier A1) — proto-first end-to-end. The Rust shim
  // already encodes a typed FederationSelfView / FederationResolveView /
  // FederationHealthView; `invokeRustProto` decodes the byte stream back
  // into a typed proto-es message so callers never touch JSON.
  federationGetSelf: () =>
    invokeRustProto('federation_get_self', FederationSelfViewSchema),

  federationUpdateVisibility: (visibility: string) =>
    invokeRustProto(
      'federation_update_visibility',
      FederationSelfViewSchema,
      { visibility },
    ),

  federationResolve: (handle: string) =>
    invokeRustProto(
      'federation_resolve',
      FederationResolveViewSchema,
      { handle },
    ),

  federationHealth: () =>
    invokeRustProto('federation_health', FederationHealthViewSchema),

  federationCatalogSearch: (params: {
    federation_id: string;
    prefix: string;
    station_id?: string;
    page_size?: number;
  }) =>
    invokeRustProto('federation_catalog_search', FederationCatalogSearchResponseSchema, params),

  // Federation Lifecycle (Governance Subserver)
  federationListFederations: () =>
    invokeRustProto('federation_list_federations', ListFederationsResponseSchema),

  federationCreate: (params: { name: string; description?: string; policy_type?: string }) =>
    invokeRustProto('federation_create', CreateFederationResponseSchema, params),

  federationJoin: (params: {
    federation_endpoint?: string;
    federation_id?: string;
    message?: string;
  }) =>
    invokeRustProto('federation_join', JoinFederationResponseSchema, params),

  federationLeave: (params: { federation_id: string; reason?: string }) =>
    invokeRustProto('federation_leave', LeaveFederationResponseSchema, params),

  federationDelete: (params: { federation_id: string }) =>
    invokeRustProto('federation_delete', DeleteFederationResponseSchema, params),

  federationListMemberStations: (federationId: string) =>
    invokeRustProto('federation_list_member_stations', ListMemberStationsResponseSchema, {
      federation_id: federationId,
    }),

  /**
   * Fire a presence trigger to the Rust supervisor. Always resolves; the
   * supervisor decides whether to act based on cooldown / state. See
   * {@link PresenceTrigger} for the wire vocabulary.
   *
   * The frontend never blocks on this — it's a fire-and-forget hint.
   */
  presenceNotify: (trigger: PresenceTrigger) =>
    invokeRustCommand<{ trigger: PresenceTrigger }, { command: string; status: string }>(
      'presence_notify',
      { trigger },
    ).catch((err) => {
      // Best-effort: lifecycle hooks must never surface errors to the UI.
      log.debug('presence', 'presenceNotify failed', { trigger, error: err instanceof Error ? err.message : String(err) });
      return { command: 'presence_notify', status: '{"accepted":false}' };
    }),

  presenceQuery: async (actorPtids: string[]): Promise<PresenceStatusProjection[]> => {
    const response = await invokeRustData<
      { actor_ptids: string[] },
      {
        statuses?: Array<{
          actorPtid?: string;
          actor_ptid?: string;
          state?: number | string;
        }>;
      }
    >('presence_query', { actor_ptids: actorPtids });
    return (response.statuses ?? []).flatMap((status) => {
      const actorPtid = (status.actorPtid || status.actor_ptid || '').trim();
      if (!actorPtid) return [];
      return [{
        actorPtid,
        online: resolvePresenceOnline(status.state ?? 0),
      }];
    });
  },

  /**
   * Start the unified realtime SSE consumer for the current actor.
   * Idempotent — the Rust side replaces any in-flight supervisor for
   * the same actor. While running, the supervisor emits
   * `realtime:event` Tauri events for every business / heartbeat /
   * resync frame and `realtime:connection-state` on connect/disconnect.
   * See docs/architecture/shared/communication/event-stream.md for the wire
   * contract and the per-window device id semantics.
   */
  realtimeStreamStart: () =>
    invokeRustDataFromStatus<void, { actor_ptid: string; device_id: string }>(
      'realtime_stream_start',
    ),

  /** Cancel the realtime SSE consumer for the current actor. */
  realtimeStreamStop: () =>
    invokeRustDataFromStatus<void, { actor_ptid: string | null }>('realtime_stream_stop'),

  /**
   * Publish one WebRTC signaling event onto the recipient's realtime
   * SSE stream via Station's `POST /realtime/signal` ingress
   * (contract §2.7.1). `payloadB64` is the caller-side ciphertext
   * envelope produced by the **standalone signaling envelope** (§2.7.2 —
   * X25519 + HKDF-SHA256 + AES-256-GCM with random nonce + AAD bound to
   * `session_ulid` and `kind`). It is intentionally NOT the chat
   * ratchet ciphertext: the chat ratchet requires strict in-order
   * delivery, which would stall on out-of-order ICE candidates.
   * Station never decrypts the payload.
   */
  realtimeSignalSend: (
    recipientActorPtid: string,
    sessionUlid: string,
    kind: RealtimeCallSignalKind,
    payloadB64: string,
    callId?: string,
    deviceId?: string,
  ) =>
    invokeRustDataFromStatus<
      {
        recipient_actor_ptid: string;
        session_ulid: string;
        kind: string;
        payload_b64: string;
        call_id: string;
        device_id: string;
      },
      Record<string, unknown>
    >('realtime_signal_send', {
      recipient_actor_ptid: recipientActorPtid,
      session_ulid: sessionUlid,
      kind,
      payload_b64: payloadB64,
      call_id: callId ?? '',
      device_id: deviceId ?? '',
    }),

  realtimeCallResolutionGet: (callId: string, peerActorPtid: string) =>
    invokeRustDataFromStatus<
      { call_id: string; peer_actor_ptid: string },
      RealtimeCallResolutionProjection
    >('realtime_call_resolution_get', {
      call_id: callId,
      peer_actor_ptid: peerActorPtid,
    }),

  /**
   * Submit an ephemeral typing pulse through the canonical Messaging
   * admission path. Station validates active membership and fans the
   * pulse out without writing it to durable message history.
   */
  messagingTypingSend: (conversationId: string, typing: boolean) =>
    invokeRustData<
      { conversation_id: string; is_typing: boolean },
      { submitted: boolean }
    >('messaging_submit_typing', {
      conversation_id: conversationId,
      is_typing: typing,
    }),

  messagingReadCursor: (conversationId: string, lastReadSequence: number) =>
    invokeRustData<
      { conversation_id: string; last_read_sequence: number },
      { submitted: boolean }
    >('messaging_submit_read_cursor', {
      conversation_id: conversationId,
      last_read_sequence: lastReadSequence,
    }),

  chatStorageSnapshot: (input: {
    stationPeerId: string;
    actorPtid: string;
    deviceId: string;
    scopeRevision: string;
  }) =>
    invokeRustProtoRequest(
      'chat_storage_snapshot',
      ChatStorageSnapshotRequestSchema,
      ChatStorageSnapshotSchema,
      create(ChatStorageSnapshotRequestSchema, {
        scope: {
          stationPeerId: input.stationPeerId,
          actorPtid: input.actorPtid,
          deviceId: input.deviceId,
        },
        scopeRevision: input.scopeRevision,
      }),
    ),

  chatStorageClearCache: (input: {
    stationPeerId: string;
    actorPtid: string;
    deviceId: string;
    scopeRevision: string;
  }) =>
    invokeRustProtoRequest(
      'chat_storage_clear_cache',
      ChatStorageSnapshotRequestSchema,
      ChatStorageResultSchema,
      create(ChatStorageSnapshotRequestSchema, {
        scope: {
          stationPeerId: input.stationPeerId,
          actorPtid: input.actorPtid,
          deviceId: input.deviceId,
        },
        scopeRevision: input.scopeRevision,
      }),
    ),

  chatStorageClearConversation: (input: {
    stationPeerId: string;
    actorPtid: string;
    deviceId: string;
    scopeRevision: string;
    conversationId: string;
  }) =>
    invokeRustProtoRequest(
      'chat_storage_clear_conversation',
      ChatStorageConversationRequestSchema,
      ChatStorageResultSchema,
      create(ChatStorageConversationRequestSchema, {
        scope: {
          stationPeerId: input.stationPeerId,
          actorPtid: input.actorPtid,
          deviceId: input.deviceId,
        },
        scopeRevision: input.scopeRevision,
        conversationId: input.conversationId,
      }),
    ),

  chatStorageSetRetention: (input: {
    stationPeerId: string;
    actorPtid: string;
    deviceId: string;
    scopeRevision: string;
    retentionPreset: ChatRetentionPreset;
  }) =>
    invokeRustProtoRequest(
      'chat_storage_set_retention',
      ChatStorageRetentionRequestSchema,
      ChatStorageResultSchema,
      create(ChatStorageRetentionRequestSchema, {
        scope: {
          stationPeerId: input.stationPeerId,
          actorPtid: input.actorPtid,
          deviceId: input.deviceId,
        },
        scopeRevision: input.scopeRevision,
        retentionPreset: input.retentionPreset,
      }),
    ),

  messagingEditMessage: (
    conversationId: string,
    messageId: string,
    plaintext: string,
  ) =>
    invokeRustData<
      {
        conversation_id: string;
        message_id: string;
        plaintext: string;
      },
      { command_id: string; state: string }
    >('messaging_submit_edit', {
      conversation_id: conversationId,
      message_id: messageId,
      plaintext,
    }),

  messagingMetadataInteraction: (
    conversationId: string,
    messageId: string,
    kind: 'hideForActor' | 'retract' | 'reaction' | 'pin',
    options: { reaction?: string; remove?: boolean } = {},
  ) =>
    invokeRustData<
      {
        conversation_id: string;
        message_id: string;
        kind: string;
        reaction: string;
        remove: boolean;
      },
      { command_id: string; state: string }
    >('messaging_submit_metadata_interaction', {
      conversation_id: conversationId,
      message_id: messageId,
      kind,
      reaction: options.reaction ?? '',
      remove: options.remove ?? false,
    }),

  messagingAcceptanceInteractionSnapshot: (input: {
    actorPtid: string;
    conversationId: string;
    messageId: string;
    commandId?: string;
  }) =>
    invokeRustData<
      {
        expected_actor_ptid: string;
        conversation_id: string;
        message_id: string;
        command_id: string;
      },
      MessagingAcceptanceInteractionSnapshot
    >('messaging_acceptance_interaction_snapshot', {
      expected_actor_ptid: input.actorPtid,
      conversation_id: input.conversationId,
      message_id: input.messageId,
      command_id: input.commandId ?? '',
    }),

  messagingAcceptancePrepareSubmittedCommand: (input: {
    actorPtid: string;
    conversationId: string;
    messageId: string;
    commandId: string;
  }) =>
    invokeRustData<
      {
        expected_actor_ptid: string;
        conversation_id: string;
        message_id: string;
        command_id: string;
      },
      MessagingAcceptancePreparedCommand
    >('messaging_acceptance_prepare_submitted_command', {
      expected_actor_ptid: input.actorPtid,
      conversation_id: input.conversationId,
      message_id: input.messageId,
      command_id: input.commandId,
    }),

  messagingAcceptanceCreateRestorableCommand: (input: {
    actorPtid: string;
    conversationId: string;
    plaintext: string;
  }) =>
    invokeRustData<
      {
        expected_actor_ptid: string;
        conversation_id: string;
        plaintext: string;
      },
      MessagingAcceptanceRestorableCommand
    >('messaging_acceptance_create_restorable_command', {
      expected_actor_ptid: input.actorPtid,
      conversation_id: input.conversationId,
      plaintext: input.plaintext,
    }),

  messagingAcceptanceResumeLifecycle: (expectedActorPtid: string) =>
    invokeRustData<
      { expected_actor_ptid: string },
      { actorPtid: string; activated: boolean }
    >('messaging_acceptance_resume_lifecycle', {
      expected_actor_ptid: expectedActorPtid,
    }),

  messagingAcceptanceCurrentEndpoint: (expectedActorPtid: string) =>
    invokeRustData<
      { expected_actor_ptid: string },
      { actor_ptid: string; device_id: string }
    >('messaging_acceptance_current_endpoint', {
      expected_actor_ptid: expectedActorPtid,
    }),

  chatStorageAcceptanceSeedConversationClear: (input: {
    actorPtid: string;
    stationPeerId: string;
    plaintextBytes: number;
  }) =>
    invokeRustData<
      {
        expected_actor_ptid: string;
        station_peer_id: string;
        plaintext_bytes: number;
      },
      ChatStorageAcceptanceConversationClearFixture
    >('chat_storage_acceptance_seed_conversation_clear', {
      expected_actor_ptid: input.actorPtid,
      station_peer_id: input.stationPeerId,
      plaintext_bytes: input.plaintextBytes,
    }),

  /**
   * Seal a WebRTC signaling plaintext (canonical JSON for SDP /
   * candidate / hangup) into the standalone signaling envelope
   * defined in `docs/architecture/shared/communication/event-stream.md` §2.7.2.
   * Returns base64 of the wire bytes
   * `eph_pub(32B) || nonce(12B) || ciphertext || tag(16B)`.
   *
   * `peerIkPubB64` is the recipient's long-term Ed25519 identity
   * public key (32 raw bytes, base64). The Rust side internally
   * converts it to its Curve25519/X25519 image (Edwards → Montgomery)
   * before performing the two ECDHs (ephemeral×peer and self×peer).
   */
  signalingEnvelopeSeal: (
    peerIkPubB64: string,
    sessionUlid: string,
    kind: RealtimeCallSignalKind,
    plaintext: string,
  ) =>
    invokeAppResultStub<{ payload_b64: string }>('signaling_envelope_seal', {
      peerIkPub: peerIkPubB64,
      sessionUlid,
      kind,
      plaintext,
    }),

  /**
   * Open an incoming signaling envelope, returning the canonical
   * plaintext JSON. The AAD is `session_ulid || 0x1F || kind`, so a
   * mismatch between the wire `kind` and the SSE-delivered metadata
   * (or the wrong session) MUST surface as an authentication failure
   * rather than producing wrong cleartext.
   */
  signalingEnvelopeOpen: (
    senderIkPubB64: string,
    sessionUlid: string,
    kind: RealtimeCallSignalKind,
    payloadB64: string,
  ) =>
    invokeAppResultStub<{ plaintext: string }>('signaling_envelope_open', {
      senderIkPub: senderIkPubB64,
      sessionUlid,
      kind,
      payloadB64,
    }),

  cryptoRatchetTelemetrySnapshot: () =>
    invokeAppResultStub<{
      dr_decrypts: number;
      since_unix_ms: number;
    }>('crypto_ratchet_telemetry_snapshot'),

  keyExchangeUploadBundle: (bundle: CryptoKeyBundlePayload) =>
    invokeRustDataFromStatus<CryptoKeyBundlePayload, Record<string, unknown>>(
      'key_exchange_upload_bundle',
      bundle,
    ),

  keyExchangeFetchBundle: (ptid: string, deviceId?: string, homeStationPeerId?: string) =>
    invokeRustDataFromStatus<{ ptid: string; device_id?: string; home_station_peer_id?: string }, KeyExchangeFetchBundlesResponse>(
      'key_exchange_fetch_bundle',
      {
        ptid,
        ...(deviceId != null && deviceId !== '' ? { device_id: deviceId } : {}),
        ...(homeStationPeerId != null && homeStationPeerId !== '' ? { home_station_peer_id: homeStationPeerId } : {}),
      },
    ),

  accountGetDeviceId: () =>
    invokeRustDataFromStatus<void, { device_id: string }>('account_get_device_id'),

  // ── ICE / TURN ──
  //
  // Anything resembling an ICE *session* (offer/answer/candidate exchange)
  // moved to the unified realtime SSE plane in Phase 8 — see
  // `realtimeSignalSend` / `signalingEnvelopeSeal` / `signalingEnvelopeOpen`
  // above and docs/architecture/shared/communication/event-stream.md §2.7. The role-
  // hint publisher (`ice_peer_register`) was retired in 8.3c — peer
  // online/offline liveness is now carried by PresenceFlip events on the
  // canonical realtime stream. What remains here is just the TURN
  // credentials fetch (media plane).

  iceGetServers: () =>
    invokeRustDataFromStatus<void, IceServersResponse>('ice_get_servers'),

  // ── Friend Request (social domain) ──

  socialFriendRequestSend: (input: {
    receiverPtid: string;
    receiverHomeStationPeerId: string;
    federationId: string;
    message?: string;
  }) =>
    invokeRustProto(
      'social_friend_request_send',
      SendSocialFriendRequestResponseSchema,
      {
        receiver_ptid: input.receiverPtid,
        receiver_home_station_peer_id: input.receiverHomeStationPeerId,
        federation_id: input.federationId,
        message: input.message,
      },
    ),

  socialFriendRequestAccept: (input: {
    requestId: string;
    senderPtid: string;
    senderHomeStationPeerId: string;
    federationId: string;
    message?: string;
  }) =>
    invokeRustProto(
      'social_friend_request_accept',
      AcceptSocialFriendRequestResponseSchema,
      {
        request_id: input.requestId,
        sender_ptid: input.senderPtid,
        sender_home_station_peer_id: input.senderHomeStationPeerId,
        federation_id: input.federationId,
        message: input.message,
      },
    ),

  socialFriendRequestReject: (input: {
    requestId: string;
    senderPtid: string;
    senderHomeStationPeerId: string;
    federationId: string;
    message?: string;
  }) =>
    invokeRustProto(
      'social_friend_request_reject',
      RejectSocialFriendRequestResponseSchema,
      {
        request_id: input.requestId,
        sender_ptid: input.senderPtid,
        sender_home_station_peer_id: input.senderHomeStationPeerId,
        federation_id: input.federationId,
        message: input.message,
      },
    ),

  socialFriendRequestList: (status?: number, limit?: number, offset?: number) =>
    invokeRustProto(
      'social_friend_request_list',
      ListSocialFriendRequestsResponseSchema,
      { status, limit, offset },
    ),

  // ── Notification ──

  notificationList: (category?: number, status?: number, cursor?: string, limit?: number) =>
    invokeRustDataFromStatus<NotificationListInput, NotificationListResponse>(
      'notification_list', { category, status, cursor, limit },
    ),

  notificationUnreadCounts: () =>
    invokeRustDataFromStatus<void, NotificationUnreadCountsResponse>(
      'notification_unread_counts',
    ),

  notificationMarkRead: (notificationIds: string[]) =>
    invokeRustDataFromStatus<{ notification_ids: string[] }, { updatedCount: number }>(
      'notification_mark_read', { notification_ids: notificationIds },
    ),

  notificationMarkAllRead: (category?: number) =>
    invokeRustDataFromStatus<{ category?: number }, { updatedCount: number }>(
      'notification_mark_all_read', { category },
    ),

  notificationDelete: (notificationIds: string[]) =>
    invokeRustDataFromStatus<{ notification_ids: string[] }, { deletedCount: number }>(
      'notification_delete', { notification_ids: notificationIds },
    ),

  notificationPreferences: () =>
    invokeRustDataFromStatus<void, NotificationPreferencesSnapshotData>(
      'notification_preferences',
    ),

  notificationPreferencesUpdate: async (input: NotificationPreferencesUpdateInput) => {
    const categories = new Set<number>();
    const invalidBatch = input.updates.length === 0 || input.updates.some((update) => {
      if (update.category === 0 || categories.has(update.category)) return true;
      categories.add(update.category);
      return false;
    });
    if (invalidBatch) {
      throw new Error('notification.preferences.invalidBatch');
    }
    const request = {
      updates: input.updates.map((update) => ({
        category: update.category,
        enabled: update.enabled,
        push_enabled: update.pushEnabled,
        sound_enabled: update.soundEnabled,
      })),
      observed_revision: toPositiveRustUint64(
        input.observedRevision,
        'notification_preferences.observed_revision',
      ),
    };
    try {
      return await invokeRustDataFromStatus<
        typeof request,
        NotificationPreferencesUpdateResult
      >('notification_preferences_update', request);
    } catch (error) {
      const snapshot = await api.notificationPreferences().catch(() => null);
      if (!snapshot) throw error;
      if (notificationSnapshotMatchesUpdates(snapshot, input.updates)) {
        return {
          outcome:
            snapshot.notificationPreferencesRevision === input.observedRevision
              ? 'NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_UNCHANGED'
              : 'NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_APPLIED',
          snapshot,
        } satisfies NotificationPreferencesUpdateResult;
      }
      if (snapshot.notificationPreferencesRevision > input.observedRevision) {
        return {
          outcome: 'NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_CONFLICT',
          snapshot,
        } satisfies NotificationPreferencesUpdateResult;
      }
      throw error;
    }
  },

  desktopNativeHostEventEmit: (input: DesktopNativeHostEventInput) =>
    invokeRustDataFromStatus<DesktopNativeHostEventInput, { emitted: boolean; kind: string }>(
      'desktop_native_event_emit',
      input,
    ),

  // ── Station registry (dynamic URL picker) ──

  stationList: () =>
    invokeRustDataFromStatus<void, StationListResponse>('station_list'),

  stationSetActive: (url: string) =>
    invokeRustDataFromStatus<
      { url: string },
      { active_url?: string | null; binding: StationBindingState }
    >('station_set_active', { url }),

  stationBindingComplete: () =>
    invokeRustDataFromStatus<void, StationBindingState>('station_binding_complete'),

  stationAdd: (url: string) =>
    invokeRustDataFromStatus<{ url: string }, StationEntry>('station_add', { url }),

  stationRemove: (url: string) =>
    invokeRustDataFromStatus<
      { url: string },
      { removed: string; was_selected: boolean; binding: StationBindingState }
    >('station_remove', { url }),

  stationProbe: (url: string) =>
    invokeRustDataFromStatus<{ url: string }, StationProbeResult>('station_probe', { url }),

  resolveErrorAction: (action: { type: string; cliId?: string; providerId?: string; label: string }) =>
    invoke<{ ok: boolean; reauth?: boolean; message?: string; opened?: boolean }>('resolve_error_action', { action }),

  quickCompletion: (agentId: string, prompt: string) =>
    invokeRustDataFromStatus<
      { agent_id: string; prompt: string },
      { ok: boolean; content: string }
    >('agent_quick_completion', { agent_id: agentId, prompt }).then((r) => r.content ?? ''),

  groupCallJoin: (input: { group_ulid: string }) =>
    invokeRustDataFromStatus<
      { group_ulid: string },
      { url: string; token: string; room_name: string }
    >('group_call_join', input),
};

export interface ConfigFieldMeta {
  value: any;
  default: any;
  source: 'default' | 'custom';
}

export interface EmbeddingModelInfo {
  id: string;
  name: string;
  provider: string;
  dimensions: number;
}

export interface UploadResult {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  data_url: string;
  url: string;
}

export interface IceServersResponse {
  ice_servers: Array<{ urls: string[]; username?: string; credential?: string }>;
  ttl?: number;
}

/** Payload for friend/group chat send; field names match Station JSON and Rust `AttachmentInput`. */
export type ChatAttachmentInput = {
  cid: string;
  filename: string;
  mime_type: string;
  size: number;
  thumbnail_cid?: string;
  visibility?: string;
  encryption_suite?: string;
  encryption_key_b64?: string;
  encryption_nonce_b64?: string;
  plaintext_sha256_b64?: string;
  ciphertext_sha256_b64?: string;
  plaintext_size?: number;
  ciphertext_size?: number;
  chunking?: string;
  chunk_size?: number;
  chunk_count?: number;
  tag_size?: number;
  nonce_strategy?: string;
};

export interface CryptoKeyBundlePayload {
  ik_pub: string;
  spk_id: number;
  spk_pub: string;
  spk_sig: string;
  opk_ids: number[];
  opk_pubs: string[];
  supported_versions?: number[];
  device_id: string;
}

/** One device-published bundle from Station (`FetchDirectKeyBundlesResponse.bundles`). */
export interface KeyExchangeWireBundle {
  ptid: string;
  device_id: string;
  ik_pub: string;
  /** SHA-256 hex over raw IK bytes; added by the desktop stub (not on wire proto). */
  fingerprint?: string;
  spk_pub: string;
  spk_sig: string;
  opks: string[];
  published_at_unix_ms: number;
  supported_versions: number[];
}

export interface KeyExchangeFetchBundlesResponse {
  bundles: KeyExchangeWireBundle[];
}

/** Most recently published bundle for a PTID (server returns `published_at` desc). */
export function pickLatestKeyExchangeBundle(
  res: KeyExchangeFetchBundlesResponse | null | undefined,
): KeyExchangeWireBundle | undefined {
  const first = res?.bundles?.[0];
  return first;
}

export interface FriendRequestData {
  id: string;
  senderPtid: string;
  receiverPtid: string;
  federationId: string;
  senderHomeStationPeerId: string;
  receiverHomeStationPeerId: string;
  status: number;
  message: string;
  createdAt: string;
  respondedAt?: string;
}

export interface NotificationData {
  id: string;
  recipientPtid: string;
  actorPtid: string;
  type: number;
  category: number;
  status: number;
  targetType: string;
  targetId: string;
  title: string;
  body: string;
  metadata: Record<string, string>;
  groupKey: string;
  createdAt: string;
  readAt?: string;
}

export interface NotificationListInput {
  category?: number;
  status?: number;
  cursor?: string;
  limit?: number;
}

export interface NotificationListResponse {
  notifications: NotificationData[];
  nextCursor: string;
  totalCount: number;
  unreadCount: number;
}

export interface NotificationUnreadCountsResponse {
  total: number;
  byCategory: Record<number, number>;
}

export interface NotificationPreferenceData {
  actorPtid: string;
  category: number;
  enabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  updatedAt: string;
}

export interface NotificationPreferencesSnapshotData {
  preferences: NotificationPreferenceData[];
  notificationPreferencesRevision: number;
}

export interface NotificationPreferencePatchInput {
  category: number;
  enabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
}

export interface NotificationPreferencesUpdateInput {
  updates: NotificationPreferencePatchInput[];
  observedRevision: number;
}

export type NotificationPreferencesUpdateOutcome =
  | 'NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_APPLIED'
  | 'NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_UNCHANGED'
  | 'NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_CONFLICT';

export interface NotificationPreferencesUpdateResult {
  outcome: NotificationPreferencesUpdateOutcome;
  snapshot: NotificationPreferencesSnapshotData;
}

function notificationSnapshotMatchesUpdates(
  snapshot: NotificationPreferencesSnapshotData,
  updates: readonly NotificationPreferencePatchInput[],
): boolean {
  const preferences = new Map(
    snapshot.preferences.map((preference) => [preference.category, preference]),
  );
  return updates.every((update) => {
    const preference = preferences.get(update.category);
    return Boolean(
      preference
      && preference.enabled === update.enabled
      && preference.pushEnabled === update.pushEnabled
      && preference.soundEnabled === update.soundEnabled,
    );
  });
}

export interface StreamEvent {
  event: string;
  data: Record<string, unknown>;
  ptid?: string;
  sourceDelivery?: AgentTurnSourceDelivery;
}

export interface AgentTurnSourceDelivery {
  transport: 'station-sse';
  ptid: string;
  conversationId: string;
  turnId: string;
  sequence: number;
  rawPayload: {
    eventType: string;
    data: Record<string, unknown>;
  };
}

export interface AgentTurnStreamController extends AbortController {
  readonly streamId: string;
  readonly streamGeneration: number;
  disconnectTransport(): Promise<void>;
}

export interface ChatImageInput {
  url?: string;
  data_url?: string;
  mime_type?: string;
  filename?: string;
}

function millisToISO(millis?: number): string {
  if (!millis) return new Date().toISOString();
  return new Date(millis).toISOString();
}

function mapAIChatSessionToSession(item: any): Session {
  const updatedMillis = Number(item.updated_at ?? item.lastTimestampMs ?? Date.now());
  const createdMillis = Number(item.created_at ?? item.lastTimestampMs ?? Date.now());
  return {
    id: item.id,
    key: item.id,
    agent_name: item.agent_id || 'assistant',
    title: item.title || 'New Chat',
    message_count: Number(item.message_count ?? item.messageCount ?? item.unreadCount ?? 0),
    model_override: item.model_name || item.modelName || undefined,
    created_at: millisToISO(createdMillis),
    updated_at: millisToISO(updatedMillis),
    pinned: item.pinned ?? false,
    favorite: item.favorite ?? false,
  };
}

function mapAIChatMessageToMessage(item: any): Message {
  return {
    id: item.id,
    role: String(item.role || '').replace('CHAT_ROLE_', '').toLowerCase() || 'assistant',
    content: item.content || '',
    model: item.model_name || item.modelName || undefined,
    created_at: millisToISO(Number(item.created_at ?? item.createdAt ?? Date.now())),
    tool_calls: item.tool_calls_json || undefined,
  };
}

function parseJSONSafe(input?: string): Record<string, any> {
  if (!input) return {};
  try { return JSON.parse(input); } catch { return {}; }
}

function modelCapabilityFlags(model: unknown): Record<string, boolean> {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return {};
  const capabilities = (model as Record<string, unknown>).capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return {};
  const flags = (capabilities as Record<string, unknown>).flags;
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return {};
  return flags as Record<string, boolean>;
}

function modelCapabilityFlag(model: unknown, capabilityId: string): boolean {
  return Boolean(modelCapabilityFlags(model)[capabilityId]);
}

function withModelCapabilityConfig<T extends ProviderModelConfigInput>(data: T): T & {
  capabilities?: { flags: Record<string, boolean> };
} {
  const flags: Record<string, boolean> = {};
  const assignments: Array<[keyof ProviderModelConfigInput, string]> = [
    ['streaming', 'streaming'],
    ['function_call', 'native-tools'],
    ['vision', 'image-input'],
    ['reasoning', 'reasoning'],
    ['image_output', 'image-output'],
  ];
  for (const [field, capabilityId] of assignments) {
    if (data[field] !== undefined) {
      flags[capabilityId] = Boolean(data[field]);
    }
  }
  if (Object.keys(flags).length === 0) {
    return data;
  }
  return {
    ...data,
    capabilities: { flags },
  };
}

function mapAIChatProviderToListItem(item: any): ProviderListItem {
  return {
    id: item.id,
    name: item.name || '',
    description: item.description || '',
    logo: item.logo || undefined,
    enabled: Boolean(item.enabled),
    builtin: Boolean(item.builtin),
    has_api_key: item.credential_status === 'configured',
    requires_api_key: Boolean(item.show_api_key),
    credential_status: String(item.credential_status || ''),
    runtime_kind: String(item.runtime_kind || ''),
    version: Number(item.version || 0),
  };
}

function mapAIChatProviderToDetail(item: any): ProviderDetail {
  const cfg = parseJSONSafe(item.config_json);
  const keyVaults = parseJSONSafe(item.key_vaults);
  const checkModel = String(item.check_model || '');
  const providerModels = Array.isArray(item.models)
    ? item.models
    : Array.isArray(cfg.models)
      ? cfg.models
      : [];
  const models: ModelItem[] = providerModels
    .map((model: any) => {
      const id = String(model?.id || '').trim();
      if (!id) return null;
      return {
        id,
        display_name: String(model?.display_name || id),
        type: String(model?.type || 'chat'),
        enabled: Boolean(model?.enabled ?? true),
        context_window: Number(model?.context_window || 0),
        streaming: modelCapabilityFlag(model, 'streaming'),
        function_call: modelCapabilityFlag(model, 'native-tools'),
        vision: modelCapabilityFlag(model, 'image-input'),
        reasoning: modelCapabilityFlag(model, 'reasoning'),
        search: Boolean(model?.search),
        image_output: modelCapabilityFlag(model, 'image-output'),
        video: Boolean(model?.video),
      } as ModelItem;
    })
    .filter((model: ModelItem | null): model is ModelItem => Boolean(model));
  return {
    ...mapAIChatProviderToListItem(item),
    home_url: item.home_url || cfg.home_url || '',
    api_key_url: item.api_key_url || cfg.api_key_url || '',
    api_key: item.api_key || keyVaults.api_key || '',
    base_url: item.base_url || cfg.base_url || '',
    default_base_url: item.base_url || cfg.default_base_url || cfg.base_url || '',
    show_api_key: item.show_api_key ?? cfg.show_api_key ?? cfg.showApiKey,
    show_checker: item.show_checker ?? true,
    check_model: checkModel,
    models,
  };
}

export const AGENT_REPLAY_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const AGENT_REPLAY_CATCHUP_TIMEOUT_MS = 30_000;
export const AGENT_SSE_IDLE_TIMEOUT_MS = 30_000;
// #region debug-point J-M:lease-replay-fetch
function reportLeaseReplayFetchDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
  void fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'lease-approval-stall',
      runId: 'post-fix',
      hypothesisId,
      location: 'desktop_api.ts:streamAgentTurnReplay',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion
const AGENT_REPLAY_CONTROL_EVENTS = new Set([
  'reconnecting',
  'replaying',
  'reconciling',
  'connected',
  'recovery_failed',
  'catchup_done',
]);

export function classifyAgentTurnTerminalEvent(
  event: StreamEvent,
): 'completed' | 'cancelled' | 'queued' | 'failed' | 'interrupted' | null {
  if (event.event === 'error') {
    const outcome = projectAgentTurnOutcomeErrorPayload(event.data);
    return isAgentLifecycleInterruptedError(outcome) ? 'interrupted' : 'failed';
  }
  if (event.event === 'queued' || event.event === 'admission_replayed') return 'queued';
  if (event.event === 'done') return 'completed';
  if (event.event === 'cancelled') return 'cancelled';
  if (event.event !== 'snapshot') return null;
  const status = String(event.data?.status || '').toLowerCase();
  if (status === 'failed') return 'failed';
  if (status === 'interrupted') return 'interrupted';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed') return 'completed';
  return null;
}

export function agentTurnStreamErrorFromData(
  data: Record<string, unknown>,
): AgentTurnStreamError {
  const typedError = projectAgentTurnErrorPayload(data);
  const error = new Error(
    typedError?.locale_key
    || (typeof data.error === 'string' ? data.error : 'agent.error.streamFailed'),
  ) as AgentTurnStreamError;
  error.typedError = typedError;
  const mappedResolution = resolveAgentTypedErrorAction(typedError);
  if (mappedResolution) {
    error.resolution = mappedResolution;
  } else if (data.resolution && typeof data.resolution === 'object') {
    const suppliedResolution = data.resolution as AgentErrorResolutionAction;
    if (
      suppliedResolution.type !== 'recover'
      && suppliedResolution.type !== 'chooseResourceAgain'
      && suppliedResolution.type !== 'removeReference'
      && suppliedResolution.type !== 'retry'
      && suppliedResolution.type !== 'reloadLatest'
      && suppliedResolution.type !== 'openResult'
    ) {
      error.resolution = suppliedResolution;
    }
  }
  if (typeof data.detail === 'string') error.errorDetail = data.detail;
  if (typeof data.providerId === 'string') {
    error.providerId = data.providerId;
  } else if (typedError?.details.provider_id) {
    error.providerId = typedError.details.provider_id;
  }
  return error;
}

export function normalizeAgentTurnStreamError(error: unknown): AgentTurnStreamError {
  if (error instanceof Error && 'typedError' in error) {
    return error as AgentTurnStreamError;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (error && typeof error === 'object' && 'details' in error) {
    const details = error.details;
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const normalized = agentTurnStreamErrorFromData({
        ...(details as Record<string, unknown>),
        error: message,
      });
      if (normalized.typedError) return normalized;
    }
  }
  return error instanceof Error
    ? error as AgentTurnStreamError
    : new Error(message) as AgentTurnStreamError;
}

export function createAgentTurnSourceDelivery(
  event: string,
  data: Record<string, unknown>,
  ptid: string,
  _fallbackConversationId: string,
  _fallbackTurnId = '',
): AgentTurnSourceDelivery {
  const conversationId = String(
    data.conversationId ?? data.conversation_id ?? '',
  ).trim();
  const turnId = String(data.turnId ?? data.turn_id ?? '').trim();
  const sequence = Number(data.seq ?? data.sequence ?? 0);
  return {
    transport: 'station-sse',
    ptid,
    conversationId,
    turnId,
    sequence: Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0,
    rawPayload: {
      eventType: event,
      data: { ...data },
    },
  };
}

function publishAgentTurnRuntimeEvent(
  streamId: string,
  streamGeneration: number,
  ptid: string,
  conversationId: string,
  agentId: string,
  event: StreamEvent,
): void {
  if (!ptid) return;
  const payload: AgentTurnStreamEventPayload & {
    sourceDelivery?: AgentTurnSourceDelivery;
  } = {
    streamId,
    streamGeneration,
    ptid,
    conversationId,
    agentId,
    event: event.event,
    data: event.data,
    timestampMs: Date.now(),
    sourceDelivery: event.sourceDelivery,
  };
  eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, payload);
}

export function streamChat(
  message: string,
  sessionKey: string,
  _agentName: string,
  onEvent: (event: StreamEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  _images?: ChatImageInput[],
  model?: string,
  providerId?: string,
): AbortController {
  const controller = new AbortController();
  log.info('api', 'streamChat started', { sessionKey, model });
  (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const result = await invokeRustDataFromStatus<ChatCompletionInput, { stream_id: string }>(
        'chat_completion_stream',
        {
          session_id: sessionKey,
          provider_id: providerId || '',
          model: model || '',
          message,
        },
      );
      const streamId = result?.stream_id;
      if (!streamId) {
        throw new Error('Failed to start stream: no stream_id returned');
      }

      const unlisten = await listen<{
        streamId: string;
        event: string;
        content?: string;
        model?: string;
        error?: string;
        toolCallId?: string;
        toolCallName?: string;
        toolCallArgs?: string;
      }>('chat:stream-event', (tauriEvent) => {
        const payload = tauriEvent.payload;
        if (payload.streamId !== streamId) return;
        if (controller.signal.aborted) {
          unlisten();
          return;
        }

        const data: Record<string, string> = {};
        if (payload.content) data.content = payload.content;
        if (payload.model) data.model = payload.model;
        if (payload.error) data.error = payload.error;
        if (payload.toolCallId) data.id = payload.toolCallId;
        if (payload.toolCallName) data.name = payload.toolCallName;
        if (payload.toolCallArgs) data.args = payload.toolCallArgs;

        if (payload.event === 'thinking' && payload.content?.endsWith('\n__done__')) {
          data.content = payload.content.replace('\n__done__', '');
          data.done = 'true';
        }

        onEvent({ event: payload.event, data });

        if (payload.event === 'done') {
          unlisten();
          log.info('api', 'streamChat complete');
          onDone();
        } else if (payload.event === 'error') {
          unlisten();
          onError(new Error(payload.error || 'Unknown stream error'));
        }
      });

      controller.signal.addEventListener('abort', () => {
        unlisten();
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        log.error('api', 'streamChat error', { error: err.message || String(err) });
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return controller;
}

export function streamAgentTurn(
  input: AgentExecuteTurnInput,
  onEvent: (event: StreamEvent) => void,
  onDone: () => void,
  onError: (err: AgentTurnStreamError) => void,
  sourcePtid = '',
): AgentTurnStreamController {
  const controller = new AbortController() as AgentTurnStreamController;
  const streamId = input.stream_id || createAgentTurnStreamId();
  const streamGeneration = nextAgentTurnStreamGeneration();
  Object.defineProperty(controller, 'streamId', {
    value: streamId,
    enumerable: true,
  });
  Object.defineProperty(controller, 'streamGeneration', {
    value: streamGeneration,
    enumerable: true,
  });
  log.info('api', 'streamAgentTurn started', { conversationId: input.conversation_id, agentId: input.agent_id });
  let transportDisconnectRequested = false;
  let resolveTransportDisconnect = () => {};
  let rejectTransportDisconnect = (_error: Error) => {};
  const transportDisconnectCompletion = new Promise<void>((resolve, reject) => {
    resolveTransportDisconnect = resolve;
    rejectTransportDisconnect = reject;
  });
  let disconnectNativeTransport = (): Promise<void> => {
    transportDisconnectRequested = true;
    return transportDisconnectCompletion;
  };
  Object.defineProperty(controller, 'disconnectTransport', {
    value: () => {
      if (controller.signal.aborted) return Promise.resolve();
      return disconnectNativeTransport();
    },
    enumerable: true,
  });
  (async () => {
    let unlistenLive: (() => void) | undefined;
    let settled = false;
    let startCompleted = false;
    let transportCancellationSent = false;
    let capturedTurnId = '';
    const cleanup = () => {
      unlistenLive?.();
      unlistenLive = undefined;
    };
    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();
    };
    const cancelTransport = () => {
      if (!startCompleted || transportCancellationSent) return;
      transportCancellationSent = true;
      void api.cancelAgentTurnStream(streamId).catch((error) => {
        log.warn('api', 'Agent turn transport cancellation failed', {
          streamId,
          error: String(error),
        });
      });
    };
    const disconnectTransport = () => {
      if (!startCompleted || transportCancellationSent) {
        return transportDisconnectCompletion;
      }
      transportCancellationSent = true;
      void api.disconnectAgentTurnStream(streamId).catch((error) => {
        log.warn('api', 'Agent turn transport disconnect failed', {
          streamId,
          error: String(error),
        });
        rejectTransportDisconnect(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
      return transportDisconnectCompletion;
    };
    disconnectNativeTransport = () => {
      transportDisconnectRequested = true;
      return disconnectTransport();
    };
    const abortNativeStream = () => {
      cancelTransport();
      cleanup();
    };
    controller.signal.addEventListener('abort', abortNativeStream, { once: true });
    try {
      const { listen } = await import('@tauri-apps/api/event');
      let lastEventSeq = 0;
      let capturedConversationId = input.conversation_id || '';

      const forwardEvent = (payload: AgentTurnStreamPayload) => {
        const sourceData = payload.data || {};
        const data: Record<string, unknown> = {};
        Object.entries(sourceData).forEach(([key, value]) => {
          data[key] = value;
        });
        if (typeof sourceData.text === 'string') data.content = sourceData.text;
        if (typeof sourceData.result === 'string') data.content = sourceData.result;
        if (typeof sourceData.toolCallId === 'string') data.id = sourceData.toolCallId;
        if (typeof sourceData.toolName === 'string') data.name = sourceData.toolName;
        if (typeof sourceData.arguments === 'string') data.args = sourceData.arguments;
        if (typeof sourceData.stage === 'string') data.message = sourceData.stage;

        const seq = typeof sourceData.seq === 'number'
          ? sourceData.seq
          : typeof sourceData.seq === 'string'
            ? parseInt(sourceData.seq, 10)
            : 0;
        if (seq > 0 && seq > lastEventSeq) {
          lastEventSeq = seq;
        }
        const eventTurnId = typeof sourceData.turnId === 'string'
          ? sourceData.turnId
          : typeof sourceData.turn_id === 'string'
            ? sourceData.turn_id
            : '';
        if (eventTurnId) capturedTurnId = eventTurnId;
        if (payload.event === 'conversation_created' && typeof sourceData.conversation_id === 'string') {
          capturedConversationId = sourceData.conversation_id;
        }

        const event: StreamEvent = {
          event: payload.event,
          data: { ...data, streamGeneration },
          ptid: payload.ptid,
          sourceDelivery: createAgentTurnSourceDelivery(
            payload.event,
            sourceData,
            payload.ptid || sourcePtid,
            capturedConversationId || input.conversation_id,
            capturedTurnId,
          ),
        };
        publishAgentTurnRuntimeEvent(
          payload.streamId,
          streamGeneration,
          payload.ptid || '',
          capturedConversationId || input.conversation_id,
          input.agent_id,
          event,
        );
        onEvent(event);
      };

      unlistenLive = await listen<AgentTurnStreamPayload>('agent:turn-stream-event', (tauriEvent) => {
        const payload = tauriEvent.payload;
        if (payload.streamId !== streamId) return;
        if (controller.signal.aborted) {
          unlistenLive?.();
          return;
        }
        if (
          transportDisconnectRequested
          && payload.event !== 'connection_lost'
        ) {
          return;
        }
        forwardEvent(payload);
        if (payload.event === 'connection_lost' && payload.data?.recoveryHandoff === true) {
          resolveTransportDisconnect();
          cleanup();
          return;
        }
        const terminal = classifyAgentTurnTerminalEvent({
          event: payload.event,
          data: payload.data || {},
        });
        if (
          terminal === 'completed'
          || terminal === 'cancelled'
          || terminal === 'queued'
          || terminal === 'interrupted'
        ) {
          resolveTransportDisconnect();
          unlistenLive?.();
          unlistenLive = undefined;
          onDone();
          settle();
        }
        if (terminal === 'failed') {
          resolveTransportDisconnect();
          unlistenLive?.();
          unlistenLive = undefined;
          onError(agentTurnStreamErrorFromData(payload.data || {}));
          settle();
        }
      });

      if (controller.signal.aborted) {
        cleanup();
        return;
      }
      const result = await api.startAgentTurnStream({ ...input, stream_id: streamId });
      startCompleted = true;
      if (result?.stream_id !== streamId) {
        cleanup();
        throw new Error('agent.error.streamIdMismatch');
      }
      if (controller.signal.aborted) {
        abortNativeStream();
        return;
      }
      if (transportDisconnectRequested) {
        await disconnectTransport();
      }
    } catch (err: unknown) {
      if (transportDisconnectRequested) {
        rejectTransportDisconnect(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      cleanup();
      if (!settled) {
        const normalized = normalizeAgentTurnStreamError(err);
        if (normalized.typedError) {
          const sourceData: Record<string, unknown> = {
            ...normalized.typedError,
            conversationId: input.conversation_id,
            agentId: input.agent_id,
          };
          const event: StreamEvent = {
            event: 'error',
            data: { ...sourceData, streamGeneration },
            ptid: sourcePtid,
            sourceDelivery: createAgentTurnSourceDelivery(
              'error',
              sourceData,
              sourcePtid,
              input.conversation_id,
            ),
          };
          publishAgentTurnRuntimeEvent(
            streamId,
            streamGeneration,
            sourcePtid,
            input.conversation_id,
            input.agent_id,
            event,
          );
          onEvent(event);
        }
        onError(normalized);
      }
    }
  })();
  return controller;
}

export function streamAgentTurnReplay(
  input: Omit<AgentTurnReplayStreamInput, 'stream_id'>,
  onEvent: (event: StreamEvent) => void,
  onError: (error: Error) => void,
  sourcePtid = '',
): AbortController {
  const controller = new AbortController();
  const streamId = createAgentTurnStreamId();
  const streamGeneration = nextAgentTurnStreamGeneration();
  let catchupEstablished = false;
  let replayErrorReported = false;
  const clearCatchupDeadline = () => {
    globalThis.clearTimeout(catchupDeadline);
  };
  const deliverReplayEvent = (event: StreamEvent) => {
    const projectedEvent = {
      ...event,
      data: { ...event.data, streamGeneration },
    };
    // #region debug-point J-M:lease-replay-event
    reportLeaseReplayFetchDebug('J-M', 'replay-event', {
      eventType: projectedEvent.event,
      sequence: event.data.seq ?? event.data.sequence ?? null,
    });
    // #endregion
    const terminalStatus = classifyAgentTurnTerminalEvent(projectedEvent);
    if (
      projectedEvent.event === 'catchup_done'
      || (projectedEvent.event === 'snapshot' && terminalStatus !== null)
    ) {
      catchupEstablished = true;
      clearCatchupDeadline();
    }
    onEvent(projectedEvent);
  };
  const reportReplayError = (error: Error) => {
    if (replayErrorReported || controller.signal.aborted) return;
    replayErrorReported = true;
    clearCatchupDeadline();
    onError(error);
  };
  const catchupDeadline = globalThis.setTimeout(() => {
    if (catchupEstablished || controller.signal.aborted) return;
    // #region debug-point J-M:lease-replay-catchup-timeout
    reportLeaseReplayFetchDebug('J-M', 'catchup-timeout', {
      conversationId: input.conversation_id,
      turnId: input.turn_id,
      afterSequence: input.after_seq,
    });
    // #endregion
    reportReplayError(new Error('agent.error.replayCatchupTimeout'));
    controller.abort();
  }, AGENT_REPLAY_CATCHUP_TIMEOUT_MS);
  controller.signal.addEventListener('abort', clearCatchupDeadline, { once: true });


  void (async () => {
    let unlisten: (() => void) | undefined;
    let replayStarted = false;
    let cancellationSent = false;
    let liveTailEstablished = false;
    const cleanup = () => {
      unlisten?.();
      unlisten = undefined;
    };
    const cancelReplay = () => {
      cleanup();
      if (!replayStarted || cancellationSent) return;
      cancellationSent = true;
      void api.cancelAgentTurnReplayStream(streamId).catch((error) => {
        log.warn('api', 'Agent turn replay cancellation failed', {
          streamId,
          error: String(error),
        });
      });
    };
    controller.signal.addEventListener('abort', cancelReplay, { once: true });
    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<AgentTurnStreamPayload>(
        'agent:turn-stream-event',
        (tauriEvent) => {
          const payload = tauriEvent.payload;
          if (payload.streamId !== streamId || controller.signal.aborted) return;
          const event: StreamEvent = {
            event: payload.event,
            data: payload.data || {},
            ptid: payload.ptid,
            sourceDelivery: AGENT_REPLAY_CONTROL_EVENTS.has(payload.event)
              ? undefined
              : createAgentTurnSourceDelivery(
                  payload.event,
                  payload.data || {},
                  payload.ptid || sourcePtid,
                  input.conversation_id,
                  input.turn_id,
                ),
          };
          const terminalStatus = classifyAgentTurnTerminalEvent(event);
          const closesReplay = terminalStatus !== null
            && (liveTailEstablished || event.event === 'snapshot');
          if (event.event === 'catchup_done') {
            liveTailEstablished = true;
          }
          deliverReplayEvent(event);
          if (
            closesReplay
            || event.event === 'recovery_failed'
          ) {
            cleanup();
          }
          if (event.event === 'recovery_failed') {
            reportReplayError(new Error(String(event.data.error || 'agent.error.replayFailed')));
          }
        },
      );
      const result = await api.startAgentTurnReplayStream({
        ...input,
        stream_id: streamId,
      });
      replayStarted = true;
      if (result.stream_id !== streamId) {
        throw new Error('agent.error.streamIdMismatch');
      }
      if (controller.signal.aborted) {
        cancelReplay();
      }
    } catch (error) {
      cleanup();
      if (!controller.signal.aborted) {
        reportReplayError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  })();
  return controller;
}

export function streamAgentCollaborationEvents(
  agentId: string,
  onEvent: (payload: AgentCollaborationStreamPayload) => void,
  onError: (err: Error) => void,
  options: { taskId?: string; afterEventSeq?: number } = {},
): AbortController {
  const controller = new AbortController();
  (async () => {
    let unlisten: (() => void) | undefined;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const streamId = `agent-collaboration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      unlisten = await listen<AgentCollaborationStreamPayload>('agent:collaboration-event', (tauriEvent) => {
        const payload = tauriEvent.payload;
        if (payload.streamId !== streamId) return;
        if (controller.signal.aborted) {
          unlisten?.();
          return;
        }
        if (payload.event === 'error') {
          onError(new Error(String(payload.data?.error || 'agent.canvas.streamFailed')));
          return;
        }
        onEvent(payload);
      });

      const result = await api.startAgentCollaborationStream({
        stream_id: streamId,
        agent_id: agentId,
        task_id: options.taskId,
        after_event_seq: options.afterEventSeq ?? 0,
      });
      if (result?.stream_id !== streamId) {
        unlisten();
        throw new Error('agent.canvas.streamIdMismatch');
      }
      if (controller.signal.aborted) {
        api.cancelAgentCollaborationStream(streamId).catch((error) => {
          log.warn('api', 'streamAgentCollaborationEvents cancel failed', { error: String(error) });
        });
        unlisten();
        return;
      }
      controller.signal.addEventListener('abort', () => {
        api.cancelAgentCollaborationStream(streamId).catch((error) => {
          log.warn('api', 'streamAgentCollaborationEvents cancel failed', { error: String(error) });
        });
        unlisten?.();
      }, { once: true });
    } catch (err: unknown) {
      unlisten?.();
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return controller;
}

export function streamAgentAuthorityEvents(
  agentId: string,
  onEvent: (payload: AgentAuthorityStreamPayload) => void,
  onError: (error: Error) => void,
): AbortController {
  const controller = new AbortController();
  void (async () => {
    let unlisten: (() => void) | undefined;
    const streamId = `agent-authority-${agentId}-${crypto.randomUUID()}`;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<AgentAuthorityStreamPayload>(
        'agent:event',
        (tauriEvent) => {
          const payload = tauriEvent.payload;
          if (payload.streamId !== streamId || controller.signal.aborted) return;
          if (payload.event === 'error') {
            const detail =
              typeof payload.data.error === 'string'
                ? payload.data.error
                : 'agent.capabilityEventStreamFailed';
            onError(new Error(detail));
            return;
          }
          onEvent(payload);
        },
      );
      const result = await api.startAgentEventStream(agentId, streamId);
      if (result.stream_id !== streamId) {
        throw new Error('agent.capabilityEventStreamIdentityMismatch');
      }
      if (controller.signal.aborted) {
        await api.cancelAgentEventStream(streamId);
        unlisten();
        return;
      }
      controller.signal.addEventListener('abort', () => {
        void api.cancelAgentEventStream(streamId).catch((error) => {
          log.warn('api', 'agent event stream cancellation failed', {
            error: String(error),
          });
        });
        unlisten?.();
      }, { once: true });
    } catch (error) {
      unlisten?.();
      if (!controller.signal.aborted) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  })();
  return controller;
}

export const executeAgentTurn = streamAgentTurn;

// ---------------------------------------------------------------------------
// Agent Growth APIs
// ---------------------------------------------------------------------------

export interface GrowthSnapshot {
  agent_id: string;
  total_memories: number;
  total_skills: number;
  total_reviews: number;
  total_turns: number;
  positive_feedback: number;
  negative_feedback: number;
  feedback_ratio: number;
  error_rate: number;
  growth_score: number;
  growth_verdict: string;
  window_start: string;
  window_end: string;
}

export interface MemoryItem {
  id: string;
  agent_id: string;
  target: string;
  content: string;
  source: string;
  is_frozen: boolean;
  trust_score: number;
  retrieval_count: number;
  helpful_count: number;
  harmful_count: number;
  created_at: string;
  updated_at: string;
}

export interface SkillItem {
  id: string;
  agent_id: string;
  name: string;
  description: string;
  category: string;
  trust_level: string;
  scan_verdict: string;
  enabled: boolean;
  version: number;
  view_count: number;
  apply_count: number;
  patch_count: number;
  last_used_at: string | null;
  created_at: string;
}

export async function getAgentGrowthSnapshot(agentId: string): Promise<GrowthSnapshot> {
  const result = await invokeRustDataFromStatus<{ agent_id: string }, GrowthSnapshot>(
    'agent_growth_snapshot',
    { agent_id: agentId },
  );
  return result;
}

export async function getAgentMemories(agentId: string): Promise<MemoryItem[]> {
  const result = await invokeRustDataFromStatus<{ agent_id: string }, MemoryItem[]>(
    'agent_memory_list',
    { agent_id: agentId },
  );
  return result;
}

export async function getAgentSkills(agentId: string): Promise<SkillItem[]> {
  const result = await invokeRustDataFromStatus<{ agent_id: string }, SkillItem[]>(
    'agent_skill_list',
    { agent_id: agentId },
  );
  return result;
}

export async function submitAgentFeedback(
  agentId: string,
  turnId: string,
  conversationId: string,
  signal: 'positive' | 'negative',
  comment?: string,
  options?: {
    assistantMessageId?: string;
    categories?: string[];
    idempotencyKey?: string;
    source?: string;
  },
): Promise<RecordFeedbackResponse> {
  return invokeRustProto('agent_submit_feedback', RecordFeedbackResponseSchema, {
    agent_id: agentId,
    turn_id: turnId,
    conversation_id: conversationId,
    assistant_message_id: options?.assistantMessageId ?? '',
    signal,
    source: options?.source ?? 'message_action',
    rating: signal === 'positive' ? 1 : -1,
    categories: options?.categories ?? [],
    comment: comment ?? null,
    idempotency_key: options?.idempotencyKey ?? crypto.randomUUID(),
  });
}

export async function listAgentTurnFeedback(turnId: string): Promise<ListTurnFeedbackResponse> {
  return invokeRustProto(
    'agent_list_turn_feedback',
    ListTurnFeedbackResponseSchema,
    { turn_id: turnId },
  );
}

export async function exportAgentTurnDiagnostics(turnId: string): Promise<ExportTurnDiagnosticsResponse> {
  return invokeRustProto(
    'agent_turn_diagnostics_export',
    ExportTurnDiagnosticsResponseSchema,
    { turn_id: turnId },
  );
}

export async function agentQuickCompletion(agentId: string, prompt: string): Promise<string> {
  const result = await invokeRustDataFromStatus<
    { agent_id: string; prompt: string },
    { ok: boolean; content: string }
  >('agent_quick_completion', { agent_id: agentId, prompt });
  return result.content ?? '';
}

// ---------------------------------------------------------------------------
// Agent Scheduler (Autonomous Learning)
// ---------------------------------------------------------------------------

export interface SchedulerJobInfo {
  kind: string;
  agent_id: string;
  enabled: boolean;
  interval: string;
  last_run_at: string | null;
  last_status: string | null;
  run_count: number;
}

export interface SchedulerStatusResponse {
  running: boolean;
  jobs: SchedulerJobInfo[];
  started_at: string | null;
}

export async function startAgentScheduler(
  agentId: string,
  reviewIntervalMinutes?: number,
  dogfoodIntervalMinutes?: number,
): Promise<void> {
  await invokeRustDataFromStatus('agent_scheduler_start', {
    agent_id: agentId,
    review_interval_minutes: reviewIntervalMinutes ?? 120,
    dogfood_interval_minutes: dogfoodIntervalMinutes ?? 360,
  });
}

export async function stopAgentScheduler(): Promise<void> {
  await invokeRustDataFromStatus('agent_scheduler_stop', {});
}

export async function getAgentSchedulerStatus(): Promise<SchedulerStatusResponse> {
  return invokeRustDataFromStatus<object, SchedulerStatusResponse>(
    'agent_scheduler_status',
    {},
  );
}

export async function addAgentSchedulerJob(
  kind: string,
  agentId: string,
  intervalMinutes?: number,
): Promise<void> {
  await invokeRustDataFromStatus('agent_scheduler_add_job', {
    kind,
    agent_id: agentId,
    interval_minutes: intervalMinutes ?? 60,
  });
}
