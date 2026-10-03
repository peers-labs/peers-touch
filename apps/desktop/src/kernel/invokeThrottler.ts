// InvokeThrottler — defers non-critical Tauri invocations out of click-frame.
//
// Contract: design.md §5 F-1 + execution-plan Phase 1b + D-14.
// Deferral via scheduler.afterFirstPaint for non-allowlist commands during interaction.

import { scheduler } from './scheduler';

// ── Auth bypass allowlist (D-14) ──────────────────────────────────────────

interface BypassEntry {
  command: string;
  securityClass: 'auth' | 'session' | 'crypto';
  bypassReason: string;
  owner: string;
}

const BYPASS_ALLOWLIST: BypassEntry[] = [
  { command: 'access_start', securityClass: 'auth', bypassReason: 'access gate must respond in click-frame', owner: 'kernel/auth' },
  { command: 'access_submit_invite_code', securityClass: 'auth', bypassReason: 'access gate step', owner: 'kernel/auth' },
  { command: 'access_submit_login', securityClass: 'auth', bypassReason: 'login submission', owner: 'kernel/auth' },
  { command: 'auth_logout', securityClass: 'session', bypassReason: 'logout must clear session immediately', owner: 'kernel/auth' },
  { command: 'auth_restore_session', securityClass: 'session', bypassReason: 'session restore on boot', owner: 'kernel/auth' },
  { command: 'auth_validate_token', securityClass: 'session', bypassReason: 'token validation', owner: 'kernel/auth' },
  { command: 'ensure_station_session', securityClass: 'session', bypassReason: 'station session guarantee', owner: 'kernel/auth' },
  { command: 'account_unlock', securityClass: 'auth', bypassReason: 'PIN unlock requires immediate feedback', owner: 'kernel/auth' },
  { command: 'account_set_pin', securityClass: 'auth', bypassReason: 'PIN setup', owner: 'kernel/auth' },
  { command: 'account_switch', securityClass: 'session', bypassReason: 'account switch must feel instant', owner: 'kernel/auth' },
];

const bypassSet = new Set(BYPASS_ALLOWLIST.map((e) => e.command));

function findBypassEntry(command: string): BypassEntry | undefined {
  return BYPASS_ALLOWLIST.find((e) => e.command === command);
}

// ── Interaction phase tracking ────────────────────────────────────────────

let interactionActive = false;
let interactionTimeout: ReturnType<typeof setTimeout> | null = null;

const INTERACTION_WINDOW_MS = 100;

export function markInteractionStart(): void {
  interactionActive = true;
  if (interactionTimeout !== null) {
    clearTimeout(interactionTimeout);
  }
  interactionTimeout = setTimeout(() => {
    interactionActive = false;
    interactionTimeout = null;
  }, INTERACTION_WINDOW_MS);
}

export function isInInteractionPhase(): boolean {
  return interactionActive;
}

// ── Throttle logic ────────────────────────────────────────────────────────

export interface ThrottleResult<T> {
  deferred: boolean;
  bypassReason?: string;
  securityClass?: string;
  promise: Promise<T>;
}

export function throttleInvoke<T>(
  command: string,
  executeFn: () => Promise<T>,
): ThrottleResult<T> {
  if (!interactionActive) {
    return { deferred: false, promise: executeFn() };
  }

  if (bypassSet.has(command)) {
    const entry = findBypassEntry(command)!;
    return {
      deferred: false,
      bypassReason: entry.bypassReason,
      securityClass: entry.securityClass,
      promise: executeFn(),
    };
  }

  const promise = new Promise<T>((resolve, reject) => {
    scheduler.afterFirstPaint(() => {
      executeFn().then(resolve, reject);
    });
  });
  return { deferred: true, promise };
}

// ── Test utilities ────────────────────────────────────────────────────────

export function _resetThrottler(): void {
  interactionActive = false;
  if (interactionTimeout !== null) {
    clearTimeout(interactionTimeout);
    interactionTimeout = null;
  }
}
