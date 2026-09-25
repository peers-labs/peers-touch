import { useSyncExternalStore } from 'react';

import type {
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
} from '../app/lifecycle/types';
import {
  cancelStationAccessAttempt,
  accessDecisionFromProjection,
  getStationAccessDecision,
  isAccessGranted,
  stationAccessError,
  startStationAccessAttempt,
  type AccessDecision,
} from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import { verifyStationIdentity } from '../features/station/stationConnection';
import {
  activeStationEntry,
  requireMatchingStationIdentity,
  type MobileStationEntry,
} from '../features/station/stationRegistry';
import type { OAuthAccessDecisionProjection } from '../services/mobileCommands';
import { readableErrorMessage } from '../utils/errorMessage';
import {
  cancelOAuthForScope,
  readAuthRuntimeSnapshot,
  subscribeAuthRuntimeSnapshot,
} from './authRuntime';
import { getRecoveryProjection } from './recoveryProjection';
import {
  activateNativeSessionRuntime,
  clearSessionCandidateForAccess,
  readSessionCandidateForAccess,
  type SessionAccessCandidate,
} from './sessionRuntime';
import { readStationRegistryProjection } from './stationRuntime';

export interface AccessRuntimeSnapshot {
  readonly decision: AccessDecision | null;
  readonly loading: boolean;
  readonly errorKey: string | null;
  readonly restored: boolean;
}

type StartAccessAttempt = (sessionId?: string) => Promise<AccessDecision>;

const listeners = new Set<() => void>();
let snapshot = snapshotFromStore();

export function useAccessRuntime(): AccessRuntimeSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function readAccessRuntimeProjection(): AccessRuntimeSnapshot {
  return snapshot;
}

export function applyAccessGateRuntimeResult(
  decision: AccessDecision,
): void {
  useAuthStore.getState().setAccessDecision(decision);
  publishFromStore();
}

export async function startAccessAttemptForActiveStation(): Promise<AccessDecision> {
  const station = activeStationEntry(await readStationRegistryProjection());
  if (!station) throw new Error('mobile.auth.activeStationRequired');

  const state = useAuthStore.getState();
  state.setLoading(true);
  state.setError(null);
  try {
    const candidate = await readSessionCandidateForAccess(station);
    const decision = await startStationAccessAttemptWithRecovery(
      station.stationPeerId,
      station.url,
      candidate,
    );
    applyAccessGateRuntimeResult(decision);
    return decision;
  } catch (error) {
    const typed = stationAccessError(error);
    state.setError(readableErrorMessage(typed));
    publishFromStore();
    throw typed;
  } finally {
    state.setLoading(false);
    publishFromStore();
  }
}

export async function refreshAccessDecisionForActiveStation(): Promise<AccessDecision> {
  const state = useAuthStore.getState();
  state.setLoading(true);
  state.setError(null);
  publishFromStore();
  try {
    const station = activeStationEntry(await readStationRegistryProjection());
    if (!station) throw new Error('mobile.auth.activeStationRequired');
    const attemptId = state.accessDecision?.attemptId.trim();
    if (!attemptId) throw new Error('mobile.auth.gateMissingAttempt');

    const decision = await getStationAccessDecision({
      stationPeerId: station.stationPeerId,
      stationUrl: station.url,
      attemptId,
    });
    return applyRefreshedAccessDecision(station, decision);
  } catch (error) {
    const typed = stationAccessError(error);
    state.setError(readableErrorMessage(typed));
    publishFromStore();
    throw typed;
  } finally {
    state.setLoading(false);
    publishFromStore();
  }
}

async function applyRefreshedAccessDecision(
  station: MobileStationEntry,
  decision: AccessDecision,
  activateSession = activateNativeSessionRuntime,
): Promise<AccessDecision> {
  applyAccessGateRuntimeResult(decision);
  if (isAccessGranted(decision)) {
    await activateSession(station, decision);
  }
  return decision;
}

export async function cancelAccessAttemptForActiveStation(): Promise<void> {
  const state = useAuthStore.getState();
  state.setLoading(true);
  state.setError(null);
  publishFromStore();
  try {
    const station = activeStationEntry(await readStationRegistryProjection());
    if (!station) throw new Error('mobile.auth.activeStationRequired');
    const attemptId = state.accessDecision?.attemptId.trim();
    if (!attemptId) throw new Error('mobile.auth.gateMissingAttempt');

    const oauth = readAuthRuntimeSnapshot();
    if (oauth.phase !== 'idle' && oauth.phase !== 'cancelled') {
      await cancelOAuthForScope({
        stationOrigin: station.url,
        stationPeerId: station.stationPeerId,
      });
    }
    await cancelStationAccessAttempt({
      stationPeerId: station.stationPeerId,
      stationUrl: station.url,
      attemptId,
    });
    state.setAccessDecision(null);
    publishFromStore();
  } catch (error) {
    const typed = stationAccessError(error);
    state.setError(readableErrorMessage(typed));
    publishFromStore();
    throw typed;
  } finally {
    state.setLoading(false);
    publishFromStore();
  }
}

