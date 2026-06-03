import type { MobileAuthSession } from '../auth/authSession';
import type { GroupState } from '../group/groupStore';
import type { SocialState } from './socialStore';
import { startRealtimeStream } from './socialRealtime';

const RECONCILE_INTERVAL_MS = 30000;
const TYPING_TTL_MS = 6000;
const TYPING_SWEEP_INTERVAL_MS = 2000;
const EXTERNAL_RECONCILE_DEBOUNCE_MS = 1000;

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
  startRealtimeStream(session, abortController.signal, {
    onMessage: (sessionUlid, message) => {
      store.ingestRealtimeMessage(sessionUlid, message);
    },
    onGroupMessage: (groupUlid, message) => {
      groupStore?.ingestRealtimeMessage(groupUlid, message);
    },
    onReceipt: store.applyMessageReceipt,
    onMutation: (sessionUlid, messageUlid, kind, payload) => {
      store.applyMessageMutation(sessionUlid, messageUlid, kind, payload);
      groupStore?.applyMessageMutation(sessionUlid, messageUlid, kind, payload);
    },
    onTyping: store.applyTypingState,
    onPresence: store.setPeerOnline,
    onGroupMembership: (groupUlid) => {
      void groupStore?.refreshGroups();
      if (groupStore?.activeGroupUlid === groupUlid) void groupStore.loadMembers(groupUlid);
    },
    onResync: () => {
      void store.reconcile();
      void groupStore?.reconcile();
    },
  });

  const runtimeRef: ActiveSocialRuntime = {
    sessionKey: store.sessionKey,
    dispatchExternalEvent: (event) => {
      if (cancelled) return;

      if (event.sessionUlid) void store.loadMessages(event.sessionUlid);
      if (event.notificationId || event.target === 'notification') void store.refreshNotifications();

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
