import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRecoveryProjection } from '../../runtimes/recoveryProjection';
import { runRuntimeSessionTransition } from '../../runtimes/runtimeSessionTransition';
import { MobileLifecycleKernel } from './MobileLifecycleKernel';
import type { MobileRuntimeContext, MobileRuntimeDescriptor } from './types';

function fixture(
  onBootstrap?: (id: string, context: MobileRuntimeContext) => void | Promise<void>,
  teardownAllowed: (id: string) => boolean = () => true,
) {
  const kernel = new MobileLifecycleKernel();
  const calls: string[] = [];
  const contexts = new Map<string, MobileRuntimeContext>();
  let generation = 0;
  const descriptor = (id: string, dependsOn: string[]): MobileRuntimeDescriptor => ({
    id,
    title: id,
    responsibility: id,
    dependsOn,
    async bootstrap(context) {
      calls.push(`${id}:bootstrap`);
      contexts.set(id, context);
      await onBootstrap?.(id, context);
    },
    async suspend() { calls.push(`${id}:suspend`); },
    async resume(context) { contexts.set(id, context); },
    async teardown() {
      calls.push(`${id}:teardown`);
      return { runtimeId: id, success: teardownAllowed(id), durationMs: 0 };
    },
  });
  kernel.configureRuntimeGraph({
    createDescriptors: () => [
      descriptor('auth', []),
      descriptor('messaging', ['auth']),
      descriptor('social', ['messaging']),
      descriptor('group', ['social']),
      descriptor('settings', ['auth']),
    ],
    readGeneration: async () => generation,
    advanceGeneration: async () => ++generation,
    fenceProjections: () => undefined,
    resolveLaunchState: async () => 'shell',
  });
  const begin = (id: string) => {
    const context = contexts.get(id);
    if (!context) throw new Error('Context not installed');
    return context.beginReadinessUpdate();
  };
  const status = (id: string) => kernel.getSnapshot().runtimes
    .find((entry) => entry.id === id)?.status;
  return { kernel, calls, contexts, begin, status };
}

