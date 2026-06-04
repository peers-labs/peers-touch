import type { MobileAuthSession } from '../auth/authSession';
import type { GroupE2eeRuntimeController } from '../group/groupE2eeRuntime';
import type { GroupState } from '../group/groupStore';
import { isSenderKeyDistributionMessage } from './socialProjection';
import type { SocialState } from './socialStore';
import { startRealtimeStream } from './socialRealtime';
import type { FriendChatMessage } from './socialTypes';
import type { GroupMembershipKind } from './socialWire';

const RECONCILE_INTERVAL_MS = 30000;
const TYPING_TTL_MS = 6000;
const TYPING_SWEEP_INTERVAL_MS = 2000;
const EXTERNAL_RECONCILE_DEBOUNCE_MS = 1000;
const REALTIME_RECONNECT_BASE_MS = 1000;
const REALTIME_RECONNECT_MAX_MS = 15000;

interface PresenceFrame {
  actor_id?: string;
  actorId?: string;
  did?: string;
  online?: boolean;
}

export interface SocialRuntimeController {
  teardown: () => void;
}

export type SocialRuntimeExternalEventKind =
  | 'app-resume'
  | 'network-online'
  | 'push'
  | 'deep-link'
  | 'notification-tap'
  | 'native-hint';

export interface SocialRuntimeExternalEvent {
  kind: SocialRuntimeExternalEventKind;
  target?: string;
  sessionUlid?: string;
  notificationId?: string;
  url?: string;
  reason?: string;
}

interface ActiveSocialRuntime {
  sessionKey: string | null;
  dispatchExternalEvent: (event: SocialRuntimeExternalEvent) => void;
}

let activeRuntime: ActiveSocialRuntime | null = null;

export function dispatchSocialRuntimeExternalEvent(event: SocialRuntimeExternalEvent) {
  activeRuntime?.dispatchExternalEvent(event);
}

export function startSocialRuntime(
  session: MobileAuthSession,
  store: SocialState,
  groupStore?: GroupState,
  groupE2eeRuntime?: GroupE2eeRuntimeController,
): SocialRuntimeController {
  let cancelled = false;
  let externalReconcileTimer: number | null = null;
  const abortController = new AbortController();

  store.reconcile();
  const reconcileTimer = window.setInterval(() => {
    if (!cancelled) store.reconcile();
  }, RECONCILE_INTERVAL_MS);
  const typingSweepTimer = window.setInterval(() => {
    store.sweepTypingPeers(Date.now() - TYPING_TTL_MS);
  }, TYPING_SWEEP_INTERVAL_MS);

  startPresenceStream(session, abortController.signal, (frame) => {
    const did = frame.actor_id || frame.actorId || frame.did;
    if (!did || typeof frame.online !== 'boolean') return;
    store.setPeerOnline(String(did), frame.online);
  });
  const realtimeHandlers: Parameters<typeof startRealtimeStream>[2] = {
    onMessage: (sessionUlid, message) => {
      if (isSenderKeyDistributionMessage(message)) {
        void routeSkdmControlMessage(store, groupE2eeRuntime, message);
        return;
      }
      void store.ingestRealtimeMessage(sessionUlid, message);
    },
    onGroupMessage: (groupUlid, message) => {
      if (!groupStore) return;
      void groupStore.ingestRealtimeMessage(groupUlid, message).then(() => groupE2eeRuntime?.repairEncryptedMessages());
    },
    onReceipt: store.applyMessageReceipt,
    onMutation: (sessionUlid, messageUlid, kind, payload) => {
      store.applyMessageMutation(sessionUlid, messageUlid, kind, payload);
      groupStore?.applyMessageMutation(sessionUlid, messageUlid, kind, payload);
    },
    onTyping: store.applyTypingState,
    onPresence: store.setPeerOnline,
    onGroupMembership: (groupUlid, actorDid, kind) => {
      void routeGroupMembershipChange(groupStore, groupE2eeRuntime, groupUlid, actorDid, kind);
    },
    onSettingsChanged: (conversationKind, containerUlid) => {
      if (conversationKind === 'friend') {
        void store.loadConversationSettings(containerUlid);
      } else {
        void groupStore?.loadSettings(containerUlid);
      }
    },
    onResync: () => {
      void store.reconcile();
      void groupStore?.reconcile();
    },
  };
  void superviseRealtimeStream(session, abortController.signal, store, groupStore, groupE2eeRuntime, realtimeHandlers);

  const runtimeRef: ActiveSocialRuntime = {
    sessionKey: store.sessionKey,
    dispatchExternalEvent: (event) => {
      if (cancelled) return;

      if (event.sessionUlid) void store.loadMessages(event.sessionUlid);
      if (event.notificationId || event.target === 'notification') void store.refreshNotifications();
      void reconcileActiveThreads(store, groupStore, groupE2eeRuntime);

      if (externalReconcileTimer) return;
      externalReconcileTimer = window.setTimeout(() => {
        externalReconcileTimer = null;
        if (!cancelled) void store.reconcile();
      }, EXTERNAL_RECONCILE_DEBOUNCE_MS);
    },
  };
  activeRuntime = runtimeRef;

  return {
    teardown: () => {
      cancelled = true;
      window.clearInterval(reconcileTimer);
      window.clearInterval(typingSweepTimer);
      if (externalReconcileTimer) window.clearTimeout(externalReconcileTimer);
      abortController.abort();
      if (activeRuntime === runtimeRef) activeRuntime = null;
    },
  };
}

