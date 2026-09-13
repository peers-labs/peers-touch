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
  RelationshipChangedPayload,
  RealtimeConnectionStatePayload,
  RealtimeResyncPayload,
} from '../kernel/events/types';
import { log } from '../utils/logger';

const MOMENTS_RECONCILE_INTERVAL_MS = 45_000;
const MOMENTS_RECONNECT_REFRESH_MIN_INTERVAL_MS = 5_000;

let teardownRuntime: (() => void) | null = null;
let reconcileTimer: number | null = null;
let bootstrappedActorPtid: string | null = null;
let bootstrapSequence = 0;
let refreshInFlight: Promise<void> | null = null;
let realtimeWasDisconnected = false;
let lastReconnectRefreshAt = 0;
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

export async function ensureCircleMemberProfiles(): Promise<void> {
  await preloadCircleMembers();
  const discovery = useDiscoveryStore.getState();
  const memberPtids = [...new Set(
    Object.values(useMomentsStore.getState().circleMembers)
      .flat()
      .map((member) => member.actorPtid.trim())
      .filter(Boolean),
  )];

  const batchSize = 6;
  for (let index = 0; index < memberPtids.length; index += batchSize) {
    await Promise.allSettled(
      memberPtids
        .slice(index, index + batchSize)
        .map((actorPtid) => discovery.loadUserProfile(actorPtid)),
    );
  }
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

export async function ensureUserMomentsProjection(actorPtid: string): Promise<void> {
  const trimmedActorPtid = actorPtid.trim();
  if (!trimmedActorPtid) return;

  const moments = useMomentsStore.getState();
  const discovery = useDiscoveryStore.getState();
  const relationships = useRelationshipsStore.getState();
  log.info('momentsRuntime', 'user moments projection refresh started', { actorPtid: trimmedActorPtid });
  await Promise.allSettled([
    discovery.loadUserProfile(trimmedActorPtid, true),
    moments.loadUserFeed(trimmedActorPtid, true),
    relationships.loadFollowers(trimmedActorPtid, true),
    relationships.loadFollowing(trimmedActorPtid, true),
  ]);
  log.info('momentsRuntime', 'user moments projection refresh completed', { actorPtid: trimmedActorPtid });
}

function onMomentCreated(payload: MomentCreatedPayload): void {
  if (!bootstrappedActorPtid) return;
  if (!rememberMomentEvent(payload.eventId)) return;
  runDetached('moment created projection refresh', async () => {
    await ensureMomentDetailProjection(payload.postId);
    await refreshMomentsProjection('event:moment.created');
  });
}

function onMomentDeleted(payload: MomentDeletedPayload): void {
  if (!bootstrappedActorPtid) return;
  if (!rememberMomentEvent(payload.eventId)) return;
  runDetached('moment deleted projection refresh', async () => {
    await refreshMomentsProjection('event:moment.deleted');
  });
}

function onMomentCommented(payload: MomentCommentedPayload): void {
  if (!bootstrappedActorPtid) return;
  if (!rememberMomentEvent(payload.eventId)) return;
  runDetached('moment commented projection refresh', async () => {
    await ensureMomentDetailProjection(payload.postId);
  });
}

function onMomentReacted(payload: MomentReactedPayload): void {
  if (!bootstrappedActorPtid) return;
  if (!rememberMomentEvent(payload.eventId)) return;
  runDetached('moment reacted projection refresh', async () => {
    await ensureMomentDetailProjection(payload.postId);
  });
}

function onRelationshipChanged(payload: RelationshipChangedPayload): void {
  if (!bootstrappedActorPtid) return;
  runDetached('relationship changed moments projection refresh', async () => {
    const relationships = useRelationshipsStore.getState();
    await Promise.allSettled([
      relationships.loadRelationship(payload.targetActorPtid),
      relationships.loadFollowers(payload.targetActorPtid, true),
      refreshMomentsProjection(`event:relationship.changed:${payload.action}`),
    ]);
  });
}

function onMomentResyncRequested(payload: MomentResyncRequestedPayload): void {
  if (!bootstrappedActorPtid) return;
  runDetached('moment resync projection refresh', async () => {
    await refreshMomentsProjection(`event:moment.resync:${payload.reason}`);
  });
}

function onRealtimeResync(payload: RealtimeResyncPayload): void {
  if (!bootstrappedActorPtid) return;
  runDetached('realtime resync moments projection refresh', async () => {
    await refreshMomentsProjection(`event:realtime.resync:${payload.reason}`);
  });
}

function onRealtimeConnectionState(payload: RealtimeConnectionStatePayload): void {
  if (!bootstrappedActorPtid) return;
  if (!payload.connected) {
    realtimeWasDisconnected = true;
    return;
  }

  if (!realtimeWasDisconnected) return;
  realtimeWasDisconnected = false;

  const now = Date.now();
  if (now - lastReconnectRefreshAt < MOMENTS_RECONNECT_REFRESH_MIN_INTERVAL_MS) return;
  lastReconnectRefreshAt = now;

  runDetached('realtime reconnect moments projection refresh', async () => {
    await refreshMomentsProjection(`event:realtime.connection_state:${payload.reason || 'reconnected'}`);
  });
}

async function bootstrapForActor(actorPtid: string, sequence: number): Promise<void> {
  if (bootstrappedActorPtid && bootstrappedActorPtid !== actorPtid) {
    useMomentsStore.getState().reset();
    useDiscoveryStore.getState().reset();
    useRelationshipsStore.getState().reset();
  }

  bootstrappedActorPtid = actorPtid;
  await refreshMomentsProjection('bootstrap');

  if (sequence !== bootstrapSequence) return;
  log.info('momentsRuntime', 'moments projection bootstrap completed', { actorPtid });
}

function reconcileAuthenticatedRuntime(): void {
  const session = useSessionStore.getState();
  const actorPtid = session.authenticated ? session.currentUser?.actorPtid ?? null : null;
  if (!actorPtid) {
    bootstrappedActorPtid = null;
    realtimeWasDisconnected = false;
    lastReconnectRefreshAt = 0;
    bootstrapSequence += 1;
    useMomentsStore.getState().reset();
    useDiscoveryStore.getState().reset();
    useRelationshipsStore.getState().reset();
    return;
  }

  if (bootstrappedActorPtid === actorPtid) return;
  const sequence = ++bootstrapSequence;
  runDetached('moments projection bootstrap', () => bootstrapForActor(actorPtid, sequence));
}

function startReconcileTimer(): void {
  if (reconcileTimer) return;
  reconcileTimer = window.setInterval(() => {
    if (!bootstrappedActorPtid) return;
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
  if (!bootstrappedActorPtid) return;
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
      eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, onRelationshipChanged),
      eventBus.subscribe(EVENT.MOMENT_RESYNC_REQUESTED, onMomentResyncRequested),
      eventBus.subscribe(EVENT.REALTIME_RESYNC, onRealtimeResync),
      eventBus.subscribe(EVENT.REALTIME_CONNECTION_STATE, onRealtimeConnectionState),
    ];
    startReconcileTimer();
    reconcileAuthenticatedRuntime();

    teardownRuntime = () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
      stopReconcileTimer();
      teardownRuntime = null;
      bootstrappedActorPtid = null;
      realtimeWasDisconnected = false;
      lastReconnectRefreshAt = 0;
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
