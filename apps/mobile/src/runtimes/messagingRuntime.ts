import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

import type {
  MobileRuntimeContext,
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
} from '../app/lifecycle/types';
import {
  isAccessGranted,
  type MobileAuthSession,
} from '../features/auth/authSession';
import { mobileAuthScopeKey } from '../features/auth/mobileAuthIdentity';
import { useAuthStore } from '../features/auth/authStore';
import { useSocialStore } from '../features/social/socialStore';
import {
  messagingActivate,
  messagingDeactivate,
  messagingListConversations,
  messagingReconcile,
  type MessagingAccountInput,
  type MessagingMutationScopeInput,
  type MessagingReconcileResult,
} from '../services/mobileCommands';
import { readableErrorMessage } from '../utils/errorMessage';
import { runRuntimeSessionTransition } from './runtimeSessionTransition';

export const MOBILE_MESSAGING_RECONCILED_EVENT = 'mobile:messaging-reconciled';
export const MOBILE_MESSAGING_PROJECTION_CHANGED_EVENT = 'mobile:messaging-projection-changed';
export const MOBILE_MESSAGING_RUNTIME_ERROR_EVENT = 'mobile:messaging-runtime-error';

interface MessagingProjectionEvent {
  stationPeerId: string;
  actorPtid: string;
  profileId: string;
  activationGeneration: number;
  cycleId: number;
  conversationId: string;
  eventId: string;
  laneSequence: number;
}

export interface MessagingProjectionScope extends MessagingAccountInput {
  profileId: string;
  deviceId: string;
  activationGeneration: number;
}

interface MessagingRuntimeErrorEventDetail {
  readonly operation: string;
  readonly message: string;
}

interface MessagingRuntimeReadinessPort {
  fail(operation: string, error?: string): void;
  recover(operation: string): void;
  recoverAll(): void;
  observeReady(): void;
}

const MESSAGING_READINESS_FAILURE_OPERATIONS = new Set([
  'projection-delivery',
  'session-transition',
  'worker-cycle',
]);

let activeScope: MessagingAccountInput | null = null;
let activeProfileId: string | null = null;
let activeDeviceId: string | null = null;
let activeSessionScopeKey = '';
let activeGeneration = 0;
let lastDeliveredLaneSequence = 0;
let transition: Promise<void> = Promise.resolve();
let projectionDelivery: Promise<void> = Promise.resolve();
let activeRuntimeReadinessPort: MessagingRuntimeReadinessPort | null = null;
let reconcileInFlight: {
  key: string;
  promise: Promise<MessagingReconcileResult | null>;
} | null = null;
const projectionScopeListeners = new Set<
  (scope: MessagingProjectionScope | null) => void
>();

