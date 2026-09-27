// Desktop runtime contract.
//
// A "runtime" is a long-lived owner of one domain's projection state. It
// installs event/store subscriptions once, bootstraps its store on the
// authenticated-actor edge, and reconciles itself periodically. Pages are
// pure renderers over the data the runtime keeps fresh — they never
// trigger first-load via mount-time `useEffect` (see
// docs/client/desktop/runtime-projections.md).
//
// This file defines the contract + a process-wide registry. It does NOT
// own any policy itself; the BootPipeline (kernel/boot.ts) decides when to
// install / bootstrap each runtime.

import { log } from '../utils/logger';
import {
  recordRuntimeBootstrap,
  recordRuntimeInstall,
  recordRuntimePageLease,
} from './frontendRuntimeProfiler';

export type RuntimeScope = 'app' | 'session';
export type RuntimePageAcquireReason = 'activate' | 'prewarm';
export type RuntimePageReleaseReason = 'explicit-close' | 'evict' | 'unmount';

export interface RuntimeDescriptor {
  /** Stable identifier (e.g. "social", "search", "settings"). */
  readonly id: string;
  /**
   * `app`-scoped runtimes install once at boot and live for the process
   * lifetime. `session`-scoped runtimes install at boot too, but their
   * `bootstrap` runs on the authenticated-actor edge and `teardown` runs
   * on logout / actor switch.
   */
  readonly scope: RuntimeScope;
  /** Register subscriptions / timers. Idempotent. */
  install(): void;
  /** Reverse of `install`. Idempotent. */
  teardown(): void;
  /**
   * Populate the runtime's owning store(s) for `actorPtid`. Called by the
   * BootPipeline after `install` whenever `scope === 'session'`, and once
   * at install for `scope === 'app'`. Re-entrant calls for the same actor
   * MUST be no-ops (the registry guards this with sequence numbers).
   */
  bootstrap(actorPtid: string | null): Promise<void>;
  /** Optional periodic / event-driven projection refresh. */
  reconcile?(reason: string): Promise<void>;
  /** Optional page-scoped runtime resource acquisition. Idempotent. */
  acquirePage?(pageId: string, reason: RuntimePageAcquireReason): void | Promise<void>;
  /** Optional page-scoped runtime resource release. Idempotent. */
  releasePage?(pageId: string, reason: RuntimePageReleaseReason): void | Promise<void>;
}

interface RuntimeRecord {
  desc: RuntimeDescriptor;
  installed: boolean;
  // Per-bootstrap sequence so a logout-during-bootstrap discards the
  // in-flight result instead of writing stale data.
  bootstrapSequence: number;
  bootstrappedActorPtid: string | null;
}

const records = new Map<string, RuntimeRecord>();
const pendingPageAcquires = new Map<string, Map<string, RuntimePageAcquireReason>>();

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function registerRuntime(desc: RuntimeDescriptor): void {
  if (records.has(desc.id)) {
    log.warn('runtime', 'duplicate runtime registration ignored', { id: desc.id });
    return;
  }
  records.set(desc.id, {
    desc,
    installed: false,
    bootstrapSequence: 0,
    bootstrappedActorPtid: null,
  });
}

function queuePendingPageAcquire(id: string, pageId: string, reason: RuntimePageAcquireReason): void {
  let pending = pendingPageAcquires.get(id);
  if (!pending) {
    pending = new Map();
    pendingPageAcquires.set(id, pending);
  }
  pending.set(pageId, reason);
}

function clearPendingPageAcquire(id: string, pageId: string): void {
  const pending = pendingPageAcquires.get(id);
  if (!pending) return;
  pending.delete(pageId);
  if (pending.size === 0) pendingPageAcquires.delete(id);
}

function runRuntimePageAcquire(
  rec: RuntimeRecord,
  pageId: string,
  reason: RuntimePageAcquireReason,
): void {
  if (!rec.desc.acquirePage) return;
  const t0 = nowMs();
  Promise.resolve(rec.desc.acquirePage(pageId, reason))
    .then(() => {
      const ms = nowMs() - t0;
      log.info('runtime', `${rec.desc.id}:page-acquire`, { pageId, reason, ms: Math.round(ms) });
      recordRuntimePageLease(rec.desc.id, pageId, reason, ms, 'acquire');
    })
    .catch((err) => {
      log.warn('runtime', `${rec.desc.id}:page-acquire failed`, { pageId, reason, err });
    });
}

function replayPendingPageAcquires(id: string, rec: RuntimeRecord): void {
  const pending = pendingPageAcquires.get(id);
  if (!pending || !rec.installed || !rec.desc.acquirePage) return;
  pendingPageAcquires.delete(id);
  for (const [pageId, reason] of pending) {
    runRuntimePageAcquire(rec, pageId, reason);
  }
}

