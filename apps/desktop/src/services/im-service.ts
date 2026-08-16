import { invoke } from '@tauri-apps/api/core'
import { create, fromBinary, fromJson, toBinary, toJson } from '@bufbuild/protobuf'
import type { JsonValue } from '@bufbuild/protobuf'
import { RustCommandException, type RustCommandResult } from './desktop_api'
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
  CreateGroupConversationResult,
  MlsLeaveIntentView,
  MessagingServiceContract,
} from './im-service-contract'
import { DirectKeyExchangeKind } from './im-service-contract'
import type {
  Conversation,
  ConversationCommand,
  CommittedConversationEvent,
  MembershipTransitionCommand,
} from '../gen/proto/domain/chat/conversation_pb'
import {
  CommittedConversationEventSchema,
  ConversationCommandSchema,
  ConversationCommandResultDeliverySchema,
  ConversationCommandSubmissionState,
  ConversationMemberSchema,
  ConversationSchema,
  MemberRole,
  MembershipTransitionAction,
  MembershipTransitionChangeSchema,
  MembershipTransitionCommandSchema,
  MlsWelcomeDeliverySchema,
} from '../gen/proto/domain/chat/conversation_pb'
import { DeviceInboxItemSchema } from '../gen/proto/domain/chat/envelope_pb'

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

function normalizeLeaveIntent(value: Record<string, any>): MlsLeaveIntentView {
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

function normalizeConversation(value: unknown): Conversation {
  return fromJson(ConversationSchema, value as any)
}

function membershipTransitionToWire(transition: MembershipTransitionCommand): Record<string, unknown> {
  return {
    transition_id: transition.transitionId,
    from_membership_epoch: Number(transition.fromMembershipEpoch),
    from_mls_epoch: Number(transition.fromMlsEpoch),
    to_mls_epoch: Number(transition.toMlsEpoch),
    changes: transition.changes.map(change => ({
      ptid: change.ptid,
      actor_home_station_peer_id: change.actorHomeStationPeerId,
      action: change.action,
      role: change.role,
      device_id: change.deviceId,
    })),
    opaque_mls_commit_bytes: bytesToBase64(transition.opaqueMlsCommitBytes),
    commit_sha256: bytesToBase64(transition.commitSha256),
    welcome_deliveries: transition.welcomeDeliveries.map(delivery => ({
      recipient_ptid: delivery.recipientPtid,
      recipient_device_id: delivery.recipientDeviceId,
      recipient_home_station_peer_id: delivery.recipientHomeStationPeerId,
      opaque_welcome_bytes: bytesToBase64(delivery.opaqueWelcomeBytes),
      welcome_sha256: bytesToBase64(delivery.welcomeSha256),
    })),
    idempotency_key: transition.idempotencyKey,
    leave_intent_id: transition.leaveIntentId,
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))
}

function isDefinitiveAuthorityRejection(error: unknown): boolean {
  return error instanceof RustCommandException
    && ['INVALID_ARGUMENT', 'FORBIDDEN', 'CONFLICT'].includes(error.code)
}

async function discardRejectedTransition(
  conversationId: string,
  error: unknown,
): Promise<void> {
  if (isDefinitiveAuthorityRejection(error)) {
    await mlsGroupService.discardPending(conversationId)
  }
}

