/**
 * socialEventIngress.ts — W5 shared typed event ingress
 *
 * Routes Social / Group / Moments / Notification / Profile events through a
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

/** Social domain: friend chat, contacts, presence, typing */
export interface SocialDataEvent {
  readonly domain: 'social';
  readonly kind:
    | 'friend-message'
    | 'friend-receipt'
    | 'friend-mutation'
    | 'friend-typing'
    | 'friend-presence'
    | 'friend-request'
    | 'session-update'
    | 'friend-settings-changed';
  readonly sessionUlid?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly cursor: string;
  readonly timestampMs: number;
}

/** Group domain: group messages, membership, settings */
export interface GroupDataEvent {
  readonly domain: 'group';
  readonly kind:
    | 'group-message'
    | 'group-membership'
    | 'group-mutation'
    | 'group-settings-changed';
  readonly groupUlid?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly cursor: string;
  readonly timestampMs: number;
}

/** Moments domain: post lifecycle events */
export interface MomentsDataEvent {
  readonly domain: 'moments';
  readonly kind:
    | 'post-created'
    | 'post-liked'
    | 'post-commented'
    | 'post-reposted'
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
    | 'stream-connected'
    | 'stream-disconnected'
    | 'resync-required'
    | 'cursor-repair';
  readonly payload: Readonly<Record<string, unknown>>;
  readonly cursor: string;
  readonly timestampMs: number;
}

export type SocialIngressEvent =
  | SocialDataEvent
  | GroupDataEvent
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
const DEFAULT_DATA_CAPACITY = 500;

/** Control-channel capacity: smaller; control events are critical but few */
const DEFAULT_CONTROL_CAPACITY = 50;

/** Maximum consecutive control-event losses before session revalidation */
const CONTROL_LOSS_THRESHOLD = 3;

export interface IngressCapacityConfig {
  readonly dataCapacity: number;
  readonly controlCapacity: number;
  readonly controlLossThreshold: number;
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
  readonly dataQueueDepth: number;
  readonly controlQueueDepth: number;
  readonly consecutiveControlLosses: number;
}

// ---------------------------------------------------------------------------
// Ingress event handler type
// ---------------------------------------------------------------------------

export type IngressEventHandler = (event: SocialIngressEvent) => void;
export type IngressStalenessHandler = (domain: SocialIngressDomain, staleness: ProjectionStaleness) => void;
export type IngressAdmissionHandler = (admission: WriteAdmission) => void;
export type IngressReconcileHandler = (domains: readonly SocialIngressDomain[]) => void;

export interface IngressHandlers {
  readonly onEvent: IngressEventHandler;
  readonly onStaleness?: IngressStalenessHandler;
  readonly onAdmissionChange?: IngressAdmissionHandler;
  readonly onReconcileRequired?: IngressReconcileHandler;
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

  /** Reopen write admission after successful session revalidation */
  reopenAdmission: () => void;

  /** Teardown: clear all queues and timers */
  teardown: () => void;
}

const ALL_DOMAINS: readonly SocialIngressDomain[] = [
  'social',
  'group',
  'moments',
  'notification',
  'profile',
  'control',
];

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
 * The ingress enforces capacity limits, detects cursor gaps, and triggers
 * session revalidation when control events are lost.
 */
export function createSocialEventIngress(
  handlers: IngressHandlers,
  config?: Partial<IngressCapacityConfig>,
): SocialEventIngressController {
  const dataCapacity = config?.dataCapacity ?? DEFAULT_DATA_CAPACITY;
  const controlCapacity = config?.controlCapacity ?? DEFAULT_CONTROL_CAPACITY;
  const controlLossThreshold = config?.controlLossThreshold ?? CONTROL_LOSS_THRESHOLD;

  let dataQueueDepth = 0;
  let controlQueueDepth = 0;
  let consecutiveControlLosses = 0;
  let writeAdmission: WriteAdmission = { open: true };
  const cursors = initialCursors();
  const staleness = initialStaleness();
  let torn = false;

  function updateCursor(domain: SocialIngressDomain, cursor: string, timestampMs: number): void {
    const current = cursors[domain];
    // Detect cursor gap: if the new cursor is not contiguous with the last
    // (simple heuristic: timestamp regression or explicit gap marker)
    const gapDetected = current.lastCursor !== '' && timestampMs < current.lastTimestampMs;
    cursors[domain] = { lastCursor: cursor, lastTimestampMs: timestampMs, gapDetected };

    if (gapDetected) {
      markStale(domain, 'cursor_gap_detected');
    }
  }

  function markStale(domain: SocialIngressDomain, reason: string): void {
    const now = Date.now();
    staleness[domain] = { stale: true, reason, since: now };
    handlers.onStaleness?.(domain, staleness[domain]);
    handlers.onReconcileRequired?.([domain]);
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

  function ingestDataEvent(event: Exclude<SocialIngressEvent, ControlEvent>): boolean {
    if (torn) return false;

    if (dataQueueDepth >= dataCapacity) {
      // Data overflow: mark the affected domain stale and request reconcile
      markStale(event.domain, 'data_capacity_overflow');
      return false;
    }

    if (!writeAdmission.open) {
      // Write admission closed: do not accept new data events
      return false;
    }

    dataQueueDepth += 1;
    updateCursor(event.domain, event.cursor, event.timestampMs);
    handlers.onEvent(event);
    // After successful delivery, decrement depth (synchronous handler model)
    dataQueueDepth = Math.max(0, dataQueueDepth - 1);
    return true;
  }

  function ingestControlEvent(event: ControlEvent): boolean {
    if (torn) return false;

    if (controlQueueDepth >= controlCapacity) {
      consecutiveControlLosses += 1;
      if (consecutiveControlLosses >= controlLossThreshold) {
        // Control-event loss threshold reached: close write admission
        closeWriteAdmission('control_event_loss_threshold');
        handlers.onEvent({
          domain: 'control',
          kind: 'session-revalidate',
          payload: { reason: 'control_event_loss', lossCount: consecutiveControlLosses },
          cursor: event.cursor,
          timestampMs: Date.now(),
        });
      }
      return false;
    }

    // Successful control event resets loss counter
    consecutiveControlLosses = 0;
    controlQueueDepth += 1;
    updateCursor('control', event.cursor, event.timestampMs);
    handlers.onEvent(event);
    controlQueueDepth = Math.max(0, controlQueueDepth - 1);
    return true;
  }

  function state(): IngressState {
    return {
      cursors: { ...cursors },
      staleness: { ...staleness },
      writeAdmission,
      dataQueueDepth,
      controlQueueDepth,
      consecutiveControlLosses,
    };
  }

  function repairCursor(domain: SocialIngressDomain, cursor: string): void {
    if (torn) return;
    cursors[domain] = { lastCursor: cursor, lastTimestampMs: Date.now(), gapDetected: false };
    clearStaleness(domain);
  }

  function reopenAdmission(): void {
    if (torn) return;
    consecutiveControlLosses = 0;
    writeAdmission = { open: true };
    handlers.onAdmissionChange?.(writeAdmission);
  }

  function teardown(): void {
    torn = true;
    dataQueueDepth = 0;
    controlQueueDepth = 0;
  }

  return {
    ingestDataEvent,
    ingestControlEvent,
    state,
    repairCursor,
    reopenAdmission,
    teardown,
  };
}