export function listRuntimes(scope?: RuntimeScope): RuntimeDescriptor[] {
  const out: RuntimeDescriptor[] = [];
  for (const r of records.values()) {
    if (!scope || r.desc.scope === scope) out.push(r.desc);
  }
  return out;
}

export function installRuntime(id: string): void {
  const rec = records.get(id);
  if (!rec || rec.installed) return;
  const t0 = nowMs();
  try {
    rec.desc.install();
    rec.installed = true;
    const ms = nowMs() - t0;
    log.info('runtime', `${id}:install`, { ms: Math.round(ms) });
    recordRuntimeInstall(id, ms);
    replayPendingPageAcquires(id, rec);
  } catch (err) {
    log.error('runtime', `${id}:install failed`, err);
  }
}

export function teardownRuntime(id: string): void {
  const rec = records.get(id);
  if (!rec || !rec.installed) return;
  const t0 = nowMs();
  try {
    rec.desc.teardown();
  } catch (err) {
    log.error('runtime', `${id}:teardown failed`, err);
  } finally {
    rec.installed = false;
    rec.bootstrappedActorPtid = null;
    log.info('runtime', `${id}:teardown`, { ms: Math.round(nowMs() - t0) });
  }
}

export async function bootstrapRuntime(id: string, actorPtid: string | null): Promise<void> {
  const rec = records.get(id);
  if (!rec) return;
  if (!rec.installed) installRuntime(id);
  // App-scope runtimes bootstrap once with `null` actor; session-scope
  // bootstrap per actor edge. Both short-circuit when the actor matches.
  if (rec.bootstrappedActorPtid === (actorPtid ?? null) && actorPtid !== null) return;
  if (rec.desc.scope === 'app' && rec.bootstrappedActorPtid !== null) return;

  const sequence = ++rec.bootstrapSequence;
  const t0 = nowMs();
  try {
    await rec.desc.bootstrap(actorPtid);
    if (sequence !== rec.bootstrapSequence) return;
    rec.bootstrappedActorPtid = actorPtid ?? null;
    const ms = nowMs() - t0;
    log.info('runtime', `${id}:bootstrap`, { ms: Math.round(ms), actorPtid });
    recordRuntimeBootstrap(id, ms, actorPtid);
  } catch (err) {
    log.error('runtime', `${id}:bootstrap failed`, err);
  }
}

export async function reconcileRuntime(id: string, reason: string): Promise<void> {
  const rec = records.get(id);
  if (!rec || !rec.installed || !rec.desc.reconcile) return;
  const t0 = nowMs();
  try {
    await rec.desc.reconcile(reason);
    log.info('runtime', `${id}:reconcile`, { ms: Math.round(nowMs() - t0), reason });
  } catch (err) {
    log.warn('runtime', `${id}:reconcile failed`, err);
  }
}

export function acquireRuntimePage(id: string, pageId: string, reason: RuntimePageAcquireReason): void {
  const rec = records.get(id);
  if (!rec || !rec.installed) {
    queuePendingPageAcquire(id, pageId, reason);
    return;
  }
  runRuntimePageAcquire(rec, pageId, reason);
}

export function releaseRuntimePage(id: string, pageId: string, reason: RuntimePageReleaseReason): void {
  const rec = records.get(id);
  clearPendingPageAcquire(id, pageId);
  if (!rec || !rec.installed || !rec.desc.releasePage) return;
  const t0 = nowMs();
  Promise.resolve(rec.desc.releasePage(pageId, reason))
    .then(() => {
      const ms = nowMs() - t0;
      log.info('runtime', `${id}:page-release`, { pageId, reason, ms: Math.round(ms) });
      recordRuntimePageLease(id, pageId, reason, ms, 'release');
    })
    .catch((err) => {
      log.warn('runtime', `${id}:page-release failed`, { pageId, reason, err });
    });
}

/**
 * Drop session-scope bootstrap markers so the next authenticated edge
 * re-runs `bootstrap`. Called by the BootPipeline on logout.
 */
export function resetSessionRuntimeBootstraps(): void {
  for (const rec of records.values()) {
    if (rec.desc.scope === 'session') {
      rec.bootstrappedActorPtid = null;
      rec.bootstrapSequence += 1;
    }
  }
}

/** Test / hot-reload aid — do not call in production code. */
export function _resetRuntimeRegistryForTests(): void {
  for (const id of Array.from(records.keys())) {
    teardownRuntime(id);
  }
  records.clear();
}
