import { log } from '../utils/logger';
import {
  type DesktopFrontendTelemetryEvent,
  type DesktopFrontendTelemetryInput,
  emitFrontendTelemetryEvent,
  getFrontendTelemetryEvents,
  installFrontendTelemetryQueue,
  teardownFrontendTelemetryQueue,
} from './frontendTelemetry';

const LONG_TASK_THRESHOLD_MS = 50;
const LAYOUT_SHIFT_THRESHOLD = 0.1;
const ACTIVE_INTERACTION_WINDOW_MS = 5000;
const STARTUP_INVOKE_COMMANDS = new Set([
  'auth_restore_session',
  'ensure_station_session',
  'federation_health',
  'station_list',
  'runtime_bootstrap',
]);
const routeStartedAt = new Map<string, number>();
const routeInteractionIds = new Map<string, string>();
const overlayStartedAt = new Map<string, number>();
const overlayInteractionIds = new Map<string, string>();
const visibleRouteKeys = new Set<string>();

let performanceObservers: PerformanceObserver[] = [];
let installed = false;
let activeInteraction: { expiresAt: number; id: string } | null = null;

type ReactCommitInput = {
  actualDuration: number;
  baseDuration: number;
  commitTime: number;
  data?: Record<string, unknown>;
  id: string;
  owner: string;
  pageId?: string;
  phase: string;
  sectionId?: string;
  source: DesktopFrontendTelemetryInput['source'];
  startTime: number;
};

type StoreUpdateInput = {
  changedKeys: readonly string[];
  durationMs?: number;
  fanout?: number | 'unknown';
  listenerCount?: number | 'unknown';
  owner?: string;
  store: string;
};

type LayoutShiftEntryLike = Pick<PerformanceEntry, 'duration' | 'name' | 'startTime'> & {
  hadRecentInput?: boolean;
  value?: number;
};

type PaintTimingEntryLike = Pick<PerformanceEntry, 'duration' | 'name' | 'startTime'>;