function assertAuthorityAcceptedTransition(
  conversationId: string,
  expected: MembershipTransitionCommand,
  event: CommittedConversationEvent,
): void {
  if (event.conversationId !== conversationId || event.payload.case !== 'membershipTransitionCommitted') {
    throw new Error('Authority returned the wrong committed conversation event')
  }
  const committed = event.payload.value
  if (
    committed.transitionId !== expected.transitionId
    || committed.fromMembershipEpoch !== expected.fromMembershipEpoch
    || committed.toMembershipEpoch !== expected.fromMembershipEpoch + 1n
    || committed.fromMlsEpoch !== expected.fromMlsEpoch
    || committed.toMlsEpoch !== expected.toMlsEpoch
    || committed.leaveIntentId !== expected.leaveIntentId
    || !bytesEqual(committed.commitSha256, expected.commitSha256)
    || !bytesEqual(committed.opaqueMlsCommitBytes, expected.opaqueMlsCommitBytes)
  ) {
    throw new Error('Authority accepted different MLS transition evidence')
  }
  if (committed.changes.length !== expected.changes.length) {
    throw new Error('Authority committed a different membership change set')
  }
  for (let index = 0; index < expected.changes.length; index += 1) {
    const actual = committed.changes[index]
    const wanted = expected.changes[index]
    if (
      !actual
      || actual.ptid !== wanted.ptid
      || actual.actorHomeStationPeerId !== wanted.actorHomeStationPeerId
      || actual.action !== wanted.action
      || actual.role !== wanted.role
      || actual.deviceId !== wanted.deviceId
    ) {
      throw new Error('Authority committed a different membership change set')
    }
  }
  if (committed.welcomeDescriptors.length !== expected.welcomeDeliveries.length) {
    throw new Error('Authority committed different MLS Welcome deliveries')
  }
  for (let index = 0; index < expected.welcomeDeliveries.length; index += 1) {
    const actual = committed.welcomeDescriptors[index]
    const wanted = expected.welcomeDeliveries[index]
    if (
      !actual
      || actual.recipientPtid !== wanted.recipientPtid
      || actual.recipientDeviceId !== wanted.recipientDeviceId
      || actual.recipientHomeStationPeerId !== wanted.recipientHomeStationPeerId
      || !bytesEqual(actual.welcomeSha256, wanted.welcomeSha256)
    ) {
      throw new Error('Authority committed different MLS Welcome deliveries')
    }
  }
}

interface CommandProposalOutcome {
  conversation_id: string
  command_id: string
  state: number
  accepted: boolean
  terminal_rejected: boolean
  retryable: boolean
  reject_code: number
  event_bytes?: number[] | null
  next_retry_at_unix_ms?: number
}

interface PendingCommandProposal {
  conversationId: string
  commandId: string
  membershipTransition: boolean
}

const PENDING_COMMAND_PROPOSALS_KEY = 'peers_im_pending_command_proposals_v1'

function readPendingCommandProposals(): PendingCommandProposal[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_COMMAND_PROPOSALS_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter(item => (
          typeof item?.conversationId === 'string'
          && typeof item?.commandId === 'string'
          && typeof item?.membershipTransition === 'boolean'
        ))
      : []
  } catch {
    return []
  }
}

function writePendingCommandProposals(items: PendingCommandProposal[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(PENDING_COMMAND_PROPOSALS_KEY, JSON.stringify(items))
}

function rememberPendingCommandProposal(item: PendingCommandProposal): void {
  const items = readPendingCommandProposals()
  if (!items.some(existing => (
    existing.conversationId === item.conversationId
    && existing.commandId === item.commandId
  ))) {
    items.push(item)
    writePendingCommandProposals(items)
  }
}

function forgetPendingCommandProposal(conversationId: string, commandId: string): void {
  writePendingCommandProposals(readPendingCommandProposals().filter(item => (
    item.conversationId !== conversationId || item.commandId !== commandId
  )))
}

async function applyCommandProposalOutcome(
  outcome: CommandProposalOutcome,
  pending?: PendingCommandProposal,
  finalizeMembership = false,
  throwOnTerminal = true,
): Promise<CommittedConversationEvent | undefined> {
  if (outcome.accepted && outcome.event_bytes?.length) {
    const event = fromBinary(
      CommittedConversationEventSchema,
      new Uint8Array(outcome.event_bytes),
    )
    if (finalizeMembership && event.payload.case === 'membershipTransitionCommitted') {
      await mlsGroupService.acceptPending(
        event.conversationId,
        event.payload.value.transitionId,
      )
    }
    forgetPendingCommandProposal(outcome.conversation_id, outcome.command_id)
    return event
  }
  if (outcome.terminal_rejected) {
    if (finalizeMembership && pending?.membershipTransition) {
      await mlsGroupService.discardPending(pending.conversationId)
    }
    forgetPendingCommandProposal(outcome.conversation_id, outcome.command_id)
    if (throwOnTerminal) {
      throw new Error(`Authority rejected the secure command (${outcome.reject_code})`)
    }
    return undefined
  }
  rememberPendingCommandProposal(pending ?? {
    conversationId: outcome.conversation_id,
    commandId: outcome.command_id,
    membershipTransition: false,
  })
  return undefined
}

async function waitForCommandProposalResult(
  initial: CommandProposalOutcome,
  pending: PendingCommandProposal,
): Promise<CommittedConversationEvent> {
  let outcome = initial
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const event = await applyCommandProposalOutcome(outcome, pending)
    if (event) return event
    await new Promise(resolve => setTimeout(resolve, 250))
    outcome = await cmd<Record<string, unknown>, CommandProposalOutcome>(
      'conversation_get_command_proposal_result',
      {
        conversation_id: pending.conversationId,
        command_id: pending.commandId,
      },
    )
  }
  throw new Error('Secure command is queued and will finish in the background')
}

