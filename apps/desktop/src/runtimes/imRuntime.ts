import { fromBinary, toBinary } from '@bufbuild/protobuf'
import {
  consumeCommandResultDelivery,
  imServiceV1,
  reconcilePendingConversationCommands,
} from '../services/im-service'
import { DirectKeyExchangeKind } from '../services/im-service-contract'
import { DirectKeyExchangePayloadSchema } from '../gen/proto/domain/chat/envelope_pb'
import { X3dhSessionInitSchema } from '../gen/proto/domain/chat/key_exchange_pb'
import {
  CommittedConversationEventSchema,
} from '../gen/proto/domain/chat/conversation_pb'
import { useSocialChatStore } from '../store/socialChat'
import { normalizeConversations } from '../store/socialNormalizers'
import type { RuntimeDescriptor } from '../kernel/runtime'
import { log } from '../utils/logger'
import { EVENT, eventBus } from '../kernel/events'
import { api } from '../services/desktop_api'
import { decodeChatReceipt } from '../services/chatReceipt'

interface IMState {
  initialized: boolean
  deviceId: string | null
  actorPtid: string | null
  conversations: Map<string, ConversationProjection>
  pendingResume: boolean
  sseConnected: boolean
}

interface ConversationProjection {
  conversationId: string
  kind: 'direct' | 'group'
  lastSeq: number
  unreadCount: number
}

const state: IMState = {
  initialized: false,
  deviceId: null,
  actorPtid: null,
  conversations: new Map(),
  pendingResume: false,
  sseConnected: false,
}

const DEDUP_MAX_SIZE = 2000
const processedInboxItemIds = new Set<string>()
const processedOrder: string[] = []

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function isProcessed(inboxItemId: string): boolean {
  return processedInboxItemIds.has(inboxItemId)
}

function markProcessed(inboxItemId: string): void {
  if (processedInboxItemIds.has(inboxItemId)) return
  processedInboxItemIds.add(inboxItemId)
  processedOrder.push(inboxItemId)
  while (processedOrder.length > DEDUP_MAX_SIZE) {
    const oldest = processedOrder.shift()!
    processedInboxItemIds.delete(oldest)
  }
}

let resumeIntervalId: ReturnType<typeof setInterval> | null = null
let leaveIntentIntervalId: ReturnType<typeof setInterval> | null = null
let eventUnsubscribers: (() => void)[] = []

function triggerImmediateResume(): void {
  if (!state.initialized) return
  resumeEnvelopes()
}

async function getDeviceId(): Promise<string> {
  if (state.deviceId) return state.deviceId
  try {
    const result = await api.accountGetDeviceId()
    const id = (result as { device_id: string }).device_id
    if (id) {
      state.deviceId = id
      return id
    }
  } catch {
    // Fallback to localStorage for browser-dev-gateway mode
  }
  let id = localStorage.getItem('peers_im_device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('peers_im_device_id', id)
  }
  state.deviceId = id
  return id
}

async function registerDevice(
  _actorId: string,
  signingIdentity: { signingKeyId: string; publicKey: Uint8Array },
): Promise<string> {
  const deviceId = await getDeviceId()
  await imServiceV1.device.register(
    deviceId,
    navigator.userAgent,
    signingIdentity.publicKey,
    signingIdentity.signingKeyId,
  )
  log.info('im-runtime', 'device registered', { deviceId })
  return deviceId
}

async function initMlsIdentity(actorId: string, deviceId: string) {
  const identity = await imServiceV1.mlsGroup.initIdentity(actorId, deviceId)
  log.info('im-runtime', 'MLS identity initialized')
  return identity
}

const KEY_PACKAGE_TARGET = 10

async function uploadKeyPackages(): Promise<void> {
  try {
    const available = await imServiceV1.keyPackage.countAvailable()
    const replenish = Math.max(0, KEY_PACKAGE_TARGET - available)
    const deviceId = await getDeviceId()
    for (let i = 0; i < replenish; i++) {
      const kpBytes = await imServiceV1.mlsGroup.generateKeyPackage()
      await imServiceV1.keyPackage.upload(deviceId, kpBytes)
    }
    log.info('im-runtime', 'key package pool replenished', {
      available,
      generated: replenish,
    })
  } catch (err) {
    log.warn('im-runtime', 'key package upload failed', { err })
  }
}

