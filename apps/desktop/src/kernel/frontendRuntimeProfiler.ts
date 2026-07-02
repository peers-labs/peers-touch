import { log } from '../utils/logger';

type FrontendRuntimeEventType =
  | 'boot.phase'
  | 'route.requested'
  | 'route.visible'
  | 'surface.render'
  | 'surface.hidden.render'
  | 'runtime.install'
  | 'runtime.bootstrap'
  | 'runtime.page-acquire'
  | 'runtime.page-release'
  | 'longtask.detected';

interface FrontendRuntimeEvent {
  at: number;
  data?: Record<string, unknown>;
  durationMs?: number;
  owner?: string;
  type: FrontendRuntimeEventType;
}

const LONG_TASK_THRESHOLD_MS = 50;
const events: FrontendRuntimeEvent[] = [];
const routeStartedAt = new Map<string, number>();
const visibleRouteKeys = new Set<string>();

let longTaskObserver: PerformanceObserver | null = null;
let installed = false;

declare global {
  interface Window {
    __PT_FRONTEND_RUNTIME_EVENTS__?: ReadonlyArray<FrontendRuntimeEvent>;
  }
}

function isEnabled(): boolean {
  return import.meta.env.DEV && typeof window !== 'undefined';
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function pushEvent(event: FrontendRuntimeEvent): void {
  if (!isEnabled()) return;
  events.push(event);
  if (events.length > 500) events.splice(0, events.length - 500);
  log.info('frontendRuntime', event.type, {
    at: Math.round(event.at),
    data: event.data,
    durationMs: event.durationMs === undefined ? undefined : Math.round(event.durationMs),
    owner: event.owner,
  });
}

export function installFrontendRuntimeProfiler(): void {
  if (!isEnabled() || installed) return;
  installed = true;
  window.__PT_FRONTEND_RUNTIME_EVENTS__ = events;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < LONG_TASK_THRESHOLD_MS) continue;
          pushEvent({
            at: entry.startTime,
            data: { name: entry.name },
            durationMs: entry.duration,
            owner: 'unknown',
            type: 'longtask.detected',
          });
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      longTaskObserver = null;
    }
  }

  log.info('frontendRuntime', 'profiler.installed', { longTask: Boolean(longTaskObserver) });
}

export function teardownFrontendRuntimeProfiler(): void {
  longTaskObserver?.disconnect();
  longTaskObserver = null;
  installed = false;
  window.__PT_FRONTEND_RUNTIME_EVENTS__ = undefined;
  routeStartedAt.clear();
  visibleRouteKeys.clear();
  events.length = 0;
}

export function markRouteRequested(pageId: string, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  routeStartedAt.set(pageId, nowMs());
  visibleRouteKeys.delete(pageId);
  pushEvent({ at: nowMs(), data: { pageId, ...data }, owner: pageId, type: 'route.requested' });
}

export function markRouteVisible(pageId: string, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  if (visibleRouteKeys.has(pageId)) return;
  visibleRouteKeys.add(pageId);
  const at = nowMs();
  const startedAt = routeStartedAt.get(pageId);
  pushEvent({
    at,
    data: { pageId, ...data },
    durationMs: startedAt === undefined ? undefined : at - startedAt,
    owner: pageId,
    type: 'route.visible',
  });
}

export function recordSurfaceRender(
  surfaceId: string,
  durationMs: number,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  pushEvent({
    at: nowMs(),
    data: { surfaceId, ...data },
    durationMs,
    owner: surfaceId,
    type: 'surface.render',
  });
}

export function recordHiddenSurfaceRender(surfaceId: string, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  pushEvent({
    at: nowMs(),
    data: { surfaceId, ...data },
    owner: surfaceId,
    type: 'surface.hidden.render',
  });
}

export function recordRuntimeInstall(runtimeId: string, durationMs: number): void {
  if (!isEnabled()) return;
  pushEvent({
    at: nowMs(),
    data: { runtimeId },
    durationMs,
    owner: runtimeId,
    type: 'runtime.install',
  });
}

export function recordBootPhase(phase: string, state: 'start' | 'end', durationMs?: number, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  pushEvent({
    at: nowMs(),
    data: { phase, state, ...data },
    durationMs,
    owner: phase,
    type: 'boot.phase',
  });
}

export function recordRuntimeBootstrap(runtimeId: string, durationMs: number, actorId: string | null): void {
  if (!isEnabled()) return;
  pushEvent({
    at: nowMs(),
    data: { actorId, runtimeId },
    durationMs,
    owner: runtimeId,
    type: 'runtime.bootstrap',
  });
}

export function recordRuntimePageLease(
  runtimeId: string,
  pageId: string,
  reason: string,
  durationMs: number,
  direction: 'acquire' | 'release',
): void {
  if (!isEnabled()) return;
  pushEvent({
    at: nowMs(),
    data: { direction, pageId, reason, runtimeId },
    durationMs,
    owner: runtimeId,
    type: direction === 'acquire' ? 'runtime.page-acquire' : 'runtime.page-release',
  });
}

export function getFrontendRuntimeProfilerEvents(): ReadonlyArray<FrontendRuntimeEvent> {
  return events;
}
