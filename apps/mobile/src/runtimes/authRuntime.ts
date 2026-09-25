import { useSyncExternalStore } from 'react';

import type {
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
} from '../app/lifecycle/types';
import { registerOAuthAccessGrantFinalizer } from '../features/auth/authSession';
import { activeStationEntry } from '../features/station/stationRegistry';
import {
  oauthCancel,
  oauthProjection,
  oauthRestore,
  oauthRetryBrowser,
  oauthStart,
  oauthStatus,
  type MobileOAuthProvider,
  type OAuthPublicPhase,
  type OAuthPublicProjection,
  type OAuthScopeInput,
} from '../services/mobileCommands';
import { readableErrorMessage } from '../utils/errorMessage';
import { readStationRegistryProjection } from './stationRuntime';

export type { MobileOAuthProvider, OAuthPublicPhase, OAuthPublicProjection };

export type AuthRuntimeRecovery =
  | 'none'
  | 'retry-provider'
  | 'check-status'
  | 'restart'
  | 'change-station';

export interface AuthRuntimeSnapshot extends OAuthPublicProjection {
  candidatePtid: string | null;
  errorKey: string | null;
  recovery: AuthRuntimeRecovery;
}

interface StartOAuthInput {
  provider: MobileOAuthProvider;
  stationUrl: string;
  accessAttemptId: string;
  gateId: string;
}

const PUBLIC_PHASES: readonly OAuthPublicPhase[] = [
  'idle',
  'starting',
  'awaiting_provider',
  'callback_received',
  'exchanging',
  'following_gate',
  'credential_delivery',
  'active_session',
  'cancelled',
  'expired',
  'failed',
];

const listeners = new Set<() => void>();
let snapshot: AuthRuntimeSnapshot = snapshotFromProjection(emptyProjection());

export function useAuthRuntime(): AuthRuntimeSnapshot {
  return useSyncExternalStore(
    subscribeAuthRuntimeSnapshot,
    getSnapshot,
    getSnapshot,
  );
}

export function readAuthRuntimeSnapshot(): AuthRuntimeSnapshot {
  return snapshotFromProjection(sanitizeProjection(snapshot));
}

export function fenceAuthRuntimeProjection(): void {
  setSnapshot(snapshotFromProjection(emptyProjection()));
}

export async function startOAuth(input: StartOAuthInput): Promise<void> {
  try {
    const scope = await activeOAuthScope(input.stationUrl);
    applyAuthRuntimeProjection(await oauthStart({
      ...scope,
      provider: input.provider,
      accessAttemptId: input.accessAttemptId,
      gateId: input.gateId,
    }));
  } catch (error) {
    applyIntentFailure(error);
  }
}

export async function refreshOAuthStatus(): Promise<void> {
  try {
    applyAuthRuntimeProjection(await oauthStatus(await activeOAuthScope()));
  } catch (error) {
    applyIntentFailure(error, 'check-status');
  }
}

export async function retryOAuthBrowser(): Promise<void> {
  try {
    applyAuthRuntimeProjection(await oauthRetryBrowser());
  } catch (error) {
    applyIntentFailure(error, 'retry-provider');
  }
}

export async function cancelOAuth(): Promise<void> {
  try {
    await cancelOAuthForScope(await activeOAuthScope());
  } catch (error) {
    applyIntentFailure(error, 'restart');
  }
}

export async function cancelOAuthForScope(scope: OAuthScopeInput): Promise<void> {
  applyAuthRuntimeProjection(await oauthCancel(scope));
}

export async function restoreAuthRuntimeProjection(): Promise<void> {
  try {
    const station = activeStationEntry(
      await readStationRegistryProjection(),
    );
    if (!station) return;
    const scope = {
      stationOrigin: station.url,
      stationPeerId: station.stationPeerId,
    };
    const persisted = sanitizeProjection(await oauthProjection());
    if (persisted.stationPeerId && persisted.stationPeerId !== scope.stationPeerId) return;
    applyAuthRuntimeProjection(await oauthRestore(scope));
  } catch (error) {
    applyIntentFailure(error);
  }
}

