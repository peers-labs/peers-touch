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
import { useFederationStore } from '../store/federation';
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
  MomentRealtimeBasePayload,
  MomentResyncRequestedPayload,
  RelationshipChangedPayload,
  RealtimeConnectionStatePayload,
  RealtimeResyncPayload,
  StationActiveChangedPayload,
} from '../kernel/events/types';
import type {
  PrivateMomentPublishIntent,
  PrivateMomentPublishResult,
} from '../services/privateMomentsNative';
import { log } from '../utils/logger';

const MOMENTS_RECONCILE_INTERVAL_MS = 45_000;
const MOMENTS_RECONNECT_REFRESH_MIN_INTERVAL_MS = 5_000;

let teardownRuntime: (() => void) | null = null;
let reconcileTimer: number | null = null;
let bootstrapSequence = 0;
let activeScope: MomentsRuntimeScope | null = null;
let pendingScopeKey: string | null = null;
let stationIdentityHint: string | null = null;
let projectionQueue: Promise<void> = Promise.resolve();
let realtimeWasDisconnected = false;
let lastReconnectRefreshAt = 0;
const pendingMomentEventKeys = new Set<string>();
const completedMomentEventKeys = new Set<string>();

export interface MomentsRuntimeScope {
  readonly actorPtid: string;
  readonly sessionEpoch: number;
  readonly stationIdentity: string;
  readonly generation: number;
}

export class MomentsRuntimeScopeChangedError extends Error {
  constructor() {
    super('moments_runtime_scope_changed');
    this.name = 'MomentsRuntimeScopeChangedError';
  }
}

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

function runDetached(label: string, task: Promise<void>): void {
  void task.catch((error) => {
    if (error instanceof MomentsRuntimeScopeChangedError) return;
    log.warn('momentsRuntime', `${label} failed`, error);
  });
}

function scopeKey(scope: Omit<MomentsRuntimeScope, 'generation'>): string {
  return `${scope.actorPtid}\0${scope.sessionEpoch}\0${scope.stationIdentity}`;
}

function currentStationIdentity(): string {
  if (stationIdentityHint) return stationIdentityHint;
  const stationPeerId = useFederationStore.getState().self?.homeStationPeerId.trim();
  return stationPeerId ? `peer:${stationPeerId}` : 'station:unresolved';
}

function isCurrentScope(scope: MomentsRuntimeScope): boolean {
  const session = useSessionStore.getState();
  return Boolean(
    activeScope
    && activeScope.generation === scope.generation
    && activeScope.actorPtid === scope.actorPtid
    && activeScope.sessionEpoch === scope.sessionEpoch
    && activeScope.stationIdentity === scope.stationIdentity
    && bootstrapSequence === scope.generation
    && session.authenticated
    && session.currentUser?.actorPtid === scope.actorPtid
    && session.sessionEpoch === scope.sessionEpoch
    && currentStationIdentity() === scope.stationIdentity
  );
}

function resetProjection(generation: number): void {
  usePrivateMomentsStore.getState().deactivate(generation);
  usePrivateCommentsStore.getState().deactivate(generation);
  useMomentsStore.getState().reset();
  useDiscoveryStore.getState().reset();
}

function invalidateScope(): number {
  const generation = ++bootstrapSequence;
  activeScope = null;
  realtimeWasDisconnected = false;
  lastReconnectRefreshAt = 0;
  pendingMomentEventKeys.clear();
  completedMomentEventKeys.clear();
  resetProjection(generation);
  return generation;
}

