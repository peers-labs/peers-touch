import type {
  Conversation,
  ConversationCommand,
  ConversationMember,
  CommittedConversationEvent,
  MembershipTransitionCommand,
  ReceiptType,
} from '../gen/proto/domain/chat/conversation_pb'

import type {
  StationEnvelope,
  DeviceInboxItem,
} from '../gen/proto/domain/chat/envelope_pb'

import { DirectKeyExchangeKind } from '../gen/proto/domain/chat/envelope_pb'

import type { DeviceInfoView } from '../gen/proto/domain/chat/conversation_api_pb'

export { DirectKeyExchangeKind }
export type DeviceInfo = DeviceInfoView

// --- Conversation Service Contract (v1) ---

export interface ConversationServiceContract {
  createDirect(peerPtid: string, peerStationPeerId?: string): Promise<Conversation>
  createGroup(input: CreateGroupConversationInput): Promise<CreateGroupConversationResult>
  submitCommand(command: ConversationCommand): Promise<CommittedConversationEvent>
  submitReceipt(conversationId: string, messageId: string, receiptType: ReceiptType): Promise<void>
  react(conversationId: string, messageId: string, emoji: string, remove?: boolean): Promise<void>
  getConversation(conversationId: string): Promise<Conversation>
  listConversations(): Promise<Conversation[]>
  getMembers(conversationId: string): Promise<ConversationMember[]>
  listEvents(conversationId: string, afterSeq?: number, limit?: number): Promise<CommittedConversationEvent[]>
  listMessages(conversationId: string, afterSeq?: number, limit?: number): Promise<{ events: CommittedConversationEvent[]; hasMore: boolean }>
  listThreadMessages(conversationId: string, rootId: string, afterSeq?: number, limit?: number): Promise<{ events: CommittedConversationEvent[]; hasMore: boolean }>
  threadCounts(conversationId: string, rootIds: string[]): Promise<{ counts: ThreadCountResult[] }>
  getMemberSettings(conversationId: string): Promise<MemberSettingsResult>
  updateMemberSettings(
    conversationId: string,
    settings: Partial<MemberSettingsResult>,
  ): Promise<MemberSettingsResult>
  syncFromStation(conversationId: string, limit?: number): Promise<{ events: CommittedConversationEvent[]; hasMore: boolean }>
}

export interface CreateGroupConversationInput {
  conversationId: string
  name: string
  federationId?: string
  genesisTransition: MembershipTransitionCommand
}