async function loadConversations(): Promise<void> {
  try {
    const raw = await imServiceV1.conversation.listConversations()
    const convs = normalizeConversations(raw)
    state.conversations.clear()
    for (const conv of convs) {
      state.conversations.set(conv.conversationId, {
        conversationId: conv.conversationId,
        kind: conv.kind === 1 ? 'direct' : 'group',
        lastSeq: 0,
        unreadCount: 0,
      })
    }
    log.info('im-runtime', 'conversations loaded', { count: convs.length })
  } catch (err) {
    log.warn('im-runtime', 'load conversations failed', { err })
  }
}

async function requireConversationProjection(
  conversationId: string,
): Promise<ConversationProjection> {
  let conversation = state.conversations.get(conversationId)
  if (!conversation && conversationId) {
    await loadConversations()
    conversation = state.conversations.get(conversationId)
  }
  if (!conversation) {
    throw new Error(`conversation metadata unavailable: ${conversationId}`)
  }
  return conversation
}

async function restoreMlsSessions(): Promise<void> {
  for (const [convId, conv] of state.conversations) {
    if (conv.kind !== 'group') continue
    let sessionLoaded = false
    try {
      await imServiceV1.mlsGroup.load(convId)
      sessionLoaded = true
    } catch {
      // A durable event/material buffer may exist before the first Welcome.
    }
    try {
      const [pending, recipient] = await Promise.all([
        imServiceV1.mlsGroup.pendingStatus(convId),
        imServiceV1.mlsGroup.recipientStatus(convId),
      ])
      const securityState = recipient.status === 'crypto_desynced'
        ? 'crypto-desynced'
        : pending || recipient.status === 'establishing'
          ? 'establishing'
          : sessionLoaded
            ? 'ready'
            : 'idle'
      useSocialChatStore.getState().setGroupSecurityState(convId, securityState)
    } catch {
      useSocialChatStore.getState().setGroupSecurityState(
        convId,
        sessionLoaded ? 'ready' : 'idle',
      )
    }
  }
}

let processingLeaveIntents = false

async function processPendingLeaveIntents(): Promise<void> {
  if (processingLeaveIntents || !state.actorPtid || !state.deviceId) return
  processingLeaveIntents = true
  try {
    for (const [conversationId, conversation] of state.conversations) {
      if (conversation.kind !== 'group') continue
      const recipient = await imServiceV1.mlsGroup.recipientStatus(conversationId)
      if (recipient.status !== 'active') continue
      const intents = await imServiceV1.mlsGroup.listLeaveIntents(conversationId)
      for (const intent of intents) {
        if (intent.actorPtid === state.actorPtid) {
          useSocialChatStore.getState().setGroupSecurityState(conversationId, 'establishing')
          continue
        }
        if (
          intent.observedMembershipEpoch !== recipient.membershipEpoch
          || intent.observedMlsEpoch !== recipient.mlsEpoch
        ) {
          continue
        }
        try {
          await imServiceV1.mlsGroup.commitAuthorizedLeave({
            conversationId,
            senderPtid: state.actorPtid,
            senderDeviceId: state.deviceId,
            observedMembershipEpoch: intent.observedMembershipEpoch,
            intent,
          })
          log.info('im-runtime', 'delegated MLS leave committed', {
            conversationId,
            intentId: intent.intentId,
            actorPtid: intent.actorPtid,
          })
        } catch (err) {
          log.warn('im-runtime', 'delegated MLS leave not committed', {
            conversationId,
            intentId: intent.intentId,
            err,
          })
        }
      }
    }
  } finally {
    processingLeaveIntents = false
  }
}

async function reconcileMlsRecipient(
  conversationId: string,
  recipientDeviceId: string,
): Promise<void> {
  try {
    const status = await imServiceV1.mlsGroup.recipientStatus(conversationId)
    if (status.status === 'crypto_desynced') {
      useSocialChatStore.getState().setGroupSecurityState(
        conversationId,
        'crypto-desynced',
      )
      return
    }
    const events = await imServiceV1.conversation.listEvents(
      conversationId,
      status.groupSeq,
      128,
    )
    let latestStatus: 'active' | 'establishing' = status.status === 'active'
      ? 'active'
      : 'establishing'
    for (const event of events) {
      const result = await imServiceV1.mlsGroup.recordAuthorityEvent(
        toBinary(CommittedConversationEventSchema, event),
        recipientDeviceId,
      )
      latestStatus = result.status
    }
    useSocialChatStore.getState().setGroupSecurityState(
      conversationId,
      latestStatus === 'active' ? 'ready' : 'establishing',
    )
  } catch (error) {
    log.warn('im-runtime', 'MLS recipient reconciliation deferred', {
      conversationId,
      error,
    })
    try {
      const status = await imServiceV1.mlsGroup.recipientStatus(conversationId)
      if (status.status === 'crypto_desynced') {
        useSocialChatStore.getState().setGroupSecurityState(
          conversationId,
          'crypto-desynced',
        )
      }
    } catch {
      // Authority unavailability keeps the existing establishing state.
    }
  }
}

