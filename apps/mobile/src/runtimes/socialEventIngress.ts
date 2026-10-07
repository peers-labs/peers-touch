/**
 * socialEventIngress.ts — W5 shared typed event ingress
 *
 * Routes Social / Moments / Notification / Profile events through a
 * single typed discriminated-union ingress with control/data capacity,
 * cursor tracking, and session revalidation on control-event loss.
 *
 * Failure closure:
 * - Data overflow marks affected projections stale and reconciles.
 * - Control-event loss closes write admission and revalidates the session.
 * - Module failure renders unavailable state, never fabricated empty data.
 */

// ---------------------------------------------------------------------------
// Domain event discriminated union
// ---------------------------------------------------------------------------

/** Social domain: contacts, presence, typing, and relationship state */
export interface SocialDataEvent {
  readonly domain: 'social';
  readonly kind:
    | 'friend-typing'
    | 'friend-presence'
    | 'friend-request'
    | 'relationship-changed';
  readonly sessionUlid?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly cursor: string;
  readonly timestampMs: number;
}

/** Moments domain: post lifecycle events */
export interface MomentsDataEvent {
  readonly domain: 'moments';
  readonly kind:
    | 'post-created'
    | 'post-reacted'
    | 'post-commented'
    | 'post-deleted';
  readonly postId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly cursor: string;
  readonly timestampMs: number;
}

/** Notification domain: platform notifications */
export interface NotificationDataEvent {
  readonly domain: 'notification';
  readonly kind:
    | 'notification-received'
    | 'notification-read'
    | 'notification-deleted'
    | 'unread-count-changed';
  readonly notificationId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly cursor: string;
  readonly timestampMs: number;
}

/** Profile domain: actor profile and account preference changes */
export interface ProfileDataEvent {
  readonly domain: 'profile';
  readonly kind:
    | 'profile-updated'
    | 'preference-changed'
    | 'avatar-changed'
    | 'relationship-changed';
  readonly actorPtid?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly cursor: string;
  readonly timestampMs: number;
}

/** Control events: session, connectivity, and resync signals */
export interface ControlEvent {
  readonly domain: 'control';
  readonly kind:
    | 'session-revalidate'
    | 'heartbeat'
    | 'host-wakeup'
    | 'stream-connected'
    | 'stream-disconnected'
    | 'messaging-wake'
    | 'resync-required'
    | 'cursor-repair';
  readonly payload: Readonly<Record<string, unknown>>;
  readonly cursor: string;
  readonly timestampMs: number;
}

export type SocialIngressEvent =
  | SocialDataEvent
  | MomentsDataEvent
  | NotificationDataEvent
  | ProfileDataEvent
  | ControlEvent;

export type SocialIngressDomain = SocialIngressEvent['domain'];

// ---------------------------------------------------------------------------
// Cursor state per domain
// ---------------------------------------------------------------------------

export interface DomainCursorState {
  readonly lastCursor: string;
  readonly lastTimestampMs: number;
  readonly gapDetected: boolean;
}

// ---------------------------------------------------------------------------
// Capacity configuration
// ---------------------------------------------------------------------------

/** Data-channel capacity limits per domain */
const DEFAULT_DATA_CAPACITY = 1024;

/** Control-channel capacity: smaller; control events are critical but few */
const DEFAULT_CONTROL_CAPACITY = 64;

export interface IngressCapacityConfig {
  readonly dataCapacity: number;
  readonly controlCapacity: number;
}

// ---------------------------------------------------------------------------
// Ingress state
// ---------------------------------------------------------------------------

export type ProjectionStaleness =
  | { readonly stale: false }
  | { readonly stale: true; readonly reason: string; readonly since: number };

export type WriteAdmission =
  | { readonly open: true }
  | { readonly open: false; readonly reason: string; readonly closedAt: number };

export interface IngressState {
  readonly cursors: Readonly<Record<SocialIngressDomain, DomainCursorState>>;
  readonly staleness: Readonly<Record<SocialIngressDomain, ProjectionStaleness>>;
  readonly writeAdmission: WriteAdmission;
  readonly streamCursor: string;
  readonly lifecycle: 'active' | 'suspended' | 'torn';
  readonly dataQueueDepth: number;
  readonly controlQueueDepth: number;
  readonly consecutiveControlLosses: number;
}

