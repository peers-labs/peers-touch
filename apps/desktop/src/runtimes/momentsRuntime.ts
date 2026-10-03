// Moments runtime — long-lived owner for the Moments projection.
//
// Phase 1 keeps the existing `useMomentsStore` APIs as the write surface
// and moves first-screen freshness out of pages. Later phases will replace
// polling reconcile with Station projection events + cursor sync.

import { useDiscoveryStore } from '../store/discovery';
import { useMomentsStore } from '../store/moments';
import { usePrivateCommentsStore } from '../store/privateComments';
import { usePrivateMomentsStore } from '../store/privateMoments';
import { useRelationshipsStore } from '../store/relationships';
import { useSessionStore } from '../store/session';
import {
  Audience_Kind,
  type Post,
} from '../gen/proto/domain/social/post_pb';
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
let bootstrappedSessionEpoch: number | null = null;
let bootstrapSequence = 0;
let refreshInFlight: { generation: number; promise: Promise<void> } | null = null;
let realtimeWasDisconnected = false;
let lastReconnectRefreshAt = 0;
const seenMomentEventIds = new Set<string>();

export function isPrivateMomentPost(post: Post | undefined): boolean {
  const kind = post?.audience?.kind;
  return kind !== undefined
    && kind !== Audience_Kind.KIND_UNSPECIFIED
    && kind !== Audience_Kind.PUBLIC;
}

function privatePostIds(): string[] {
  return Object.values(useMomentsStore.getState().postsById)
    .filter(isPrivateMomentPost)
    .map((post) => post.id)
    .filter(Boolean);
}

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
  const generation = bootstrapSequence;
  if (refreshInFlight?.generation === generation) return refreshInFlight.promise;

  const promise = (async () => {
    log.info('momentsRuntime', 'moments projection refresh started', { label });

    const moments = useMomentsStore.getState();
    const discovery = useDiscoveryStore.getState();
    const previousPrivatePostIds = [...new Set([
      ...privatePostIds(),
      ...Object.keys(usePrivateMomentsStore.getState().postsById),
    ])];
    await Promise.allSettled([
      discovery.loadMe(),
      moments.syncProjection(label),
      moments.listMyCircles(),
    ]);
    if (generation !== bootstrapSequence) return;
    await preloadCircleMembers();
    const currentPrivatePostIds = privatePostIds();
    const privatePostIdsToReconcile = [...new Set([
      ...previousPrivatePostIds,
      ...currentPrivatePostIds,
    ])];
    await usePrivateMomentsStore.getState().reconcile(
      privatePostIdsToReconcile,
      label,
      generation,
    );
    await usePrivateCommentsStore.getState().reconcile(
      privatePostIdsToReconcile,
      label,
      generation,
    );

    log.info('momentsRuntime', 'moments projection refresh completed', { label });
  })().finally(() => {
    if (refreshInFlight?.promise === promise) {
      refreshInFlight = null;
    }
  });
  refreshInFlight = { generation, promise };

  return promise;
}