async function reconcileCommandProposals(): Promise<void> {
  const events = await reconcilePendingConversationCommands()
  if (events.length === 0) return
  const deviceId = await getDeviceId()
  const dirtyConversations = new Set<string>()
  for (const event of events) {
    const conversation = await requireConversationProjection(event.conversationId)
    if (conversation.kind === 'group') {
      await imServiceV1.mlsGroup.recordAuthorityEvent(
        toBinary(CommittedConversationEventSchema, event),
        deviceId,
      )
    }
    dirtyConversations.add(event.conversationId)
  }
  await refreshDirtyConversations(dirtyConversations)
}

// ---------------------------------------------------------------------------
// Envelope payload processing (shared between SSE push and resume poll paths)
// ---------------------------------------------------------------------------

async function processEnvelopePayload(
  payloadType: number,
  payloadBytes: Uint8Array,
  conversationId: string,
  senderPtid: string,
  recipientDeviceId: string,
  dirtyConversations: Set<string>,
): Promise<void> {
  switch (payloadType) {
    case 1: { // COMMITTED_EVENT
      if (payloadBytes.length === 0) break
      const conversation = await requireConversationProjection(conversationId)
      if (conversation.kind === 'group') {
        try {
          const result = await imServiceV1.mlsGroup.recordAuthorityEvent(
            payloadBytes,
            recipientDeviceId,
          )
          useSocialChatStore.getState().setGroupSecurityState(
            conversationId,
            result.status === 'active' ? 'ready' : 'establishing',
          )
          if (result.status === 'establishing') {
            await reconcileMlsRecipient(conversationId, recipientDeviceId)
          }
        } catch (error) {
          useSocialChatStore.getState().setGroupSecurityState(
            conversationId,
            'crypto-desynced',
          )
          throw error
        }
      }
      if (conversationId) dirtyConversations.add(conversationId)
      break
    }
    case 2: { // MLS_TRANSITION_DELIVERY
      if (payloadBytes.length === 0) break
      const conversation = await requireConversationProjection(conversationId)
      if (conversation.kind !== 'group') {
        throw new Error('MLS transition delivery targets a direct conversation')
      }
      try {
        const result = await imServiceV1.mlsGroup.applyTransitionDelivery(
          payloadBytes,
          recipientDeviceId,
        )
        useSocialChatStore.getState().setGroupSecurityState(
          conversationId,
          result.status === 'active' ? 'ready' : 'establishing',
        )
        if (result.status === 'establishing') {
          await reconcileMlsRecipient(conversationId, recipientDeviceId)
        }
        log.info('im-runtime', 'MLS transition delivery recorded', {
          conversationId,
          applied: result.applied,
          duplicate: result.duplicate,
          buffered: result.buffered,
        })
      } catch (err) {
        if (conversationId) {
          useSocialChatStore.getState().setGroupSecurityState(
            conversationId,
            'crypto-desynced',
          )
        }
        log.warn('im-runtime', 'MLS_TRANSITION_DELIVERY processing failed', { err })
        throw err
      }
      break
    }
    case 3: { // DIRECT_KEY_EXCHANGE
      if (payloadBytes.length === 0 || !senderPtid) break
      try {
        const delivery = fromBinary(DirectKeyExchangePayloadSchema, payloadBytes)
        if (delivery.kind !== DirectKeyExchangeKind.INITIAL_MESSAGE) break
        const init = fromBinary(X3dhSessionInitSchema, delivery.opaqueKeyMaterial)
        if (!init.sessionId || init.sessionId !== delivery.sessionId) {
          throw new Error('direct key exchange session mismatch')
        }
        if (init.negotiatedVersion !== 1) {
          throw new Error('unsupported direct secure-channel version')
        }
        await api.cryptoAcceptSession({
          sessionId: init.sessionId,
          peerDid: senderPtid,
          senderIdentityKey: bytesToBase64(init.senderIdentityKey),
          senderEphemeralKey: bytesToBase64(init.senderEphemeralKey),
          recipientSignedPrekey: bytesToBase64(init.recipientSignedPrekey),
          recipientOneTimePrekey: init.recipientOneTimePrekey.length > 0
            ? bytesToBase64(init.recipientOneTimePrekey)
            : undefined,
          negotiatedVersion: init.negotiatedVersion,
        })
        useSocialChatStore.getState().setSessionSecurityState(
          init.sessionId,
          'ready',
          init.negotiatedVersion,
        )
        dirtyConversations.add(init.sessionId)
        log.info('im-runtime', 'direct secure channel established', {
          conversationId: init.sessionId,
          version: init.negotiatedVersion,
        })
      } catch (err) {
        log.warn('im-runtime', 'DIRECT_KEY_EXCHANGE processing failed', { err })
      }
      break
    }
    case 4: { // RECEIPT
      const receipt = decodeChatReceipt(payloadBytes)
      if (!receipt) break
      useSocialChatStore.getState().applyMessageReceipt(
        receipt.conversationId,
        receipt.messageId,
        receipt.kind,
      )
      break
    }
    case 7: { // CONVERSATION_COMMAND_RESULT
      if (payloadBytes.length === 0) break
      const event = await consumeCommandResultDelivery(payloadBytes)
      if (!event) break
      const conversation = await requireConversationProjection(event.conversationId)
      if (conversation.kind === 'group') {
        await imServiceV1.mlsGroup.recordAuthorityEvent(
          toBinary(CommittedConversationEventSchema, event),
          recipientDeviceId,
        )
      }
      dirtyConversations.add(event.conversationId)
      break
    }
    default:
      break
  }
}

