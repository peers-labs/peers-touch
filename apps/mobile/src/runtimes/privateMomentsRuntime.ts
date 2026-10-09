import { useSyncExternalStore } from 'react';

import type {
  MobileRuntimeContext,
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
} from '../app/lifecycle/types';
import {
  isAccessGranted,
  type MobileAuthSession,
} from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import {
  privateSocialActivate,
  privateSocialComments,
  privateSocialCommentSubmit,
  privateSocialOpenMedia,
  privateSocialPrepareText,
  privateSocialPublish,
  privateSocialRead,
  privateSocialReadText,
  privateSocialReact,
  privateSocialReactionRetry,
  privateSocialRecoverWithNativeInput,
  privateSocialReconcile,
  privateSocialSnapshot,
  privateSocialSubmitText,
  privateSocialTeardown,
  privateSocialUnreact,
  type PrivateCommentIntent,
  type PrivateCommentPage,
  type PrivateCommentSubmitResult,
  type PrivateMomentProjection,
  type PrivateMomentReadProjection,
  type PrivateReactionCommandProjection,
  type PrivateReactionMutationResult,
  type PrivateSocialActivationInput,
  type PrivateSocialAccountInput,
  type PrivateSocialInvalidation,
  type PrivateSocialMomentIntent,
  type PrivateSocialTextIntent,
  type PrivateSocialWorkerReport,
} from '../services/mobileCommands';
import { readableErrorMessage } from '../utils/errorMessage';
import { runRuntimeSessionTransition } from './runtimeSessionTransition';

export type PrivateSocialVisiblePublishState =
  | 'AUDIENCE_REQUIRED'
  | 'CHECKING_PRIVATE_READINESS'
  | 'READY_PUBLIC'
  | 'READY_PRIVATE'
  | 'PRIVATE_UNSUPPORTED'
  | 'RECIPIENT_KEY_UNAVAILABLE'
  | 'AUDIENCE_TOO_LARGE'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PUBLISH_FAILED';

export type PrivateSocialVisibleReadState =
  | 'LOADING_AUTHORIZED_RESOURCE'
  | 'WAITING_FOR_PRIVATE_KEY'
  | 'RECOVERY_REQUIRED'
  | 'RECOVERY_KEY_UNAVAILABLE'
  | 'DECRYPTING'
  | 'CONTENT_READY'
  | 'AUTHENTICATION_REQUIRED'
  | 'NOT_FOUND_OR_NOT_AUTHORIZED'
  | 'INTEGRITY_FAILURE'
  | 'PRIVATE_UNSUPPORTED_ON_DEVICE'
  | 'DELETED_OR_REVOKED';

export interface PrivateCommentThreadProjection {
  readonly comments: readonly NonNullable<PrivateCommentSubmitResult['comment']>[];
  readonly nextCursor: string;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly initialized: boolean;
  readonly errorMessage: string | null;
}

export interface PrivateMomentsRuntimeSnapshot {
  readonly active: boolean;
  readonly reconciling: boolean;
  readonly stationPeerId: string | null;
  readonly actorPtid: string | null;
  readonly deviceId: string | null;
  readonly lifecycleGeneration: string;
  readonly activationGeneration: number;
  readonly projections: readonly PrivateMomentProjection[];
  readonly postsById: Readonly<Record<string, PrivateMomentReadProjection>>;
  readonly commentDrafts: readonly PrivateCommentSubmitResult['draft'][];
  readonly comments: readonly NonNullable<PrivateCommentSubmitResult['comment']>[];
  readonly reactionCommands: readonly PrivateReactionCommandProjection[];
  readonly commentThreadsByPostId: Readonly<Record<string, PrivateCommentThreadProjection>>;
  readonly publishStateHistory: readonly PrivateSocialVisiblePublishState[];
  readonly readStateHistoryByPostId: Readonly<Record<string, readonly PrivateSocialVisibleReadState[]>>;
  readonly lastReport: PrivateSocialWorkerReport | null;
  readonly errorMessage: string | null;
}

interface PrivateSocialSessionScope extends PrivateSocialAccountInput {
  readonly sessionId: string;
  readonly activationGeneration: number;
  readonly projectionFenceRevision: number;
}

const listeners = new Set<() => void>();
let snapshot: PrivateMomentsRuntimeSnapshot = emptySnapshot();
let activeScope: PrivateSocialSessionScope | null = null;
let transition: Promise<void> = Promise.resolve();
let projectionFenceRevision = 0;

export function usePrivateMomentsRuntime(): PrivateMomentsRuntimeSnapshot {
  return useSyncExternalStore(subscribe, readPrivateMomentsSnapshot, readPrivateMomentsSnapshot);
}

export function readPrivateMomentsSnapshot(): PrivateMomentsRuntimeSnapshot {
  return snapshot;
}

export function fencePrivateMomentsRuntimeProjection(): void {
  projectionFenceRevision += 1;
  setSnapshot(emptySnapshot());
}

