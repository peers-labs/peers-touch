import { invoke } from '@tauri-apps/api/core';
import { useSyncExternalStore } from 'react';

import type {
  MobileRuntimeContext,
  MobileRuntimeDescriptor,
  RuntimeOperationResult,
} from '../app/lifecycle/types';
import {
  isAccessGranted,
  type AccessDecision,
  type MobileAuthSession,
} from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import {
  activeStationEntry,
  type MobileStationEntry,
} from '../features/station/stationRegistry';
import type { OAuthPublicProjection } from '../services/mobileCommands';
import {
  readAuthRuntimeSnapshot,
  subscribeAuthRuntimeSnapshot,
} from './authRuntime';
import {
  bindMobileSessionMutationAdmission,
  mobileMutationScopeKey,
} from './mutationAdmission';
import { getRecoveryProjection } from './recoveryProjection';
import { readStationRegistryProjection } from './stationRuntime';

const REFRESH_WINDOW_MS = 2 * 60 * 1_000;
const REFRESH_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;
const MAX_PLATFORM_TIMER_DELAY_MS = 2_147_483_647;

export type SessionRuntimePhase =
  | 'inactive'
  | 'active'
  | 'refreshing'
  | 'revoking'
  | 'revoked'
  | 'expired'
  | 'failed';

export type SessionCredentialOwner = 'native-oauth';
export type SessionRefreshReason = 'scheduled' | 'authenticated-401';
export type SessionAdmission = 'read' | 'write';

export interface MobileSessionProjection {
  readonly stationPeerId: string;
  readonly stationUrl: string;
  readonly sessionId: string;
  readonly actorPtid: string;
  readonly deviceId: string;
  readonly lifecycleGeneration: number;
  readonly expiresAt?: string;
  readonly credentialOwner: SessionCredentialOwner;
}

export interface SessionRuntimeSnapshot {
  readonly phase: SessionRuntimePhase;
  readonly session: MobileSessionProjection | null;
  readonly writesAllowed: boolean;
  readonly refreshReason: SessionRefreshReason | null;
  readonly errorKey: string | null;
}

export interface NativeSessionProjection {
  readonly stationPeerId: string;
  readonly sessionId: string;
  readonly actorPtid: string;
  readonly deviceId: string;
  readonly lifecycleGeneration: number;
  readonly expiresAt: string;
}

export interface NativeSessionSecureStorageAbsence {
  readonly activeAttemptIndexAbsent: boolean;
  readonly attemptSecretRecordAbsent: boolean;
  readonly currentSessionIndexAbsent: boolean;
  readonly credentialRecordAbsent: boolean;
  readonly publicProjectionAbsent: boolean;
}

export interface NativeSessionRevocation {
  readonly stationRevocation: 'not_required' | 'confirmed' | 'unconfirmed';
  readonly secureStorage: NativeSessionSecureStorageAbsence;
}

export interface SessionRuntimeRevocation {
  readonly remoteRevocation: 'confirmed' | 'unconfirmed' | 'not-required';
  readonly nativePurge: NativeSessionRevocation | null;
}

export interface SessionAccessCandidate {
  readonly sessionId: string;
}

interface NativeSessionScope {
  readonly stationOrigin: string;
  readonly stationPeerId: string;
}

interface NativeSessionPort {
  read(scope: NativeSessionScope): Promise<NativeSessionProjection | null>;
  refresh(scope: NativeSessionScope): Promise<NativeSessionProjection>;
  revoke(scope: NativeSessionScope | null): Promise<NativeSessionRevocation>;
}

interface SessionRuntimeClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export interface SessionRuntimeController {
  getSnapshot(): SessionRuntimeSnapshot;
  subscribe(listener: () => void): () => void;
  restore(
    station: MobileStationEntry | null,
    decision: AccessDecision | null,
  ): Promise<MobileSessionProjection | null>;
  observeOAuthProjection(
    projection: OAuthPublicProjection,
    station: MobileStationEntry | null,
    decision: AccessDecision | null,
  ): void;
  refresh(reason: SessionRefreshReason): Promise<MobileSessionProjection>;
  runAfterAuthenticated401<T>(
    request: () => Promise<T>,
    isAuthenticated401: (error: unknown) => boolean,
    admission?: SessionAdmission,
  ): Promise<T>;
  revoke(): Promise<SessionRuntimeRevocation>;
  fence(): void;
  suspend(): void;
  fail(error: unknown): void;
}