export async function startStationAccessAttemptWithRecovery(
  stationPeerId: string,
  stationUrl: string,
  candidate?: SessionAccessCandidate | null,
): Promise<AccessDecision> {
  const station = { stationPeerId, url: stationUrl };
  return startAccessAttemptWithInvalidSessionRecovery(
    candidate?.sessionId,
    (sessionId) => startStationAccessAttempt(
      stationPeerId,
      stationUrl,
      sessionId,
    ),
    async () => {
      if (candidate) {
        await clearSessionCandidateForAccess(station, candidate);
      }
      getRecoveryProjection().reportDeviceLocalFlag('session-expired');
    },
  );
}

export async function restoreAndRevalidateAccessRuntime(): Promise<void> {
  const state = useAuthStore.getState();
  state.hideAccessProjection();
  state.setRestored(false);
  state.setLoading(true);
  publishFromStore();

  try {
    const station = activeStationEntry(await readStationRegistryProjection());
    if (!station) {
      return;
    }

    const verifiedStation = await verifyStationIdentity(station.url);
    if (verifiedStation.stationPeerId !== station.stationPeerId) {
      getRecoveryProjection().reportSessionMismatch(
        station.stationPeerId,
        verifiedStation.stationPeerId,
      );
    }
    requireMatchingStationIdentity(station, verifiedStation.stationPeerId);
    getRecoveryProjection().clearSessionMismatch();

    const candidate = await readSessionCandidateForAccess(station);
    const decision = await startAccessAttemptWithInvalidSessionRecovery(
      candidate?.sessionId,
      (currentSessionId) => startStationAccessAttempt(
        station.stationPeerId,
        station.url,
        currentSessionId,
      ),
      async () => {
        if (candidate) {
          await clearSessionCandidateForAccess(station, candidate);
        }
        getRecoveryProjection().reportDeviceLocalFlag('session-expired');
      },
    );
    applyAccessGateRuntimeResult(decision);
  } catch (error) {
    const typed = stationAccessError(error);
    state.setError(readableErrorMessage(typed));
    publishFromStore();
    throw typed;
  } finally {
    state.setRestored(true);
    state.setLoading(false);
    publishFromStore();
  }
}

export function fenceAccessRuntimeProjection(): void {
  useAuthStore.getState().hideAccessProjection();
  publishFromStore();
}

export function createAccessRuntimeDescriptor(): MobileRuntimeDescriptor {
  let unsubscribeAuth: (() => void) | null = null;
  let unsubscribeStore: (() => void) | null = null;

  const applyAuthDecision = () => {
    const decision = readAuthRuntimeSnapshot().accessDecision;
    if (decision) {
      applyAccessGateRuntimeResult(sanitizeAccessDecision(decision));
    }
  };

  return {
    id: 'access',
    title: 'Access Runtime',
    responsibility:
      'Owns the Station gate attempt and access decision projection before session admission.',
    dependsOn: ['station', 'auth'],

    async bootstrap(): Promise<void> {
      unsubscribeAuth = subscribeAuthRuntimeSnapshot(applyAuthDecision);
      unsubscribeStore = useAuthStore.subscribe((next, previous) => {
        if (
          next.accessDecision !== previous.accessDecision
          || next.loading !== previous.loading
          || next.error !== previous.error
          || next.restored !== previous.restored
        ) {
          publishFromStore();
        }
      });
      await restoreAndRevalidateAccessRuntime();
      applyAuthDecision();
    },

    async suspend(): Promise<void> {
      // Access has no producer while the application is backgrounded.
    },

    async resume(): Promise<void> {
      await restoreAndRevalidateAccessRuntime();
      applyAuthDecision();
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      unsubscribeAuth?.();
      unsubscribeAuth = null;
      unsubscribeStore?.();
      unsubscribeStore = null;
      fenceAccessRuntimeProjection();
      return {
        runtimeId: 'access',
        success: true,
        durationMs: performance.now() - start,
      };
    },
  };
}

async function startAccessAttemptWithInvalidSessionRecovery(
  sessionId: string | undefined,
  startAttempt: StartAccessAttempt,
  clearSession: () => Promise<void>,
): Promise<AccessDecision> {
  try {
    return await startAttempt(sessionId);
  } catch (error) {
    if (!sessionId || !isRevokedSessionError(readableErrorMessage(error))) {
      throw error;
    }
    await clearSession();
    return startAttempt();
  }
}

function isRevokedSessionError(message: string): boolean {
  return (
    /session\s+(invalid|revoked|expired)|invalid\s+session|revoked/i.test(
      message,
    )
    || /mobile\.auth\.accessGateStationRejected:401\b/i.test(message)
  );
}

function sanitizeAccessDecision(
  projection: OAuthAccessDecisionProjection,
): AccessDecision {
  return accessDecisionFromProjection(projection);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AccessRuntimeSnapshot {
  return snapshot;
}

function publishFromStore(): void {
  snapshot = snapshotFromStore();
  listeners.forEach((listener) => listener());
}

function snapshotFromStore(): AccessRuntimeSnapshot {
  const state = useAuthStore.getState();
  return {
    decision: state.accessDecision ? {
      ...state.accessDecision,
      gates: state.accessDecision.gates.map((gate) => ({ ...gate })),
    } : null,
    loading: state.loading,
    errorKey: state.error?.startsWith('mobile.') ? state.error : null,
    restored: state.restored,
  };
}

export const accessRuntimeTestContract = {
  applyRefreshedAccessDecision,
  isRevokedSessionError,
  sanitizeAccessDecision,
  startAccessAttemptWithInvalidSessionRecovery,
};