function canonicalizeConversationCommand(command: ConversationCommand): {
  command: ConversationCommand
  wire: Record<string, unknown>
} {
  const source = command as unknown as Record<string, unknown>
  let canonical: ConversationCommand
  if ('$typeName' in source) {
    canonical = create(ConversationCommandSchema, {
      ...command,
      commandId: command.commandId || crypto.randomUUID(),
    })
  } else {
    canonical = fromJson(ConversationCommandSchema, {
      ...source,
      command_id: source.command_id || source.commandId || crypto.randomUUID(),
    } as unknown as JsonValue)
  }
  return {
    command: canonical,
    wire: toJson(ConversationCommandSchema, canonical, {
      useProtoFieldName: true,
      enumAsInteger: true,
    }) as Record<string, unknown>,
  }
}

async function submitRemoteConversationCommand(
  command: ConversationCommand,
  conversation: Conversation,
  homeStationPeerId: string,
): Promise<CommittedConversationEvent> {
  const outcome = await cmd<Record<string, unknown>, CommandProposalOutcome>(
    'conversation_submit_command_proposal',
    {
      federation_id: conversation.federationId,
      authority_station_peer_id: conversation.authorityStationPeerId,
      authority_epoch: Number(conversation.authorityEpoch),
      home_station_peer_id: homeStationPeerId,
      command_bytes: Array.from(toBinary(ConversationCommandSchema, command)),
    },
  )
  return waitForCommandProposalResult(outcome, {
    conversationId: command.conversationId,
    commandId: command.commandId,
    membershipTransition: command.payload.case === 'membershipTransition',
  })
}

export async function reconcilePendingConversationCommands(): Promise<CommittedConversationEvent[]> {
  const events: CommittedConversationEvent[] = []
  for (const pending of readPendingCommandProposals()) {
    try {
      const outcome = await cmd<Record<string, unknown>, CommandProposalOutcome>(
        'conversation_get_command_proposal_result',
        {
          conversation_id: pending.conversationId,
          command_id: pending.commandId,
        },
      )
      const event = await applyCommandProposalOutcome(outcome, pending, true)
      if (event) events.push(event)
    } catch {
      // Home Station remains the durable owner; the next reconcile retries.
    }
  }
  return events
}

export async function consumeCommandResultDelivery(
  payloadBytes: Uint8Array,
): Promise<CommittedConversationEvent | undefined> {
  const delivery = fromBinary(ConversationCommandResultDeliverySchema, payloadBytes)
  const pending = readPendingCommandProposals().find(item => (
    item.conversationId === delivery.conversationId
    && item.commandId === delivery.commandId
  ))
  const result = delivery.result
  return applyCommandProposalOutcome({
    conversation_id: delivery.conversationId,
    command_id: delivery.commandId,
    state: delivery.state,
    accepted: delivery.state === ConversationCommandSubmissionState.ACCEPTED,
    terminal_rejected:
      delivery.state === ConversationCommandSubmissionState.TERMINAL_REJECTED,
    retryable: result?.retryable ?? false,
    reject_code: result?.rejectCode ?? 0,
    event_bytes: result?.committedEvent
      ? Array.from(toBinary(CommittedConversationEventSchema, result.committedEvent))
      : undefined,
  }, pending, true, false)
}

async function submitAuthorizedMembershipTransition(
  conversationId: string,
  senderPtid: string,
  senderDeviceId: string,
  observedMembershipEpoch: number,
  transition: MembershipTransitionCommand,
): Promise<CommittedConversationEvent> {
  const command = create(ConversationCommandSchema, {
    commandId: crypto.randomUUID(),
    conversationId,
    senderPtid,
    senderDeviceId,
    observedMembershipEpoch: BigInt(observedMembershipEpoch),
    payload: {
      case: 'membershipTransition',
      value: transition,
    },
  })
  const event = await conversationService.submitCommand(command)
  assertAuthorityAcceptedTransition(conversationId, transition, event)
  return event
}

