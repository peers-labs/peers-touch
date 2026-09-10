import { invoke } from '@tauri-apps/api/core'
import { fromJson } from '@bufbuild/protobuf'
import type { JsonValue } from '@bufbuild/protobuf'
import { RustCommandException, type RustCommandResult } from './desktop_api'
import type {
  ConversationServiceContract,
  KeyPackageServiceContract,
  DeviceServiceContract,
  DeviceInfo,
  IMServiceV1,
  ThreadCountResult,
  MemberSettingsResult,
  MlsLeaveIntentView,
  MessagingConversationProjection,
  MessagingProjection,
  MessagingServiceContract,
} from './im-service-contract'
import type { Conversation } from '../gen/proto/domain/chat/conversation_pb'
import {
  ConversationMemberSchema,
  ConversationSchema,
} from '../gen/proto/domain/chat/conversation_pb'
import {
  ConversationEventSchema,
  type ConversationEvent,
} from '../gen/proto/domain/chat/event_pb'

async function cmd<TInput, TData>(command: string, input?: TInput): Promise<TData> {
  const payload = input === undefined ? undefined : { input }
  const result = await invoke<RustCommandResult<TData>>(command, payload)
  if (!result.ok) {
    throw new RustCommandException(command, result.error)
  }
  return result.data as TData
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0))
}

interface MlsLeaveIntentWire {
  version: number
  intent_id: string
  federation_id: string
  authority_station_peer_id: string
  authority_epoch: number
  home_station_peer_id: string
  conversation_id: string
  actor_ptid: string
  actor_device_id: string
  actor_signing_key_id: string
  observed_membership_epoch: number
  observed_mls_epoch: number
  created_at_unix_ms: number
  expires_at_unix_ms: number
  actor_signature?: readonly number[]
  authority_sequence: number
  authority_hash?: readonly number[]
}

function normalizeLeaveIntent(value: MlsLeaveIntentWire): MlsLeaveIntentView {
  return {
    version: Number(value.version),
    intentId: value.intent_id,
    federationId: value.federation_id,
    authorityStationPeerId: value.authority_station_peer_id,
    authorityEpoch: Number(value.authority_epoch),
    homeStationPeerId: value.home_station_peer_id,
    conversationId: value.conversation_id,
    actorPtid: value.actor_ptid,
    actorDeviceId: value.actor_device_id,
    actorSigningKeyId: value.actor_signing_key_id,
    observedMembershipEpoch: Number(value.observed_membership_epoch),
    observedMlsEpoch: Number(value.observed_mls_epoch),
    createdAtUnixMs: Number(value.created_at_unix_ms),
    expiresAtUnixMs: Number(value.expires_at_unix_ms),
    actorSignature: new Uint8Array(value.actor_signature ?? []),
    authoritySequence: Number(value.authority_sequence),
    authorityHash: new Uint8Array(value.authority_hash ?? []),
  }
}

const GO_EVENT_PAYLOAD_KEYS: Record<string, string> = {
  MessageCommitted: 'messageCommitted',
  MessageEdited: 'messageEdited',
  MessageRetracted: 'messageRetracted',
  MembershipChanged: 'membershipChanged',
  MembershipTransitionCommitted: 'membershipTransitionCommitted',
  ConversationCreated: 'conversationCreated',
  ConversationDissolved: 'conversationDissolved',
  ConversationUpdated: 'conversationUpdated',
  ReactionCommitted: 'reactionCommitted',
  MessagePinCommitted: 'messagePinCommitted',
}

function protobufTimestampJson(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const timestamp = value as { seconds?: number | string; nanos?: number }
  if (timestamp.seconds == null) return value
  const millis = Number(timestamp.seconds) * 1000 + Number(timestamp.nanos ?? 0) / 1_000_000
  return new Date(millis).toISOString()
}

function normalizeGoEventTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeGoEventTimestamps)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const normalized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    normalized[key] = [
      'committed_at',
      'client_timestamp',
      'edited_at',
      'retracted_at',
      'ts',
    ].includes(key)
      ? protobufTimestampJson(item)
      : normalizeGoEventTimestamps(item)
  }
  return normalized
}

