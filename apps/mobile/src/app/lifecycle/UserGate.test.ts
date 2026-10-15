import { describe, expect, it, vi } from 'vitest';
import { MobileLifecycleKernel } from './MobileLifecycleKernel';
import type { MobileRuntimeDescriptor } from './types';

function setup() {
  let release = () => {};
  let cancel = () => {};
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    cancel = () => reject(new Error('user cancelled'));
  });
  const bootstrap = vi.fn(async () => {});
  const security: MobileRuntimeDescriptor = {
    id: 'security', title: 'security', responsibility: 'security', dependsOn: [],
    bootstrap: async () => {}, suspend: async () => {}, resume: async () => {},
    teardown: async () => ({ runtimeId: 'security', success: true, durationMs: 0 }),
    userGate: { wait: () => gate, cancel },
  };
  const auth: MobileRuntimeDescriptor = {
    id: 'auth', title: 'auth', responsibility: 'auth', dependsOn: ['security'],
    bootstrap, suspend: async () => {}, resume: async () => {},
    teardown: async () => ({ runtimeId: 'auth', success: true, durationMs: 0 }),
  };
  const kernel = new MobileLifecycleKernel();
  kernel.configureRuntimeGraph({
    createDescriptors: () => [security, auth], readGeneration: async () => 1,
    advanceGeneration: async () => 2, resolveLaunchState: async () => 'app-boot',
    fenceProjections: () => {},
  });
  return { kernel, bootstrap, release };
}

describe('interactive lifecycle gates', () => {
  it('does not admit dependent credentials or time out while waiting for the person', async () => {
    vi.useFakeTimers();
    try {
      const { kernel, bootstrap, release } = setup();
      const start = kernel.startRuntimeGraph();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(bootstrap).not.toHaveBeenCalled();
      expect(kernel.getState().runtimes.get('security')?.status).toBe('bootstrapping');
      release();
      await start;
      expect(bootstrap).toHaveBeenCalledOnce();
      await kernel.stopRuntimeGraph();
    } finally { vi.useRealTimers(); }
  });

  it('cancels the user wait before joining the close queue', async () => {
    const { kernel, bootstrap } = setup();
    const start = kernel.startRuntimeGraph();
    await vi.waitFor(() => expect(kernel.getState().runtimes.get('security')?.status).toBe('bootstrapping'));
    const close = kernel.stopRuntimeGraph();
    await start;
    await close;
    expect(bootstrap).not.toHaveBeenCalled();
    expect(kernel.getState().phase).toBe('COLD');
  });

  it('can enter background while a person has not unlocked the app', async () => {
    const { kernel, bootstrap } = setup();
    const start = kernel.startRuntimeGraph();
    await vi.waitFor(() => expect(kernel.getState().runtimes.get('security')?.status).toBe('bootstrapping'));
    const background = kernel.suspend();
    await start;
    await background;
    expect(bootstrap).not.toHaveBeenCalled();
    expect(kernel.getState().phase).toBe('SUSPENDED');
    await kernel.stopRuntimeGraph();
  });
});