export function applyAuthRuntimeProjection(projection: OAuthPublicProjection): void {
  setSnapshot(snapshotFromProjection(sanitizeProjection(projection)));
}

function sanitizeProjection(projection: OAuthPublicProjection): OAuthPublicProjection {
  const phase = PUBLIC_PHASES.includes(projection.phase) ? projection.phase : 'failed';
  return {
    phase,
    stationPeerId: projection.stationPeerId,
    provider: projection.provider,
    accessAttemptId: projection.accessAttemptId,
    gateId: projection.gateId,
    expiresAtUnixMs: projection.expiresAtUnixMs,
    result: projection.result,
    errorCode: projection.errorCode,
    candidate: projection.candidate ? {
      candidateId: projection.candidate.candidateId,
      actorPtid: projection.candidate.actorPtid,
      accessAttemptId: projection.candidate.accessAttemptId,
      stationPeerId: projection.candidate.stationPeerId,
      decisionRevision: projection.candidate.decisionRevision,
      issuedAtUnixMs: projection.candidate.issuedAtUnixMs,
      expiresAtUnixMs: projection.candidate.expiresAtUnixMs,
    } : undefined,
    accessDecision: projection.accessDecision ? {
      state: projection.accessDecision.state,
      attemptId: projection.accessDecision.attemptId,
      currentGateId: projection.accessDecision.currentGateId,
      actorPtid: projection.accessDecision.actorPtid,
      accessGrantId: projection.accessDecision.accessGrantId,
      expiresAtUnixMs: projection.accessDecision.expiresAtUnixMs,
      message: projection.accessDecision.message,
      gates: projection.accessDecision.gates.map((gate) => ({
        gateId: gate.gateId,
        gateType: gate.gateType,
        state: gate.state,
        title: gate.title,
        description: gate.description,
        blockingReason: gate.blockingReason,
        submitAction: gate.submitAction,
        inputSchemaJson: gate.inputSchemaJson,
        alternativeActions: gate.alternativeActions.map((action) => ({
          actionId: action.actionId,
          actionType: action.actionType,
          submitAction: action.submitAction,
          schemaRevision: action.schemaRevision,
          schemaDigest: action.schemaDigest,
        })),
        actionId: gate.actionId,
        schemaRevision: gate.schemaRevision,
        schemaDigest: gate.schemaDigest,
      })),
    } : undefined,
    session: projection.session ? {
      sessionId: projection.session.sessionId,
      actorPtid: projection.session.actorPtid,
      deviceId: projection.session.deviceId,
      lifecycleGeneration: projection.session.lifecycleGeneration,
      expiresAt: projection.session.expiresAt,
    } : undefined,
  };
}

function snapshotFromProjection(projection: OAuthPublicProjection): AuthRuntimeSnapshot {
  const errorKey = projectionErrorKey(projection);
  return {
    ...projection,
    candidatePtid: projection.candidate?.actorPtid ?? null,
    errorKey,
    recovery: projectionRecovery(projection, errorKey),
  };
}

function projectionErrorKey(projection: OAuthPublicProjection): string | null {
  if (projection.errorCode?.startsWith('mobile.auth.')) return projection.errorCode;
  switch (projection.result) {
    case 'OAUTH_ATTEMPT_RESULT_EXPIRED':
      return 'mobile.auth.oauthExpired';
    case 'OAUTH_ATTEMPT_RESULT_REPLAYED':
      return 'mobile.auth.oauthReplay';
    case 'OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH':
      return 'mobile.auth.oauthBindingMismatch';
    case 'OAUTH_ATTEMPT_RESULT_PROVIDER_ERROR':
      return 'mobile.auth.oauthProviderError';
    case 'OAUTH_ATTEMPT_RESULT_ACCESS_DENIED':
      return 'mobile.auth.oauthAccessDenied';
    case 'OAUTH_ATTEMPT_RESULT_CANCELLED':
      return 'mobile.auth.oauthCancelled';
    default:
      return projection.phase === 'expired'
        ? 'mobile.auth.oauthExpired'
        : projection.phase === 'failed'
          ? 'mobile.auth.oauthFailed'
          : null;
  }
}

