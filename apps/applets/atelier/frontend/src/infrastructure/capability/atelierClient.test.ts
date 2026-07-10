import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtelierProjectionSnapshot } from '../../domain/projection';
import {
  ATELIER_PROJECTION_EVENT_TOPIC,
  ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
} from '../../domain/projection.contract.generated';
import { classifyAtelierError, subscribeAtelierProjectionEvents } from './atelierClient';

declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

const sdkState = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  invoke: vi.fn(),
  getLaunchOptions: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@peers-touch/applet-sdk', () => ({
  sdk: {
    app: {
      getLaunchOptions: sdkState.getLaunchOptions,
    },
    events: {
      on: vi.fn((topic: string, handler: (payload: unknown) => void) => {
        sdkState.handlers.set(topic, handler);
        return () => {
          sdkState.handlers.delete(topic);
        };
      }),
      subscribe: sdkState.subscribe,
      unsubscribe: sdkState.unsubscribe,
    },
    invoke: sdkState.invoke,
    telemetry: {
      track: sdkState.track,
    },
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function snapshot(): AtelierProjectionSnapshot {
  return {
    version: 'atelier-projection/v0',
    selectedTaskId: 'task-official-subscribe',
    workspace: {
      budgetSpent: 0,
      budgetCap: 100,
      model: 'claude-sonnet',
      tasks: [
        {
          id: 'task-official-subscribe',
          project: 'atelier',
          title: 'Official subscribe cleanup',
          status: 'active',
        },
      ],
      streams: { 'task-official-subscribe': [] },
      todos: { 'task-official-subscribe': [] },
      contexts: { 'task-official-subscribe': { usedPct: 0, files: [] } },
      artifacts: { 'task-official-subscribe': [] },
      gates: { 'task-official-subscribe': [] },
      replay: {
        'task-official-subscribe': {
          source: 'station',
          eventCount: 3,
          replayedEventCount: 3,
          nextEventSeq: 3,
          hasMore: false,
        },
      },
    },
  };
}

function projectionEvent(id: string) {
  return {
    id,
    seq: 3,
    taskId: 'task-official-subscribe',
    receivedAt: '2026-07-09T00:00:00.000Z',
    patch: {
      kind: 'stream.append',
      taskId: 'task-official-subscribe',
      blocks: [{ id: `${id}-block`, kind: 'agent', text: 'projection update' }],
    },
  };
}

function configureProjectionStream(): void {
  (globalThis as { __ATELIER_PROJECTION_STREAM__?: unknown }).__ATELIER_PROJECTION_STREAM__ = {
    agentId: 'agent-official-subscribe',
    taskId: 'task-official-subscribe',
  };
}

beforeEach(() => {
  sdkState.handlers.clear();
  sdkState.subscribe.mockReset();
  sdkState.unsubscribe.mockReset();
  sdkState.invoke.mockReset();
  sdkState.getLaunchOptions.mockReset();
  sdkState.track.mockReset();
  sdkState.unsubscribe.mockResolvedValue(undefined);
  sdkState.invoke.mockResolvedValue(undefined);
  sdkState.getLaunchOptions.mockResolvedValue(null);
  sdkState.track.mockResolvedValue(undefined);
  delete (globalThis as { __ATELIER_PROJECTION_STREAM__?: unknown }).__ATELIER_PROJECTION_STREAM__;
});

describe('official Atelier projection subscription client cleanup', () => {
  it('cleans local listener and Host topic when events.subscribe rejects before Station stream subscribe', async () => {
    configureProjectionStream();
    const subscribeReady = deferred<void>();
    sdkState.subscribe.mockReturnValueOnce(subscribeReady.promise);
    const seen: unknown[] = [];
    const rejected: Error[] = [];

    const subscription = subscribeAtelierProjectionEvents(
      snapshot(),
      'task-official-subscribe',
      (event) => seen.push(event),
      (payload) => seen.push(payload),
      (error) => rejected.push(error),
    );

    await Promise.resolve();
    expect([...sdkState.handlers.keys()]).toEqual([ATELIER_PROJECTION_EVENT_TOPIC]);
    subscribeReady.reject(new Error('late rejected official events.subscribe'));
    await expect(subscription).rejects.toThrow('late rejected official events.subscribe');

    expect(sdkState.handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false);
    expect(sdkState.unsubscribe).toHaveBeenCalledTimes(1);
    expect(sdkState.unsubscribe).toHaveBeenCalledWith(ATELIER_PROJECTION_EVENT_TOPIC);
    expect(sdkState.invoke).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    expect(rejected).toEqual([]);
    expect(JSON.stringify({ seen, rejected })).not.toMatch(
      /provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/,
    );
  });

  it('cleans local listener and Host topic when atelier.events.subscribe rejects after Host topic subscribe', async () => {
    configureProjectionStream();
    sdkState.subscribe.mockResolvedValueOnce(undefined);
    const streamSubscribeReady = deferred<void>();
    sdkState.invoke.mockReturnValueOnce(streamSubscribeReady.promise);
    sdkState.unsubscribe.mockRejectedValueOnce(new Error('late rejected official events.unsubscribe after stream reject'));
    const seen: unknown[] = [];
    const rejected: Error[] = [];
    const unhandledRejections: unknown[] = [];
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(' '));
    };
    try {
      const subscription = subscribeAtelierProjectionEvents(
        snapshot(),
        'task-official-subscribe',
        (event) => seen.push(event),
        (payload) => seen.push(payload),
        (error) => rejected.push(error),
      );

      await Promise.resolve();
      await Promise.resolve();
      const staleHostHandler = sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC);
      expect(staleHostHandler).toBeDefined();
      expect(sdkState.invoke).toHaveBeenCalledWith(ATELIER_PROJECTION_SUBSCRIPTION_METHOD, {
        agentId: 'agent-official-subscribe',
        taskId: 'task-official-subscribe',
        afterEventSeq: 3,
      });

      streamSubscribeReady.reject(new Error('late rejected official atelier.events.subscribe invoke'));
      await expect(subscription).rejects.toThrow('late rejected official atelier.events.subscribe invoke');
      staleHostHandler?.(projectionEvent('evt-after-stream-reject'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sdkState.handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false);
      expect(sdkState.unsubscribe).toHaveBeenCalledTimes(1);
      expect(sdkState.unsubscribe).toHaveBeenCalledWith(ATELIER_PROJECTION_EVENT_TOPIC);
      expect(seen).toEqual([]);
      expect(rejected).toEqual([]);
      expect(unhandledRejections).toHaveLength(0);
      expect(warnings.filter((warning) => warning.includes('Atelier official projection event topic unsubscribe rejected'))).toHaveLength(1);
      expect(JSON.stringify({ seen, rejected })).not.toMatch(
        /provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/,
      );
    } finally {
      console.warn = originalWarn;
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('delivers active typed subscription rejection once then cleans listener and blocks later events', async () => {
    configureProjectionStream();
    sdkState.subscribe.mockResolvedValueOnce(undefined);
    sdkState.invoke.mockResolvedValueOnce(undefined);
    sdkState.unsubscribe.mockRejectedValueOnce(new Error('late rejected official events.unsubscribe after typed reject'));
    const seen: unknown[] = [];
    const rejected: Error[] = [];
    const unhandledRejections: unknown[] = [];
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(' '));
    };
    try {
      const release = await subscribeAtelierProjectionEvents(
        snapshot(),
        'task-official-subscribe',
        (event) => seen.push(event),
        (payload) => seen.push(payload),
        (error) => rejected.push(error),
      );
      const staleHostHandler = sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC);
      expect(staleHostHandler).toBeDefined();

      staleHostHandler?.({
        kind: 'atelier.projection.subscription-rejected',
        method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
        code: 'PERMISSION_DENIED',
        reason: 'active official atelier.events.subscribe typed rejection',
      });
      release();
      staleHostHandler?.(projectionEvent('evt-after-active-typed-reject'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sdkState.invoke).toHaveBeenCalledWith(ATELIER_PROJECTION_SUBSCRIPTION_METHOD, {
        agentId: 'agent-official-subscribe',
        taskId: 'task-official-subscribe',
        afterEventSeq: 3,
      });
      expect(sdkState.handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false);
      expect(sdkState.unsubscribe).toHaveBeenCalledTimes(1);
      expect(sdkState.unsubscribe).toHaveBeenCalledWith(ATELIER_PROJECTION_EVENT_TOPIC);
      expect(seen).toEqual([]);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.message).toContain(
        'Atelier projection stream subscription atelier.events.subscribe rejected',
      );
      expect(rejected[0]?.message).toContain('active official atelier.events.subscribe typed rejection');
      expect(unhandledRejections).toHaveLength(0);
      expect(warnings.filter((warning) => warning.includes('Atelier official projection event topic unsubscribe rejected'))).toHaveLength(1);
      expect(JSON.stringify({ seen, rejected })).not.toMatch(
        /provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/,
      );
    } finally {
      console.warn = originalWarn;
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('preserves active typed subscription rejection codes for recovery taxonomy', async () => {
    const cases: Array<{
      code: string;
      reason: string;
      expected: ReturnType<typeof classifyAtelierError>;
    }> = [
      {
        code: 'FORBIDDEN',
        reason: 'opaque host policy rejected stream',
        expected: { key: 'atelier.error.authDenied', kind: 'auth-denied' },
      },
      {
        code: 'CONNECTION_CLOSED',
        reason: 'opaque station stream closed',
        expected: { key: 'atelier.error.disconnected', kind: 'disconnected' },
      },
    ];

    for (const item of cases) {
      configureProjectionStream();
      sdkState.subscribe.mockResolvedValueOnce(undefined);
      sdkState.invoke.mockResolvedValueOnce(undefined);
      const rejected: Error[] = [];
      const release = await subscribeAtelierProjectionEvents(
        snapshot(),
        'task-official-subscribe',
        () => undefined,
        undefined,
        (error) => rejected.push(error),
      );
      const staleHostHandler = sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC);
      expect(staleHostHandler).toBeDefined();

      staleHostHandler?.({
        kind: 'atelier.projection.subscription-rejected',
        method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
        code: item.code,
        reason: item.reason,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.message).toContain(item.reason);
      expect(classifyAtelierError(rejected[0])).toEqual(item.expected);
      expect(sdkState.handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false);
      expect(JSON.stringify({ rejected })).not.toMatch(
        /provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/,
      );
      release();

      sdkState.handlers.clear();
      sdkState.subscribe.mockReset();
      sdkState.invoke.mockReset();
      sdkState.unsubscribe.mockReset();
      sdkState.unsubscribe.mockResolvedValue(undefined);
      sdkState.invoke.mockResolvedValue(undefined);
    }
  });

  it('fails closed on malformed typed subscription rejection payload fields without treating them as projection events', async () => {
    configureProjectionStream();
    sdkState.subscribe.mockResolvedValueOnce(undefined);
    sdkState.invoke.mockResolvedValueOnce(undefined);
    const seen: unknown[] = [];
    const malformed: unknown[] = [];
    const rejected: Error[] = [];
    const release = await subscribeAtelierProjectionEvents(
      snapshot(),
      'task-official-subscribe',
      (event) => seen.push(event),
      (payload) => malformed.push(payload),
      (error) => rejected.push(error),
    );
    const staleHostHandler = sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC);
    expect(staleHostHandler).toBeDefined();

    staleHostHandler?.({
      kind: 'atelier.projection.subscription-rejected',
      method: '',
      code: { nested: 'FORBIDDEN' },
      reason: { nested: 'do not trust malformed reason' },
      shellExecute: { command: 'open .' },
    });
    staleHostHandler?.(projectionEvent('evt-after-malformed-typed-reject'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual([]);
    expect(malformed).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.message).toBe('Atelier projection stream subscription unknown rejected: unknown rejection');
    expect(rejected[0]?.cause).toEqual({
      kind: 'atelier.projection.subscription-rejected',
      method: 'unknown',
      reason: 'unknown rejection',
    });
    expect(JSON.stringify(rejected[0]?.cause)).not.toMatch(/shellExecute|FORBIDDEN|do not trust malformed reason/);
    expect(classifyAtelierError(rejected[0])).toEqual({
      key: 'atelier.error.loadFailed',
      kind: 'error',
    });
    expect(sdkState.handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false);
    expect(sdkState.unsubscribe).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({ seen, malformed })).not.toMatch(
      /provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/,
    );
    release();
  });

  it('sanitizes typed subscription rejection error cause while preserving valid recovery code', async () => {
    configureProjectionStream();
    sdkState.subscribe.mockResolvedValueOnce(undefined);
    sdkState.invoke.mockResolvedValueOnce(undefined);
    const rejected: Error[] = [];
    const release = await subscribeAtelierProjectionEvents(
      snapshot(),
      'task-official-subscribe',
      () => undefined,
      undefined,
      (error) => rejected.push(error),
    );
    const staleHostHandler = sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC);
    expect(staleHostHandler).toBeDefined();

    staleHostHandler?.({
      kind: 'atelier.projection.subscription-rejected',
      method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
      code: 'FORBIDDEN',
      reason: 'host policy denied projection stream',
      providerInvoke: { provider: 'model' },
      runtimeExecute: { taskId: 'task-official-subscribe' },
      input_snapshot: { prompt: 'must not leak' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.cause).toEqual({
      kind: 'atelier.projection.subscription-rejected',
      method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
      reason: 'host policy denied projection stream',
      code: 'FORBIDDEN',
    });
    expect(classifyAtelierError(rejected[0])).toEqual({
      key: 'atelier.error.authDenied',
      kind: 'auth-denied',
    });
    expect(JSON.stringify(rejected[0]?.cause)).not.toMatch(
      /provider\.invoke|providerInvoke|runtime\.execute|runtimeExecute|shell|memory\.write|input_snapshot|run\.execute/,
    );
    expect(sdkState.handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false);
    release();
  });

  it('keeps only known typed subscription rejection recovery codes in sanitized cause', async () => {
    configureProjectionStream();
    sdkState.subscribe.mockResolvedValueOnce(undefined);
    sdkState.invoke.mockResolvedValueOnce(undefined);
    const rejected: Error[] = [];
    const release = await subscribeAtelierProjectionEvents(
      snapshot(),
      'task-official-subscribe',
      () => undefined,
      undefined,
      (error) => rejected.push(error),
    );
    const staleHostHandler = sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC);
    expect(staleHostHandler).toBeDefined();

    staleHostHandler?.({
      kind: 'atelier.projection.subscription-rejected',
      method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
      code: 'connection_closed',
      reason: 'stream closed',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.cause).toEqual({
      kind: 'atelier.projection.subscription-rejected',
      method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
      reason: 'stream closed',
      code: 'CONNECTION_CLOSED',
    });
    expect(classifyAtelierError(rejected[0])).toEqual({
      key: 'atelier.error.disconnected',
      kind: 'disconnected',
    });
    release();

    configureProjectionStream();
    sdkState.subscribe.mockResolvedValueOnce(undefined);
    sdkState.invoke.mockResolvedValueOnce(undefined);
    const rejectedHostile: Error[] = [];
    const releaseHostile = await subscribeAtelierProjectionEvents(
      snapshot(),
      'task-official-subscribe',
      () => undefined,
      undefined,
      (error) => rejectedHostile.push(error),
    );
    const hostileHostHandler = sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC);
    expect(hostileHostHandler).toBeDefined();

    hostileHostHandler?.({
      kind: 'atelier.projection.subscription-rejected',
      method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
      code: 'providerInvoke runtimeExecute shellExecute input_snapshot should not leak',
      reason: 'host sent unknown code',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rejectedHostile).toHaveLength(1);
    expect(rejectedHostile[0]?.cause).toEqual({
      kind: 'atelier.projection.subscription-rejected',
      method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
      reason: 'host sent unknown code',
    });
    expect(classifyAtelierError(rejectedHostile[0])).toEqual({
      key: 'atelier.error.loadFailed',
      kind: 'error',
    });
    expect(JSON.stringify(rejectedHostile[0]?.cause)).not.toMatch(/providerInvoke|runtimeExecute|shellExecute|input_snapshot/);
    releaseHostile();
  });

  it('sanitizes typed subscription rejection reason diagnostic and warning text', async () => {
    configureProjectionStream();
    sdkState.subscribe.mockResolvedValueOnce(undefined);
    sdkState.invoke.mockResolvedValueOnce(undefined);
    sdkState.unsubscribe.mockRejectedValueOnce(
      new Error('provider.invoke providerInvoke runtime.execute runtimeExecute shellExecute input_snapshot should not leak from unsubscribe'),
    );
    const rejected: Error[] = [];
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    };
    try {
      await subscribeAtelierProjectionEvents(
        snapshot(),
        'task-official-subscribe',
        () => undefined,
        undefined,
        (error) => rejected.push(error),
      );
      const staleHostHandler = sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC);
      expect(staleHostHandler).toBeDefined();

      staleHostHandler?.({
        kind: 'atelier.projection.subscription-rejected',
        method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
        code: 'FORBIDDEN',
        reason: 'provider.invoke providerInvoke runtime.execute runtimeExecute shellExecute input_snapshot should not leak from typed rejection',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.message).toBe(
        'Atelier projection stream subscription atelier.events.subscribe rejected: Host projection subscription rejected',
      );
      expect(rejected[0]?.cause).toEqual({
        kind: 'atelier.projection.subscription-rejected',
        method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
        reason: 'Host projection subscription rejected',
        code: 'FORBIDDEN',
      });
      expect(classifyAtelierError(rejected[0])).toEqual({
        key: 'atelier.error.authDenied',
        kind: 'auth-denied',
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Host projection subscription rejected');
      const subscribeRejectedDiagnostic = sdkState.track.mock.calls.find(([event]) => {
        const payload = event as { name?: string; properties?: { stage?: string } };
        return payload.name === 'atelier.projection.subscription.diagnostic' &&
          payload.properties?.stage === 'client.subscribe-rejected';
      })?.[0] as { properties?: { error?: string } } | undefined;
      expect(subscribeRejectedDiagnostic?.properties?.error).toBe(
        'Atelier projection stream subscription atelier.events.subscribe rejected: Host projection subscription rejected',
      );
      expect(JSON.stringify({ rejected, warnings, subscribeRejectedDiagnostic })).not.toMatch(
        /provider\.invoke|providerInvoke|runtime\.execute|runtimeExecute|shellExecute|memory\.write|input_snapshot|run\.execute/,
      );
      expect(sdkState.handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('keeps release idempotent and blocks late event or subscription-rejected payload delivery', async () => {
    configureProjectionStream();
    sdkState.subscribe.mockResolvedValueOnce(undefined);
    sdkState.unsubscribe.mockRejectedValueOnce(new Error('late rejected official events.unsubscribe'));
    const seen: unknown[] = [];
    const rejected: Error[] = [];
    const unhandledRejections: unknown[] = [];
    const warnings: string[] = [];
    const originalWarn = console.warn;
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(' '));
    };
    try {
      const release = await subscribeAtelierProjectionEvents(
        snapshot(),
        'task-official-subscribe',
        (event) => seen.push(event),
        (payload) => seen.push(payload),
        (error) => rejected.push(error),
      );
      const staleHostHandler = sdkState.handlers.get(ATELIER_PROJECTION_EVENT_TOPIC);
      expect(staleHostHandler).toBeDefined();

      staleHostHandler?.(projectionEvent('evt-before-release'));
      release();
      release();
      staleHostHandler?.(projectionEvent('evt-after-release'));
      staleHostHandler?.({
        kind: 'atelier.projection.subscription-rejected',
        method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
        reason: 'late rejected official atelier.events.subscribe',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(sdkState.invoke).toHaveBeenCalledWith(ATELIER_PROJECTION_SUBSCRIPTION_METHOD, {
        agentId: 'agent-official-subscribe',
        taskId: 'task-official-subscribe',
        afterEventSeq: 3,
      });
      expect(sdkState.handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false);
      expect(sdkState.unsubscribe).toHaveBeenCalledTimes(1);
      expect(sdkState.unsubscribe).toHaveBeenCalledWith(ATELIER_PROJECTION_EVENT_TOPIC);
      expect(seen).toHaveLength(1);
      expect(JSON.stringify(seen[0])).toContain('evt-before-release');
      expect(JSON.stringify(seen)).not.toContain('evt-after-release');
      expect(rejected).toEqual([]);
      expect(unhandledRejections).toHaveLength(0);
      expect(warnings.filter((warning) => warning.includes('Atelier official projection event topic unsubscribe rejected'))).toHaveLength(1);
      expect(JSON.stringify({ seen, rejected })).not.toMatch(
        /provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/,
      );
    } finally {
      console.warn = originalWarn;
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