export function createPrivateMomentsRuntimeDescriptor(): MobileRuntimeDescriptor {
  let unsubscribe: (() => void) | null = null;
  let suspended = false;
  let runtimeContext: MobileRuntimeContext | null = null;

  return {
    id: 'private-social',
    title: 'Private Social Runtime',
    responsibility:
      'Owns the mobile-web projection of Native private Social durability and typed actions; cryptographic and replay authority remain in Mobile Rust.',
    dependsOn: ['session', 'secure-storage', 'messaging'],

    async bootstrap(context): Promise<void> {
      runtimeContext = context;
      suspended = false;
      unsubscribe = useAuthStore.subscribe((state, previous) => {
        const session = admittedSession(state);
        const previousSession = admittedSession(previous);
        if (sessionKey(session) === sessionKey(previousSession)) return;
        fencePrivateMomentsRuntimeProjection();
        if (runtimeContext) {
          void enqueueSessionTransition(session, suspended, runtimeContext)
            .catch(() => undefined);
        }
      });
      const session = admittedSession(useAuthStore.getState());
      await enqueueSessionTransition(session, suspended, context);
    },

    async suspend(): Promise<void> {
      suspended = true;
      await transition;
    },

    async resume(context): Promise<void> {
      runtimeContext = context;
      suspended = false;
      const session = admittedSession(useAuthStore.getState());
      await enqueueSessionTransition(session, suspended, context);
      await reconcilePrivateMoments();
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      fencePrivateMomentsRuntimeProjection();
      unsubscribe?.();
      unsubscribe = null;
      runtimeContext = null;
      await transition;
      const scope = activeScope;
      activeScope = null;
      if (scope) await privateSocialTeardown(operationScope(scope));
      return {
        runtimeId: 'private-social',
        success: true,
        durationMs: performance.now() - start,
      };
    },
  };
}

export async function publishPrivateTextMoment(
  intent: PrivateSocialTextIntent,
): Promise<PrivateMomentProjection> {
  const scope = requireActiveScope();
  appendPublishStates('CHECKING_PRIVATE_READINESS');
  try {
    const prepared = await privateSocialPrepareText({
      ...operationScope(scope),
      ...intent,
    });
    if (!isCurrentScope(scope)) {
      throw new Error('mobile.privateSocial.stalePublishCompletion');
    }
    mergeProjection(prepared);
    if (prepared.state !== 'READY_PRIVATE') {
      appendPublishStates(visibleNativePublishState(prepared.state));
      return prepared;
    }
    appendPublishStates('READY_PRIVATE', 'PUBLISHING');
    mergeProjection({ ...prepared, state: 'PUBLISHING' });
    const projection = await privateSocialSubmitText({
      ...operationScope(scope),
      draftId: intent.draftId,
      draftRevision: intent.draftRevision,
    });
    if (!isCurrentScope(scope)) {
      throw new Error('mobile.privateSocial.stalePublishCompletion');
    }
    mergeProjection(projection);
    appendPublishStates(visibleNativePublishState(projection.state));
    return projection;
  } catch (error) {
    if (isCurrentScope(scope)) {
      appendPublishStates(publishFailureState(error));
      setSnapshot({
        ...snapshot,
        errorMessage: readableErrorMessage(error),
      });
    }
    throw error;
  }
}

export async function trackPublicMomentPublish<T>(
  operation: () => Promise<T>,
  isPublished: (result: T) => boolean,
): Promise<T> {
  const session = admittedSession(useAuthStore.getState());
  if (!session) throw new Error('mobile.privateSocial.authenticationRequired');
  const expectedSessionKey = sessionKey(session);
  const expectedFenceRevision = projectionFenceRevision;
  appendPublishStates('READY_PUBLIC', 'PUBLISHING');
  try {
    const result = await operation();
    if (
      sessionKey(admittedSession(useAuthStore.getState())) !== expectedSessionKey
      || projectionFenceRevision !== expectedFenceRevision
    ) {
      throw new Error('mobile.privateSocial.stalePublicPublishCompletion');
    }
    appendPublishStates(isPublished(result) ? 'PUBLISHED' : 'PUBLISH_FAILED');
    return result;
  } catch (error) {
    if (
      sessionKey(admittedSession(useAuthStore.getState())) === expectedSessionKey
      && projectionFenceRevision === expectedFenceRevision
    ) {
      appendPublishStates('PUBLISH_FAILED');
      setSnapshot({
        ...snapshot,
        errorMessage: readableErrorMessage(error),
      });
    }
    throw error;
  }
}

export async function publishPrivateMoment(
  intent: PrivateSocialMomentIntent,
): Promise<PrivateMomentProjection> {
  const scope = requireActiveScope();
  appendPublishStates('CHECKING_PRIVATE_READINESS');
  try {
    const projection = await privateSocialPublish({
      ...operationScope(scope),
      ...intent,
    });
    if (!isCurrentScope(scope)) {
      throw new Error('mobile.privateSocial.stalePublishCompletion');
    }
    mergeProjection(projection);
    appendPublishStates(visibleNativePublishState(projection.state));
    return projection;
  } catch (error) {
    if (isCurrentScope(scope)) {
      appendPublishStates(publishFailureState(error));
      setSnapshot({
        ...snapshot,
        errorMessage: readableErrorMessage(error),
      });
    }
    throw error;
  }
}

