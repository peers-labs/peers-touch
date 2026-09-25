import { describe, expect, it } from 'vitest';

import { MobileLifecycleKernel } from '../app/lifecycle/MobileLifecycleKernel';
import type { MobileRuntimeContext } from '../app/lifecycle/types';
import { runRuntimeSessionTransition } from './runtimeSessionTransition';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function fixture() {
  const kernel = new MobileLifecycleKernel();
  let context!: MobileRuntimeContext;
  kernel.configureRuntimeGraph({
    createDescriptors: () => [{
      id: 'session', title: 'session', responsibility: 'session', dependsOn: [],
      async bootstrap(value) { context = value; },
      async suspend() {},
      async resume(value) { context = value; },
      async teardown() { return { runtimeId: 'session', success: true, durationMs: 0 }; },
    }],
    readGeneration: async () => 0,
    advanceGeneration: async () => 1,
    fenceProjections: () => undefined,
    resolveLaunchState: async () => 'shell',
  });
  await kernel.startRuntimeGraph();
  let currentSession = 'first';
  let queue = Promise.resolve();
  const errors: unknown[] = [];
  const enqueue = (
    session: string,
    run: (isCurrent: () => boolean) => Promise<void>,
  ) => {
    currentSession = session;
    const task = runRuntimeSessionTransition({
      previous: queue,
      context,
      isScopeCurrent: () => currentSession === session,
      run,
      onError: (error) => errors.push(error),
    });
    queue = task.catch(() => undefined);
    return task;
  };
  return {
    kernel, enqueue, errors,
    changeScope: (session: string) => { currentSession = session; },
    status: () => kernel.getSnapshot().runtimes[0].status,
  };
}

describe('runtime session task publication', () => {
  it('publishes pending at scheduling and serializes replacement work', async () => {
    const { enqueue, status, kernel } = await fixture();
    const first = deferred();
    const second = deferred();
    const firstStarted = deferred();
    const secondStarted = deferred();
    const calls: string[] = [];
    const old = enqueue('first', async () => {
      calls.push('first');
      firstStarted.resolve();
      await first.promise;
    });
    await firstStarted.promise;
    const next = enqueue('second', async () => {
      calls.push('second');
      secondStarted.resolve();
      await second.promise;
    });
    expect(status()).toBe('bootstrapping');
    expect(calls).toEqual(['first']);
    first.resolve();
    await old;
    await secondStarted.promise;
    expect(calls).toEqual(['first', 'second']);
    expect(status()).toBe('bootstrapping');
    second.resolve();
    await next;
    expect(status()).toBe('ready');
    await kernel.stopRuntimeGraph();
  });

  it('drops superseded queued tasks even when the same scope is selected again', async () => {
    const { enqueue, kernel } = await fixture();
    const calls: string[] = [];
    const first = enqueue('first', async () => { calls.push('first-old'); });
    const second = enqueue('second', async () => { calls.push('second'); });
    const third = enqueue('first', async () => { calls.push('first-new'); });
    await Promise.all([first, second, third]);
    expect(calls).toEqual(['first-new']);
    await kernel.stopRuntimeGraph();
  });

  it('does not publish an obsolete failure into the next session', async () => {
    const { enqueue, errors, status, kernel } = await fixture();
    const pending = deferred();
    const started = deferred();
    const first = enqueue('first', async () => {
      started.resolve();
      await pending.promise;
    });
    await started.promise;
    const second = enqueue('second', async () => undefined);
    pending.reject(new Error('obsolete'));
    await Promise.all([first, second]);
    expect(errors).toEqual([]);
    expect(status()).toBe('ready');
    await kernel.stopRuntimeGraph();
  });

  it('reports and rejects a current activation failure', async () => {
    const { enqueue, errors, status, kernel } = await fixture();
    const error = new Error('activation failed');
    await expect(enqueue('first', async () => { throw error; })).rejects.toBe(error);
    expect(errors).toEqual([error]);
    expect(status()).toBe('failed');
    await kernel.stopRuntimeGraph();
  });

  it('fences projection publication after scope replacement or teardown', async () => {
    const { enqueue, changeScope, kernel, status } = await fixture();
    const pending = deferred();
    const started = deferred();
    const writes: string[] = [];
    const first = enqueue('first', async (isCurrent) => {
      started.resolve();
      await pending.promise;
      if (isCurrent()) writes.push('old');
    });
    await started.promise;
    changeScope('second');
    await kernel.stopRuntimeGraph();
    pending.resolve();
    await first;
    expect(writes).toEqual([]);
    expect(status()).toBe('torn-down');
  });
});