describe('generation-bound runtime readiness', () => {
  afterEach(() => vi.useRealTimers());

  it('projects pending and failed dependencies without changing resource ownership', async () => {
    const { kernel, begin, status } = fixture();
    await kernel.startRuntimeGraph();
    const update = begin('messaging');
    expect(status('messaging')).toBe('bootstrapping');
    expect(status('social')).toBe('bootstrapping');
    update.fail(new Error('sensitive transport detail'));
    expect(status('messaging')).toBe('failed');
    expect(status('social')).toBe('failed');
    expect(status('group')).toBe('failed');
    expect(status('settings')).toBe('ready');
    expect(kernel.getState().runtimes.get('messaging')?.status).toBe('ready');
    expect(kernel.getDiagnosticRuntimeErrors()).toEqual([{
      runtimeId: 'messaging',
      error: 'sensitive transport detail',
    }]);
    expect(JSON.stringify(kernel.getSnapshot())).not.toContain('sensitive');
  });

  it('clears private readiness diagnostics after owner recovery', async () => {
    const { kernel, begin } = fixture();
    await kernel.startRuntimeGraph();
    begin('messaging').fail(new Error('private worker failure'));
    expect(kernel.getDiagnosticRuntimeErrors()).toEqual([{
      runtimeId: 'messaging',
      error: 'private worker failure',
    }]);
    begin('messaging').ready();
    expect(kernel.getDiagnosticRuntimeErrors()).toEqual([]);
  });

  it('does not let dependency recovery overwrite another runtime failure', async () => {
    const { kernel, begin, status } = fixture();
    await kernel.startRuntimeGraph();
    begin('social').fail(new Error('social failed'));
    begin('messaging').fail(new Error('messaging failed'));
    begin('messaging').ready();
    expect(status('messaging')).toBe('ready');
    expect(status('social')).toBe('failed');
    begin('social').ready();
    expect(status('social')).toBe('ready');
    expect(status('group')).toBe('ready');
  });

  it('rejects older same-generation completion and repeated settlement', async () => {
    const { kernel, begin, status } = fixture();
    await kernel.startRuntimeGraph();
    const old = begin('messaging');
    const current = begin('messaging');
    expect(old.isCurrent()).toBe(false);
    old.ready();
    expect(status('messaging')).toBe('bootstrapping');
    current.fail(new Error('failed'));
    current.ready();
    expect(status('messaging')).toBe('failed');
  });

  it('still suspends and tears down live unavailable resources', async () => {
    const { kernel, begin, calls } = fixture();
    await kernel.startRuntimeGraph();
    begin('messaging').fail(new Error('failed'));
    await kernel.suspend();
    expect(calls).toContain('messaging:suspend');
    expect(calls).toContain('social:suspend');
    await kernel.stopRuntimeGraph();
    expect(calls).toContain('messaging:teardown');
    expect(calls).toContain('social:teardown');
  });

  it('rejects pending completion after suspension and generation replacement', async () => {
    const { kernel, begin, status } = fixture();
    await kernel.startRuntimeGraph();
    const old = begin('messaging');
    await kernel.suspend();
    expect(old.isCurrent()).toBe(false);
    old.ready();
    expect(status('messaging')).toBe('suspended');
    await kernel.resume();
    old.fail(new Error('old scope'));
    expect(status('messaging')).toBe('ready');
  });

  it('rejects old contexts after graph replacement even at the same generation', async () => {
    const { kernel, contexts, status } = fixture();
    await kernel.startRuntimeGraph();
    const oldContext = contexts.get('messaging')!;
    await kernel.stopRuntimeGraph();
    await kernel.startRuntimeGraph();
    const old = oldContext.beginReadinessUpdate();
    expect(old.isCurrent()).toBe(false);
    old.fail(new Error('retired descriptor'));
    expect(status('messaging')).toBe('ready');
  });

  it('fences a retired graph even when a factory reuses the same descriptor', async () => {
    const kernel = new MobileLifecycleKernel();
    let context!: MobileRuntimeContext;
    const runtime: MobileRuntimeDescriptor = {
      id: 'auth', title: 'auth', responsibility: 'auth', dependsOn: [],
      async bootstrap(value) { context = value; },
      async suspend() {},
      async resume(value) { context = value; },
      async teardown() { return { runtimeId: 'auth', success: true, durationMs: 0 }; },
    };
    kernel.configureRuntimeGraph({
      createDescriptors: () => [runtime],
      readGeneration: async () => 0,
      advanceGeneration: async () => 1,
      fenceProjections: () => undefined,
      resolveLaunchState: async () => 'shell',
    });
    await kernel.startRuntimeGraph();
    const old = context;
    await kernel.stopRuntimeGraph();
    await kernel.startRuntimeGraph();
    const update = old.beginReadinessUpdate();
    expect(update.isCurrent()).toBe(false);
    update.fail(new Error('old graph'));
    expect(kernel.getSnapshot().runtimes[0].status).toBe('ready');
    await kernel.stopRuntimeGraph();
  });

  it('keeps failed async readiness recoverable after suspend and resume', async () => {
    const { kernel, begin, status, calls } = fixture();
    await kernel.startRuntimeGraph();
    begin('messaging').fail(new Error('failed'));
    await kernel.suspend();
    await kernel.resume();
    expect(calls).toContain('messaging:teardown');
    expect(status('messaging')).toBe('ready');
    expect(status('social')).toBe('ready');
  });

  it('does not overwrite async failure when resource bootstrap finishes', async () => {
    const { kernel, status } = fixture((id, context) => {
      if (id === 'messaging') {
        context.beginReadinessUpdate().fail(new Error('activation failed'));
      }
    });
    await kernel.startRuntimeGraph();
    expect(kernel.getState().runtimes.get('messaging')?.status).toBe('ready');
    expect(status('messaging')).toBe('failed');
    expect(status('social')).toBe('failed');
  });

  it('times out readiness and releases its deadline on lifecycle teardown', async () => {
    vi.useFakeTimers();
    const { kernel, begin, status } = fixture();
    await kernel.startRuntimeGraph();
    const update = begin('messaging');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(status('messaging')).toBe('failed');
    expect(update.isCurrent()).toBe(false);
    update.ready();
    expect(status('messaging')).toBe('failed');
    begin('messaging');
    await kernel.stopRuntimeGraph();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for existing hard dependencies before admitting session work', async () => {
    const { kernel, begin } = fixture();
    await kernel.startRuntimeGraph();
    const messaging = begin('messaging');
    const social = begin('social');
    let admitted = false;
    const waiting = social.waitForDependencies().then((ready) => { admitted = ready; });
    await Promise.resolve();
    expect(admitted).toBe(false);
    messaging.ready();
    await waiting;
    expect(admitted).toBe(true);
    social.ready();
    await kernel.stopRuntimeGraph();
  });

  it('rejects a failed hard dependency and releases a cancelled waiter', async () => {
    const { kernel, begin } = fixture();
    await kernel.startRuntimeGraph();
    const messaging = begin('messaging');
    const social = begin('social');
    const waiting = expect(social.waitForDependencies())
      .rejects.toThrow('mobile.lifecycle.dependencyFailed:messaging');
    messaging.fail(new Error('transport'));
    await waiting;
    const retry = begin('messaging');
    const pending = begin('social').waitForDependencies();
    await kernel.suspend();
    expect(await pending).toBe(false);
    expect(retry.isCurrent()).toBe(false);
    await kernel.stopRuntimeGraph();
  });
});

