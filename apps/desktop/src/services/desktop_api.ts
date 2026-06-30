import { invoke } from '@tauri-apps/api/core';
import { fromBinary } from '@bufbuild/protobuf';
import type { Message as ProtoMessage } from '@bufbuild/protobuf';
import type { GenMessage } from '@bufbuild/protobuf/codegenv2';
import { log } from '../utils/logger';
import { eventBus } from '../kernel/events/bus';
import { EVENT } from '../kernel/events/catalog';
import { readDesktopPreferenceSync } from '../storage/desktopClientStorage';
import type {
  AgentTurnStreamEventPayload,
  RealtimeCallSignalKind,
  SessionRevokedPayload,
} from '../kernel/events/types';
import {
  GetSessionsResponseSchema,
  CreateSessionResponseSchema,
  GetFriendConversationSettingsResponseSchema,
  UpdateFriendConversationSettingsResponseSchema,
  GetMessagesResponseSchema,
  SendMessageResponseSchema,
  MessageAckResponseSchema,
  RecallFriendMessageResponseSchema,
  EditFriendMessageResponseSchema,
  DeleteFriendMessageResponseSchema,
  SyncMessagesResponseSchema,
  GetPendingResponseSchema,
  GetStatsResponseSchema,
  SendFriendRequestResponseSchema,
  AcceptFriendRequestResponseSchema,
  RejectFriendRequestResponseSchema,
  ListFriendRequestsResponseSchema,
  BlockUserResponseSchema,
  UnblockUserResponseSchema,
  ListBlockedUsersResponseSchema,
  GetFriendshipStatusResponseSchema,
} from '../gen/proto/domain/chat/friend_chat_pb';
import {
  ListGroupsResponseSchema,
  GetGroupMessagesResponseSchema,
  SendGroupMessageResponseSchema,
  GetUnreadCountResponseSchema,
  MarkGroupReadResponseSchema,
  CreateGroupResponseSchema,
  GetGroupResponseSchema,
  UpdateGroupResponseSchema,
  InviteToGroupResponseSchema,
  JoinGroupResponseSchema,
  LeaveGroupResponseSchema,
  TransferGroupOwnershipResponseSchema,
  DissolveGroupResponseSchema,
  GetGroupMembersResponseSchema,
  RemoveMemberResponseSchema,
  UpdateMemberResponseSchema,
  RecallGroupMessageResponseSchema,
  EditGroupMessageResponseSchema,
  DeleteGroupMessageResponseSchema,
  SearchGroupMessagesResponseSchema,
  UpdateMyNicknameResponseSchema,
  GetGroupSettingsResponseSchema,
  UpdateGroupSettingsResponseSchema,
  GetOfflineMessagesResponseSchema,
  AckOfflineMessagesResponseSchema,
  GetGroupStatsResponseSchema,
} from '../gen/proto/domain/chat/group_chat_pb';
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
import type {
  GetTurnTraceResponse,
  ListTurnTracesResponse,
} from '../gen/proto/domain/agent/agent_pb';
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
  Friend,
} from '../gen/proto/domain/chat/chat_pb';
export type {
  FriendChatSession,
  FriendChatMessage,
  GetSessionsResponse,
  CreateSessionResponse,
  GetMessagesResponse,
  SendMessageResponse,
  SyncMessagesResponse,
  GetPendingResponse,
  PendingMessageInfo,
  GetStatsResponse,
  ListBlockedUsersResponse,
} from '../gen/proto/domain/chat/friend_chat_pb';
export type {
  Group,
  GroupMessage,
  ListGroupsResponse,
  GetGroupMessagesResponse,
  SendGroupMessageResponse,
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
  'oss_upload_attachment_bytes_chat',
  'ice_session_candidates_get',
  'ice_session_candidate_post',
  'ice_session_offer_get',
  'ice_session_offer_post',
  'ice_session_answer_get',
  'ice_session_answer_post',
  'ice_peer_register',
  'notification_list',
  'applets_action',
  'applets_invoke',
  'applets_set_config',
]);

