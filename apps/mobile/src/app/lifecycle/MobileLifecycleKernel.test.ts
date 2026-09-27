// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MobileLifecycleKernel } from './MobileLifecycleKernel';
import type {
  LifecycleRuntimeGraphDependencies,
  MobileRuntimeDescriptor,
} from './types';

describe('MobileLifecycleKernel runtime ownership', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('owns ordered start, suspend, resume, and teardown', async () => {
    const calls: string[] = [];
    const kernel = configuredKernel(
      () => [
        descriptor('auth', [], calls),
        descriptor('social', ['auth'], calls),
      ],
      { current: 4 },
      calls,
    );

    await kernel.startRuntimeGraph();
    await kernel.suspend();
    await kernel.resume();
    await kernel.stopRuntimeGraph();

    expect(calls).toEqual([
      'generation:read',
      'auth:bootstrap',
      'social:bootstrap',
      'social:suspend',
      'auth:suspend',
      'generation:read',
      'generation:advance',
      'projections:fence:5:app-resume',
      'auth:resume',
      'social:resume',
      'social:teardown',
      'auth:teardown',
    ]);
    expect(kernel.getSnapshot()).toMatchObject({
      phase: 'COLD',
      generation: 5,
      bootOrder: ['auth', 'social'],
    });
  });

  it('owns and validates top-level launch-state transitions', () => {
    const kernel = new MobileLifecycleKernel();
    const launchEvents: string[] = [];
    kernel.onEvent((event) => {
      if (event.kind === 'launch-state-changed') {
        launchEvents.push(
          `${event.previousLaunchState}->${event.launchState}`,
        );
      }
    });

    kernel.transitionLaunchState('station-selection');
    kernel.transitionLaunchState('station-handshake');
    kernel.transitionLaunchState('access-gate-chain');
    kernel.transitionLaunchState('runtime-critical');
    kernel.transitionLaunchState('shell');

    expect(kernel.getState().launchState).toBe('shell');
    expect(launchEvents).toEqual([
      'app-boot->station-selection',
      'station-selection->station-handshake',
      'station-handshake->access-gate-chain',
      'access-gate-chain->runtime-critical',
      'runtime-critical->shell',
    ]);
  });

  it('rejects invalid top-level launch-state transitions', () => {
    const kernel = new MobileLifecycleKernel();

    expect(() => kernel.transitionLaunchState('shell'))
      .toThrow('mobile.lifecycle.invalidLaunchTransition:app-boot->shell');
    expect(kernel.getState().launchState).toBe('app-boot');
  });

  it.each([
    ['station-selection', ['station-selection']],
    ['access-gate-chain', ['station-selection', 'station-handshake', 'access-gate-chain']],
    ['shell', ['station-selection', 'runtime-critical', 'shell']],
  ])('resolves cold-start %s through the kernel after auth bootstrap', async (target, expected) => {
    const calls: string[] = [];
    const kernel = configuredKernel(
      () => [descriptor('auth', [], calls)],
      { current: 1 },
      calls,
      async () => {
        expect(calls).toContain('auth:bootstrap');
        return target;
      },
    );
    const transitions: string[] = [];
    kernel.onEvent((event) => {
      if (event.kind === 'launch-state-changed') transitions.push(event.launchState);
    });

    await kernel.startRuntimeGraph();

    expect(kernel.getSnapshot()).toMatchObject({ phase: 'ACTIVE', launchState: target });
    expect(transitions).toEqual(expected);
  });

  it('adopts an already-advanced native generation without incrementing twice', async () => {
    const calls: string[] = [];
    const generation = { current: 4 };
    const kernel = configuredKernel(
      () => [descriptor('auth', [], calls)],
      generation,
      calls,
    );

    await kernel.startRuntimeGraph();
    await kernel.suspend();
    generation.current = 5;
    calls.length = 0;

    const snapshot = await kernel.resume('native-resume');

    expect(calls).toEqual([
      'generation:read',
      'projections:fence:5:native-resume',
      'auth:resume',
    ]);
    expect(snapshot).toMatchObject({
      phase: 'ACTIVE',
      generation: 5,
    });
  });

  it('rebuilds failed bootstrap dependencies after fencing on resume', async () => {
    const calls: string[] = [];
    let attempts = 0;
    const kernel = configuredKernel(
      () => [
        descriptor('auth', [], calls),
        {
          ...descriptor('messaging', ['auth'], calls),
          bootstrap: async () => {
            calls.push('messaging:bootstrap');
            if (++attempts === 1) throw new Error('station-unavailable');
          },
        },
        descriptor('social', ['messaging'], calls),
      ],
      { current: 3 },
      calls,
    );
    await kernel.startRuntimeGraph();
    expect(kernel.getSnapshot().runtimes.map(({ status }) => status))
      .toEqual(['ready', 'failed', 'failed']);
    await kernel.suspend();
    calls.length = 0;

    const result = await kernel.resume();

    expect(calls).toEqual([
      'generation:read',
      'generation:advance',
      'projections:fence:4:app-resume',
      'social:teardown',
      'messaging:teardown',
      'auth:teardown',
      'auth:bootstrap',
      'messaging:bootstrap',
      'social:bootstrap',
    ]);
    expect(result.runtimes.every(({ status }) => status === 'ready')).toBe(true);
    expect(result.generation).toBe(4);
  });

  it('keeps persistent bootstrap failures and dependents unavailable after resume', async () => {
    const calls: string[] = [];
    const kernel = configuredKernel(
      () => [
        {
          ...descriptor('messaging', [], calls),
          bootstrap: async () => {
            calls.push('messaging:bootstrap');
            throw new Error('station-unavailable');
          },
        },
        descriptor('social', ['messaging'], calls),
      ],
      { current: 1 },
      calls,
    );
    await kernel.startRuntimeGraph();
    await kernel.suspend();
    const result = await kernel.resume();

    expect(calls.filter((call) => call === 'messaging:bootstrap')).toHaveLength(2);
    expect(calls).not.toContain('social:bootstrap');
    expect(result.runtimes.map(({ status }) => status)).toEqual(['failed', 'failed']);
  });

  it('blocks resume rebootstrap when failed runtime cleanup is incomplete', async () => {
    const calls: string[] = [];
    const kernel = configuredKernel(
      () => [{
        ...descriptor('messaging', [], calls),
        bootstrap: async () => {
          calls.push('messaging:bootstrap');
          throw new Error('station-unavailable');
        },
        teardown: async () => ({
          runtimeId: 'messaging',
          success: false,
          errorMessage: 'cleanup-incomplete',
          durationMs: 0,
        }),
      }],
      { current: 1 },
      calls,
    );
    await kernel.startRuntimeGraph();
    await kernel.suspend();

    await expect(kernel.resume()).rejects.toThrow('mobile.lifecycle.teardownIncomplete');
    expect(calls.filter((call) => call === 'messaging:bootstrap')).toHaveLength(1);
    expect(kernel.getSnapshot().phase).toBe('TEARDOWN_FAILED');
  });

  it('advances the generation and hides projections before restart teardown', async () => {
    const calls: string[] = [];
    const generation = { current: 8 };
    const kernel = configuredKernel(
      () => [
        descriptor('auth', [], calls),
        descriptor('social', ['auth'], calls),
      ],
      generation,
      calls,
    );

    await kernel.startRuntimeGraph();
    calls.length = 0;
    const snapshot = await kernel.restartRuntimeGraph('station-replace');

    expect(calls).toEqual([
      'generation:advance',
      'projections:fence:9:station-replace',
      'social:teardown',
      'auth:teardown',
      'auth:bootstrap',
      'social:bootstrap',
    ]);
    expect(snapshot.generation).toBe(9);
    expect(snapshot.phase).toBe('ACTIVE');
  });

  it('fences and tears down before a Station or logout mutation', async () => {
    const calls: string[] = [];
    const generation = { current: 2 };
    const kernel = configuredKernel(
      () => [descriptor('auth', [], calls)],
      generation,
      calls,
    );

    await kernel.startRuntimeGraph();
    calls.length = 0;
    await kernel.transitionScope('logout', async () => {
      calls.push('credentials:clear');
    });

    expect(calls).toEqual([
      'generation:advance',
      'projections:fence:3:logout',
      'auth:teardown',
      'credentials:clear',
      'auth:bootstrap',
    ]);
  });

  it('passes the immutable draft disposition through scope teardown', async () => {
    const calls: string[] = [];
    const kernel = configuredKernel(
      () => [{
        ...descriptor('reliability', [], calls),
        teardown: async (context) => {
          calls.push(
            `reliability:teardown:${context.reason}:${context.draftDisposition}`,
          );
          return {
            runtimeId: 'reliability',
            success: true,
            durationMs: 0,
          };
        },
      }],
      { current: 2 },
      calls,
    );

    await kernel.startRuntimeGraph();
    calls.length = 0;
    await kernel.transitionScope(
      'logout',
      async () => {
        calls.push('credentials:clear');
      },
      { draftDisposition: 'retain' },
    );

    expect(calls).toEqual([
      'generation:advance',
      'projections:fence:3:logout',
      'reliability:teardown:logout:retain',
      'credentials:clear',
      'reliability:bootstrap',
    ]);
  });

  it('does not mutate the Station or credentials when teardown fails', async () => {
    const calls: string[] = [];
    let teardownAttempts = 0;
    const kernel = configuredKernel(
      () => [{
        ...descriptor('reliability', [], calls),
        teardown: async () => {
          calls.push('reliability:teardown');
          teardownAttempts += 1;
          return {
            runtimeId: 'reliability',
            success: teardownAttempts > 1,
            errorMessage: teardownAttempts > 1
              ? undefined
              : 'mobile.reliability.scopeCloseFailed',
            durationMs: 0,
          };
        },
      }],
      { current: 2 },
      calls,
    );

    await kernel.startRuntimeGraph();
    calls.length = 0;

    await expect(kernel.transitionScope('logout', async () => {
      calls.push('credentials:clear');
    })).rejects.toThrow('mobile.lifecycle.teardownIncomplete');

    expect(calls).toEqual([
      'generation:advance',
      'projections:fence:3:logout',
      'reliability:teardown',
    ]);
    expect(kernel.getSnapshot()).toMatchObject({
      phase: 'TEARDOWN_FAILED',
      generation: 3,
    });

    await kernel.transitionScope('logout', async () => {
      calls.push('credentials:clear');
    });

    expect(calls).toEqual([
      'generation:advance',
      'projections:fence:3:logout',
      'reliability:teardown',
      'generation:advance',
      'projections:fence:4:logout',
      'reliability:teardown',
      'credentials:clear',
      'reliability:bootstrap',
    ]);
    expect(kernel.getSnapshot()).toMatchObject({
      phase: 'ACTIVE',
      generation: 4,
    });
  });

  it('keeps a failed scope mutation cold and permits the same transition to retry', async () => {
    const calls: string[] = [];
    let mutationAttempts = 0;
    const kernel = configuredKernel(
      () => [descriptor('auth', [], calls)],
      { current: 4 },
      calls,
    );
    await kernel.startRuntimeGraph();
    calls.length = 0;

    const mutate = async () => {
      mutationAttempts += 1;
      calls.push(`credentials:clear:${mutationAttempts}`);
      if (mutationAttempts === 1) {
        throw new Error('secure-storage-unavailable');
      }
    };
    await expect(
      kernel.transitionScope(
        'logout',
        mutate,
        { draftDisposition: 'retain' },
      ),
    ).rejects.toThrow('secure-storage-unavailable');

    expect(kernel.getSnapshot()).toMatchObject({
      phase: 'COLD',
      generation: 5,
    });

    await kernel.transitionScope(
      'logout',
      mutate,
      { draftDisposition: 'retain' },
    );
    expect(kernel.getSnapshot()).toMatchObject({
      phase: 'ACTIVE',
      generation: 6,
    });
    expect(calls).toEqual([
      'generation:advance',
      'projections:fence:5:logout',
      'auth:teardown',
      'credentials:clear:1',
      'generation:advance',
      'projections:fence:6:logout',
      'credentials:clear:2',
      'auth:bootstrap',
    ]);
  });

  it('moves a revoked resumed session out of shell after fencing projections', async () => {
    const calls: string[] = [];
    const generation = { current: 10 };
    let resolvedLaunchState: 'shell' | 'access-gate-chain' = 'shell';
    const kernel = configuredKernel(
      () => [descriptor('auth', [], calls)],
      generation,
      calls,
      async () => resolvedLaunchState,
    );

    kernel.transitionLaunchState('station-selection');
    kernel.transitionLaunchState('runtime-critical');
    kernel.transitionLaunchState('shell');
    await kernel.startRuntimeGraph();
    await kernel.suspend();
    resolvedLaunchState = 'access-gate-chain';
    calls.length = 0;

    const snapshot = await kernel.resume('app-resume');

    expect(calls).toEqual([
      'generation:read',
      'generation:advance',
      'projections:fence:11:app-resume',
      'auth:resume',
    ]);
    expect(snapshot).toMatchObject({
      phase: 'ACTIVE',
      launchState: 'access-gate-chain',
      generation: 11,
    });
  });

  it('resolves a Station replacement to selection after teardown and restart', async () => {
    const calls: string[] = [];
    const kernel = configuredKernel(
      () => [descriptor('auth', [], calls)],
      { current: 2 },
      calls,
      async () => 'station-selection',
    );

    kernel.transitionLaunchState('station-selection');
    kernel.transitionLaunchState('runtime-critical');
    kernel.transitionLaunchState('shell');
    await kernel.startRuntimeGraph();
    calls.length = 0;

    await kernel.transitionScope('station-replace', async () => {
      calls.push('station:replace');
    });

    expect(kernel.getSnapshot()).toMatchObject({
      phase: 'ACTIVE',
      launchState: 'station-selection',
      generation: 3,
    });
    expect(calls).toEqual([
      'generation:advance',
      'projections:fence:3:station-replace',
      'auth:teardown',
      'station:replace',
      'auth:bootstrap',
    ]);
  });

  it('returns an immutable descriptor-free public snapshot', async () => {
    const kernel = configuredKernel(
      () => [descriptor('auth', [], [])],
      { current: 1 },
      [],
    );
    await kernel.startRuntimeGraph();

    const snapshot = kernel.getSnapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.runtimes)).toBe(true);
    expect(snapshot.runtimes).toEqual([
      { id: 'auth', status: 'ready', errorKey: null },
    ]);
    expect(snapshot.runtimes[0]).not.toHaveProperty('descriptor');
  });

  it('rejects a graph with a missing hard dependency', async () => {
    const kernel = configuredKernel(
      () => [descriptor('social', ['auth'], [])],
      { current: 1 },
      [],
    );

    await expect(kernel.startRuntimeGraph())
      .rejects.toThrow('mobile.lifecycle.missingDependency:social->auth');
  });

  it('bounds a stalled suspend operation and keeps the graph suspended', async () => {
    vi.useFakeTimers();
    const kernel = configuredKernel(
      () => [{
        ...descriptor('auth', [], []),
        suspend: () => new Promise<void>(() => undefined),
      }],
      { current: 1 },
      [],
    );
    await kernel.startRuntimeGraph();

    const suspended = kernel.suspend('acceptance-suspend');
    await vi.advanceTimersByTimeAsync(2_001);

    await expect(suspended)
      .rejects.toThrow('mobile.lifecycle.suspendIncomplete:auth');
    expect(kernel.getSnapshot()).toMatchObject({
      phase: 'SUSPENDED',
      errorKey: 'mobile.lifecycle.suspendIncomplete:auth',
      runtimes: [{
        id: 'auth',
        status: 'suspended',
        errorKey: 'mobile.lifecycle.runtimeTimedOut:auth:suspend',
      }],
    });
  });
});

