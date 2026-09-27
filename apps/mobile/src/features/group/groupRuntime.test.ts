// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startGroupRuntime } from './groupRuntime';

describe('group runtime generation fencing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drains an in-flight reconcile before releasing its session scope', async () => {
    let finishReconcile: (() => void) | undefined;
    const reconcile = vi.fn(() => new Promise<void>((resolve) => {
      finishReconcile = resolve;
    }));
    const bindSession = vi.fn();
    const session = {
      stationPeerId: 'station-primary',
      stationUrl: 'https://station.example',
      sessionId: 'session-1',
      deviceId: 'device-1',
      lifecycleGeneration: 1,
      actorRef: { ptid: 'ptid:alice' },
      authenticatedAt: 1,
    };
    const state = {
      authSession: session,
      reconcile,
      bindSession,
    };
    vi.stubGlobal('window', {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    });

    const controller = startGroupRuntime(session, () => state);
    controller.teardown();
    const drained = controller.drain();

    expect(bindSession).not.toHaveBeenCalled();
    finishReconcile?.();
    await drained;

    expect(bindSession).toHaveBeenCalledWith(null);
  });

  it('pauses reconciliation without releasing the session projection', async () => {
    const reconcile = vi.fn(async () => undefined);
    const bindSession = vi.fn();
    const session = {
      stationPeerId: 'station-primary',
      stationUrl: 'https://station.example',
      sessionId: 'session-1',
      deviceId: 'device-1',
      lifecycleGeneration: 1,
      actorRef: { ptid: 'ptid:alice' },
      authenticatedAt: 1,
    };
    const state = {
      authSession: session,
      reconcile,
      bindSession,
    };
    const setInterval = vi.fn(() => 1);
    const clearInterval = vi.fn();
    vi.stubGlobal('window', { setInterval, clearInterval });

    const controller = startGroupRuntime(session, () => state);
    await controller.suspend();

    expect(clearInterval).toHaveBeenCalledWith(1);
    expect(bindSession).not.toHaveBeenCalled();

    await controller.resume();

    expect(setInterval).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(2);

    controller.teardown();
    await controller.drain();
    expect(bindSession).toHaveBeenCalledWith(null);
  });

  it('lets the parent Social supervisor own bootstrap and resume reconciliation', async () => {
    const reconcile = vi.fn(async () => undefined);
    const session = {
      stationPeerId: 'station-primary',
      stationUrl: 'https://station.example',
      sessionId: 'session-1',
      deviceId: 'device-1',
      lifecycleGeneration: 1,
      actorRef: { ptid: 'ptid:alice' },
      authenticatedAt: 1,
    };
    const state = {
      authSession: session,
      reconcile,
      bindSession: vi.fn(),
    };
    vi.stubGlobal('window', {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
    });

    const controller = startGroupRuntime(
      session,
      () => state,
      {
        reconcileOnStart: false,
        reconcileOnResume: false,
      },
    );
    expect(reconcile).not.toHaveBeenCalled();

    await controller.suspend();
    await controller.resume();
    expect(reconcile).not.toHaveBeenCalled();

    controller.teardown();
    await controller.drain();
  });
});
