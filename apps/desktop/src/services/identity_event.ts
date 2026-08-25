/**
 * Cross-window identity bridge: forward the Rust-side `auth:identity-changed`
 * Tauri event to the in-process event bus and run the identity pipeline so
 * every window drops actor-scoped Zustand/cache state without a full reload.
 */

import { listen } from '@tauri-apps/api/event';
import { log } from '../utils/logger';
import { eventBus } from '../kernel/events/bus';
import { EVENT } from '../kernel/events/catalog';
import { isBrowserGatewayRuntime } from '../kernel/gateway';
import { api, type PresenceTrigger } from './desktop_api';
import { useSessionStore } from '../store/session';
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

/** In-process flag while this window initiates an identity mutation (see `markLocalIdentityAction`). */
export const LOCAL_IDENTITY_FLAG = 'pt.identity.local_pipeline';
let localIdentityActionPending = false;

const TAURI_EVENT_NAME = 'auth:identity-changed';

/** Rust serializes `IdentityChangeReason` with snake_case names. */
interface TauriIdentityPayload {
  reason?: string;
  actor_id?: string | null;
  actorId?: string | null;
  login_method?: string | null;
  loginMethod?: string | null;
  device_type?: string | null;
  deviceType?: string | null;
}

/**
 * Resolve the device type of the current client runtime.
 * Native Tauri windows are "desktop-native"; browser-gateway clients are "desktop-browser".
 */
function currentClientDeviceType(): string {
  return isBrowserGatewayRuntime() ? 'desktop-browser' : 'desktop-native';
}

/**
 * Returns true when the event originated from a different device type than
 * the current client. In multi-device mode, a login from a different device
 * type should NOT kick the current session.
 */
function isFromDifferentDeviceType(raw: TauriIdentityPayload | undefined): boolean {
  const incoming = raw?.device_type ?? raw?.deviceType ?? null;
  if (!incoming) return false; // absent → cannot determine, assume same (safe default)
  return incoming !== currentClientDeviceType();
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

function isLoginLike(reason: IdentityChangeReason): boolean {
  return reason === 'login' || reason === 'switch' || reason === 'oauth_bridge';
}

/** Mark this window as the originator of an identity-mutating command so the
 *  resulting `auth:identity-changed` broadcast does not run the pipeline twice. */
export function markLocalIdentityAction(): void {
  localIdentityActionPending = true;
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
    log.info('identity', 'received auth:identity-changed', { reason: raw?.reason });

    const payload = toPipelinePayload(raw);
    eventBus.publish(EVENT.AUTH_IDENTITY_CHANGED, undefined);

    let skipPipeline = false;
    if (localIdentityActionPending) {
      localIdentityActionPending = false;
      skipPipeline = true;
    }
    if (skipPipeline) {
      log.info('identity', 'skipping pipeline: local-originated change');
      return;
    }

    // A login in another window must not hydrate this renderer into the
    // same newly-issued Station session. If this window is already the
    // same actor, its older token has just been revoked by Station's
    // CreateWithKick policy, so route it through the normal kicked flow.
    //
    // EXCEPTION (MCA-D19 multi-device): When the login originated from a
    // different device type (e.g. browser login while native is running),
    // Station scopes sessions by device_type and does NOT revoke the other
    // device's session. In that case, ignore the event entirely.
    if (isLoginLike(payload.reason)) {
      const current = useSessionStore.getState().currentUser;
      if (current?.actorId && current.actorId === payload.actorId) {
        if (isFromDifferentDeviceType(raw)) {
          log.info('identity', 'ignoring same-actor login from different device type (multi-device)', {
            actorId: current.actorId,
            incomingDeviceType: raw?.device_type ?? raw?.deviceType,
            currentDeviceType: currentClientDeviceType(),
          });
          return;
        }
        log.warn('identity', 'same actor logged in elsewhere; ending this session', {
          actorId: current.actorId,
        });
        eventBus.publish(EVENT.AUTH_SESSION_REVOKED, { reason: 'kicked' });
        return;
      }
      if (current?.actorId) {
        log.info('identity', 'ignoring remote login for different actor', {
          currentActorId: current.actorId,
          incomingActorId: payload.actorId,
        });
        return;
      }
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
    log.warn('identity', 'failed to install auth:identity-changed listener', { error: String(error) });
  });
}

export type { IdentityChangePayload, IdentityChangeReason } from './identityPipeline';
