// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listenMock = vi.hoisted(() => vi.fn());
const lockForIdleMock = vi.hoisted(() => vi.fn());
const wakeAckMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('./identityRuntime', () => ({
  identityRuntime: {
    lockForIdle: lockForIdleMock,
  },
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    desktopWakeAck: wakeAckMock,
  },
}));

vi.mock('../utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { installWakeRecovery, shellIsPainted, wakeRecoveryDeps } from './wakeRecovery';

type TauriHandler = (event: { payload?: unknown }) => void;

function handlerFor(eventName: string): TauriHandler {
  const match = listenMock.mock.calls.find(([name]) => name === eventName);
  if (!match) throw new Error(`no listener registered for ${eventName}`);
  return match[1] as TauriHandler;
}

describe('wake recovery', () => {
  const reloadMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    listenMock.mockReset();
    listenMock.mockResolvedValue(() => undefined);
    lockForIdleMock.mockReset();
    lockForIdleMock.mockResolvedValue(undefined);
    wakeAckMock.mockReset();
    wakeAckMock.mockResolvedValue({ acknowledged: true });
    reloadMock.mockReset();
    wakeRecoveryDeps.reload = reloadMock;
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats an empty root and a present boot fallback as unpainted', () => {
    expect(shellIsPainted()).toBe(false);
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    const fallback = document.createElement('div');
    fallback.id = 'pt-boot-fallback';
    document.body.appendChild(fallback);
    expect(shellIsPainted()).toBe(false);

    fallback.remove();
    const app = document.createElement('div');
    root.appendChild(app);
    expect(shellIsPainted()).toBe(true);
  });

  it('routes the native locked event into the identity runtime', async () => {
    const dispose = installWakeRecovery();
    handlerFor('desktop:locked')({
      payload: { accountId: 'password:abc', pinRequired: true, reason: 'screen-lock' },
    });
    await vi.runAllTimersAsync();

    expect(lockForIdleMock).toHaveBeenCalledWith({
      accountId: 'password:abc',
      pinRequired: true,
      reason: 'screen-lock',
    });
    dispose();
  });

  it('acks the native watchdog and does not reload when the shell is painted', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    root.appendChild(document.createElement('div'));
    document.body.appendChild(root);

    const dispose = installWakeRecovery();
    handlerFor('desktop:resume')({ payload: { kind: 'resume' } });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(wakeAckMock).toHaveBeenCalledWith({ reason: 'desktop-resume' });
    expect(reloadMock).not.toHaveBeenCalled();
    dispose();
  });

  it('self-heals with one guarded reload when paint never lands', async () => {
    // Root stays empty and boot fallback stays mounted.
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    const fallback = document.createElement('div');
    fallback.id = 'pt-boot-fallback';
    document.body.appendChild(fallback);

    const dispose = installWakeRecovery();
    handlerFor('desktop:resume')({ payload: { kind: 'resume' } });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('pt.wake.selfReloaded')).toBe('1');

    // A second resume must not reload again within this renderer generation.
    handlerFor('desktop:resume')({ payload: { kind: 'resume' } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reloadMock).toHaveBeenCalledTimes(1);
    dispose();
  });
});
