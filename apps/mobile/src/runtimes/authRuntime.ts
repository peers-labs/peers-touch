import { useSyncExternalStore } from 'react';

import {
  normalizeDecision,
  registerOAuthAccessGrantFinalizer,
  startStationAccessAttempt,
  type AccessDecision,
  type MobileAuthSession,
} from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import { activeStationEntry, loadStationRegistry } from '../features/station/stationRegistry';
import {
  oauthCancel,
  oauthProjection,
  oauthRestore,
  oauthRetryBrowser,
  oauthStart,
  oauthStatus,
  type MobileOAuthProvider,
  type OAuthAccessDecisionProjection,
  type OAuthPublicPhase,
  type OAuthPublicProjection,
  type OAuthScopeInput,
} from '../services/mobileCommands';
import { readableErrorMessage } from '../utils/errorMessage';

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

export interface AccessRuntimePublicProjection {
  decision: AccessDecision | null;
  session: {
    stationPeerId: string;
    actorPtid: string;
    expiresAt?: string;
  } | null;
  loading: boolean;
  errorKey: string | null;
  restored: boolean;
}

interface StartOAuthInput {
  provider: MobileOAuthProvider;
  stationUrl: string;
  accessAttemptId: string;
  gateId: string;
}

type StartAccessAttempt = (sessionId?: string) => Promise<AccessDecision>;

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
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function readAuthRuntimeSnapshot(): AuthRuntimeSnapshot {
  return snapshotFromProjection(sanitizeProjection(snapshot));
}

export function readActiveAuthSession(): MobileAuthSession | null {
  return useAuthStore.getState().session;
}

export function readAccessRuntimeProjection(): AccessRuntimePublicProjection {
  const state = useAuthStore.getState();
  return {
    decision: state.accessDecision ? {
      ...state.accessDecision,
      gates: state.accessDecision.gates.map((gate) => ({ ...gate })),
    } : null,
    session: state.session ? {
      stationPeerId: state.session.stationPeerId,
      actorPtid: state.session.actorRef.ptid,
      expiresAt: state.session.expiresAt,
    } : null,
    loading: state.loading,
    errorKey: state.error?.startsWith('mobile.') ? state.error : null,
    restored: state.restored,
  };
}

export function applyAccessGateRuntimeResult(
  decision: AccessDecision,
  session?: MobileAuthSession,
): void {
  const state = useAuthStore.getState();
  state.setAccessDecision(decision);
  if (session) state.setSession(session);
}

export async function startAccessAttemptForActiveStation(): Promise<AccessDecision> {
  const station = activeStationEntry(await loadStationRegistry());
  if (!station) throw new Error('mobile.auth.activeStationRequired');

  const state = useAuthStore.getState();
  state.setLoading(true);
  state.setError(null);
  try {
    const decision = await startStationAccessAttemptWithRecovery(
      station.stationPeerId,
      station.url,
      state.session,
    );
    applyAccessGateRuntimeResult(decision);
    return decision;
  } catch (error) {
    const message = readableErrorMessage(error);
    state.setError(message);
    throw error;
  } finally {
    state.setLoading(false);
  }
}

export async function startStationAccessAttemptWithRecovery(
  stationPeerId: string,
  stationUrl: string,
  session?: MobileAuthSession | null,
): Promise<AccessDecision> {
  return startAccessAttemptWithInvalidSessionRecovery(
    session?.sessionId,
    (sessionId) => startStationAccessAttempt(
      stationPeerId,
      stationUrl,
      sessionId,
    ),
    clearAuthRuntimeSession,
  );
}

export async function clearAuthRuntimeSession(): Promise<void> {
  await useAuthStore.getState().clearSession();
  setSnapshot(snapshotFromProjection(emptyProjection()));
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
  return /session\s+(invalid|revoked|expired)|invalid\s+session|revoked/i.test(
    message,
  );
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
    applyAuthRuntimeProjection(await oauthCancel(await activeOAuthScope()));
  } catch (error) {
    applyIntentFailure(error, 'restart');
  }
}

export async function restoreAuthRuntimeProjection(): Promise<void> {
  try {
    const station = activeStationEntry(await loadStationRegistry());
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
  const sanitized = sanitizeProjection(projection);
  if (sanitized.accessDecision) {
    useAuthStore.getState().setAccessDecision(
      sanitizeAccessDecision(sanitized.accessDecision),
    );
  }
  setSnapshot(snapshotFromProjection(sanitized));
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
        })),
      })),
    } : undefined,
    session: projection.session ? {
      sessionId: projection.session.sessionId,
      actorPtid: projection.session.actorPtid,
      expiresAt: projection.session.expiresAt,
    } : undefined,
  };
}

function sanitizeAccessDecision(
  projection: OAuthAccessDecisionProjection,
): AccessDecision {
  return normalizeDecision({
    state: projection.state,
    attemptId: projection.attemptId,
    currentGateId: projection.currentGateId,
    accessGrantId: projection.accessGrantId,
    message: projection.message,
    gates: projection.gates.map((gate) => ({
      gateId: gate.gateId,
      type: gate.gateType,
      state: gate.state,
      title: gate.title,
      description: gate.description,
      blockingReason: gate.blockingReason,
      submitAction: gate.submitAction,
      inputSchemaJson: gate.inputSchemaJson,
    })),
  });
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
  const station = activeStationEntry(await loadStationRegistry());
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

function subscribe(listener: () => void): () => void {
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

registerOAuthAccessGrantFinalizer(async () => {
  if (snapshot.phase !== 'following_gate') return;
  await refreshOAuthStatus();
  if (getSnapshot().phase !== 'active_session') {
    throw new Error(getSnapshot().errorKey || 'mobile.auth.oauthActivationPending');
  }
});

export const authRuntimeTestContract = {
  isRevokedSessionError,
  oauthPhaseMessageKey,
  projectionErrorKey,
  projectionRecovery,
  sanitizeAccessDecision,
  sanitizeProjection,
  snapshotFromProjection,
  startAccessAttemptWithInvalidSessionRecovery,
};