export async function readPrivateTextMoment(
  postId: string,
): Promise<PrivateMomentReadProjection> {
  const scope = requireActiveScope();
  const stablePostId = postId.trim();
  if (!stablePostId || stablePostId !== postId) {
    throw new Error('mobile.privateSocial.invalidPostId');
  }
  requirePrivateMomentAccessOpen(stablePostId);
  appendReadStates(postId, 'LOADING_AUTHORIZED_RESOURCE');
  try {
    const projection = await privateSocialReadText({
      ...operationScope(scope),
      postId: stablePostId,
    });
    requireCurrentPostCompletion(scope, stablePostId, 'mobile.privateSocial.staleReadCompletion');
    if (projection.postId !== stablePostId) {
      throw new Error('mobile.privateSocial.receiverIdentityMismatch');
    }
    if (projection.state === 'RECOVERY_REQUIRED') {
      appendReadStates(postId, 'WAITING_FOR_PRIVATE_KEY');
    }
    setSnapshot({
      ...snapshot,
      postsById: mergeReadProjectionMap(snapshot.postsById, [projection]),
      errorMessage: null,
    });
    appendReadStates(postId, projection.state);
    return projection;
  } catch (error) {
    if (isCurrentScope(scope)) {
      setSnapshot({
        ...snapshot,
        errorMessage: readableErrorMessage(error),
      });
    }
    throw error;
  }
}

export async function readPrivateMoment(postId: string): Promise<PrivateMomentReadProjection> {
  const scope = requireActiveScope();
  const stablePostId = postId.trim();
  if (!stablePostId || stablePostId !== postId) {
    throw new Error('mobile.privateSocial.invalidPostId');
  }
  requirePrivateMomentAccessOpen(stablePostId);
  appendReadStates(postId, 'LOADING_AUTHORIZED_RESOURCE');
  try {
    const projection = await privateSocialRead({
      ...operationScope(scope),
      postId: stablePostId,
    });
    requireCurrentPostCompletion(scope, stablePostId, 'mobile.privateSocial.staleReadCompletion');
    if (projection.postId !== stablePostId) {
      throw new Error('mobile.privateSocial.staleReadCompletion');
    }
    if (projection.state === 'RECOVERY_REQUIRED') {
      appendReadStates(postId, 'WAITING_FOR_PRIVATE_KEY');
    }
    setSnapshot({
      ...snapshot,
      postsById: mergeReadProjectionMap(snapshot.postsById, [projection]),
      errorMessage: null,
    });
    appendReadStates(postId, projection.state);
    return projection;
  } catch (error) {
    if (isCurrentScope(scope)) {
      setSnapshot({ ...snapshot, errorMessage: readableErrorMessage(error) });
    }
    throw error;
  }
}

export async function openPrivateMomentMedia(
  postId: string,
  objectId: string,
): Promise<PrivateMomentReadProjection> {
  const scope = requireActiveScope();
  const stablePostId = postId.trim();
  const stableObjectId = objectId.trim();
  if (!stablePostId || !stableObjectId) {
    throw new Error('mobile.privateSocial.invalidMediaIdentity');
  }
  requirePrivateMomentAccessOpen(stablePostId);
  const projection = await privateSocialOpenMedia({
    ...operationScope(scope),
    postId: stablePostId,
    objectId: stableObjectId,
  });
  requireCurrentPostCompletion(scope, stablePostId, 'mobile.privateSocial.staleMediaCompletion');
  setSnapshot({
    ...snapshot,
    postsById: mergeReadProjectionMap(snapshot.postsById, [projection]),
    errorMessage: null,
  });
  return projection;
}

export async function recoverPrivateMoment(
  postId: string,
  recoveryEpoch = 1,
): Promise<PrivateMomentReadProjection> {
  const scope = requireActiveScope();
  const stablePostId = postId.trim();
  if (
    !stablePostId
    || stablePostId !== postId
    || !Number.isSafeInteger(recoveryEpoch)
    || recoveryEpoch <= 0
  ) {
    throw new Error('mobile.privateSocial.invalidPostId');
  }
  requirePrivateMomentAccessOpen(stablePostId);
  appendReadStates(stablePostId, 'WAITING_FOR_PRIVATE_KEY');
  const projection = await privateSocialRecoverWithNativeInput({
    ...operationScope(scope),
    postId: stablePostId,
    recoveryEpoch,
  });
  requireCurrentPostCompletion(scope, stablePostId, 'mobile.privateSocial.staleRecoveryCompletion');
  setSnapshot({
    ...snapshot,
    postsById: mergeReadProjectionMap(snapshot.postsById, [projection]),
    errorMessage: null,
  });
  appendReadStates(postId, projection.state);
  return projection;
}

export async function submitPrivateComment(
  intent: PrivateCommentIntent,
): Promise<PrivateCommentSubmitResult> {
  const scope = requireActiveScope();
  requirePrivateMomentAccessOpen(intent.postId);
  const result = await privateSocialCommentSubmit({ ...operationScope(scope), ...intent });
  requireCurrentPostCompletion(
    scope,
    intent.postId,
    'mobile.privateSocial.staleCommentCompletion',
  );
  setSnapshot({
    ...snapshot,
    commentDrafts: mergeCommentDraftLists(snapshot.commentDrafts, [result.draft]),
    comments: result.comment
      ? mergeCommentLists(snapshot.comments, [result.comment])
      : snapshot.comments,
    commentThreadsByPostId: result.comment
      ? updatePrivateCommentThread(
        snapshot.commentThreadsByPostId,
        intent.postId,
        (thread) => ({
          ...thread,
          comments: mergeCommentLists(thread.comments, [result.comment!]),
          initialized: true,
          errorMessage: null,
        }),
      )
      : snapshot.commentThreadsByPostId,
    errorMessage: null,
  });
  return result;
}

