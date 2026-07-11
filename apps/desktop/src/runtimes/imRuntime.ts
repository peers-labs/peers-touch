import { imServiceV1 } from '../services/im-service'
import type { RuntimeDescriptor } from '../kernel/runtime'
import { log } from '../utils/logger'

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

async function resumeEnvelopes(): Promise<void> {
  if (state.pendingResume) return
  state.pendingResume = true
  try {
    const deviceId = getDeviceId()
    const items = await imServiceV1.envelope.resume(deviceId)
    if (items.length > 0) {
      log.info('im-runtime', 'envelope resume', { count: items.length })
      for (const item of items) {
        await processInboxItem(item)
        await imServiceV1.envelope.ack(deviceId, item.inboxItemId)
      }
    }
  } catch (err) {
    log.warn('im-runtime', 'envelope resume failed', { err })
  } finally {
    state.pendingResume = false
  }
}

async function processInboxItem(item: any): Promise<void> {
  const env = item.envelope
  if (!env) return

  switch (env.payloadType) {
    case 1: // COMMITTED_EVENT
      break
    case 2: // MLS_KEY_DELIVERY
      break
    case 3: // DIRECT_KEY_EXCHANGE
      break
    case 4: // RECEIPT
      break
    default:
      break
  }
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
  },

  teardown(): void {
    stopResumePolling()
    state.initialized = false
    state.deviceId = null
    state.conversations.clear()
  },

  async bootstrap(actorId: string | null): Promise<void> {
    if (!actorId) return
    if (state.initialized) return

    await registerDevice(actorId)
    await initMlsIdentity(actorId)
    await loadConversations()
    await resumeEnvelopes()

    state.initialized = true
    log.info('im-runtime', 'bootstrap complete', { actorId })
  },

  async reconcile(_reason: string): Promise<void> {
    await resumeEnvelopes()
  },
}