function projectionRecovery(
  projection: OAuthPublicProjection,
  errorKey: string | null,
): AuthRuntimeRecovery {
  if (projection.errorCode === 'OAUTH_START_UNCERTAIN'
    || projection.errorCode === 'OAUTH_COMPLETE_UNCERTAIN'
    || projection.phase === 'credential_delivery') {
    return 'check-status';
  }
  if (errorKey === 'mobile.auth.oauthBrowserUnavailable') return 'retry-provider';
  if (errorKey === 'mobile.auth.oauthStationMismatch') return 'change-station';
  if (projection.phase === 'failed' || projection.phase === 'expired') return 'restart';
  return 'none';
}

export function oauthPhaseMessageKey(phase: OAuthPublicPhase): string {
  if (phase === 'credential_delivery') return 'mobile.auth.oauthState.exchanging';
  return `mobile.auth.oauthState.${phase.replaceAll('_', '-')}`;
}

async function activeOAuthScope(expectedOrigin?: string): Promise<OAuthScopeInput> {
  const station = activeStationEntry(
    await readStationRegistryProjection(),
  );
  const normalizedExpectedOrigin = expectedOrigin?.replace(/\/+$/, '');
  if (!station || (normalizedExpectedOrigin && station.url !== normalizedExpectedOrigin)) {
    throw new Error('mobile.auth.oauthStationMismatch');
  }
  return {
    stationOrigin: station.url,
    stationPeerId: station.stationPeerId,
  };
}

function applyIntentFailure(
  error: unknown,
  fallbackRecovery: AuthRuntimeRecovery = 'restart',
): void {
  const message = readableErrorMessage(error);
  const marker = message.match(/mobile\.auth\.[A-Za-z0-9]+/)?.[0];
  const errorKey = marker ?? 'mobile.auth.oauthFailed';
  const recovery = errorKey === 'mobile.auth.oauthBrowserUnavailable'
    ? 'retry-provider'
    : errorKey === 'mobile.auth.oauthStationMismatch'
      ? 'change-station'
      : fallbackRecovery;
  setSnapshot({ ...snapshot, errorKey, recovery });
}

function emptyProjection(): OAuthPublicProjection {
  return { phase: 'idle' };
}

export function subscribeAuthRuntimeSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AuthRuntimeSnapshot {
  return snapshot;
}

function setSnapshot(next: AuthRuntimeSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function createAuthRuntimeDescriptor(): MobileRuntimeDescriptor {
  return {
    id: 'auth',
    title: 'Auth Runtime',
    responsibility:
      'Owns Station-scoped credential attempts, OAuth callbacks, candidate isolation, cancellation, and typed recovery.',
    dependsOn: ['secure-storage', 'station'],

    async bootstrap(): Promise<void> {
      await restoreAuthRuntimeProjection();
    },

    async suspend(): Promise<void> {
      // Attempt material is persisted by Rust and has no Web producer to pause.
    },

    async resume(): Promise<void> {
      await restoreAuthRuntimeProjection();
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      fenceAuthRuntimeProjection();
      return {
        runtimeId: 'auth',
        success: true,
        durationMs: performance.now() - start,
      };
    },
  };
}

registerOAuthAccessGrantFinalizer(async () => {
  if (snapshot.phase !== 'following_gate') return;
  await refreshOAuthStatus();
  if (getSnapshot().phase !== 'active_session') {
    throw new Error(getSnapshot().errorKey || 'mobile.auth.oauthActivationPending');
  }
});

export const authRuntimeTestContract = {
  oauthPhaseMessageKey,
  projectionErrorKey,
  projectionRecovery,
  sanitizeProjection,
  snapshotFromProjection,
};