function isEnabled(): boolean {
  return import.meta.env.DEV && typeof window !== 'undefined';
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function pushEvent(event: DesktopFrontendTelemetryInput): void {
  if (!isEnabled()) return;
  emitFrontendTelemetryEvent(event);
}

function createInteractionId(target: string): string {
  const normalized = target.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 80) || 'unknown';
  return `${normalized}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentInteractionId(at: number = nowMs()): string | undefined {
  if (!activeInteraction) return undefined;
  if (activeInteraction.expiresAt < at) {
    activeInteraction = null;
    return undefined;
  }
  return activeInteraction.id;
}

function classifyInvokePhase(command: string, interactionId?: string): DesktopFrontendTelemetryInput['phase'] {
  if (interactionId) return 'interaction';
  if (STARTUP_INVOKE_COMMANDS.has(command)) return 'startup';
  return 'background';
}

function invokeModule(command: string): string {
  const [head, second] = command.split('_');
  if (!second) return head || 'unknown';
  return `${head}_${second}`;
}

function observePerformanceEntries(
  options: PerformanceObserverInit,
  onEntry: (entry: PerformanceEntry) => void,
): PerformanceObserver | null {
  if (typeof PerformanceObserver === 'undefined') return null;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) onEntry(entry);
    });
    observer.observe(options);
    performanceObservers.push(observer);
    return observer;
  } catch {
    return null;
  }
}

export function installFrontendRuntimeProfiler(): void {
  if (!isEnabled() || installed) return;
  installed = true;
  installFrontendTelemetryQueue();

  const longTaskObserver = observePerformanceEntries({ entryTypes: ['longtask'] }, recordLongTaskDetected);
  const layoutShiftObserver = observePerformanceEntries({ type: 'layout-shift', buffered: true }, (entry) => {
    recordLayoutShiftDetected(entry as LayoutShiftEntryLike);
  });
  const paintObserver = observePerformanceEntries({ type: 'paint', buffered: true }, recordPaintTimingDetected);

  log.info('frontendRuntime', 'profiler.installed', {
    layoutShift: Boolean(layoutShiftObserver),
    longTask: Boolean(longTaskObserver),
    paint: Boolean(paintObserver),
  });
}

export function teardownFrontendRuntimeProfiler(): void {
  for (const observer of performanceObservers) observer.disconnect();
  performanceObservers = [];
  installed = false;
  teardownFrontendTelemetryQueue();
  activeInteraction = null;
  routeStartedAt.clear();
  routeInteractionIds.clear();
  overlayStartedAt.clear();
  overlayInteractionIds.clear();
  visibleRouteKeys.clear();
}

export function markInteractionStarted(
  source: DesktopFrontendTelemetryInput['source'],
  target: string,
  data?: Record<string, unknown>,
): string {
  const interactionId = createInteractionId(target);
  activeInteraction = { expiresAt: nowMs() + ACTIVE_INTERACTION_WINDOW_MS, id: interactionId };
  pushEvent({
    data: { target, ...data },
    interactionId,
    kind: 'interaction.started',
    module: target,
    owner: target,
    phase: 'interaction',
    source,
  });
  return interactionId;
}

export function markOverlayIntent(target: string, data?: Record<string, unknown>): string {
  const interactionId = markInteractionStarted('overlay', target, {
    overlayTarget: target,
    ...data,
  });
  overlayStartedAt.set(target, nowMs());
  overlayInteractionIds.set(target, interactionId);
  pushEvent({
    data: { overlayTarget: target, ...data },
    interactionId,
    kind: 'contextmenu.intent',
    module: target,
    owner: target,
    phase: 'interaction',
    source: 'overlay',
  });
  return interactionId;
}

export function markOverlayVisible(target: string, open: boolean, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  const interactionId =
    typeof data?.interactionId === 'string'
      ? data.interactionId
      : overlayInteractionIds.get(target) ?? currentInteractionId();
  const startedAt = overlayStartedAt.get(target);
  pushEvent({
    data: { open, overlayTarget: target, ...data },
    durationMs: open && startedAt !== undefined ? nowMs() - startedAt : undefined,
    interactionId,
    kind: open ? 'overlay.visible' : 'overlay.hidden',
    module: target,
    owner: target,
    phase: 'interaction',
    source: 'overlay',
  });
  if (!open) {
    overlayStartedAt.delete(target);
    overlayInteractionIds.delete(target);
  }
}

export function markInvokeStarted(command: string, data?: Record<string, unknown>): string | undefined {
  if (!isEnabled()) return undefined;
  const interactionId =
    typeof data?.interactionId === 'string' ? data.interactionId : currentInteractionId();
  pushEvent({
    data: { command, ...data },
    interactionId,
    kind: 'invoke.started',
    module: invokeModule(command),
    owner: command,
    phase: classifyInvokePhase(command, interactionId),
    source: 'invoke',
  });
  return interactionId;
}

export function recordLongTaskDetected(
  entry: Pick<PerformanceEntry, 'duration' | 'name' | 'startTime'>,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled() || entry.duration < LONG_TASK_THRESHOLD_MS) return;
  const interactionId =
    typeof data?.interactionId === 'string' ? data.interactionId : currentInteractionId(entry.startTime);
  pushEvent({
    data: {
      name: entry.name,
      thresholdMs: LONG_TASK_THRESHOLD_MS,
      ...data,
    },
    durationMs: entry.duration,
    interactionId,
    kind: 'longtask.detected',
    module: 'main-thread',
    owner: 'main-thread',
    phase: interactionId ? 'interaction' : 'background',
    severity: 'warn',
    source: 'runtime',
    ts: entry.startTime,
  });
}

export function recordLayoutShiftDetected(
  entry: LayoutShiftEntryLike,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled() || entry.hadRecentInput) return;
  const value = typeof entry.value === 'number' ? entry.value : 0;
  const interactionId =
    typeof data?.interactionId === 'string' ? data.interactionId : currentInteractionId(entry.startTime);
  pushEvent({
    data: {
      hadRecentInput: Boolean(entry.hadRecentInput),
      metric: 'layout-shift',
      name: entry.name,
      thresholdMs: LAYOUT_SHIFT_THRESHOLD,
      value,
      ...data,
    },
    durationMs: value,
    interactionId,
    kind: 'layout.shift',
    module: 'main-thread',
    owner: 'main-thread',
    phase: interactionId ? 'interaction' : 'background',
    severity: value > LAYOUT_SHIFT_THRESHOLD ? 'warn' : 'info',
    source: 'runtime',
    ts: entry.startTime,
  });
}

export function recordPaintTimingDetected(
  entry: PaintTimingEntryLike,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  const interactionId =
    typeof data?.interactionId === 'string' ? data.interactionId : currentInteractionId(entry.startTime);
  pushEvent({
    data: {
      metric: 'paint-timing',
      name: entry.name,
      ...data,
    },
    durationMs: entry.startTime,
    interactionId,
    kind: 'paint.timing',
    module: 'main-thread',
    owner: 'main-thread',
    phase: interactionId ? 'interaction' : 'startup',
    source: 'runtime',
    ts: entry.startTime,
  });
}

export function recordReactCommit(input: ReactCommitInput): void {
  if (!isEnabled()) return;
  const interactionId =
    typeof input.data?.interactionId === 'string'
      ? input.data.interactionId
      : currentInteractionId(input.commitTime);
  pushEvent({
    data: {
      actualDuration: input.actualDuration,
      baseDuration: input.baseDuration,
      commitTime: input.commitTime,
      profilerId: input.id,
      reactPhase: input.phase,
      startTime: input.startTime,
      ...input.data,
    },
    durationMs: input.actualDuration,
    interactionId,
    kind: 'react.commit',
    module: input.id,
    owner: input.owner,
    pageId: input.pageId,
    phase: interactionId ? 'interaction' : 'background',
    sectionId: input.sectionId,
    source: input.source,
    ts: input.commitTime,
  });
}

export function recordStoreUpdate(input: StoreUpdateInput): void {
  if (!isEnabled()) return;
  const interactionId = currentInteractionId();
  pushEvent({
    data: {
      changedKeyCount: input.changedKeys.length,
      changedKeys: input.changedKeys.slice(0, 40),
      fanout: input.fanout ?? 'unknown',
      listenerCount: input.listenerCount ?? 'unknown',
      store: input.store,
    },
    durationMs: input.durationMs,
    interactionId,
    kind: 'store.update',
    module: input.store,
    owner: input.owner ?? 'unknown',
    phase: interactionId ? 'interaction' : 'background',
    source: 'store',
  });
}

export function markInvokeCompleted(
  command: string,
  durationMs: number,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  const interactionId =
    typeof data?.interactionId === 'string' ? data.interactionId : currentInteractionId();
  pushEvent({
    data: { command, status: 'ok', ...data },
    durationMs,
    interactionId,
    kind: 'invoke.completed',
    module: invokeModule(command),
    owner: command,
    phase: classifyInvokePhase(command, interactionId),
    source: 'invoke',
  });
}

export function markInvokeFailed(
  command: string,
  durationMs: number,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  const interactionId =
    typeof data?.interactionId === 'string' ? data.interactionId : currentInteractionId();
  pushEvent({
    data: { command, status: 'failed', ...data },
    durationMs,
    interactionId,
    kind: 'invoke.failed',
    module: invokeModule(command),
    owner: command,
    phase: classifyInvokePhase(command, interactionId),
    severity: 'warn',
    source: 'invoke',
  });
}

export function markRouteRequested(pageId: string, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  const interactionId =
    typeof data?.interactionId === 'string' ? data.interactionId : currentInteractionId();
  if (interactionId) routeInteractionIds.set(pageId, interactionId);
  routeStartedAt.set(pageId, nowMs());
  visibleRouteKeys.delete(pageId);
  pushEvent({
    data: { pageId, ...data },
    interactionId,
    kind: 'route.requested',
    module: pageId,
    owner: pageId,
    pageId,
    phase: 'interaction',
    source: 'shell',
  });
}

export function markRouteVisible(pageId: string, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  if (visibleRouteKeys.has(pageId)) return;
  visibleRouteKeys.add(pageId);
  const at = nowMs();
  const startedAt = routeStartedAt.get(pageId);
  const interactionId =
    typeof data?.interactionId === 'string' ? data.interactionId : routeInteractionIds.get(pageId);
  pushEvent({
    data: { pageId, ...data },
    durationMs: startedAt === undefined ? undefined : at - startedAt,
    interactionId,
    kind: 'route.visible',
    module: pageId,
    owner: pageId,
    pageId,
    phase: 'interaction',
    source: 'shell',
  });
}

export function recordSurfaceRender(
  surfaceId: string,
  durationMs: number,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  pushEvent({
    data: { surfaceId, ...data },
    durationMs,
    interactionId: typeof data?.interactionId === 'string' ? data.interactionId : currentInteractionId(),
    kind: 'surface.render',
    module: surfaceId,
    owner: surfaceId,
    phase: 'interaction',
    source: data?.sectionId ? 'section-host' : 'page-host',
  });
}

export function recordHiddenSurfaceRender(surfaceId: string, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  pushEvent({
    data: { surfaceId, ...data },
    interactionId: typeof data?.interactionId === 'string' ? data.interactionId : currentInteractionId(),
    kind: 'surface.hidden.render',
    module: surfaceId,
    owner: surfaceId,
    phase: 'background',
    source: data?.sectionId ? 'section-host' : 'page-host',
  });
}

export function recordRuntimeInstall(runtimeId: string, durationMs: number): void {
  if (!isEnabled()) return;
  pushEvent({
    data: { runtimeId },
    durationMs,
    kind: 'runtime.install',
    module: runtimeId,
    owner: runtimeId,
    phase: 'startup',
    source: 'runtime',
  });
}

export function recordBootPhase(phase: string, state: 'start' | 'end', durationMs?: number, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  pushEvent({
    data: { phase, state, ...data },
    durationMs,
    kind: 'boot.phase',
    module: phase,
    owner: phase,
    phase: 'startup',
    source: 'runtime',
  });
}

export function recordRuntimeBootstrap(runtimeId: string, durationMs: number, actorId: string | null): void {
  if (!isEnabled()) return;
  pushEvent({
    data: { actorId, runtimeId },
    durationMs,
    kind: 'runtime.bootstrap',
    module: runtimeId,
    owner: runtimeId,
    phase: 'startup',
    source: 'runtime',
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
    data: { direction, pageId, reason, runtimeId },
    durationMs,
    kind: direction === 'acquire' ? 'runtime.page-acquire' : 'runtime.page-release',
    module: runtimeId,
    owner: runtimeId,
    pageId,
    phase: 'background',
    source: 'runtime',
  });
}

export function getFrontendRuntimeProfilerEvents(): ReadonlyArray<DesktopFrontendTelemetryEvent> {
  return getFrontendTelemetryEvents();
}
