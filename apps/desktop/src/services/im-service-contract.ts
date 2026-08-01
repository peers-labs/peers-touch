import type {
  Conversation,
  ConversationCommand,
  ConversationMember,
  CommittedConversationEvent,
  ReceiptType,
} from '../gen/proto/domain/chat/conversation_pb'

import type {
  StationEnvelope,
  DeviceInboxItem,
} from '../gen/proto/domain/chat/envelope_pb'

import {
  MlsDeliveryKind,
  DirectKeyExchangeKind,
} from '../gen/proto/domain/chat/envelope_pb'

import type { DeviceInfoView } from '../gen/proto/domain/chat/conversation_api_pb'

export { MlsDeliveryKind, DirectKeyExchangeKind }
export type DeviceInfo = DeviceInfoView

// --- Conversation Service Contract (v1) ---

export interface ConversationServiceContract {
  createDirect(peerPtid: string, peerStationPeerId?: string): Promise<Conversation>
  createGroup(name: string, members: { ptid: string; stationId?: string }[]): Promise<Conversation>
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
  fetch(ptid: string, homeStationPeerId?: string): Promise<{ data: Uint8Array | null; available: boolean }>
  countAvailable(): Promise<number>
}

// --- Device Service Contract (v1) ---

export interface DeviceServiceContract {
  register(deviceId: string, label?: string, publicKey?: Uint8Array): Promise<void>
  list(): Promise<DeviceInfo[]>
  revoke(deviceId: string): Promise<void>
}

// --- MLS Group Service Contract (v1, P3) ---

export interface MlsGroupServiceContract {
  initIdentity(ptid: string): Promise<void>
  generateKeyPackage(): Promise<Uint8Array>
  createGroup(conversationId: string, memberKeyPackages: Uint8Array[]): Promise<MlsGroupCreateResult>
  joinGroup(conversationId: string, welcomeBytes: Uint8Array): Promise<void>
  encrypt(conversationId: string, plaintext: Uint8Array): Promise<Uint8Array>
  decrypt(conversationId: string, ciphertext: Uint8Array): Promise<Uint8Array>
  processCommit(conversationId: string, commitBytes: Uint8Array): Promise<void>
  addMember(conversationId: string, memberKeyPackage: Uint8Array): Promise<MlsMemberChangeResult>
  removeMember(conversationId: string, memberActorDid: string): Promise<Uint8Array>
  status(conversationId: string): Promise<{ ready: boolean }>
  distribute(conversationId: string, kind: MlsDeliveryKind, mlsEpoch: number, opaqueBytes: Uint8Array, recipients?: string[]): Promise<number>
  save(conversationId: string): Promise<void>
  load(conversationId: string): Promise<void>
}

export interface MlsGroupCreateResult {
  groupId: string
  welcomeBytes: Uint8Array
  commitBytes: Uint8Array
}

export interface MlsMemberChangeResult {
  commitBytes: Uint8Array
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
