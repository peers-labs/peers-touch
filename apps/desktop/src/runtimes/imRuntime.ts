import { fromBinary } from '@bufbuild/protobuf'
import { imServiceV1 } from '../services/im-service'
import { MlsDeliveryKind } from '../services/im-service-contract'
import { MlsKeyDeliveryPayloadSchema } from '../gen/proto/domain/chat/envelope_pb'
import { useSocialChatStore } from '../store/socialChat'
import { normalizeConversations } from '../store/socialNormalizers'
import type { RuntimeDescriptor } from '../kernel/runtime'
import { log } from '../utils/logger'
import { EVENT, eventBus } from '../kernel/events'
import { api } from '../services/desktop_api'

interface IMState {
  initialized: boolean
  deviceId: string | null
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
  conversations: new Map(),
  pendingResume: false,
  sseConnected: false,
}

const DEDUP_MAX_SIZE = 2000
const processedInboxItemIds = new Set<string>()
const processedOrder: string[] = []

function markProcessed(inboxItemId: string): boolean {
  if (processedInboxItemIds.has(inboxItemId)) return false
  processedInboxItemIds.add(inboxItemId)
  processedOrder.push(inboxItemId)
  while (processedOrder.length > DEDUP_MAX_SIZE) {
    const oldest = processedOrder.shift()!
    processedInboxItemIds.delete(oldest)
  }
  return true
}

let resumeIntervalId: ReturnType<typeof setInterval> | null = null
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

async function registerDevice(_actorId: string): Promise<void> {
  const deviceId = await getDeviceId()
  try {
    await imServiceV1.device.register(deviceId, navigator.userAgent)
    log.info('im-runtime', 'device registered', { deviceId })
  } catch (err) {
    log.warn('im-runtime', 'device register failed (may already exist)', { err })
  }
}

async function initMlsIdentity(actorId: string): Promise<void> {
  try {
    await imServiceV1.mlsGroup.initIdentity(actorId)
    log.info('im-runtime', 'MLS identity initialized')
  } catch (err) {
    log.warn('im-runtime', 'MLS identity init failed', { err })
  }
}

const KEY_PACKAGE_TARGET = 10

async function uploadKeyPackages(): Promise<void> {
  try {
    const count = await imServiceV1.keyPackage.countAvailable()
    if (count >= KEY_PACKAGE_TARGET) return
    const toGenerate = KEY_PACKAGE_TARGET - count
    const deviceId = await getDeviceId()
    for (let i = 0; i < toGenerate; i++) {
      const kpBytes = await imServiceV1.mlsGroup.generateKeyPackage()
      await imServiceV1.keyPackage.upload(deviceId, kpBytes)
    }
    log.info('im-runtime', 'key packages uploaded', { generated: toGenerate })
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

async function restoreMlsSessions(): Promise<void> {
  for (const [convId, conv] of state.conversations) {
    if (conv.kind !== 'group') continue
    try {
      await imServiceV1.mlsGroup.load(convId)
    } catch {
      // No persisted session yet — will be established on first Welcome
    }
  }
}

// ---------------------------------------------------------------------------
// Envelope payload processing (shared between SSE push and resume poll paths)
// ---------------------------------------------------------------------------

async function processEnvelopePayload(
  payloadType: number,
  payloadBytes: Uint8Array,
  conversationId: string,
  dirtyConversations: Set<string>,
): Promise<void> {
  switch (payloadType) {
    case 1: { // COMMITTED_EVENT
      if (conversationId) dirtyConversations.add(conversationId)
      break
    }
    case 2: { // MLS_KEY_DELIVERY
      if (payloadBytes.length === 0) break
      try {
        const delivery = fromBinary(MlsKeyDeliveryPayloadSchema, payloadBytes)
        const convId = delivery.conversationId
        if (!convId) break
        if (delivery.kind === MlsDeliveryKind.WELCOME) {
          await imServiceV1.mlsGroup.joinGroup(convId, delivery.opaqueMlsBytes)
          await imServiceV1.mlsGroup.save(convId)
          log.info('im-runtime', 'MLS group joined via Welcome', { convId })
        } else if (delivery.kind === MlsDeliveryKind.COMMIT) {
          await imServiceV1.mlsGroup.processCommit(convId, delivery.opaqueMlsBytes)
          await imServiceV1.mlsGroup.save(convId)
          log.info('im-runtime', 'MLS commit processed', { convId })
        }
      } catch (err) {
        log.warn('im-runtime', 'MLS_KEY_DELIVERY processing failed', { err })
      }
      break
    }
    case 3: // DIRECT_KEY_EXCHANGE
      break
    case 4: // RECEIPT
      break
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
  if (!markProcessed(data.inboxItemId)) return

  const dirtyConversations = new Set<string>()
  const payloadBytes = data.payloadBytes instanceof Uint8Array
    ? data.payloadBytes
    : new Uint8Array(data.payloadBytes ?? [])

  await processEnvelopePayload(
    data.payloadType,
    payloadBytes,
    data.conversationId,
    dirtyConversations,
  )

  const deviceId = await getDeviceId()
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
      if (!markProcessed(item.inboxItemId)) {
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
          dirtyConversations,
        )
      }
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
      await store.loadMessages(convId, 'group')
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

function handleConnectionStateChange(payload: { connected: boolean }): void {
  state.sseConnected = payload.connected
  if (payload.connected) {
    stopResumePolling()
    triggerImmediateResume()
  } else {
    startResumePolling()
  }
}

// ---------------------------------------------------------------------------
// Runtime descriptor
// ---------------------------------------------------------------------------

export const imRuntime: RuntimeDescriptor = {
  id: 'im',
  scope: 'session',

  install(): void {
    startResumePolling()
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
    for (const unsub of eventUnsubscribers) unsub()
    eventUnsubscribers = []
    state.initialized = false
    state.deviceId = null
    state.sseConnected = false
    state.conversations.clear()
    processedInboxItemIds.clear()
    processedOrder.length = 0
  },

  async bootstrap(actorId: string | null): Promise<void> {
    if (!actorId) return
    if (state.initialized) return

    await registerDevice(actorId)
    await initMlsIdentity(actorId)
    await uploadKeyPackages()
    await loadConversations()
    await restoreMlsSessions()
    await resumeEnvelopes()

    state.initialized = true
    log.info('im-runtime', 'bootstrap complete', { actorId })
  },

  async reconcile(_reason: string): Promise<void> {
    await resumeEnvelopes()
  },
}
