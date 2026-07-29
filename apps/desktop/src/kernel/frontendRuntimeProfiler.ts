import { log } from '../utils/logger';
import {
  type DesktopFrontendTelemetryEvent,
  type DesktopFrontendTelemetryInput,
  emitFrontendTelemetryEvent,
  getFrontendTelemetryEvents,
  installFrontendTelemetryQueue,
  registerFrontendTelemetryClearHook,
  teardownFrontendTelemetryQueue,
} from './frontendTelemetry';
import { markInteractionStart } from './invokeThrottler';

const LONG_TASK_THRESHOLD_MS = 50;
const LAYOUT_SHIFT_THRESHOLD = 0.1;
const ACTIVE_INTERACTION_WINDOW_MS = 250;
const INTERACTION_IDLE_GRACE_MS = 16;
const RECENT_MAIN_THREAD_CONTEXT_WINDOW_MS = 5_000;
const STARTUP_INVOKE_COMMANDS = new Set([
  'auth_restore_session',
  'ensure_station_session',
  'federation_health',
  'station_list',
  'runtime_bootstrap',
]);
const SYSTEM_INVOKE_COMMANDS = new Set(['frontend_log', 'frontend_telemetry_upload']);
const BACKGROUND_MAINTENANCE_INVOKE_COMMANDS = new Set([
  'auth_validate_token',
  'notification_unread_counts',
]);
const routeStartedAt = new Map<string, number>();
const routeInteractionIds = new Map<string, string>();
const inputStartedAt = new Map<string, number>();
const overlayStartedAt = new Map<string, number>();
const overlayInteractionIds = new Map<string, string>();
const overlayVisibleEventKeys = new Set<string>();
const visibleRouteKeys = new Set<string>();

let performanceObservers: PerformanceObserver[] = [];
let installed = false;
let activeInteraction: { expiresAt: number; id: string; startedAt: number } | null = null;
let recentInteractionContext:
  | {
      id: string;
      pageId?: string;
      source: DesktopFrontendTelemetryInput['source'];
      startedAt: number;
      target: string;
    }
  | null = null;
let recentRuntimeContext:
  | {
      at: number;
      interactionId?: string;
      kind: string;
      module: string;
      owner?: string;
      pageId?: string;
      phase?: DesktopFrontendTelemetryInput['phase'];
      sectionId?: string;
    }
  | null = null;
let unregisterTelemetryClearHook: (() => void) | undefined;
const emittedPaintTimingKeys = new Set<string>();

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

export function isFrontendRuntimeProfilerEnabled(): boolean {
  return (import.meta.env.DEV || import.meta.env.VITE_ACCEPTANCE_HARNESS === '1') && typeof window !== 'undefined';
}

export function isReactCommitProfilingEnabled(): boolean {
  if (!isFrontendRuntimeProfilerEnabled()) return false;
  try {
    return window.localStorage.getItem('pt:react-profiler') === '1';
  } catch {
    return false;
  }
}

export function isStoreUpdateProfilingEnabled(): boolean {
  if (!isFrontendRuntimeProfilerEnabled()) return false;
  try {
    return window.localStorage.getItem('pt:store-profiler') === '1';
  } catch {
    return false;
  }
}