function normalizeGoConversationEvent(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const payload = source.Payload as Record<string, unknown> | undefined
  if (!payload) return value

  const normalized = normalizeGoEventTimestamps(
    Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'Payload')),
  ) as Record<string, unknown>
  for (const [goKey, payloadValue] of Object.entries(payload)) {
    const jsonKey = GO_EVENT_PAYLOAD_KEYS[goKey]
    if (jsonKey) normalized[jsonKey] = normalizeGoEventTimestamps(payloadValue)
  }
  return normalized
}

export function normalizeConversationEvents(events: readonly unknown[] | undefined): ConversationEvent[] {
  return (events ?? []).map((event) => {
    try {
      return fromJson(ConversationEventSchema, event as JsonValue)
    } catch {
      return fromJson(
        ConversationEventSchema,
        normalizeGoConversationEvent(event) as JsonValue,
      )
    }
  })
}

function conversationFromProjection(
  projection: MessagingConversationProjection,
): Conversation {
  return fromJson(ConversationSchema, {
    conversationId: projection.conversationId,
    kind: projection.kind,
    authorityStationPeerId: projection.authorityStationId,
    federationId: projection.federationId,
    membershipEpoch: projection.membershipEpoch,
    mlsEpoch: projection.mlsEpoch,
    status: projection.active
      ? 'CONVERSATION_STATUS_ACTIVE'
      : 'CONVERSATION_STATUS_DISSOLVED',
    name: projection.name,
    ownerPtid: projection.ownerPtid,
  })
}

const conversationService: ConversationServiceContract = {
  async getConversation(conversationId) {
    const conversations = await conversationService.listConversations()
    const conversation = conversations.find(item => item.conversationId === conversationId)
    if (!conversation) throw new Error('Conversation not found')
    return conversation
  },

  async listConversations() {
    return (await messagingService.listConversations()).map(conversationFromProjection)
  },

  async getMembers(conversationId) {
    const resp = await cmd<Record<string, string>, { members: JsonValue[] }>('conversation_get_members', {
      conversation_id: conversationId,
    })
    return (resp.members ?? []).map(member => fromJson(ConversationMemberSchema, member))
  },

  async listEvents(conversationId, afterSeq, limit) {
    const resp = await cmd<any, { events: unknown[] }>('conversation_list_events', {
      conversation_id: conversationId,
      after_seq: afterSeq ?? 0,
      limit: limit ?? 50,
    })
    return normalizeConversationEvents(resp.events)
  },

  async listMessages(conversationId, afterSeq, limit) {
    const resp = await cmd<any, { events: unknown[]; has_more: boolean }>('conversation_list_messages', {
      conversation_id: conversationId,
      after_seq: afterSeq ?? 0,
      limit: limit ?? 50,
    })
    return { events: normalizeConversationEvents(resp.events), hasMore: resp.has_more ?? false }
  },

  async listThreadMessages(conversationId, rootId, afterSeq, limit) {
    const resp = await cmd<any, { events: unknown[]; has_more: boolean }>('conversation_list_thread_messages', {
      conversation_id: conversationId,
      root_id: rootId,
      after_seq: afterSeq ?? 0,
      limit: limit ?? 50,
    })
    return { events: normalizeConversationEvents(resp.events), hasMore: resp.has_more ?? false }
  },

  async syncFromStation(conversationId, limit) {
    const resp = await cmd<any, { events: unknown[]; has_more: boolean }>('conversation_sync_from_station', {
      conversation_id: conversationId,
      limit: limit ?? 200,
    })
    return { events: normalizeConversationEvents(resp.events), hasMore: resp.has_more ?? false }
  },
}

const keyPackageService: KeyPackageServiceContract = {
  async upload(deviceId, data) {
    await cmd('keypackage_upload', { device_id: deviceId, data: bytesToBase64(data) })
  },

  async fetch(ptid, homeStationPeerId) {
    const resp = await cmd<any, {
      data: string | null
      available: boolean
      device_id: string
      home_station_peer_id: string
    }>('keypackage_fetch', {
      ptid,
      home_station_peer_id: homeStationPeerId ?? null,
    })
    return {
      data: resp.data ? base64ToBytes(resp.data) : null,
      available: resp.available,
      deviceId: resp.device_id ?? '',
      homeStationPeerId: resp.home_station_peer_id ?? '',
    }
  },

  async countAvailable() {
    const resp = await cmd<void, { count: number }>('keypackage_count')
    return resp.count
  },
}

