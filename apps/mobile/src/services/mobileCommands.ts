import {
  fromBinary,
  type DescMessage,
  type MessageShape,
} from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';

import {
  AcceptSocialFriendRequestResponseSchema,
  BlockSocialActorResponseSchema,
  RejectSocialFriendRequestResponseSchema,
  SendSocialFriendRequestResponseSchema,
  type AcceptSocialFriendRequestResponse,
  type BlockSocialActorResponse,
  type RejectSocialFriendRequestResponse,
  type SendSocialFriendRequestResponse,
  type UnblockSocialActorResponse,
  UnblockSocialActorResponseSchema,
} from '../gen/proto/domain/social/relationship_pb';
import {
  ImageAttachmentSchema,
  type ImageAttachment,
} from '../gen/proto/domain/social/post_pb';
import {
  notifyReliabilityCommandChanged,
  type CommandState,
  type FriendRequestCommandProjection,
  type SocialRelationshipCommandProjection,
} from '../runtimes/commandRuntime';
import {
  mobileMutationScopeKey,
  requireMobileMutationAdmission,
  type MobileMutationDomain,
} from '../runtimes/mutationAdmission';

export async function setSecureStorageValue(key: string, value: string): Promise<void> {
  await invoke('secure_storage_set', { key, value });
}

export async function getSecureStorageValue(key: string): Promise<string | null> {
  return invoke<string | null>('secure_storage_get', { key });
}

export async function removeSecureStorageValue(key: string): Promise<void> {
  await invoke('secure_storage_remove', { key });
}

export interface NativeMediaPickInput {
  stationPeerId: string;
  actorPtid: string;
  sessionId: string;
  requestId: string;
  surfaceKind: 'chat_attachment' | 'moment_media';
  capability: 'photo_library' | 'camera' | 'document';
  deadlineMs: number;
  acceptedMediaKinds: Array<'image' | 'video' | 'file'>;
  maxItemCount: number;
  maxTotalBytes: number;
}

export interface NativeStagedMediaHandle {
  handle: string;
  mediaKind: 'image' | 'video' | 'file';
  mimeType: string;
  byteLength: number;
  sha256Base64: string;
}

export interface NativeMediaPickProjection {
  requestId: string;
  lifecycleGeneration: number;
  outcome:
    | 'selected'
    | 'cancelled'
    | 'permission_required'
    | 'expired'
    | 'failed';
  items: NativeStagedMediaHandle[];
  errorCode?: string;
}

export async function pickNativeMedia(
  input: NativeMediaPickInput,
): Promise<NativeMediaPickProjection> {
  return invoke<NativeMediaPickProjection>('media_pick', { input });
}

export interface NativeMomentMediaInput {
  stationPeerId: string;
  actorPtid: string;
  sessionId: string;
  handle: string;
}

export async function uploadNativeMomentMedia(
  input: NativeMomentMediaInput,
): Promise<ImageAttachment> {
  requireMobileMutationAdmission(
    mobileMutationScopeKey(input.stationPeerId, input.actorPtid),
    'moments',
  );
  const bytes = await invoke<number[]>('moment_media_upload', { input });
  return fromBinary(ImageAttachmentSchema, Uint8Array.from(bytes));
}

export async function discardNativeMomentMedia(
  input: NativeMomentMediaInput,
): Promise<void> {
  await invoke('moment_media_discard', { input });
}

export interface MessagingAccountInput {
  stationPeerId: string;
  actorPtid: string;
}

export interface MessagingConversationMutationInput extends MessagingAccountInput {
  admissionDomain?: Extract<MobileMutationDomain, 'social' | 'group'>;
}