export function createMessagingRuntimeDescriptor(): MobileRuntimeDescriptor {
  let unsubscribe: (() => void) | null = null;
  let unlistenProjection: UnlistenFn | null = null;
  let runtimeContext: MobileRuntimeContext | null = null;
  const readinessFailures = new Set<string>();

  const readinessPort: MessagingRuntimeReadinessPort = {
    fail(operation, error): void {
      if (!runtimeContext || readinessFailures.has(operation)) return;
      if (readinessFailures.size > 0) {
        readinessFailures.add(operation);
        return;
      }
      const update = runtimeContext.beginReadinessUpdate();
      if (!update.isCurrent()) return;
      readinessFailures.add(operation);
      update.fail(new Error('mobile.lifecycle.runtimeFailed', {
        cause: error,
      }));
    },
    recover(operation): void {
      if (!runtimeContext || !readinessFailures.has(operation)) return;
      if (readinessFailures.size > 1) {
        readinessFailures.delete(operation);
        return;
      }
      const update = runtimeContext.beginReadinessUpdate();
      if (!update.isCurrent()) return;
      readinessFailures.delete(operation);
      update.ready();
    },
    recoverAll(): void {
      if (!runtimeContext || readinessFailures.size === 0) return;
      const update = runtimeContext.beginReadinessUpdate();
      if (!update.isCurrent()) return;
      readinessFailures.clear();
      update.ready();
    },
    observeReady(): void {
      readinessFailures.clear();
    },
  };
  const onRuntimeError = (event: Event) => {
    const detail = (event as CustomEvent<MessagingRuntimeErrorEventDetail>).detail;
    if (
      !detail?.message
      || !MESSAGING_READINESS_FAILURE_OPERATIONS.has(detail.operation)
    ) {
      return;
    }
    readinessPort.fail(detail.operation, detail.message);
  };

  return {
    id: 'messaging',
    title: 'Messaging Runtime',
    responsibility:
      'Owns the authenticated Device Messaging Engine lifecycle, reconciliation, and durable Chat command path.',
    dependsOn: ['session', 'secure-storage', 'native-event-bridge'],

    async bootstrap(context): Promise<void> {
      readinessFailures.clear();
      runtimeContext = context;
      activeRuntimeReadinessPort = readinessPort;
      window.addEventListener(MOBILE_MESSAGING_RUNTIME_ERROR_EVENT, onRuntimeError);
      unlistenProjection = await listen<MessagingProjectionEvent>(
        MOBILE_MESSAGING_PROJECTION_CHANGED_EVENT,
        (event) => enqueueProjectionDelivery(event.payload),
      );
      unsubscribe = useAuthStore.subscribe((state, previous) => {
        const session = admittedSession(state);
        const previousSession = admittedSession(previous);
        if (sessionKey(session) === sessionKey(previousSession)) return;
        if (runtimeContext) {
          enqueueSessionTransition(session, runtimeContext, readinessPort);
        }
      });
      await enqueueSessionTransition(
        admittedSession(useAuthStore.getState()),
        context,
        readinessPort,
      );
    },

    async suspend(): Promise<void> {
      await transition;
      await invoke<void>('messaging_suspend');
    },

    async resume(context): Promise<void> {
      runtimeContext = context;
      await transition;
      const scope = activeScope;
      if (!scope) return;
      await invoke('messaging_resume', { input: scope });
      await enqueueSessionTransition(
        admittedSession(useAuthStore.getState()),
        context,
        readinessPort,
      );
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      window.removeEventListener(MOBILE_MESSAGING_RUNTIME_ERROR_EVENT, onRuntimeError);
      if (activeRuntimeReadinessPort === readinessPort) {
        activeRuntimeReadinessPort = null;
      }
      readinessFailures.clear();
      runtimeContext = null;
      unsubscribe?.();
      unsubscribe = null;
      unlistenProjection?.();
      unlistenProjection = null;
      await transition;
      await projectionDelivery;
      const scope = activeScope;
      clearActiveProjectionScope();
      if (scope) {
        await messagingDeactivate(scope);
      }
      return {
        runtimeId: 'messaging',
        success: true,
        durationMs: performance.now() - start,
      };
    },
  };
}

export async function wakeActiveMessagingSession(): Promise<void> {
  try {
    await reconcileActiveMessagingSession();
  } catch (error) {
    reportRuntimeError('worker-cycle', error);
    throw error;
  }
}

export function reconcileActiveMessagingSession(): Promise<MessagingReconcileResult | null> {
  const session = admittedSession(useAuthStore.getState());
  if (!session || !activeScope || !activeProfileId || activeGeneration === 0) {
    return Promise.resolve(null);
  }
  const scope = accountInput(session);
  const projectionScope = currentMessagingProjectionScope();
  if (!projectionScope || !sameAccount(scope, activeScope)) return Promise.resolve(null);
  const key = projectionScopeKey(projectionScope);
  if (reconcileInFlight?.key === key) return reconcileInFlight.promise;
  const promise = messagingReconcile(scope)
    .then(async (result) => {
      if (projectionScopeKey(currentMessagingProjectionScope()) !== key) return null;
      await refreshKnownMessageProjections();
      if (projectionScopeKey(currentMessagingProjectionScope()) !== key) return null;
      window.dispatchEvent(
        new CustomEvent(MOBILE_MESSAGING_RECONCILED_EVENT, { detail: result }),
      );
      activeRuntimeReadinessPort?.recoverAll();
      return result;
    })
    .finally(() => {
      if (reconcileInFlight?.key === key) reconcileInFlight = null;
    });
  reconcileInFlight = { key, promise };
  return promise;
}