// Quiet only in production. In dev we want timing for these so we can
// debug cold-start performance ("first chat tab click is slow") and the
// 60s background sync loop. Toggle through the desktop config preference store.
// if the noise becomes a problem during a specific session.
const PROD_QUIET_COMMANDS = new Set([
  'friend_chat_sync_from_station_scoped',
  'friend_chat_list_sessions',
  'friend_chat_list_messages',
  'chat_index_local_messages',
]);

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
  const details = error?.details as any;
  const reasonFromDetails = typeof details?.reason === 'string' ? details.reason : undefined;
  if (error?.code !== 'UNAUTHORIZED') return null;
  if (typeof details?.code === 'string' && details.code === 'session_revoked') {
    return {
      reason: (reasonFromDetails as any) || 'unknown',
      raw: typeof details?.raw === 'string' ? details.raw : undefined,
    };
  }
  return {
    reason: (reasonFromDetails as any) || 'expired',
    raw: error.message,
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
  try {
    const payload = input === undefined ? undefined : { input };
    const result = await invoke<RustCommandResult<TData>>(command, payload);
    const elapsed = Date.now() - start;
    if (!result.ok) {
      const revoked = extractSessionRevoked(result.error);
      if (revoked) {
        publishSessionRevoked(revoked);
        if (!quiet) {
          log.info('api', `← ${command} UNAUTHORIZED (${elapsed}ms)`, { reason: revoked.reason });
        }
        return result;
      }
      // Surface `details.reason` from the Rust side so we don't have to
      // round-trip to the binary just to read why a command failed.
      const detailsReason = (result.error?.details as any)?.reason;
      log.warn('api', `← ${command} FAIL (${elapsed}ms)`, {
        error: result.error?.message,
        code: result.error?.code,
        ...(detailsReason ? { reason: detailsReason } : {}),
      });
    } else if (!quiet) {
      log.info('api', `← ${command} OK (${elapsed}ms)`);
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

export async function invokeRustProto<TInput, TMsg extends ProtoMessage>(
  command: string,
  schema: GenMessage<TMsg>,
  input?: TInput,
): Promise<TMsg> {
  const response = await invokeRustCommand<TInput, number[]>(command, input);
  if (response.ok && response.data) {
    const bytes = new Uint8Array(response.data);
    return fromBinary(schema, bytes);
  }
  if (response.error?.code === 'UNAUTHORIZED') {
    throw new AuthCommandException(response.error);
  }
  throw new Error(response.error?.message || `${command} failed`);
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

function parseOAuthCallbackFromUrl(urlText: string): OAuthCallbackInput | null {
  const url = new URL(urlText);
  const provider = url.searchParams.get('provider') || '';
  const providerUserId = url.searchParams.get('provider_user_id') || '';
  if (!provider || !providerUserId) return null;
  const createdAt = url.searchParams.get('created_at')
    || url.searchParams.get('createdAt')
    || url.searchParams.get('register_time')
    || undefined;
  return {
    provider,
    provider_user_id: providerUserId,
    username: url.searchParams.get('username') || undefined,
    display_name: url.searchParams.get('display_name') || undefined,
    created_at: createdAt,
    email: url.searchParams.get('email') || undefined,
    avatar_url: url.searchParams.get('avatar_url') || undefined,
    profile_url: url.searchParams.get('profile_url') || undefined,
    expires_at: url.searchParams.get('expires_at') || undefined,
  };
}

/**
 * Wire form for presence triggers (mirrors `domain::presence::PresenceTrigger`
 * in the Rust crate). Frontend modules emit one of these strings; the Rust
 * supervisor decides whether the trigger warrants a reconcile.
 */
export type PresenceTrigger =
  | 'app_launch'
  | 'app_foreground'
  | 'app_background'
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
  actor_id: string;
  from: 'offline' | 'online';
  to: 'offline' | 'online';
  trigger: PresenceTrigger;
  reconciled_count: number;
  affected_sessions: string[];
}

/**
 * Input for `oss_upload_attachment_chat` (field names match the Rust
 * `OssUploadAttachmentInput`). Chat uploads always carry a `bucket`
 * and `visibility`; `chat_session_id` is required when
 * `visibility === 'chat'` and ignored otherwise.
 */
export interface ChatUploadAttachmentInput {
  file_path: string;
  bucket: string;
  visibility: 'public' | 'chat' | 'private';
  /** Required when `visibility` is `chat`. */
  chat_session_id?: string | null;
}

export interface ChatScreenshotAttachmentInput {
  bucket: string;
  visibility: 'public' | 'chat' | 'private';
  /** Required when `visibility` is `chat`. */
  chat_session_id?: string | null;
}

export interface ChatUploadAttachmentBytesInput {
  filename: string;
  mime_type: string;
  bytes: number[];
  bucket: string;
  visibility: 'public' | 'chat' | 'private';
  /** Required when `visibility` is `chat`. */
  chat_session_id?: string | null;
}

/**
 * Payload returned by `oss_upload_attachment_chat` /
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
  owner_actor_id: string;
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
  model_override?: string;
  created_at: string;
  updated_at: string;
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

export interface AgentParams {
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
}

export interface AgentMemoryConfig {
  enabled?: boolean;
  effort?: 'low' | 'medium' | 'high';
}

export interface AgentWorkspaceConfig {
  root?: string;
  policy?: 'workspace-only';
  updatedAt?: string;
}

export interface AgentProviderFallbackConfig {
  enabled?: boolean;
  maxRetries?: number;
}

export interface AgentVoiceConfig {
  ttsProvider?: 'browser' | 'edge' | 'openai';
  ttsVoice?: string;
  ttsSpeed?: number;
  ttsAutoRead?: boolean;
  sttProvider?: 'browser' | 'openai';
  sttLanguage?: string;
  sttAutoStop?: boolean;
}

export type AgentKnowledgeResourceType = 'document' | 'folder' | 'project' | 'url' | 'notebook' | 'workspace';
export type AgentKnowledgeResourcePolicy = 'manual' | 'auto' | 'always' | 'disabled';
export type AgentKnowledgeResourceStatus = 'bound' | 'pending_index' | 'indexed' | 'error';

export interface AgentKnowledgeResource {
  id: string;
  type: AgentKnowledgeResourceType;
  title: string;
  source: string;
  policy: AgentKnowledgeResourcePolicy;
  status: AgentKnowledgeResourceStatus;
  lastIndexedAt?: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
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
  voice?: AgentVoiceConfig;
  mcpServers?: string[];
  tools?: string[];
  skills?: string[];
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
  visibility: string;
  isolationEnabled: boolean;
  isolationMode: string;
  isolationRetentionDays: number;
  workspaceMode: string;
  runtimeBackend: string;
  rootfsPath: string;
  allowedRoots: string;
  cliCommand: string;
  tags: string;
  toolsProfile: string;
  toolsAllow: string;
  toolsDeny: string;
  pinned: boolean;
  favorite: boolean;
  sortOrder: number;
  openingMessage: string;
  openingQuestions: string;
  chatConfig: string;
  params: string;
  knowledgeResources: string;
  isDefault: boolean;
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
  visibility?: string;
  isolationEnabled?: boolean;
  isolationMode?: string;
  isolationRetentionDays?: number;
  workspaceMode?: string;
  runtimeBackend?: string;
  rootfsPath?: string;
  allowedRoots?: string;
  cliCommand?: string;
  tags?: string;
  toolsProfile?: string;
  toolsAllow?: string;
  toolsDeny?: string;
  pinned?: boolean;
  favorite?: boolean;
  sortOrder?: number;
  openingMessage?: string;
  openingQuestions?: string;
  chatConfig?: string;
  params?: string;
  knowledgeResources?: string;
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

export interface AgentPackage {
  schemaVersion: 'peers.agent.package.v1';
  exportedAt: string;
  source: {
    agentId: string;
    name: string;
    packageType?: 'agent';
    exportedFrom?: 'desktop' | string;
    sharePolicy?: {
      includeLocalPaths?: boolean;
      secrets?: 'redacted' | string;
    };
    redactions?: string[];
  };
  agent: Agent;
  providerPreset: {
    provider: string;
    model: string;
    params: AgentParams;
  };
  bindings: {
    mcpServers: string[];
    tools: string[];
    skills: string[];
  };
  opening: {
    message: string;
    questions: string;
  };
  chatBehavior: AgentChatConfig;
}

export interface AgentPackageImportInput {
  package: AgentPackage | Record<string, unknown>;
  name?: string;
}

export interface AgentListResult {
  agents: Agent[];
  selectedAgent?: string;
  defaultAgent?: string;
}

export function parseAgentChatConfig(agent: Agent): AgentChatConfig {
  if (!agent.chatConfig) return {};
  try { return JSON.parse(agent.chatConfig); } catch { return {}; }
}

export function parseAgentParams(agent: Agent): AgentParams {
  if (!agent.params) return {};
  try { return JSON.parse(agent.params); } catch { return {}; }
}

function normalizeKnowledgeResource(raw: unknown): AgentKnowledgeResource | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<AgentKnowledgeResource>;
  const source = typeof item.source === 'string' ? item.source.trim() : '';
  if (!source) return null;
  const id = typeof item.id === 'string' && item.id.trim()
    ? item.id.trim()
    : `knowledge:${Date.now()}:${source}`;
  const typeValues: AgentKnowledgeResourceType[] = ['document', 'folder', 'project', 'url', 'notebook', 'workspace'];
  const policyValues: AgentKnowledgeResourcePolicy[] = ['manual', 'auto', 'always', 'disabled'];
  const statusValues: AgentKnowledgeResourceStatus[] = ['bound', 'pending_index', 'indexed', 'error'];
  const type = typeValues.includes(item.type as AgentKnowledgeResourceType)
    ? item.type as AgentKnowledgeResourceType
    : 'document';
  const policy = policyValues.includes(item.policy as AgentKnowledgeResourcePolicy)
    ? item.policy as AgentKnowledgeResourcePolicy
    : 'manual';
  const status = statusValues.includes(item.status as AgentKnowledgeResourceStatus)
    ? item.status as AgentKnowledgeResourceStatus
    : 'bound';
  return {
    id,
    type,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : source,
    source,
    policy,
    status,
    lastIndexedAt: typeof item.lastIndexedAt === 'string' ? item.lastIndexedAt : '',
    error: typeof item.error === 'string' ? item.error : '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
  };
}

export function parseAgentKnowledgeResources(agent: Agent): AgentKnowledgeResource[] {
  if (!agent.knowledgeResources) return [];
  try {
    const parsed = JSON.parse(agent.knowledgeResources);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeKnowledgeResource)
      .filter((item): item is AgentKnowledgeResource => Boolean(item));
  } catch {
    return [];
  }
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
  executionOwner?: 'desktop-rust' | 'station' | string;
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
  function_call?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  search?: boolean;
  image_output?: boolean;
  video?: boolean;
  protocol_override?: string;
  runtime_kind?: 'cli' | 'direct';
  cli_command?: string;
}

export interface ProviderListItem {
  id: string;
  name: string;
  description: string;
  logo?: string;
  enabled: boolean;
  builtin: boolean;
  has_api_key: boolean;
  runtime_kind: 'cli' | 'direct';
}

export interface ModelItem {
  id: string;
  display_name: string;
  type: string;
  enabled: boolean;
  context_window: number;
  function_call?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  search?: boolean;
  image_output?: boolean;
  video?: boolean;
}

export interface ProviderDetail extends ProviderListItem {
  home_url: string;
  api_key_url: string;
  api_key: string;
  base_url: string;
  default_base_url: string;
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
  actorId?: string;
  actor_id?: string;
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
  url: string;
  branch?: string;
}

export interface MarketSummary extends MarketSource {
  skillCount: number;
  lastSynced?: string;
  synced: boolean;
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

// ── MCP Server types ──

export interface MCPServerItem {
  name: string;
  title: string;
  description: string;
  type: 'stdio' | 'http' | 'sse';
  source: string;
  enabled: boolean;
  metaAvatar: string;
  metaTags: string[];
  toolCount: number;
  status?: 'unknown' | 'connected' | 'failed';
  lastTestedAt?: string;
  lastError?: string;
}

export interface MCPServerRecord {
  name: string;
  title: string;
  description: string;
  version: string;
  type: 'stdio' | 'http' | 'sse';
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  authType: string;
  authToken: string;
  authAccessToken: string;
  configSchema: Record<string, unknown>;
  settings: Record<string, string>;
  metaAvatar: string;
  metaTags: string[];
  source: string;
  homepage: string;
  repository: string;
  enabled: boolean;
  status?: 'unknown' | 'connected' | 'failed';
  lastTestedAt?: string;
  lastError?: string;
  tools?: string[];
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
  slot: string;
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
  status: 'active' | 'expired' | 'error';
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
  actor_id?: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  avatar_local_path?: string;
  login_method?: string;
}

export const DESKTOP_TAURI_CONTRACT_VERSION = '2026-03-24.desktop-tauri-rust.v1';

export interface AuthLoginInput {
  account: string;
  password: string;
  base_url?: string;
}

/// Raw Station `AccessDecision`, passed through verbatim by the Rust layer.
/// The frontend normalizes the wire shape (snake_case keys, string enums).
export interface AccessDecisionResponse extends TauriStubPayload {
  decision: unknown;
}

export interface AccessSubmitInviteInput {
  attempt_id: string;
  invite_code: string;
}

export interface AccessSubmitLoginInput {
  attempt_id: string;
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
}

export interface AccountProfileLink {
  label: string;
  url: string;
}

export interface AccountProfile {
  id: string;
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
  cli_command?: string;
  protocol?: string;
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
  cli_command?: string;
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

export interface McpExecuteToolInput {
  server_name: string;
  tool_name: string;
  arguments?: Record<string, unknown>;
  call_id?: string;
  workspace_root?: string;
  allowed_roots?: string[];
}

export interface McpToolExecutionResult {
  ok: boolean;
  serverName: string;
  toolName: string;
  callId: string;
  arguments: Record<string, unknown>;
  durationMs: number;
  output?: unknown;
  error?: string;
  audit: {
    source: 'mcp';
    serverName: string;
    toolName: string;
    transport: 'stdio' | 'http' | 'sse';
    workspaceRoot?: string;
    allowedRootCount?: number;
    policyDecision?: 'allow' | 'deny';
    executedAt: string;
  };
}

export interface AgentLocalToolRequestInput {
  source: 'mcp' | string;
  server_name?: string;
  tool_name: string;
  arguments?: Record<string, unknown>;
  call_id?: string;
  turn_id?: string;
  workspace_root?: string;
  allowed_roots?: string[];
}

export interface AgentToolApprovalDecisionInput {
  approval_id: string;
  approved: boolean;
  actor?: string;
}

export interface AgentLocalToolResultEvent {
  type: 'tool_result';
  turnId: string;
  callId: string;
  source: string;
  serverName: string;
  toolName: string;
  status: 'success' | 'error';
  data: unknown;
  trace: {
    owner: 'desktop-rust';
    bridge: string;
    audit: Record<string, unknown>;
  };
}

export interface AgentExecuteTurnInput {
  stream_id?: string;
  conversation_id: string;
  agent_id: string;
  user_input: string;
  attachments?: ChatAttachmentInput[];
  provider?: string;
  model?: string;
  cli_command?: string;
  workspace_mode?: string;
  runtime_backend?: string;
  rootfs_path?: string;
  allowed_roots?: string[];
  identity?: string;
  agent_config_prompt?: string;
  effort?: string;
  platform?: string;
  workspace_root?: string;
  context_window_size?: number;
  max_retries?: number;
  knowledge_resources?: AgentExecuteTurnKnowledgeResource[];
}

function createAgentTurnStreamId(): string {
  const randomId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `agent-turn-${randomId}`;
}

export interface AgentExecuteTurnKnowledgeResource {
  resource_id: string;
  agent_id: string;
  type: number;
  title: string;
  source: string;
  policy: number;
  status: number;
  last_indexed_at?: string;
}

export interface AgentTurnStreamCancelInput {
  stream_id: string;
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

export interface AgentTurnStreamPayload {
  streamId: string;
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
}

export interface OAuthLoopbackPollInput {
  session_id: string;
}

export interface OAuthCallbackInput {
  provider: string;
  provider_user_id: string;
  username?: string;
  display_name?: string;
  created_at?: string;
  email?: string;
  avatar_url?: string;
  profile_url?: string;
  expires_at?: string;
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
  actorId?: string;
  name?: string;
  email?: string;
  loginMethod?: string;
  mode?: 'product-shell';
}

export interface AppletProductWindowRenderedInput {
  appletId: string;
  readySource?: 'lifecycle.reportReady' | 'host-render-fallback' | string;
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
  url: string;
  name?: string;
  branch?: string;
}

export interface SkillMarketSyncInput {
  market_id: string;
}

export interface SkillMarketListInput {
  market_id: string;
  q?: string;
}

export interface SkillMarketDetailInput {
  agent_id?: string;
  market_id: string;
  file_path: string;
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

export interface FriendChatSyncInput {
  session_ulid: string;
  limit?: number;
  max_pages?: number;
}

export interface ChatSearchLocalResultRow {
  scope: string;
  conversation_id: string;
  message_id: string;
  sender_did: string;
  content: string;
  sent_at: number;
  message_type?: number;
  type?: number;
  reply_to_ulid?: string;
  replyToUlid?: string;
  thread_root_ulid?: string;
  threadRootUlid?: string;
  attachments?: unknown[];
  filename?: string;
  mime_type?: string;
}

export interface ChatIndexLocalMessageInput {
  scope: 'friend' | 'group';
  conversation_id: string;
  message_id: string;
  sender_did: string;
  content: string;
  reply_to_ulid?: string;
  thread_root_ulid?: string;
  sent_at: number;
}

export interface GroupChatSyncInput {
  group_ulid: string;
  limit?: number;
  max_pages?: number;
}

export interface ChatLocalSearchInput {
  query: string;
  limit?: number;
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
  active_url: string;
}

export interface StationProbeResult {
  url: string;
  online: boolean;
  label?: string;
  peer_id?: string;
  peers_count?: number;
  error?: string;
}

export const api = {
  authLogin: (input: AuthLoginInput) =>
    invokeAuthCommand<AuthLoginInput>('auth_login', input),

  accessStart: () =>
    invokeAccessCommand<void>('access_start'),

  accessSubmitInviteCode: (input: AccessSubmitInviteInput) =>
    invokeAccessCommand<AccessSubmitInviteInput>('access_submit_invite_code', input),

  accessSubmitLogin: (input: AccessSubmitLoginInput) =>
    invokeAuthCommand<AccessSubmitLoginInput>('access_submit_login', input),

  authLogout: () =>
    invokeAuthCommand<void>('auth_logout'),

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

  chatListConversations: () =>
    invokeRustCommand<void, TauriStubPayload>('chat_list_conversations'),

  chatListMessages: (input: ChatListMessagesInput) =>
    invokeRustCommand<ChatListMessagesInput, TauriStubPayload>('chat_list_messages', input),

  chatSendMessage: (input: ChatSendMessageInput) =>
    invokeRustCommand<ChatSendMessageInput, TauriStubPayload>('chat_send_message', input),

  chatMarkRead: (input: ChatMarkReadInput) =>
    invokeRustCommand<ChatMarkReadInput, TauriStubPayload>('chat_mark_read', input),

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

  // Fetch a peer actor's public profile by DID (numeric actor id).
  // Used by Contacts/Chat detail panels to render rich peer profile cards.
  peerProfileGet: (did: string) =>
    invokeRustDataFromStatus<{ did: string }, AccountProfile>('peer_profile_get', { did }),

  profileUpdate: (input: ProfileUpdateInput) =>
    invokeRustDataFromStatus<ProfileUpdateInput, AccountProfile>('profile_update', input),

  profileUploadAvatar: (input: FileUploadInput) =>
    invokeRustCommand<FileUploadInput, TauriStubPayload>('profile_upload_avatar', input),

  profileUploadHeader: (input: FileUploadInput) =>
    invokeRustCommand<FileUploadInput, TauriStubPayload>('profile_upload_header', input),

  profileUploadAvatarOss: (input: FileUploadInput) =>
    invokeRustDataFromStatus<FileUploadInput, AccountProfile>('profile_upload_avatar_oss', input),

  profileUploadHeaderOss: (input: FileUploadInput) =>
    invokeRustDataFromStatus<FileUploadInput, AccountProfile>('profile_upload_header_oss', input),

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
  ossPickAttachmentChat: async (): Promise<string> => {
    const response = await invokeRustCommand<void, TauriStubPayload>(
      'oss_pick_attachment_chat',
    );
    if (response.ok && response.data?.status) {
      return response.data.status;
    }
    throw new Error(
      response.error?.message || 'oss_pick_attachment_chat failed',
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
  ossUploadAttachmentChat: (input: ChatUploadAttachmentInput) =>
    invokeRustDataFromStatus<ChatUploadAttachmentInput, OssAttachmentUploaded>(
      'oss_upload_attachment_chat',
      input,
    ),

  ossUploadAttachmentBytesChat: (input: ChatUploadAttachmentBytesInput) =>
    invokeRustDataFromStatus<ChatUploadAttachmentBytesInput, OssAttachmentUploaded>(
      'oss_upload_attachment_bytes_chat',
      input,
    ),

  ossUploadEncryptedAttachmentChat: (input: ChatUploadAttachmentInput) =>
    invokeRustDataFromStatus<ChatUploadAttachmentInput, SocialEncryptedAttachmentUploaded>(
      'oss_upload_encrypted_attachment_chat',
      input,
    ),

  ossCaptureScreenshotChat: (input: ChatScreenshotAttachmentInput) =>
    invokeRustDataFromStatus<ChatScreenshotAttachmentInput, OssAttachmentUploaded>(
      'oss_capture_screenshot_chat',
      input,
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

  exportAgentPackage: (id: string, options?: { includeLocalPaths?: boolean }) =>
    invokeRustDataFromStatus<AgentIdInput, { package: AgentPackage }>('agents_export_package', {
      id,
      includeLocalPaths: Boolean(options?.includeLocalPaths),
    })
      .then((r) => r.package),

  importAgentPackage: (pkg: AgentPackage | Record<string, unknown>, name?: string) =>
    invokeRustDataFromStatus<AgentPackageImportInput, Agent>('agents_import_package', {
      package: pkg,
      name,
    }),

  searchAgents: (q: string) =>
    invokeRustDataFromStatus<AgentSearchInput, { agents: Agent[] }>('agents_search', { q }).then((r) => r.agents),

  listAgentSessions: (id: string) =>
    invokeRustDataFromStatus<AgentIdInput, { sessions: (Session & { agent_id?: string })[] }>(
      'agents_list_sessions',
      { id },
    ).then((r) =>
      r.sessions.map((s) => ({ ...s, agent_name: s.agent_name ?? s.agent_id ?? '' })),
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

  listTools: () =>
    invokeRustDataFromStatus<void, { tools: ToolInfo[] }>('tools_list').then((r) => r.tools),

  listSearchProviders: () =>
    invokeRustDataFromStatus<void, { providers: SearchProviderInfo[]; primary: string }>('tools_search_providers'),

  setSearchPrimary: (provider: string) =>
    invokeRustDataFromStatus<SearchPrimaryInput, { ok: boolean; primary: string }>('tools_set_search_primary', {
      provider,
    }),

  listAvailableModels: async () => {
    const r = await invokeRustDataFromStatus<void, { providers?: any[] }>('provider_list_available_models');
    const models: AvailableModel[] = (r.providers || []).flatMap((p) => {
      const cfg = parseJSONSafe(p.config_json);
      const runtimeKind = String(cfg.runtime_kind || cfg.runtimeKind || cfg.runtime || '').trim().toLowerCase();
      const cliCommand = String(cfg.cli_command || cfg.cliCommand || '').trim();
      const normalizedRuntimeKind = runtimeKind === 'cli' || cliCommand ? 'cli' : 'direct';
      const providerModels = Array.isArray(p.models) ? p.models : [];
      if (providerModels.length > 0) {
        return providerModels.map((model: any) => ({
          id: model.id || p.check_model || `${p.id}:default`,
          display_name: model.display_name || model.id || p.check_model || `${p.id}:default`,
          provider_id: p.id,
          provider_name: p.name || p.id,
          type: model.type || 'chat',
          context_window: Number(model.context_window || 0),
          enabled: Boolean(model.enabled !== false),
          function_call: Boolean(model.function_call),
          vision: Boolean(model.vision),
          reasoning: Boolean(model.reasoning),
          search: Boolean(model.search),
          image_output: Boolean(model.image_output),
          video: Boolean(model.video),
          protocol_override: model.protocol_override || p.protocol_override || undefined,
          runtime_kind: normalizedRuntimeKind,
          cli_command: cliCommand || undefined,
        }));
      }
      const fallbackId = p.check_model || cfg.default_model || `${p.id}:default`;
      return [{
        id: fallbackId,
        display_name: fallbackId,
        provider_id: p.id,
        provider_name: p.name || p.id,
        type: 'chat',
        context_window: 0,
        enabled: true,
        runtime_kind: normalizedRuntimeKind,
        cli_command: cliCommand || undefined,
      }];
    });
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

  updateProvider: (id: string, data: { api_key: string; base_url: string; enabled: boolean }) =>
    invokeRustDataFromStatus<ProviderUpdateInput, { provider: any }>('provider_update', {
        id,
        enabled: data.enabled,
        key_vaults: JSON.stringify({ api_key: data.api_key || '' }),
        config_json: JSON.stringify({ base_url: data.base_url || '' }),
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

  addModel: (providerId: string, data: { id: string; display_name?: string; type?: string; context_window?: number; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean; enabled?: boolean }) =>
    invokeRustDataFromStatus<ProviderModelAddInput, { ok: boolean }>('model_add', {
      provider_id: providerId,
      data,
    }),

  updateModel: (providerId: string, modelId: string, data: { display_name?: string; type?: string; context_window?: number; enabled?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean }) =>
    invokeRustDataFromStatus<ProviderModelUpdateInput, { ok: boolean }>('model_update', {
      provider_id: providerId,
      model_id: modelId,
      data,
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
    invokeRustDataFromStatus<void, StatisticsData>('statistics_get'),

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

  addSkillMarketSource: (url: string, name?: string, branch?: string) =>
    invokeRustDataFromStatus<SkillMarketAddInput, { ok: boolean }>('skills_market_add', { url, name, branch }),

  removeSkillMarketSource: (id: string) =>
    invokeRustDataFromStatus<SkillMarketIdInput, { ok: boolean }>('skills_market_remove', { id }),

  syncSkillMarket: (marketId: string) =>
    invokeRustDataFromStatus<SkillMarketSyncInput, { skills: MarketSkillEntry[]; total: number }>(
      'skills_market_sync',
      { market_id: marketId },
    ),

  listMarketSkills: (marketId: string, q?: string) => {
    return invokeRustDataFromStatus<SkillMarketListInput, { skills: MarketSkillEntry[]; total: number }>(
      'skills_market_list_skills',
      { market_id: marketId, q },
    );
  },

  getMarketSkillDetail: (marketId: string, filePath: string) =>
    invokeRustDataFromStatus<SkillMarketDetailInput, MarketSkillDetail>('skills_market_detail', {
      market_id: marketId,
      file_path: filePath,
    }),

  installMarketSkill: (marketId: string, filePath: string) =>
    invokeRustDataFromStatus<SkillMarketDetailInput, SkillImportResult>('skills_market_install', {
      market_id: marketId,
      file_path: filePath,
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
    invokeRustDataFromStatus<McpCreateInput, { ok: boolean; name: string }>('mcp_create_server', { data }),

  updateMCPServer: (name: string, data: Partial<MCPServerRecord>) =>
    invokeRustDataFromStatus<McpUpdateInput, { ok: boolean }>('mcp_update_server', { name, data }),

  deleteMCPServer: (name: string) =>
    invokeRustDataFromStatus<McpNameInput, { ok: boolean }>('mcp_delete_server', { name }),

  toggleMCPServer: (name: string, enabled: boolean) =>
    invokeRustDataFromStatus<McpToggleInput, { ok: boolean }>('mcp_toggle_server', { name, enabled }),

  testMCPServer: (name: string) =>
    invokeRustDataFromStatus<McpNameInput, { ok: boolean; error?: string; tools?: string[] }>('mcp_test_server', { name }),

  executeMCPTool: (
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    callId?: string,
  ) =>
    invokeRustDataFromStatus<McpExecuteToolInput, McpToolExecutionResult>('mcp_execute_tool', {
      server_name: serverName,
      tool_name: toolName,
      arguments: args,
      call_id: callId,
    }),

  resolveAgentLocalToolRequest: (input: AgentLocalToolRequestInput) =>
    invokeRustDataFromStatus<AgentLocalToolRequestInput, AgentLocalToolResultEvent>(
      'agent_resolve_local_tool_request',
      input,
    ),

  startAgentTurnStream: (input: AgentExecuteTurnInput) =>
    invokeRustDataFromStatus<AgentExecuteTurnInput, { stream_id: string }>(
      'agent_execute_turn_stream',
      input,
    ),

  cancelAgentTurnStream: (streamId: string) =>
    invokeRustDataFromStatus<AgentTurnStreamCancelInput, { stream_id: string; stopped: boolean }>(
      'agent_cancel_turn_stream',
      { stream_id: streamId },
    ),

  decideAgentToolApproval: (input: AgentToolApprovalDecisionInput) =>
    invokeRustDataFromStatus<AgentToolApprovalDecisionInput, {
      ok: boolean;
      approvalId: string;
      approved: boolean;
      actor: string;
      decidedAt: string;
    }>('agent_decide_tool_approval', input),

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

  oauth2StartLoopback: (id: string, environment?: string) =>
    invokeRustDataFromStatus<OAuthLoopbackStartInput, { auth_url: string; session_id: string }>(
      'oauth2_start_loopback',
      { id, environment },
    ),

  oauth2PollLoopback: (sessionId: string) =>
    invokeRustDataFromStatus<OAuthLoopbackPollInput, {
      completed: boolean;
      status: 'pending' | 'completed' | 'failed' | 'expired';
      callback_url?: string;
      error?: string;
    }>(
      'oauth2_poll_loopback',
      { session_id: sessionId },
    ),

  oauth2HandleCallback: (input: OAuthCallbackInput) =>
    (async () => {
      const result = await invokeRustDataFromStatus<OAuthCallbackInput, { status: string }>('oauth2_handle_callback', input);
      await api.accountUpsertOAuth({
        provider: input.provider,
        provider_user_id: input.provider_user_id,
        name: input.username || input.display_name || input.provider_user_id,
        created_at: input.created_at,
        email: input.email || undefined,
        avatar_url: input.avatar_url || undefined,
        profile_url: input.profile_url || undefined,
      });
      return result;
    })(),

  oauth2ConsumeCallbackFromUrl: async (urlText: string) => {
    const payload = parseOAuthCallbackFromUrl(urlText);
    if (!payload) return false;
    await api.oauth2HandleCallback(payload);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('account-identity-changed'));
    }
    return true;
  },

  oauth2ListConnections: () =>
    invokeRustDataFromStatus<void, OAuth2Connection[]>('oauth2_list_connections'),

  oauth2GetConnection: (id: string) =>
    invokeRustDataFromStatus<OAuthIdInput, OAuth2Connection>('oauth2_get_connection', { id }),

  oauth2Disconnect: (id: string) =>
    invokeRustDataFromStatus<OAuthIdInput, { status: string }>('oauth2_disconnect', { id }),

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
    const data = await invokeRustDataFromStatus<{ q: string }, { items: any[]; total: number }>(
      'actor_search_actors', { q: query },
    );
    return { items: data?.items || [], total: data?.total || 0 };
  },

  actorGetMyProfile: async () => {
    const data = await invokeRustDataFromStatus<void, { id: string; displayName: string; username: string; avatar: string }>(
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

  friendChatListSessions: (limit?: number, offset?: number) =>
    invokeRustProto('friend_chat_list_sessions', GetSessionsResponseSchema, { limit, offset }),

  friendChatCreateSession: (participantDid: string) =>
    invokeRustProto('friend_chat_create_session', CreateSessionResponseSchema, { participant_did: participantDid }),

  friendChatGetSettings: (sessionUlid: string) =>
    invokeRustProto('friend_chat_get_settings', GetFriendConversationSettingsResponseSchema, { session_ulid: sessionUlid }),

  friendChatUpdateSettings: (
    sessionUlid: string,
    settings: { isMuted?: boolean; isPinned?: boolean; alertEnabled?: boolean; background?: string; clearedAt?: number },
  ) =>
    invokeRustProto('friend_chat_update_settings', UpdateFriendConversationSettingsResponseSchema, {
      session_ulid: sessionUlid,
      ...(settings.isMuted !== undefined ? { is_muted: settings.isMuted } : {}),
      ...(settings.isPinned !== undefined ? { is_pinned: settings.isPinned } : {}),
      ...(settings.alertEnabled !== undefined ? { alert_enabled: settings.alertEnabled } : {}),
      ...(settings.background !== undefined ? { background: settings.background } : {}),
      ...(settings.clearedAt !== undefined ? { cleared_at_unix_ms: settings.clearedAt } : {}),
    }),

  friendChatListMessages: (sessionUlid: string, beforeUlid?: string, limit?: number) =>
    invokeRustProto('friend_chat_list_messages', GetMessagesResponseSchema, { session_ulid: sessionUlid, before_ulid: beforeUlid, limit }),

  friendChatListThreadMessages: (
    sessionUlid: string,
    rootUlid: string,
    limit?: number,
    maxPages?: number,
    afterUlid?: string,
  ) =>
    invokeRustDataFromStatus<
      { session_ulid: string; root_ulid: string; limit?: number; max_pages?: number; after_ulid?: string },
      {
        root?: unknown | null;
        replies?: unknown[];
        messages?: unknown[];
        replyCount?: number;
        hitPageCap?: boolean;
        hasMore?: boolean;
        has_more?: boolean;
        nextCursor?: string;
        next_cursor?: string;
      }
    >('friend_chat_list_thread_messages', {
      session_ulid: sessionUlid,
      root_ulid: rootUlid,
      limit,
      max_pages: maxPages,
      after_ulid: afterUlid,
    }),

  friendChatThreadCounts: (sessionUlid: string, rootUlids: string[]) =>
    invokeRustDataFromStatus<
      { session_ulid: string; root_ulids: string[] },
      { counts: ChatThreadCount[] }
    >('friend_chat_thread_counts', {
      session_ulid: sessionUlid,
      root_ulids: rootUlids,
    }),

  friendChatThreadMarkRead: (sessionUlid: string, rootUlid: string, lastReadUlid?: string) =>
    invokeRustDataFromStatus<
      { session_ulid: string; root_ulid: string; last_read_ulid?: string },
      { success: boolean }
    >('friend_chat_thread_mark_read', {
      session_ulid: sessionUlid,
      root_ulid: rootUlid,
      last_read_ulid: lastReadUlid,
    }),

  friendChatSendMessage: (
    sessionUlid: string,
    receiverDid: string,
    content: string,
    type?: number,
    replyToUlid?: string,
    attachments?: ChatAttachmentInput[],
    encryptedPayload?: string,
    clientUlid?: string,
    threadRootUlid?: string,
  ) =>
    invokeRustProto('friend_chat_send_message', SendMessageResponseSchema, {
      session_ulid: sessionUlid,
      receiver_did: receiverDid,
      content,
      type,
      reply_to_ulid: replyToUlid,
      thread_root_ulid: threadRootUlid,
      attachments,
      ...(encryptedPayload != null && encryptedPayload !== ''
        ? { encrypted_payload: encryptedPayload }
        : {}),
      ...(clientUlid != null && clientUlid !== ''
        ? { client_ulid: clientUlid }
        : {}),
    }),

  friendChatAckMessages: (ulids: string[], status: number) =>
    invokeRustProto('friend_chat_ack_messages', MessageAckResponseSchema, { ulids, status }),

  /**
   * Recall a previously-sent friend chat message. Server enforces
   * sender ownership and the recall window (currently 5 minutes —
   * see `application.DefaultMutationWindow`). On success Station
   * pushes a `MessageMutation` event over SSE so peers update in
   * realtime; this call's response is empty.
   */
  friendChatRecallMessage: (sessionUlid: string, messageUlid: string) =>
    invokeRustProto(
      'friend_chat_recall_message',
      RecallFriendMessageResponseSchema,
      {
        session_ulid: sessionUlid,
        message_ulid: messageUlid,
      },
    ),

  /**
   * Edit a previously-sent friend chat message. At least one of
   * `newContent` or `newEncryptedPayload` must be non-empty; both
   * may be provided when an E2EE chat still keeps a plaintext
   * search index. Subject to the same window as recall.
   */
  friendChatEditMessage: (
    sessionUlid: string,
    messageUlid: string,
    newContent?: string,
    newEncryptedPayload?: Uint8Array,
  ) =>
    invokeRustProto(
      'friend_chat_edit_message',
      EditFriendMessageResponseSchema,
      {
        session_ulid: sessionUlid,
        message_ulid: messageUlid,
        ...(newContent != null && newContent !== '' ? { new_content: newContent } : {}),
        ...(newEncryptedPayload != null && newEncryptedPayload.byteLength > 0
          ? { new_encrypted_payload: Array.from(newEncryptedPayload) }
          : {}),
      },
    ),

  /**
   * Hard-delete a friend chat message. Unlike recall this removes
   * the row entirely (and its attachment metadata). Server-side
   * the parent session's last_message_* pointer is repaired when
   * the deleted ulid was the head.
   */
  friendChatDeleteMessage: (sessionUlid: string, messageUlid: string) =>
    invokeRustProto(
      'friend_chat_delete_message',
      DeleteFriendMessageResponseSchema,
      {
        session_ulid: sessionUlid,
        message_ulid: messageUlid,
      },
    ),

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

  friendChatLocalSearch: (query: string, limit?: number) =>
    invokeRustDataFromStatus<ChatLocalSearchInput, { messages: any[] }>(
      'friend_chat_local_search_scoped', { query, limit },
    ).then(r => r.messages || []),

  /** Unified local message search (SQLCipher FTS5) — friend + group, optional scope and conversation filters. */
  chatSearchLocal: async (
    query: string,
    scope?: string,
    conversationId?: string,
    limit?: number,
  ): Promise<{ results: ChatSearchLocalResultRow[] }> =>
    invokeRustDataFromStatus<
      { query: string; scope?: string; conversation_id?: string; limit?: number },
      { results: ChatSearchLocalResultRow[] }
    >('chat_search_local', {
      query,
      scope: scope ?? '',
      conversation_id: conversationId,
      limit: limit ?? 30,
    }),

  chatIndexLocalMessages: (messages: ChatIndexLocalMessageInput[]) =>
    invokeRustDataFromStatus<{ messages: ChatIndexLocalMessageInput[] }, { indexed_count: number }>(
      'chat_index_local_messages',
      { messages },
    ),

  friendChatSync: (sessionUlid: string, limit?: number, maxPages?: number) =>
    invokeRustDataFromStatus<FriendChatSyncInput, { synced_count: number; pages_fetched: number }>(
      'friend_chat_sync_from_station_scoped', { session_ulid: sessionUlid, limit, max_pages: maxPages },
    ),

  friendChatSyncMessages: (messagesJson: string) =>
    invokeRustProto('friend_chat_sync_messages', SyncMessagesResponseSchema, { session_ulid: '', messages_json: messagesJson }),

  /**
   * Start the unified realtime SSE consumer for the current actor.
   * Idempotent — the Rust side replaces any in-flight supervisor for
   * the same actor. While running, the supervisor emits
   * `realtime:event` Tauri events for every business / heartbeat /
   * resync frame and `realtime:connection-state` on connect/disconnect.
   * See docs/architecture/realtime/event-stream.md for the wire
   * contract and the per-window device id semantics.
   */
  realtimeStreamStart: () =>
    invokeRustDataFromStatus<void, { actor_id: string; device_id: string }>(
      'realtime_stream_start',
    ),

  /** Cancel the realtime SSE consumer for the current actor. */
  realtimeStreamStop: () =>
    invokeRustDataFromStatus<void, { actor_id: string | null }>('realtime_stream_stop'),

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
    recipientActorId: string,
    sessionUlid: string,
    kind: RealtimeCallSignalKind,
    payloadB64: string,
  ) =>
    invokeRustDataFromStatus<
      {
        recipient_actor_id: string;
        session_ulid: string;
        kind: string;
        payload_b64: string;
      },
      Record<string, unknown>
    >('realtime_signal_send', {
      recipient_actor_id: recipientActorId,
      session_ulid: sessionUlid,
      kind,
      payload_b64: payloadB64,
    }),

  /**
   * Publish a typing-state pulse onto the recipient's realtime SSE
   * stream via Station's `POST /realtime/typing` ingress.
   *
   * Typing is purely advisory metadata — there is no payload, no
   * encryption, no persistence. Senders should debounce locally
   * (fire `typing=true` at most every ~3s while the user is typing,
   * and fire `typing=false` after ~4s of inactivity / on send / on
   * blur). Station fan-outs the pulse to the recipient only — no
   * multi-device sender echo, since typing is about the actor's own
   * activity that their other devices already know about.
   */
  realtimeTypingSend: (
    recipientActorId: string,
    sessionUlid: string,
    typing: boolean,
  ) =>
    invokeRustDataFromStatus<
      {
        recipient_actor_id: string;
        session_ulid: string;
        typing: boolean;
      },
      Record<string, unknown>
    >('realtime_typing_send', {
      recipient_actor_id: recipientActorId,
      session_ulid: sessionUlid,
      typing,
    }),

  /**
   * Seal a WebRTC signaling plaintext (canonical JSON for SDP /
   * candidate / hangup) into the standalone signaling envelope
   * defined in `docs/architecture/realtime/event-stream.md` §2.7.2.
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

  friendChatGetPending: (limit?: number) =>
    invokeRustProto('friend_chat_get_pending', GetPendingResponseSchema, { limit }),

  friendChatGetStats: () =>
    invokeRustProto('friend_chat_get_stats', GetStatsResponseSchema),

  groupChatListGroups: (limit?: number, offset?: number) =>
    invokeRustProto('group_chat_list_groups', ListGroupsResponseSchema, { limit, offset }),

  groupChatListMessages: (groupUlid: string, beforeUlid?: string, limit?: number) =>
    invokeRustProto('group_chat_list_messages', GetGroupMessagesResponseSchema, { group_ulid: groupUlid, before_ulid: beforeUlid, limit }),

  groupChatListThreadMessages: (
    groupUlid: string,
    rootUlid: string,
    limit?: number,
    maxPages?: number,
    afterUlid?: string,
  ) =>
    invokeRustDataFromStatus<
      { group_ulid: string; root_ulid: string; limit?: number; max_pages?: number; after_ulid?: string },
      {
        root?: unknown | null;
        replies?: unknown[];
        messages?: unknown[];
        replyCount?: number;
        hitPageCap?: boolean;
        hasMore?: boolean;
        has_more?: boolean;
        nextCursor?: string;
        next_cursor?: string;
      }
    >('group_chat_list_thread_messages', {
      group_ulid: groupUlid,
      root_ulid: rootUlid,
      limit,
      max_pages: maxPages,
      after_ulid: afterUlid,
    }),

  groupChatThreadCounts: (groupUlid: string, rootUlids: string[]) =>
    invokeRustDataFromStatus<
      { group_ulid: string; root_ulids: string[] },
      { counts: ChatThreadCount[] }
    >('group_chat_thread_counts', {
      group_ulid: groupUlid,
      root_ulids: rootUlids,
    }),

  groupChatThreadMarkRead: (groupUlid: string, rootUlid: string, lastReadUlid?: string) =>
    invokeRustDataFromStatus<
      { group_ulid: string; root_ulid: string; last_read_ulid?: string },
      { success: boolean }
    >('group_chat_thread_mark_read', {
      group_ulid: groupUlid,
      root_ulid: rootUlid,
      last_read_ulid: lastReadUlid,
    }),

  // Group chat sends MUST carry `encryptedPayload` (the base64
  // bytes of a `GroupCiphertext` produced by `cryptoGroupEncrypt`).
  // The Rust layer pins `content` to "" regardless of what the JS
  // layer passes; it is kept in the signature for source compat
  // with old callers but a non-empty value is silently dropped.
  // See `modules/identity/groupSenderKeys.ts` for the only correct
  // entry point.
  groupChatSendMessage: (
    groupUlid: string,
    content: string,
    type?: number,
    replyToUlid?: string,
    mentionedDids?: string[],
    mentionAll?: boolean,
    attachments?: ChatAttachmentInput[],
    encryptedPayload?: string,
    threadRootUlid?: string,
  ) =>
    invokeRustProto('group_chat_send_message', SendGroupMessageResponseSchema, {
      group_ulid: groupUlid,
      content,
      type,
      reply_to_ulid: replyToUlid,
      thread_root_ulid: threadRootUlid,
      mentioned_dids: mentionedDids,
      mention_all: mentionAll,
      attachments,
      ...(encryptedPayload != null && encryptedPayload !== ''
        ? { encrypted_payload: encryptedPayload }
        : {}),
    }),

  groupChatUnreadCount: (groupUlid?: string) =>
    invokeRustProto('group_chat_unread_count', GetUnreadCountResponseSchema, { group_ulid: groupUlid }),

  groupChatMarkRead: (groupUlid: string) =>
    invokeRustProto('group_chat_mark_read', MarkGroupReadResponseSchema, { group_ulid: groupUlid }),

  groupChatLocalSearch: (query: string, limit?: number) =>
    invokeRustDataFromStatus<ChatLocalSearchInput, { messages: any[] }>(
      'group_chat_local_search_scoped', { query, limit },
    ).then(r => r.messages || []),

  groupChatSync: (groupUlid: string, limit?: number, maxPages?: number) =>
    invokeRustDataFromStatus<GroupChatSyncInput, { synced_count: number; pages_fetched: number }>(
      'group_chat_sync_from_station_scoped', { group_ulid: groupUlid, limit, max_pages: maxPages },
    ),

  groupChatCreateGroup: (name: string, description?: string, memberDids?: string[]) =>
    invokeRustProto('group_chat_create_group', CreateGroupResponseSchema, { name, description, member_dids: memberDids }),

  groupChatGetGroup: (groupUlid: string) =>
    invokeRustProto('group_chat_get_group', GetGroupResponseSchema, { group_ulid: groupUlid }),

  groupChatUpdateGroup: (groupUlid: string, name?: string, description?: string, avatarCid?: string) =>
    invokeRustProto('group_chat_update_group', UpdateGroupResponseSchema, {
      group_ulid: groupUlid,
      name,
      description,
      avatar_cid: avatarCid,
    }),

  groupChatInviteToGroup: (groupUlid: string, memberDids: string[]) =>
    invokeRustProto('group_chat_invite_to_group', InviteToGroupResponseSchema, { group_ulid: groupUlid, member_dids: memberDids }),

  groupChatJoinGroup: (groupUlid: string, invitationUlid?: string) =>
    invokeRustProto('group_chat_join_group', JoinGroupResponseSchema, { group_ulid: groupUlid, invitation_ulid: invitationUlid }),

  groupChatLeaveGroup: (groupUlid: string) =>
    invokeRustProto('group_chat_leave_group', LeaveGroupResponseSchema, { group_ulid: groupUlid }),

  groupChatTransferOwnership: (groupUlid: string, nextOwnerDid: string) =>
    invokeRustProto('group_chat_transfer_ownership', TransferGroupOwnershipResponseSchema, {
      group_ulid: groupUlid,
      next_owner_did: nextOwnerDid,
    }),

  groupChatDissolveGroup: (groupUlid: string) =>
    invokeRustProto('group_chat_dissolve_group', DissolveGroupResponseSchema, { group_ulid: groupUlid }),

  groupChatGetMembers: (groupUlid: string, limit?: number, offset?: number) =>
    invokeRustProto('group_chat_get_members', GetGroupMembersResponseSchema, { group_ulid: groupUlid, limit, offset }),

  groupChatRemoveMember: (groupUlid: string, memberDid: string) =>
    invokeRustProto('group_chat_remove_member', RemoveMemberResponseSchema, { group_ulid: groupUlid, member_did: memberDid }),

  groupChatUpdateMember: (groupUlid: string, memberDid: string, input: { role?: number; muted?: boolean; mutedUntilUnixMs?: number }) =>
    invokeRustProto('group_chat_update_member', UpdateMemberResponseSchema, {
      group_ulid: groupUlid,
      member_did: memberDid,
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.muted !== undefined ? { muted: input.muted } : {}),
      ...(input.mutedUntilUnixMs !== undefined ? { muted_until_unix_ms: input.mutedUntilUnixMs } : {}),
    }),

  groupChatRecallMessage: (groupUlid: string, messageUlid: string) =>
    invokeRustProto('group_chat_recall_message', RecallGroupMessageResponseSchema, { group_ulid: groupUlid, message_ulid: messageUlid }),

  groupChatEditMessage: (
    groupUlid: string,
    messageUlid: string,
    newContent?: string,
    newEncryptedPayload?: Uint8Array,
  ) =>
    invokeRustProto('group_chat_edit_message', EditGroupMessageResponseSchema, {
      group_ulid: groupUlid,
      message_ulid: messageUlid,
      ...(newContent != null && newContent !== '' ? { new_content: newContent } : {}),
      ...(newEncryptedPayload != null && newEncryptedPayload.byteLength > 0
        ? { new_encrypted_payload: Array.from(newEncryptedPayload) }
        : {}),
    }),

  groupChatDeleteMessage: (groupUlid: string, messageUlid: string) =>
    invokeRustProto('group_chat_delete_message', DeleteGroupMessageResponseSchema, { group_ulid: groupUlid, message_ulid: messageUlid }),

  groupChatSearchMessages: (groupUlid: string, query: string, limit?: number) =>
    invokeRustProto('group_chat_search_messages', SearchGroupMessagesResponseSchema, { group_ulid: groupUlid, query, limit }),

  groupChatUpdateNickname: (groupUlid: string, nickname: string) =>
    invokeRustProto('group_chat_update_nickname', UpdateMyNicknameResponseSchema, { group_ulid: groupUlid, nickname }),

  groupChatGetSettings: (groupUlid: string) =>
    invokeRustProto('group_chat_get_settings', GetGroupSettingsResponseSchema, { group_ulid: groupUlid }),

  groupChatUpdateSettings: (
    groupUlid: string,
    settings: { isMuted?: boolean; isPinned?: boolean; alertEnabled?: boolean; background?: string; clearedAt?: number },
  ) =>
    invokeRustProto('group_chat_update_settings', UpdateGroupSettingsResponseSchema, {
      group_ulid: groupUlid,
      ...(settings.isMuted !== undefined ? { is_muted: settings.isMuted } : {}),
      ...(settings.isPinned !== undefined ? { is_pinned: settings.isPinned } : {}),
      ...(settings.alertEnabled !== undefined ? { alert_enabled: settings.alertEnabled } : {}),
      ...(settings.background !== undefined ? { background: settings.background } : {}),
      ...(settings.clearedAt !== undefined ? { cleared_at_unix_ms: settings.clearedAt } : {}),
    }),

  groupChatGetOfflineMessages: (groupUlid: string, limit?: number) =>
    invokeRustProto('group_chat_get_offline_messages', GetOfflineMessagesResponseSchema, { group_ulid: groupUlid, limit }),

  groupChatAckOfflineMessages: (groupUlid: string, messageUlids: string[]) =>
    invokeRustProto('group_chat_ack_offline_messages', AckOfflineMessagesResponseSchema, { group_ulid: groupUlid, message_ulids: messageUlids }),

  groupChatGetStats: () =>
    invokeRustProto('group_chat_get_stats', GetGroupStatsResponseSchema),

  // ── Crypto (local E2E; flat Tauri args) ──

  cryptoGenerateIdentity: () =>
    invokeAppResultStub<{ fingerprint: string; public_key: string }>('crypto_generate_identity'),

  cryptoGetFingerprint: () =>
    invokeAppResultStub<{ fingerprint: string }>('crypto_get_fingerprint'),

  cryptoRatchetTelemetrySnapshot: () =>
    invokeAppResultStub<{
      legacy_decrypts: number;
      dr_decrypts: number;
      since_unix_ms: number;
    }>('crypto_ratchet_telemetry_snapshot'),

  cryptoGetKeyBundle: () =>
    invokeAppResultStub<CryptoKeyBundlePayload>('crypto_get_key_bundle'),

  cryptoInitSession: (
    sessionId: string,
    peerDid: string,
    peerIkPub: string,
    peerSpkPub: string,
    peerSpkSig: string,
    peerOpkPub?: string,
  ) =>
    invokeAppResultStub<{ ephemeral_key: string; established: boolean }>('crypto_init_session', {
      session_id: sessionId,
      peer_did: peerDid,
      peer_ik_pub: peerIkPub,
      peer_spk_pub: peerSpkPub,
      peer_spk_sig: peerSpkSig,
      ...(peerOpkPub != null && peerOpkPub !== '' ? { peer_opk_pub: peerOpkPub } : {}),
    }),

  cryptoEncryptMessage: (sessionId: string, peerDid: string, plaintext: string) =>
    invokeAppResultStub<{ ciphertext: string; counter: number; ephemeral_key?: string }>('crypto_encrypt_message', {
      session_id: sessionId,
      peer_did: peerDid,
      plaintext,
    }),

  cryptoDecryptMessage: (
    sessionId: string,
    peerDid: string,
    ciphertext: string,
    counter: number,
    ephemeralKey?: string,
  ) =>
    invokeAppResultStub<{ plaintext: string }>('crypto_decrypt_message', {
      session_id: sessionId,
      peer_did: peerDid,
      ciphertext,
      counter,
      ...(ephemeralKey != null && ephemeralKey !== '' ? { ephemeral_key: ephemeralKey } : {}),
    }),

  // ── Group chat E2EE: Sender Keys ──
  //
  // Four primitives:
  //   * cryptoGroupSkEmitSkdm    -> get the SKDM bytes to ship to a
  //                                 single peer over friend chat.
  //                                 Idempotent on the server side
  //                                 (returns the same chain key /
  //                                 counter until the next rotation).
  //   * cryptoGroupSkConsumeSkdm -> install a chain we received as a
  //                                 friend-chat type=50 control body.
  //                                 `claimedSenderDid` MUST equal the
  //                                 friend-chat envelope sender DID
  //                                 -- guards against A re-distributing
  //                                 B's chain as their own.
  //   * cryptoGroupEncrypt       -> wrap a plaintext for
  //                                 SendGroupMessageRequest
  //                                 .encrypted_payload. Plaintext is
  //                                 base64 so binary content (image /
  //                                 file body) round-trips losslessly.
  //   * cryptoGroupDecrypt       -> reverse direction. Returns
  //                                 base64; caller decodes to UTF-8
  //                                 if it knows the body is text.
  //
  // See peers-touch/docs/architecture/encryption/group-sender-keys.md
  // for the protocol and `crypto/sender_keys.rs` for the primitive.

  cryptoGroupSkEmitSkdm: (groupUlid: string) =>
    invokeAppResultStub<{
      group_ulid: string;
      sender_did: string;
      sender_key_id: number;
      skdm_b64: string;
    }>('crypto_group_sk_emit_skdm', { group_ulid: groupUlid }),

  cryptoGroupSkConsumeSkdm: (claimedSenderDid: string, skdmB64: string) =>
    invokeAppResultStub<{
      group_ulid: string;
      sender_did: string;
      sender_key_id: number;
    }>('crypto_group_sk_consume_skdm', {
      claimed_sender_did: claimedSenderDid,
      skdm_b64: skdmB64,
    }),

  // Force-rotate the local sender chain for `groupUlid`. After this
  // returns the caller MUST call `resetSkdmDistribution` and a fresh
  // `ensureSkdmDistributed` so the new chain reaches every member;
  // otherwise the dedupe set will suppress redistribution and peers
  // will silently fail to decrypt post-rotation messages.
  cryptoGroupSkRotate: (groupUlid: string) =>
    invokeAppResultStub<{
      group_ulid: string;
      sender_did: string;
      sender_key_id: number;
    }>('crypto_group_sk_rotate', { group_ulid: groupUlid }),

  cryptoGroupEncrypt: (groupUlid: string, plaintextB64: string) =>
    invokeAppResultStub<{
      encrypted_payload_b64: string;
      sender_key_id: number;
      counter: number;
    }>('crypto_group_encrypt', {
      group_ulid: groupUlid,
      plaintext_b64: plaintextB64,
    }),

  cryptoGroupDecrypt: (groupUlid: string, encryptedPayloadB64: string) =>
    invokeAppResultStub<{
      plaintext_b64: string;
      sender_did: string;
      sender_key_id: number;
      counter: number;
    }>('crypto_group_decrypt', {
      group_ulid: groupUlid,
      encrypted_payload_b64: encryptedPayloadB64,
    }),

  keyExchangeUploadBundle: (bundle: CryptoKeyBundlePayload) =>
    invokeRustDataFromStatus<CryptoKeyBundlePayload, Record<string, unknown>>(
      'key_exchange_upload_bundle',
      bundle,
    ),

  keyExchangeFetchBundle: (did: string, deviceId?: string) =>
    invokeRustDataFromStatus<{ did: string; device_id?: string }, KeyExchangeFetchBundlesResponse>(
      'key_exchange_fetch_bundle',
      { did, ...(deviceId != null && deviceId !== '' ? { device_id: deviceId } : {}) },
    ),

  accountGetDeviceId: () =>
    invokeRustDataFromStatus<void, { device_id: string }>('account_get_device_id'),

  // ── ICE / TURN ──
  //
  // Anything resembling an ICE *session* (offer/answer/candidate exchange)
  // moved to the unified realtime SSE plane in Phase 8 — see
  // `realtimeSignalSend` / `signalingEnvelopeSeal` / `signalingEnvelopeOpen`
  // above and docs/architecture/realtime/event-stream.md §2.7. The role-
  // hint publisher (`ice_peer_register`) was retired in 8.3c — peer
  // online/offline liveness is now carried by PresenceFlip events on the
  // canonical realtime stream. What remains here is just the TURN
  // credentials fetch (media plane).

  iceGetServers: () =>
    invokeRustDataFromStatus<void, IceServersResponse>('ice_get_servers'),

  // ── Friend Request ──

  friendChatSendFriendRequest: (receiverDid: string, message?: string) =>
    invokeRustProto('friend_chat_send_friend_request', SendFriendRequestResponseSchema, { receiver_did: receiverDid, message }),

  friendChatAcceptFriendRequest: (requestId: string) =>
    invokeRustProto('friend_chat_accept_friend_request', AcceptFriendRequestResponseSchema, { request_id: requestId }),

  friendChatRejectFriendRequest: (requestId: string) =>
    invokeRustProto('friend_chat_reject_friend_request', RejectFriendRequestResponseSchema, { request_id: requestId }),

  friendChatListFriendRequests: (status?: number, limit?: number, offset?: number) =>
    invokeRustProto('friend_chat_list_friend_requests', ListFriendRequestsResponseSchema, { status, limit, offset }),

  friendChatBlockUser: async (targetDid: string) => {
    const response = await invokeRustProto('friend_chat_block_user', BlockUserResponseSchema, { target_did: targetDid });
    eventBus.publish(EVENT.RELATIONSHIP_CHANGED, { targetActorId: targetDid, action: 'block' });
    return response;
  },

  friendChatUnblockUser: async (targetDid: string) => {
    const response = await invokeRustProto('friend_chat_unblock_user', UnblockUserResponseSchema, { target_did: targetDid });
    eventBus.publish(EVENT.RELATIONSHIP_CHANGED, { targetActorId: targetDid, action: 'unblock' });
    return response;
  },

  friendChatListBlockedUsers: (limit = 100, offset = 0) =>
    invokeRustProto('friend_chat_list_blocked_users', ListBlockedUsersResponseSchema, { limit, offset }),

  friendChatGetFriendshipStatus: (targetDid: string) =>
    invokeRustProto('friend_chat_get_friendship_status', GetFriendshipStatusResponseSchema, { target_did: targetDid }),

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
    invokeRustDataFromStatus<void, { preferences: NotificationPreferenceData[] }>(
      'notification_preferences',
    ),

  notificationPreferencesUpdate: (category: number, enabled: boolean, pushEnabled: boolean, soundEnabled: boolean) =>
    invokeRustDataFromStatus<{ category: number; enabled: boolean; push_enabled: boolean; sound_enabled: boolean }, { preference: NotificationPreferenceData }>(
      'notification_preferences_update', { category, enabled, push_enabled: pushEnabled, sound_enabled: soundEnabled },
    ),

  desktopNativeHostEventEmit: (input: DesktopNativeHostEventInput) =>
    invokeRustDataFromStatus<DesktopNativeHostEventInput, { emitted: boolean; kind: string }>(
      'desktop_native_event_emit',
      input,
    ),

  // ── Station registry (dynamic URL picker) ──

  stationList: () =>
    invokeRustDataFromStatus<void, StationListResponse>('station_list'),

  stationSetActive: (url: string) =>
    invokeRustDataFromStatus<{ url: string }, { active_url: string }>('station_set_active', { url }),

  stationAdd: (url: string) =>
    invokeRustDataFromStatus<{ url: string }, StationEntry>('station_add', { url }),

  stationRemove: (url: string) =>
    invokeRustDataFromStatus<{ url: string }, { removed: string }>('station_remove', { url }),

  stationProbe: (url: string) =>
    invokeRustDataFromStatus<{ url: string }, StationProbeResult>('station_probe', { url }),
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
}

/** One device-published bundle from Station (`FetchKeyBundleResponse.bundles`). */
export interface KeyExchangeWireBundle {
  did: string;
  device_id: string;
  ik_pub: string;
  /** SHA-256 hex over raw IK bytes; added by the desktop stub (not on wire proto). */
  fingerprint?: string;
  spk_pub: string;
  spk_sig: string;
  opks: string[];
  published_at_unix_ms: number;
}

export interface KeyExchangeFetchBundlesResponse {
  bundles: KeyExchangeWireBundle[];
}

/** Most recently published bundle for a DID (server returns `published_at` desc). */
export function pickLatestKeyExchangeBundle(
  res: KeyExchangeFetchBundlesResponse | null | undefined,
): KeyExchangeWireBundle | undefined {
  const first = res?.bundles?.[0];
  return first;
}

export interface FriendRequestData {
  id: string;
  senderId: string;
  receiverId: string;
  status: number;
  message: string;
  createdAt: string;
  respondedAt?: string;
}

export interface FriendChatSessionData {
  ulid: string;
  participantADid: string;
  participantBDid: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationData {
  id: string;
  recipientId: string;
  actorId: string;
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
  actorId: string;
  category: number;
  enabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
  updatedAt: string;
}

export interface StreamEvent {
  event: string;
  data: Record<string, string>;
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

function mapAIChatProviderToListItem(item: any): ProviderListItem {
  const cfg = parseJSONSafe(item.config_json);
  const keyVaults = parseJSONSafe(item.key_vaults);
  const runtimeKind = String(cfg.runtime_kind || cfg.runtimeKind || cfg.runtime || '').trim().toLowerCase();
  const hasCliCommand = Boolean(String(cfg.cli_command || cfg.cliCommand || '').trim());
  return {
    id: item.id,
    name: item.name || '',
    description: item.description || '',
    logo: item.logo || undefined,
    enabled: Boolean(item.enabled),
    builtin: Boolean(item.builtin),
    has_api_key: Boolean(keyVaults.api_key || keyVaults.key || ''),
    runtime_kind: runtimeKind === 'cli' || hasCliCommand ? 'cli' : 'direct',
  };
}

function mapAIChatProviderToDetail(item: any): ProviderDetail {
  const cfg = parseJSONSafe(item.config_json);
  const keyVaults = parseJSONSafe(item.key_vaults);
  const checkModel = item.check_model || cfg.default_model || 'default';
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
        function_call: Boolean(model?.function_call),
        vision: Boolean(model?.vision),
        reasoning: Boolean(model?.reasoning),
        search: Boolean(model?.search),
        image_output: Boolean(model?.image_output),
        video: Boolean(model?.video),
      } as ModelItem;
    })
    .filter((model: ModelItem | null): model is ModelItem => Boolean(model));
  return {
    ...mapAIChatProviderToListItem(item),
    home_url: cfg.home_url || '',
    api_key_url: cfg.api_key_url || '',
    api_key: keyVaults.api_key || '',
    base_url: cfg.base_url || '',
    default_base_url: cfg.default_base_url || cfg.base_url || '',
    show_checker: true,
    check_model: checkModel,
    models: models.length > 0
      ? models
      : [{
        id: checkModel,
        display_name: checkModel,
        type: 'chat',
        enabled: true,
        context_window: 0,
      }],
  };
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
  onError: (err: Error) => void,
): AbortController {
  const controller = new AbortController();
  log.info('api', 'streamAgentTurn started', { conversationId: input.conversation_id, agentId: input.agent_id });
  (async () => {
    let unlisten: (() => void) | undefined;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const streamId = input.stream_id || createAgentTurnStreamId();

      unlisten = await listen<AgentTurnStreamPayload>('agent:turn-stream-event', (tauriEvent) => {
        const payload = tauriEvent.payload;
        if (payload.streamId !== streamId) return;
        if (controller.signal.aborted) {
          unlisten?.();
          return;
        }

        const data: Record<string, string> = {};
        Object.entries(payload.data || {}).forEach(([key, value]) => {
          if (typeof value === 'string') {
            data[key] = value;
          } else if (value !== undefined && value !== null) {
            data[key] = JSON.stringify(value);
          }
        });
        if (typeof payload.data?.text === 'string') data.content = payload.data.text;
        if (typeof payload.data?.result === 'string') data.content = payload.data.result;
        if (typeof payload.data?.toolCallId === 'string') data.id = payload.data.toolCallId;
        if (typeof payload.data?.toolName === 'string') data.name = payload.data.toolName;
        if (typeof payload.data?.arguments === 'string') data.args = payload.data.arguments;
        if (typeof payload.data?.stage === 'string') data.message = payload.data.stage;

        eventBus.publish(EVENT.AGENT_TURN_STREAM_EVENT, {
          streamId,
          conversationId: input.conversation_id,
          agentId: input.agent_id,
          event: payload.event,
          data,
          timestampMs: Date.now(),
        } satisfies AgentTurnStreamEventPayload);
        onEvent({ event: payload.event, data });
        if (payload.event === 'done') {
          unlisten?.();
          onDone();
        }
        if (payload.event === 'error') {
          unlisten?.();
          onError(new Error(data.error || 'agent.error.streamFailed'));
        }
      });

      const result = await api.startAgentTurnStream({ ...input, stream_id: streamId });
      if (result?.stream_id !== streamId) {
        unlisten();
        throw new Error('agent.error.streamIdMismatch');
      }
      if (controller.signal.aborted) {
        api.cancelAgentTurnStream(streamId).catch((error) => {
          log.warn('api', 'streamAgentTurn cancel failed', { error: String(error) });
        });
        unlisten();
        return;
      }

      controller.signal.addEventListener('abort', () => {
        api.cancelAgentTurnStream(streamId).catch((error) => {
          log.warn('api', 'streamAgentTurn cancel failed', { error: String(error) });
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

export const executeAgentTurn = streamChat;

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
): Promise<void> {
  await invokeRustDataFromStatus('agent_submit_feedback', {
    agent_id: agentId,
    turn_id: turnId,
    conversation_id: conversationId,
    signal,
    comment: comment ?? null,
  });
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