export async function readPrivateComments(
  postId: string,
  cursor = '',
  limit = 20,
): Promise<PrivateCommentPage> {
  const scope = requireActiveScope();
  const stablePostId = postId.trim();
  if (!stablePostId || stablePostId !== postId) {
    throw new Error('mobile.privateSocial.invalidPostId');
  }
  requirePrivateMomentAccessOpen(stablePostId);
  setSnapshot({
    ...snapshot,
    commentThreadsByPostId: updatePrivateCommentThread(
      snapshot.commentThreadsByPostId,
      stablePostId,
      (thread) => ({ ...thread, loading: true, errorMessage: null }),
    ),
  });
  try {
    const page = await privateSocialComments({
      ...operationScope(scope),
      postId: stablePostId,
      cursor,
      limit,
    });
    requireCurrentPostCompletion(
      scope,
      stablePostId,
      'mobile.privateSocial.staleCommentReadCompletion',
    );
    setSnapshot({
      ...snapshot,
      comments: mergeCommentLists(snapshot.comments, page.comments),
      commentThreadsByPostId: updatePrivateCommentThread(
        snapshot.commentThreadsByPostId,
        stablePostId,
        (thread) => ({
          comments: cursor
            ? mergeCommentLists(thread.comments, page.comments)
            : mergeCommentLists([], page.comments),
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          loading: false,
          initialized: true,
          errorMessage: null,
        }),
      ),
      errorMessage: null,
    });
    return page;
  } catch (error) {
    if (isCurrentScope(scope)) {
      setSnapshot({
        ...snapshot,
        commentThreadsByPostId: updatePrivateCommentThread(
          snapshot.commentThreadsByPostId,
          stablePostId,
          (thread) => ({
            ...thread,
            loading: false,
            initialized: true,
            errorMessage: readableErrorMessage(error),
          }),
        ),
      });
    }
    throw error;
  }
}

export async function setPrivateMomentReaction(
  postId: string,
  kind: number,
  active: boolean,
): Promise<PrivateReactionMutationResult> {
  const scope = requireActiveScope();
  const stablePostId = postId.trim();
  if (!stablePostId || stablePostId !== postId || !Number.isInteger(kind) || kind <= 0) {
    throw new Error('mobile.privateSocial.invalidReaction');
  }
  requirePrivateMomentAccessOpen(stablePostId);
  const result = await (active ? privateSocialReact : privateSocialUnreact)({
    ...operationScope(scope),
    postId: stablePostId,
    kind,
  });
  requireCurrentPostCompletion(scope, stablePostId, 'mobile.privateSocial.staleReactionCompletion');
  applyPrivateReactionResult(result);
  return result;
}

export async function retryPrivateMomentReaction(
  commandId: string,
): Promise<PrivateReactionMutationResult> {
  const scope = requireActiveScope();
  const result = await privateSocialReactionRetry({
    ...operationScope(scope),
    commandId,
  });
  if (!isCurrentScope(scope)) {
    throw new Error('mobile.privateSocial.staleReactionCompletion');
  }
  applyPrivateReactionResult(result);
  return result;
}

export async function reconcilePrivateMoments(): Promise<PrivateSocialWorkerReport | null> {
  const scope = activeScope;
  if (!scope || !isCurrentScope(scope)) return null;
  setSnapshot({ ...snapshot, reconciling: true, errorMessage: null });
  try {
    const operation = operationScope(scope);
    const report = await privateSocialReconcile(operation);
    requirePrivateSocialPreKeyReadiness(report);
    const nativeSnapshot = await privateSocialSnapshot(operation);
    if (!isCurrentScope(scope)) return null;
    const postsById = mergeReadProjectionMap(
      snapshot.postsById,
      nativeSnapshot.readProjections,
    );
    const revokedPostIds = deletedOrRevokedPostIds(postsById);
    setSnapshot({
      ...snapshot,
      reconciling: false,
      projections: mergeProjectionLists(
        snapshot.projections,
        nativeSnapshot.publishProjections,
      ),
      postsById,
      commentDrafts: nativeSnapshot.commentDrafts.filter(
        (draft) => !revokedPostIds.has(draft.postId),
      ),
      comments: nativeSnapshot.comments.filter(
        (comment) => !revokedPostIds.has(comment.postId),
      ),
      reactionCommands: nativeSnapshot.reactionCommands.filter(
        (command) => !revokedPostIds.has(command.postId),
      ),
      commentThreadsByPostId: omitPrivateCommentThreads(
        snapshot.commentThreadsByPostId,
        revokedPostIds,
      ),
      lastReport: report,
      errorMessage: null,
    });
    return report;
  } catch (error) {
    if (isCurrentScope(scope)) {
      setSnapshot({
        ...snapshot,
        reconciling: false,
        errorMessage: readableErrorMessage(error),
      });
    }
    throw error;
  }
}