export interface MessagingActivateInput extends MessagingAccountInput {
  sessionId: string;
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

export type MobileCallSignalKind =
  | 'OFFER'
  | 'ANSWER'
  | 'CANDIDATE'
  | 'HANGUP'
  | 'CALL_REQUEST'
  | 'CALL_ACCEPT'
  | 'CALL_REJECT'
  | 'CALL_END'
  | 'CALL_NO_ANSWER';

export interface MessagingCallSignalInput extends MessagingAccountInput {
  peerPtid: string;
  sessionUlid: string;
  kind: MobileCallSignalKind;
}

export interface MessagingConversationProjection {
  conversationId: string;
  authorityStationId: string;
  federationId: string;
  kind: number;
  name: string;
  description?: string;
  ownerPtid: string;
  memberPtids: string[];
  members: MessagingMemberAuthorityMemberProjection[];
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

export interface MessagingMembershipTransitionInput extends MessagingAccountInput {
  conversationId: string;
  action: 'add_actor' | 'remove_actor' | 'add_device' | 'remove_device';
  targetPtid: string;
  targetDeviceId?: string;
  role?: 'member' | 'admin' | 'owner';
}

export interface MessagingPendingConversationCommandResult {
  commandId: string;
  state: 'pending';
}

export interface MessagingMemberAuthorityMemberProjection {
  ptid: string;
  role: number;
  homeStationPeerId: string;
  muted: boolean;
  mutedUntilUnixMs?: number;
}

export interface MessagingMemberAuthorityResult {
  commandId: string;
  conversationId: string;
  ownerPtid?: string;
  members?: MessagingMemberAuthorityMemberProjection[];
  authoritySequence?: number;
  authorityHash?: number[];
  membershipEpoch?: number;
  mlsEpoch?: number;
  state: 'pending' | 'projected';
}

export interface MessagingUpdateMemberAuthorityInput extends MessagingAccountInput {
  conversationId: string;
  targetPtid: string;
  role?: 'member' | 'admin';
  muted?: boolean;
  mutedUntilUnixMs?: number;
}

export interface MessagingTransferOwnershipInput extends MessagingAccountInput {
  conversationId: string;
  nextOwnerPtid: string;
}

export interface MessagingUpdateConversationInput extends MessagingAccountInput {
  conversationId: string;
  name?: string;
  description?: string;
}

export interface MessagingSubmitLeaveIntentInput extends MessagingAccountInput {
  conversationId: string;
}

export interface MessagingLeaveIntentSubmissionResult {
  intentId: string;
  state: 'pending';
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

export interface ReliableFriendRequestResult<Response> {
  commandId: string;
  requestId: string;
  payloadSha256: readonly number[];
  state: CommandState;
  response: Response | null;
  checkpointReady: boolean;
}

export interface SocialRelationshipMutationInput extends MessagingAccountInput {
  targetPtid: string;
  targetHomeStationPeerId: string;
  observedRevision: number;
}

export interface ReliableRelationshipResult<Response> {
  commandId: string;
  targetPtid: string;
  payloadSha256: readonly number[];
  state: CommandState;
  response: Response | null;
  checkpointReady: boolean;
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
  voiceNote?: MessagingVoiceNoteMetadata;
}

export interface MessagingVoiceNoteMetadata {
  durationMs: number;
  codec: string;
  waveform: number[];
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
  moderated: boolean;
  moderationReasonCode?: string;
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

export interface MessagingConversationSummary {
  lastMessage: MessagingMessageProjection | null;
  unreadCount: number;
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
  voiceNote?: MessagingVoiceNoteMetadata;
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
  | { kind: 'hideForActor' }
  | { kind: 'moderate'; reasonCode: string }
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

export async function messagingCallSignalSeal(
  input: MessagingCallSignalInput & { plaintext: string },
): Promise<string> {
  const result = await invoke<{ payloadBase64: string }>(
    'messaging_call_signal_seal',
    { input },
  );
  return result.payloadBase64;
}

export async function messagingCallSignalOpen(
  input: MessagingCallSignalInput & { payload: number[] },
): Promise<string> {
  const result = await invoke<{ plaintext: string }>(
    'messaging_call_signal_open',
    { input },
  );
  return result.plaintext;
}

export async function socialFriendRequestSend(
  input: SocialFriendRequestSendInput,
): Promise<ReliableFriendRequestResult<SendSocialFriendRequestResponse>> {
  requireMessagingMutation(input, 'social');
  const projection = await invoke<FriendRequestCommandProjection>(
    'social_friend_request_send',
    { input },
  );
  notifyReliabilityCommandChanged();
  return decodeReliableFriendRequestResult(
    projection,
    SendSocialFriendRequestResponseSchema,
  );
}

export async function socialFriendRequestAccept(
  input: SocialFriendRequestDecisionInput,
): Promise<ReliableFriendRequestResult<AcceptSocialFriendRequestResponse>> {
  requireMessagingMutation(input, 'social');
  const projection = await invoke<FriendRequestCommandProjection>(
    'social_friend_request_accept',
    { input },
  );
  notifyReliabilityCommandChanged();
  return decodeReliableFriendRequestResult(
    projection,
    AcceptSocialFriendRequestResponseSchema,
  );
}

export async function socialFriendRequestReject(
  input: SocialFriendRequestDecisionInput,
): Promise<ReliableFriendRequestResult<RejectSocialFriendRequestResponse>> {
  requireMessagingMutation(input, 'social');
  const projection = await invoke<FriendRequestCommandProjection>(
    'social_friend_request_reject',
    { input },
  );
  notifyReliabilityCommandChanged();
  return decodeReliableFriendRequestResult(
    projection,
    RejectSocialFriendRequestResponseSchema,
  );
}

function decodeReliableFriendRequestResult<Desc extends DescMessage>(
  projection: FriendRequestCommandProjection,
  schema: Desc,
): ReliableFriendRequestResult<MessageShape<Desc>> {
  return {
    commandId: projection.commandId,
    requestId: projection.requestId,
    payloadSha256: projection.payloadSha256,
    state: projection.state,
    response: projection.responseBytes
      ? fromBinary(schema, Uint8Array.from(projection.responseBytes))
      : null,
    checkpointReady: projection.checkpointReady,
  };
}

export async function socialRelationshipBlock(
  input: SocialRelationshipMutationInput,
): Promise<ReliableRelationshipResult<BlockSocialActorResponse>> {
  requireMessagingMutation(input, 'social');
  const projection = await invoke<SocialRelationshipCommandProjection>(
    'social_relationship_block',
    { input },
  );
  notifyReliabilityCommandChanged();
  return decodeReliableRelationshipResult(
    projection,
    BlockSocialActorResponseSchema,
  );
}

export async function socialRelationshipUnblock(
  input: SocialRelationshipMutationInput,
): Promise<ReliableRelationshipResult<UnblockSocialActorResponse>> {
  requireMessagingMutation(input, 'social');
  const projection = await invoke<SocialRelationshipCommandProjection>(
    'social_relationship_unblock',
    { input },
  );
  notifyReliabilityCommandChanged();
  return decodeReliableRelationshipResult(
    projection,
    UnblockSocialActorResponseSchema,
  );
}

function decodeReliableRelationshipResult<Desc extends DescMessage>(
  projection: SocialRelationshipCommandProjection,
  schema: Desc,
): ReliableRelationshipResult<MessageShape<Desc>> {
  return {
    commandId: projection.commandId,
    targetPtid: projection.targetPtid,
    payloadSha256: projection.payloadSha256,
    state: projection.state,
    response: projection.responseBytes
      ? fromBinary(schema, Uint8Array.from(projection.responseBytes))
      : null,
    checkpointReady: projection.checkpointReady,
  };
}

export async function messagingCreateDirect(
  input: MessagingCreateDirectInput,
): Promise<MessagingCreateDirectResult> {
  requireMessagingMutation(input, 'social');
  return invoke<MessagingCreateDirectResult>('messaging_create_direct', { input });
}

export async function messagingCreateGroup(
  input: MessagingCreateGroupInput,
): Promise<MessagingCreateGroupResult> {
  requireMessagingMutation(input, 'group');
  return invoke<MessagingCreateGroupResult>('messaging_create_group', { input });
}

export async function messagingMembershipTransition(
  input: MessagingMembershipTransitionInput,
): Promise<MessagingPendingConversationCommandResult> {
  requireMessagingMutation(input, 'group');
  return invoke<MessagingPendingConversationCommandResult>(
    'messaging_membership_transition',
    { input },
  );
}

export async function messagingUpdateConversation(
  input: MessagingUpdateConversationInput,
): Promise<MessagingPendingConversationCommandResult> {
  requireMessagingMutation(input, 'group');
  return invoke<MessagingPendingConversationCommandResult>(
    'messaging_update_conversation',
    { input },
  );
}

export async function messagingDissolveConversation(
  input: MessagingAccountInput & { conversationId: string },
): Promise<MessagingPendingConversationCommandResult> {
  requireMessagingMutation(input, 'group');
  return invoke<MessagingPendingConversationCommandResult>(
    'messaging_dissolve_conversation',
    { input },
  );
}

export async function messagingUpdateMemberAuthority(
  input: MessagingUpdateMemberAuthorityInput,
): Promise<MessagingMemberAuthorityResult> {
  requireMessagingMutation(input, 'group');
  return invoke<MessagingMemberAuthorityResult>(
    'messaging_update_member_authority',
    { input },
  );
}

export async function messagingTransferOwnership(
  input: MessagingTransferOwnershipInput,
): Promise<MessagingMemberAuthorityResult> {
  requireMessagingMutation(input, 'group');
  return invoke<MessagingMemberAuthorityResult>(
    'messaging_transfer_ownership',
    { input },
  );
}

export async function messagingSubmitLeaveIntent(
  input: MessagingSubmitLeaveIntentInput,
): Promise<MessagingLeaveIntentSubmissionResult> {
  requireMessagingMutation(input, 'group');
  return invoke<MessagingLeaveIntentSubmissionResult>(
    'messaging_submit_leave_intent',
    { input },
  );
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

export async function messagingConversationSummary(
  input: MessagingAccountInput & { conversationId: string },
): Promise<MessagingConversationSummary> {
  return invoke<MessagingConversationSummary>('messaging_conversation_summary', { input });
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
  input: MessagingAccountInput & {
    file: File;
    voiceNote?: MessagingVoiceNoteMetadata;
  },
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
        voiceNote: input.voiceNote,
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
  input: MessagingConversationMutationInput & {
    conversationId: string;
    plaintext: string;
    replyToMessageId?: string;
    threadRootMessageId?: string;
    attachmentStageIds?: string[];
  },
): Promise<MessagingSubmitCommandResult> {
  requireMessagingMutation(input, input.admissionDomain);
  const { admissionDomain: _admissionDomain, ...commandInput } = input;
  return invoke<MessagingSubmitCommandResult>(
    'messaging_send_message',
    { input: commandInput },
  );
}

export async function messagingForwardMessage(
  input: MessagingConversationMutationInput & {
    sourceConversationId: string;
    sourceMessageId: string;
    destinationConversationId: string;
  },
): Promise<MessagingSubmitCommandResult> {
  requireMessagingMutation(input, input.admissionDomain);
  const { admissionDomain: _admissionDomain, ...commandInput } = input;
  return invoke<MessagingSubmitCommandResult>(
    'messaging_forward_message',
    { input: commandInput },
  );
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
  input: MessagingConversationMutationInput & {
    conversationId: string;
    messageId: string;
    plaintext: string;
  },
): Promise<MessagingPendingCommandResult> {
  requireMessagingMutation(input, input.admissionDomain);
  const { admissionDomain: _admissionDomain, ...commandInput } = input;
  return invoke<MessagingPendingCommandResult>(
    'messaging_submit_edit',
    { input: commandInput },
  );
}

export async function messagingSubmitMetadataInteraction(
  input: MessagingConversationMutationInput & {
    conversationId: string;
    messageId: string;
    interaction: MessagingMetadataInteraction;
  },
): Promise<MessagingPendingCommandResult> {
  requireMessagingMutation(input, input.admissionDomain);
  const { admissionDomain: _admissionDomain, ...commandInput } = input;
  return invoke<MessagingPendingCommandResult>(
    'messaging_submit_metadata_interaction',
    { input: commandInput },
  );
}

export async function messagingSubmitReadCursor(
  input: MessagingConversationMutationInput & {
    conversationId: string;
    lastReadSequence: number;
  },
): Promise<{ submitted: boolean }> {
  requireMessagingMutation(input, input.admissionDomain);
  const { admissionDomain: _admissionDomain, ...commandInput } = input;
  return invoke<{ submitted: boolean }>(
    'messaging_submit_read_cursor',
    { input: commandInput },
  );
}

export async function messagingSubmitTyping(
  input: MessagingConversationMutationInput & {
    conversationId: string;
    isTyping: boolean;
  },
): Promise<{ submitted: boolean }> {
  requireMessagingMutation(input, input.admissionDomain);
  const { admissionDomain: _admissionDomain, ...commandInput } = input;
  return invoke<{ submitted: boolean }>(
    'messaging_submit_typing',
    { input: commandInput },
  );
}

function requireMessagingMutation(
  input: MessagingAccountInput,
  domain?: MobileMutationDomain,
): void {
  requireMobileMutationAdmission(
    mobileMutationScopeKey(input.stationPeerId, input.actorPtid),
    domain,
  );
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
  schemaRevision: number;
  schemaDigest: string;
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
  actionId: string;
  schemaRevision: number;
  schemaDigest: string;
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

export interface NativeAccessStartInput {
  stationOrigin: string;
  stationPeerId: string;
  locale?: string;
  sessionId?: string;
}

export interface NativeAccessDecisionInput {
  stationOrigin: string;
  stationPeerId: string;
  attemptId: string;
}

export type NativeGenericScalar =
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'integer'; value: number }
  | { kind: 'number'; value: number };

export interface NativeGenericFieldValue {
  fieldName: string;
  value: NativeGenericScalar;
}

export type NativeAccessGateInput =
  | { kind: 'login'; email: string; password: string }
  | { kind: 'invite_code'; inviteCode: string }
  | { kind: 'session_restore'; sessionId: string }
  | { kind: 'device_trust'; attestationHandle: string }
  | { kind: 'generic'; fields: NativeGenericFieldValue[] };

export interface NativeAccessSubmitInput extends NativeAccessDecisionInput {
  gateId: string;
  gateType: number;
  actionId: string;
  schemaRevision: number;
  schemaDigest: string;
  submissionId: string;
  input: NativeAccessGateInput;
}

export interface NativeAccessProjection {
  decision: OAuthAccessDecisionProjection;
  stationLabel?: string;
  session?: OAuthSessionProjection;
}

export async function accessStart(
  input: NativeAccessStartInput,
): Promise<NativeAccessProjection> {
  return invoke<NativeAccessProjection>('access_start', { input });
}

export async function accessDecision(
  input: NativeAccessDecisionInput,
): Promise<NativeAccessProjection> {
  return invoke<NativeAccessProjection>('access_decision', { input });
}

export async function accessSubmit(
  input: NativeAccessSubmitInput,
): Promise<NativeAccessProjection> {
  return invoke<NativeAccessProjection>('access_submit', { input });
}

export async function accessCancel(
  input: NativeAccessDecisionInput,
): Promise<boolean> {
  return invoke<boolean>('access_cancel', { input });
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