// ---------------------------------------------------------------------------
// Ingress event handler type
// ---------------------------------------------------------------------------

export type IngressEventHandler = (event: SocialIngressEvent) => void | Promise<void>;
export type IngressStalenessHandler = (domain: SocialIngressDomain, staleness: ProjectionStaleness) => void;
export type IngressAdmissionHandler = (admission: WriteAdmission) => void;

export interface IngressReconcileRequest {
  readonly domains: readonly SocialIngressDomain[];
  readonly reason: string;
  readonly checkpointCursor: string;
}

export type IngressReconcileHandler = (request: IngressReconcileRequest) => void;

export interface IngressHandlers {
  readonly onEvent: IngressEventHandler;
  readonly onStaleness?: IngressStalenessHandler;
  readonly onAdmissionChange?: IngressAdmissionHandler;
  readonly onReconcileRequired?: IngressReconcileHandler;
  readonly onSessionRevalidationRequired?: (reason: string) => void;
  readonly onHandlerError?: (event: SocialIngressEvent, error: unknown) => void;
}

// ---------------------------------------------------------------------------
// Ingress controller
// ---------------------------------------------------------------------------

export interface SocialEventIngressController {
  /** Enqueue a data event. Returns false if capacity exceeded (overflow). */
  ingestDataEvent: (event: Exclude<SocialIngressEvent, ControlEvent>) => boolean;

  /** Enqueue a control event. Triggers session revalidation on loss. */
  ingestControlEvent: (event: ControlEvent) => boolean;

  /** Current ingress state snapshot */
  state: () => IngressState;

  /** Repair cursors after reconnect: set domain cursor to the given value */
  repairCursor: (domain: SocialIngressDomain, cursor: string) => void;

  /** Mark one projection stale and enqueue authoritative reconciliation. */
  markStale: (
    domain: SocialIngressDomain,
    reason: string,
    checkpointCursor?: string,
    requestReconcile?: boolean,
  ) => void;

  /** Reopen write admission after successful session revalidation */
  reopenAdmission: () => void;

  /** Pause data delivery and close writes until resume reconciliation succeeds. */
  suspend: () => void;

  /** Resume event delivery and request authoritative projection reconciliation. */
  resume: () => void;

  /** Wait until every accepted event has finished routing. */
  drain: () => Promise<void>;

  /** Teardown: reject new events and clear queued work. */
  teardown: () => void;
}

const ALL_DOMAINS: readonly SocialIngressDomain[] = [
  'social',
  'moments',
  'notification',
  'profile',
  'control',
];

const DATA_DOMAINS = ALL_DOMAINS.filter(
  (domain): domain is Exclude<SocialIngressDomain, 'control'> => domain !== 'control',
);

function emptyDomainCursor(): DomainCursorState {
  return { lastCursor: '', lastTimestampMs: 0, gapDetected: false };
}

function emptyDomainStaleness(): ProjectionStaleness {
  return { stale: false };
}

function initialCursors(): Record<SocialIngressDomain, DomainCursorState> {
  const cursors: Partial<Record<SocialIngressDomain, DomainCursorState>> = {};
  ALL_DOMAINS.forEach((domain) => {
    cursors[domain] = emptyDomainCursor();
  });
  return cursors as Record<SocialIngressDomain, DomainCursorState>;
}

function initialStaleness(): Record<SocialIngressDomain, ProjectionStaleness> {
  const staleness: Partial<Record<SocialIngressDomain, ProjectionStaleness>> = {};
  ALL_DOMAINS.forEach((domain) => {
    staleness[domain] = emptyDomainStaleness();
  });
  return staleness as Record<SocialIngressDomain, ProjectionStaleness>;
}

/**
 * Creates the shared event ingress for all social-layer domains.
 *
 * The ingress enforces capacity limits, preserves opaque Station cursors,
 * reacts to explicit resync signals, and triggers session revalidation when
 * control events are lost.
 */
