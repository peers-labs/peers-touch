import type { MobileAuthSession } from '../auth/authSession';
import type { SocialState } from './socialStore';
import { startRealtimeStream } from './socialRealtime';

const RECONCILE_INTERVAL_MS = 30000;
const TYPING_TTL_MS = 6000;
const TYPING_SWEEP_INTERVAL_MS = 2000;

interface PresenceFrame {
  actor_id?: string;
  actorId?: string;
  did?: string;
  online?: boolean;
}

export interface SocialRuntimeController {
  teardown: () => void;
}

export function startSocialRuntime(session: MobileAuthSession, store: SocialState): SocialRuntimeController {
  let cancelled = false;
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
    onReceipt: store.applyMessageReceipt,
    onMutation: store.applyMessageMutation,
    onTyping: store.applyTypingState,
    onPresence: store.setPeerOnline,
    onResync: store.reconcile,
  });

  return {
    teardown: () => {
      cancelled = true;
      window.clearInterval(reconcileTimer);
      window.clearInterval(typingSweepTimer);
      abortController.abort();
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