interface SessionRuntimeOptions {
  readonly native: NativeSessionPort;
  readonly clock: SessionRuntimeClock;
  readonly retryDelaysMs?: readonly number[];
  readonly onSessionChanged?: (session: MobileSessionProjection | null) => void;
}

const nativeSessionPort: NativeSessionPort = {
  read: (input) => invoke<NativeSessionProjection | null>(
    'oauth_session_projection',
    { input },
  ),
  refresh: (input) => invoke<NativeSessionProjection>(
    'oauth_session_refresh',
    { input },
  ),
  revoke: (input) => invoke<NativeSessionRevocation>(
    'oauth_logout_purge',
    { input },
  ),
};

const runtimeClock: SessionRuntimeClock = {
  now: Date.now,
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

export function createSessionRuntimeController({
  native,
  clock,
  retryDelaysMs = REFRESH_RETRY_DELAYS_MS,
  onSessionChanged,
}: SessionRuntimeOptions): SessionRuntimeController {
  const listeners = new Set<() => void>();
  let snapshot: SessionRuntimeSnapshot = inactiveSnapshot();
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshInFlight: Promise<MobileSessionProjection> | null = null;
  let revokeInFlight: Promise<SessionRuntimeRevocation> | null = null;
  let revocationTarget: MobileSessionProjection | null = null;
  let refreshRetryIndex = 0;

  const publish = (next: SessionRuntimeSnapshot) => {
    snapshot = next;
    onSessionChanged?.(next.session);
    listeners.forEach((listener) => listener());
  };

  const clearRefreshTimer = () => {
    if (refreshTimer === null) return;
    clock.clearTimeout(refreshTimer);
    refreshTimer = null;
  };

  const scopeFor = (session: MobileSessionProjection): NativeSessionScope => ({
    stationOrigin: session.stationUrl,
    stationPeerId: session.stationPeerId,
  });

  const scheduleAt = (delayMs: number, reason: SessionRefreshReason) => {
    clearRefreshTimer();
    const deadline = clock.now() + Math.max(0, delayMs);
    const armTimer = () => {
      const remainingMs = Math.max(0, deadline - clock.now());
      const timerDelayMs = Math.min(
        remainingMs,
        MAX_PLATFORM_TIMER_DELAY_MS,
      );
      refreshTimer = clock.setTimeout(() => {
        refreshTimer = null;
        if (clock.now() < deadline) {
          armTimer();
          return;
        }
        void refresh(reason).catch(() => {
          // The session projection records the typed terminal or retry state.
        });
      }, timerDelayMs);
    };
    armTimer();
  };

  const scheduleRefresh = (session: MobileSessionProjection) => {
    clearRefreshTimer();
    if (!session.expiresAt) return;
    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      revocationTarget = session;
      publish({
        phase: 'failed',
        session: null,
        writesAllowed: false,
        refreshReason: null,
        errorKey: 'mobile.auth.sessionExpiryInvalid',
      });
      return;
    }
    scheduleAt(expiresAt - clock.now() - REFRESH_WINDOW_MS, 'scheduled');
  };

  const activate = (session: MobileSessionProjection) => {
    if (!isMobileSessionProjectionValid(session, clock.now())) {
      revocationTarget = session;
      publish({
        phase: 'expired',
        session: null,
        writesAllowed: false,
        refreshReason: null,
        errorKey: 'mobile.auth.sessionExpired',
      });
      return;
    }
    revocationTarget = session;
    refreshRetryIndex = 0;
    publish({
      phase: 'active',
      session,
      writesAllowed: true,
      refreshReason: null,
      errorKey: null,
    });
    getRecoveryProjection().clearDeviceLocalFlag('session-expired');
    scheduleRefresh(session);
  };

  const projectNative = (
    nativeProjection: NativeSessionProjection,
    station: Pick<MobileStationEntry, 'stationPeerId' | 'url'>,
  ): MobileSessionProjection => {
    const session = sanitizeNativeSessionProjection(nativeProjection, station.url);
    if (session.stationPeerId !== station.stationPeerId) {
      throw new Error('mobile.auth.sessionStationMismatch');
    }
    return session;
  };

  const revoke = (): Promise<SessionRuntimeRevocation> => {
    if (revokeInFlight) return revokeInFlight;
    const target = snapshot.session ?? revocationTarget;
    clearRefreshTimer();
    refreshRetryIndex = 0;
    publish({
      phase: 'revoking',
      session: null,
      writesAllowed: false,
      refreshReason: null,
      errorKey: null,
    });

    const operation = (async () => {
      try {
        let nativePurge: NativeSessionRevocation | null = null;
        let remoteRevocation: SessionRuntimeRevocation['remoteRevocation'] =
          'not-required';
        if (target) {
          nativePurge = await native.revoke(scopeFor(target));
          if (!nativeStorageIsEmpty(nativePurge.secureStorage)) {
            throw new Error('mobile.auth.sessionSecurePurgeIncomplete');
          }
          remoteRevocation = nativePurge.stationRevocation === 'not_required'
            ? 'not-required'
            : nativePurge.stationRevocation;
        }
        revocationTarget = null;
        publish({
          phase: 'revoked',
          session: null,
          writesAllowed: false,
          refreshReason: null,
          errorKey: null,
        });
        return { remoteRevocation, nativePurge };
      } catch (error) {
        publish({
          phase: 'failed',
          session: null,
          writesAllowed: false,
          refreshReason: null,
          errorKey: sessionErrorKey(error),
        });
        throw error;
      }
    })();
    const trackedOperation = operation.finally(() => {
      if (revokeInFlight === trackedOperation) {
        revokeInFlight = null;
      }
    });
    revokeInFlight = trackedOperation;
    return trackedOperation;
  };

  const refresh = (
    reason: SessionRefreshReason,
  ): Promise<MobileSessionProjection> => {
    if (refreshInFlight) return refreshInFlight;
    const current = snapshot.session ?? revocationTarget;
    if (!current) {
      return Promise.reject(new Error('mobile.auth.nativeSessionRequired'));
    }
    if (!isMobileSessionProjectionValid(current, clock.now())) {
      revocationTarget = current;
      publish({
        phase: 'expired',
        session: null,
        writesAllowed: false,
        refreshReason: reason,
        errorKey: 'mobile.auth.sessionExpired',
      });
      const operation = (async () => {
        try {
          await revoke();
          throw new Error('mobile.auth.sessionExpired');
        } finally {
          refreshInFlight = null;
        }
      })();
      refreshInFlight = operation;
      return operation;
    }

    clearRefreshTimer();
    publish({
      phase: 'refreshing',
      session: current,
      writesAllowed: false,
      refreshReason: reason,
      errorKey: null,
    });

    const operation = (async () => {
      try {
        const refreshed = projectNative(
          await native.refresh(scopeFor(current)),
          {
            stationPeerId: current.stationPeerId,
            url: current.stationUrl,
          },
        );
        if (refreshed.actorPtid !== current.actorPtid) {
          throw new Error('mobile.auth.sessionIdentityMismatch');
        }
        activate(refreshed);
        return refreshed;
      } catch (error) {
        const terminal = reason === 'authenticated-401'
          || isTerminalSessionRefreshError(error)
          || !isMobileSessionProjectionValid(current, clock.now());
        if (terminal) {
          revocationTarget = current;
          await revoke();
        } else {
          const retryDelay = retryDelaysMs[refreshRetryIndex];
          refreshRetryIndex += 1;
          publish({
            phase: 'active',
            session: current,
            writesAllowed: true,
            refreshReason: null,
            errorKey: 'mobile.auth.sessionRefreshRetrying',
          });
          if (retryDelay !== undefined) {
            const expiresAt = Date.parse(current.expiresAt ?? '');
            scheduleAt(
              Math.min(retryDelay, Math.max(0, expiresAt - clock.now())),
              'scheduled',
            );
          } else {
            scheduleAt(
              Math.max(0, Date.parse(current.expiresAt ?? '') - clock.now()),
              'scheduled',
            );
          }
        }
        throw error;
      } finally {
        refreshInFlight = null;
      }
    })();
    refreshInFlight = operation;
    return operation;
  };

  return {
    getSnapshot: () => snapshot,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async restore(station, decision) {
      clearRefreshTimer();
      if (!station || !isAccessGranted(decision)) {
        publish(inactiveSnapshot());
        return null;
      }
      const nativeProjection = await native.read({
        stationOrigin: station.url,
        stationPeerId: station.stationPeerId,
      });
      if (nativeProjection) {
        const projected = projectNative(nativeProjection, station);
        activate(projected);
        return projected;
      }
      publish(inactiveSnapshot());
      return null;
    },

    observeOAuthProjection(projection, station, decision) {
      if (!station || !isAccessGranted(decision)) {
        publish(inactiveSnapshot());
        return;
      }
      if (projection.phase !== 'active_session' || !projection.session) return;
      const projected = projectNative({
        stationPeerId: projection.stationPeerId ?? '',
        sessionId: projection.session.sessionId,
        actorPtid: projection.session.actorPtid,
      deviceId: projection.session.deviceId,
      lifecycleGeneration: projection.session.lifecycleGeneration,
        expiresAt: projection.session.expiresAt,
      }, station);
      activate(projected);
    },

    refresh,

    async runAfterAuthenticated401(
      request,
      isAuthenticated401,
      admission = 'write',
    ) {
      assertSessionAdmission(snapshot, admission, clock.now());
      try {
        return await request();
      } catch (error) {
        if (!isAuthenticated401(error)) throw error;
        await refresh('authenticated-401');
        assertSessionAdmission(snapshot, admission, clock.now());
        return request();
      }
    },

    revoke,

    fence() {
      clearRefreshTimer();
      revocationTarget = snapshot.session ?? revocationTarget;
      publish(inactiveSnapshot());
    },

    suspend() {
      clearRefreshTimer();
    },

    fail(error) {
      clearRefreshTimer();
      revocationTarget = snapshot.session ?? revocationTarget;
      publish({
        phase: 'failed',
        session: null,
        writesAllowed: false,
        refreshReason: null,
        errorKey: sessionErrorKey(error),
      });
    },
  };
}