// ---------------------------------------------------------------------------
// SSE push handler — processes envelopes delivered in real-time via SSE
// ---------------------------------------------------------------------------

async function handleEnvelopeDelivered(data: {
  inboxItemId: string
  envelopeId: string
  conversationId: string
  payloadType: number
  payloadBytes: Uint8Array
  senderPtid: string
  senderDeviceId: string
  recipientDeviceId: string
  membershipEpoch: number
  queuedTsUnixMs: number
}): Promise<void> {
  const deviceId = await getDeviceId()
  if (isProcessed(data.inboxItemId)) {
    await imServiceV1.envelope.ack(deviceId, data.inboxItemId)
    return
  }

  const dirtyConversations = new Set<string>()
  const payloadBytes = data.payloadBytes instanceof Uint8Array
    ? data.payloadBytes
    : new Uint8Array(data.payloadBytes ?? [])

  await processEnvelopePayload(
    data.payloadType,
    payloadBytes,
    data.conversationId,
    data.senderPtid,
    data.recipientDeviceId,
    dirtyConversations,
  )

  markProcessed(data.inboxItemId)
  try {
    await imServiceV1.envelope.ack(deviceId, data.inboxItemId)
  } catch (err) {
    log.warn('im-runtime', 'SSE envelope ACK failed', { inboxItemId: data.inboxItemId, err })
  }

  if (dirtyConversations.size > 0) {
    await refreshDirtyConversations(dirtyConversations)
  }
}

// ---------------------------------------------------------------------------
// Resume poll path (fallback when SSE is disconnected, or cold catch-up)
// ---------------------------------------------------------------------------

async function resumeEnvelopes(): Promise<void> {
  if (state.pendingResume) return
  state.pendingResume = true
  try {
    const deviceId = await getDeviceId()
    const items = await imServiceV1.envelope.resume(deviceId)
    if (items.length === 0) return

    log.info('im-runtime', 'envelope resume', { count: items.length })
    const dirtyConversations = new Set<string>()

    for (const item of items) {
      if (isProcessed(item.inboxItemId)) {
        await imServiceV1.envelope.ack(deviceId, item.inboxItemId)
        continue
      }

      const env = item.envelope
      if (env) {
        const payloadBytes = env.payloadBytes instanceof Uint8Array
          ? env.payloadBytes
          : new Uint8Array(env.payloadBytes ?? [])
        await processEnvelopePayload(
          env.payloadType,
          payloadBytes,
          env.conversationId ?? '',
          env.senderPtid ?? '',
          env.recipientDeviceId ?? '',
          dirtyConversations,
        )
      }
      markProcessed(item.inboxItemId)
      await imServiceV1.envelope.ack(deviceId, item.inboxItemId)
    }

    if (dirtyConversations.size > 0) {
      await refreshDirtyConversations(dirtyConversations)
    }
  } catch (err) {
    log.warn('im-runtime', 'envelope resume failed', { err })
  } finally {
    state.pendingResume = false
  }
}