export async function invalidatePrivateMoments(
  invalidations: readonly PrivateSocialInvalidation[],
): Promise<readonly PrivateMomentReadProjection[]> {
  if (invalidations.length === 0) return [];
  const scope = activeScope;
  if (!scope || !isCurrentScope(scope)) return [];

  const localTombstones = localInvalidationProjections(invalidations);
  applyPrivateInvalidationProjections(localTombstones);
  try {
    const result = await privateSocialReconcile({
      ...operationScope(scope),
      invalidations,
    });
    if (!isCurrentScope(scope)) {
      throw new Error('mobile.privateSocial.staleInvalidationCompletion');
    }
    applyPrivateInvalidationProjections(result.invalidatedReadProjections);
    return result.invalidatedReadProjections;
  } catch (error) {
    if (isCurrentScope(scope)) {
      setSnapshot({ ...snapshot, errorMessage: readableErrorMessage(error) });
    }
    throw error;
  }
}

export function mergeProjectionLists(
  current: readonly PrivateMomentProjection[],
  incoming: readonly PrivateMomentProjection[],
): readonly PrivateMomentProjection[] {
  const byDraft = new Map(
    current.map((projection) => [draftKey(projection), projection] as const),
  );
  for (const projection of incoming) {
    const key = draftKey(projection);
    const existing = byDraft.get(key);
    if (!existing || projection.generation >= existing.generation) {
      byDraft.set(key, projection);
    }
  }
  return [...byDraft.values()].sort((left, right) => (
    right.draftRevision - left.draftRevision
    || left.draftId.localeCompare(right.draftId)
  ));
}

export function mergeReadProjectionMap(
  current: Readonly<Record<string, PrivateMomentReadProjection>>,
  incoming: readonly PrivateMomentReadProjection[],
): Readonly<Record<string, PrivateMomentReadProjection>> {
  const merged = { ...current };
  for (const projection of incoming) {
    const existing = merged[projection.postId];
    if (
      existing?.state === 'DELETED_OR_REVOKED'
      && projection.state !== 'DELETED_OR_REVOKED'
    ) {
      continue;
    }
    if (
      !existing
      || projection.state !== 'CONTENT_READY'
      || existing.state !== 'CONTENT_READY'
      || compareGeneration(projection.generation, existing.generation) >= 0
    ) {
      merged[projection.postId] = projection;
    }
  }
  return merged;
}

function mergeCommentDraftLists(
  current: PrivateMomentsRuntimeSnapshot['commentDrafts'],
  incoming: PrivateMomentsRuntimeSnapshot['commentDrafts'],
): PrivateMomentsRuntimeSnapshot['commentDrafts'] {
  const byDraft = new Map(
    current.map((draft) => [`${draft.draftId}\u001f${draft.draftRevision}`, draft] as const),
  );
  for (const draft of incoming) {
    byDraft.set(`${draft.draftId}\u001f${draft.draftRevision}`, draft);
  }
  return [...byDraft.values()].sort((left, right) => (
    right.draftRevision - left.draftRevision
    || left.draftId.localeCompare(right.draftId)
  ));
}

function mergeCommentLists(
  current: PrivateMomentsRuntimeSnapshot['comments'],
  incoming: PrivateMomentsRuntimeSnapshot['comments'],
): PrivateMomentsRuntimeSnapshot['comments'] {
  const byComment = new Map(
    current.map((comment) => [comment.commentId, comment] as const),
  );
  for (const comment of incoming) {
    const existing = byComment.get(comment.commentId);
    if (!existing || compareGeneration(comment.generation, existing.generation) >= 0) {
      byComment.set(comment.commentId, comment);
    }
  }
  return [...byComment.values()];
}

function localInvalidationProjections(
  invalidations: readonly PrivateSocialInvalidation[],
): PrivateMomentReadProjection[] {
  const retained = Object.values(snapshot.postsById);
  const projections: PrivateMomentReadProjection[] = [];
  for (const invalidation of invalidations) {
    const postIds = invalidation.reason === 'RESOURCE_DELETED'
      ? [invalidation.postId]
      : invalidation.reason === 'DEVICE_REVOKED'
        ? retained.map((projection) => projection.postId)
        : retained
            .filter((projection) => projection.authorPtid === invalidation.authorPtid)
            .map((projection) => projection.postId);
    for (const postId of new Set(postIds)) {
      projections.push({
        postId,
        contentId: `unavailable:${postId}`,
        generation: '0',
        authorPtid: '',
        audienceKind: 'UNKNOWN',
        state: 'DELETED_OR_REVOKED',
        mentions: [],
        reactions: [],
        reactionRevision: '0',
        reactionsHydrated: false,
        errorCode: invalidation.reason,
      });
    }
  }
  return projections;
}