const sessionRuntime = createSessionRuntimeController({
  native: nativeSessionPort,
  clock: runtimeClock,
  onSessionChanged: (session) => {
    useAuthStore.getState().setSession(
      session ? mobileAuthSessionFromProjection(session) : null,
    );
  },
});

export function useSessionRuntime(): SessionRuntimeSnapshot {
  return useSyncExternalStore(
    sessionRuntime.subscribe,
    sessionRuntime.getSnapshot,
    sessionRuntime.getSnapshot,
  );
}

export function readSessionRuntimeSnapshot(): SessionRuntimeSnapshot {
  return sessionRuntime.getSnapshot();
}

export function readActiveSessionProjection(): MobileSessionProjection | null {
  const current = sessionRuntime.getSnapshot();
  return (current.phase === 'active' || current.phase === 'refreshing')
    && isMobileSessionProjectionValid(current.session, runtimeClock.now())
    ? current.session
    : null;
}

export function assertSessionWriteAdmission(): MobileSessionProjection {
  const current = sessionRuntime.getSnapshot();
  assertWritesAllowed(current);
  return current.session!;
}

export function assertSessionReadAdmission(): MobileSessionProjection {
  const current = sessionRuntime.getSnapshot();
  assertReadableSession(current, runtimeClock.now());
  return current.session!;
}