const deviceService: DeviceServiceContract = {
  async list() {
    const resp = await cmd<void, { devices: DeviceInfo[] }>('device_list')
    return resp.devices ?? []
  },

  async revoke(deviceId) {
    await cmd('device_revoke', { device_id: deviceId })
  },
}

interface MessagingMessageWire {
  event_id?: string
  event_sequence?: number
  message_id: string
  sender_ptid: string
  sender_device_id: string
  plaintext: string
  attachments: Array<{
    attachment_id: string
    filename: string
    mime_type: string
    plaintext_size: number
    object_id: string
    storage_ref: string
    ciphertext_size: number
    availability_state: 'uploading' | 'remote' | 'local' | 'failed'
  }>
  state: string
  timestamp_unix_ms: number
  reply_to_message_id?: string
  thread_root_message_id?: string
  edited_text?: string
  edited_at_unix_ms?: number
  retracted: boolean
  reactions: Array<{
    actor_ptid: string
    reaction: string
    created_at_unix_ms: number
  }>
  pinned_by_ptid?: string
  pinned_at_unix_ms?: number
  read_by_ptids: string[]
}

function projectMessagingMessage(message: MessagingMessageWire): MessagingProjection {
  return {
    eventId: message.event_id,
    eventSequence: message.event_sequence,
    messageId: message.message_id,
    senderPtid: message.sender_ptid,
    senderDeviceId: message.sender_device_id,
    plaintext: message.plaintext,
    attachments: message.attachments.map(attachment => ({
      attachmentId: attachment.attachment_id,
      filename: attachment.filename,
      mimeType: attachment.mime_type,
      plaintextSize: attachment.plaintext_size,
      objectId: attachment.object_id,
      storageRef: attachment.storage_ref,
      ciphertextSize: attachment.ciphertext_size,
      availabilityState: attachment.availability_state,
    })),
    state: message.state,
    timestampUnixMs: message.timestamp_unix_ms,
    replyToMessageId: message.reply_to_message_id,
    threadRootMessageId: message.thread_root_message_id,
    editedText: message.edited_text,
    editedAtUnixMs: message.edited_at_unix_ms,
    retracted: message.retracted,
    reactions: message.reactions.map(reaction => ({
      actorPtid: reaction.actor_ptid,
      reaction: reaction.reaction,
      createdAtUnixMs: reaction.created_at_unix_ms,
    })),
    pinnedByPtid: message.pinned_by_ptid,
    pinnedAtUnixMs: message.pinned_at_unix_ms,
    readByPtids: message.read_by_ptids,
  }
}