export interface CreateGroupConversationResult {
  conversation: Conversation
  transitionEvent: CommittedConversationEvent
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

// --- Envelope Service Contract (v1) ---

export interface EnvelopeServiceContract {
  submit(envelope: StationEnvelope): Promise<string>
  ack(deviceId: string, inboxItemId: string): Promise<void>
  resume(deviceId: string, afterCursor?: string): Promise<DeviceInboxItem[]>
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
  register(
    deviceId: string,
    label?: string,
    publicKey?: Uint8Array,
    signingKeyId?: string,
  ): Promise<void>
  list(): Promise<DeviceInfo[]>
  revoke(deviceId: string): Promise<void>
}

// --- MLS Group Service Contract (v1, P3) ---

export interface MlsGroupServiceContract {
  initIdentity(ptid: string, deviceId: string): Promise<MlsSigningIdentity>
  generateKeyPackage(): Promise<Uint8Array>
  createGroup(conversationId: string, members: MlsGroupGenesisMember[]): Promise<MlsGroupCreateResult>
  createAuthorizedGroup(input: CreateAuthorizedMlsGroupInput): Promise<CreateGroupConversationResult>
  addAuthorizedDevice(input: AddAuthorizedMlsDeviceInput): Promise<CommittedConversationEvent>
  removeAuthorizedDevice(input: RemoveAuthorizedMlsDeviceInput): Promise<CommittedConversationEvent>
  requestLeaveIntent(input: RequestMlsLeaveIntentInput): Promise<MlsLeaveIntentView>
  listLeaveIntents(conversationId: string): Promise<MlsLeaveIntentView[]>
  commitAuthorizedLeave(input: CommitAuthorizedMlsLeaveInput): Promise<CommittedConversationEvent>
  joinGroup(conversationId: string, welcomeBytes: Uint8Array): Promise<void>
  encrypt(conversationId: string, plaintext: Uint8Array): Promise<Uint8Array>
  decrypt(conversationId: string, ciphertext: Uint8Array): Promise<Uint8Array>
  processCommit(conversationId: string, commitBytes: Uint8Array): Promise<void>
  addMember(conversationId: string, member: MlsGroupGenesisMember): Promise<MlsMemberChangeResult>
  removeMember(conversationId: string, memberPtid: string): Promise<MlsMemberChangeResult>
  removeDevice(
    conversationId: string,
    memberPtid: string,
    deviceId: string,
  ): Promise<MlsMemberChangeResult>
  acceptPending(conversationId: string, transitionId: string): Promise<void>
  discardPending(conversationId: string): Promise<boolean>
  pendingStatus(conversationId: string): Promise<boolean>
  recordAuthorityEvent(
    eventBytes: Uint8Array,
    recipientDeviceId: string,
  ): Promise<MlsRecipientApplyResult>
  applyTransitionDelivery(
    deliveryBytes: Uint8Array,
    recipientDeviceId: string,
  ): Promise<MlsRecipientApplyResult>
  recipientStatus(conversationId: string): Promise<MlsRecipientStatusResult>
  publicHead(conversationId: string): Promise<MlsPublicHead>
  save(conversationId: string): Promise<void>
  load(conversationId: string): Promise<void>
}

export interface MlsRecipientApplyResult {
  status: 'active' | 'establishing'
  applied: number
  duplicate: boolean
  buffered: number
}

export interface MlsRecipientStatusResult {
  status: 'idle' | 'active' | 'establishing' | 'crypto_desynced'
  groupSeq: number
  membershipEpoch: number
  mlsEpoch: number
  buffered: number
  lastError: string
}

export interface AuthorizedMlsTransitionInput {
  conversationId: string
  senderPtid: string
  senderDeviceId: string
  observedMembershipEpoch: number
}

export interface AddAuthorizedMlsDeviceInput extends AuthorizedMlsTransitionInput {
  member: MlsGroupGenesisMember
}

export interface RemoveAuthorizedMlsDeviceInput extends AuthorizedMlsTransitionInput {
  memberPtid: string
  memberDeviceId: string
}

export interface MlsSigningIdentity {
  ptid: string
  signingKeyId: string
  publicKey: Uint8Array
}

export interface MlsPublicHead {
  conversationId: string
  mlsEpoch: number
  groupContextSha256: string
  ratchetTreeSha256: string
  memberCredentialsSha256: string
  members: Array<{ ptid: string; deviceId: string }>
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
}

export interface RequestMlsLeaveIntentInput {
  federationId: string
  authorityStationPeerId: string
  authorityEpoch: number
  homeStationPeerId: string
  conversationId: string
  actorPtid: string
  actorDeviceId: string
  observedMembershipEpoch: number
  observedMlsEpoch: number
}

export interface CommitAuthorizedMlsLeaveInput extends AuthorizedMlsTransitionInput {
  intent: MlsLeaveIntentView
}

export interface CreateAuthorizedMlsGroupInput {
  conversationId: string
  name: string
  federationId?: string
  ownerPtid: string
  ownerDeviceId: string
  ownerHomeStationPeerId?: string
  members: MlsGroupGenesisMember[]
}

export interface MlsGroupGenesisMember {
  ptid: string
  deviceId: string
  homeStationPeerId: string
  keyPackage: Uint8Array
}

export interface MlsGroupCreateResult {
  groupId: string
  transitionId: string
  fromMlsEpoch: number
  toMlsEpoch: number
  welcomeBytes: Uint8Array
  commitBytes: Uint8Array
  commitSha256: Uint8Array
}

export interface MlsMemberChangeResult {
  transitionId: string
  fromMlsEpoch: number
  toMlsEpoch: number
  commitBytes: Uint8Array
  commitSha256: Uint8Array
  welcomeBytes: Uint8Array
}

// --- Direct Key Exchange Service Contract (v1, P2) ---

export interface DirectKeyExchangeServiceContract {
  send(
    recipientPtid: string,
    recipientDeviceId: string,
    conversationId: string,
    sessionId: string,
    kind: DirectKeyExchangeKind,
    opaqueKeyMaterial: Uint8Array,
    recipientStationPeerId?: string,
  ): Promise<string>
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
  memberPtids: string[]
  membershipEpoch: number
  mlsEpoch: number
  active: boolean
  updatedAtUnixMs: number
}

export interface MessagingServiceContract {
  createDirect(peerPtid: string): Promise<{ conversationId: string; state: 'projected' }>
  createGroup(
    conversationId: string,
    name: string,
    memberPtids: string[],
  ): Promise<{ conversationId: string; state: 'projected' }>
  submitMembershipIntent(
    intent: MessagingActorMembershipIntent,
  ): Promise<{ commandId: string; state: 'pending' }>
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
    }
  | {
      conversationId: string
      action: 'remove_actor'
      targetPtid: string
    }

// --- Unified IM Service (aggregates above contracts) ---

export interface IMServiceV1 {
  conversation: ConversationServiceContract
  envelope: EnvelopeServiceContract
  keyPackage: KeyPackageServiceContract
  device: DeviceServiceContract
  mlsGroup: MlsGroupServiceContract
  dkx: DirectKeyExchangeServiceContract
  messaging: MessagingServiceContract
}