export function refreshSessionRuntime(
  reason: SessionRefreshReason,
): Promise<MobileSessionProjection> {
  return sessionRuntime.refresh(reason);
}

export function runAfterAuthenticated401<T>(
  request: () => Promise<T>,
  isAuthenticated401: (error: unknown) => boolean,
  admission: SessionAdmission = 'write',
): Promise<T> {
  return sessionRuntime.runAfterAuthenticated401(
    request,
    isAuthenticated401,
    admission,
  );
}

export function revokeSessionRuntime(): Promise<SessionRuntimeRevocation> {
  return sessionRuntime.revoke();
}

export function logoutSessionRuntime(): Promise<SessionRuntimeRevocation> {
  return revokeSessionRuntime();
}

export async function activateNativeSessionRuntime(
  station: MobileStationEntry,
  decision: AccessDecision,
): Promise<MobileSessionProjection> {
  if (!isAccessGranted(decision)) {
    throw new Error('mobile.auth.accessGrantRequired');
  }
  const session = await sessionRuntime.restore(station, decision);
  if (!session) {
    throw new Error('mobile.auth.nativeSessionProjectionInvalid');
  }
  return session;
}

export const sessionRuntimeTestContract = {
  activate(
    session: NativeSessionProjection & { stationUrl: string },
    decision: AccessDecision,
  ): void {
    sessionRuntime.observeOAuthProjection(
      {
        phase: 'active_session',
        stationPeerId: session.stationPeerId,
        session: {
          sessionId: session.sessionId,
          actorPtid: session.actorPtid,
          deviceId: session.deviceId,
          lifecycleGeneration: session.lifecycleGeneration,
          expiresAt: session.expiresAt,
        },
      },
      {
        stationPeerId: session.stationPeerId,
        url: session.stationUrl,
      } as MobileStationEntry,
      decision,
    );
  },
};

