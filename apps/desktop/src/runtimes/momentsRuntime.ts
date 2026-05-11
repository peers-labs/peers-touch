// Moments runtime — long-lived owner for the Moments projection.
//
// Phase 1 keeps the existing `useMomentsStore` APIs as the write surface
// and moves first-screen freshness out of pages. Later phases will replace
// polling reconcile with Station projection events + cursor sync.

import { useDiscoveryStore } from '../store/discovery';
import { useMomentsStore } from '../store/moments';
import { useRelationshipsStore } from '../store/relationships';
import { useSessionStore } from '../store/session';
import { EVENT, eventBus } from '../kernel/events';
import type { RuntimeDescriptor } from '../kernel/runtime';
import type {
  MomentCommentedPayload,
  MomentCreatedPayload,
  MomentDeletedPayload,
  MomentReactedPayload,
  MomentResyncRequestedPayload,
  RealtimeResyncPayload,
} from '../kernel/events/types';
import { log } from '../utils/logger';

const MOMENTS_RECONCILE_INTERVAL_MS = 45_000;

let teardownRuntime: (() => void) | null = null;
let reconcileTimer: number | null = null;
let bootstrappedActorId: string | null = null;
let bootstrapSequence = 0;
let refreshInFlight: Promise<void> | null = null;
const seenMomentEventIds = new Set<string>();

function runDetached(label: string, task: () => Promise<void>): void {
  void task().catch((error) => {
    log.warn('momentsRuntime', `${label} failed`, error);
  });
}

function rememberMomentEvent(eventId: string): boolean {
  if (!eventId) return true;
  if (seenMomentEventIds.has(eventId)) return false;
  seenMomentEventIds.add(eventId);
  if (seenMomentEventIds.size > 500) {
    const first = seenMomentEventIds.values().next().value;
    if (first) seenMomentEventIds.delete(first);
  }
  return true;
}

async function preloadCircleMembers(): Promise<void> {
  const store = useMomentsStore.getState();
  const tasks = store.circles
    .map((circle) => String(circle.id ?? ''))
    .filter((circleId) => circleId && !store.circleMembers[circleId])
    .map((circleId) => store.loadCircleMembers(circleId));

  await Promise.allSettled(tasks);
}

async function refreshMomentsProjection(label: string): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    log.info('momentsRuntime', 'moments projection refresh started', { label });

    const moments = useMomentsStore.getState();
    const discovery = useDiscoveryStore.getState();
    await Promise.allSettled([
      discovery.loadMe(),
      moments.syncProjection(label),
      moments.listMyCircles(),
    ]);
    await preloadCircleMembers();

    log.info('momentsRuntime', 'moments projection refresh completed', { label });
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function ensureMomentDetailProjection(postId: string): Promise<void> {
  const trimmedPostId = postId.trim();
  if (!trimmedPostId) return;

  const moments = useMomentsStore.getState();
  log.info('momentsRuntime', 'moment detail projection refresh started', { postId: trimmedPostId });
  await Promise.allSettled([
    moments.loadPost(trimmedPostId),
    moments.loadComments(trimmedPostId, true),
  ]);
  log.info('momentsRuntime', 'moment detail projection refresh completed', { postId: trimmedPostId });
}

export async function ensureUserMomentsProjection(actorId: string): Promise<void> {
  const trimmedActorId = actorId.trim();
  if (!trimmedActorId) return;

  const moments = useMomentsStore.getState();
  const relationships = useRelationshipsStore.getState();
  log.info('momentsRuntime', 'user moments projection refresh started', { actorId: trimmedActorId });
  await Promise.allSettled([
    moments.loadUserFeed(trimmedActorId, true),
    relationships.loadFollowers(trimmedActorId, true),
    relationships.loadFollowing(trimmedActorId, true),
  ]);
  log.info('momentsRuntime', 'user moments projection refresh completed', { actorId: trimmedActorId });
}

function onMomentCreated(payload: MomentCreatedPayload): void {
  if (!bootstrappedActorId) return;
  if (!rememberMomentEvent(payload.eventId)) return;
  runDetached('moment created projection refresh', async () => {
    await ensureMomentDetailProjection(payload.postId);
    await refreshMomentsProjection('event:moment.created');
  });
}

function onMomentDeleted(payload: MomentDeletedPayload): void {
  if (!bootstrappedActorId) return;
  if (!rememberMomentEvent(payload.eventId)) return;
  runDetached('moment deleted projection refresh', async () => {
    await refreshMomentsProjection('event:moment.deleted');
  });
}

