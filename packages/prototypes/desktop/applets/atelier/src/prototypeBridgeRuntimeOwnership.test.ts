import { describe, expect, it } from 'vitest';

import { createBridgeAtelierRuntime, type AtelierRuntimeBridge } from './bridgeRuntime';
import { createAppletSdkAtelierBridge } from './appletBridge';
import type { AtelierProjectionEvent, AtelierProjectionSnapshot, AtelierRuntimeCall } from './projection';
import { ATELIER_PROJECTION_VERSION } from './projection';
import { ATELIER_PROJECTION_EVENT_TOPIC } from './projection.contract.generated';
import type { AtelierProviderCapabilitiesResponse } from './runtime';
import type { Task } from './types';

function task(id: string, title = `Task ${id}`): Task {
  return {
    id,
    project: 'atelier',
    title,
    status: 'active',
  };
}

function projection(input: {
  selectedTaskId?: string;
  tasks?: Task[];
} = {}): AtelierProjectionSnapshot {
  const tasks = input.tasks ?? [task('task-1', 'Initial Host projection')];
  return {
    version: ATELIER_PROJECTION_VERSION,
    selectedTaskId: input.selectedTaskId ?? tasks[0]?.id ?? '',
    workspace: {
      budgetSpent: 0,
      budgetCap: 1,
      model: 'gpt-4.1',
      tasks,
      streams: Object.fromEntries(tasks.map((item) => [item.id, []])),
      todos: Object.fromEntries(tasks.map((item) => [item.id, []])),
      contexts: Object.fromEntries(tasks.map((item) => [item.id, { usedPct: 0, files: [] }])),
      artifacts: Object.fromEntries(tasks.map((item) => [item.id, []])),
      gates: Object.fromEntries(tasks.map((item) => [item.id, []])),
    },
  };
}

