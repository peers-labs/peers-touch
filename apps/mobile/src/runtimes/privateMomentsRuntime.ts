import { useSyncExternalStore } from 'react';

import type { MobileRuntimeDescriptor, RuntimeOperationResult } from '../app/lifecycle/types';
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
  privateSocialPublish,
  privateSocialPublishText,
  privateSocialRead,
  privateSocialReadText,
  privateSocialRecover,
  privateSocialRecoverText,
  privateSocialStoreRecoveryPhrase,
  privateSocialReconcile,
  privateSocialSnapshot,
  privateSocialTeardown,
  type PrivateCommentIntent,
  type PrivateCommentPage,
  type PrivateCommentSubmitResult,
  type PrivateMomentProjection,
  type PrivateMomentReadProjection,
  type PrivateSocialActivationInput,
  type PrivateSocialAccountInput,
  type PrivateSocialMomentIntent,
  type PrivateSocialTextIntent,
  type PrivateSocialWorkerReport,
} from '../services/mobileCommands';
import { readableErrorMessage } from '../utils/errorMessage';

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

export interface PrivateMomentsRuntimeSnapshot {
  readonly active: boolean;
  readonly reconciling: boolean;
  readonly stationPeerId: string | null;
  readonly actorPtid: string | null;
  readonly projections: readonly PrivateMomentProjection[];
  readonly postsById: Readonly<Record<string, PrivateMomentReadProjection>>;
  readonly commentDrafts: readonly PrivateCommentSubmitResult['draft'][];
  readonly comments: readonly NonNullable<PrivateCommentSubmitResult['comment']>[];
  readonly publishStateHistory: readonly PrivateSocialVisiblePublishState[];
  readonly readStateHistoryByPostId: Readonly<Record<string, readonly PrivateSocialVisibleReadState[]>>;
  readonly lastReport: PrivateSocialWorkerReport | null;
  readonly errorMessage: string | null;
}

interface PrivateSocialSessionScope extends PrivateSocialAccountInput {
  readonly sessionId: string;
  readonly activationGeneration: number;
}

const listeners = new Set<() => void>();
let snapshot: PrivateMomentsRuntimeSnapshot = emptySnapshot();
let activeScope: PrivateSocialSessionScope | null = null;
let transition: Promise<void> = Promise.resolve();

export function usePrivateMomentsRuntime(): PrivateMomentsRuntimeSnapshot {
  return useSyncExternalStore(subscribe, readPrivateMomentsSnapshot, readPrivateMomentsSnapshot);
}

export function readPrivateMomentsSnapshot(): PrivateMomentsRuntimeSnapshot {
  return snapshot;
}

