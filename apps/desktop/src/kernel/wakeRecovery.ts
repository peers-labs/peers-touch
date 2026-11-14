/**
 * Wake recovery — self-healing for the two long-idle failure modes:
 *
 *  1. WKWebView content process terminated during sleep and the reloaded page
 *     stalls before React paints (the silent paper boot fallback looks like a
 *     dead white window).
 *  2. The compositing/GPU process drops its layer tree without a reload: the
 *     JS runtime is alive but nothing is painted.
 *
 * On every native resume / return-to-visible the module:
 *  - acks the native resume watchdog immediately (so the native side only
 *    reloads when the JS event loop itself is dead),
 *  - nudges a compositing-layer rebuild, which recovers most blank-surface
 *    cases without a reload,
 *  - probes for a painted shell within a bounded deadline and, only if paint
 *    never lands, performs one guarded `location.reload()`.
 *
 * It also routes the native `desktop:locked` event into the identity runtime
 * so PIN-protected accounts park on the PIN gate while non-PIN accounts flow
 * straight back into the shell.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { api } from '../services/desktop_api';
import { identityRuntime } from './identityRuntime';
import { log } from '../utils/logger';

const DESKTOP_LOCKED_EVENT = 'desktop:locked';
const DESKTOP_RESUME_EVENT = 'desktop:resume';

/**
 * Overridable reload seam. Production delegates to the browser navigation;
 * tests replace it because jsdom's `Location.reload` is a non-configurable
 * native accessor that cannot be spied on.
 */
export const wakeRecoveryDeps = {
  reload: (): void => window.location.reload(),
};

/** One self-heal reload per renderer generation; a fresh OS-level WebView
 *  reload resets sessionStorage, so a persistent blank cannot loop forever. */
const RELOAD_GUARD_KEY = 'pt.wake.selfReloaded';
const REPAINT_NUDGE_CLASS = 'pt-wake-repaint';
const RESUME_PROBE_FIRST_DELAY_MS = 400;
const RESUME_PROBE_INTERVAL_MS = 400;
const RESUME_PROBE_DEADLINE_MS = 4_000;

export interface DesktopLockedPayload {
  kind?: string;
  accountId?: string | null;
  pinRequired?: boolean;
  reason?: string;
}

let installed = false;
/** True once the shell has painted at least once; cold boots own their own
 *  boot-fallback timeout and must not be reloaded by the resume watchdog. */
let shellEverPainted = false;
let watchdogInFlight = false;

/** The shell counts as painted only when React mounted AND removed the
 *  pre-React boot fallback. */
export function shellIsPainted(): boolean {
  const root = document.getElementById('root');
  if (!root || root.childElementCount === 0) return false;
  if (document.getElementById('pt-boot-fallback')) return false;
  return true;
}

/**
 * Force WKWebView to rebuild the backing layer for the document body. A
 * one-frame translateZ promotion invalidates the compositing tree without
 * changing layout; the class is removed on the next frame so no transform
 * persists.
 */
function nudgeRepaint(): void {
  document.body.classList.add(REPAINT_NUDGE_CLASS);
  // Force a synchronous style recalc so the new backing store is committed
  // before we release the class.
  void document.body.offsetHeight;
  requestAnimationFrame(() => {
    document.body.classList.remove(REPAINT_NUDGE_CLASS);
  });
}

function selfReloadOnce(reason: string): void {
  let alreadyReloaded = false;
  try {
    alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1';
  } catch {
    // sessionStorage unavailable (restricted shell) — treat as no guard and
    // allow the single reload rather than trapping the user on a blank page.
  }
  if (alreadyReloaded) {
    log.warn('wake', 'self-heal reload suppressed: guard already consumed', { reason });
    return;
  }
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
  } catch {
    // Best effort; the reload still proceeds.
  }
  log.warn('wake', 'shell never painted after resume; self-healing reload', { reason });
  wakeRecoveryDeps.reload();
}

function armResumeWatchdog(reason: string): void {
  if (watchdogInFlight) return;
  watchdogInFlight = true;

  // The native watchdog only needs to know the JS loop is alive; do this
  // before any await so a slow paint probe never causes a native reload.
  api.desktopWakeAck({ reason }).catch((error) => {
    log.warn('wake', 'native wake ack failed', { error: String(error) });
  });
  nudgeRepaint();

  void (async () => {
    await wait(RESUME_PROBE_FIRST_DELAY_MS);
    const deadline = Date.now() + RESUME_PROBE_DEADLINE_MS;
    while (Date.now() < deadline) {
      if (shellIsPainted()) {
        shellEverPainted = true;
        watchdogInFlight = false;
        return;
      }
      await wait(RESUME_PROBE_INTERVAL_MS);
    }
    watchdogInFlight = false;
    if (!shellIsPainted()) {
      selfReloadOnce(reason);
    }
  })();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleLocked(payload: DesktopLockedPayload): Promise<void> {
  await identityRuntime.lockForIdle({
    accountId: payload.accountId ?? null,
    pinRequired: Boolean(payload.pinRequired),
    reason: payload.reason ?? 'system-lock',
  });
}

/**
 * Install wake/lock listeners once. Safe to import from the module registry;
 * in node-based tests the Tauri event API is mocked per case.
 */
export function installWakeRecovery(): () => void {
  if (installed) return () => {};
  installed = true;

  const unlisteners: UnlistenFn[] = [];
  let disposed = false;

  listen<DesktopLockedPayload>(DESKTOP_LOCKED_EVENT, (event) => {
    if (disposed || !event.payload) return;
    void handleLocked(event.payload).catch((error) => {
      log.error('wake', 'idle lock handling failed', { error: String(error) });
    });
  }).then((unlisten) => {
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  }).catch((error) => {
    log.warn('wake', 'listen desktop:locked failed', { error: String(error) });
  });

  listen<unknown>(DESKTOP_RESUME_EVENT, () => {
    if (disposed) return;
    armResumeWatchdog('desktop-resume');
  }).then((unlisten) => {
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  }).catch((error) => {
    log.warn('wake', 'listen desktop:resume failed', { error: String(error) });
  });

  // A visibility return without a native resume (e.g. App Nap throttling)
  // still needs the repaint/probe treatment. Only arm after the shell has
  // painted once, so ordinary cold-boot visibility flips are ignored.
  const onVisibility = (): void => {
    if (disposed || document.visibilityState !== 'visible') return;
    if (!shellEverPainted && !shellIsPainted()) return;
    shellEverPainted = true;
    armResumeWatchdog('visibility-visible');
  };
  document.addEventListener('visibilitychange', onVisibility);

  // Mark first paint as soon as it lands so later visibility flips qualify.
  const paintObserver = new MutationObserver(() => {
    if (shellIsPainted()) shellEverPainted = true;
  });
  paintObserver.observe(document.body, { childList: true, subtree: true });

  return () => {
    disposed = true;
    installed = false;
    document.removeEventListener('visibilitychange', onVisibility);
    paintObserver.disconnect();
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  };
}
