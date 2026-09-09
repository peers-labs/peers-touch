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
      accessToken: 'test-token',
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
});