const messagingService: MessagingServiceContract = {
  async createDirect(input) {
    const response = await cmd<
      { peer_ptid: string; federation_id: string },
      { conversation_id: string; state: 'projected' }
    >('messaging_create_direct', {
      peer_ptid: input.peerPtid,
      federation_id: input.federationId,
    })
    return {
      conversationId: response.conversation_id,
      state: response.state,
    }
  },

  async createGroup(conversationId, name, memberPtids, federationId) {
    const response = await cmd<
      {
        conversation_id: string
        name: string
        member_ptids: string[]
        federation_id: string
      },
      {
        conversation_id: string
        command_id: string
        state: 'pending' | 'projected' | 'failed'
      }
    >('messaging_create_group', {
      conversation_id: conversationId,
      name,
      member_ptids: memberPtids,
      federation_id: federationId,
    })
    return {
      conversationId: response.conversation_id,
      commandId: response.command_id,
      state: response.state,
    }
  },

  async submitMembershipIntent(intent) {
    const response = await cmd<
      {
        conversation_id: string
        action: 'add_actor' | 'remove_actor' | 'add_device' | 'remove_device'
        target_ptid: string
        target_device_id?: string
        role?: string
      },
      { command_id: string; state: 'pending' }
    >('messaging_membership_transition', {
      conversation_id: intent.conversationId,
      action: intent.action,
      target_ptid: intent.targetPtid,
      ...('targetDeviceId' in intent
        ? { target_device_id: intent.targetDeviceId }
        : {}),
      ...('role' in intent && intent.role ? { role: intent.role } : {}),
    })
    return {
      commandId: response.command_id,
      state: response.state,
    }
  },

  async requestLeaveIntent(input) {
    const intent = await cmd<Record<string, unknown>, MlsLeaveIntentWire>(
      'messaging_submit_leave_intent',
      {
        federation_id: input.federationId,
        authority_station_peer_id: input.authorityStationPeerId,
        authority_epoch: input.authorityEpoch,
        home_station_peer_id: input.homeStationPeerId,
        conversation_id: input.conversationId,
        observed_membership_epoch: input.observedMembershipEpoch,
        observed_mls_epoch: input.observedMlsEpoch,
      },
    )
    return normalizeLeaveIntent(intent)
  },

  async listLeaveIntents(conversationId) {
    const response = await cmd<
      { conversation_id: string },
      { intents: MlsLeaveIntentWire[] }
    >(
      'messaging_list_leave_intents',
      { conversation_id: conversationId },
    )
    return (response.intents ?? []).map(normalizeLeaveIntent)
  },

  async commitAuthorizedLeave(input) {
    const response = await cmd<
      {
        leave_intent: {
          version: number
          intent_id: string
          federation_id: string
          authority_station_peer_id: string
          authority_epoch: number
          home_station_peer_id: string
          conversation_id: string
          actor_ptid: string
          actor_device_id: string
          actor_signing_key_id: string
          observed_membership_epoch: number
          observed_mls_epoch: number
          created_at_unix_ms: number
          expires_at_unix_ms: number
          actor_signature: number[]
          authority_sequence: number
          authority_hash: number[]
        }
      },
      { command_id: string; state: 'pending' }
    >(
      'messaging_commit_authorized_leave',
      {
        leave_intent: {
          version: input.intent.version,
          intent_id: input.intent.intentId,
          federation_id: input.intent.federationId,
          authority_station_peer_id: input.intent.authorityStationPeerId,
          authority_epoch: input.intent.authorityEpoch,
          home_station_peer_id: input.intent.homeStationPeerId,
          conversation_id: input.intent.conversationId,
          actor_ptid: input.intent.actorPtid,
          actor_device_id: input.intent.actorDeviceId,
          actor_signing_key_id: input.intent.actorSigningKeyId,
          observed_membership_epoch: input.intent.observedMembershipEpoch,
          observed_mls_epoch: input.intent.observedMlsEpoch,
          created_at_unix_ms: input.intent.createdAtUnixMs,
          expires_at_unix_ms: input.intent.expiresAtUnixMs,
          actor_signature: Array.from(input.intent.actorSignature),
          authority_sequence: input.intent.authoritySequence,
          authority_hash: Array.from(input.intent.authorityHash),
        },
      },
    )
    return {
      commandId: response.command_id,
      state: response.state,
    }
  },

  async getCommandStatus(commandId) {
    const response = await cmd<
      { command_id: string },
      {
        command_id: string
        conversation_id: string
        state: 'pending' | 'retry_wait' | 'submitted' | 'committed' | 'failed' | 'superseded'
        last_error_code: string
      }
    >('messaging_command_status', { command_id: commandId })
    return {
      commandId: response.command_id,
      conversationId: response.conversation_id,
      state: response.state,
      lastErrorCode: response.last_error_code,
    }
  },

  async listConversations() {
    const response = await cmd<
      void,
      {
        conversations: Array<{
          conversation_id: string
          authority_station_id: string
          federation_id: string
          kind: number
          name: string
          owner_ptid: string
          members: JsonValue[]
          membership_epoch: number
          mls_epoch: number
          mls_status: 'idle' | 'active' | 'establishing' | 'crypto_desynced' | null
          active: boolean
          updated_at_unix_ms: number
        }>
      }
    >('messaging_list_conversations')
    const conversations = response.conversations.map(conversation => ({
      conversationId: conversation.conversation_id,
      authorityStationId: conversation.authority_station_id,
      federationId: conversation.federation_id,
      kind: conversation.kind as 1 | 2,
      name: conversation.name,
      ownerPtid: conversation.owner_ptid,
      members: conversation.members.map(member =>
        fromJson(ConversationMemberSchema, member)
      ),
      membershipEpoch: conversation.membership_epoch,
      mlsEpoch: conversation.mls_epoch,
      mlsStatus: conversation.mls_status,
      active: conversation.active,
      updatedAtUnixMs: conversation.updated_at_unix_ms,
    }))
    return conversations
  },

  async pickAttachmentSource() {
    const response = await cmd<
      void,
      { file_path: string; filename: string; mime_type: string; size: number }
    >('messaging_pick_attachment_source')
    return {
      filePath: response.file_path,
      filename: response.filename,
      mimeType: response.mime_type,
      size: response.size,
    }
  },

  async stageAttachmentSource(filename, bytes) {
    const response = await cmd<
      { filename: string; bytes: number[] },
      { local_path: string }
    >('messaging_stage_attachment_source', {
      filename,
      bytes: Array.from(bytes),
    })
    return response.local_path
  },

  async discardAttachmentSource(filePath) {
    await cmd<
      { file_path: string },
      { discarded: boolean }
    >('messaging_discard_attachment_source', { file_path: filePath })
  },

  async captureAttachmentSource() {
    const response = await cmd<
      void,
      { file_path: string; filename: string; mime_type: string }
    >('messaging_capture_attachment_source')
    return {
      filePath: response.file_path,
      filename: response.filename,
      mimeType: response.mime_type,
    }
  },

  async sendMessage(conversationId, conversationKind, plaintext, attachments = [], relation = {}) {
    const response = await cmd<
      {
        conversation_id: string
        conversation_kind: 'direct' | 'group'
        plaintext: string
        reply_to_message_id: string
        thread_root_message_id: string
        attachments: Array<{
          file_path: string
          filename: string
          mime_type: string
        }>
      },
      {
        command_id: string
        message_id: string
        attachment_ids: string[]
        state: 'draft' | 'pending' | 'attachment_failed'
      }
    >('messaging_send_message', {
      conversation_id: conversationId,
      conversation_kind: conversationKind,
      plaintext,
      reply_to_message_id: relation.replyToMessageId ?? '',
      thread_root_message_id: relation.threadRootMessageId ?? '',
      attachments: attachments.map(attachment => ({
        file_path: attachment.filePath,
        filename: attachment.filename,
        mime_type: attachment.mimeType,
      })),
    })
    return {
      commandId: response.command_id || undefined,
      messageId: response.message_id,
      attachmentIds: response.attachment_ids,
      attachmentCount: response.attachment_ids.length,
      state: response.state,
    }
  },

  async listMessages(conversationId) {
    const response = await cmd<
      { conversation_id: string },
      { messages: MessagingMessageWire[] }
    >('messaging_list_messages', { conversation_id: conversationId })
    return response.messages.map(projectMessagingMessage)
  },

  async listThreadMessages(conversationId, threadRootMessageId) {
    const response = await cmd<
      { conversation_id: string; thread_root_message_id: string },
      { messages: MessagingMessageWire[] }
    >('messaging_list_thread_messages', {
      conversation_id: conversationId,
      thread_root_message_id: threadRootMessageId,
    })
    return response.messages.map(projectMessagingMessage)
  },

  async threadCounts(conversationId, rootMessageIds) {
    const response = await cmd<
      { conversation_id: string; root_message_ids: string[] },
      { counts: ThreadCountResult[] }
    >('messaging_thread_counts', {
      conversation_id: conversationId,
      root_message_ids: rootMessageIds,
    })
    return { counts: response.counts ?? [] }
  },

  async getMemberSettings(conversationId) {
    const response = await cmd<{ conversation_id: string }, MemberSettingsResult>(
      'messaging_get_member_settings',
      { conversation_id: conversationId },
    )
    return {
      nickname: response.nickname ?? '',
      muted: response.muted ?? false,
      alertEnabled: response.alertEnabled ?? true,
      pinned: response.pinned ?? false,
      background: response.background ?? 'default',
      backgroundImage: response.backgroundImage ?? '',
      clearedAtUnixMs: response.clearedAtUnixMs ?? 0,
    }
  },

  async updateMemberSettings(conversationId, settings) {
    const response = await cmd<
      {
        conversation_id: string
        nickname?: string
        muted?: boolean
        alert_enabled?: boolean
        pinned?: boolean
        background?: string
        background_image?: string
        cleared_at_unix_ms?: number
      },
      MemberSettingsResult
    >('messaging_update_member_settings', {
      conversation_id: conversationId,
      nickname: settings.nickname,
      muted: settings.muted,
      alert_enabled: settings.alertEnabled,
      pinned: settings.pinned,
      background: settings.background,
      background_image: settings.backgroundImage,
      cleared_at_unix_ms: settings.clearedAtUnixMs,
    })
    return {
      nickname: response.nickname ?? '',
      muted: response.muted ?? false,
      alertEnabled: response.alertEnabled ?? true,
      pinned: response.pinned ?? false,
      background: response.background ?? 'default',
      backgroundImage: response.backgroundImage ?? '',
      clearedAtUnixMs: response.clearedAtUnixMs ?? 0,
    }
  },

  async searchMessages(conversationId, query, options = {}) {
    const response = await cmd<
      {
        conversation_id: string
        query: string
        before_timestamp_unix_ms?: number
        before_message_id?: string
        limit: number
      },
      {
        messages: Array<{
          event_id?: string
          event_sequence?: number
          message_id: string
          sender_ptid: string
          sender_device_id: string
          plaintext: string
          attachments: Array<{
            attachment_id: string
            filename: string
            mime_type: string
            plaintext_size: number
            object_id: string
            storage_ref: string
            ciphertext_size: number
            availability_state: 'uploading' | 'remote' | 'local' | 'failed'
          }>
          state: string
          timestamp_unix_ms: number
          reply_to_message_id?: string
          thread_root_message_id?: string
          edited_text?: string
          edited_at_unix_ms?: number
          retracted: boolean
          reactions: Array<{
            actor_ptid: string
            reaction: string
            created_at_unix_ms: number
          }>
          pinned_by_ptid?: string
          pinned_at_unix_ms?: number
          read_by_ptids: string[]
        }>
      }
    >('messaging_search_messages', {
      conversation_id: conversationId,
      query,
      before_timestamp_unix_ms: options.beforeTimestampUnixMs,
      before_message_id: options.beforeMessageId,
      limit: options.limit ?? 50,
    })
    return response.messages.map(message => ({
      eventId: message.event_id,
      eventSequence: message.event_sequence,
      messageId: message.message_id,
      senderPtid: message.sender_ptid,
      senderDeviceId: message.sender_device_id,
      plaintext: message.plaintext,
      attachments: message.attachments.map(attachment => ({
        attachmentId: attachment.attachment_id,
        filename: attachment.filename,
        mimeType: attachment.mime_type,
        plaintextSize: attachment.plaintext_size,
        objectId: attachment.object_id,
        storageRef: attachment.storage_ref,
        ciphertextSize: attachment.ciphertext_size,
        availabilityState: attachment.availability_state,
      })),
      state: message.state,
      timestampUnixMs: message.timestamp_unix_ms,
      replyToMessageId: message.reply_to_message_id,
      threadRootMessageId: message.thread_root_message_id,
      editedText: message.edited_text,
      editedAtUnixMs: message.edited_at_unix_ms,
      retracted: message.retracted,
      reactions: message.reactions.map(reaction => ({
        actorPtid: reaction.actor_ptid,
        reaction: reaction.reaction,
        createdAtUnixMs: reaction.created_at_unix_ms,
      })),
      pinnedByPtid: message.pinned_by_ptid,
      pinnedAtUnixMs: message.pinned_at_unix_ms,
      readByPtids: message.read_by_ptids,
    }))
  },

  async openAttachment(attachmentId) {
    const response = await cmd<
      { attachment_id: string },
      { local_path: string }
    >('messaging_open_attachment', { attachment_id: attachmentId })
    return response.local_path
  },
}

export const imServiceV1: IMServiceV1 = {
  conversation: conversationService,
  keyPackage: keyPackageService,
  device: deviceService,
  messaging: messagingService,
}