export function createSocialEventIngress(
  handlers: IngressHandlers,
  config?: Partial<IngressCapacityConfig>,
): SocialEventIngressController {
  const dataCapacity = config?.dataCapacity ?? DEFAULT_DATA_CAPACITY;
  const controlCapacity = config?.controlCapacity ?? DEFAULT_CONTROL_CAPACITY;

  if (
    !Number.isSafeInteger(dataCapacity)
    || dataCapacity <= 0
    || !Number.isSafeInteger(controlCapacity)
    || controlCapacity <= 0
  ) {
    throw new Error('mobile.social.invalidIngressCapacity');
  }

  const dataQueue: Array<Exclude<SocialIngressEvent, ControlEvent>> = [];
  const controlQueue: ControlEvent[] = [];
  const seenEventKeys = new Set<string>();
  const seenEventKeyOrder: string[] = [];
  const pendingEventKeys = new Set<string>();
  const seenCursorCapacity = dataCapacity + controlCapacity;
  let consecutiveControlLosses = 0;
  let writeAdmission: WriteAdmission = { open: true };
  let streamCursor = '';
  let lifecycle: IngressState['lifecycle'] = 'active';
  const cursors = initialCursors();
  const staleness = initialStaleness();
  let processing: Promise<void> | null = null;

  function updateCursor(domain: SocialIngressDomain, cursor: string, timestampMs: number): void {
    if (!cursor) return;
    cursors[domain] = { lastCursor: cursor, lastTimestampMs: timestampMs, gapDetected: false };
    streamCursor = cursor;
    const eventKey = `${domain}\u001f${cursor}`;
    seenEventKeys.add(eventKey);
    seenEventKeyOrder.push(eventKey);
    while (seenEventKeyOrder.length > seenCursorCapacity) {
      const oldest = seenEventKeyOrder.shift();
      if (oldest) seenEventKeys.delete(oldest);
    }
  }

  function requestReconcile(
    domains: readonly SocialIngressDomain[],
    reason: string,
    checkpointCursor: string,
  ): void {
    handlers.onReconcileRequired?.({
      domains: [...new Set(domains)],
      reason,
      checkpointCursor,
    });
  }

  function markStale(
    domain: SocialIngressDomain,
    reason: string,
    checkpointCursor = streamCursor,
    request = true,
  ): void {
    const now = Date.now();
    const currentCursor = cursors[domain];
    cursors[domain] = { ...currentCursor, gapDetected: true };
    staleness[domain] = { stale: true, reason, since: now };
    handlers.onStaleness?.(domain, staleness[domain]);
    if (request) requestReconcile([domain], reason, checkpointCursor);
  }

  function clearStaleness(domain: SocialIngressDomain): void {
    if (staleness[domain].stale) {
      staleness[domain] = { stale: false };
      handlers.onStaleness?.(domain, staleness[domain]);
    }
  }

  function closeWriteAdmission(reason: string): void {
    if (!writeAdmission.open) return;
    writeAdmission = { open: false, reason, closedAt: Date.now() };
    handlers.onAdmissionChange?.(writeAdmission);
  }

  function enqueueDrain(): void {
    if (processing || lifecycle === 'torn') return;
    processing = Promise.resolve()
      .then(processQueues)
      .finally(() => {
        processing = null;
        if (
          lifecycle !== 'torn'
          && (controlQueue.length > 0 || dataQueue.length > 0)
        ) {
          enqueueDrain();
        }
      });
  }

  async function processQueues(): Promise<void> {
    while (lifecycle !== 'torn') {
      const event = controlQueue.shift() ?? dataQueue.shift();
      if (!event) return;
      const key = eventKey(event);
      try {
        await handlers.onEvent(event);
        updateCursor(event.domain, event.cursor, event.timestampMs);
        if (event.domain === 'control') {
          consecutiveControlLosses = 0;
        }
      } catch (error) {
        handlers.onHandlerError?.(event, error);
        if (event.domain === 'control') {
          closeWriteAdmission('control_event_handler_failed');
          handlers.onSessionRevalidationRequired?.('control_event_handler_failed');
          requestReconcile(DATA_DOMAINS, 'control_event_handler_failed', event.cursor);
        } else {
          markStale(event.domain, 'event_handler_failed', event.cursor);
        }
      } finally {
        if (key) pendingEventKeys.delete(key);
      }
    }
  }

  function ingestDataEvent(event: Exclude<SocialIngressEvent, ControlEvent>): boolean {
    if (lifecycle !== 'active') return false;
    const key = eventKey(event);
    if (key && (seenEventKeys.has(key) || pendingEventKeys.has(key))) return true;

    if (dataQueue.length >= dataCapacity) {
      markStale(event.domain, 'data_capacity_overflow', event.cursor);
      return false;
    }

    dataQueue.push(event);
    if (key) pendingEventKeys.add(key);
    enqueueDrain();
    return true;
  }

  function ingestControlEvent(event: ControlEvent): boolean {
    if (lifecycle === 'torn') return false;
    const key = eventKey(event);
    if (key && (seenEventKeys.has(key) || pendingEventKeys.has(key))) return true;

    if (controlQueue.length >= controlCapacity) {
      consecutiveControlLosses += 1;
      closeWriteAdmission('control_event_lost');
      handlers.onSessionRevalidationRequired?.('control_event_lost');
      requestReconcile(DATA_DOMAINS, 'control_event_lost', event.cursor);
      return false;
    }

    if (event.kind === 'resync-required' || event.kind === 'cursor-repair') {
      DATA_DOMAINS.forEach((domain) => {
        markStale(domain, event.kind, event.cursor, false);
      });
      closeWriteAdmission(event.kind);
      requestReconcile(DATA_DOMAINS, event.kind, event.cursor);
    }

    controlQueue.push(event);
    if (key) pendingEventKeys.add(key);
    enqueueDrain();
    return true;
  }

  function state(): IngressState {
    return {
      cursors: { ...cursors },
      staleness: { ...staleness },
      writeAdmission,
      streamCursor,
      lifecycle,
      dataQueueDepth: dataQueue.length,
      controlQueueDepth: controlQueue.length,
      consecutiveControlLosses,
    };
  }

  function repairCursor(domain: SocialIngressDomain, cursor: string): void {
    if (lifecycle === 'torn') return;
    const repairedCursor = cursor || cursors[domain].lastCursor;
    cursors[domain] = {
      lastCursor: repairedCursor,
      lastTimestampMs: Date.now(),
      gapDetected: false,
    };
    if (repairedCursor) streamCursor = repairedCursor;
    clearStaleness(domain);
  }

  function reopenAdmission(): void {
    if (
      lifecycle !== 'active'
      || DATA_DOMAINS.some((domain) => staleness[domain].stale)
    ) return;
    consecutiveControlLosses = 0;
    writeAdmission = { open: true };
    handlers.onAdmissionChange?.(writeAdmission);
  }

  function suspend(): void {
    if (lifecycle !== 'active') return;
    lifecycle = 'suspended';
    closeWriteAdmission('runtime_suspended');
    DATA_DOMAINS.forEach((domain) => {
      markStale(domain, 'runtime_suspended', streamCursor, false);
    });
  }

  function resume(): void {
    if (lifecycle !== 'suspended') return;
    lifecycle = 'active';
    requestReconcile(DATA_DOMAINS, 'runtime_resume', streamCursor);
  }

  async function drain(): Promise<void> {
    while (processing) await processing;
  }

  function teardown(): void {
    lifecycle = 'torn';
    dataQueue.length = 0;
    controlQueue.length = 0;
    seenEventKeys.clear();
    seenEventKeyOrder.length = 0;
    pendingEventKeys.clear();
  }

  return {
    ingestDataEvent,
    ingestControlEvent,
    state,
    repairCursor,
    markStale,
    reopenAdmission,
    suspend,
    resume,
    drain,
    teardown,
  };
}

function eventKey(event: SocialIngressEvent): string {
  return event.cursor ? `${event.domain}\u001f${event.cursor}` : '';
}
