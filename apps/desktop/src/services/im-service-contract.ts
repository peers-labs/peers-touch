import type {
  Conversation,
  ConversationMember,
} from '../gen/proto/domain/chat/conversation_pb'
import type { ConversationEvent } from '../gen/proto/domain/chat/event_pb'
import type { ActorDevice } from '../gen/proto/domain/actor/actor_pb'

export type DeviceInfo = ActorDevice

// --- Conversation Service Contract (v1) ---

export interface ConversationServiceContract {
  getConversation(conversationId: string): Promise<Conversation>
  listConversations(): Promise<Conversation[]>
  getMembers(conversationId: string): Promise<ConversationMember[]>
  listEvents(conversationId: string, afterSeq?: number, limit?: number): Promise<ConversationEvent[]>
  listMessages(conversationId: string, afterSeq?: number, limit?: number): Promise<{ events: ConversationEvent[]; hasMore: boolean }>
  listThreadMessages(conversationId: string, rootId: string, afterSeq?: number, limit?: number): Promise<{ events: ConversationEvent[]; hasMore: boolean }>
  syncFromStation(conversationId: string, limit?: number): Promise<{ events: ConversationEvent[]; hasMore: boolean }>
}

export interface ThreadCountResult {
  rootUlid: string
  replyCount: number
  latestReplyUlid: string
  latestReplyAt: number
  unreadCount: number
}

export interface MemberSettingsResult {
  nickname: string
  muted: boolean
  alertEnabled: boolean
  pinned: boolean
  background: string
  backgroundImage: string
  clearedAtUnixMs: number
}

// --- KeyPackage Service Contract (v1) ---

export interface KeyPackageServiceContract {
  upload(deviceId: string, data: Uint8Array): Promise<void>
  fetch(ptid: string, homeStationPeerId?: string): Promise<KeyPackageFetchResult>
  countAvailable(): Promise<number>
}

export interface KeyPackageFetchResult {
  data: Uint8Array | null
  available: boolean
  deviceId: string
  homeStationPeerId: string
}

// --- Device Service Contract (v1) ---

export interface DeviceServiceContract {
  list(): Promise<DeviceInfo[]>
  revoke(deviceId: string): Promise<void>
}

export interface MlsLeaveIntentView {
  version: number
  intentId: string
  federationId: string
  authorityStationPeerId: string
  authorityEpoch: number
  homeStationPeerId: string
  conversationId: string
  actorPtid: string
  actorDeviceId: string
  actorSigningKeyId: string
  observedMembershipEpoch: number
  observedMlsEpoch: number
  createdAtUnixMs: number
  expiresAtUnixMs: number
  actorSignature: Uint8Array
  authoritySequence: number
  authorityHash: Uint8Array
}

export interface RequestMlsLeaveIntentInput {
  federationId: string
  authorityStationPeerId: string
  authorityEpoch: number
  homeStationPeerId: string
  conversationId: string
  observedMembershipEpoch: number
  observedMlsEpoch: number
}

export interface CommitAuthorizedMlsLeaveInput {
  intent: MlsLeaveIntentView
}

export interface MessagingProjection {
  eventId?: string
  eventSequence?: number
  messageId: string
  senderPtid: string
  senderDeviceId: string
  plaintext: string
  attachments: MessagingAttachmentProjection[]
  state: string
  timestampUnixMs: number
  replyToMessageId?: string
  threadRootMessageId?: string
  editedText?: string
  editedAtUnixMs?: number
  retracted: boolean
  reactions: MessagingReactionProjection[]
  pinnedByPtid?: string
  pinnedAtUnixMs?: number
  readByPtids: string[]
}

export interface MessagingReactionProjection {
  actorPtid: string
  reaction: string
  createdAtUnixMs: number
}

export interface MessagingAttachmentProjection {
  attachmentId: string
  filename: string
  mimeType: string
  plaintextSize: number
  objectId: string
  storageRef: string
  ciphertextSize: number
  availabilityState: 'uploading' | 'remote' | 'local' | 'failed'
}

export interface MessagingLocalAttachmentIntent {
  filePath: string
  filename: string
  mimeType: string
  size?: number
}

export type MessagingSendState = 'draft' | 'pending' | 'attachment_failed'

