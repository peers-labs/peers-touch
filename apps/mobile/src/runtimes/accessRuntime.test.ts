// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AccessDecision,
  MobileAuthSession,
} from '../features/auth/authSession';
import { stationAccessError } from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import {
  accessRuntimeTestContract,
  applyAccessGateRuntimeResult,
  createAccessRuntimeDescriptor,
  readAccessRuntimeProjection,
} from './accessRuntime';
import type { MobileStationEntry } from '../features/station/stationRegistry';

const decision: AccessDecision = {
  state: 'ACCESS_DECISION_STATE_GRANTED',
  attemptId: 'attempt-a',
  gates: [],
};
const session: MobileAuthSession = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

describe('accessRuntime', () => {
  beforeEach(() => {
    useAuthStore.setState(useAuthStore.getInitialState(), true);
  });

  it('projects only the Station access decision', () => {
    useAuthStore.getState().setSession(session);
    applyAccessGateRuntimeResult(decision);

    expect(readAccessRuntimeProjection()).toEqual({
      decision,
      loading: false,
      errorKey: null,
      restored: false,
    });
    expect(JSON.stringify(readAccessRuntimeProjection())).not.toContain(
      'accessToken',
    );
    expect(useAuthStore.getState().session).toBe(session);
  });

  it('fences Access and Session projections independently', () => {
    useAuthStore.setState({
      accessDecision: decision,
      session,
      restored: true,
    });

    useAuthStore.getState().hideAccessProjection();
    expect(useAuthStore.getState()).toMatchObject({
      accessDecision: null,
      session,
      restored: false,
    });

    useAuthStore.getState().setAccessDecision(decision);
    useAuthStore.getState().hideSessionProjection();
    expect(useAuthStore.getState()).toMatchObject({
      accessDecision: decision,
      session: null,
    });
  });

  it('clears an invalid session and retries the same gate chain once', async () => {
    const refreshed = {
      ...decision,
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
    };
    const startAttempt = vi.fn()
      .mockRejectedValueOnce(new Error('session revoked'))
      .mockResolvedValueOnce(refreshed);
    const clearSession = vi.fn().mockResolvedValue(undefined);

    await expect(
      accessRuntimeTestContract.startAccessAttemptWithInvalidSessionRecovery(
        'stale-session',
        startAttempt,
        clearSession,
      ),
    ).resolves.toBe(refreshed);

    expect(clearSession).toHaveBeenCalledOnce();
    expect(startAttempt).toHaveBeenNthCalledWith(1, 'stale-session');
    expect(startAttempt).toHaveBeenNthCalledWith(2);
  });

  it('recovers a native object rejection through the Access boundary once', async () => {
    const refreshed = {
      ...decision,
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
    };
    const startAttempt = vi.fn()
      .mockRejectedValueOnce(
        stationAccessError({
          code: 'MOBILE_STATION_TRANSPORT',
          message: 'mobile.auth.accessGateStationRejected:401',
        }),
      )
      .mockResolvedValueOnce(refreshed);
    const clearSession = vi.fn().mockResolvedValue(undefined);

    await expect(
      accessRuntimeTestContract.startAccessAttemptWithInvalidSessionRecovery(
        'revoked-session',
        startAttempt,
        clearSession,
      ),
    ).resolves.toBe(refreshed);

    expect(clearSession).toHaveBeenCalledOnce();
    expect(startAttempt).toHaveBeenNthCalledWith(1, 'revoked-session');
    expect(startAttempt).toHaveBeenNthCalledWith(2);
  });

  it.each([403, 503])('does not clear a session on native status %s', async (status) => {
    const failure = stationAccessError({
      code: 'MOBILE_STATION_TRANSPORT',
      message: `mobile.auth.accessGateStationRejected:${status}`,
    });
    const startAttempt = vi.fn().mockRejectedValue(failure);
    const clearSession = vi.fn();
    await expect(
      accessRuntimeTestContract.startAccessAttemptWithInvalidSessionRecovery(
        'session-a', startAttempt, clearSession,
      ),
    ).rejects.toBe(failure);
    expect(clearSession).not.toHaveBeenCalled();
    expect(startAttempt).toHaveBeenCalledOnce();
  });

  it('does not hide non-session access failures behind a retry', async () => {
    const startAttempt = vi.fn().mockRejectedValue(
      new Error('station unavailable'),
    );
    const clearSession = vi.fn().mockResolvedValue(undefined);

    await expect(
      accessRuntimeTestContract.startAccessAttemptWithInvalidSessionRecovery(
        'session-a',
        startAttempt,
        clearSession,
      ),
    ).rejects.toThrow('station unavailable');
    expect(clearSession).not.toHaveBeenCalled();
  });

  it('retains typed alternative actions in the gate projection', () => {
    expect(accessRuntimeTestContract.sanitizeAccessDecision({
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
      attemptId: 'access-attempt',
      currentGateId: 'auth.login',
      accessGrantId: '',
      message: '',
      gates: [{
        gateId: 'auth.login',
        gateType: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
        state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
        title: '',
        description: '',
        blockingReason: '',
        submitAction: '/actor/access/submit',
        inputSchemaJson: '{}',
        actionId: 'auth.password',
        schemaRevision: 1,
        schemaDigest: 'a'.repeat(64),
        alternativeActions: [{
          actionId: 'auth.oauth',
          actionType: 'ACCESS_GATE_TYPE_AUTH_OAUTH',
          submitAction: 'start_oauth',
          schemaRevision: 1,
          schemaDigest: 'b'.repeat(64),
        }],
      }],
    })).toMatchObject({
      attemptId: 'access-attempt',
      gates: [{
        alternativeActions: [{
          actionId: 'auth.oauth',
          type: 'ACCESS_GATE_TYPE_AUTH_OAUTH',
          submitAction: 'start_oauth',
          schemaRevision: 1,
          schemaDigest: 'b'.repeat(64),
        }],
      }],
    });
  });

  it('activates the native session before completing a granted refresh', async () => {
    const activateSession = vi.fn().mockResolvedValue({
      stationPeerId: 'station-a',
      stationUrl: 'https://station.example',
      sessionId: 'session-a',
      actorPtid: 'ptid:alice',
      deviceId: 'device-a',
      lifecycleGeneration: 1,
      expiresAt: '2030-01-01T00:00:00Z',
      credentialOwner: 'native-oauth',
    });
    const station = {
      stationPeerId: 'station-a',
      url: 'https://station.example',
      label: 'Station A',
      createdAt: 1,
      lastUsedAt: 1,
    };

    await expect(accessRuntimeTestContract.applyRefreshedAccessDecision(
      station,
      decision,
      activateSession,
    )).resolves.toBe(decision);

    expect(useAuthStore.getState().accessDecision).toBe(decision);
    expect(activateSession).toHaveBeenCalledWith(station, decision);
  });

  it('does not activate a native session for a non-granted refresh', async () => {
    const activateSession = vi.fn();
    const station = {
      stationPeerId: 'station-a',
      url: 'https://station.example',
      label: 'Station A',
      createdAt: 1,
      lastUsedAt: 1,
    };
    const pending = {
      ...decision,
      state: 'ACCESS_DECISION_STATE_PENDING',
    };

    await accessRuntimeTestContract.applyRefreshedAccessDecision(
      station,
      pending,
      activateSession,
    );

    expect(activateSession).not.toHaveBeenCalled();
  });

  it('revalidates the persisted active route without rediscovery', async () => {
    const station: MobileStationEntry = {
      stationPeerId: 'station-a',
      url: 'https://station.example',
      label: 'Station A',
      createdAt: 1,
      lastUsedAt: 1,
      pinnedStationRootPublicKey: [1],
      routes: [{
        nodePeerId: 'node-a',
        nodeAuthorizationDigest: new Array(32).fill(2),
        authorizationEpoch: 3,
        routeId: 'direct-route',
        routeType: 'direct',
        transport: 'libp2p_http_v1',
        endpointOrigin: 'https://station.example',
        routeGeneration: 4,
        innerTlsSpkiSha256: new Array(32).fill(5),
        addresses: ['/dns4/station.example/tcp/4001/p2p/node-a'],
        sourceRef: 'a'.repeat(64),
        lastVerifiedAt: 6,
        health: 'available',
      }],
      activeRouteId: 'direct-route',
      routeRevision: 7,
      lifecycleGeneration: 8,
    };
    const verifyRoute = vi.fn().mockResolvedValue({
      stationPeerId: 'station-a',
      routeId: 'direct-route',
    });

    await expect(
      accessRuntimeTestContract.verifyActiveStationRoute(
        station,
        verifyRoute,
      ),
    ).resolves.toMatchObject({
      stationPeerId: 'station-a',
      routeId: 'direct-route',
    });
    expect(verifyRoute).toHaveBeenCalledWith({
      stationPeerId: 'station-a',
      routeId: 'direct-route',
      routeGeneration: 4,
      routeRevision: 7,
      sourceRef: 'a'.repeat(64),
      endpointOrigin: 'https://station.example',
    });
  });

  it('declares the accepted pre-session runtime dependency boundary', () => {
    const descriptor = createAccessRuntimeDescriptor();
    expect(descriptor.id).toBe('access');
    expect(descriptor.dependsOn).toEqual(['station', 'auth']);
  });
});