function applyPrivateInvalidationProjections(
  projections: readonly PrivateMomentReadProjection[],
): void {
  if (projections.length === 0) return;
  const revokedPostIds = new Set(projections.map((projection) => projection.postId));
  const readStateHistoryByPostId = { ...snapshot.readStateHistoryByPostId };
  for (const postId of revokedPostIds) {
    const history = readStateHistoryByPostId[postId] ?? [];
    readStateHistoryByPostId[postId] = [
      ...history,
      'DELETED_OR_REVOKED' as const,
    ].slice(-MAX_STATE_HISTORY);
  }
  setSnapshot({
    ...snapshot,
    postsById: mergeReadProjectionMap(snapshot.postsById, projections),
    commentDrafts: snapshot.commentDrafts.filter(
      (draft) => !revokedPostIds.has(draft.postId),
    ),
    comments: snapshot.comments.filter(
      (comment) => !revokedPostIds.has(comment.postId),
    ),
    reactionCommands: snapshot.reactionCommands.filter(
      (command) => !revokedPostIds.has(command.postId),
    ),
    commentThreadsByPostId: omitPrivateCommentThreads(
      snapshot.commentThreadsByPostId,
      revokedPostIds,
    ),
    readStateHistoryByPostId,
    errorMessage: null,
  });
}

function deletedOrRevokedPostIds(
  postsById: Readonly<Record<string, PrivateMomentReadProjection>>,
): ReadonlySet<string> {
  return new Set(
    Object.values(postsById)
      .filter((projection) => projection.state === 'DELETED_OR_REVOKED')
      .map((projection) => projection.postId),
  );
}

function omitPrivateCommentThreads(
  threads: PrivateMomentsRuntimeSnapshot['commentThreadsByPostId'],
  postIds: ReadonlySet<string>,
): PrivateMomentsRuntimeSnapshot['commentThreadsByPostId'] {
  return Object.fromEntries(
    Object.entries(threads).filter(([postId]) => !postIds.has(postId)),
  );
}

function applyPrivateReactionResult(result: PrivateReactionMutationResult): void {
  const current = snapshot.postsById[result.command.postId];
  if (!current || current.state !== 'CONTENT_READY') {
    throw new Error('mobile.privateSocial.reactionProjectionUnavailable');
  }
  const postsById = result.command.state === 'REACTION_COMMITTED'
    ? mergeReadProjectionMap(snapshot.postsById, [{
      ...current,
      reactions: result.reactions,
      reactionRevision: result.projectionRevision,
      reactionsHydrated: true,
    }])
    : snapshot.postsById;
  setSnapshot({
    ...snapshot,
    postsById,
    reactionCommands: mergeReactionCommands(
      snapshot.reactionCommands,
      [result.command],
    ),
    errorMessage: null,
  });
}

function mergeReactionCommands(
  current: readonly PrivateReactionCommandProjection[],
  incoming: readonly PrivateReactionCommandProjection[],
): readonly PrivateReactionCommandProjection[] {
  const byPost = new Map(
    current.map((command) => [command.postId, command] as const),
  );
  for (const command of incoming) {
    byPost.set(command.postId, command);
  }
  return [...byPost.values()];
}

function updatePrivateCommentThread(
  current: PrivateMomentsRuntimeSnapshot['commentThreadsByPostId'],
  postId: string,
  update: (
    thread: PrivateCommentThreadProjection,
  ) => PrivateCommentThreadProjection,
): PrivateMomentsRuntimeSnapshot['commentThreadsByPostId'] {
  const existing = current[postId] ?? {
    comments: [],
    nextCursor: '',
    hasMore: true,
    loading: false,
    initialized: false,
    errorMessage: null,
  };
  return {
    ...current,
    [postId]: update(existing),
  };
}

function enqueueSessionTransition(
  session: MobileAuthSession | null,
  suspended: boolean,
  context: MobileRuntimeContext,
): Promise<void> {
  const requestedSessionKey = sessionKey(session);
  const requestedFenceRevision = projectionFenceRevision;
  const task = runRuntimeSessionTransition({
    previous: transition,
    context,
    isScopeCurrent: () => (
      sessionKey(admittedSession(useAuthStore.getState())) === requestedSessionKey
      && projectionFenceRevision === requestedFenceRevision
    ),
    run: (isCurrent) => synchronizeSession(
      session,
      suspended,
      requestedFenceRevision,
      isCurrent,
    ),
    onError: (error) => {
      const currentSession = admittedSession(useAuthStore.getState());
      if (
        sessionKey(currentSession) !== requestedSessionKey
        || projectionFenceRevision !== requestedFenceRevision
        || (activeScope && !matchesAuthSession(activeScope, currentSession))
      ) {
        return;
      }
      setSnapshot({
        ...snapshot,
        active: false,
        reconciling: false,
        errorMessage: readableErrorMessage(error),
      });
    },
  });
  transition = task.catch(() => undefined);
  return task;
}