export async function ensureMomentDetailProjection(postId: string): Promise<void> {
  const trimmedPostId = postId.trim();
  if (!trimmedPostId) return;

  const moments = useMomentsStore.getState();
  const privateMoments = usePrivateMomentsStore.getState();
  const privateComments = usePrivateCommentsStore.getState();
  const knownPost = moments.postsById[trimmedPostId];
  log.info('momentsRuntime', 'moment detail projection refresh started', { postId: trimmedPostId });
  if (isPrivateMomentPost(knownPost)) {
    await privateMoments.readMoment(trimmedPostId);
    const projection = usePrivateMomentsStore.getState().postsById[trimmedPostId];
    if (projection?.state === 'CONTENT_READY') {
      await privateComments.loadComments(trimmedPostId, true);
    } else if (
      projection?.state === 'NOT_FOUND_OR_NOT_AUTHORIZED'
      || projection?.state === 'DELETED_OR_REVOKED'
    ) {
      privateComments.markParentUnavailable(trimmedPostId, projection.errorCode);
    }
  } else {
    const post = await moments.loadPost(trimmedPostId);
    if (!post || isPrivateMomentPost(post)) {
      await usePrivateMomentsStore.getState().readMoment(trimmedPostId);
      const projection = usePrivateMomentsStore.getState().postsById[trimmedPostId];
      if (projection?.state === 'CONTENT_READY') {
        await usePrivateCommentsStore.getState().loadComments(trimmedPostId, true);
      } else if (
        projection?.state === 'NOT_FOUND_OR_NOT_AUTHORIZED'
        || projection?.state === 'DELETED_OR_REVOKED'
      ) {
        usePrivateCommentsStore.getState().markParentUnavailable(
          trimmedPostId,
          projection.errorCode,
        );
      }
    } else {
      await moments.loadComments(trimmedPostId, true);
    }
  }
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
    usePrivateCommentsStore.getState().markParentUnavailable(
      payload.postId,
      'COMMENT_PARENT_UNAVAILABLE',
    );
    await usePrivateMomentsStore.getState().purgeMoment(payload.postId);
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

async function bootstrapForActor(
  actorPtid: string,
  sessionEpoch: number,
  sequence: number,
): Promise<void> {
  if (bootstrappedActorPtid && bootstrappedActorPtid !== actorPtid) {
    useMomentsStore.getState().reset();
    useDiscoveryStore.getState().reset();
    useRelationshipsStore.getState().reset();
  }

  bootstrappedActorPtid = actorPtid;
  bootstrappedSessionEpoch = sessionEpoch;
  usePrivateMomentsStore.getState().activateActor(actorPtid, sequence);
  usePrivateCommentsStore.getState().activateActor(actorPtid, sequence);
  try {
    await usePrivateMomentsStore.getState().bootstrap(sequence);
    await Promise.all([
      usePrivateCommentsStore.getState().bootstrap(sequence),
      refreshMomentsProjection('bootstrap'),
    ]);
  } catch (error) {
    if (
      sequence === bootstrapSequence
      && bootstrappedActorPtid === actorPtid
      && bootstrappedSessionEpoch === sessionEpoch
    ) {
      bootstrappedActorPtid = null;
      bootstrappedSessionEpoch = null;
    }
    throw error;
  }

  if (sequence !== bootstrapSequence) return;
  log.info('momentsRuntime', 'moments projection bootstrap completed', { actorPtid });
}

function reconcileAuthenticatedRuntime(): void {
  const session = useSessionStore.getState();
  const actorPtid = session.authenticated ? session.currentUser?.actorPtid ?? null : null;
  if (!actorPtid) {
    bootstrappedActorPtid = null;
    bootstrappedSessionEpoch = null;
    realtimeWasDisconnected = false;
    lastReconnectRefreshAt = 0;
    const sequence = ++bootstrapSequence;
    usePrivateMomentsStore.getState().deactivate(sequence);
    usePrivateCommentsStore.getState().deactivate(sequence);
    useMomentsStore.getState().reset();
    useDiscoveryStore.getState().reset();
    useRelationshipsStore.getState().reset();
    return;
  }

  if (
    bootstrappedActorPtid === actorPtid
    && bootstrappedSessionEpoch === session.sessionEpoch
  ) return;
  const sequence = ++bootstrapSequence;
  runDetached('moments projection bootstrap', () => (
    bootstrapForActor(actorPtid, session.sessionEpoch, sequence)
  ));
}

function startReconcileTimer(): void {
  if (reconcileTimer) return;
  reconcileTimer = window.setInterval(() => {
    if (!bootstrappedActorPtid) {
      const session = useSessionStore.getState();
      if (session.authenticated && session.currentUser?.actorPtid) {
        reconcileAuthenticatedRuntime();
      }
      return;
    }
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
      bootstrappedSessionEpoch = null;
      realtimeWasDisconnected = false;
      lastReconnectRefreshAt = 0;
      const sequence = ++bootstrapSequence;
      usePrivateMomentsStore.getState().deactivate(sequence);
      usePrivateCommentsStore.getState().deactivate(sequence);
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
