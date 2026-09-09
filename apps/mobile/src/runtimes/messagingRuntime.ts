import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

import type { MobileRuntimeDescriptor, RuntimeOperationResult } from '../app/lifecycle/types';
import {
  isAccessGranted,
  type MobileAuthSession,
} from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import { useGroupStore } from '../features/group/groupStore';
import { useSocialStore } from '../features/social/socialStore';
import {
  messagingActivate,
  messagingDeactivate,
  messagingListConversations,
  messagingReconcile,
  type MessagingAccountInput,
  type MessagingReconcileResult,
} from '../services/mobileCommands';
import { readableErrorMessage } from '../utils/errorMessage';

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

interface MessagingProjectionScope extends MessagingAccountInput {
  profileId: string;
  activationGeneration: number;
}

let activeScope: MessagingAccountInput | null = null;
let activeProfileId: string | null = null;
let activeGeneration = 0;
let lastDeliveredLaneSequence = 0;
let transition: Promise<void> = Promise.resolve();
let projectionDelivery: Promise<void> = Promise.resolve();
let reconcileInFlight: {
  key: string;
  promise: Promise<MessagingReconcileResult | null>;
} | null = null;

export function createMessagingRuntimeDescriptor(): MobileRuntimeDescriptor {
  let unsubscribe: (() => void) | null = null;
  let unlistenProjection: UnlistenFn | null = null;

  return {
    id: 'messaging',
    title: 'Messaging Runtime',
    responsibility:
      'Owns the authenticated Device Messaging Engine lifecycle, reconciliation, and durable Chat command path.',
    dependsOn: ['auth', 'secure-storage', 'native-event-bridge'],

    async bootstrap(): Promise<void> {
      unlistenProjection = await listen<MessagingProjectionEvent>(
        MOBILE_MESSAGING_PROJECTION_CHANGED_EVENT,
        (event) => enqueueProjectionDelivery(event.payload),
      );
      unsubscribe = useAuthStore.subscribe((state, previous) => {
        const session = admittedSession(state);
        const previousSession = admittedSession(previous);
        if (sessionKey(session) === sessionKey(previousSession)) return;
        enqueueSessionTransition(session);
      });
      await synchronizeSession(admittedSession(useAuthStore.getState()));
    },

    async suspend(): Promise<void> {
      await transition;
      await invoke<void>('messaging_suspend');
    },

    async resume(): Promise<void> {
      await transition;
      const scope = activeScope;
      if (!scope) return;
      await invoke('messaging_resume', { input: scope });
      await reconcileActiveMessagingSession();
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
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
  const scope = activeScope;
  if (!scope) return;
  await invoke('messaging_wake', { input: scope });
}

export function reconcileActiveMessagingSession(): Promise<MessagingReconcileResult | null> {
  const session = admittedSession(useAuthStore.getState());
  if (!session || !activeScope || !activeProfileId || activeGeneration === 0) {
    return Promise.resolve(null);
  }
  const scope = accountInput(session);
  const projectionScope = currentProjectionScope();
  if (!projectionScope || !sameAccount(scope, activeScope)) return Promise.resolve(null);
  const key = projectionScopeKey(projectionScope);
  if (reconcileInFlight?.key === key) return reconcileInFlight.promise;
  const promise = messagingReconcile(scope)
    .then(async (result) => {
      if (projectionScopeKey(currentProjectionScope()) !== key) return null;
      await refreshKnownMessageProjections();
      if (projectionScopeKey(currentProjectionScope()) !== key) return null;
      window.dispatchEvent(
        new CustomEvent(MOBILE_MESSAGING_RECONCILED_EVENT, { detail: result }),
      );
      return result;
    })
    .finally(() => {
      if (reconcileInFlight?.key === key) reconcileInFlight = null;
    });
  reconcileInFlight = { key, promise };
  return promise;
}

function enqueueSessionTransition(session: MobileAuthSession | null): void {
  transition = transition
    .then(() => synchronizeSession(session))
    .catch((error) => {
      reportRuntimeError('session-transition', error);
    });
}

async function synchronizeSession(session: MobileAuthSession | null): Promise<void> {
  const nextScope = session ? accountInput(session) : null;
  if (activeScope && !sameAccount(activeScope, nextScope)) {
    const previousScope = activeScope;
    clearActiveProjectionScope();
    await messagingDeactivate(previousScope);
  }
  if (!session) return;
  const scope = accountInput(session);
  const status = await messagingActivate({
    ...scope,
    stationOrigin: session.stationUrl,
    accessToken: session.accessToken,
  });
  if (!status.profileId) throw new Error('mobile.messaging.runtimeProfileMissing');
  activeScope = scope;
  activeProfileId = status.profileId;
  activeGeneration = status.activationGeneration;
  lastDeliveredLaneSequence = status.laneSequence;
  await reconcileActiveMessagingSession();
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
      const expectedKey = projectionScopeKey(currentProjectionScope());
      await refreshMessageProjection(event.conversationId);
      if (
        !expectedKey
        || projectionScopeKey(currentProjectionScope()) !== expectedKey
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

function accountInput(session: MobileAuthSession): MessagingAccountInput {
  return {
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorRef.ptid,
  };
}

function sessionKey(session: MobileAuthSession | null): string {
  return session
    ? `${session.stationPeerId}\u001f${session.actorRef.ptid}\u001f${session.accessToken}`
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

function currentProjectionScope(): MessagingProjectionScope | null {
  if (!activeScope || !activeProfileId || activeGeneration === 0) return null;
  return {
    ...activeScope,
    profileId: activeProfileId,
    activationGeneration: activeGeneration,
  };
}

function projectionScopeKey(scope: MessagingProjectionScope | null): string {
  return scope
    ? `${scope.stationPeerId}\u001f${scope.actorPtid}\u001f${scope.profileId}\u001f${scope.activationGeneration}`
    : '';
}

async function refreshKnownMessageProjections(): Promise<void> {
  const social = useSocialStore.getState();
  const group = useGroupStore.getState();
  await Promise.all([
    social.authSession ? social.refreshSessions() : Promise.resolve(),
    group.authSession ? group.refreshGroups() : Promise.resolve(),
  ]);
}

async function refreshMessageProjection(conversationId: string): Promise<void> {
  const scope = activeScope;
  if (!scope || !conversationId.trim()) return;
  const conversation = (await messagingListConversations(scope))
    .find((item) => item.conversationId === conversationId);
  if (!conversation) return;
  if (conversation.kind === 1) {
    const social = useSocialStore.getState();
    if (!social.authSession) return;
    if (!social.sessions.some((item) => item.ulid === conversationId)) {
      await social.refreshSessions();
      return;
    }
    await social.loadMessages(conversationId);
    return;
  }
  if (conversation.kind === 2) {
    const group = useGroupStore.getState();
    if (!group.authSession) return;
    if (!group.groups.some((item) => item.ulid === conversationId)) {
      await group.refreshGroups();
      return;
    }
    await group.loadMessages(conversationId);
  }
}

function clearActiveProjectionScope(): void {
  activeScope = null;
  activeProfileId = null;
  activeGeneration = 0;
  lastDeliveredLaneSequence = 0;
  reconcileInFlight = null;
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