export function fenceSessionRuntimeProjection(): void {
  sessionRuntime.fence();
  useAuthStore.getState().hideSessionProjection();
}

export async function readNativeSessionProjection(
  station: Pick<MobileStationEntry, 'stationPeerId' | 'url'>,
): Promise<NativeSessionProjection | null> {
  return nativeSessionPort.read({
    stationOrigin: station.url,
    stationPeerId: station.stationPeerId,
  });
}

export async function readSessionCandidateForAccess(
  station: Pick<MobileStationEntry, 'stationPeerId' | 'url'>,
): Promise<SessionAccessCandidate | null> {
  const nativeSession = await readNativeSessionProjection(station);
  if (nativeSession) {
    return {
      sessionId: nativeSession.sessionId,
    };
  }
  return null;
}

export async function clearSessionCandidateForAccess(
  station: Pick<MobileStationEntry, 'stationPeerId' | 'url'>,
  _candidate: SessionAccessCandidate,
): Promise<void> {
  await purgeNativeSessionProjection(station);
}

export async function purgeNativeSessionProjection(
  station: Pick<MobileStationEntry, 'stationPeerId' | 'url'>,
): Promise<NativeSessionRevocation> {
  const result = await nativeSessionPort.revoke({
    stationOrigin: station.url,
    stationPeerId: station.stationPeerId,
  });
  if (!nativeStorageIsEmpty(result.secureStorage)) {
    throw new Error('mobile.auth.sessionSecurePurgeIncomplete');
  }
  sessionRuntime.fence();
  useAuthStore.getState().hideSessionProjection();
  return result;
}

export async function purgeAllNativeSessionState(): Promise<NativeSessionRevocation> {
  const result = await nativeSessionPort.revoke(null);
  if (!nativeStorageIsEmpty(result.secureStorage)) {
    throw new Error('mobile.auth.sessionSecurePurgeIncomplete');
  }
  sessionRuntime.fence();
  useAuthStore.getState().hideSessionProjection();
  return result;
}

export function createSessionRuntimeDescriptor(): MobileRuntimeDescriptor {
  let unsubscribeAuth: (() => void) | null = null;
  let releaseMutationAdmission: (() => void) | null = null;

  const observeOAuth = async () => {
    const station = activeStationEntry(await readStationRegistryProjection());
    sessionRuntime.observeOAuthProjection(
      readAuthRuntimeSnapshot(),
      station,
      useAuthStore.getState().accessDecision,
    );
  };
  const restoreOwnedSession = async () => {
    const station = activeStationEntry(await readStationRegistryProjection());
    const state = useAuthStore.getState();
    if (!station) {
      await purgeAllNativeSessionState();
      state.hideSessionProjection();
      await sessionRuntime.restore(null, state.accessDecision);
      return;
    }
    await sessionRuntime.restore(station, state.accessDecision);
  };

  return {
    id: 'session',
    title: 'Session Runtime',
    responsibility:
      'Owns active PTID session metadata, native credential refresh, write fencing, and revocation.',
    dependsOn: ['station', 'auth', 'access'],

    async bootstrap(_context: MobileRuntimeContext): Promise<void> {
      await restoreOwnedSession();
      releaseMutationAdmission = bindMobileSessionMutationAdmission(() => {
        const current = sessionRuntime.getSnapshot();
        return {
          scopeKey: current.session
            ? mobileMutationScopeKey(
              current.session.stationPeerId,
              current.session.actorPtid,
            )
            : null,
          open: current.phase === 'active' && current.writesAllowed,
          reason: `session_${current.phase}`,
        };
      });
      unsubscribeAuth = subscribeAuthRuntimeSnapshot(() => {
        void observeOAuth().catch((error) => {
          sessionRuntime.fail(error);
        });
      });
    },

    async suspend(): Promise<void> {
      sessionRuntime.suspend();
    },

    async resume(): Promise<void> {
      await restoreOwnedSession();
    },

    async teardown(): Promise<RuntimeOperationResult> {
      const start = performance.now();
      unsubscribeAuth?.();
      unsubscribeAuth = null;
      releaseMutationAdmission?.();
      releaseMutationAdmission = null;
      fenceSessionRuntimeProjection();
      return {
        runtimeId: 'session',
        success: true,
        durationMs: performance.now() - start,
      };
    },
  };
}