function enqueueProjectionWork<T>(task: () => Promise<T>): Promise<T> {
  const pending = projectionQueue.then(task);
  projectionQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

function enqueueScopedProjection<T>(
  task: (scope: MomentsRuntimeScope) => Promise<T>,
): Promise<T | undefined> {
  const scope = activeScope;
  if (!scope) return Promise.resolve(undefined);
  return enqueueProjectionWork(async () => {
    if (!isCurrentScope(scope)) return undefined;
    try {
      return await task(scope);
    } finally {
      if (!isCurrentScope(scope)) {
        resetProjection(bootstrapSequence);
      }
    }
  });
}

export function captureMomentsRuntimeScope(): MomentsRuntimeScope | null {
  return activeScope ? { ...activeScope } : null;
}

function momentEventMatchesScope(
  scope: MomentsRuntimeScope,
  payload: MomentRealtimeBasePayload,
): boolean {
  if (
    payload.targetActorPtid !== scope.actorPtid
    || payload.sessionEpoch !== scope.sessionEpoch
  ) {
    return false;
  }
  if (scope.stationIdentity.startsWith('peer:')) {
    return payload.stationPeerId === scope.stationIdentity.slice('peer:'.length);
  }
  if (scope.stationIdentity.startsWith('url:')) {
    return payload.stationUrl === scope.stationIdentity.slice('url:'.length);
  }
  return false;
}

function claimMomentEvent(
  scope: MomentsRuntimeScope,
  eventId: string,
): string | null {
  if (!eventId) return '';
  const key = `${scopeKey(scope)}\0${eventId}`;
  if (
    pendingMomentEventKeys.has(key)
    || completedMomentEventKeys.has(key)
  ) {
    return null;
  }
  pendingMomentEventKeys.add(key);
  return key;
}

function settleMomentEvent(key: string, completed: boolean): void {
  if (!key) return;
  pendingMomentEventKeys.delete(key);
  if (!completed) return;
  completedMomentEventKeys.add(key);
  if (completedMomentEventKeys.size > 500) {
    const first = completedMomentEventKeys.values().next().value;
    if (first) completedMomentEventKeys.delete(first);
  }
}

function runScopedMomentEvent(
  payload: MomentRealtimeBasePayload,
  label: string,
  task: (scope: MomentsRuntimeScope) => Promise<void>,
): void {
  const scope = activeScope;
  if (!scope || !momentEventMatchesScope(scope, payload)) return;
  const eventKey = claimMomentEvent(scope, payload.eventId);
  if (eventKey === null) return;
  const work = enqueueProjectionWork(async () => {
    if (!isCurrentScope(scope)) return false;
    await task(scope);
    if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    return true;
  }).then(
    (completed) => {
      settleMomentEvent(eventKey, completed);
    },
    (error) => {
      settleMomentEvent(eventKey, false);
      throw error;
    },
  );
  runDetached(label, work);
}

async function preloadCircleMembers(scope: MomentsRuntimeScope): Promise<void> {
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  const store = useMomentsStore.getState();
  const tasks = store.circles
    .map((circle) => String(circle.id ?? ''))
    .filter((circleId) => circleId && !store.circleMembers[circleId])
    .map((circleId) => store.loadCircleMembers(circleId));

  await Promise.allSettled(tasks);
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
}

export async function ensureCircleMemberProfiles(): Promise<void> {
  await enqueueScopedProjection(async (scope) => {
    await preloadCircleMembers(scope);
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
      if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    }
  });
}

async function preparePrivateMoment(
  intent: Omit<
    PrivateMomentPublishIntent,
    'actorPtid' | 'rendererGeneration'
  >,
  readinessState: 'CHECKING_PRIVATE_READINESS' | 'CHECKING_REMOTE_READINESS',
): Promise<PrivateMomentPublishResult> {
  const result = await enqueueScopedProjection(async (scope) => {
    const prepared = await usePrivateMomentsStore.getState().admitMoment(
      intent,
      readinessState,
    );
    if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    return prepared;
  });
  if (!result) throw new MomentsRuntimeScopeChangedError();
  return result;
}

export function preparePrivateAudience(
  intent: Omit<
    PrivateMomentPublishIntent,
    'actorPtid' | 'rendererGeneration'
  >,
): Promise<PrivateMomentPublishResult> {
  return preparePrivateMoment(intent, 'CHECKING_PRIVATE_READINESS');
}

export function prepareRemotePrivateRecipient(
  intent: Omit<
    PrivateMomentPublishIntent,
    'actorPtid' | 'rendererGeneration'
  >,
): Promise<PrivateMomentPublishResult> {
  return preparePrivateMoment(intent, 'CHECKING_REMOTE_READINESS');
}

