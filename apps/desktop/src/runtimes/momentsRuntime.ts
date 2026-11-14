// Moments runtime — long-lived owner for the Moments projection.
//
// Phase 1 keeps the existing `useMomentsStore` APIs as the write surface
// and moves first-screen freshness out of pages. Later phases will replace
// polling reconcile with Station projection events + cursor sync.

import { useDiscoveryStore } from '../store/discovery';
import { useMomentsStore } from '../store/moments';
import { useMomentsNavigationStore } from '../store/momentsNavigation';
import { usePrivateCommentsStore } from '../store/privateComments';
import { usePrivateMomentsStore } from '../store/privateMoments';
import { useRelationshipsStore } from '../store/relationships';
import { useSessionStore } from '../store/session';
import { useFederationStore } from '../store/federation';
import { useSocialChatStore } from '../store/socialChat';
import {
  Audience_Kind,
  type Post,
} from '../gen/proto/domain/social/post_pb';
import { EVENT, eventBus } from '../kernel/events';
import { isDocumentHidden, onDocumentForeground } from '../kernel/documentVisibility';
import { createTrailingCoalescer, type TrailingCoalescer } from '../kernel/trailingCoalesce';
import type { RuntimeDescriptor } from '../kernel/runtime';
import type {
  MomentCommentedPayload,
  MomentCreatedPayload,
  MomentDeletedPayload,
  MomentRevokedPayload,
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
import { resumePublicFeed } from '../services/publicFeedNative';

const MOMENTS_RECONCILE_INTERVAL_MS = 45_000;
const MOMENTS_RECONNECT_REFRESH_MIN_INTERVAL_MS = 5_000;
// Realtime invalidations (create/delete/revoke/resync) collapse into one
// feed refresh this long after the burst settles. Post-scoped reaction and
// comment wakes stay immediate.
const MOMENTS_EVENT_COALESCE_MS = 1_800;

function createProjectionEventCoalescer(): TrailingCoalescer {
  return createTrailingCoalescer(
    MOMENTS_EVENT_COALESCE_MS,
    () => {
      runDetached(
        'coalesced moments projection refresh',
        enqueueScopedProjection((scope) => (
          refreshMomentsProjectionNow(scope, 'event:coalesced')
        )).then(() => undefined),
      );
    },
    {
      setTimeout: (handler, timeoutMs) => window.setTimeout(handler, timeoutMs),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    },
  );
}

let projectionEventCoalescer: TrailingCoalescer = createProjectionEventCoalescer();

function scheduleCoalescedProjectionRefresh(): void {
  projectionEventCoalescer.schedule();
}

let teardownRuntime: (() => void) | null = null;
let reconcileTimer: number | null = null;
let unsubscribeForeground: (() => void) | null = null;
let bootstrapSequence = 0;
let activeScope: MomentsRuntimeScope | null = null;
let pendingScopeKey: string | null = null;
let stationIdentityHint: string | null = null;
let projectionQueue: Promise<void> = Promise.resolve();
let realtimeWasDisconnected = false;
let lastReconnectRefreshAt = 0;
let privateProjectionReady = false;
const pendingMomentEventKeys = new Set<string>();
const completedMomentEventKeys = new Set<string>();
// Only painted inline threads hold interest; hidden/closed cards release it.
const visibleCommentThreads = new Map<string, { generation: number; leases: Set<symbol> }>();

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

async function hydrateVisibleMomentAuthors(
  scope: MomentsRuntimeScope,
): Promise<void> {
  const authorPtids = [...new Set(
    Object.values(useMomentsStore.getState().postsById)
      .map((post) => (post.authorPtid || post.author?.id || '').trim())
      .filter(Boolean),
  )];
  const social = useSocialChatStore.getState();
  const tasks: Promise<void>[] = [];
  if (
    authorPtids.includes(scope.actorPtid)
    && (
      social.currentUserPtid !== scope.actorPtid
      || !social.currentUserProfile
    )
  ) {
    tasks.push(social.loadCurrentUserProfile());
  }
  for (const actorPtid of authorPtids) {
    if (actorPtid === scope.actorPtid) continue;
    tasks.push(social.loadPeerProfile(
      actorPtid,
      social.peerProfiles[actorPtid] === null,
    ));
  }
  await Promise.allSettled(tasks);
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
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
  const stationPeerId = (
    useFederationStore.getState().self?.home_station_peer_id ?? ''
  ).trim();
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
  privateProjectionReady = false;
  pendingMomentEventKeys.clear();
  completedMomentEventKeys.clear();
  visibleCommentThreads.clear();
  useMomentsNavigationStore.getState().reset();
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

export function matchesCurrentMomentEvent(payload: MomentRealtimeBasePayload): boolean {
  return !!activeScope && isCurrentScope(activeScope)
    && momentEventMatchesScope(activeScope, payload);
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
    .filter(Boolean);
  for (let index = 0; index < tasks.length; index += 6) {
    await Promise.allSettled(tasks.slice(index, index + 6).map(id => store.loadCircleMembers(id)));
    if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  }
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
  try {
    await resumePublicFeed();
    if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    moments.setPublicFeedRecoveryError(null);
  } catch (error) {
    if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    moments.setPublicFeedRecoveryError(String(error));
    log.warn('momentsRuntime', 'public feed retained write awaits recovery', { error: String(error) });
  }
  try {
    await moments.syncProjection(label);
    if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    await moments.reconcilePublicPollCommands();
  } catch (error) {
    if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    if (!/\bFEED_[A-Z_]+\b/.test(String(error))) throw error;
    log.warn('momentsRuntime', 'public Moments projection unavailable', { label, error: String(error) });
  }
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  await hydrateVisibleMomentAuthors(scope);
  await refreshVisiblePublicCommentThreads(scope);
  await Promise.allSettled([
    discovery.loadMe(),
    moments.listMyCircles(),
    moments.loadMyStats(),
  ]);
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  await preloadCircleMembers(scope);
  const detail = useMomentsNavigationStore.getState().view;
  if (detail.kind === 'detail' && !isPrivateMomentPost(moments.postsById[detail.postId])
    && !usePrivateMomentsStore.getState().postsById[detail.postId]) {
    await ensureMomentDetailProjectionNow(scope, detail.postId);
  }
  if (!await ensurePrivateProjectionReady(scope, label)) {
    log.info('momentsRuntime', 'moments projection refresh completed', {
      label,
      privateProjection: 'unavailable',
    });
    return;
  }
  const currentPrivatePostIds = privatePostIds();
  const privatePostIdsToReconcile = [...new Set([
    ...previousPrivatePostIds,
    ...currentPrivatePostIds,
    ...(detail.kind === 'detail' && (
      isPrivateMomentPost(moments.postsById[detail.postId])
      || usePrivateMomentsStore.getState().postsById[detail.postId]
    ) ? [detail.postId] : []),
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
  await hydrateVisibleMomentAuthors(scope);
  await usePrivateCommentsStore.getState().reconcile(
    privatePostIdsToReconcile,
    label,
    scope.generation,
  );
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();

  log.info('momentsRuntime', 'moments projection refresh completed', { label });
}

async function ensurePrivateProjectionReady(
  scope: MomentsRuntimeScope,
  label: string,
): Promise<boolean> {
  if (privateProjectionReady) return true;
  try {
    await usePrivateMomentsStore.getState().bootstrap(scope.generation);
    if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    await usePrivateCommentsStore.getState().bootstrap(scope.generation);
    if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    privateProjectionReady = true;
    return true;
  } catch (error) {
    if (error instanceof MomentsRuntimeScopeChangedError) throw error;
    log.warn('momentsRuntime', 'private Moments projection unavailable', {
      error: String(error),
      label,
    });
    return false;
  }
}

async function ensureMomentDetailProjectionNow(
  scope: MomentsRuntimeScope | null,
  postId: string,
  target?: { origin: 'device' | 'station'; commentId?: string },
): Promise<void> {
  const trimmedPostId = postId.trim();
  if (!trimmedPostId) return;
  if (scope && !isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();

  const moments = useMomentsStore.getState();
  const privateMoments = usePrivateMomentsStore.getState();
  const privateComments = usePrivateCommentsStore.getState();
  const knownPost = moments.postsById[trimmedPostId];
  const view = useMomentsNavigationStore.getState().view;
  const commentId = target?.commentId
    ?? (view.kind === 'detail' && view.postId === trimmedPostId ? view.commentId : undefined);
  const checkCurrent = () => {
    if (scope && !isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
    const latest = useMomentsNavigationStore.getState().view;
    if (view.kind === 'detail' && view.postId === trimmedPostId && latest !== view) {
      throw new MomentsRuntimeScopeChangedError();
    }
  };
  log.info('momentsRuntime', 'moment detail projection refresh started');
  if (target?.origin === 'device' || target?.origin !== 'station' && isPrivateMomentPost(knownPost)) {
    await privateMoments.readMoment(trimmedPostId);
    checkCurrent();
    const projection = usePrivateMomentsStore.getState().postsById[trimmedPostId];
    moments.hydratePrivateMoments(
      Object.values(usePrivateMomentsStore.getState().postsById),
    );
    if (projection?.state === 'CONTENT_READY') {
      await privateComments.loadComments(trimmedPostId, true, commentId);
    } else if (
      projection?.state === 'NOT_FOUND_OR_NOT_AUTHORIZED'
      || projection?.state === 'DELETED_OR_REVOKED'
    ) {
      privateComments.markParentUnavailable(trimmedPostId, projection.errorCode);
    }
  } else {
    const post = await moments.loadPost(trimmedPostId);
    checkCurrent();
    if (!post || isPrivateMomentPost(post)) {
      if (target?.origin === 'station') throw new Error('search.error.resourceUnavailable');
      await usePrivateMomentsStore.getState().readMoment(trimmedPostId);
      checkCurrent();
      const projection = usePrivateMomentsStore.getState().postsById[trimmedPostId];
      moments.hydratePrivateMoments(
        Object.values(usePrivateMomentsStore.getState().postsById),
      );
      if (projection?.state === 'CONTENT_READY') {
        await usePrivateCommentsStore.getState().loadComments(trimmedPostId, true, commentId);
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
      await moments.loadComments(trimmedPostId, true, commentId);
    }
  }
  checkCurrent();
  if (target?.origin === 'device'
    && usePrivateMomentsStore.getState().postsById[trimmedPostId]?.state !== 'CONTENT_READY') {
    throw new Error('search.error.resourceUnavailable');
  }
  log.info('momentsRuntime', 'moment detail projection refresh completed');
}

async function refreshVisiblePublicCommentThreads(scope: MomentsRuntimeScope): Promise<void> {
  const moments = useMomentsStore.getState();
  const postIds = [...visibleCommentThreads.entries()]
    .filter(([postId, interest]) => interest.generation === scope.generation
      && interest.leases.size > 0 && moments.postsById[postId]
      && !isPrivateMomentPost(moments.postsById[postId]))
    .map(([postId]) => postId);
  await Promise.allSettled(postIds.map(postId => moments.loadComments(postId, true)));
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
}

/** Section lifetime binding. The original Runtime owns first read and missed-event reconciliation. */
export function acquireMomentComments(postId: string): () => void {
  const scope = activeScope;
  if (!scope || !postId.trim()) return () => undefined;
  const id = postId.trim(), lease = Symbol(id);
  const existing = visibleCommentThreads.get(id);
  const interest = existing ?? { generation: scope.generation, leases: new Set<symbol>() };
  interest.leases.add(lease);
  visibleCommentThreads.set(id, interest);
  if (!existing) runDetached('visible Moment comments acquisition', enqueueScopedProjection(async current => {
    if (visibleCommentThreads.get(id) !== interest || interest.leases.size === 0
      || interest.generation !== current.generation) return;
    const moments = useMomentsStore.getState();
    if (isPrivateMomentPost(moments.postsById[id]) || usePrivateMomentsStore.getState().postsById[id]) {
      await usePrivateCommentsStore.getState().loadComments(id);
    } else if (moments.postsById[id] && moments.comments?.[id] === undefined) {
      await moments.loadComments(id);
    }
    if (!isCurrentScope(current)) throw new MomentsRuntimeScopeChangedError();
  }).then(() => undefined));
  return () => {
    interest.leases.delete(lease);
    if (interest.leases.size === 0 && visibleCommentThreads.get(id) === interest) visibleCommentThreads.delete(id);
  };
}

export async function ensureMomentDetailProjection(
  postId: string, target?: { origin: 'device' | 'station'; commentId?: string },
): Promise<void> {
  if (!activeScope) {
    const privateScope = usePrivateMomentsStore.getState().scope;
    if (privateScope.actorPtid) {
      await ensureMomentDetailProjectionNow(null, postId, target);
    }
    return;
  }
  await enqueueScopedProjection((scope) => (
    ensureMomentDetailProjectionNow(scope, postId, target)
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
  log.info('momentsRuntime', 'user moments projection refresh started');
  await Promise.allSettled([
    discovery.loadUserProfile(trimmedActorPtid, true),
    moments.loadUserFeed(trimmedActorPtid, true),
    relationships.loadFollowers(trimmedActorPtid, true),
    relationships.loadFollowing(trimmedActorPtid, true),
    ...(trimmedActorPtid === scope.actorPtid ? [] : [
      relationships.loadRelationship(trimmedActorPtid),
      relationships.loadRelationshipStatus(trimmedActorPtid),
    ]),
    ...(trimmedActorPtid === scope.actorPtid ? [moments.loadMyStats()] : []),
  ]);
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  log.info('momentsRuntime', 'user moments projection refresh completed');
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
      if (isCurrentScope(scope)) scheduleCoalescedProjectionRefresh();
    },
  );
}

function onMomentDeleted(payload: MomentDeletedPayload): void {
  runScopedMomentEvent(
    payload,
    'moment deleted projection refresh',
    async (scope) => {
      // Immediate local eviction of the public projection and every
      // feed window (including paginated tails). This issues no write
      // command — the server already committed the deletion.
      useMomentsStore.getState().evictPost(payload.postId);
      usePrivateCommentsStore.getState().markParentUnavailable(
        payload.postId,
        'COMMENT_PARENT_UNAVAILABLE',
      );
      await usePrivateMomentsStore.getState().purgeMoment(payload.postId);
      if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
      scheduleCoalescedProjectionRefresh();
    },
  );
}

function onMomentRevoked(payload: MomentRevokedPayload): void {
  runScopedMomentEvent(
    payload,
    'moment revocation projection refresh',
    async (scope) => {
      // Revocation is a read-authority change: drop the local entity
      // from all windows immediately (no write command), then converge
      // the private projection.
      useMomentsStore.getState().evictPost(payload.postId);
      usePrivateCommentsStore.getState().markParentUnavailable(
        payload.postId,
        `SOCIAL_PRIVATE_${payload.reason}`,
      );
      await Promise.allSettled([
        usePrivateMomentsStore.getState().revokeMoment(
          payload.postId,
          payload.reason,
        ),
      ]);
      if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
      useMomentsStore.getState().hydratePrivateMoments(
        Object.values(usePrivateMomentsStore.getState().postsById),
      );
      if (isCurrentScope(scope)) scheduleCoalescedProjectionRefresh();
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

function onMomentUpdated(payload: MomentRealtimeBasePayload): void {
  runScopedMomentEvent(payload, 'moment updated projection refresh',
    scope => ensureMomentDetailProjectionNow(scope, payload.postId));
}

function onMomentReacted(payload: MomentReactedPayload): void {
  runScopedMomentEvent(
    payload,
    'moment reacted projection refresh',
    (scope) => payload.commentId
      ? ensureMomentDetailProjectionNow(scope, payload.postId)
      : wakePostReactionProjection(scope, payload.postId),
  );
}

// Post-scoped reaction wakeup: refresh only that post's reaction
// summary. Open detail and visible feed cards both converge here;
// comment threads are never reloaded by a reaction event.
async function wakePostReactionProjection(
  scope: MomentsRuntimeScope,
  rawPostId: string,
): Promise<void> {
  if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
  const postId = rawPostId.trim();
  if (!postId) return;
  const moments = useMomentsStore.getState();
  const knownPost = moments.postsById[postId];
  const privateStore = usePrivateMomentsStore.getState();
  const privatePost = isPrivateMomentPost(knownPost)
    ? knownPost
    : privateStore.postsById[postId];
  const view = useMomentsNavigationStore.getState().view;
  const detailOpen = view.kind === 'detail' && view.postId === postId;
  // Hidden (not on any card / open detail) reactions converge on the
  // next periodic reconcile instead of issuing a network read.
  if (!knownPost && !privatePost && !detailOpen) return;
  if (privatePost) {
    await privateStore.readMoment(postId);
    // Re-project the refreshed private reaction summary into the
    // public moments store without touching any comment thread.
    moments.hydratePrivateMoments(
      Object.values(usePrivateMomentsStore.getState().postsById),
    );
    return;
  }
  await moments.loadPost(postId);
}

function onRelationshipChanged(payload: RelationshipChangedPayload): void {
  if (!activeScope) return;
  runDetached(
    'relationship changed moments projection refresh',
    enqueueScopedProjection(async (scope) => {
      const relationships = useRelationshipsStore.getState();
      if (payload.action === 'block') {
        const privateMoments = usePrivateMomentsStore.getState();
        const affectedPostIds = Object.values(privateMoments.postsById)
          .filter((post) => post.authorPtid === payload.targetActorPtid)
          .map((post) => post.postId);
        for (const postId of affectedPostIds) {
          usePrivateCommentsStore.getState().markParentUnavailable(
            postId,
            'SOCIAL_PRIVATE_RECIPIENT_BLOCKED',
          );
        }
        await Promise.allSettled(affectedPostIds.map((postId) => (
          usePrivateMomentsStore.getState().revokeMoment(
            postId,
            'RECIPIENT_BLOCKED',
          )
        )));
        if (!isCurrentScope(scope)) throw new MomentsRuntimeScopeChangedError();
      }
      await Promise.allSettled([
        relationships.loadRelationship(payload.targetActorPtid),
        relationships.loadFollowers(payload.targetActorPtid, true),
      ]);
      if (isCurrentScope(scope)) scheduleCoalescedProjectionRefresh();
    }).then(() => undefined),
  );
}

function onMomentResyncRequested(_payload: MomentResyncRequestedPayload): void {
  if (!activeScope) return;
  scheduleCoalescedProjectionRefresh();
}

function onRealtimeResync(_payload: RealtimeResyncPayload): void {
  if (!activeScope) return;
  scheduleCoalescedProjectionRefresh();
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
    await refreshMomentsProjectionNow(scope, 'bootstrap');
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
    if (activeScope) {
      // Genuine deauthentication only. The window is leaving this actor, so
      // explicitly fence its native Secure Content runtime. Same-actor
      // generation churn and cross-actor switches never reach this branch:
      // those are reconciled by re-activation and native identity transitions,
      // and tearing the native runtime down mid-switch would orphan the live
      // lease the new scope is about to use.
      const detachedActorPtid = activeScope.actorPtid;
      const detachedGeneration = activeScope.generation;
      invalidateScope();
      void usePrivateMomentsStore
        .getState()
        .teardownNativeActor(detachedActorPtid, detachedGeneration);
    }
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
  const stationPeerId = payload.stationPeerId.trim();
  stationIdentityHint = stationPeerId
    ? `peer:${stationPeerId}`
    : `station-change:${bootstrapSequence + 1}`;
  void reconcileAuthenticatedRuntime('station-switch');
}

function runPeriodicMomentsReconcile(): void {
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
}

function startReconcileTimer(): void {
  if (reconcileTimer) return;
  reconcileTimer = window.setInterval(() => {
    // Background tabs skip refresh; the foreground listener catches up.
    if (isDocumentHidden()) return;
    runPeriodicMomentsReconcile();
  }, MOMENTS_RECONCILE_INTERVAL_MS);
  unsubscribeForeground = onDocumentForeground(runPeriodicMomentsReconcile);
}

function stopReconcileTimer(): void {
  if (!reconcileTimer) return;
  window.clearInterval(reconcileTimer);
  reconcileTimer = null;
  unsubscribeForeground?.();
  unsubscribeForeground = null;
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
    // Fresh coalescer per install: a pending burst from a previous runtime
    // generation must not fire into the new scope.
    projectionEventCoalescer = createProjectionEventCoalescer();

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
        (state.self?.home_station_peer_id ?? '').trim()
        !== (previous.self?.home_station_peer_id ?? '').trim()
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
      eventBus.subscribe(EVENT.MOMENT_REVOKED, onMomentRevoked),
      eventBus.subscribe(EVENT.MOMENT_COMMENTED, onMomentCommented),
      eventBus.subscribe(EVENT.MOMENT_REACTED, onMomentReacted),
      eventBus.subscribe(EVENT.MOMENT_UPDATED, onMomentUpdated),
      eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, onRelationshipChanged),
      eventBus.subscribe(EVENT.MOMENT_RESYNC_REQUESTED, onMomentResyncRequested),
      eventBus.subscribe(EVENT.REALTIME_RESYNC, onRealtimeResync),
      eventBus.subscribe(EVENT.REALTIME_CONNECTION_STATE, onRealtimeConnectionState),
    ];
    startReconcileTimer();
    void reconcileAuthenticatedRuntime('install');

    teardownRuntime = () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
      projectionEventCoalescer.cancel();
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