function enqueueSessionTransition(
  session: MobileAuthSession | null,
  context: MobileRuntimeContext,
  readinessPort: MessagingRuntimeReadinessPort,
): Promise<void> {
  const task = runRuntimeSessionTransition({
    previous: transition,
    context,
    isScopeCurrent: () => sessionKey(admittedSession(useAuthStore.getState())) === sessionKey(session),
    run: async (isCurrent) => {
      await synchronizeSession(session, isCurrent);
      if (isCurrent()) readinessPort.observeReady();
    },
    onError: (error) => reportRuntimeError('session-transition', error),
  });
  transition = task.catch(() => undefined);
  return task;
}

async function synchronizeSession(
  session: MobileAuthSession | null,
  isCurrent: () => boolean,
): Promise<void> {
  const nextScope = session ? accountInput(session) : null;
  if (activeScope && !sameAccount(activeScope, nextScope)) {
    const previousScope = activeScope;
    clearActiveProjectionScope();
    await messagingDeactivate(previousScope);
  }
  if (!session || !isCurrent()) return;
  const scope = accountInput(session);
  const status = await messagingActivate({
    ...scope,
    sessionId: session.sessionId,
  }).catch((error: unknown) => {
    throw error;
  });
  if (!status.profileId) throw new Error('mobile.messaging.runtimeProfileMissing');
  if (!status.deviceId) throw new Error('mobile.messaging.runtimeDeviceMissing');
  // Retain the native scope for cleanup even when activation was superseded.
  activeScope = scope;
  if (!isCurrent()) return;
  activeProfileId = status.profileId;
  activeDeviceId = status.deviceId;
  activeSessionScopeKey = sessionKey(session);
  activeGeneration = status.activationGeneration;
  lastDeliveredLaneSequence = status.laneSequence;
  await reconcileActiveMessagingSession();
  publishProjectionScope();
}

function enqueueProjectionDelivery(event: MessagingProjectionEvent): void {
  projectionDelivery = projectionDelivery
    .then(async () => {
      if (
        !activeScope
        || activeGeneration === 0
        || !activeProfileId
        || event.activationGeneration !== activeGeneration
        || event.stationPeerId !== activeScope.stationPeerId
        || event.actorPtid !== activeScope.actorPtid
        || event.profileId !== activeProfileId
        || event.laneSequence <= lastDeliveredLaneSequence
      ) {
        return;
      }
      const expectedKey = projectionScopeKey(currentMessagingProjectionScope());
      await refreshMessageProjection(event.conversationId);
      if (
        !expectedKey
        || projectionScopeKey(currentMessagingProjectionScope()) !== expectedKey
        || event.laneSequence <= lastDeliveredLaneSequence
      ) {
        return;
      }
      lastDeliveredLaneSequence = event.laneSequence;
      window.dispatchEvent(
        new CustomEvent(MOBILE_MESSAGING_PROJECTION_CHANGED_EVENT, { detail: event }),
      );
    })
    .catch((error) => {
      reportRuntimeError('projection-delivery', error);
    });
}

function accountInput(session: MobileAuthSession): MessagingMutationScopeInput {
  return {
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorRef.ptid,
    deviceId: session.deviceId,
    lifecycleGeneration: session.lifecycleGeneration,
  };
}

function sessionKey(session: MobileAuthSession | null): string {
  return session
    ? `${mobileAuthScopeKey(session)}\u001f${session.sessionId}`
    : '';
}

function admittedSession(
  state: ReturnType<typeof useAuthStore.getState>,
): MobileAuthSession | null {
  return isAccessGranted(state.accessDecision) ? state.session : null;
}