function onMomentCommented(payload: MomentCommentedPayload): void {
  if (!bootstrappedActorId) return;
  if (!rememberMomentEvent(payload.eventId)) return;
  runDetached('moment commented projection refresh', async () => {
    await ensureMomentDetailProjection(payload.postId);
  });
}

function onMomentReacted(payload: MomentReactedPayload): void {
  if (!bootstrappedActorId) return;
  if (!rememberMomentEvent(payload.eventId)) return;
  runDetached('moment reacted projection refresh', async () => {
    await ensureMomentDetailProjection(payload.postId);
  });
}

function onMomentResyncRequested(payload: MomentResyncRequestedPayload): void {
  if (!bootstrappedActorId) return;
  runDetached('moment resync projection refresh', async () => {
    await refreshMomentsProjection(`event:moment.resync:${payload.reason}`);
  });
}

function onRealtimeResync(payload: RealtimeResyncPayload): void {
  if (!bootstrappedActorId) return;
  runDetached('realtime resync moments projection refresh', async () => {
    await refreshMomentsProjection(`event:realtime.resync:${payload.reason}`);
  });
}

async function bootstrapForActor(actorId: string, sequence: number): Promise<void> {
  if (bootstrappedActorId && bootstrappedActorId !== actorId) {
    useMomentsStore.getState().reset();
    useDiscoveryStore.getState().reset();
    useRelationshipsStore.getState().reset();
  }

  bootstrappedActorId = actorId;
  await refreshMomentsProjection('bootstrap');

  if (sequence !== bootstrapSequence) return;
  log.info('momentsRuntime', 'moments projection bootstrap completed', { actorId });
}

function reconcileAuthenticatedRuntime(): void {
  const session = useSessionStore.getState();
  const actorId = session.authenticated ? session.currentUser?.actorId ?? null : null;
  if (!actorId) {
    bootstrappedActorId = null;
    bootstrapSequence += 1;
    useMomentsStore.getState().reset();
    useDiscoveryStore.getState().reset();
    useRelationshipsStore.getState().reset();
    return;
  }

  if (bootstrappedActorId === actorId) return;
  const sequence = ++bootstrapSequence;
  runDetached('moments projection bootstrap', () => bootstrapForActor(actorId, sequence));
}

function startReconcileTimer(): void {
  if (reconcileTimer) return;
  reconcileTimer = window.setInterval(() => {
    if (!bootstrappedActorId) return;
    runDetached('periodic moments projection refresh', () => (
      refreshMomentsProjection('periodic reconcile')
    ));
  }, MOMENTS_RECONCILE_INTERVAL_MS);
}

function stopReconcileTimer(): void {
  if (!reconcileTimer) return;
  window.clearInterval(reconcileTimer);
  reconcileTimer = null;
}

export async function reconcileMomentsProjection(reason: string): Promise<void> {
  if (!bootstrappedActorId) return;
  await refreshMomentsProjection(reason);
}

export const momentsRuntime: RuntimeDescriptor = {
  id: 'moments',
  scope: 'app',
  install(): void {
    if (teardownRuntime) return;

    const unsubscribeSession = useSessionStore.subscribe(reconcileAuthenticatedRuntime);
    const unsubs = [
      unsubscribeSession,
      eventBus.subscribe(EVENT.MOMENT_CREATED, onMomentCreated),
      eventBus.subscribe(EVENT.MOMENT_DELETED, onMomentDeleted),
      eventBus.subscribe(EVENT.MOMENT_COMMENTED, onMomentCommented),
      eventBus.subscribe(EVENT.MOMENT_REACTED, onMomentReacted),
      eventBus.subscribe(EVENT.MOMENT_RESYNC_REQUESTED, onMomentResyncRequested),
      eventBus.subscribe(EVENT.REALTIME_RESYNC, onRealtimeResync),
    ];
    startReconcileTimer();
    reconcileAuthenticatedRuntime();

    teardownRuntime = () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
      stopReconcileTimer();
      teardownRuntime = null;
      bootstrappedActorId = null;
      bootstrapSequence += 1;
      seenMomentEventIds.clear();
    };

    log.info('momentsRuntime', 'runtime installed');
  },
  teardown(): void {
    if (!teardownRuntime) return;
    teardownRuntime();
    log.info('momentsRuntime', 'runtime torn down');
  },
  async bootstrap(): Promise<void> {
    reconcileAuthenticatedRuntime();
  },
  async reconcile(reason: string): Promise<void> {
    await reconcileMomentsProjection(`runtime:reconcile:${reason}`);
  },
};
