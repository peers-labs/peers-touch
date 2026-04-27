/**
 * Cross-window identity bridge: forward the Rust-side `auth.identity_changed`
 * Tauri event to the in-process event bus and run the identity pipeline so
 * every window drops actor-scoped Zustand/cache state without a full reload.
 */

import { listen } from '@tauri-apps/api/event';
import { log } from '../utils/logger';
import { eventBus } from '../kernel/events/bus';
import { EVENT } from '../kernel/events/catalog';
import { api, type PresenceTrigger } from './desktop_api';
import {
  runIdentityPipeline,
  type IdentityChangePayload,
  type IdentityChangeReason,
} from './identityPipeline';

/**
 * Map an identity-change reason to the corresponding presence trigger.
 * Identity-driven triggers bypass the supervisor's cooldown so they
 * always reconcile (or tear down) immediately.
 */
function presenceTriggerFor(reason: IdentityChangeReason): PresenceTrigger {
  switch (reason) {
    case 'login':
    case 'switch':
    case 'oauth_bridge':
      return 'identity_switched';
    case 'unlock':
      return 'identity_restored';
    case 'logout':
      return 'identity_logged_out';
    default:
      return 'identity_switched';
  }
}

/** sessionStorage key: set to `"1"` while this window initiates an identity mutation (see `markLocalIdentityAction`). */
export const LOCAL_IDENTITY_FLAG = 'pt.identity.local_pipeline';

const TAURI_EVENT_NAME = 'auth.identity_changed';

/** Rust serializes `IdentityChangeReason` with snake_case names. */
interface TauriIdentityPayload {
  reason?: string;
  actor_id?: string | null;
  actorId?: string | null;
  login_method?: string | null;
  loginMethod?: string | null;
}

function normalizeReason(raw: string | undefined): IdentityChangeReason {
  const map: Record<string, IdentityChangeReason> = {
    login: 'login',
    logout: 'logout',
    switch: 'switch',
    unlock: 'unlock',
    oauth_bridge: 'oauth_bridge',
  };
  if (raw && map[raw]) return map[raw];
  log.warn('identity', 'unknown identity change reason from Tauri', { raw });
  return 'switch';
}

function toPipelinePayload(raw: TauriIdentityPayload | undefined): IdentityChangePayload {
  return {
    reason: normalizeReason(raw?.reason),
    actorId: raw?.actor_id ?? raw?.actorId ?? null,
    loginMethod: raw?.login_method ?? raw?.loginMethod ?? null,
  };
}

/** Mark this window as the originator of an identity-mutating command so the
 *  resulting `auth.identity_changed` broadcast does not run the pipeline twice. */
export function markLocalIdentityAction(): void {
  try {
    sessionStorage.setItem(LOCAL_IDENTITY_FLAG, '1');
  } catch {
    // sessionStorage unavailable — worst case is a redundant pipeline run (idempotent).
  }
}

let installed = false;

const DEBUG_FORCE_RELOAD =
  typeof import.meta !== 'undefined' &&
  Boolean((import.meta as any).env?.DEV) &&
  typeof window !== 'undefined' &&
  window.location.search.includes('identity_debug_reload=1');

export function installIdentityChangedBridge(): void {
  if (installed) return;
  installed = true;
  listen<TauriIdentityPayload>(TAURI_EVENT_NAME, (event) => {
    const raw = event.payload;
    log.info('identity', 'received auth.identity_changed', { reason: raw?.reason });

    const payload = toPipelinePayload(raw);
    eventBus.publish(EVENT.AUTH_IDENTITY_CHANGED, undefined);

    let skipPipeline = false;
    try {
      if (sessionStorage.getItem(LOCAL_IDENTITY_FLAG) === '1') {
        sessionStorage.removeItem(LOCAL_IDENTITY_FLAG);
        skipPipeline = true;
      }
    } catch {
      // ignore; continue with pipeline
    }
    if (skipPipeline) {
      log.info('identity', 'skipping pipeline: local-originated change');
      return;
    }

    if (DEBUG_FORCE_RELOAD) {
      log.warn('identity', 'DEBUG identity_debug_reload: forcing full reload instead of pipeline');
      setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          /* noop in test env */
        }
      }, 50);
      return;
    }

    void (async () => {
      await runIdentityPipeline(payload);
      // After the pipeline drops actor-scoped state, ask the presence
      // supervisor to reconcile (`/online` + `/pending` + `/ack`) for
      // the new actor — or tear down if logging out. This is the
      // architectural bridge from "identity changed" to "deliver
      // queued messages".
      try {
        await api.presenceNotify(presenceTriggerFor(payload.reason));
      } catch (error) {
        log.debug('identity', 'presenceNotify after pipeline failed', { error: String(error) });
      }
    })();
  }).catch((error) => {
    log.warn('identity', 'failed to install auth.identity_changed listener', { error: String(error) });
  });
}

export type { IdentityChangePayload, IdentityChangeReason } from './identityPipeline';