function sameAccount(
  left: MessagingAccountInput,
  right: MessagingAccountInput | null,
): boolean {
  return Boolean(
    right
    && left.stationPeerId === right.stationPeerId
    && left.actorPtid === right.actorPtid,
  );
}

export function currentMessagingProjectionScope(): MessagingProjectionScope | null {
  if (!activeScope || !activeProfileId || !activeDeviceId || activeGeneration === 0) return null;
  return {
    ...activeScope,
    profileId: activeProfileId,
    deviceId: activeDeviceId,
    activationGeneration: activeGeneration,
  };
}

export function subscribeMessagingProjectionScope(
  listener: (scope: MessagingProjectionScope | null) => void,
): () => void {
  projectionScopeListeners.add(listener);
  return () => projectionScopeListeners.delete(listener);
}

export async function invalidateMessagingProjectionScopeForAcceptance(): Promise<void> {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') {
    throw new Error('mobile.messaging.acceptanceScopeInvalidationUnavailable');
  }
  const scope = activeScope;
  clearActiveProjectionScope();
  if (scope) await messagingDeactivate(scope);
}

function projectionScopeKey(scope: MessagingProjectionScope | null): string {
  return scope
    ? `${scope.stationPeerId}\u001f${scope.actorPtid}\u001f${scope.profileId}\u001f${scope.deviceId}\u001f${scope.activationGeneration}`
    : '';
}

async function refreshKnownMessageProjections(): Promise<void> {
  const social = useSocialStore.getState();
  const history = new Set(Object.keys(social.messages));
  if (social.activeSessionUlid) history.add(social.activeSessionUlid);
  if (social.authSession) await refreshConversationProjections(social);
  if (social.authSession && useSocialStore.getState().authSession === social.authSession) {
    const currentIds = new Set(
      useSocialStore.getState().messagingConversations.map(
        (conversation) => conversation.conversationId,
      ),
    );
    for (const id of history) {
      if (useSocialStore.getState().authSession !== social.authSession) break;
      if (currentIds.has(id)) await social.loadMessages(id);
    }
  }
}

async function refreshMessageProjection(conversationId: string): Promise<void> {
  const scope = activeScope;
  if (!scope || !conversationId.trim()) return;
  const projectionKey = projectionScopeKey(currentMessagingProjectionScope());
  const conversation = (await messagingListConversations(scope))
    .find((item) => item.conversationId === conversationId);
  if (!conversation || projectionScopeKey(currentMessagingProjectionScope()) !== projectionKey) return;
  const social = useSocialStore.getState();
  if (!social.authSession || !sameAccount(scope, accountInput(social.authSession))) return;
  if (social.activeSessionUlid === conversationId || conversationId in social.messages) {
    await social.loadMessages(conversationId);
  }
  if (useSocialStore.getState().authSession === social.authSession) {
    await refreshConversationProjections(social);
  }
}

async function refreshConversationProjections(
  social: ReturnType<typeof useSocialStore.getState>,
): Promise<void> {
  const scope = social.authSession;
  if (!scope) return;
  await social.refreshSessions();
  if (useSocialStore.getState().authSession !== scope) return;
  await Promise.all([
    social.refreshConversationSettings(),
    social.refreshGroupCommandOutcomes(),
  ]);
}

function clearActiveProjectionScope(): void {
  activeScope = null;
  activeProfileId = null;
  activeDeviceId = null;
  activeSessionScopeKey = '';
  activeGeneration = 0;
  lastDeliveredLaneSequence = 0;
  reconcileInFlight = null;
  publishProjectionScope();
}

function publishProjectionScope(): void {
  const scope = currentMessagingProjectionScope();
  projectionScopeListeners.forEach((listener) => listener(scope));
}

function reportRuntimeError(operation: string, error: unknown): void {
  window.dispatchEvent(
    new CustomEvent(MOBILE_MESSAGING_RUNTIME_ERROR_EVENT, {
      detail: {
        operation,
        message: readableErrorMessage(error),
      },
    }),
  );
}