export function createPrivateMomentsRuntimeDescriptor(): MobileRuntimeDescriptor {
  let unsubscribe: (() => void) | null = null;
  let suspended = false;

  return {
    id: 'private-social',
    title: 'Private Social Runtime',
    responsibility:
      'Owns the mobile-web projection of Native private Social durability and typed actions; cryptographic and replay authority remain in Mobile Rust.',
    dependsOn: ['messaging', 'social', 'secure-storage'],

    async bootstrap(): Promise<void> {
      suspended = false;
      unsubscribe = useAuthStore.subscribe((state, previous) => {
        const session = admittedSession(state);
        const previousSession = admittedSession(previous);
        if (sessionKey(session) === sessionKey(previousSession)) return;
        enqueueSessionTransition(session, suspended);
      });
      await enqueueSessionTransition(admittedSession(useAuthStore.getState()), suspended);
    },

    async suspend(): Promise<void> {
      suspended = true;
      await transition;
    },

    async resume(): Promise<void> {
      suspended = false;
      await enqueueSessionTransition(admittedSession(useAuthStore.getState()), suspended);
      await reconcilePrivateMoments();
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      unsubscribe?.();
      unsubscribe = null;
      await transition;
      const scope = activeScope;
      activeScope = null;
      setSnapshot(emptySnapshot());
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
    const projection = await privateSocialPublishText({
      ...operationScope(scope),
      ...intent,
    });
    if (!isCurrentScope(scope)) {
      throw new Error('mobile.privateSocial.stalePublishCompletion');
    }
    mergeProjection(projection);
    appendPublishStates(projection.state === 'PUBLISHED' ? 'PUBLISHED' : 'PUBLISH_FAILED');
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
    appendPublishStates(projection.state === 'PUBLISHED' ? 'PUBLISHED' : 'PUBLISH_FAILED');
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
  appendReadStates(postId, 'LOADING_AUTHORIZED_RESOURCE');
  try {
    const projection = await privateSocialReadText({
      ...operationScope(scope),
      postId: stablePostId,
    });
    if (!isCurrentScope(scope)) {
      throw new Error('mobile.privateSocial.staleReadCompletion');
    }
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
  appendReadStates(postId, 'LOADING_AUTHORIZED_RESOURCE');
  try {
    const projection = await privateSocialRead({
      ...operationScope(scope),
      postId: stablePostId,
    });
    if (!isCurrentScope(scope) || projection.postId !== stablePostId) {
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
  const projection = await privateSocialOpenMedia({
    ...operationScope(scope),
    postId: stablePostId,
    objectId: stableObjectId,
  });
  if (!isCurrentScope(scope)) {
    throw new Error('mobile.privateSocial.staleMediaCompletion');
  }
  setSnapshot({
    ...snapshot,
    postsById: mergeReadProjectionMap(snapshot.postsById, [projection]),
    errorMessage: null,
  });
  return projection;
}

export async function storePrivateSocialRecoveryPhrase(
  recoveryPhrase: string,
  recoveryEpoch = 1,
): Promise<void> {
  const scope = requireActiveScope();
  await privateSocialStoreRecoveryPhrase({
    ...operationScope(scope),
    recoveryPhrase,
    recoveryEpoch,
  });
  if (!isCurrentScope(scope)) {
    throw new Error('mobile.privateSocial.staleRecoveryPhraseCompletion');
  }
}

export async function recoverPrivateTextMoment(
  postId: string,
): Promise<PrivateMomentReadProjection> {
  const scope = requireActiveScope();
  const stablePostId = postId.trim();
  if (!stablePostId || stablePostId !== postId) {
    throw new Error('mobile.privateSocial.invalidPostId');
  }
  appendReadStates(stablePostId, 'WAITING_FOR_PRIVATE_KEY');
  const projection = await privateSocialRecoverText({
    ...operationScope(scope),
    postId: stablePostId,
  });
  if (!isCurrentScope(scope)) {
    throw new Error('mobile.privateSocial.staleRecoveryCompletion');
  }
  setSnapshot({
    ...snapshot,
    postsById: mergeReadProjectionMap(snapshot.postsById, [projection]),
    errorMessage: null,
  });
  appendReadStates(postId, projection.state);
  return projection;
}

export async function recoverPrivateMoment(postId: string): Promise<PrivateMomentReadProjection> {
  const scope = requireActiveScope();
  const stablePostId = postId.trim();
  if (!stablePostId || stablePostId !== postId) {
    throw new Error('mobile.privateSocial.invalidPostId');
  }
  appendReadStates(stablePostId, 'WAITING_FOR_PRIVATE_KEY');
  const projection = await privateSocialRecover({
    ...operationScope(scope),
    postId: stablePostId,
  });
  if (!isCurrentScope(scope)) {
    throw new Error('mobile.privateSocial.staleRecoveryCompletion');
  }
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
  const result = await privateSocialCommentSubmit({ ...operationScope(scope), ...intent });
  if (!isCurrentScope(scope)) throw new Error('mobile.privateSocial.staleCommentCompletion');
  setSnapshot({
    ...snapshot,
    commentDrafts: mergeCommentDraftLists(snapshot.commentDrafts, [result.draft]),
    comments: result.comment
      ? mergeCommentLists(snapshot.comments, [result.comment])
      : snapshot.comments,
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
  const page = await privateSocialComments({ ...operationScope(scope), postId, cursor, limit });
  if (!isCurrentScope(scope)) throw new Error('mobile.privateSocial.staleCommentReadCompletion');
  setSnapshot({
    ...snapshot,
    comments: mergeCommentLists(snapshot.comments, page.comments),
    errorMessage: null,
  });
  return page;
}

export async function reconcilePrivateMoments(): Promise<PrivateSocialWorkerReport | null> {
  const scope = activeScope;
  if (!scope) return null;
  setSnapshot({ ...snapshot, reconciling: true, errorMessage: null });
  try {
    const operation = operationScope(scope);
    const report = await privateSocialReconcile(operation);
    const nativeSnapshot = await privateSocialSnapshot(operation);
    if (!isCurrentScope(scope)) return null;
    setSnapshot({
      ...snapshot,
      reconciling: false,
      projections: mergeProjectionLists(
        snapshot.projections,
        nativeSnapshot.publishProjections,
      ),
      postsById: mergeReadProjectionMap(
        snapshot.postsById,
        nativeSnapshot.readProjections,
      ),
      commentDrafts: nativeSnapshot.commentDrafts,
      comments: nativeSnapshot.comments,
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

function enqueueSessionTransition(
  session: MobileAuthSession | null,
  suspended: boolean,
): Promise<void> {
  const requestedSessionKey = sessionKey(session);
  transition = transition
    .then(() => synchronizeSession(session, suspended))
    .catch((error) => {
      const currentSession = admittedSession(useAuthStore.getState());
      if (
        sessionKey(currentSession) !== requestedSessionKey
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
    });
  return transition;
}

async function synchronizeSession(
  session: MobileAuthSession | null,
  suspended: boolean,
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
  if (!session || suspended) return;
  if (activeScope && matchesAuthSession(activeScope, session)) return;
  const account = accountInput(session);
  const status = await privateSocialActivate(account);
  const cleanupScope = Number.isSafeInteger(status.activationGeneration)
    && status.activationGeneration > 0
    ? { ...account, activationGeneration: status.activationGeneration }
    : null;
  try {
    const scope = activatedScope(session, status);
    if (!matchesAuthSession(scope, admittedSession(useAuthStore.getState()))) {
      await privateSocialTeardown(operationScope(scope));
      return;
    }
    const nativeSnapshot = await privateSocialSnapshot(operationScope(scope));
    if (!matchesAuthSession(scope, admittedSession(useAuthStore.getState()))) {
      await privateSocialTeardown(operationScope(scope));
      return;
    }
    activeScope = scope;
    setSnapshot({
      active: true,
      reconciling: false,
      stationPeerId: scope.stationPeerId,
      actorPtid: scope.actorPtid,
      projections: nativeSnapshot.publishProjections,
      commentDrafts: nativeSnapshot.commentDrafts,
      comments: nativeSnapshot.comments,
      postsById: mergeReadProjectionMap({}, nativeSnapshot.readProjections),
      publishStateHistory: ['AUDIENCE_REQUIRED'],
      readStateHistoryByPostId: {},
      lastReport: null,
      errorMessage: null,
    });
  } catch (error) {
    if (!cleanupScope) throw error;
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
  if (message.includes('PREKEY') || message.includes('KEY_UNAVAILABLE')) {
    return 'RECIPIENT_KEY_UNAVAILABLE';
  }
  return 'PUBLISH_FAILED';
}

function mergeProjection(projection: PrivateMomentProjection): void {
  setSnapshot({
    ...snapshot,
    projections: mergeProjectionLists(snapshot.projections, [projection]),
    errorMessage: null,
  });
}

function requireActiveScope(): PrivateSocialSessionScope {
  if (!activeScope) throw new Error('mobile.privateSocial.runtimeInactive');
  return activeScope;
}

function accountInput(session: MobileAuthSession): PrivateSocialActivationInput {
  return {
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorRef.ptid,
  };
}

function operationScope(scope: PrivateSocialSessionScope): PrivateSocialAccountInput {
  return {
    stationPeerId: scope.stationPeerId,
    actorPtid: scope.actorPtid,
    activationGeneration: scope.activationGeneration,
  };
}

function activatedScope(
  session: MobileAuthSession,
  status: Awaited<ReturnType<typeof privateSocialActivate>>,
): PrivateSocialSessionScope {
  const account = accountInput(session);
  if (
    !status.active
    || status.stationPeerId !== account.stationPeerId
    || status.actorPtid !== account.actorPtid
    || !Number.isSafeInteger(status.activationGeneration)
    || status.activationGeneration <= 0
  ) {
    throw new Error('mobile.privateSocial.activationIdentityMismatch');
  }
  return {
    ...account,
    sessionId: session.sessionId,
    activationGeneration: status.activationGeneration,
  };
}

function admittedSession(
  state: ReturnType<typeof useAuthStore.getState>,
): MobileAuthSession | null {
  return isAccessGranted(state.accessDecision) ? state.session : null;
}

function sessionKey(session: MobileAuthSession | null): string {
  return session
    ? `${session.stationPeerId}\u001f${session.actorRef.ptid}\u001f${session.sessionId}`
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
    projections: [],
    postsById: {},
    commentDrafts: [],
    comments: [],
    publishStateHistory: ['AUDIENCE_REQUIRED'],
    readStateHistoryByPostId: {},
    lastReport: null,
    errorMessage: null,
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setSnapshot(next: PrivateMomentsRuntimeSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
