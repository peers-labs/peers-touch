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
import { recordBootPhase } from './frontendRuntimeProfiler';
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
  recordBootPhase(phase, 'start');
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
  const ms = entry.finishedAt - entry.startedAt;
  log.info('boot', `${phase}:end`, { ms: Math.round(ms), ...extra });
  recordBootPhase(phase, 'end', ms, extra);
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

const BOOTSTRAP_TIMEOUT_MS = 5000;

async function bootstrapWithTimeout(runtimeId: string, actorPtid: string | null): Promise<void> {
  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), BOOTSTRAP_TIMEOUT_MS),
  );
  const bootstrap = bootstrapRuntime(runtimeId, actorPtid).then(() => 'done' as const);

  const result = await Promise.race([bootstrap, timeout]);
  if (result === 'timeout') {
    log.warn('boot', `bootstrap.timeout: ${runtimeId} exceeded ${BOOTSTRAP_TIMEOUT_MS}ms — entering degraded mode`, {
      runtimeId,
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
    });
  }
}

/**
 * Install all `app`-scope runtimes immediately and the `session`-scope
 * runtimes whose ids appear in `criticalSessionRuntimes`. The pipeline
 * intentionally keeps "critical" small (only what the landing page or
 * the global notification surface needs) so first paint stays cheap.
 */
export async function installCriticalRuntimes(
  actorPtid: string | null,
  criticalSessionRuntimes: ReadonlyArray<string>,
): Promise<void> {
  markPhaseStart('runtime:critical');
  for (const desc of listRuntimes('app')) {
    installRuntime(desc.id);
    await bootstrapWithTimeout(desc.id, null);
  }
  if (actorPtid) {
    for (const id of criticalSessionRuntimes) {
      installRuntime(id);
      await bootstrapWithTimeout(id, actorPtid);
    }
  }
  markPhaseEnd('runtime:critical', { actorPtid, critical: criticalSessionRuntimes });
}

/**
 * Install the remaining `session`-scope runtimes and bootstrap them for
 * the active actor. Runs during the `runtime:idle` window so first paint
 * is unaffected.
 */
export async function installIdleRuntimes(
  actorPtid: string | null,
  criticalSessionRuntimes: ReadonlyArray<string>,
): Promise<void> {
  if (!actorPtid) return;
  markPhaseStart('runtime:idle');
  const installed: string[] = [];
  for (const desc of listRuntimes('session')) {
    if (criticalSessionRuntimes.includes(desc.id)) continue;
    installRuntime(desc.id);
    await bootstrapWithTimeout(desc.id, actorPtid);
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

// Legacy bridge: existing consumers import scheduleIdle from boot.ts.
// Phase 1a migration: new code should import { scheduler } from './scheduler'.
// This re-export uses the scheduler's idleChunk lane internally.

import { scheduler } from './scheduler';

export function scheduleIdle(callback: () => void, timeout = 1500): () => void {
  return scheduler.idleChunk('legacy:scheduleIdle', callback, timeout);
}
