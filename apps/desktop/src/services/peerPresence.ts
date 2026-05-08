/**
 * Peer-presence bridge — relays Station's `/friend-chat/presence/stream`
 * SSE updates (proxied through the Rust supervisor as the
 * `presence:peer-changed` Tauri event) into the social chat store's
 * `peerOnline` map.
 *
 * # Why this is a separate bridge from `services/presence.ts`
 *
 * `presence.ts` handles the *self*-presence state machine: when *I*
 * come back online, what do I need to do (drain pending, refresh
 * sessions, …). This file handles *peer*-presence: when one of my
 * friends flips online/offline, mark it in the store so headers and
 * badges update live.
 *
 * Mixing them would conflate the two state machines, both of which use
 * Tauri events that happen to start with "presence.". Keeping them
 * apart means each module has a single payload shape and a single
 * subscriber set.
 *
 * # Lifetime
 *
 * The Rust supervisor runs per-actor and is started/stopped via
 * `api.friendChatPresenceStart` / `friendChatPresenceStop`. The
 * frontend listener is installed once and survives across actor
 * switches; the actor identity is implicit in the SSE connection on
 * the Rust side. Tests can call `teardownPeerPresenceBridge` to clean
 * up between cases.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSocialChatStore } from '../store/socialChat';
import { log } from '../utils/logger';

const PEER_PRESENCE_EVENT = 'presence:peer-changed';

interface PeerPresencePayload {
  did: string;
  online: boolean;
  at?: number;
}

let unlisten: UnlistenFn | null = null;

export async function installPeerPresenceBridge(): Promise<void> {
  if (unlisten) return;
  try {
    unlisten = await listen<PeerPresencePayload>(PEER_PRESENCE_EVENT, (event) => {
      const payload = event.payload;
      if (!payload || typeof payload.did !== 'string' || !payload.did) return;
      log.debug('peerPresence', 'flip', payload);
      try {
        useSocialChatStore.getState().setPeerOnline(payload.did, Boolean(payload.online));
      } catch (error) {
        log.warn('peerPresence', 'setPeerOnline failed', error);
      }
    });
    log.info('peerPresence', 'bridge installed');
  } catch (error) {
    log.warn('peerPresence', 'failed to install bridge', error);
  }
}

export function teardownPeerPresenceBridge(): void {
  if (unlisten) {
    try { unlisten(); } catch { /* noop */ }
    unlisten = null;
  }
}