export interface MessagingSendOutcome {
  commandId?: string
  messageId: string
  attachmentIds: string[]
  attachmentCount: number
  state: MessagingSendState
}

export interface MessagingSendOutcomeRecord {
  revision: number
  outcome: MessagingSendOutcome
}

export type MessagingQueuedSendOutcome = MessagingSendOutcome & {
  commandId: string
  state: 'pending'
}

export interface MessagingConversationProjection {
  conversationId: string
  authorityStationId: string
  kind: 1 | 2
  name: string
  ownerPtid: string
  members: ConversationMember[]
  membershipEpoch: number
  mlsEpoch: number
  mlsStatus: 'idle' | 'active' | 'establishing' | 'crypto_desynced' | null
  active: boolean
  updatedAtUnixMs: number
}

export interface MessagingCommandStatus {
  commandId: string
  conversationId: string
  state: 'pending' | 'retry_wait' | 'submitted' | 'committed' | 'failed' | 'superseded'
  lastErrorCode: string
}

export interface CreateDirectConversationInput {
  peerPtid: string
  federationId: string
}

export interface MessagingServiceContract {
  createDirect(
    input: CreateDirectConversationInput,
  ): Promise<{ conversationId: string; state: 'projected' }>
  createGroup(
    conversationId: string,
    name: string,
    memberPtids: string[],
    federationId: string,
  ): Promise<{
    conversationId: string
    commandId: string
    state: 'pending' | 'projected' | 'failed'
  }>
  submitMembershipIntent(
    intent: MessagingActorMembershipIntent,
  ): Promise<{ commandId: string; state: 'pending' }>
  requestLeaveIntent(input: RequestMlsLeaveIntentInput): Promise<MlsLeaveIntentView>
  listLeaveIntents(conversationId: string): Promise<MlsLeaveIntentView[]>
  commitAuthorizedLeave(
    input: CommitAuthorizedMlsLeaveInput,
  ): Promise<{ commandId: string; state: 'pending' }>
  getCommandStatus(commandId: string): Promise<MessagingCommandStatus>
  listConversations(): Promise<MessagingConversationProjection[]>
  pickAttachmentSource(): Promise<MessagingLocalAttachmentIntent>
  stageAttachmentSource(filename: string, bytes: Uint8Array): Promise<string>
  discardAttachmentSource(filePath: string): Promise<void>
  captureAttachmentSource(): Promise<MessagingLocalAttachmentIntent>
  sendMessage(
    conversationId: string,
    conversationKind: 'direct' | 'group',
    plaintext: string,
    attachments?: readonly MessagingLocalAttachmentIntent[],
    relation?: {
      replyToMessageId?: string
      threadRootMessageId?: string
    },
  ): Promise<MessagingSendOutcome>
  listMessages(conversationId: string): Promise<MessagingProjection[]>
  listThreadMessages(
    conversationId: string,
    threadRootMessageId: string,
  ): Promise<MessagingProjection[]>
  threadCounts(
    conversationId: string,
    rootMessageIds: string[],
  ): Promise<{ counts: ThreadCountResult[] }>
  getMemberSettings(conversationId: string): Promise<MemberSettingsResult>
  updateMemberSettings(
    conversationId: string,
    settings: Partial<MemberSettingsResult>,
  ): Promise<MemberSettingsResult>
  searchMessages(
    conversationId: string,
    query: string,
    options?: {
      beforeTimestampUnixMs?: number
      beforeMessageId?: string
      limit?: number
    },
  ): Promise<MessagingProjection[]>
  openAttachment(attachmentId: string): Promise<string>
}

export type MessagingActorMembershipIntent =
  | {
      conversationId: string
      action: 'add_actor'
      targetPtid: string
      role?: string
    }
  | {
      conversationId: string
      action: 'remove_actor'
      targetPtid: string
    }
  | {
      conversationId: string
      action: 'add_device'
      targetPtid: string
      targetDeviceId: string
    }
  | {
      conversationId: string
      action: 'remove_device'
      targetPtid: string
      targetDeviceId: string
    }

// --- Unified IM Service (aggregates above contracts) ---

export interface IMServiceV1 {
  conversation: ConversationServiceContract
  keyPackage: KeyPackageServiceContract
  device: DeviceServiceContract
  messaging: MessagingServiceContract
}