async function synchronizeSession(
  session: MobileAuthSession | null,
  suspended: boolean,
  requestedFenceRevision: number,
  isCurrent: () => boolean,
): Promise<void> {
  if (activeScope && !matchesAuthSession(activeScope, session)) {
    const previousScope = activeScope;
    activeScope = null;
    setSnapshot(emptySnapshot());
    try {
      await privateSocialTeardown(operationScope(previousScope));
    } catch (error) {
      if (matchesAuthSession(previousScope, admittedSession(useAuthStore.getState()))) {
        throw error;
      }
    }
  }
  if (!isCurrent() || !session || suspended) return;
  if (activeScope && matchesAuthSession(activeScope, session)) {
    activeScope = {
      ...activeScope,
      projectionFenceRevision: requestedFenceRevision,
    };
    return;
  }
  const account = accountInput(session);
  const status = await privateSocialActivate(account);
  const cleanupScope = cleanupScopeFromStatus(
    status,
    account.lifecycleGeneration,
  );
  try {
    const scope = activatedScope(session, status, requestedFenceRevision);
    if (
      !isCurrent()
      || !matchesAuthSession(scope, admittedSession(useAuthStore.getState()))
    ) {
      await privateSocialTeardown(operationScope(scope));
      return;
    }
    const report = await privateSocialReconcile(operationScope(scope));
    requirePrivateSocialPreKeyReadiness(report);
    if (
      !isCurrent()
      || !matchesAuthSession(scope, admittedSession(useAuthStore.getState()))
    ) {
      await privateSocialTeardown(operationScope(scope));
      return;
    }
    const nativeSnapshot = await privateSocialSnapshot(operationScope(scope));
    if (
      !isCurrent()
      || !matchesAuthSession(scope, admittedSession(useAuthStore.getState()))
    ) {
      await privateSocialTeardown(operationScope(scope));
      return;
    }
    activeScope = scope;
    setSnapshot({
      active: true,
      reconciling: false,
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      deviceId: scope.deviceId,
      lifecycleGeneration: String(scope.lifecycleGeneration),
      activationGeneration: scope.activationGeneration,
      projections: nativeSnapshot.publishProjections,
      commentDrafts: nativeSnapshot.commentDrafts,
      comments: nativeSnapshot.comments,
      reactionCommands: nativeSnapshot.reactionCommands,
      commentThreadsByPostId: {},
      postsById: mergeReadProjectionMap({}, nativeSnapshot.readProjections),
      publishStateHistory: ['AUDIENCE_REQUIRED'],
      readStateHistoryByPostId: {},
      lastReport: report,
      errorMessage: null,
    });
  } catch (error) {
    if (!cleanupScope) {
      if (!status.active) throw error;
      throw new Error(
        `${readableErrorMessage(error)}; native cleanup failed: ` +
        'mobile.privateSocial.activationCleanupIdentityUnavailable',
      );
    }
    try {
      await privateSocialTeardown(cleanupScope);
    } catch (cleanupError) {
      throw new Error(
        `${readableErrorMessage(error)}; native cleanup failed: ${readableErrorMessage(cleanupError)}`,
      );
    }
    throw error;
  }
}

function requirePrivateSocialPreKeyReadiness(report: PrivateSocialWorkerReport): void {
  if (
    !Number.isSafeInteger(report.endpointPrekeysAvailable)
    || report.endpointPrekeysAvailable <= 0
  ) {
    throw new Error('mobile.privateSocial.endpointPrekeysUnavailable');
  }
  if (
    report.recoveryPrekeysAvailable !== null
    && (
      !Number.isSafeInteger(report.recoveryPrekeysAvailable)
      || report.recoveryPrekeysAvailable <= 0
    )
  ) {
    throw new Error('mobile.privateSocial.recoveryPrekeysUnavailable');
  }
}

const MAX_STATE_HISTORY = 64;

function appendPublishStates(...states: PrivateSocialVisiblePublishState[]): void {
  setSnapshot({
    ...snapshot,
    publishStateHistory: [...snapshot.publishStateHistory, ...states].slice(-MAX_STATE_HISTORY),
  });
}

function appendReadStates(postId: string, ...states: PrivateSocialVisibleReadState[]): void {
  const current = snapshot.readStateHistoryByPostId[postId] ?? [];
  setSnapshot({
    ...snapshot,
    readStateHistoryByPostId: {
      ...snapshot.readStateHistoryByPostId,
      [postId]: [...current, ...states].slice(-MAX_STATE_HISTORY),
    },
  });
}

function publishFailureState(error: unknown): PrivateSocialVisiblePublishState {
  const message = readableErrorMessage(error);
  if (message.includes('SOCIAL_PRIVATE_UNSUPPORTED')) return 'PRIVATE_UNSUPPORTED';
  if (message.includes('AUDIENCE_TOO_LARGE')) return 'AUDIENCE_TOO_LARGE';
  if (
    message.includes('PREKEY')
    || message.includes('KEY_UNAVAILABLE')
    || message.includes('SOCIAL_PRIVATE_DEPENDENCY_FAILURE')
  ) {
    return 'RECIPIENT_KEY_UNAVAILABLE';
  }
  return 'PUBLISH_FAILED';
}

function visibleNativePublishState(
  state: PrivateMomentProjection['state'],
): PrivateSocialVisiblePublishState {
  switch (state) {
    case 'READY_PRIVATE':
      return 'READY_PRIVATE';
    case 'PUBLISHED':
      return 'PUBLISHED';
    case 'PREPARING':
    case 'PUBLISHING':
    case 'UNKNOWN_OUTCOME':
      return 'PUBLISHING';
    case 'PUBLISH_FAILED':
      return 'PUBLISH_FAILED';
  }
}

function mergeProjection(projection: PrivateMomentProjection): void {
  setSnapshot({
    ...snapshot,
    projections: mergeProjectionLists(snapshot.projections, [projection]),
    errorMessage: null,
  });
}

