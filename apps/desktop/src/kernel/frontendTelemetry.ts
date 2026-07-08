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
  | 'acceptance';

export type FrontendTelemetryRuntime =
  | 'browser-gateway'
  | 'tauri-webview'
  | 'prod-preview'
  | 'offline-fixture'
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
  actorId?: string;
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

type FrontendTelemetryQueueOptions = {
  maxEvents?: number;
  runtime?: FrontendTelemetryRuntime;
  uploader?: FrontendTelemetryUploader;
};

const DEFAULT_MAX_EVENTS = 500;
const DEFAULT_FLUSH_DELAY_MS = 2_000;
const SENSITIVE_KEY_PATTERN = /password|passwd|pwd|token|secret|private.?key|message|body|content/i;
const events: DesktopFrontendTelemetryEvent[] = [];

let installed = false;
let maxEvents = DEFAULT_MAX_EVENTS;
let droppedCount = 0;
let flushInFlight = false;
let sequence = 0;
let runtimeOverride: FrontendTelemetryRuntime | undefined;
let uploader: FrontendTelemetryUploader | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

declare global {
  interface Window {
    __PT_FRONTEND_RUNTIME_EVENTS__?: ReadonlyArray<DesktopFrontendTelemetryEvent>;
    __PT_FRONTEND_TELEMETRY__?: FrontendTelemetryInspector;
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createEventId(): string {
  sequence += 1;
  return `${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function resolveRuntime(): FrontendTelemetryRuntime {
  if (runtimeOverride) return runtimeOverride;
  if (typeof window === 'undefined') return 'unknown';
  if ('__TAURI_INTERNALS__' in window && !('__PT_GATEWAY_BASE__' in window)) return 'tauri-webview';
  if ('__PT_GATEWAY_BASE__' in window) return 'browser-gateway';
  if (import.meta.env.PROD) return 'prod-preview';
  return 'unknown';
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
  droppedCount = 0;
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
  if (events.length > maxEvents) {
    const removed = events.length - maxEvents;
    events.splice(0, removed);
    droppedCount += removed;
  }
  scheduleFrontendTelemetryFlush();
  return event;
}

export function getFrontendTelemetryEvents(): ReadonlyArray<DesktopFrontendTelemetryEvent> {
  return events;
}

export function getFrontendTelemetryDroppedCount(): number {
  return droppedCount;
}

export async function flushFrontendTelemetryEvents(): Promise<FrontendTelemetryUploadResult | null> {
  if (!installed || flushInFlight || events.length === 0 || !uploader) return null;
  clearScheduledFrontendTelemetryFlush();
  flushInFlight = true;
  const batch = events.slice();
  try {
    const result = await uploader(batch);
    if (result.uploaded) {
      events.splice(0, Math.min(result.accepted, events.length));
    }
    return result;
  } finally {
    flushInFlight = false;
    scheduleFrontendTelemetryFlush();
  }
}

function scheduleFrontendTelemetryFlush(): void {
  if (!installed || !uploader || events.length === 0 || flushInFlight || flushTimer) return;
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