const conversationService: ConversationServiceContract = {
  async createDirect(peerPtid, peerStationPeerId) {
    const resp = await cmd<any, { conversation: unknown }>('conversation_create_direct', {
      peer_ptid: peerPtid,
      peer_station_peer_id: peerStationPeerId ?? '',
    })
    return normalizeConversation(resp.conversation)
  },

  async createGroup(input) {
    const resp = await cmd<any, { conversation: unknown; transition_event: unknown }>(
      'conversation_create_group',
      {
        name: input.name,
        genesis_transition: membershipTransitionToWire(input.genesisTransition),
        federation_id: input.federationId ?? '',
        conversation_id: input.conversationId,
      },
    )
    const transitionEvent = normalizeConversationEvents([resp.transition_event])[0]
    if (!resp.conversation || !transitionEvent) {
      throw new Error('Station returned an incomplete group genesis result')
    }
    return {
      conversation: normalizeConversation(resp.conversation),
      transitionEvent,
    }
  },

  async submitCommand(command) {
    const normalized = canonicalizeConversationCommand(command)
    const [conversation, members] = await Promise.all([
      conversationService.getConversation(normalized.command.conversationId),
      conversationService.getMembers(normalized.command.conversationId),
    ])
    const sender = members.find(member => member.ptid === normalized.command.senderPtid)
    if (
      conversation.federationId
      && conversation.authorityStationPeerId !== sender?.actorHomeStationPeerId
    ) {
      if (!sender?.actorHomeStationPeerId) {
        throw new Error('Sender Home Station is unavailable')
      }
      return submitRemoteConversationCommand(
        normalized.command,
        conversation,
        sender.actorHomeStationPeerId,
      )
    }
    const resp = await cmd<any, { event: unknown }>('conversation_submit_command', {
      command: normalized.wire,
    })
    const event = normalizeConversationEvents([resp.event])[0]
    if (!event) throw new Error('Station returned no committed conversation event')
    return event
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

  async getConversation(conversationId) {
    const conversations = await conversationService.listConversations()
    const conversation = conversations.find(item => item.conversationId === conversationId)
    if (!conversation) throw new Error('Conversation not found')
    return conversation
  },

  async listConversations() {
    const resp = await cmd<void, { conversations: unknown[] }>('conversation_list')
    return (resp.conversations ?? []).map(normalizeConversation)
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

  async threadCounts(conversationId, rootIds) {
    const resp = await cmd<any, { counts: ThreadCountResult[] }>('conversation_thread_counts', {
      conversation_id: conversationId,
      root_ids: rootIds,
    })
    return { counts: resp.counts ?? [] }
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
  async register(deviceId, label, publicKey, signingKeyId) {
    await cmd('device_register', {
      device_id: deviceId,
      label: label ?? '',
      public_key: publicKey ? bytesToBase64(publicKey) : '',
      signing_key_id: signingKeyId ?? '',
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
  async initIdentity(ptid, deviceId) {
    const response = await cmd<any, {
      ptid: string
      signing_key_id: string
      public_key: number[]
    }>('mls_init_identity', { ptid, device_id: deviceId })
    return {
      ptid: response.ptid,
      signingKeyId: response.signing_key_id,
      publicKey: new Uint8Array(response.public_key),
    }
  },

  async generateKeyPackage() {
    const resp = await cmd<void, { key_package: number[] }>('mls_generate_key_package')
    return new Uint8Array(resp.key_package)
  },

  async createGroup(conversationId, members) {
    const resp = await cmd<any, {
      group_id: string
      transition_id: string
      from_mls_epoch: number
      to_mls_epoch: number
      welcome_bytes: number[]
      commit_bytes: number[]
      commit_sha256: number[]
    }>(
      'mls_group_create',
      {
        conversation_id: conversationId,
        members: members.map(member => ({
          ptid: member.ptid,
          device_id: member.deviceId,
          key_package: Array.from(member.keyPackage),
        })),
      },
    )
    return {
      groupId: resp.group_id,
      transitionId: resp.transition_id,
      fromMlsEpoch: resp.from_mls_epoch,
      toMlsEpoch: resp.to_mls_epoch,
      welcomeBytes: new Uint8Array(resp.welcome_bytes),
      commitBytes: new Uint8Array(resp.commit_bytes),
      commitSha256: new Uint8Array(resp.commit_sha256),
    }
  },

  async createAuthorizedGroup(input) {
    if (!input.ownerPtid || !input.ownerDeviceId || input.members.length === 0) {
      throw new Error('MLS group genesis requires an owner device and at least one member')
    }
    const prepared = await mlsGroupService.createGroup(
      input.conversationId,
      input.members,
    )
    const welcomeSha256 = await sha256(prepared.welcomeBytes)
    const addedPtids = new Set([input.ownerPtid])
    const changes = [
      create(MembershipTransitionChangeSchema, {
        ptid: input.ownerPtid,
        actorHomeStationPeerId: input.ownerHomeStationPeerId ?? '',
        action: MembershipTransitionAction.ADD,
        role: MemberRole.OWNER,
        deviceId: input.ownerDeviceId,
      }),
      ...input.members.map((member) => {
        const action = addedPtids.has(member.ptid)
          ? MembershipTransitionAction.ADD_DEVICE
          : MembershipTransitionAction.ADD
        addedPtids.add(member.ptid)
        return create(MembershipTransitionChangeSchema, {
          ptid: member.ptid,
          actorHomeStationPeerId: member.homeStationPeerId,
          action,
          role: action === MembershipTransitionAction.ADD
            ? MemberRole.MEMBER
            : MemberRole.UNSPECIFIED,
          deviceId: member.deviceId,
        })
      }),
    ]
    const welcomeDeliveries = input.members.map(member => create(MlsWelcomeDeliverySchema, {
      recipientPtid: member.ptid,
      recipientDeviceId: member.deviceId,
      recipientHomeStationPeerId: member.homeStationPeerId,
      opaqueWelcomeBytes: prepared.welcomeBytes,
      welcomeSha256,
    }))
    const genesisTransition = create(MembershipTransitionCommandSchema, {
      transitionId: prepared.transitionId,
      fromMembershipEpoch: 0n,
      fromMlsEpoch: BigInt(prepared.fromMlsEpoch),
      toMlsEpoch: BigInt(prepared.toMlsEpoch),
      changes,
      opaqueMlsCommitBytes: prepared.commitBytes,
      commitSha256: prepared.commitSha256,
      welcomeDeliveries,
      idempotencyKey: `genesis:${prepared.transitionId}`,
    })
    let accepted: CreateGroupConversationResult
    try {
      accepted = await conversationService.createGroup({
        conversationId: input.conversationId,
        name: input.name,
        federationId: input.federationId,
        genesisTransition,
      })
    } catch (error) {
      await discardRejectedTransition(input.conversationId, error)
      throw error
    }
    assertAuthorityAcceptedTransition(
      input.conversationId,
      genesisTransition,
      accepted.transitionEvent,
    )
    await mlsGroupService.acceptPending(input.conversationId, prepared.transitionId)
    const genesisEvents = await conversationService.listEvents(input.conversationId, 0, 2)
    if (genesisEvents.length !== 2) {
      throw new Error('Authority returned an incomplete group genesis event chain')
    }
    for (const event of genesisEvents) {
      await mlsGroupService.recordAuthorityEvent(
        toBinary(CommittedConversationEventSchema, event),
        input.ownerDeviceId,
      )
    }
    return accepted
  },

  async addAuthorizedDevice(input) {
    const prepared = await mlsGroupService.addMember(
      input.conversationId,
      input.member,
    )
    const welcomeSha256 = await sha256(prepared.welcomeBytes)
    const transition = create(MembershipTransitionCommandSchema, {
      transitionId: prepared.transitionId,
      fromMembershipEpoch: BigInt(input.observedMembershipEpoch),
      fromMlsEpoch: BigInt(prepared.fromMlsEpoch),
      toMlsEpoch: BigInt(prepared.toMlsEpoch),
      changes: [create(MembershipTransitionChangeSchema, {
        ptid: input.member.ptid,
        actorHomeStationPeerId: input.member.homeStationPeerId,
        action: MembershipTransitionAction.ADD_DEVICE,
        deviceId: input.member.deviceId,
      })],
      opaqueMlsCommitBytes: prepared.commitBytes,
      commitSha256: prepared.commitSha256,
      welcomeDeliveries: [create(MlsWelcomeDeliverySchema, {
        recipientPtid: input.member.ptid,
        recipientDeviceId: input.member.deviceId,
        recipientHomeStationPeerId: input.member.homeStationPeerId,
        opaqueWelcomeBytes: prepared.welcomeBytes,
        welcomeSha256,
      })],
      idempotencyKey: `membership:${prepared.transitionId}`,
    })
    let event: CommittedConversationEvent
    try {
      event = await submitAuthorizedMembershipTransition(
        input.conversationId,
        input.senderPtid,
        input.senderDeviceId,
        input.observedMembershipEpoch,
        transition,
      )
    } catch (error) {
      await discardRejectedTransition(input.conversationId, error)
      throw error
    }
    await mlsGroupService.acceptPending(input.conversationId, prepared.transitionId)
    await mlsGroupService.recordAuthorityEvent(
      toBinary(CommittedConversationEventSchema, event),
      input.senderDeviceId,
    )
    return event
  },

  async removeAuthorizedDevice(input) {
    const prepared = await mlsGroupService.removeDevice(
      input.conversationId,
      input.memberPtid,
      input.memberDeviceId,
    )
    const transition = create(MembershipTransitionCommandSchema, {
      transitionId: prepared.transitionId,
      fromMembershipEpoch: BigInt(input.observedMembershipEpoch),
      fromMlsEpoch: BigInt(prepared.fromMlsEpoch),
      toMlsEpoch: BigInt(prepared.toMlsEpoch),
      changes: [create(MembershipTransitionChangeSchema, {
        ptid: input.memberPtid,
        action: MembershipTransitionAction.REMOVE_DEVICE,
        deviceId: input.memberDeviceId,
      })],
      opaqueMlsCommitBytes: prepared.commitBytes,
      commitSha256: prepared.commitSha256,
      idempotencyKey: `membership:${prepared.transitionId}`,
    })
    let event: CommittedConversationEvent
    try {
      event = await submitAuthorizedMembershipTransition(
        input.conversationId,
        input.senderPtid,
        input.senderDeviceId,
        input.observedMembershipEpoch,
        transition,
      )
    } catch (error) {
      await discardRejectedTransition(input.conversationId, error)
      throw error
    }
    await mlsGroupService.acceptPending(input.conversationId, prepared.transitionId)
    await mlsGroupService.recordAuthorityEvent(
      toBinary(CommittedConversationEventSchema, event),
      input.senderDeviceId,
    )
    return event
  },

  async requestLeaveIntent(input) {
    const intent = await cmd<any, Record<string, any>>('mls_submit_leave_intent', {
      federation_id: input.federationId,
      authority_station_peer_id: input.authorityStationPeerId,
      authority_epoch: input.authorityEpoch,
      home_station_peer_id: input.homeStationPeerId,
      conversation_id: input.conversationId,
      actor_ptid: input.actorPtid,
      actor_device_id: input.actorDeviceId,
      observed_membership_epoch: input.observedMembershipEpoch,
      observed_mls_epoch: input.observedMlsEpoch,
    })
    return normalizeLeaveIntent(intent)
  },

  async listLeaveIntents(conversationId) {
    const response = await cmd<any, { intents: Record<string, any>[] }>(
      'mls_list_leave_intents',
      { conversation_id: conversationId },
    )
    return (response.intents ?? []).map(normalizeLeaveIntent)
  },

  async commitAuthorizedLeave(input) {
    if (
      input.intent.conversationId !== input.conversationId
      || input.intent.observedMembershipEpoch !== input.observedMembershipEpoch
      || input.intent.actorPtid === input.senderPtid
    ) {
      throw new Error('leave intent does not match the delegated transition head')
    }
    const prepared = await mlsGroupService.removeMember(
      input.conversationId,
      input.intent.actorPtid,
    )
    if (prepared.fromMlsEpoch !== input.intent.observedMlsEpoch) {
      await mlsGroupService.discardPending(input.conversationId)
      throw new Error('leave intent MLS epoch is stale')
    }
    const transition = create(MembershipTransitionCommandSchema, {
      transitionId: prepared.transitionId,
      fromMembershipEpoch: BigInt(input.observedMembershipEpoch),
      fromMlsEpoch: BigInt(prepared.fromMlsEpoch),
      toMlsEpoch: BigInt(prepared.toMlsEpoch),
      changes: [create(MembershipTransitionChangeSchema, {
        ptid: input.intent.actorPtid,
        action: MembershipTransitionAction.LEAVE,
      })],
      opaqueMlsCommitBytes: prepared.commitBytes,
      commitSha256: prepared.commitSha256,
      idempotencyKey: `membership:${prepared.transitionId}`,
      leaveIntentId: input.intent.intentId,
    })
    let event: CommittedConversationEvent
    try {
      event = await submitAuthorizedMembershipTransition(
        input.conversationId,
        input.senderPtid,
        input.senderDeviceId,
        input.observedMembershipEpoch,
        transition,
      )
    } catch (error) {
      await discardRejectedTransition(input.conversationId, error)
      throw error
    }
    await mlsGroupService.acceptPending(input.conversationId, prepared.transitionId)
    await mlsGroupService.recordAuthorityEvent(
      toBinary(CommittedConversationEventSchema, event),
      input.senderDeviceId,
    )
    return event
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

  async addMember(conversationId, member) {
    const resp = await cmd<any, {
      transition_id: string
      from_mls_epoch: number
      to_mls_epoch: number
      commit_bytes: number[]
      commit_sha256: number[]
      welcome_bytes: number[]
    }>(
      'mls_group_add_member',
      {
        conversation_id: conversationId,
        member: {
          ptid: member.ptid,
          device_id: member.deviceId,
          key_package: Array.from(member.keyPackage),
        },
      },
    )
    return {
      transitionId: resp.transition_id,
      fromMlsEpoch: resp.from_mls_epoch,
      toMlsEpoch: resp.to_mls_epoch,
      commitBytes: new Uint8Array(resp.commit_bytes),
      commitSha256: new Uint8Array(resp.commit_sha256),
      welcomeBytes: new Uint8Array(resp.welcome_bytes),
    }
  },

  async removeMember(conversationId, memberPtid) {
    const resp = await cmd<any, {
      transition_id: string
      from_mls_epoch: number
      to_mls_epoch: number
      commit_bytes: number[]
      commit_sha256: number[]
      welcome_bytes: number[]
    }>('mls_group_remove_member', {
      conversation_id: conversationId,
      member_ptid: memberPtid,
    })
    return {
      transitionId: resp.transition_id,
      fromMlsEpoch: resp.from_mls_epoch,
      toMlsEpoch: resp.to_mls_epoch,
      commitBytes: new Uint8Array(resp.commit_bytes),
      commitSha256: new Uint8Array(resp.commit_sha256),
      welcomeBytes: new Uint8Array(resp.welcome_bytes),
    }
  },

  async removeDevice(conversationId, memberPtid, deviceId) {
    const resp = await cmd<any, {
      transition_id: string
      from_mls_epoch: number
      to_mls_epoch: number
      commit_bytes: number[]
      commit_sha256: number[]
      welcome_bytes: number[]
    }>('mls_group_remove_device', {
      conversation_id: conversationId,
      member_ptid: memberPtid,
      device_id: deviceId,
    })
    return {
      transitionId: resp.transition_id,
      fromMlsEpoch: resp.from_mls_epoch,
      toMlsEpoch: resp.to_mls_epoch,
      commitBytes: new Uint8Array(resp.commit_bytes),
      commitSha256: new Uint8Array(resp.commit_sha256),
      welcomeBytes: new Uint8Array(resp.welcome_bytes),
    }
  },

  async acceptPending(conversationId, transitionId) {
    await cmd('mls_group_accept_pending', {
      conversation_id: conversationId,
      transition_id: transitionId,
    })
  },

  async discardPending(conversationId) {
    const resp = await cmd<any, { discarded: boolean }>('mls_group_discard_pending', {
      conversation_id: conversationId,
    })
    return resp.discarded
  },

  async pendingStatus(conversationId) {
    const resp = await cmd<any, { pending: boolean }>('mls_group_pending_status', {
      conversation_id: conversationId,
    })
    return resp.pending
  },

  async recordAuthorityEvent(eventBytes, recipientDeviceId) {
    return cmd<{ event_bytes: number[]; recipient_device_id: string }, {
      status: 'active' | 'establishing'
      applied: number
      duplicate: boolean
      buffered: number
    }>('mls_recipient_record_authority_event', {
      event_bytes: Array.from(eventBytes),
      recipient_device_id: recipientDeviceId,
    })
  },

  async applyTransitionDelivery(deliveryBytes, recipientDeviceId) {
    return cmd<{ delivery_bytes: number[]; recipient_device_id: string }, {
      status: 'active' | 'establishing'
      applied: number
      duplicate: boolean
      buffered: number
    }>('mls_recipient_apply_delivery', {
      delivery_bytes: Array.from(deliveryBytes),
      recipient_device_id: recipientDeviceId,
    })
  },

  async recipientStatus(conversationId) {
    const result = await cmd<{ conversation_id: string }, {
      status: 'idle' | 'active' | 'establishing' | 'crypto_desynced'
      group_seq: number
      membership_epoch: number
      mls_epoch: number
      buffered: number
      last_error: string
    }>('mls_recipient_status', {
      conversation_id: conversationId,
    })
    return {
      status: result.status,
      groupSeq: result.group_seq,
      membershipEpoch: result.membership_epoch,
      mlsEpoch: result.mls_epoch,
      buffered: result.buffered,
      lastError: result.last_error,
    }
  },

  async publicHead(conversationId) {
    const head = await cmd<any, {
      conversation_id: string
      mls_epoch: number
      group_context_sha256: string
      ratchet_tree_sha256: string
      member_credentials_sha256: string
      members: Array<{ ptid: string; device_id: string }>
    }>('mls_group_public_head', { conversation_id: conversationId })
    return {
      conversationId: head.conversation_id,
      mlsEpoch: head.mls_epoch,
      groupContextSha256: head.group_context_sha256,
      ratchetTreeSha256: head.ratchet_tree_sha256,
      memberCredentialsSha256: head.member_credentials_sha256,
      members: head.members.map(member => ({
        ptid: member.ptid,
        deviceId: member.device_id,
      })),
    }
  },

  async save(conversationId) {
    await cmd('mls_group_save', { conversation_id: conversationId })
  },

  async load(conversationId) {
    await cmd('mls_group_load', { conversation_id: conversationId })
  },
}

const dkxService: DirectKeyExchangeServiceContract = {
  async send(
    recipientPtid,
    recipientDeviceId,
    conversationId,
    sessionId,
    kind,
    opaqueKeyMaterial,
    recipientStationPeerId,
  ) {
    if (!recipientPtid || !recipientDeviceId) {
      throw new Error('direct key exchange requires a recipient endpoint');
    }
    const resp = await cmd<any, { envelope_id: string }>('dkx_send', {
      recipient_ptid: recipientPtid,
      recipient_device_id: recipientDeviceId,
      recipient_station_peer_id: recipientStationPeerId ?? '',
      conversation_id: conversationId,
      session_id: sessionId,
      kind: kind as number,
      opaque_key_material: bytesToBase64(opaqueKeyMaterial),
    })
    return resp.envelope_id
  },
}

const messagingService: MessagingServiceContract = {
  async createDirect(peerPtid) {
    const response = await cmd<
      { peer_ptid: string },
      { conversation_id: string; state: 'projected' }
    >('messaging_create_direct', { peer_ptid: peerPtid })
    return {
      conversationId: response.conversation_id,
      state: response.state,
    }
  },

  async createGroup(conversationId, name, memberPtids) {
    const response = await cmd<
      { conversation_id: string; name: string; member_ptids: string[] },
      { conversation_id: string; state: 'projected' }
    >('messaging_create_group', {
      conversation_id: conversationId,
      name,
      member_ptids: memberPtids,
    })
    return {
      conversationId: response.conversation_id,
      state: response.state,
    }
  },

  async submitMembershipIntent(intent) {
    const response = await cmd<
      {
        conversation_id: string
        action: 'add_actor' | 'remove_actor'
        target_ptid: string
      },
      { command_id: string; state: 'pending' }
    >('messaging_membership_transition', {
      conversation_id: intent.conversationId,
      action: intent.action,
      target_ptid: intent.targetPtid,
    })
    return {
      commandId: response.command_id,
      state: response.state,
    }
  },

  async listConversations() {
    const response = await cmd<
      void,
      {
        conversations: Array<{
          conversation_id: string
          kind: number
          name: string
          owner_ptid: string
          member_ptids: string[]
          membership_epoch: number
          mls_epoch: number
          active: boolean
          updated_at_unix_ms: number
        }>
      }
    >('messaging_list_conversations')
    return response.conversations.map(conversation => ({
      conversationId: conversation.conversation_id,
      kind: conversation.kind as 1 | 2,
      name: conversation.name,
      ownerPtid: conversation.owner_ptid,
      memberPtids: conversation.member_ptids,
      membershipEpoch: conversation.membership_epoch,
      mlsEpoch: conversation.mls_epoch,
      active: conversation.active,
      updatedAtUnixMs: conversation.updated_at_unix_ms,
    }))
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
      state: response.state,
    }
  },

  async listMessages(conversationId) {
    const response = await cmd<
      { conversation_id: string },
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
    >('messaging_list_messages', { conversation_id: conversationId })
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
  envelope: envelopeService,
  keyPackage: keyPackageService,
  device: deviceService,
  mlsGroup: mlsGroupService,
  dkx: dkxService,
  messaging: messagingService,
}

export { DirectKeyExchangeKind }