function isEnabled(): boolean {
  return isFrontendRuntimeProfilerEnabled();
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const pendingEvents: DesktopFrontendTelemetryInput[] = [];
let flushHandle: number | ReturnType<typeof setTimeout> | null = null;

function drainPendingEvents(): void {
  flushHandle = null;
  if (pendingEvents.length === 0) return;
  const batch = pendingEvents.splice(0, pendingEvents.length);
  for (const event of batch) {
    emitFrontendTelemetryEvent(event);
  }
}

function scheduleFlush(): void {
  if (flushHandle !== null) return;
  if (typeof requestIdleCallback === 'function') {
    flushHandle = requestIdleCallback(drainPendingEvents, { timeout: 2000 });
  } else {
    flushHandle = setTimeout(drainPendingEvents, 200);
  }
}

function pushEvent(event: DesktopFrontendTelemetryInput): void {
  if (!isEnabled()) return;
  pendingEvents.push(event);
  scheduleFlush();
}

function createInteractionId(target: string): string {
  const normalized = target.replace(/[^a-zA-Z0-9:_-]/g, '-').slice(0, 80) || 'unknown';
  return `${normalized}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentInteractionId(at: number = nowMs()): string | undefined {
  if (!activeInteraction) return undefined;
  if (at < activeInteraction.startedAt || activeInteraction.expiresAt < at) {
    activeInteraction = null;
    return undefined;
  }
  return activeInteraction.id;
}

export function getActiveFrontendInteractionWindow(at: number = nowMs()):
  | {
      ageMs: number;
      id: string;
      remainingMs: number;
      startedAt: number;
    }
  | null {
  if (!activeInteraction) return null;
  if (at < activeInteraction.startedAt || activeInteraction.expiresAt < at) {
    activeInteraction = null;
    return null;
  }
  return {
    ageMs: at - activeInteraction.startedAt,
    id: activeInteraction.id,
    remainingMs: activeInteraction.expiresAt - at,
    startedAt: activeInteraction.startedAt,
  };
}

export async function waitForFrontendInteractionIdle(
  maxWaitMs = ACTIVE_INTERACTION_WINDOW_MS * 2,
): Promise<void> {
  if (typeof window === 'undefined') return;
  const startedAt = nowMs();
  const setTimer =
    typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : globalThis.setTimeout.bind(globalThis);

  while (true) {
    const active = getActiveFrontendInteractionWindow();
    if (!active) return;
    const waitedMs = nowMs() - startedAt;
    if (waitedMs >= maxWaitMs) return;
    const delayMs = Math.min(
      Math.max(active.remainingMs + INTERACTION_IDLE_GRACE_MS, INTERACTION_IDLE_GRACE_MS),
      Math.max(maxWaitMs - waitedMs, INTERACTION_IDLE_GRACE_MS),
    );
    await new Promise<void>((resolve) => {
      setTimer(resolve, delayMs);
    });
  }
}

function classifyInvokePhase(command: string, interactionId?: string): DesktopFrontendTelemetryInput['phase'] {
  if (interactionId) return 'interaction';
  if (STARTUP_INVOKE_COMMANDS.has(command)) return 'startup';
  return 'background';
}

function rememberRuntimeContext(
  at: number,
  context: Omit<NonNullable<typeof recentRuntimeContext>, 'at'>,
): void {
  recentRuntimeContext = { at, ...context };
}

function recentAgeMs(at: number, startedAt: number): number | undefined {
  const age = at - startedAt;
  if (age < 0 || age > RECENT_MAIN_THREAD_CONTEXT_WINDOW_MS) return undefined;
  return Math.round(age * 10) / 10;
}

function mainThreadContextData(at: number, interactionId?: string): Record<string, unknown> {
  const data: Record<string, unknown> = {
    contextWindowMs: RECENT_MAIN_THREAD_CONTEXT_WINDOW_MS,
  };
  if (activeInteraction) {
    data.activeInteractionId = activeInteraction.id;
    data.activeInteractionAgeMs = recentAgeMs(at, activeInteraction.startedAt);
  }
  if (recentInteractionContext) {
    const age = recentAgeMs(at, recentInteractionContext.startedAt);
    if (age !== undefined) {
      data.recentInteractionId = recentInteractionContext.id;
      data.recentInteractionAgeMs = age;
      data.recentInteractionSource = recentInteractionContext.source;
      data.recentInteractionTarget = recentInteractionContext.target;
      if (recentInteractionContext.pageId) data.recentInteractionPageId = recentInteractionContext.pageId;
    }
  }
  if (recentRuntimeContext) {
    const age = recentAgeMs(at, recentRuntimeContext.at);
    if (age !== undefined) {
      data.recentRuntimeKind = recentRuntimeContext.kind;
      data.recentRuntimeModule = recentRuntimeContext.module;
      data.recentRuntimeAgeMs = age;
      if (recentRuntimeContext.interactionId) data.recentRuntimeInteractionId = recentRuntimeContext.interactionId;
      if (recentRuntimeContext.owner) data.recentRuntimeOwner = recentRuntimeContext.owner;
      if (recentRuntimeContext.pageId) data.recentRuntimePageId = recentRuntimeContext.pageId;
      if (recentRuntimeContext.phase) data.recentRuntimePhase = recentRuntimeContext.phase;
      if (recentRuntimeContext.sectionId) data.recentRuntimeSectionId = recentRuntimeContext.sectionId;
    }
  }
  if (interactionId) data.attributedInteractionId = interactionId;
  return data;
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

function paintTimingKey(entry: PaintTimingEntryLike): string {
  return `${entry.name}:${entry.startTime}`;
}

function overlayVisibleEventKey(target: string, interactionId?: string): string | undefined {
  return interactionId ? `${target}:${interactionId}` : undefined;
}

function clearOverlayVisibleEventKeys(target: string): void {
  for (const key of overlayVisibleEventKeys) {
    if (key.startsWith(`${target}:`)) overlayVisibleEventKeys.delete(key);
  }
}

function isVisibleOverlayElement(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
  }
  return true;
}

function hasVisibleOverlayMenu(): boolean {
  if (typeof document === 'undefined') return false;
  const candidates = document.querySelectorAll(
    '.ant-dropdown:not(.ant-dropdown-hidden), .ant-dropdown-menu, [role="menu"]',
  );
  return Array.from(candidates).some(isVisibleOverlayElement);
}

export function scheduleAfterPaint(fn: () => void): void {
  if (typeof window === 'undefined') return;
  let done = false;
  const execute = () => {
    if (done) return;
    done = true;
    fn();
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(execute));
  }
  const timer = typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : setTimeout;
  timer(execute, 32);
}

function scheduleOverlayVisibleProbe(target: string, interactionId: string, data?: Record<string, unknown>): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const scheduleTimeout =
    typeof window.setTimeout === 'function'
      ? window.setTimeout.bind(window)
      : typeof setTimeout === 'function'
        ? setTimeout
        : undefined;
  if (!scheduleTimeout) return;
  const probe = () => {
    if (overlayInteractionIds.get(target) !== interactionId) return;
    if (!hasVisibleOverlayMenu()) return;
    markOverlayVisible(target, true, {
      interactionId,
      visibilitySource: 'dom-probe',
      ...data,
    });
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.requestAnimationFrame(probe));
  }
  scheduleTimeout(probe, 50);
  scheduleTimeout(probe, 150);
}

function recordBufferedPaintTimingEntries(): void {
  if (!isEnabled() || typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return;
  }
  for (const entry of performance.getEntriesByType('paint')) {
    recordPaintTimingDetected(entry, { replayedFromPerformanceTimeline: true });
  }
}

function resetPaintTimingReplayState(): void {
  emittedPaintTimingKeys.clear();
}

export function installFrontendRuntimeProfiler(): void {
  if (!isEnabled() || installed) return;
  installed = true;
  installFrontendTelemetryQueue();
  unregisterTelemetryClearHook = registerFrontendTelemetryClearHook(() => {
    resetPaintTimingReplayState();
    recordBufferedPaintTimingEntries();
  });

  const longTaskObserver = observePerformanceEntries({ entryTypes: ['longtask'] }, recordLongTaskDetected);
  const layoutShiftObserver = observePerformanceEntries({ type: 'layout-shift', buffered: true }, (entry) => {
    recordLayoutShiftDetected(entry as LayoutShiftEntryLike);
  });
  const paintObserver = observePerformanceEntries({ type: 'paint', buffered: true }, recordPaintTimingDetected);
  recordBufferedPaintTimingEntries();

  log.info('frontendRuntime', 'profiler.installed', {
    layoutShift: Boolean(layoutShiftObserver),
    longTask: Boolean(longTaskObserver),
    paint: Boolean(paintObserver),
  });
}

export function teardownFrontendRuntimeProfiler(): void {
  unregisterTelemetryClearHook?.();
  unregisterTelemetryClearHook = undefined;
  for (const observer of performanceObservers) observer.disconnect();
  performanceObservers = [];
  installed = false;
  if (flushHandle !== null) {
    if (typeof cancelIdleCallback === 'function' && typeof flushHandle === 'number') {
      cancelIdleCallback(flushHandle);
    } else {
      clearTimeout(flushHandle as ReturnType<typeof setTimeout>);
    }
    flushHandle = null;
  }
  pendingEvents.length = 0;
  teardownFrontendTelemetryQueue();
  activeInteraction = null;
  recentInteractionContext = null;
  recentRuntimeContext = null;
  routeStartedAt.clear();
  routeInteractionIds.clear();
  inputStartedAt.clear();
  overlayStartedAt.clear();
  overlayInteractionIds.clear();
  overlayVisibleEventKeys.clear();
  visibleRouteKeys.clear();
  resetPaintTimingReplayState();
}

export function markInteractionStarted(
  source: DesktopFrontendTelemetryInput['source'],
  target: string,
  data?: Record<string, unknown>,
): string {
  const interactionId = createInteractionId(target);
  const startedAt = nowMs();
  activeInteraction = { expiresAt: startedAt + ACTIVE_INTERACTION_WINDOW_MS, id: interactionId, startedAt };
  recentInteractionContext = {
    id: interactionId,
    pageId: typeof data?.pageId === 'string' ? data.pageId : undefined,
    source,
    startedAt,
    target,
  };
  markInteractionStart();
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

export function markTextInputIntent(
  target: string,
  data?: Record<string, unknown>,
): string | undefined {
  if (!isEnabled()) return undefined;
  const interactionId = markInteractionStarted('input', target, data);
  inputStartedAt.set(interactionId, nowMs());
  pushEvent({
    data: { inputTarget: target, ...data },
    interactionId,
    kind: 'input.intent',
    module: target,
    owner: target,
    phase: 'interaction',
    source: 'input',
  });
  return interactionId;
}

export function markTextInputVisible(
  target: string,
  interactionId: string,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  const startedAt = inputStartedAt.get(interactionId);
  pushEvent({
    data: { inputTarget: target, ...data },
    durationMs: startedAt === undefined ? undefined : nowMs() - startedAt,
    interactionId,
    kind: 'input.visible',
    module: target,
    owner: target,
    phase: 'interaction',
    source: 'input',
  });
  inputStartedAt.delete(interactionId);
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
  scheduleOverlayVisibleProbe(target, interactionId, data);
  return interactionId;
}

export function markOverlayVisible(target: string, open: boolean, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  const interactionId =
    typeof data?.interactionId === 'string'
      ? data.interactionId
      : overlayInteractionIds.get(target) ?? currentInteractionId();
  const eventKey = overlayVisibleEventKey(target, interactionId);
  if (open && eventKey) {
    if (overlayVisibleEventKeys.has(eventKey)) return;
    overlayVisibleEventKeys.add(eventKey);
  }
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
    clearOverlayVisibleEventKeys(target);
  }
}

export function markInvokeStarted(command: string, data?: Record<string, unknown>): string | undefined {
  if (!isEnabled()) return undefined;
  const interactionId =
    typeof data?.interactionId === 'string'
      ? data.interactionId
      : SYSTEM_INVOKE_COMMANDS.has(command) || BACKGROUND_MAINTENANCE_INVOKE_COMMANDS.has(command)
        ? undefined
        : currentInteractionId();
  const phase = classifyInvokePhase(command, interactionId);
  rememberRuntimeContext(nowMs(), {
    interactionId,
    kind: 'invoke.started',
    module: invokeModule(command),
    owner: command,
    phase,
  });
  pushEvent({
    data: { command, ...data },
    interactionId,
    kind: 'invoke.started',
    module: invokeModule(command),
    owner: command,
    phase,
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
      ...mainThreadContextData(entry.startTime, interactionId),
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
      ...mainThreadContextData(entry.startTime, interactionId),
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
  const key = paintTimingKey(entry);
  if (emittedPaintTimingKeys.has(key)) return;
  emittedPaintTimingKeys.add(key);
  const interactionId =
    typeof data?.interactionId === 'string' ? data.interactionId : currentInteractionId(entry.startTime);
  pushEvent({
    data: {
      ...mainThreadContextData(entry.startTime, interactionId),
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
      : input.data?.active === false
        ? undefined
        : currentInteractionId(input.commitTime);
  const phase: DesktopFrontendTelemetryInput['phase'] = interactionId ? 'interaction' : 'background';
  rememberRuntimeContext(input.commitTime, {
    interactionId,
    kind: 'react.commit',
    module: input.id,
    owner: input.owner,
    pageId: input.pageId,
    phase,
    sectionId: input.sectionId,
  });
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
    phase,
    sectionId: input.sectionId,
    source: input.source,
    ts: input.commitTime,
  });
}

export function recordStoreUpdate(input: StoreUpdateInput): void {
  if (!isEnabled()) return;
  const interactionId = currentInteractionId();
  const phase: DesktopFrontendTelemetryInput['phase'] = interactionId ? 'interaction' : 'background';
  rememberRuntimeContext(nowMs(), {
    interactionId,
    kind: 'store.update',
    module: input.store,
    owner: input.owner ?? 'unknown',
    phase,
  });
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
    phase,
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
    typeof data?.interactionId === 'string'
      ? data.interactionId
      : SYSTEM_INVOKE_COMMANDS.has(command) || BACKGROUND_MAINTENANCE_INVOKE_COMMANDS.has(command)
        ? undefined
        : currentInteractionId();
  const phase = classifyInvokePhase(command, interactionId);
  rememberRuntimeContext(nowMs(), {
    interactionId,
    kind: 'invoke.completed',
    module: invokeModule(command),
    owner: command,
    phase,
  });
  pushEvent({
    data: { command, status: 'ok', ...data },
    durationMs,
    interactionId,
    kind: 'invoke.completed',
    module: invokeModule(command),
    owner: command,
    phase,
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
    typeof data?.interactionId === 'string'
      ? data.interactionId
      : SYSTEM_INVOKE_COMMANDS.has(command) || BACKGROUND_MAINTENANCE_INVOKE_COMMANDS.has(command)
        ? undefined
        : currentInteractionId();
  const phase = classifyInvokePhase(command, interactionId);
  rememberRuntimeContext(nowMs(), {
    interactionId,
    kind: 'invoke.failed',
    module: invokeModule(command),
    owner: command,
    phase,
  });
  pushEvent({
    data: { command, status: 'failed', ...data },
    durationMs,
    interactionId,
    kind: 'invoke.failed',
    module: invokeModule(command),
    owner: command,
    phase,
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
  rememberRuntimeContext(nowMs(), {
    interactionId,
    kind: 'route.requested',
    module: pageId,
    owner: pageId,
    pageId,
    phase: interactionId ? 'interaction' : 'background',
  });
  visibleRouteKeys.delete(pageId);
  pushEvent({
    data: { pageId, ...data },
    interactionId,
    kind: 'route.requested',
    module: pageId,
    owner: pageId,
    pageId,
    phase: interactionId ? 'interaction' : 'background',
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
  rememberRuntimeContext(at, {
    interactionId,
    kind: 'route.visible',
    module: pageId,
    owner: pageId,
    pageId,
    phase: interactionId ? 'interaction' : 'background',
  });
  pushEvent({
    data: { pageId, ...data },
    durationMs: startedAt === undefined ? undefined : at - startedAt,
    interactionId,
    kind: 'route.visible',
    module: pageId,
    owner: pageId,
    pageId,
    phase: interactionId ? 'interaction' : 'background',
    source: 'shell',
  });
}

export function recordSurfaceRender(
  surfaceId: string,
  durationMs: number,
  data?: Record<string, unknown>,
): void {
  if (!isEnabled()) return;
  const interactionId = typeof data?.interactionId === 'string' ? data.interactionId : undefined;
  pushEvent({
    data: { surfaceId, ...data },
    durationMs,
    interactionId,
    kind: 'surface.render',
    module: surfaceId,
    owner: surfaceId,
    phase: interactionId ? 'interaction' : 'background',
    source: data?.sectionId ? 'section-host' : 'page-host',
  });
}

export function recordHiddenSurfaceRender(surfaceId: string, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  pushEvent({
    data: { surfaceId, ...data },
    interactionId: typeof data?.interactionId === 'string' ? data.interactionId : undefined,
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