function sanitizeNativeSessionProjection(
  value: NativeSessionProjection,
  stationUrl: string,
): MobileSessionProjection {
  const stationPeerId = value.stationPeerId?.trim();
  const sessionId = value.sessionId?.trim();
  const actorPtid = value.actorPtid?.trim();
  const deviceId = value.deviceId?.trim();
  const lifecycleGeneration = value.lifecycleGeneration;
  const expiresAt = value.expiresAt?.trim();
  if (
    !stationPeerId
    || !sessionId
    || !actorPtid
    || !deviceId
    || !Number.isSafeInteger(lifecycleGeneration)
    || lifecycleGeneration <= 0
    || !expiresAt
  ) {
    throw new Error('mobile.auth.nativeSessionProjectionInvalid');
  }
  return {
    stationPeerId,
    stationUrl: stationUrl.replace(/\/+$/, ''),
    sessionId,
    actorPtid,
    deviceId,
    lifecycleGeneration,
    expiresAt,
    credentialOwner: 'native-oauth',
  };
}

export function isMobileSessionProjectionValid(
  session: MobileSessionProjection | null,
  now: number,
): session is MobileSessionProjection {
  if (
    !session
    || !session.stationPeerId
    || !session.stationUrl
    || !session.sessionId
    || !session.actorPtid
    || !session.deviceId
    || !Number.isSafeInteger(session.lifecycleGeneration)
    || session.lifecycleGeneration <= 0
  ) {
    return false;
  }
  if (!session.expiresAt) return false;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function mobileAuthSessionFromProjection(
  session: MobileSessionProjection,
): MobileAuthSession {
  return {
    stationPeerId: session.stationPeerId,
    stationUrl: session.stationUrl,
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    lifecycleGeneration: session.lifecycleGeneration,
    expiresAt: session.expiresAt,
    actorRef: { ptid: session.actorPtid },
    authenticatedAt: Date.now(),
  };
}

function assertWritesAllowed(snapshot: SessionRuntimeSnapshot): void {
  if (snapshot.phase !== 'active' || !snapshot.writesAllowed || !snapshot.session) {
    throw new Error('mobile.auth.sessionWritesClosed');
  }
}

function assertReadableSession(
  snapshot: SessionRuntimeSnapshot,
  now: number,
): void {
  if (
    !['active', 'refreshing'].includes(snapshot.phase)
    || !isMobileSessionProjectionValid(snapshot.session, now)
  ) {
    throw new Error('mobile.auth.sessionUnavailable');
  }
}

function assertSessionAdmission(
  snapshot: SessionRuntimeSnapshot,
  admission: SessionAdmission,
  now: number,
): void {
  if (admission === 'write') {
    assertWritesAllowed(snapshot);
    return;
  }
  assertReadableSession(snapshot, now);
}

function isTerminalSessionRefreshError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /oauthTransportUnavailable|oauthResponseRead|sessionCredentialRejected:(408|429|5\d\d)/.test(
      message,
    )
  ) {
    return false;
  }
  return /mobile\.auth\.session/.test(message);
}

function nativeStorageIsEmpty(
  absence: NativeSessionSecureStorageAbsence,
): boolean {
  return absence.activeAttemptIndexAbsent
    && absence.attemptSecretRecordAbsent
    && absence.currentSessionIndexAbsent
    && absence.credentialRecordAbsent
    && absence.publicProjectionAbsent;
}

function sessionErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/mobile\.auth\.[A-Za-z0-9]+/)?.[0]
    ?? 'mobile.auth.sessionFailed';
}

function inactiveSnapshot(): SessionRuntimeSnapshot {
  return {
    phase: 'inactive',
    session: null,
    writesAllowed: false,
    refreshReason: null,
    errorKey: null,
  };
}
