export const FRONTEND_TELEMETRY_SCHEMA_VERSION = 1;

export type FrontendTelemetrySource =
  | 'shell'
  | 'page-host'
  | 'section-host'
  | 'overlay'
  | 'store'
  | 'invoke'
  | 'runtime'
  | 'applet'
  | 'input'
  | 'acceptance';

export type FrontendTelemetryRuntime =
  | 'browser-gateway'
  | 'tauri-webview-dev'
  | 'tauri-webview-packaged'
  | 'unknown';

export type FrontendTelemetryPhase = 'startup' | 'interaction' | 'background' | 'acceptance';
export type FrontendTelemetrySeverity = 'debug' | 'info' | 'warn' | 'error';

export type FrontendTelemetryEventKind =
  | 'boot.phase'
  | 'route.requested'
  | 'route.visible'
  | 'surface.render'
  | 'surface.hidden.render'
  | 'react.commit'
  | 'store.update'
  | 'runtime.install'
  | 'runtime.bootstrap'
  | 'runtime.page-acquire'
  | 'runtime.page-release'
  | 'interaction.started'
  | 'input.intent'
  | 'input.visible'
  | 'contextmenu.intent'
  | 'overlay.visible'
  | 'overlay.hidden'
  | 'invoke.started'
  | 'invoke.completed'
  | 'invoke.failed'
  | 'longtask.detected'
  | 'layout.shift'
  | 'paint.timing'
  | 'telemetry.queue.drop';

export interface DesktopFrontendTelemetryEvent {
  id: string;
  schemaVersion: number;
  ts: number;
  kind: FrontendTelemetryEventKind;
  source: FrontendTelemetrySource;
  module: string;
  runtime: FrontendTelemetryRuntime;
  actorPtid?: string;
  deviceId?: string;
  sessionId?: string;
  owner?: string;
  pageId?: string;
  sectionId?: string;
  interactionId?: string;
  phase?: FrontendTelemetryPhase;
  severity?: FrontendTelemetrySeverity;
  durationMs?: number;
  tags?: Record<string, string | number | boolean>;
  data?: Record<string, unknown>;
}

export type DesktopFrontendTelemetryInput = Omit<
  DesktopFrontendTelemetryEvent,
  'id' | 'schemaVersion' | 'ts' | 'runtime'
> & {
  runtime?: FrontendTelemetryRuntime;
  ts?: number;
};

export interface FrontendTelemetryInspector {
  readonly events: ReadonlyArray<DesktopFrontendTelemetryEvent>;
  clear(): void;
  flush(): Promise<FrontendTelemetryUploadResult | null>;
  getDroppedCount(): number;
  getEvents(): ReadonlyArray<DesktopFrontendTelemetryEvent>;
  snapshot(): FrontendTelemetrySnapshot;
}

export interface FrontendTelemetryUploadResult {
  accepted: number;
  rejected: number;
  failed: number;
  uploaded: boolean;
}

export type FrontendTelemetryUploader = (
  events: DesktopFrontendTelemetryEvent[],
) => Promise<FrontendTelemetryUploadResult>;

export interface FrontendTelemetrySnapshot {
  byKind: Record<string, number>;
  droppedByKind: Record<string, number>;
  droppedCount: number;
  droppedWithInteraction: Record<string, number>;
  eventCount: number;
  events: DesktopFrontendTelemetryEvent[];
  maxEvents: number;
  readyState: string;
  runtime: FrontendTelemetryRuntime;
  source: 'window.__PT_FRONTEND_TELEMETRY__';
  url: string;
  withInteraction: Record<string, number>;
}

type FrontendTelemetryQueueOptions = {
  maxEvents?: number;
  runtime?: FrontendTelemetryRuntime;
  uploader?: FrontendTelemetryUploader;
};