async function superviseRealtimeStream(
  session: MobileAuthSession,
  signal: AbortSignal,
  store: SocialState,
  groupStore: GroupState | undefined,
  groupE2eeRuntime: GroupE2eeRuntimeController | undefined,
  handlers: Parameters<typeof startRealtimeStream>[2],
) {
  let reconnectDelay = REALTIME_RECONNECT_BASE_MS;
  while (!signal.aborted) {
    try {
      await startRealtimeStream(session, signal, handlers);
      reconnectDelay = REALTIME_RECONNECT_BASE_MS;
	} catch {
	  if (signal.aborted) return;
	}

    if (signal.aborted) return;
    await reconcileActiveThreads(store, groupStore, groupE2eeRuntime);
    await delay(reconnectDelay, signal);
    reconnectDelay = Math.min(reconnectDelay * 2, REALTIME_RECONNECT_MAX_MS);
  }
}

async function reconcileActiveThreads(
  store: SocialState,
  groupStore: GroupState | undefined,
  groupE2eeRuntime: GroupE2eeRuntimeController | undefined,
) {
  await Promise.allSettled([
    store.reconcileActiveSessionMessages(),
    groupStore?.reconcileActiveGroupMessages().then(() => groupE2eeRuntime?.repairEncryptedMessages()),
  ]);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function routeSkdmControlMessage(
  store: SocialState,
  groupE2eeRuntime: GroupE2eeRuntimeController | undefined,
  message: FriendChatMessage,
) {
  if (!groupE2eeRuntime || message.senderDid === store.currentUserDid) return;
  const skdmBytes = skdmPayloadBytes(message);
  await groupE2eeRuntime.consumeSkdmControlMessage(message.senderDid, skdmBytes);
}

async function routeGroupMembershipChange(
  groupStore: GroupState | undefined,
  groupE2eeRuntime: GroupE2eeRuntimeController | undefined,
  groupUlid: string,
  actorDid: string,
  kind: GroupMembershipKind,
) {
  try {
    await groupStore?.refreshGroups();
    if (groupStore?.activeGroupUlid === groupUlid) await groupStore.loadMembers(groupUlid);
    if (kind === 'REMOVED' || kind === 'LEFT') {
      await groupE2eeRuntime?.rotateAfterMembershipChange(groupUlid, actorDid);
    }
  } catch {
    // Group store and E2EE runtime persist their own domain errors.
  }
}

function skdmPayloadBytes(message: FriendChatMessage): Uint8Array {
  if (message.encryptedPayload?.byteLength) return message.encryptedPayload;
  if (message.content.trim()) return base64ToBytes(message.content.trim());
  return new Uint8Array();
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return new Uint8Array();
  }
}

async function startPresenceStream(
  session: MobileAuthSession,
  signal: AbortSignal,
  onFrame: (frame: PresenceFrame) => void,
) {
  try {
    const response = await fetch(`${session.stationUrl.replace(/\/+$/, '')}/friend-chat/presence/stream`, {
      cache: 'no-store',
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${session.accessToken}`,
      },
      signal,
    });
    if (!response.ok || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      chunks.forEach((chunk) => parseSseChunk(chunk).forEach(onFrame));
    }
  } catch {
    // Reconcile polling remains the fallback when the mobile WebView closes the stream.
  }
}

function parseSseChunk(chunk: string): PresenceFrame[] {
  return chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as PresenceFrame;
      } catch {
        return null;
      }
    })
    .filter((frame): frame is PresenceFrame => Boolean(frame));
}
