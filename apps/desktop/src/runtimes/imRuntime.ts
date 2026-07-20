import { fromBinary } from '@bufbuild/protobuf'
import { imServiceV1 } from '../services/im-service'
import { MlsDeliveryKind } from '../services/im-service-contract'
import { MlsKeyDeliveryPayloadSchema } from '../gen/proto/domain/chat/envelope_pb'
import { useSocialChatStore } from '../store/socialChat'
import type { RuntimeDescriptor } from '../kernel/runtime'
import { log } from '../utils/logger'
import { EVENT, eventBus } from '../kernel/events'

interface IMState {
  initialized: boolean
  deviceId: string | null
  conversations: Map<string, ConversationProjection>
  pendingResume: boolean
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
}

let resumeIntervalId: ReturnType<typeof setInterval> | null = null
let eventUnsubscribers: (() => void)[] = []

function triggerImmediateResume(): void {
  if (!state.initialized) return
  resumeEnvelopes()
}

function getDeviceId(): string {
  if (state.deviceId) return state.deviceId
  let id = localStorage.getItem('peers_im_device_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('peers_im_device_id', id)
  }
  state.deviceId = id
  return id
}

async function registerDevice(_actorId: string): Promise<void> {
  const deviceId = getDeviceId()
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
    const deviceId = getDeviceId()
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
    const convs = await imServiceV1.conversation.listConversations()
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

async function resumeEnvelopes(): Promise<void> {
  if (state.pendingResume) return
  state.pendingResume = true
  try {
    const deviceId = getDeviceId()
    const items = await imServiceV1.envelope.resume(deviceId)
    if (items.length === 0) return

    log.info('im-runtime', 'envelope resume', { count: items.length })
    const dirtyConversations = new Set<string>()

    for (const item of items) {
      await processInboxItem(item, dirtyConversations)
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

async function processInboxItem(item: any, dirtyConversations: Set<string>): Promise<void> {
  const env = item.envelope
  if (!env) return

  switch (env.payloadType) {
    case 1: { // COMMITTED_EVENT — mark conversation for refresh
      const conversationId: string = env.conversationId ?? ''
      if (conversationId) dirtyConversations.add(conversationId)
      break
    }

    case 2: { // MLS_KEY_DELIVERY — process Welcome/Commit immediately
      const payloadBytes = env.payloadBytes instanceof Uint8Array
        ? env.payloadBytes
        : new Uint8Array(env.payloadBytes ?? [])
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
        log.warn('im-runtime', 'processInboxItem MLS_KEY_DELIVERY failed', { err })
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

async function refreshDirtyConversations(conversationIds: Set<string>): Promise<void> {
  const store = useSocialChatStore.getState()
  for (const convId of conversationIds) {
    try {
      await store.loadMessages(convId, 'group')
    } catch (err) {
      log.warn('im-runtime', 'refresh dirty conversation failed', { convId, err })
    }
  }
  await store.loadGroupUnreadCounts?.()
  await store.loadConversationPreviews?.()
}

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

export const imRuntime: RuntimeDescriptor = {
  id: 'im',
  scope: 'session',

  install(): void {
    startResumePolling()
    eventUnsubscribers = [
      eventBus.subscribe(EVENT.REALTIME_RESYNC, triggerImmediateResume),
      eventBus.subscribe(EVENT.REALTIME_GROUP_MEMBERSHIP_CHANGE, triggerImmediateResume),
      eventBus.subscribe(EVENT.REALTIME_GROUP_FEDERATION_EVENT, triggerImmediateResume),
    ]
  },

  teardown(): void {
    stopResumePolling()
    for (const unsub of eventUnsubscribers) unsub()
    eventUnsubscribers = []
    state.initialized = false
    state.deviceId = null
    state.conversations.clear()
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