describe('session readiness and recovery projection integration', () => {
  afterEach(() => vi.useRealTimers());

  for (const transition of ['restart', 'resume'] as const) {
    it(`clears async failure only after the ${transition} owner rebuilds`, async () => {
      const { kernel, contexts, status, calls } = fixture();
      const recovery = createRecoveryProjection();
      const unsubscribe = kernel.subscribe(() => {
        recovery.reportDeferredCapabilities(kernel.getState());
      });
      try {
        await kernel.startRuntimeGraph();
        const bootOrder = [...kernel.getSnapshot().bootOrder];
        const context = contexts.get('messaging')!;
        let rejectActivation!: (error: Error) => void;
        const activation = new Promise<void>((_, reject) => {
          rejectActivation = reject;
        });
        const onError = vi.fn();
        const task = runRuntimeSessionTransition({
          previous: Promise.resolve(),
          context,
          isScopeCurrent: () => true,
          run: () => activation,
          onError,
        });
        expect(recovery.getSnapshot().states).toMatchObject([{
          kind: 'deferred-capability',
          unavailableRuntimes: [
            { runtimeId: 'messaging', status: 'bootstrapping' },
            { runtimeId: 'social', status: 'bootstrapping' },
            { runtimeId: 'group', status: 'bootstrapping' },
          ],
        }]);
        const failed = expect(task).rejects.toThrow('private transport detail');
        rejectActivation(new Error('private transport detail'));
        await failed;
        expect(onError).toHaveBeenCalledTimes(1);
        expect(status('auth')).toBe('ready');
        expect(status('settings')).toBe('ready');
        expect(recovery.getSnapshot().states).toMatchObject([{
          kind: 'deferred-capability',
          unavailableRuntimes: [
            { runtimeId: 'messaging', status: 'failed' },
            { runtimeId: 'social', status: 'failed' },
            { runtimeId: 'group', status: 'failed' },
          ],
        }]);
        expect(JSON.stringify(recovery.getSnapshot())).not.toContain('private');

        calls.length = 0;
        if (transition === 'resume') {
          await kernel.suspend();
          await kernel.resume();
        } else {
          await kernel.restartRuntimeGraph();
        }
        expect(kernel.getSnapshot()).toMatchObject({
          phase: 'ACTIVE',
          launchState: 'shell',
          generation: 1,
          bootOrder,
        });
        expect(calls.filter((call) => call.endsWith(':teardown')))
          .toEqual([...bootOrder].reverse().map((id) => `${id}:teardown`));
        expect(calls.filter((call) => call.endsWith(':bootstrap')))
          .toEqual(bootOrder.map((id) => `${id}:bootstrap`));
        expect(recovery.getSnapshot().states).toEqual([]);

        const recovered = kernel.getSnapshot();
        context.beginReadinessUpdate().fail(new Error('retired activation'));
        expect(kernel.getSnapshot()).toEqual(recovered);
        expect(recovery.getSnapshot().states).toEqual([]);
      } finally {
        await kernel.stopRuntimeGraph();
        unsubscribe();
        recovery.teardown();
      }
    });

    it(`keeps persistent activation failure unavailable after ${transition}`, async () => {
      let activationFailed = false;
      const { kernel, contexts, status } = fixture(async (id, context) => {
        if (id === 'messaging' && activationFailed) {
          await runRuntimeSessionTransition({
            previous: Promise.resolve(),
            context,
            isScopeCurrent: () => true,
            run: async () => { throw new Error('transport remains unavailable'); },
            onError: () => undefined,
          });
        }
      });
      const recovery = createRecoveryProjection();
      const unsubscribe = kernel.subscribe(() => {
        recovery.reportDeferredCapabilities(kernel.getState());
      });
      try {
        await kernel.startRuntimeGraph();
        activationFailed = true;
        await expect(runRuntimeSessionTransition({
          previous: Promise.resolve(),
          context: contexts.get('messaging')!,
          isScopeCurrent: () => true,
          run: async () => { throw new Error('initial activation failed'); },
          onError: () => undefined,
        })).rejects.toThrow('initial activation failed');
        if (transition === 'resume') {
          await kernel.suspend();
          await kernel.resume();
        } else {
          await kernel.restartRuntimeGraph();
        }
        expect(kernel.getSnapshot().generation).toBe(1);
        expect(status('auth')).toBe('ready');
        expect(status('settings')).toBe('ready');
        expect(recovery.getSnapshot().states).toMatchObject([{
          kind: 'deferred-capability',
          unavailableRuntimes: [
            { runtimeId: 'messaging', status: 'failed' },
            { runtimeId: 'social', status: 'failed' },
            { runtimeId: 'group', status: 'failed' },
          ],
        }]);
      } finally {
        await kernel.stopRuntimeGraph();
        unsubscribe();
        recovery.teardown();
      }
    });

    it(`prevents ${transition} rebootstrap when unavailable resources cannot tear down`, async () => {
      let allowTeardown = false;
      const { kernel, contexts, calls } = fixture(
        undefined,
        (id) => id !== 'messaging' || allowTeardown,
      );
      const recovery = createRecoveryProjection();
      const unsubscribe = kernel.subscribe(() => {
        recovery.reportDeferredCapabilities(kernel.getState());
      });
      try {
        await kernel.startRuntimeGraph();
        await expect(runRuntimeSessionTransition({
          previous: Promise.resolve(),
          context: contexts.get('messaging')!,
          isScopeCurrent: () => true,
          run: async () => { throw new Error('activation failed'); },
          onError: () => undefined,
        })).rejects.toThrow('activation failed');
        calls.length = 0;
        if (transition === 'resume') await kernel.suspend();
        await expect(transition === 'resume'
          ? kernel.resume()
          : kernel.restartRuntimeGraph())
          .rejects.toThrow('mobile.lifecycle.teardownIncomplete');
        expect(kernel.getSnapshot()).toMatchObject({
          phase: 'TEARDOWN_FAILED',
          generation: 1,
          errorKey: 'mobile.lifecycle.teardownIncomplete',
        });
        expect(calls.filter((call) => call.endsWith(':bootstrap'))).toEqual([]);
        expect(recovery.getSnapshot().states).toMatchObject([{
          kind: 'deferred-capability',
          unavailableRuntimes: [{ runtimeId: 'messaging', status: 'failed' }],
        }]);
      } finally {
        allowTeardown = true;
        await kernel.stopRuntimeGraph();
        unsubscribe();
        recovery.teardown();
      }
    });
  }
});