function configuredKernel(
  createDescriptors: LifecycleRuntimeGraphDependencies['createDescriptors'],
  generation: { current: number },
  calls: string[],
  resolveLaunchState?: LifecycleRuntimeGraphDependencies['resolveLaunchState'],
): MobileLifecycleKernel {
  const kernel = new MobileLifecycleKernel();
  kernel.configureRuntimeGraph({
    createDescriptors,
    readGeneration: async () => {
      calls.push('generation:read');
      return generation.current;
    },
    advanceGeneration: async () => {
      calls.push('generation:advance');
      generation.current += 1;
      return generation.current;
    },
    resolveLaunchState: resolveLaunchState ?? (async () => kernel.getState().launchState),
    fenceProjections: (nextGeneration, reason) => {
      calls.push(`projections:fence:${nextGeneration}:${reason}`);
    },
  });
  return kernel;
}

function descriptor(
  id: string,
  dependsOn: readonly string[],
  calls: string[],
): MobileRuntimeDescriptor {
  return {
    id,
    title: id,
    responsibility: id,
    dependsOn,
    bootstrap: async () => {
      calls.push(`${id}:bootstrap`);
    },
    suspend: async () => {
      calls.push(`${id}:suspend`);
    },
    resume: async () => {
      calls.push(`${id}:resume`);
    },
    teardown: async () => {
      calls.push(`${id}:teardown`);
      return {
        runtimeId: id,
        success: true,
        durationMs: 0,
      };
    },
  };
}