const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_FLUSH_DELAY_MS = 10_000;
const SENSITIVE_KEY_PATTERN = /password|passwd|pwd|token|secret|private.?key|message|body|content/i;
const events: DesktopFrontendTelemetryEvent[] = [];
const pendingUploadEvents: DesktopFrontendTelemetryEvent[] = [];
const droppedByKind: Record<string, number> = {};
const droppedWithInteraction: Record<string, number> = {};

let installed = false;
let maxEvents = DEFAULT_MAX_EVENTS;
let droppedCount = 0;
let flushInFlight = false;
let sequence = 0;
let runtimeOverride: FrontendTelemetryRuntime | undefined;
let uploader: FrontendTelemetryUploader | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const clearHooks = new Set<() => void>();

declare global {
  interface Window {
    __PT_FRONTEND_RUNTIME_EVENTS__?: ReadonlyArray<DesktopFrontendTelemetryEvent>;
    __PT_FRONTEND_TELEMETRY__?: FrontendTelemetryInspector;
  }
}

function nowMs(): number {
  if (
    typeof performance !== 'undefined' &&
    typeof performance.timeOrigin === 'number' &&
    typeof performance.now === 'function'
  ) {
    return performance.timeOrigin + performance.now();
  }
  return Date.now();
}

function createEventId(): string {
  sequence += 1;
  return `${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function resolveRuntime(): FrontendTelemetryRuntime {
  if (runtimeOverride) return runtimeOverride;
  if (typeof window === 'undefined') return 'unknown';
  if ('__TAURI_INTERNALS__' in window && !('__PT_GATEWAY_BASE__' in window)) {
    return import.meta.env.PROD ? 'tauri-webview-packaged' : 'tauri-webview-dev';
  }
  if ('__PT_GATEWAY_BASE__' in window) return 'browser-gateway';
  return 'unknown';
}

function incrementCounter(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return { name: value.name };
  if (typeof value !== 'object') return value;
  if (depth >= 2) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeValue(nested, depth + 1);
  }
  return output;
}

function sanitizeData(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  return sanitizeValue(data, 0) as Record<string, unknown>;
}

function sanitizeTags(
  tags: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!tags) return undefined;
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(tags)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : value;
  }
  return output;
}

function exposeInspector(): void {
  if (typeof window === 'undefined') return;
  window.__PT_FRONTEND_RUNTIME_EVENTS__ = events;
  window.__PT_FRONTEND_TELEMETRY__ = {
    events,
    clear: clearFrontendTelemetryEvents,
    flush: flushFrontendTelemetryEvents,
    getDroppedCount: () => droppedCount,
    getEvents: () => events,
    snapshot: snapshotFrontendTelemetry,
  };
}

export function installFrontendTelemetryQueue(options: FrontendTelemetryQueueOptions = {}): void {
  if (typeof window === 'undefined') return;
  maxEvents = Math.max(1, options.maxEvents ?? DEFAULT_MAX_EVENTS);
  runtimeOverride = options.runtime;
  uploader = options.uploader;
  installed = true;
  exposeInspector();
}

export function configureFrontendTelemetryUploader(nextUploader: FrontendTelemetryUploader): void {
  uploader = nextUploader;
  scheduleFrontendTelemetryFlush();
}

export function teardownFrontendTelemetryQueue(): void {
  installed = false;
  runtimeOverride = undefined;
  uploader = undefined;
  flushInFlight = false;
  clearScheduledFrontendTelemetryFlush();
  clearFrontendTelemetryEvents();
  if (typeof window === 'undefined') return;
  window.__PT_FRONTEND_RUNTIME_EVENTS__ = undefined;
  window.__PT_FRONTEND_TELEMETRY__ = undefined;
}

export function clearFrontendTelemetryEvents(): void {
  events.length = 0;
  pendingUploadEvents.length = 0;
  droppedCount = 0;
  for (const key of Object.keys(droppedByKind)) delete droppedByKind[key];
  for (const key of Object.keys(droppedWithInteraction)) delete droppedWithInteraction[key];
  for (const hook of clearHooks) {
    try { hook(); } catch { /* clear hooks must not throw */ }
  }
}

export function registerFrontendTelemetryClearHook(hook: () => void): () => void {
  clearHooks.add(hook);
  return () => { clearHooks.delete(hook); };
}

export function emitFrontendTelemetryEvent(
  input: DesktopFrontendTelemetryInput,
): DesktopFrontendTelemetryEvent | null {
  if (!installed) return null;

  const event: DesktopFrontendTelemetryEvent = {
    ...input,
    id: createEventId(),
    schemaVersion: FRONTEND_TELEMETRY_SCHEMA_VERSION,
    ts: input.ts ?? nowMs(),
    runtime: input.runtime ?? resolveRuntime(),
    data: sanitizeData(input.data),
    tags: sanitizeTags(input.tags),
  };

  events.push(event);
  pendingUploadEvents.push(event);
  if (events.length > maxEvents) {
    const removed = events.length - maxEvents;
    const dropped = events.splice(0, removed);
    droppedCount += removed;
    for (const item of dropped) {
      incrementCounter(droppedByKind, item.kind);
      if (item.interactionId) incrementCounter(droppedWithInteraction, item.kind);
    }
  }
  if (pendingUploadEvents.length > maxEvents) {
    pendingUploadEvents.splice(0, pendingUploadEvents.length - maxEvents);
  }
  scheduleFrontendTelemetryFlush();
  return event;
}

export function snapshotFrontendTelemetry(): FrontendTelemetrySnapshot {
  const byKind: Record<string, number> = {};
  const withInteraction: Record<string, number> = {};
  for (const event of events) {
    incrementCounter(byKind, event.kind);
    if (event.interactionId) incrementCounter(withInteraction, event.kind);
  }
  return {
    byKind,
    droppedByKind: { ...droppedByKind },
    droppedCount,
    droppedWithInteraction: { ...droppedWithInteraction },
    eventCount: events.length,
    events: events.slice(),
    maxEvents,
    readyState: typeof document === 'undefined' ? 'unknown' : document.readyState,
    runtime: resolveRuntime(),
    source: 'window.__PT_FRONTEND_TELEMETRY__',
    url: typeof window === 'undefined' ? '' : window.location.href,
    withInteraction,
  };
}

export function getFrontendTelemetryEvents(): ReadonlyArray<DesktopFrontendTelemetryEvent> {
  return events;
}

export function getFrontendTelemetryDroppedCount(): number {
  return droppedCount;
}

export async function flushFrontendTelemetryEvents(): Promise<FrontendTelemetryUploadResult | null> {
  if (!installed || flushInFlight || pendingUploadEvents.length === 0 || !uploader) return null;
  clearScheduledFrontendTelemetryFlush();
  flushInFlight = true;
  const batch = pendingUploadEvents.slice();
  try {
    const result = await uploader(batch);
    if (result.uploaded) {
      pendingUploadEvents.splice(0, Math.min(result.accepted, pendingUploadEvents.length));
    }
    return result;
  } finally {
    flushInFlight = false;
    scheduleFrontendTelemetryFlush();
  }
}

function scheduleFrontendTelemetryFlush(): void {
  if (!installed || !uploader || pendingUploadEvents.length === 0 || flushInFlight || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushFrontendTelemetryEvents().catch(() => {
      // Upload failures keep the queued events; flush() schedules the retry after the attempt settles.
    });
  }, DEFAULT_FLUSH_DELAY_MS);
}

function clearScheduledFrontendTelemetryFlush(): void {
  if (!flushTimer) return;
  clearTimeout(flushTimer);
  flushTimer = undefined;
}

export function _resetFrontendTelemetryForTests(): void {
  teardownFrontendTelemetryQueue();
  maxEvents = DEFAULT_MAX_EVENTS;
  sequence = 0;
}