async function refreshDirtyConversations(conversationIds: Set<string>): Promise<void> {
  const store = useSocialChatStore.getState()
  const knownConvIds = new Set(store.conversations.map((c) => c.conversationId))
  let hasNewConversation = false

  for (const convId of conversationIds) {
    if (!knownConvIds.has(convId)) {
      hasNewConversation = true
      continue
    }
    try {
      const kind = state.conversations.get(convId)?.kind ?? 'group'
      await store.loadMessages(convId, kind === 'direct' ? 'friend' : 'group')
    } catch (err) {
      log.warn('im-runtime', 'refresh dirty conversation failed', { convId, err })
    }
  }

  if (hasNewConversation) {
    await store.loadSessions()
  }

  await store.loadGroupUnreadCounts?.()
  await store.loadConversationPreviews?.()
}

// ---------------------------------------------------------------------------
// Polling lifecycle — degrades based on SSE connection state
// ---------------------------------------------------------------------------

function startResumePolling(): void {
  if (resumeIntervalId) return
  resumeIntervalId = setInterval(() => {
    resumeEnvelopes()
  }, 5000)
}

function stopResumePolling(): void {
  if (resumeIntervalId) {
    clearInterval(resumeIntervalId)
    resumeIntervalId = null
  }
}

function startLeaveIntentPolling(): void {
  if (leaveIntentIntervalId) return
  leaveIntentIntervalId = setInterval(() => {
    processPendingLeaveIntents()
  }, 5000)
}

function stopLeaveIntentPolling(): void {
  if (!leaveIntentIntervalId) return
  clearInterval(leaveIntentIntervalId)
  leaveIntentIntervalId = null
}

function handleConnectionStateChange(payload: { connected: boolean }): void {
  state.sseConnected = payload.connected
  if (payload.connected) {
    triggerImmediateResume()
  }
  startResumePolling()
}

// ---------------------------------------------------------------------------
// Runtime descriptor
// ---------------------------------------------------------------------------

export const imRuntime: RuntimeDescriptor = {
  id: 'im',
  scope: 'session',

  install(): void {
    startResumePolling()
    startLeaveIntentPolling()
    eventUnsubscribers = [
      eventBus.subscribe(EVENT.REALTIME_RESYNC, triggerImmediateResume),
      eventBus.subscribe(EVENT.REALTIME_GROUP_MEMBERSHIP_CHANGE, triggerImmediateResume),
      eventBus.subscribe(EVENT.REALTIME_GROUP_FEDERATION_EVENT, triggerImmediateResume),
      eventBus.subscribe(EVENT.REALTIME_ENVELOPE_DELIVERED, handleEnvelopeDelivered),
      eventBus.subscribe(EVENT.REALTIME_CONNECTION_STATE, handleConnectionStateChange),
    ]
  },

  teardown(): void {
    stopResumePolling()
    stopLeaveIntentPolling()
    for (const unsub of eventUnsubscribers) unsub()
    eventUnsubscribers = []
    state.initialized = false
    state.deviceId = null
    state.actorPtid = null
    state.sseConnected = false
    state.conversations.clear()
    processedInboxItemIds.clear()
    processedOrder.length = 0
  },

  async bootstrap(actorId: string | null): Promise<void> {
    if (!actorId) return
    if (state.initialized) return

    const profile = await api.actorGetMyProfile()
    const deviceId = await getDeviceId()
    const signingIdentity = await initMlsIdentity(profile.id, deviceId)
    const actorPtid = signingIdentity.ptid
    if (!actorPtid.startsWith('ptid:')) {
      throw new Error('authenticated actor has no canonical PTID')
    }
    state.actorPtid = actorPtid
    await registerDevice(actorPtid, signingIdentity)
    await uploadKeyPackages()
    await loadConversations()
    await restoreMlsSessions()
    await resumeEnvelopes()
    await reconcileCommandProposals()
    await processPendingLeaveIntents()

    state.initialized = true
    log.info('im-runtime', 'bootstrap complete', { actorPtid })
  },

  async reconcile(_reason: string): Promise<void> {
    await resumeEnvelopes()
    await reconcileCommandProposals()
    await processPendingLeaveIntents()
  },
}
