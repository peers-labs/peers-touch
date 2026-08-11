// FrontendScheduler — 5-lane cooperative task scheduler.
//
// Contract: design.md §3.2 + execution-plan Phase 1a.
// Lanes: visible → afterFirstPaint → idleChunk → background → teardown.
//
// Rules:
// - visible: only route/active-state/lightweight-feedback. Synchronous.
// - afterFirstPaint: deferred to next rAF. Returns cancel function.
// - idleChunk: one heavy task per idle callback, label required for telemetry.
// - background: queued async, must not block route-to-visible.
// - teardown: bound to LRU eviction / explicit close / session edge.

import { log } from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────

export interface FrontendScheduler {
  visible(action: () => void): void;
  afterFirstPaint(action: () => void): () => void;
  idleChunk(label: string, action: () => void | Promise<void>, timeoutMs?: number): () => void;
  background(label: string, action: () => void | Promise<void>): void;
  teardown(label: string, action: () => void | Promise<void>): void;
}

// ── Internal helpers ──────────────────────────────────────────────────────

type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining(): number }) => void;
type RequestIdleCallback = (cb: IdleCallback, opts?: { timeout?: number }) => number;
type CancelIdleCallback = (handle: number) => void;

interface IdleCapableWindow {
  requestIdleCallback?: RequestIdleCallback;
  cancelIdleCallback?: CancelIdleCallback;
}

function requestIdle(callback: () => void, timeoutMs: number): () => void {
  if (typeof window === 'undefined') {
    const handle = setTimeout(callback, 0);
    return () => clearTimeout(handle);
  }
  const w = window as unknown as IdleCapableWindow;
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(() => callback(), { timeout: timeoutMs });
    return () => {
      if (typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(handle);
    };
  }
  const handle = setTimeout(callback, Math.min(timeoutMs, 200));
  return () => clearTimeout(handle);
}

function requestFrame(callback: () => void): () => void {
  if (
    typeof window === 'undefined'
    || typeof window.requestAnimationFrame !== 'function'
    || window.document?.visibilityState === 'hidden'
  ) {
    const handle = setTimeout(callback, 0);
    return () => clearTimeout(handle);
  }
  const handle = window.requestAnimationFrame(callback);
  return () => window.cancelAnimationFrame(handle);
}

// ── Scheduler implementation ──────────────────────────────────────────────

interface QueuedTask {
  label: string;
  action: () => void | Promise<void>;
  cancelled: boolean;
}

let backgroundQueue: QueuedTask[] = [];
let backgroundRunning = false;

async function drainBackground(): Promise<void> {
  if (backgroundRunning) return;
  backgroundRunning = true;
  while (backgroundQueue.length > 0) {
    const task = backgroundQueue.shift()!;
    if (task.cancelled) continue;
    try {
      await task.action();
    } catch (err) {
      log.error('scheduler', `background task "${task.label}" failed`, { err });
    }
  }
  backgroundRunning = false;
}

let teardownQueue: QueuedTask[] = [];
let teardownRunning = false;

async function drainTeardown(): Promise<void> {
  if (teardownRunning) return;
  teardownRunning = true;
  while (teardownQueue.length > 0) {
    const task = teardownQueue.shift()!;
    if (task.cancelled) continue;
    try {
      await task.action();
    } catch (err) {
      log.error('scheduler', `teardown task "${task.label}" failed`, { err });
    }
  }
  teardownRunning = false;
}

export const scheduler: FrontendScheduler = {
  visible(action: () => void): void {
    action();
  },

  afterFirstPaint(action: () => void): () => void {
    let cancelled = false;
    const cancelFrame = requestFrame(() => {
      if (!cancelled) {
        action();
      }
    });
    return () => {
      cancelled = true;
      cancelFrame();
    };
  },

  idleChunk(label: string, action: () => void | Promise<void>, timeoutMs = 2000): () => void {
    let cancelled = false;
    const cancelIdle = requestIdle(
      () => {
        if (cancelled) return;
        try {
          const result = action();
          if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch((err) => {
              log.error('scheduler', `idleChunk "${label}" failed`, { err });
            });
          }
        } catch (err) {
          log.error('scheduler', `idleChunk "${label}" failed`, { err });
        }
      },
      timeoutMs,
    );
    return () => {
      cancelled = true;
      cancelIdle();
    };
  },

  background(label: string, action: () => void | Promise<void>): void {
    backgroundQueue.push({ label, action, cancelled: false });
    void drainBackground();
  },

  teardown(label: string, action: () => void | Promise<void>): void {
    teardownQueue.push({ label, action, cancelled: false });
    void drainTeardown();
  },
};

// ── Test utilities ────────────────────────────────────────────────────────

export function _resetSchedulerQueues(): void {
  backgroundQueue = [];
  teardownQueue = [];
  backgroundRunning = false;
  teardownRunning = false;
}