async function refreshMomentsProjectionNow(
  scope: MomentsRuntimeScope,
  label: string,
): Promise<void> {
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
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
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  await preloadCircleMembers(scope);
  const currentPrivatePostIds = privatePostIds();
  const privatePostIdsToReconcile = [...new Set([
    ...previousPrivatePostIds,
    ...currentPrivatePostIds,
  ])];
  await usePrivateMomentsStore.getState().reconcile(
    privatePostIdsToReconcile,
    label,
    scope.generation,
  );
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  moments.hydratePrivateMoments(
    Object.values(usePrivateMomentsStore.getState().postsById),
  );
  await usePrivateCommentsStore.getState().reconcile(
    privatePostIdsToReconcile,
    label,
    scope.generation,
  );
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();

  log.info('momentsRuntime', 'moments projection refresh completed', { label });
}

async function ensureMomentDetailProjectionNow(
  scope: MomentsRuntimeScope | null,
  postId: string,
): Promise<void> {
  const trimmedPostId = postId.trim();
  if (!trimmedPostId) return;
  if (scope && !isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();

  const moments = useMomentsStore.getState();
  const privateMoments = usePrivateMomentsStore.getState();
  const privateComments = usePrivateCommentsStore.getState();
  const knownPost = moments.postsById[trimmedPostId];
  log.info('momentsRuntime', 'moment detail projection refresh started', { postId: trimmedPostId });
  if (isPrivateMomentPost(knownPost)) {
    await privateMoments.readMoment(trimmedPostId);
    const projection = usePrivateMomentsStore.getState().postsById[trimmedPostId];
    moments.hydratePrivateMoments(
      Object.values(usePrivateMomentsStore.getState().postsById),
    );
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
    if (scope && !isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    if (!post || isPrivateMomentPost(post)) {
      await usePrivateMomentsStore.getState().readMoment(trimmedPostId);
      const projection = usePrivateMomentsStore.getState().postsById[trimmedPostId];
      moments.hydratePrivateMoments(
        Object.values(usePrivateMomentsStore.getState().postsById),
      );
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
  if (scope && !isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  log.info('momentsRuntime', 'moment detail projection refresh completed', { postId: trimmedPostId });
}

export async function ensureMomentDetailProjection(postId: string): Promise<void> {
  if (!activeScope) {
    const privateScope = usePrivateMomentsStore.getState().scope;
    if (privateScope.actorPtid) {
      await ensureMomentDetailProjectionNow(null, postId);
    }
    return;
  }
  await enqueueScopedProjection((scope) => (
    ensureMomentDetailProjectionNow(scope, postId)
  ));
}

async function ensureUserMomentsProjectionNow(
  scope: MomentsRuntimeScope,
  actorPtid: string,
): Promise<void> {
  const trimmedActorPtid = actorPtid.trim();
  if (!trimmedActorPtid) return;
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();

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
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  log.info('momentsRuntime', 'user moments projection refresh completed', { actorPtid: trimmedActorPtid });
}

export async function ensureUserMomentsProjection(actorPtid: string): Promise<void> {
  await enqueueScopedProjection((scope) => (
    ensureUserMomentsProjectionNow(scope, actorPtid)
  ));
}

function onMomentCreated(payload: MomentCreatedPayload): void {
  runScopedMomentEvent(
    payload,
    'moment created projection refresh',
    async (scope) => {
      await ensureMomentDetailProjectionNow(scope, payload.postId);
      await refreshMomentsProjectionNow(scope, 'event:moment.created');
    },
  );
}

function onMomentDeleted(payload: MomentDeletedPayload): void {
  runScopedMomentEvent(
    payload,
    'moment deleted projection refresh',
    async (scope) => {
      usePrivateCommentsStore.getState().markParentUnavailable(
        payload.postId,
        'COMMENT_PARENT_UNAVAILABLE',
      );
      await usePrivateMomentsStore.getState().purgeMoment(payload.postId);
      if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
      await refreshMomentsProjectionNow(scope, 'event:moment.deleted');
    },
  );
}

function onMomentCommented(payload: MomentCommentedPayload): void {
  runScopedMomentEvent(
    payload,
    'moment commented projection refresh',
    (scope) => ensureMomentDetailProjectionNow(scope, payload.postId),
  );
}

function onMomentReacted(payload: MomentReactedPayload): void {
  runScopedMomentEvent(
    payload,
    'moment reacted projection refresh',
    (scope) => ensureMomentDetailProjectionNow(scope, payload.postId),
  );
}

function onRelationshipChanged(payload: RelationshipChangedPayload): void {
  if (!activeScope) return;
  runDetached(
    'relationship changed moments projection refresh',
    enqueueScopedProjection(async (scope) => {
      const relationships = useRelationshipsStore.getState();
      await Promise.allSettled([
        relationships.loadRelationship(payload.targetActorPtid),
        relationships.loadFollowers(payload.targetActorPtid, true),
        refreshMomentsProjectionNow(
          scope,
          `event:relationship.changed:${payload.action}`,
        ),
      ]);
    }).then(() => undefined),
  );
}

function onMomentResyncRequested(payload: MomentResyncRequestedPayload): void {
  if (!activeScope) return;
  runDetached(
    'moment resync projection refresh',
    enqueueScopedProjection((scope) => (
      refreshMomentsProjectionNow(scope, `event:moment.resync:${payload.reason}`)
    )).then(() => undefined),
  );
}

function onRealtimeResync(payload: RealtimeResyncPayload): void {
  if (!activeScope) return;
  runDetached(
    'realtime resync moments projection refresh',
    enqueueScopedProjection((scope) => (
      refreshMomentsProjectionNow(scope, `event:realtime.resync:${payload.reason}`)
    )).then(() => undefined),
  );
}

function onRealtimeConnectionState(payload: RealtimeConnectionStatePayload): void {
  if (!activeScope) return;
  if (!payload.connected) {
    realtimeWasDisconnected = true;
    return;
  }

  if (!realtimeWasDisconnected) return;
  realtimeWasDisconnected = false;

  const now = Date.now();
  if (now - lastReconnectRefreshAt < MOMENTS_RECONNECT_REFRESH_MIN_INTERVAL_MS) return;
  lastReconnectRefreshAt = now;

  runDetached(
    'realtime reconnect moments projection refresh',
    enqueueScopedProjection((scope) => (
      refreshMomentsProjectionNow(
        scope,
        `event:realtime.connection_state:${payload.reason || 'reconnected'}`,
      )
    )).then(() => undefined),
  );
}

async function bootstrapForScope(scope: MomentsRuntimeScope): Promise<void> {
  usePrivateMomentsStore.getState().activateActor(
    scope.actorPtid,
    scope.generation,
  );
  usePrivateCommentsStore.getState().activateActor(
    scope.actorPtid,
    scope.generation,
  );
  try {
    await usePrivateMomentsStore.getState().bootstrap(scope.generation);
    if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    await Promise.all([
      usePrivateCommentsStore.getState().bootstrap(scope.generation),
      refreshMomentsProjectionNow(scope, 'bootstrap'),
    ]);
  } catch (error) {
    if (isCurrentScope(scope)) {
      activeScope = null;
      resetProjection(bootstrapSequence);
    }
    throw error;
  }

  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  log.info('momentsRuntime', 'moments projection bootstrap completed');
}

function desiredScope(): Omit<MomentsRuntimeScope, 'generation'> | null {
  const session = useSessionStore.getState();
  const actorPtid = session.authenticated ? session.currentUser?.actorPtid ?? null : null;
  if (!actorPtid) return null;
  return {
    actorPtid,
    sessionEpoch: session.sessionEpoch,
    stationIdentity: currentStationIdentity(),
  };
}

function reconcileAuthenticatedRuntime(_reason = 'session'): Promise<void> {
  const desired = desiredScope();
  if (!desired) {
    pendingScopeKey = null;
    if (activeScope) invalidateScope();
    return projectionQueue;
  }

  const nextScopeKey = scopeKey(desired);
  if (
    (activeScope && scopeKey(activeScope) === nextScopeKey)
    || pendingScopeKey === nextScopeKey
  ) {
    return projectionQueue;
  }

  pendingScopeKey = nextScopeKey;
  const generation = invalidateScope();
  const scope: MomentsRuntimeScope = { ...desired, generation };
  const activation = enqueueProjectionWork(async () => {
    if (
      bootstrapSequence !== generation
      || pendingScopeKey !== nextScopeKey
    ) {
      return;
    }
    resetProjection(generation);
    activeScope = scope;
    try {
      await bootstrapForScope(scope);
    } catch (error) {
      if (error instanceof MomentsRuntimeScopeChangedError) return;
      throw error;
    } finally {
      if (pendingScopeKey === nextScopeKey) {
        pendingScopeKey = null;
      }
      if (!isCurrentScope(scope)) {
        resetProjection(bootstrapSequence);
      }
    }
  });
  runDetached('moments projection bootstrap', activation);
  return activation;
}

function onStationChanged(payload: StationActiveChangedPayload): void {
  const stationUrl = payload.stationUrl.trim().replace(/\/+$/, '');
  stationIdentityHint = stationUrl
    ? `url:${stationUrl}`
    : `station-change:${bootstrapSequence + 1}`;
  void reconcileAuthenticatedRuntime('station-switch');
}

function startReconcileTimer(): void {
  if (reconcileTimer) return;
  reconcileTimer = window.setInterval(() => {
    if (!activeScope) {
      const session = useSessionStore.getState();
      if (session.authenticated && session.currentUser?.actorPtid) {
        void reconcileAuthenticatedRuntime('periodic-retry');
      }
      return;
    }
    runDetached(
      'periodic moments projection refresh',
      enqueueScopedProjection((scope) => (
        refreshMomentsProjectionNow(scope, 'periodic reconcile')
      )).then(() => undefined),
    );
  }, MOMENTS_RECONCILE_INTERVAL_MS);
}

function stopReconcileTimer(): void {
  if (!reconcileTimer) return;
  window.clearInterval(reconcileTimer);
  reconcileTimer = null;
}

export async function reconcileMomentsProjection(reason: string): Promise<void> {
  await enqueueScopedProjection((scope) => (
    refreshMomentsProjectionNow(scope, reason)
  ));
}

export const momentsRuntime: RuntimeDescriptor = {
  id: 'moments',
  scope: 'app',
  install(): void {
    if (teardownRuntime) return;

    const unsubscribeSession = useSessionStore.subscribe((state, previous) => {
      if (
        state.authenticated !== previous.authenticated
        || state.currentUser?.actorPtid !== previous.currentUser?.actorPtid
        || state.sessionEpoch !== previous.sessionEpoch
      ) {
        void reconcileAuthenticatedRuntime('session');
      }
    });
    const unsubscribeFederation = useFederationStore.subscribe((state, previous) => {
      if (stationIdentityHint) return;
      if (
        state.self?.homeStationPeerId.trim()
        !== previous.self?.homeStationPeerId.trim()
      ) {
        void reconcileAuthenticatedRuntime('station-identity');
      }
    });
    const unsubs = [
      unsubscribeSession,
      unsubscribeFederation,
      eventBus.subscribe(EVENT.STATION_ACTIVE_CHANGED, onStationChanged),
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
    void reconcileAuthenticatedRuntime('install');

    teardownRuntime = () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
      stopReconcileTimer();
      teardownRuntime = null;
      pendingScopeKey = null;
      stationIdentityHint = null;
      invalidateScope();
    };

    log.info('momentsRuntime', 'runtime installed');
  },
  teardown(): void {
    if (!teardownRuntime) return;
    teardownRuntime();
    log.info('momentsRuntime', 'runtime torn down');
  },
  async bootstrap(): Promise<void> {
    await reconcileAuthenticatedRuntime('runtime-bootstrap');
  },
  async reconcile(reason: string): Promise<void> {
    await reconcileMomentsProjection(`runtime:reconcile:${reason}`);
  },
};
