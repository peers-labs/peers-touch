import { describe, expect, it } from 'vitest';

import type { AtelierRuntimeSnapshot, AtelierRuntimeStatus } from './runtime';
import {
  clonePrototypeBridgeRuntimeSnapshot,
  derivePrototypeBridgeCallStatusStart,
  shouldApplyPrototypeBridgeCallStatus,
  shouldApplyPrototypeBridgeSnapshotResponse,
} from './prototypeBridgeRuntimeCallPolicy';

function status(kind: AtelierRuntimeStatus['kind'], detail = kind): AtelierRuntimeStatus {
  return {
    kind,
    title: kind,
    detail,
    retryable: kind !== 'auth-denied',
  };
}

function snapshot(): AtelierRuntimeSnapshot {
  return {
    selectedTaskId: 'task-1',
    status: status('ready'),
    state: {
      budgetSpent: 0,
      budgetCap: 1,
      model: 'openrouter-3o',
      tasks: [{ id: 'task-1', project: 'atelier', title: 'Build Atelier', status: 'active' }],
      selectedTaskId: 'task-1',
      stream: {},
      todos: {},
      context: {},
      artifacts: {},
      gates: {},
    },
  };
}

describe('prototype bridge runtime call policy', () => {
  it('preserves the restorable status when a new Host call starts from loading', () => {
    const ready = status('ready', 'projection ready');
    const degraded = status('degraded', 'stale replay rejected');

    expect(derivePrototypeBridgeCallStatusStart({
      currentStatus: status('auth-denied', 'blocked'),
      activeRestorableStatus: undefined,
      readyStatus: ready,
    })).toMatchObject({
      previousStatus: { kind: 'auth-denied', detail: 'blocked' },
      nextActiveRestorableStatus: { kind: 'auth-denied', detail: 'blocked' },
    });

    expect(derivePrototypeBridgeCallStatusStart({
      currentStatus: status('loading', 'waiting'),
      activeRestorableStatus: degraded,
      readyStatus: ready,
    })).toMatchObject({
      previousStatus: { kind: 'degraded', detail: 'stale replay rejected' },
      nextActiveRestorableStatus: { kind: 'degraded', detail: 'stale replay rejected' },
    });

    expect(derivePrototypeBridgeCallStatusStart({
      currentStatus: undefined,
      activeRestorableStatus: undefined,
      readyStatus: ready,
    })).toMatchObject({
      previousStatus: { kind: 'ready', detail: 'projection ready' },
      nextActiveRestorableStatus: { kind: 'ready', detail: 'projection ready' },
    });
  });

  it('lets only the latest Host call on the current projection revision own status restoration or error display', () => {
    expect(shouldApplyPrototypeBridgeCallStatus({
      callStatusToken: 2,
      latestCallStatusToken: 2,
      projectionRevisionAtCall: 7,
      projectionRevision: 7,
    })).toBe(true);
    expect(shouldApplyPrototypeBridgeCallStatus({
      callStatusToken: 1,
      latestCallStatusToken: 2,
      projectionRevisionAtCall: 7,
      projectionRevision: 7,
    })).toBe(false);
    expect(shouldApplyPrototypeBridgeCallStatus({
      callStatusToken: 2,
      latestCallStatusToken: 2,
      projectionRevisionAtCall: 7,
      projectionRevision: 8,
    })).toBe(false);
  });

  it('ignores stale snapshot responses after newer snapshot calls or projection events', () => {
    expect(shouldApplyPrototypeBridgeSnapshotResponse({
      snapshotCallToken: 3,
      latestSnapshotCallToken: 3,
      projectionRevisionAtCall: 7,
      projectionRevision: 7,
    })).toBe(true);
    expect(shouldApplyPrototypeBridgeSnapshotResponse({
      snapshotCallToken: 2,
      latestSnapshotCallToken: 3,
      projectionRevisionAtCall: 7,
      projectionRevision: 7,
    })).toBe(false);
    expect(shouldApplyPrototypeBridgeSnapshotResponse({
      snapshotCallToken: 3,
      latestSnapshotCallToken: 3,
      projectionRevisionAtCall: 7,
      projectionRevision: 8,
    })).toBe(false);
  });

  it('clones runtime snapshots without sharing mutable projection buckets', () => {
    const original = snapshot();
    const cloned = clonePrototypeBridgeRuntimeSnapshot(original);
    cloned.state.tasks[0].title = 'Mutated clone';

    expect(original.state.tasks[0].title).toBe('Build Atelier');
    expect(JSON.stringify(cloned)).not.toMatch(/provider\.invoke|model\.run|cli\.execute|shell\.execute|file\.open|gate\.run|input_snapshot/);
  });

  it('keeps cloned snapshots isolated from source snapshot mutations after cloning', () => {
    const original = snapshot();
    const cloned = clonePrototypeBridgeRuntimeSnapshot(original);
    original.state.tasks[0].title = 'Host-mutated source';
    original.state.tasks.push({ id: 'task-2', project: 'atelier', title: 'Late host mutation', status: 'active' });
    original.status = status('degraded', 'late host mutation');

    expect(cloned.state.tasks).toHaveLength(1);
    expect(cloned.state.tasks[0].title).toBe('Build Atelier');
    expect(cloned.status?.kind).toBe('ready');
  });

  it('fails closed when a projected snapshot carries executable capability values', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        leakedHostCapability?: { shellExecute: () => void };
      };
    };
    original.state.leakedHostCapability = {
      shellExecute: () => undefined,
    };

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/not projection-cloneable|forbidden capability key/);
  });

  it('fails closed when a projected snapshot carries forbidden capability-shaped keys', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        hostCapabilities?: Record<string, unknown>;
      };
    };
    original.state.hostCapabilities = {
      'provider.invoke': { accepted: true },
    };

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/forbidden capability key provider\.invoke/);
  });

  it('fails closed when a projected snapshot carries nested forbidden capability paths', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        hostCapabilities?: Record<string, unknown>;
      };
    };
    original.state.hostCapabilities = {
      provider: {
        invoke: { accepted: true },
      },
    };

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/forbidden capability path .*provider\.invoke/);
  });

  it('keeps read-only provider projection display fields cloneable', () => {
    const original = snapshot();
    original.state.tasks[0].providerStrategyPreset = 'station-provider:review';

    expect(clonePrototypeBridgeRuntimeSnapshot(original).state.tasks[0].providerStrategyPreset).toBe('station-provider:review');
  });

  it('fails closed when a projected snapshot carries non-plain projection objects', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        hostState?: unknown;
      };
    };
    original.state.hostState = new Map([['provider.invoke', true]]);

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/non-plain projection object/);
  });

  it('fails closed when a projected snapshot carries date-like runtime objects', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        hostState?: unknown;
      };
    };
    original.state.hostState = new Date('2026-07-08T00:00:00.000Z');

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/non-plain projection object/);
  });

  it('keeps null-prototype projection dictionaries cloneable', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        projectionDictionary?: Record<string, unknown>;
      };
    };
    original.state.projectionDictionary = Object.assign(Object.create(null), {
      displayOnly: true,
    });

    expect(clonePrototypeBridgeRuntimeSnapshot(original).state.projectionDictionary).toEqual({
      displayOnly: true,
    });
  });

  it('fails closed when a projected snapshot carries prototype pollution keys', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        hostState?: Record<string, unknown>;
      };
    };
    original.state.hostState = {};
    Object.defineProperty(original.state.hostState, '__proto__', {
      enumerable: true,
      value: { polluted: true },
    });

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/forbidden prototype pollution key __proto__/);
  });

  it('fails closed when a projected snapshot carries nested prototype pollution keys', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        hostState?: Record<string, unknown>;
      };
    };
    original.state.hostState = {
      constructor: {
        prototype: { polluted: true },
      },
    };

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/forbidden prototype pollution key constructor/);
  });

  it('fails closed when a projected snapshot carries symbol-keyed properties', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        hostState?: Record<string | symbol, unknown>;
      };
    };
    original.state.hostState = {};
    original.state.hostState[Symbol.for('provider.invoke')] = { accepted: true };

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/symbol-keyed projection property/);
  });

  it('fails closed when a projected snapshot carries non-enumerable properties', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        hostState?: Record<string, unknown>;
      };
    };
    original.state.hostState = {};
    Object.defineProperty(original.state.hostState, 'hiddenProviderInvoke', {
      enumerable: false,
      value: { accepted: true },
    });

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/non-enumerable projection property hiddenProviderInvoke/);
  });

  it('fails closed when a projected snapshot carries accessor getter properties', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        hostState?: Record<string, unknown>;
      };
    };
    original.state.hostState = {};
    Object.defineProperty(original.state.hostState, 'providerInvoke', {
      enumerable: true,
      get: () => ({ accepted: true }),
    });

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/accessor projection property providerInvoke/);
  });

  it('fails closed when a projected snapshot carries accessor setter properties', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        hostState?: Record<string, unknown>;
      };
    };
    original.state.hostState = {};
    Object.defineProperty(original.state.hostState, 'providerInvoke', {
      enumerable: true,
      set: () => undefined,
    });

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/accessor projection property providerInvoke/);
  });

  it('fails closed when a projected snapshot carries undefined projection array values', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        optionalRuntimeArray?: unknown[];
      };
    };
    original.state.optionalRuntimeArray = [undefined];

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/undefined projection array value/);
  });

  it('fails closed when a projected snapshot carries sparse projection array holes', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        optionalRuntimeArray?: unknown[];
      };
    };
    original.state.optionalRuntimeArray = new Array(1);

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/sparse projection array hole/);
  });

  it('keeps dense projection arrays cloneable', () => {
    const original = snapshot();
    original.state.tasks.push({ id: 'task-2', project: 'atelier', title: 'Dense task', status: 'active' });

    expect(clonePrototypeBridgeRuntimeSnapshot(original).state.tasks).toHaveLength(2);
  });

  it('keeps registered optional undefined projection object fields omittable', () => {
    const original = snapshot();
    original.status = undefined;
    original.state.projects = undefined;

    const cloned = clonePrototypeBridgeRuntimeSnapshot(original);
    expect(cloned).not.toHaveProperty('status');
    expect(cloned.state).not.toHaveProperty('projects');
  });

  it('fails closed when a required projection object field is undefined', () => {
    const original = snapshot();
    (original.state as Record<string, unknown>).model = undefined;

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/unregistered undefined projection object field .*model/);
  });

  it('fails closed when an unregistered projection object field is undefined', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        optionalRuntimeField?: unknown;
      };
    };
    original.state.optionalRuntimeField = undefined;

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/unregistered undefined projection object field .*optionalRuntimeField/);
  });

  it('fails closed when a projected snapshot carries non-finite projection numbers', () => {
    const original = snapshot();
    original.state.budgetSpent = Number.NaN;

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/non-finite projection number/);

    original.state.budgetSpent = Infinity;
    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/non-finite projection number/);
  });

  it('keeps finite projection numbers cloneable', () => {
    const original = snapshot();
    original.state.budgetSpent = 2048;

    expect(clonePrototypeBridgeRuntimeSnapshot(original).state.budgetSpent).toBe(2048);
  });

  it('fails closed when a projected snapshot carries circular projection references', () => {
    const original = snapshot() as AtelierRuntimeSnapshot & {
      state: AtelierRuntimeSnapshot['state'] & {
        circular?: unknown;
      };
    };
    original.state.circular = original.state;

    expect(() => clonePrototypeBridgeRuntimeSnapshot(original)).toThrow(/circular projection reference/);
  });
});