describe('prototype bridge runtime ownership isolation', () => {
  it('keeps initial Host projection mutations from polluting runtime-owned state', () => {
    const initialProjection = projection();
    const originalTitle = initialProjection.workspace.tasks[0].title;
    const runtime = createBridgeAtelierRuntime({
      bridge: bridgeReturning(initialProjection),
      initialSnapshot: initialProjection,
    });

    initialProjection.workspace.tasks[0].title = 'Externally mutated initial projection';
    initialProjection.workspace.tasks.push({
      id: 'external-initial-task',
      project: 'atelier',
      title: 'External initial mutation',
      status: 'active',
    });

    const next = runtime.getSnapshot();
    expect(next.state.tasks[0].title).toBe(originalTitle);
    expect(next.state.tasks.some((task) => task.id === 'external-initial-task')).toBe(false);
    expect(JSON.stringify(next)).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
  });

  it('keeps accepted Host call projection mutations from polluting runtime-owned state', async () => {
    const initialProjection = projection();
    const acceptedProjection = projection();
    acceptedProjection.workspace.tasks[0].title = 'Accepted Host projection';
    const runtime = createBridgeAtelierRuntime({
      bridge: bridgeReturning(acceptedProjection),
      initialSnapshot: initialProjection,
    });

    await runtime.loadWorkspace();
    acceptedProjection.workspace.tasks[0].title = 'Externally mutated accepted projection';
    acceptedProjection.workspace.tasks.push({
      id: 'external-accepted-task',
      project: 'atelier',
      title: 'External accepted mutation',
      status: 'active',
    });

    const next = runtime.getSnapshot();
    expect(next.state.tasks[0].title).toBe('Accepted Host projection');
    expect(next.state.tasks.some((task) => task.id === 'external-accepted-task')).toBe(false);
    expect(JSON.stringify(next)).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
  });

  it('ignores released Host projection subscription callbacks while accepting the next subscription generation', () => {
    const listeners: Array<(event: unknown) => void> = [];
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        call(_request: AtelierRuntimeCall) {
          return Promise.resolve(projection());
        },
        subscribeProjection(listener) {
          listeners.push(listener);
          return () => undefined;
        },
      },
      initialSnapshot: projection(),
    });

    const releaseFirst = runtime.subscribe(() => undefined);
    expect(listeners).toHaveLength(1);
    releaseFirst();

    listeners[0](taskUpsertEvent('evt-released', 1, task('task-1', 'Released callback mutation')));
    const afterReleased = runtime.getSnapshot();
    expect(afterReleased.state.tasks[0].title).toBe('Initial Host projection');
    expect(afterReleased.status?.kind).toBe('ready');

    const releaseSecond = runtime.subscribe(() => undefined);
    expect(listeners).toHaveLength(2);
    listeners[1](taskUpsertEvent('evt-active', 1, task('task-1', 'Active callback update')));

    const afterActive = runtime.getSnapshot();
    expect(afterActive.state.tasks[0].title).toBe('Active callback update');
    expect(afterActive.status?.kind).toBe('ready');
    expect(JSON.stringify(afterActive)).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
    releaseSecond();
  });

  it('ignores pre-cleanup Host projection subscription callbacks when cleanup is malformed', () => {
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        call(_request: AtelierRuntimeCall) {
          return Promise.resolve(projection());
        },
        subscribeProjection(listener) {
          listener(taskUpsertEvent('evt-before-cleanup', 1, task('task-1', 'Pre-cleanup callback mutation')));
          return undefined;
        },
      },
      initialSnapshot: projection(),
    });

    const release = runtime.subscribe(() => undefined);
    const next = runtime.getSnapshot();

    expect(next.state.tasks[0].title).toBe('Initial Host projection');
    expect(next.status?.kind).toBe('disconnected');
    expect(JSON.stringify(next)).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
    release();
  });

  it('keeps projection subscription reconciling until Host subscribe ack settles', async () => {
    const ready = deferred<void>();
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        call(_request: AtelierRuntimeCall) {
          return Promise.resolve(projection());
        },
        subscribeProjection() {
          return Object.assign(() => undefined, { ready: ready.promise });
        },
      },
      initialSnapshot: projection(),
    });

    const release = runtime.subscribe(() => undefined);
    expect(runtime.getSnapshot().status?.kind).toBe('reconciling');
    ready.resolve();
    await Promise.resolve();

    const next = runtime.getSnapshot();
    expect(next.status?.kind).toBe('ready');
    expect(JSON.stringify(next)).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
    release();
  });

  it('maps rejected Host subscribe ack to typed recovery without first marking ready', async () => {
    const ready = deferred<void>();
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        call(_request: AtelierRuntimeCall) {
          return Promise.resolve(projection());
        },
        subscribeProjection() {
          return Object.assign(() => undefined, { ready: ready.promise });
        },
      },
      initialSnapshot: projection(),
    });

    const release = runtime.subscribe(() => undefined);
    expect(runtime.getSnapshot().status?.kind).toBe('reconciling');
    ready.reject(Object.assign(new Error('Host denied projection subscribe'), { code: 'FORBIDDEN' }));
    await Promise.resolve();
    await Promise.resolve();

    const next = runtime.getSnapshot();
    expect(next.status?.kind).toBe('auth-denied');
    expect(JSON.stringify(next)).not.toMatch(/Host denied projection subscribe.*ready|provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
    release();
  });

  it('ignores stale Host subscribe ack resolve after subscription replacement', async () => {
    const firstReady = deferred<void>();
    const secondReady = deferred<void>();
    const cleanups: Array<(() => void) & { ready: Promise<void> }> = [];
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        call(_request: AtelierRuntimeCall) {
          return Promise.resolve(projection());
        },
        subscribeProjection() {
          const ready = cleanups.length === 0 ? firstReady.promise : secondReady.promise;
          const cleanup = Object.assign(() => undefined, { ready });
          cleanups.push(cleanup);
          return cleanup;
        },
      },
      initialSnapshot: projection(),
    });

    const releaseFirst = runtime.subscribe(() => undefined);
    expect(runtime.getSnapshot().status?.kind).toBe('reconciling');
    releaseFirst();

    const releaseSecond = runtime.subscribe(() => undefined);
    expect(cleanups).toHaveLength(2);
    firstReady.resolve();
    await Promise.resolve();
    expect(runtime.getSnapshot().status?.kind).toBe('reconciling');

    secondReady.resolve();
    await Promise.resolve();
    const next = runtime.getSnapshot();
    expect(next.status?.kind).toBe('ready');
    expect(JSON.stringify(next)).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
    releaseSecond();
  });

  it('ignores stale Host subscribe ack rejection after subscription replacement', async () => {
    const firstReady = deferred<void>();
    const secondReady = deferred<void>();
    const cleanups: Array<(() => void) & { ready: Promise<void> }> = [];
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        call(_request: AtelierRuntimeCall) {
          return Promise.resolve(projection());
        },
        subscribeProjection() {
          const ready = cleanups.length === 0 ? firstReady.promise : secondReady.promise;
          const cleanup = Object.assign(() => undefined, { ready });
          cleanups.push(cleanup);
          return cleanup;
        },
      },
      initialSnapshot: projection(),
    });

    const releaseFirst = runtime.subscribe(() => undefined);
    expect(runtime.getSnapshot().status?.kind).toBe('reconciling');
    releaseFirst();

    const releaseSecond = runtime.subscribe(() => undefined);
    expect(cleanups).toHaveLength(2);
    firstReady.reject(Object.assign(new Error('ignored stale subscription rejection'), { code: 'FORBIDDEN' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.getSnapshot().status?.kind).toBe('reconciling');

    secondReady.resolve();
    await Promise.resolve();
    const next = runtime.getSnapshot();
    expect(next.status?.kind).toBe('ready');
    expect(JSON.stringify(next)).not.toMatch(/ignored stale subscription rejection|provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
    releaseSecond();
  });

  it('reconciles canonical invalidation through authoritative workspace readback', async () => {
    const listeners: Array<(event: unknown) => void> = [];
    const authoritative = projection({
      tasks: [task('task-1', 'Authoritative invalidation readback')],
    });
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        call(request: AtelierRuntimeCall) {
          expect(request).toEqual({ method: 'atelier.workspace.load', payload: {} });
          return Promise.resolve(authoritative);
        },
        subscribeProjection(listener) {
          listeners.push(listener);
          return () => undefined;
        },
      },
      initialSnapshot: projection(),
    });

    const release = runtime.subscribe(() => undefined);
    listeners[0](invalidationEvent('evt-invalidate', 1));
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.getSnapshot().state.tasks[0].title).toBe('Authoritative invalidation readback');
    expect(runtime.getSnapshot().status?.kind).toBe('ready');
    release();
  });

  it('does not apply a gap event before authoritative workspace readback', async () => {
    const listeners: Array<(event: unknown) => void> = [];
    const readback = deferred<AtelierProjectionSnapshot>();
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        call(request: AtelierRuntimeCall) {
          expect(request).toEqual({ method: 'atelier.workspace.load', payload: {} });
          return readback.promise;
        },
        subscribeProjection(listener) {
          listeners.push(listener);
          return () => undefined;
        },
      },
      initialSnapshot: projection(),
    });

    const release = runtime.subscribe(() => undefined);
    listeners[0](taskUpsertEvent('evt-seq-1', 1, task('task-1', 'Applied contiguous event')));
    listeners[0](taskUpsertEvent('evt-seq-3', 3, task('task-1', 'Must wait for readback')));

    expect(runtime.getSnapshot().state.tasks[0].title).toBe('Applied contiguous event');
    readback.resolve(projection({
      tasks: [task('task-1', 'Authoritative gap readback')],
    }));
    await readback.promise;
    await Promise.resolve();

    expect(runtime.getSnapshot().state.tasks[0].title).toBe('Authoritative gap readback');
    expect(runtime.getSnapshot().status?.kind).toBe('ready');
    release();
  });

  it('keeps subscription rejection recovery from being overwritten by non-snapshot call success', async () => {
    const listeners: Array<(event: unknown) => void> = [];
    const providerCapabilities = deferred<AtelierProviderCapabilitiesResponse>();
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        call(request: AtelierRuntimeCall) {
          if (request.method === 'atelier.provider.capabilities') return providerCapabilities.promise;
          return Promise.resolve(projection());
        },
        subscribeProjection(listener) {
          listeners.push(listener);
          return () => undefined;
        },
      },
      initialSnapshot: projection(),
    });

    const release = runtime.subscribe(() => undefined);
    const capabilities = runtime.listProviderCapabilities({ taskId: 'task-1' });
    listeners[0]({
      kind: 'atelier.projection.subscription-rejected',
      method: 'events.subscribe',
      code: 'FORBIDDEN',
      reason: 'opaque subscription denial',
    });
    providerCapabilities.resolve({
      capabilities: [],
      source: 'station.provider.capabilities',
    });
    await capabilities;

    const next = runtime.getSnapshot();
    expect(next.status?.kind).toBe('auth-denied');
    expect(JSON.stringify(next)).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
    release();
  });

  it('keeps subscription rejection recovery from being overwritten by non-snapshot call failure', async () => {
    const listeners: Array<(event: unknown) => void> = [];
    const providerCapabilities = deferred<AtelierProviderCapabilitiesResponse>();
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        call(request: AtelierRuntimeCall) {
          if (request.method === 'atelier.provider.capabilities') return providerCapabilities.promise;
          return Promise.resolve(projection());
        },
        subscribeProjection(listener) {
          listeners.push(listener);
          return () => undefined;
        },
      },
      initialSnapshot: projection(),
    });

    const release = runtime.subscribe(() => undefined);
    const capabilities = runtime.listProviderCapabilities({ taskId: 'task-1' });
    listeners[0]({
      kind: 'atelier.projection.subscription-rejected',
      method: 'events.subscribe',
      code: 'FORBIDDEN',
      reason: 'opaque subscription denial',
    });
    providerCapabilities.reject(new Error('stale provider capability failure'));
    await expect(capabilities).rejects.toThrow('stale provider capability failure');

    const next = runtime.getSnapshot();
    expect(next.status?.kind).toBe('auth-denied');
    expect(JSON.stringify(next)).not.toMatch(/stale provider capability failure|provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
    release();
  });

  it('rejects execution-shaped fields in every non-snapshot Host response before runtime ownership can observe them', async () => {
    const cases: Array<{
      method: AtelierRuntimeCall['method'];
      payload: Record<string, unknown>;
      response: Record<string, unknown>;
      forbiddenField: Record<string, unknown>;
    }> = [
      {
        method: 'atelier.provider.capabilities',
        payload: {},
        response: {
          capabilities: [],
          source: 'station.provider.capabilities',
        },
        forbiddenField: { shellExecute: { command: 'open .' } },
      },
      {
        method: 'atelier.feedback.submit',
        payload: { taskId: 'task-1', blockId: 'block-1', signal: 'positive' },
        response: {
          accepted: true,
          feedbackId: 'feedback-1',
          memoryCandidate: feedbackPolicyHint(),
          rerunIntent: feedbackPolicyHint(),
        },
        forbiddenField: { providerInvoke: { provider: 'model' } },
      },
      {
        method: 'atelier.memory.confirmCandidate',
        payload: { taskId: 'task-1', feedbackId: 'feedback-1' },
        response: {
          accepted: true,
          feedbackId: 'feedback-1',
          memoryId: 'memory-1',
          status: 'accepted',
          source: 'station.memory',
          alreadyDone: false,
        },
        forbiddenField: { 'memory.write': { id: 'memory-1' } },
      },
      {
        method: 'atelier.feedback.confirmRerun',
        payload: { taskId: 'task-1', feedbackId: 'feedback-1' },
        response: {
          accepted: true,
          feedbackId: 'feedback-1',
          taskId: 'task-1',
          rerunTaskId: 'task-rerun-1',
          status: 'started',
          source: 'station.rerun',
          alreadyDone: false,
          started: true,
        },
        forbiddenField: { runtimeExecute: { taskId: 'task-rerun-1' } },
      },
      {
        method: 'atelier.workspace.open',
        payload: { taskId: 'task-1', workspaceUri: 'pt-workspace://task/task-1?workspace=ws-1' },
        response: {
          accepted: true,
          opened: false,
          workspaceUri: 'pt-workspace://task/task-1?workspace=ws-1',
          mode: 'host_owned_intent',
          reason: 'Host owns IDE launch.',
        },
        forbiddenField: { shellExecute: { command: 'code .' } },
      },
      {
        method: 'atelier.artifact.body.fetch',
        payload: {
          taskId: 'task-1',
          artifactId: 'artifact-1',
          bodyRef: 'artifact://task-1/artifact-1/body',
          expectedHash: 'sha256:body-1',
        },
        response: {
          taskId: 'task-1',
          artifactId: 'artifact-1',
          bodyRef: 'artifact://task-1/artifact-1/body',
          bodyKind: 'text',
          bodyHash: 'sha256:body-1',
          bodySize: 12,
          text: 'hello world',
          truncated: false,
          retentionStatus: 'available',
        },
        forbiddenField: { gateRun: { gate: 'unit' } },
      },
      {
        method: 'atelier.artifact.preview.open',
        payload: {
          taskId: 'task-1',
          artifactId: 'artifact-1',
          sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
          bodyRef: 'artifact://task-1/artifact-1/body',
        },
        response: {
          accepted: true,
          opened: false,
          prepared: true,
          taskId: 'task-1',
          artifactId: 'artifact-1',
          sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
          bodyRef: 'artifact://task-1/artifact-1/body',
          kind: 'html',
          mode: 'sandbox_manifest',
          rendererSessionId: 'atelier-preview:artifact-1',
          rendererOwner: 'desktop_host',
          rendererMode: 'host_sandbox_manifest',
          rendererStatus: 'prepared_not_opened',
          rendererCapabilities: ['host_visual_renderer_surface'],
          reason: 'Host owns artifact preview rendering.',
        },
        forbiddenField: { nested: { 'provider.invoke': { provider: 'model' } } },
      },
    ];

    const coveredMethods: string[] = [];
    for (const item of cases) {
      const bridge = createAppletSdkAtelierBridge({
        invoke(method) {
          expect(method).toBe(item.method);
          return Promise.resolve({
            ...item.response,
            ...item.forbiddenField,
          });
        },
      });

      coveredMethods.push(item.method);
      await expect(bridge.call({
        method: item.method,
        payload: item.payload,
      } as AtelierRuntimeCall)).rejects.toThrow(/forbidden capability/);
    }

    expect(coveredMethods).toEqual([
      'atelier.provider.capabilities',
      'atelier.feedback.submit',
      'atelier.memory.confirmCandidate',
      'atelier.feedback.confirmRerun',
      'atelier.workspace.open',
      'atelier.artifact.body.fetch',
      'atelier.artifact.preview.open',
    ]);
  });

  it('sanitizes rejected subscribe reason text before emitting typed recovery payload', async () => {
    const hostError = Object.assign(
        new Error('provider.invoke providerInvoke runtime.execute runtimeExecute shellExecute input_snapshot should not leak'),
      { code: 'FORBIDDEN' },
    );
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => JSON.stringify(arg)).join(' '));
    };
    const bridge = createAppletSdkAtelierBridge({
      invoke(method) {
        if (method === 'events.subscribe') {
          return Promise.reject(hostError);
        }
        return Promise.resolve(undefined);
      },
      onEvent(_topic, _handler) {
        return () => undefined;
      },
    });

    const seen: unknown[] = [];
    const unsubscribe = bridge.subscribeProjection((payload) => {
      seen.push(payload);
    });
    try {
      await (unsubscribe as (() => void) & { ready?: Promise<void> }).ready?.catch(() => undefined);
      await Promise.resolve();

      expect(seen).toEqual([
        {
          kind: 'atelier.projection.subscription-rejected',
          method: 'events.subscribe',
          code: 'FORBIDDEN',
          reason: 'Host projection subscription rejected',
        },
      ]);
      expect(warnings).toHaveLength(1);
        expect(JSON.stringify({ seen, warnings })).not.toMatch(/provider\.invoke|providerInvoke|runtime\.execute|runtimeExecute|shellExecute|memory\.write|input_snapshot|run\.execute/);
    } finally {
      console.warn = originalWarn;
      unsubscribe();
    }
  });

  it('ignores late subscribe rejections after release without listener delivery duplicate unsubscribe or unhandled rejection', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const warnings: string[] = [];
    const unhandledRejections: unknown[] = [];
    const handlers = new Map<string, (payload: unknown) => void>();
    let rejectEventSubscribe!: (reason?: unknown) => void;
    const originalWarn = console.warn;
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(' '));
    };
    try {
      const bridge = createAppletSdkAtelierBridge({
        invoke(method, params) {
          calls.push({ method, params });
          if (method === 'events.subscribe') {
            return new Promise((_, reject) => {
              rejectEventSubscribe = reject;
            });
          }
          return Promise.resolve(undefined);
        },
        onEvent(topic, handler) {
          handlers.set(topic, handler);
          return () => {
            handlers.delete(topic);
          };
        },
      });

      const seen: unknown[] = [];
      const unsubscribe = bridge.subscribeProjection((payload) => {
        seen.push(payload);
      });
      expect([...handlers.keys()]).toEqual([ATELIER_PROJECTION_EVENT_TOPIC]);

      unsubscribe();
      expect(handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false);
      rejectEventSubscribe(new Error('late rejected events.subscribe'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(calls.map((call) => call.method)).toEqual([
        'events.subscribe',
        'events.unsubscribe',
      ]);
      expect(seen).toEqual([]);
      expect(unhandledRejections).toHaveLength(0);
      expect(warnings.filter((warning) => warning.includes('Atelier applet bridge'))).toHaveLength(1);
      expect(JSON.stringify({ calls, seen })).not.toMatch(/provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/);
    } finally {
      console.warn = originalWarn;
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});

function bridgeReturning(projection: AtelierProjectionSnapshot): AtelierRuntimeBridge {
  return {
    call(_request: AtelierRuntimeCall) {
      return Promise.resolve(projection);
    },
  };
}

function taskUpsertEvent(id: string, seq: number, nextTask: Task): AtelierProjectionEvent {
  return {
    id,
    seq,
    receivedAt: '2026-07-08T00:00:00.000Z',
    patch: {
      kind: 'task.upsert',
      task: nextTask,
    },
  };
}

function invalidationEvent(id: string, seq: number): AtelierProjectionEvent {
  return {
    id,
    seq,
    taskId: 'task-1',
    receivedAt: '2026-10-04T00:00:00.000Z',
    patch: {
      kind: 'snapshot.invalidate',
      streamEventId: `stream-${seq}`,
      eventType: 'agent.task.running',
      goalId: 'goal-1',
      taskId: 'task-1',
      goalRevision: seq,
      schemaVersion: 1,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function feedbackPolicyHint() {
  return {
    status: 'ignored',
    reason: 'Projection-only response hint.',
    requiresConfirmation: false,
    confirmationMode: 'none',
    feeds: [],
  };
}
