import { invoke } from '@tauri-apps/api/core'
import { fromJson } from '@bufbuild/protobuf'
import type { RustCommandResult } from './desktop_api'
import type {
  ConversationServiceContract,
  EnvelopeServiceContract,
  KeyPackageServiceContract,
  DeviceServiceContract,
  DeviceInfo,
  MlsGroupServiceContract,
  DirectKeyExchangeServiceContract,
  IMServiceV1,
  ThreadCountResult,
  MemberSettingsResult,
} from './im-service-contract'
import { MlsDeliveryKind, DirectKeyExchangeKind } from './im-service-contract'
import type {
  Conversation,
  ConversationMember,
  CommittedConversationEvent,
} from '../gen/proto/domain/chat/conversation_pb'
import { CommittedConversationEventSchema } from '../gen/proto/domain/chat/conversation_pb'
import type {
  DeviceInboxItem,
} from '../gen/proto/domain/chat/envelope_pb'
import { DeviceInboxItemSchema } from '../gen/proto/domain/chat/envelope_pb'

async function cmd<TInput, TData>(command: string, input?: TInput): Promise<TData> {
  const payload = input === undefined ? undefined : { input }
  const result = await invoke<RustCommandResult<TData>>(command, payload)
  if (!result.ok) {
    throw new Error(result.error?.message ?? `${command} failed`)
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

const GO_EVENT_PAYLOAD_KEYS: Record<string, string> = {
  MessageCommitted: 'messageCommitted',
  MessageEdited: 'messageEdited',
  MessageRetracted: 'messageRetracted',
  MembershipChanged: 'membershipChanged',
  ConversationCreated: 'conversationCreated',
  ConversationDissolved: 'conversationDissolved',
  SettingsChanged: 'settingsChanged',
  Reaction: 'reaction',
  Pin: 'pin',
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
      'client_ts',
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

export function normalizeConversationEvents(events: readonly unknown[] | undefined): CommittedConversationEvent[] {
  return (events ?? []).map((event) => {
    try {
      return fromJson(CommittedConversationEventSchema, event as any)
    } catch {
      return fromJson(CommittedConversationEventSchema, normalizeGoConversationEvent(event) as any)
    }
  })
}

const conversationService: ConversationServiceContract = {
  async createDirect(peerPtid, peerStationPeerId) {
    const resp = await cmd<any, { conversation: Conversation }>('conversation_create_direct', {
      peer_ptid: peerPtid,
      peer_station_peer_id: peerStationPeerId ?? '',
    })
    return resp.conversation
  },

  async createGroup(name, members) {
    const resp = await cmd<any, { conversation: Conversation }>('conversation_create_group', {
      name,
      members: members.map(m => ({ ptid: m.ptid, station_id: m.stationId ?? '' })),
    })
    return resp.conversation
  },

  async submitCommand(command) {
    const resp = await cmd<any, { event: CommittedConversationEvent }>('conversation_submit_command', {
      command,
    })
    return resp.event
  },

  async submitReceipt(conversationId, messageId, receiptType) {
    await cmd('conversation_submit_receipt', {
      conversation_id: conversationId,
      message_id: messageId,
      device_id: '',
      receipt_type: receiptType as number,
    })
  },

  async react(conversationId: string, messageId: string, emoji: string, remove = false) {
    await cmd('conversation_react', {
      conversation_id: conversationId, message_id: messageId, emoji, remove,
    })
  },

  async getConversation(_conversationId) {
    throw new Error('not yet implemented — use listConversations')
  },

  async listConversations() {
    const resp = await cmd<void, { conversations: Conversation[] }>('conversation_list')
    return resp.conversations ?? []
  },

  async getMembers(conversationId) {
    const resp = await cmd<any, { members: ConversationMember[] }>('conversation_get_members', {
      conversation_id: conversationId,
    })
    return resp.members ?? []
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

  async threadCounts(conversationId, rootIds) {
    const resp = await cmd<any, { counts: ThreadCountResult[] }>('conversation_thread_counts', {
      conversation_id: conversationId,
      root_ids: rootIds,
    })
    return { counts: resp.counts ?? [] }
  },

  async setReadCursor(conversationId, lastReadSeq) {
    await cmd('conversation_set_read_cursor', {
      conversation_id: conversationId,
      last_read_seq: lastReadSeq,
    })
  },

  async getUnread(conversationId) {
    const resp = await cmd<any, { unread_count: number }>('conversation_get_unread', {
      conversation_id: conversationId,
    })
    return resp.unread_count ?? 0
  },

  async getMemberSettings(conversationId) {
    const resp = await cmd<any, MemberSettingsResult>('conversation_get_member_settings', {
      conversation_id: conversationId,
    })
    return resp
  },

  async updateMemberSettings(conversationId, settings) {
    await cmd('conversation_update_member_settings', {
      conversation_id: conversationId,
      nickname: settings.nickname,
      muted: settings.muted,
    })
  },

  async searchMessages(conversationId, query, limit) {
    const resp = await cmd<any, { events: unknown[]; has_more: boolean }>('conversation_search_messages', {
      conversation_id: conversationId,
      query,
      limit: limit ?? 20,
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

const envelopeService: EnvelopeServiceContract = {
  async submit(envelope) {
    const payloadB64 = envelope.payloadBytes && envelope.payloadBytes.length > 0
      ? bytesToBase64(envelope.payloadBytes)
      : '';
    const resp = await cmd<any, { envelope_id?: string; error?: string }>('envelope_submit', {
      envelope: {
        conversation_id: envelope.conversationId,
        sender_ptid: envelope.senderPtid,
        sender_device_id: envelope.senderDeviceId,
        recipient_ptid: envelope.recipientPtid,
        payload_type: envelope.payloadType,
        payload_bytes: payloadB64,
        idempotency_key: envelope.idempotencyKey,
      },
    })
    if (!resp.envelope_id) {
      throw new Error(resp.error || 'envelope_submit: no envelope_id returned')
    }
    return resp.envelope_id
  },

  async ack(deviceId, inboxItemId) {
    await cmd('envelope_ack', { device_id: deviceId, inbox_item_id: inboxItemId })
  },

  async resume(deviceId, afterCursor) {
    const resp = await cmd<any, { items: unknown[] }>('envelope_resume', {
      device_id: deviceId,
      after_cursor: afterCursor ?? '',
    })
    return (resp.items ?? []).map(item => fromJson(DeviceInboxItemSchema, item as any))
  },
}

const keyPackageService: KeyPackageServiceContract = {
  async upload(deviceId, data) {
    await cmd('keypackage_upload', { device_id: deviceId, data: bytesToBase64(data) })
  },

  async fetch(ptid, homeStationPeerId) {
    const resp = await cmd<any, { data: string | null; available: boolean }>('keypackage_fetch', {
      ptid,
      home_station_peer_id: homeStationPeerId ?? null,
    })
    return {
      data: resp.data ? base64ToBytes(resp.data) : null,
      available: resp.available,
    }
  },

  async countAvailable() {
    const resp = await cmd<void, { count: number }>('keypackage_count')
    return resp.count
  },
}

const deviceService: DeviceServiceContract = {
  async register(deviceId, label, publicKey) {
    await cmd('device_register', {
      device_id: deviceId,
      label: label ?? '',
      public_key: publicKey ? bytesToBase64(publicKey) : '',
    })
  },

  async list() {
    const resp = await cmd<void, { devices: DeviceInfo[] }>('device_list')
    return resp.devices ?? []
  },

  async revoke(deviceId) {
    await cmd('device_revoke', { device_id: deviceId })
  },
}

const mlsGroupService: MlsGroupServiceContract = {
  async initIdentity(ptid) {
    await cmd('mls_init_identity', { actor_did: ptid })
  },

  async generateKeyPackage() {
    const resp = await cmd<void, { key_package: number[] }>('mls_generate_key_package')
    return new Uint8Array(resp.key_package)
  },

  async createGroup(conversationId, memberKeyPackages) {
    const resp = await cmd<any, { group_id: string; welcome_bytes: number[]; commit_bytes: number[] }>(
      'mls_group_create',
      {
        conversation_id: conversationId,
        member_key_packages: memberKeyPackages.map(kp => Array.from(kp)),
      },
    )
    return {
      groupId: resp.group_id,
      welcomeBytes: new Uint8Array(resp.welcome_bytes),
      commitBytes: new Uint8Array(resp.commit_bytes),
    }
  },

  async joinGroup(conversationId, welcomeBytes) {
    await cmd('mls_group_join', {
      conversation_id: conversationId,
      welcome_bytes: Array.from(welcomeBytes),
    })
  },

  async encrypt(conversationId, plaintext) {
    const resp = await cmd<any, { ciphertext: number[] }>('mls_group_encrypt', {
      conversation_id: conversationId,
      plaintext: Array.from(plaintext),
    })
    return new Uint8Array(resp.ciphertext)
  },

  async decrypt(conversationId, ciphertext) {
    const resp = await cmd<any, { plaintext: number[] }>('mls_group_decrypt', {
      conversation_id: conversationId,
      ciphertext: Array.from(ciphertext),
    })
    return new Uint8Array(resp.plaintext)
  },

  async processCommit(conversationId, commitBytes) {
    await cmd('mls_group_process_commit', {
      conversation_id: conversationId,
      commit_bytes: Array.from(commitBytes),
    })
  },

  async addMember(conversationId, memberKeyPackage) {
    const resp = await cmd<any, { commit_bytes: number[]; welcome_bytes: number[] }>(
      'mls_group_add_member',
      {
        conversation_id: conversationId,
        member_key_package: Array.from(memberKeyPackage),
      },
    )
    return {
      commitBytes: new Uint8Array(resp.commit_bytes),
      welcomeBytes: new Uint8Array(resp.welcome_bytes),
    }
  },

  async removeMember(conversationId, memberActorDid) {
    const resp = await cmd<any, { commit_bytes: number[] }>('mls_group_remove_member', {
      conversation_id: conversationId,
      member_actor_did: memberActorDid,
    })
    return new Uint8Array(resp.commit_bytes)
  },

  async status(conversationId) {
    return cmd<any, { ready: boolean }>('mls_group_status', {
      conversation_id: conversationId,
    })
  },

  async distribute(conversationId, kind, mlsEpoch, opaqueBytes, recipients) {
    const resp = await cmd<any, { delivered: number }>('mls_distribute', {
      conversation_id: conversationId,
      kind: kind as number,
      mls_epoch: mlsEpoch,
      opaque_bytes: bytesToBase64(opaqueBytes),
      recipients: recipients ?? [],
    })
    return resp.delivered
  },

  async save(conversationId) {
    await cmd('mls_group_save', { conversation_id: conversationId })
  },

  async load(conversationId) {
    await cmd('mls_group_load', { conversation_id: conversationId })
  },
}

const dkxService: DirectKeyExchangeServiceContract = {
  async send(recipientPtid, sessionId, kind, opaqueKeyMaterial, recipientStationPeerId) {
    const resp = await cmd<any, { envelope_id: string }>('dkx_send', {
      recipient_ptid: recipientPtid,
      recipient_station_peer_id: recipientStationPeerId ?? '',
      session_id: sessionId,
      kind: kind as number,
      opaque_key_material: bytesToBase64(opaqueKeyMaterial),
    })
    return resp.envelope_id
  },
}

export const imServiceV1: IMServiceV1 = {
  conversation: conversationService,
  envelope: envelopeService,
  keyPackage: keyPackageService,
  device: deviceService,
  mlsGroup: mlsGroupService,
  dkx: dkxService,
}

export { MlsDeliveryKind, DirectKeyExchangeKind }
