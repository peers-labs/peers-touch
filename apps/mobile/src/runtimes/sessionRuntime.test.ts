// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessDecision } from '../features/auth/authSession';
import { createMobileActorStorageRuntime, createMobileAppStorageRuntime } from '../storage/mobileClientStorage';
import {
  destroyRecoveryProjection,
  getRecoveryProjection,
} from './recoveryProjection';
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
    deviceId: 'device-a',
    lifecycleGeneration: 1,
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

class MemoryStorage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
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
  beforeEach(() => destroyRecoveryProjection());

  it.each(['fence', 'suspend', 'fail'])('discards a native restore completed after %s', async (action) => {
    const read = deferred<NativeSessionProjection | null>();
    const { controller, timers } = runtime({ read: () => read.promise });
    const pending = controller.restore(station, granted);
    if (action === 'fail') controller.fail(new Error('connection failed'));
    else controller[action]();
    read.resolve(nativeProjection());
    expect(await pending).toBeNull();
    expect(controller.getSnapshot().session).toBeNull();
    expect(controller.getSnapshot().writesAllowed).toBe(false);
    expect(timers).toHaveLength(0);
  });

  it('discards a refresh after fencing without restoring writes or timers', async () => {
    const refresh = deferred<NativeSessionProjection>();
    const { controller, timers } = runtime({ refresh: () => refresh.promise });
    await controller.restore(station, granted);
    const timerCount = timers.length;
    const pending = controller.refresh('scheduled');
    controller.fence();
    refresh.resolve(nativeProjection({ sessionId: 'late-refresh' }));
    await expect(pending).rejects.toThrow('sessionTransitionCancelled');
    expect(controller.getSnapshot().session).toBeNull();
    expect(controller.getSnapshot().writesAllowed).toBe(false);
    expect(timers).toHaveLength(timerCount);
  });

  it('keeps a newer restore when an older native read completes last', async () => {
    const read = deferred<NativeSessionProjection | null>();
    let calls = 0;
    const { controller } = runtime({
      read: () => ++calls === 1 ? read.promise : Promise.resolve(nativeProjection({ sessionId: 'new' })),
    });
    const old = controller.restore(station, granted);
    await controller.restore(station, granted);
    read.resolve(nativeProjection({ sessionId: 'old' }));
    expect(await old).toBeNull();
    expect(controller.getSnapshot().session?.sessionId).toBe('new');
  });

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
        deviceId: 'device-a',
        lifecycleGeneration: 1,
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
        deviceId: 'device-a',
        lifecycleGeneration: 1,
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

  it('hard-deletes the revoking actor L2 personalization without touching other actors or L3 state', async () => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage() });
    try {
      const preferenceKey = 'peers-touch.mobile.device-preferences.v1';
      const aliceStorage = createMobileActorStorageRuntime('station-a', 'ptid:alice');
      const bobStorage = createMobileActorStorageRuntime('station-a', 'ptid:bob');
      const appStorage = createMobileAppStorageRuntime();

      await aliceStorage.repositories.chatPreferences.write(preferenceKey, {
        theme: 'dark',
      });
      await bobStorage.repositories.chatPreferences.write(preferenceKey, {
        theme: 'light',
      });
      await appStorage.repositories.stationRegistry.write('active-station', {
        url: 'https://station.example',
      });

      const { controller } = runtime();
      await controller.restore(station, granted);
      await controller.revoke();

      await expect(
        aliceStorage.repositories.chatPreferences.readValue(preferenceKey),
      ).resolves.toBeNull();
      await expect(
        bobStorage.repositories.chatPreferences.readValue(preferenceKey),
      ).resolves.toEqual({ theme: 'light' });
      await expect(
        appStorage.repositories.stationRegistry.readValue('active-station'),
      ).resolves.toEqual({ url: 'https://station.example' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('purges native state before admission and releases revocation for a later session', async () => {
    const { controller, native } = runtime();

    await expect(controller.revoke()).resolves.toEqual({
      remoteRevocation: 'confirmed',
      nativePurge: completePurge(),
    });
    expect(native.revoke).toHaveBeenNthCalledWith(1, null);

    await controller.restore(station, granted);
    await expect(controller.revoke()).resolves.toEqual({
      remoteRevocation: 'confirmed',
      nativePurge: completePurge(),
    });
    expect(native.revoke).toHaveBeenCalledTimes(2);
    expect(native.revoke).toHaveBeenNthCalledWith(2, {
      stationOrigin: station.url,
      stationPeerId: station.stationPeerId,
    });
  });

  it.each([
    ['scheduled', 'mobile.auth.sessionCredentialRejected:401'],
    ['authenticated-401', 'mobile.auth.oauthTransportUnavailable'],
  ])('reports actionable expiry after terminal %s refresh', async (reason, message) => {
    const purge = deferred<ReturnType<typeof completePurge>>();
    const { controller, native } = runtime({
      refresh: async () => { throw new Error(message); },
      revoke: () => purge.promise,
    });
    await controller.restore(station, granted);
    const pending = controller.refresh(reason);
    const rejected = expect(pending).rejects.toThrow(message);
    await vi.waitFor(() => expect(native.revoke).toHaveBeenCalledOnce());
    expect(controller.getSnapshot().writesAllowed).toBe(false);
    expect(getRecoveryProjection().getSnapshot().states).toEqual([]);

    purge.resolve(completePurge());
    await rejected;
    expect(controller.getSnapshot().session).toBeNull();
    expect(getRecoveryProjection().getSnapshot()).toMatchObject({
      isWriteBlocked: true,
      states: [{ kind: 'device-local-flag', reason: 'session-expired' }],
    });
    await controller.restore(station, granted);
    expect(getRecoveryProjection().getSnapshot().states).toEqual([]);
  });

  it('reports expiry when the scheduled session reaches its deadline before refresh', async () => {
    let now = NOW;
    const { controller, native } = runtime({ now: () => now });
    await controller.restore(station, granted);
    now += 10 * 60 * 1_000;
    await expect(controller.refresh('scheduled')).rejects.toThrow('sessionExpired');
    expect(native.refresh).not.toHaveBeenCalled();
    expect(native.revoke).toHaveBeenCalledOnce();
    expect(getRecoveryProjection().getSnapshot()).toMatchObject({
      isWriteBlocked: true,
      states: [{ kind: 'device-local-flag', reason: 'session-expired' }],
    });
  });

  it('retains the admitted session without an expiry flag during a transient scheduled failure', async () => {
    const { controller, native, timers } = runtime({
      refresh: async () => { throw new Error('mobile.auth.oauthTransportUnavailable'); },
    });
    await controller.restore(station, granted);
    await expect(controller.refresh('scheduled')).rejects.toThrow('oauthTransportUnavailable');
    expect(native.revoke).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'active',
      writesAllowed: true,
      session: { sessionId: 'session-a' },
    });
    expect(timers.at(-1)?.delayMs).toBe(5_000);
    expect(getRecoveryProjection().getSnapshot().states).toEqual([]);
  });

  it('does not present an expiry failure after explicit logout', async () => {
    const { controller } = runtime();
    await controller.restore(station, granted);
    await controller.revoke();
    expect(controller.getSnapshot().phase).toBe('revoked');
    expect(getRecoveryProjection().getSnapshot().states).toEqual([]);
  });

  it.each(['fence', 'suspend', 'restore'])('does not publish a late expiry flag after %s', async (action) => {
    const purge = deferred<ReturnType<typeof completePurge>>();
    const { controller, native } = runtime({
      refresh: async () => { throw new Error('mobile.auth.sessionCredentialRejected:401'); },
      revoke: () => purge.promise,
      read: async () => nativeProjection({ sessionId: 'new-session' }),
    });
    await controller.restore(station, granted);
    const pending = controller.refresh('scheduled');
    const rejected = expect(pending).rejects.toThrow('sessionCredentialRejected');
    await vi.waitFor(() => expect(native.revoke).toHaveBeenCalledOnce());
    if (action === 'restore') await controller.restore(station, granted);
    else controller[action]();
    purge.resolve(completePurge());
    await rejected;
    expect(getRecoveryProjection().getSnapshot().states).toEqual([]);
    if (action === 'restore') {
      expect(controller.getSnapshot()).toMatchObject({
        phase: 'active',
        writesAllowed: true,
        session: { sessionId: 'new-session' },
      });
    }
  });

  it('rejects incomplete native purge even when no renderer session was admitted', async () => {
    const { controller, native } = runtime({
      revoke: async () => ({
        ...completePurge(),
        secureStorage: {
          ...completePurge().secureStorage,
          credentialRecordAbsent: false,
        },
      }),
    });
    controller.fail(new Error('station unavailable'));
    await expect(controller.revoke()).rejects.toThrow('sessionSecurePurgeIncomplete');
    expect(native.revoke).toHaveBeenCalledWith(null);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'failed', session: null, writesAllowed: false,
    });
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
