// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it, vi } from 'vitest';

import type { AccessDecision } from '../features/auth/authSession';
import {
  createSessionRuntimeController,
  type NativeSessionProjection,
} from './sessionRuntime';

const NOW = Date.parse('2026-09-17T00:00:00.000Z');
const granted: AccessDecision = {
  state: 'ACCESS_DECISION_STATE_GRANTED',
  attemptId: 'access-attempt',
  gates: [],
};
const station = {
  stationPeerId: 'station-a',
  url: 'https://station.example',
  label: 'Station',
  createdAt: 1,
  lastUsedAt: 1,
};

function nativeProjection(
  overrides: Partial<NativeSessionProjection> = {},
): NativeSessionProjection {
  return {
    stationPeerId: 'station-a',
    sessionId: 'session-a',
    actorPtid: 'ptid:alice',
    expiresAt: '2026-09-17T00:10:00.000Z',
    ...overrides,
  };
}

function completePurge() {
  return {
    stationRevocation: 'confirmed',
    secureStorage: {
      activeAttemptIndexAbsent: true,
      attemptSecretRecordAbsent: true,
      currentSessionIndexAbsent: true,
      credentialRecordAbsent: true,
      publicProjectionAbsent: true,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function runtime(options: {
  read?: () => Promise<NativeSessionProjection | null>;
  refresh?: () => Promise<NativeSessionProjection>;
  revoke?: () => Promise<ReturnType<typeof completePurge>>;
  now?: () => number;
} = {}) {
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  const native = {
    read: vi.fn(options.read ?? (async () => nativeProjection())),
    refresh: vi.fn(options.refresh ?? (async () => nativeProjection({
      sessionId: 'session-refreshed',
      expiresAt: '2026-09-17T00:20:00.000Z',
    }))),
    revoke: vi.fn(options.revoke ?? (async () => completePurge())),
  };
  const controller = createSessionRuntimeController({
    native,
    clock: {
      now: options.now ?? (() => NOW),
      setTimeout: (callback: () => void, delayMs: number) => {
        timers.push({ callback, delayMs });
        return timers.length;
      },
      clearTimeout: vi.fn(),
    },
  });
  return { controller, native, timers };
}

describe('sessionRuntime', () => {
  it('activates native OAuth metadata without projecting credential material', async () => {
    const { controller, timers } = runtime();

    await expect(controller.restore(station, granted)).resolves.toMatchObject({
      stationPeerId: 'station-a',
      sessionId: 'session-a',
      actorPtid: 'ptid:alice',
      credentialOwner: 'native-oauth',
    });

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'active',
      writesAllowed: true,
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toMatch(
      /accessToken|refreshToken|access-token|refresh-token/,
    );
    expect(timers.at(-1)?.delayMs).toBe(8 * 60 * 1_000);
  });

  it('re-arms long-lived refresh deadlines without overflowing platform timers', async () => {
    const maxTimerDelay = 2_147_483_647;
    const finalDelay = 10_000;
    let now = NOW;
    const { controller, native, timers } = runtime({
      now: () => now,
      read: async () => nativeProjection({
        expiresAt: new Date(
          NOW
          + (2 * maxTimerDelay)
          + finalDelay
          + (2 * 60 * 1_000),
        ).toISOString(),
      }),
    });

    await controller.restore(station, granted);
    expect(timers[0]?.delayMs).toBe(maxTimerDelay);

    now += maxTimerDelay;
    timers[0]?.callback();
    expect(timers[1]?.delayMs).toBe(maxTimerDelay);
    expect(native.refresh).not.toHaveBeenCalled();

    now += maxTimerDelay;
    timers[1]?.callback();
    expect(timers[2]?.delayMs).toBe(finalDelay);
    expect(native.refresh).not.toHaveBeenCalled();

    now += finalDelay;
    timers[2]?.callback();
    await vi.waitFor(() => expect(native.refresh).toHaveBeenCalledOnce());
  });

  it('activates an OAuth completion only after the Access decision is granted', () => {
    const { controller } = runtime({ read: async () => null });
    const projection = {
      phase: 'active_session',
      stationPeerId: 'station-a',
      session: {
        sessionId: 'session-a',
        actorPtid: 'ptid:alice',
        expiresAt: '2026-09-17T00:10:00.000Z',
      },
    };

    controller.observeOAuthProjection(
      projection,
      station,
      { ...granted, state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED' },
    );
    expect(controller.getSnapshot().session).toBeNull();

    controller.observeOAuthProjection(projection, station, granted);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'active',
      session: {
        stationPeerId: 'station-a',
        actorPtid: 'ptid:alice',
        credentialOwner: 'native-oauth',
      },
    });
  });

  it('coalesces refresh and closes writes until the rotated session is stored', async () => {
    const pending = deferred<NativeSessionProjection>();
    const { controller, native } = runtime({
      refresh: () => pending.promise,
    });
    await controller.restore(station, granted);

    const first = controller.refresh('scheduled');
    const second = controller.refresh('authenticated-401');

    expect(first).toBe(second);
    expect(native.refresh).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'refreshing',
      writesAllowed: false,
      refreshReason: 'scheduled',
    });

    pending.resolve(nativeProjection({
      sessionId: 'session-refreshed',
      expiresAt: '2026-09-17T00:20:00.000Z',
    }));
    await expect(first).resolves.toMatchObject({ sessionId: 'session-refreshed' });
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'active',
      writesAllowed: true,
      session: { sessionId: 'session-refreshed' },
    });
  });

  it('keeps authenticated reads available while refresh closes writes', async () => {
    const pending = deferred<NativeSessionProjection>();
    const { controller } = runtime({
      refresh: () => pending.promise,
    });
    await controller.restore(station, granted);

    const refresh = controller.refresh('scheduled');
    await expect(controller.runAfterAuthenticated401(
      async () => 'read-ok',
      () => false,
      'read',
    )).resolves.toBe('read-ok');
    await expect(controller.runAfterAuthenticated401(
      async () => 'write-not-run',
      () => false,
      'write',
    )).rejects.toThrow('mobile.auth.sessionWritesClosed');

    pending.resolve(nativeProjection({
      sessionId: 'session-refreshed',
      expiresAt: '2026-09-17T00:20:00.000Z',
    }));
    await refresh;
  });

  it('refreshes after one authenticated 401 and retries the request once', async () => {
    const { controller, native } = runtime();
    await controller.restore(station, granted);
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 401'))
      .mockResolvedValueOnce('ok');

    await expect(controller.runAfterAuthenticated401(
      request,
      (error) => error instanceof Error && error.message === 'HTTP 401',
    )).resolves.toBe('ok');

    expect(request).toHaveBeenCalledTimes(2);
    expect(native.refresh).toHaveBeenCalledOnce();
  });

  it('revokes and clears the projection when refresh changes PTID', async () => {
    const { controller, native } = runtime({
      refresh: async () => nativeProjection({ actorPtid: 'ptid:bob' }),
    });
    await controller.restore(station, granted);

    await expect(controller.refresh('scheduled')).rejects.toThrow(
      'mobile.auth.sessionIdentityMismatch',
    );

    expect(native.revoke).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toEqual({
      phase: 'revoked',
      session: null,
      writesAllowed: false,
      refreshReason: null,
      errorKey: null,
    });
  });

  it('coalesces concurrent revocation and clears native credentials once', async () => {
    const pending = deferred<ReturnType<typeof completePurge>>();
    const { controller, native } = runtime({
      revoke: () => pending.promise,
    });
    await controller.restore(station, granted);

    const first = controller.revoke();
    const second = controller.revoke();

    expect(first).toBe(second);
    expect(native.revoke).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'revoking',
      session: null,
      writesAllowed: false,
    });

    pending.resolve(completePurge());
    await expect(first).resolves.toEqual({
      remoteRevocation: 'confirmed',
      nativePurge: completePurge(),
    });
    expect(controller.getSnapshot().phase).toBe('revoked');
  });

  it('releases a completed no-op revocation before a later session', async () => {
    const { controller, native } = runtime();

    await expect(controller.revoke()).resolves.toEqual({
      remoteRevocation: 'not-required',
      nativePurge: null,
    });
    expect(native.revoke).not.toHaveBeenCalled();

    await controller.restore(station, granted);
    await expect(controller.revoke()).resolves.toEqual({
      remoteRevocation: 'confirmed',
      nativePurge: completePurge(),
    });
    expect(native.revoke).toHaveBeenCalledOnce();
  });

  it('keeps the session fenced when native secure purge is incomplete', async () => {
    const { controller } = runtime({
      revoke: async () => ({
        ...completePurge(),
        secureStorage: {
          ...completePurge().secureStorage,
          credentialRecordAbsent: false,
        },
      }),
    });
    await controller.restore(station, granted);

    await expect(controller.revoke()).rejects.toThrow(
      'mobile.auth.sessionSecurePurgeIncomplete',
    );
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'failed',
      session: null,
      writesAllowed: false,
    });
  });
});