function requireActiveScope(): PrivateSocialSessionScope {
  if (!activeScope || !isCurrentScope(activeScope)) {
    throw new Error('mobile.privateSocial.runtimeInactive');
  }
  return activeScope;
}

function requirePrivateMomentAccessOpen(postId: string): void {
  if (snapshot.postsById[postId]?.state === 'DELETED_OR_REVOKED') {
    throw new Error('mobile.privateSocial.deletedOrRevoked');
  }
}

function requireCurrentPostCompletion(
  scope: PrivateSocialSessionScope,
  postId: string,
  staleError: string,
): void {
  if (!isCurrentScope(scope)) throw new Error(staleError);
  requirePrivateMomentAccessOpen(postId);
}

function accountInput(session: MobileAuthSession): PrivateSocialActivationInput {
  return {
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorRef.ptid,
    deviceId: session.deviceId,
    lifecycleGeneration: session.lifecycleGeneration,
  };
}

function operationScope(scope: PrivateSocialSessionScope): PrivateSocialAccountInput {
  return {
    stationPeerId: scope.stationPeerId,
    actorPtid: scope.actorPtid,
    deviceId: scope.deviceId,
    lifecycleGeneration: scope.lifecycleGeneration,
    activationGeneration: scope.activationGeneration,
  };
}

function cleanupScopeFromStatus(
  status: Awaited<ReturnType<typeof privateSocialActivate>>,
  lifecycleGeneration: number,
): PrivateSocialAccountInput | null {
  if (
    !status.active
    || !status.stationPeerId
    || status.stationPeerId.trim() !== status.stationPeerId
    || !status.actorPtid
    || status.actorPtid.trim() !== status.actorPtid
    || !status.deviceId
    || status.deviceId.trim() !== status.deviceId
    || !Number.isSafeInteger(status.activationGeneration)
    || status.activationGeneration <= 0
  ) {
    return null;
  }
  return {
    stationPeerId: status.stationPeerId,
    actorPtid: status.actorPtid,
    deviceId: status.deviceId,
    lifecycleGeneration,
    activationGeneration: status.activationGeneration,
  };
}

function activatedScope(
  session: MobileAuthSession,
  status: Awaited<ReturnType<typeof privateSocialActivate>>,
  requestedFenceRevision: number,
): PrivateSocialSessionScope {
  const account = accountInput(session);
  if (
    !status.active
    || status.stationPeerId !== account.stationPeerId
    || status.actorPtid !== account.actorPtid
    || status.deviceId !== account.deviceId
    || !Number.isSafeInteger(status.activationGeneration)
    || status.activationGeneration <= 0
  ) {
    throw new Error('mobile.privateSocial.activationIdentityMismatch');
  }
  return {
    ...account,
    sessionId: session.sessionId,
    activationGeneration: status.activationGeneration,
    projectionFenceRevision: requestedFenceRevision,
  };
}

function admittedSession(
  state: ReturnType<typeof useAuthStore.getState>,
): MobileAuthSession | null {
  return isAccessGranted(state.accessDecision) ? state.session : null;
}

function sessionKey(session: MobileAuthSession | null): string {
  return session
    ? [
      session.stationPeerId,
      session.actorRef.ptid,
      session.deviceId,
      session.lifecycleGeneration,
      session.sessionId,
    ].join('\u001f')
    : '';
}

function matchesAuthSession(
  scope: PrivateSocialSessionScope,
  session: MobileAuthSession | null,
): boolean {
  return Boolean(
    session
    && scope.stationPeerId === session.stationPeerId
    && scope.actorPtid === session.actorRef.ptid
    && scope.deviceId === session.deviceId
    && scope.lifecycleGeneration === session.lifecycleGeneration
    && scope.sessionId === session.sessionId,
  );
}

function isCurrentScope(scope: PrivateSocialSessionScope): boolean {
  return Boolean(
    activeScope
    && scope.stationPeerId === activeScope.stationPeerId
    && scope.actorPtid === activeScope.actorPtid
    && scope.sessionId === activeScope.sessionId
    && scope.activationGeneration === activeScope.activationGeneration
    && scope.projectionFenceRevision === activeScope.projectionFenceRevision
    && scope.projectionFenceRevision === projectionFenceRevision
    && matchesAuthSession(scope, admittedSession(useAuthStore.getState())),
  );
}

function draftKey(projection: PrivateMomentProjection): string {
  return `${projection.draftId}\u001f${projection.draftRevision}`;
}

function compareGeneration(left: string, right: string): number {
  try {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
}

function emptySnapshot(): PrivateMomentsRuntimeSnapshot {
  return {
    active: false,
    reconciling: false,
    stationPeerId: null,
    actorPtid: null,
    deviceId: null,
    lifecycleGeneration: '',
    activationGeneration: 0,
    projections: [],
    postsById: {},
    commentDrafts: [],
    comments: [],
    reactionCommands: [],
    commentThreadsByPostId: {},
    publishStateHistory: ['AUDIENCE_REQUIRED'],
    readStateHistoryByPostId: {},
    lastReport: null,
    errorMessage: null,
  };
}

export function subscribePrivateMomentsRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function subscribe(listener: () => void): () => void {
  return subscribePrivateMomentsRuntime(listener);
}

function setSnapshot(next: PrivateMomentsRuntimeSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
