// Desktop boot pipeline.
//
// Makes the implicit phases inside `main.tsx → App.tsx → ReadyView`
// explicit and observable. Each phase emits a typed log via the
// unified logger so we can measure cold-start cost and reason about
// regressions.
//
// Phases:
//   shell             createRoot rendered minimal skeleton  (main.tsx)
//   identity          account picker / OAuth / restore       (useAppLifecycle)
//   runtime:critical  install + bootstrap critical runtimes  (this module)
//   firstPaint        ReadyView mounted the landing page     (this module)
//   runtime:idle      install non-critical runtimes          (this module)
//   pages:prewarm     mount `preload:'idle'` pages off-frame (this module)
//   steady            runtimes own their own reconciliation  (each runtime)

import { log } from '../utils/logger';
import {
  bootstrapRuntime,
  installRuntime,
  listRuntimes,
  resetSessionRuntimeBootstraps,
  teardownRuntime,
} from './runtime';

export type BootPhase =
  | 'shell'
  | 'identity'
  | 'runtime:critical'
  | 'firstPaint'
  | 'runtime:idle'
  | 'pages:prewarm'
  | 'steady';

interface PhaseEntry {
  phase: BootPhase;
  startedAt: number;
  finishedAt?: number;
}

const phases: PhaseEntry[] = [];
const listeners = new Set<(entry: PhaseEntry) => void>();

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function markPhaseStart(phase: BootPhase): void {
  const entry: PhaseEntry = { phase, startedAt: nowMs() };
  phases.push(entry);
  log.info('boot', `${phase}:start`);
  for (const l of listeners) {
    try {
      l(entry);
    } catch {
      // Listener errors must not interrupt boot.
    }
  }
}

export function markPhaseEnd(phase: BootPhase, extra?: Record<string, unknown>): void {
  const entry = [...phases].reverse().find((p) => p.phase === phase && p.finishedAt === undefined);
  if (!entry) return;
  entry.finishedAt = nowMs();
  log.info('boot', `${phase}:end`, { ms: Math.round(entry.finishedAt - entry.startedAt), ...extra });
  for (const l of listeners) {
    try {
      l(entry);
    } catch {
      // Listener errors must not interrupt boot.
    }
  }
}

export function subscribeBoot(listener: (entry: PhaseEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBootTrace(): ReadonlyArray<PhaseEntry> {
  return phases;
}

// ── Critical runtime install ──────────────────────────────────────────────

/**
 * Install all `app`-scope runtimes immediately and the `session`-scope
 * runtimes whose ids appear in `criticalSessionRuntimes`. The pipeline
 * intentionally keeps "critical" small (only what the landing page or
 * the global notification surface needs) so first paint stays cheap.
 */
export async function installCriticalRuntimes(
  actorId: string | null,
  criticalSessionRuntimes: ReadonlyArray<string>,
): Promise<void> {
  markPhaseStart('runtime:critical');
  for (const desc of listRuntimes('app')) {
    installRuntime(desc.id);
    await bootstrapRuntime(desc.id, null);
  }
  if (actorId) {
    for (const id of criticalSessionRuntimes) {
      installRuntime(id);
      await bootstrapRuntime(id, actorId);
    }
  }
  markPhaseEnd('runtime:critical', { actorId, critical: criticalSessionRuntimes });
}

/**
 * Install the remaining `session`-scope runtimes and bootstrap them for
 * the active actor. Runs during the `runtime:idle` window so first paint
 * is unaffected.
 */
export async function installIdleRuntimes(
  actorId: string | null,
  criticalSessionRuntimes: ReadonlyArray<string>,
): Promise<void> {
  if (!actorId) return;
  markPhaseStart('runtime:idle');
  const installed: string[] = [];
  for (const desc of listRuntimes('session')) {
    if (criticalSessionRuntimes.includes(desc.id)) continue;
    installRuntime(desc.id);
    await bootstrapRuntime(desc.id, actorId);
    installed.push(desc.id);
  }
  markPhaseEnd('runtime:idle', { installed });
}

export function tearDownSessionRuntimes(): void {
  for (const desc of listRuntimes('session')) {
    teardownRuntime(desc.id);
  }
  resetSessionRuntimeBootstraps();
}

// ── Idle scheduling ──────────────────────────────────────────────────────

type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining(): number }) => void;
type RequestIdleCallback = (cb: IdleCallback, opts?: { timeout?: number }) => number;
type CancelIdleCallback = (handle: number) => void;

interface IdleCapableWindow {
  requestIdleCallback?: RequestIdleCallback;
  cancelIdleCallback?: CancelIdleCallback;
}

export function scheduleIdle(callback: () => void, timeout = 1500): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  const w = window as unknown as IdleCapableWindow;
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(() => callback(), { timeout });
    return () => {
      if (typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(handle);
    };
  }
  const handle = window.setTimeout(callback, 200);
  return () => window.clearTimeout(handle);
}
