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
  setReadCursor(conversationId: string, lastReadSeq: number): Promise<void>
  getUnread(conversationId: string): Promise<number>
  getMemberSettings(conversationId: string): Promise<MemberSettingsResult>
  updateMemberSettings(conversationId: string, settings: Partial<MemberSettingsResult>): Promise<void>
  searchMessages(conversationId: string, query: string, limit?: number): Promise<{ events: CommittedConversationEvent[]; hasMore: boolean }>
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
  addAuthorizedMember(input: AddAuthorizedMlsMemberInput): Promise<CommittedConversationEvent>
  addAuthorizedDevice(input: AddAuthorizedMlsMemberInput): Promise<CommittedConversationEvent>
  removeAuthorizedMember(input: RemoveAuthorizedMlsMemberInput): Promise<CommittedConversationEvent>
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
  status(conversationId: string): Promise<{ ready: boolean }>
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

export interface AddAuthorizedMlsMemberInput extends AuthorizedMlsTransitionInput {
  member: MlsGroupGenesisMember
}

export interface RemoveAuthorizedMlsMemberInput extends AuthorizedMlsTransitionInput {
  memberPtid: string
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
  send(recipientPtid: string, sessionId: string, kind: DirectKeyExchangeKind, opaqueKeyMaterial: Uint8Array, recipientStationPeerId?: string): Promise<string>
}

// --- Unified IM Service (aggregates above contracts) ---

export interface IMServiceV1 {
  conversation: ConversationServiceContract
  envelope: EnvelopeServiceContract
  keyPackage: KeyPackageServiceContract
  device: DeviceServiceContract
  mlsGroup: MlsGroupServiceContract
  dkx: DirectKeyExchangeServiceContract
}
