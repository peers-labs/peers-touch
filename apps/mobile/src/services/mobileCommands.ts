import { fromBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';

import {
  AcceptSocialFriendRequestResponseSchema,
  RejectSocialFriendRequestResponseSchema,
  SendSocialFriendRequestResponseSchema,
  type AcceptSocialFriendRequestResponse,
  type RejectSocialFriendRequestResponse,
  type SendSocialFriendRequestResponse,
} from '../gen/proto/domain/social/relationship_pb';

export async function setSecureStorageValue(key: string, value: string): Promise<void> {
  await invoke('secure_storage_set', { key, value });
}

export async function getSecureStorageValue(key: string): Promise<string | null> {
  return invoke<string | null>('secure_storage_get', { key });
}

export async function removeSecureStorageValue(key: string): Promise<void> {
  await invoke('secure_storage_remove', { key });
}

export interface MessagingAccountInput {
  stationPeerId: string;
  actorPtid: string;
}

export interface MessagingActivateInput extends MessagingAccountInput {
  stationOrigin: string;
  accessToken: string;
}

export interface MessagingRuntimeStatus {
  active: boolean;
  profileId?: string;
  stationPeerId?: string;
  stationOrigin?: string;
  actorPtid?: string;
  deviceId?: string;
  deviceEnrolled: boolean;
  laneSequence: number;
  consumerEpoch: number;
  conversationCount: number;
  activationGeneration: number;
  workerPhase: 'running' | 'suspended' | 'stopping';
}

export interface MessagingConversationProjection {
  conversationId: string;
  authorityStationId: string;
  kind: number;
  name: string;
  ownerPtid: string;
  memberPtids: string[];
  membershipEpoch: number;
  mlsEpoch: number;
  active: boolean;
  updatedAtUnixMs: number;
}

export interface MessagingCreateDirectInput extends MessagingAccountInput {
  peerPtid: string;
  federationId: string;
}

export interface MessagingCreateDirectResult {
  conversationId: string;
  commandId: string;
  state: 'pending' | 'projected';
}

export interface MessagingCreateGroupInput extends MessagingAccountInput {
  conversationId: string;
  name: string;
  memberPtids: string[];
  federationId: string;
}

export interface MessagingCreateGroupResult {
  conversationId: string;
  commandId: string;
  state: 'pending' | 'projected' | 'failed';
}

export interface SocialFriendRequestSendInput extends MessagingAccountInput {
  receiverPtid: string;
  receiverHomeStationPeerId: string;
  federationId: string;
  message?: string;
}

export interface SocialFriendRequestDecisionInput extends MessagingAccountInput {
  requestId: string;
  senderPtid: string;
  receiverPtid: string;
  senderHomeStationPeerId: string;
  receiverHomeStationPeerId: string;
  federationId: string;
}

export interface MessagingAttachmentProjection {
  attachmentId: string;
  filename: string;
  mimeType: string;
  plaintextSize: number;
  objectId?: string;
  storageRef?: string;
  ciphertextSize?: number;
  availabilityState?: 'remote' | 'local';
}

export interface MessagingReactionProjection {
  actorPtid: string;
  reaction: string;
  createdAtUnixMs: number;
}

export interface MessagingMessageProjection {
  eventId?: string;
  eventSequence?: number;
  messageId: string;
  senderPtid: string;
  senderDeviceId: string;
  plaintext: string;
  attachments: MessagingAttachmentProjection[];
  state:
    | 'draft'
    | 'pending'
    | 'prepared'
    | 'retry_wait'
    | 'submitted'
    | 'failed'
    | 'terminal'
    | 'accepted'
    | 'delivered'
    | 'read';
  timestampUnixMs: number;
  replyToMessageId?: string;
  threadRootMessageId?: string;
  editedText?: string;
  editedAtUnixMs?: number;
  retracted: boolean;
  reactions: MessagingReactionProjection[];
  pinnedByPtid?: string;
  pinnedAtUnixMs?: number;
  readByPtids: string[];
}

export interface MessagingPendingCommandResult {
  commandId: string;
  messageId: string;
  attachmentIds: string[];
  state: 'pending';
}

export type MessagingSubmitCommandResult =
  | MessagingPendingCommandResult
  | {
    messageId: string;
    attachmentIds: string[];
    state: 'draft';
  };

export interface MessagingAttachmentStageProjection {
  stageId: string;
  filename: string;
  mimeType: string;
  plaintextSize: number;
  completed: boolean;
  maxChunkBytes: number;
}

export type MessagingAttachmentOpenResult =
  | { state: 'ready'; localPath: string }
  | { state: 'pending'; nextAttemptAtUnixMs: number };

export interface MessagingCommandStatusProjection {
  commandId: string;
  conversationId: string;
  state:
    | 'pending'
    | 'retry_wait'
    | 'submitted'
    | 'failed'
    | 'superseded'
    | 'committed';
  lastErrorCode: string;
}

export type MessagingMetadataInteraction =
  | { kind: 'retract' }
  | { kind: 'reaction'; reaction: string; remove: boolean }
  | { kind: 'pin'; remove: boolean };

export interface MessagingReconcileResult {
  deviceEnrolled: boolean;
  processed: number;
  cursor: number;
  laneHead: number;
  consumerEpoch: number;
  deliveryReceiptSubmitted: boolean;
  commandState:
    | 'idle'
    | 'submitted'
    | 'retry_scheduled'
    | 'failed'
    | 'stale_delivery_plan'
    | 'stale_authority_plan';
  commandId?: string;
  nextAttemptAtUnixMs?: number;
}

export async function messagingActivate(
  input: MessagingActivateInput,
): Promise<MessagingRuntimeStatus> {
  return invoke<MessagingRuntimeStatus>('messaging_activate', { input });
}

export async function messagingStatus(): Promise<MessagingRuntimeStatus> {
  return invoke<MessagingRuntimeStatus>('messaging_status');
}

export async function socialFriendRequestSend(
  input: SocialFriendRequestSendInput,
): Promise<SendSocialFriendRequestResponse> {
  const bytes = await invoke<number[]>('social_friend_request_send', { input });
  return fromBinary(SendSocialFriendRequestResponseSchema, Uint8Array.from(bytes));
}

export async function socialFriendRequestAccept(
  input: SocialFriendRequestDecisionInput,
): Promise<AcceptSocialFriendRequestResponse> {
  const bytes = await invoke<number[]>('social_friend_request_accept', { input });
  return fromBinary(AcceptSocialFriendRequestResponseSchema, Uint8Array.from(bytes));
}

export async function socialFriendRequestReject(
  input: SocialFriendRequestDecisionInput,
): Promise<RejectSocialFriendRequestResponse> {
  const bytes = await invoke<number[]>('social_friend_request_reject', { input });
  return fromBinary(RejectSocialFriendRequestResponseSchema, Uint8Array.from(bytes));
}

export async function messagingCreateDirect(
  input: MessagingCreateDirectInput,
): Promise<MessagingCreateDirectResult> {
  return invoke<MessagingCreateDirectResult>('messaging_create_direct', { input });
}

export async function messagingCreateGroup(
  input: MessagingCreateGroupInput,
): Promise<MessagingCreateGroupResult> {
  return invoke<MessagingCreateGroupResult>('messaging_create_group', { input });
}

export async function messagingListConversations(
  input: MessagingAccountInput,
): Promise<MessagingConversationProjection[]> {
  return invoke<MessagingConversationProjection[]>('messaging_list_conversations', { input });
}

export async function messagingListMessages(
  input: MessagingAccountInput & { conversationId: string },
): Promise<MessagingMessageProjection[]> {
  return invoke<MessagingMessageProjection[]>('messaging_list_messages', { input });
}

export async function messagingListThreadMessages(
  input: MessagingAccountInput & { conversationId: string; threadRootMessageId: string },
): Promise<MessagingMessageProjection[]> {
  return invoke<MessagingMessageProjection[]>('messaging_list_thread_messages', { input });
}

export async function messagingSearchMessages(
  input: MessagingAccountInput & {
    conversationId: string;
    query: string;
    beforeTimestampUnixMs?: number;
    beforeMessageId?: string;
    limit?: number;
  },
): Promise<MessagingMessageProjection[]> {
  return invoke<MessagingMessageProjection[]>('messaging_search_messages', { input });
}

export async function messagingStageAttachment(
  input: MessagingAccountInput & { file: File },
): Promise<MessagingAttachmentStageProjection> {
  const stage = await invoke<MessagingAttachmentStageProjection>(
    'messaging_attachment_stage_begin',
    {
      input: {
        stationPeerId: input.stationPeerId,
        actorPtid: input.actorPtid,
        filename: input.file.name,
        mimeType: input.file.type || 'application/octet-stream',
        plaintextSize: input.file.size,
      },
    },
  );
  try {
    let offset = 0;
    while (offset < input.file.size) {
      const end = Math.min(offset + stage.maxChunkBytes, input.file.size);
      const bytes = Array.from(new Uint8Array(await input.file.slice(offset, end).arrayBuffer()));
      await invoke<MessagingAttachmentStageProjection>('messaging_attachment_stage_write', {
        input: {
          stationPeerId: input.stationPeerId,
          actorPtid: input.actorPtid,
          stageId: stage.stageId,
          offset,
          bytes,
        },
      });
      offset = end;
    }
    return invoke<MessagingAttachmentStageProjection>('messaging_attachment_stage_complete', {
      input: {
        stationPeerId: input.stationPeerId,
        actorPtid: input.actorPtid,
        stageId: stage.stageId,
      },
    });
  } catch (error) {
    await messagingDiscardAttachmentStage({
      stationPeerId: input.stationPeerId,
      actorPtid: input.actorPtid,
      stageId: stage.stageId,
    });
    throw error;
  }
}

export async function messagingDiscardAttachmentStage(
  input: MessagingAccountInput & { stageId: string },
): Promise<void> {
  await invoke('messaging_attachment_stage_discard', { input });
}

export async function messagingSendMessage(
  input: MessagingAccountInput & {
    conversationId: string;
    plaintext: string;
    replyToMessageId?: string;
    threadRootMessageId?: string;
    attachmentStageIds?: string[];
  },
): Promise<MessagingSubmitCommandResult> {
  return invoke<MessagingSubmitCommandResult>('messaging_send_message', { input });
}

export async function messagingOpenAttachment(
  input: MessagingAccountInput & { attachmentId: string },
): Promise<MessagingAttachmentOpenResult> {
  return invoke<MessagingAttachmentOpenResult>('messaging_open_attachment', { input });
}

export async function messagingCancelAttachment(
  input: MessagingAccountInput & { attachmentId: string },
): Promise<void> {
  await invoke('messaging_cancel_attachment', { input });
}

export async function messagingSubmitEdit(
  input: MessagingAccountInput & {
    conversationId: string;
    messageId: string;
    plaintext: string;
  },
): Promise<MessagingPendingCommandResult> {
  return invoke<MessagingPendingCommandResult>('messaging_submit_edit', { input });
}

export async function messagingSubmitMetadataInteraction(
  input: MessagingAccountInput & {
    conversationId: string;
    messageId: string;
    interaction: MessagingMetadataInteraction;
  },
): Promise<MessagingPendingCommandResult> {
  return invoke<MessagingPendingCommandResult>('messaging_submit_metadata_interaction', { input });
}

export async function messagingSubmitReadCursor(
  input: MessagingAccountInput & {
    conversationId: string;
    lastReadSequence: number;
  },
): Promise<{ submitted: boolean }> {
  return invoke<{ submitted: boolean }>('messaging_submit_read_cursor', { input });
}

export async function messagingSubmitTyping(
  input: MessagingAccountInput & { conversationId: string; isTyping: boolean },
): Promise<{ submitted: boolean }> {
  return invoke<{ submitted: boolean }>('messaging_submit_typing', { input });
}

export async function messagingCommandStatus(
  input: MessagingAccountInput & { commandId: string },
): Promise<MessagingCommandStatusProjection> {
  return invoke<MessagingCommandStatusProjection>('messaging_command_status', { input });
}

export async function messagingReconcile(
  input: MessagingAccountInput,
): Promise<MessagingReconcileResult> {
  return invoke<MessagingReconcileResult>('messaging_reconcile', { input });
}

export async function messagingDeactivate(
  input: MessagingAccountInput,
): Promise<MessagingRuntimeStatus> {
  return invoke<MessagingRuntimeStatus>('messaging_deactivate', { input });
}

export interface VerifyStationIdentityProofInput {
  requestedOrigin: string;
  challenge: number[];
  statementBytes: number[];
  hostPublicKey: number[];
  signature: number[];
  requiredCapabilities: string[];
}

export interface VerifiedStationIdentity {
  stationPeerId: string;
  canonicalOrigin: string;
  capabilities: string[];
  verifiedAt: number;
}

export async function verifyStationIdentityProof(
  input: VerifyStationIdentityProofInput,
): Promise<VerifiedStationIdentity> {
  return invoke<VerifiedStationIdentity>('station_identity_verify', { input });
}

export type MobileOAuthProvider = 'github' | 'google';

export type OAuthPublicPhase =
  | 'idle'
  | 'starting'
  | 'awaiting_provider'
  | 'callback_received'
  | 'exchanging'
  | 'following_gate'
  | 'credential_delivery'
  | 'active_session'
  | 'cancelled'
  | 'expired'
  | 'failed';

export interface OAuthStartInput {
  stationOrigin: string;
  stationPeerId: string;
  accessAttemptId: string;
  gateId: string;
  provider: MobileOAuthProvider;
}

export interface OAuthScopeInput {
  stationOrigin: string;
  stationPeerId: string;
}

export interface OAuthCandidateProjection {
  candidateId: string;
  actorPtid: string;
  accessAttemptId: string;
  stationPeerId: string;
  decisionRevision: number;
  issuedAtUnixMs?: number;
  expiresAtUnixMs?: number;
}

export interface OAuthGateActionProjection {
  actionId: string;
  actionType: string;
  submitAction: string;
}

export interface OAuthGateProjection {
  gateId: string;
  gateType: string;
  state: string;
  title: string;
  description: string;
  blockingReason: string;
  submitAction: string;
  inputSchemaJson: string;
  alternativeActions: OAuthGateActionProjection[];
}

export interface OAuthAccessDecisionProjection {
  state: string;
  attemptId: string;
  currentGateId: string;
  gates: OAuthGateProjection[];
  actorPtid?: string;
  accessGrantId: string;
  expiresAtUnixMs?: number;
  message: string;
}

export interface OAuthSessionProjection {
  sessionId: string;
  actorPtid: string;
  expiresAt: string;
}

export interface OAuthPublicProjection {
  phase: OAuthPublicPhase;
  stationPeerId?: string;
  provider?: string;
  accessAttemptId?: string;
  gateId?: string;
  expiresAtUnixMs?: number;
  result?: string;
  errorCode?: string;
  candidate?: OAuthCandidateProjection;
  accessDecision?: OAuthAccessDecisionProjection;
  session?: OAuthSessionProjection;
}

export async function oauthStart(input: OAuthStartInput): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_start', { input });
}

export async function oauthStatus(input: OAuthScopeInput): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_status', { input });
}

export async function oauthCancel(input: OAuthScopeInput): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_cancel', { input });
}

export async function oauthRestore(input: OAuthScopeInput): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_restore', { input });
}

export async function oauthRetryBrowser(): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_retry_browser');
}

export async function oauthProjection(): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_projection');
}
