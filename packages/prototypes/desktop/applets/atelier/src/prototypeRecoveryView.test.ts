import { describe, expect, it } from 'vitest';
import { ATELIER_VIEW_STATUSES, ATELIER_VIEW_SURFACE } from './projection.contract.generated';
import {
  ATELIER_PROTOTYPE_STATUS_SCENARIOS,
  buildPrototypeBridgeAuthDeniedStatus,
  buildPrototypeBridgeDegradedStatus,
  buildPrototypeBridgeDisconnectedStatus,
  buildPrototypeBridgeErrorStatus,
  buildPrototypeBridgeEventStatus,
  buildPrototypeBridgeLoadingStatus,
  buildPrototypeBridgeReconcilingStatus,
  buildPrototypeBridgeStatusFromError,
  buildPrototypeRuntimeReadyStatus,
  derivePrototypePageSurface,
  derivePrototypeRecoveryView,
  derivePrototypeStatusActionPolicy,
  isPrototypeStatusActionPolicyConsistent,
  prototypeBridgeRecoveryKindFromError,
  prototypeStatusForScenario,
  resolvePrototypeStatusScenario,
} from './prototypeRecoveryView';

describe('prototype status scenarios', () => {
  it('derives the controlled scenario list from generated view statuses', () => {
    expect(ATELIER_PROTOTYPE_STATUS_SCENARIOS).toEqual(ATELIER_VIEW_STATUSES);
  });

  it('resolves only generated status scenarios from the URL query', () => {
    expect(resolvePrototypeStatusScenario('?atelierStatus=auth-denied')).toBe('auth-denied');
    expect(resolvePrototypeStatusScenario('?atelierStatus=disconnected')).toBe('disconnected');
    expect(resolvePrototypeStatusScenario('?atelierStatus=run')).toBeUndefined();
    expect(resolvePrototypeStatusScenario('?atelierStatus=shell')).toBeUndefined();
  });

  it('creates one runtime status fixture for every generated view status', () => {
    const statuses = ATELIER_VIEW_STATUSES.map((status) => prototypeStatusForScenario(status));
    expect(statuses.map((status) => status.kind)).toEqual(ATELIER_VIEW_STATUSES);
    expect(statuses.find((status) => status.kind === 'disconnected')).toMatchObject({
      kind: 'disconnected',
      retryable: true,
    });
    expect(statuses.find((status) => status.kind === 'auth-denied')).toMatchObject({
      kind: 'auth-denied',
      retryable: false,
    });
    expect(statuses.find((status) => status.kind === 'degraded')).toMatchObject({
      kind: 'degraded',
      lastEventSeq: 7,
    });
  });
});

describe('buildPrototypeRuntimeReadyStatus', () => {
  it('uses the generated empty status copy when no task projection exists', () => {
    const status = buildPrototypeRuntimeReadyStatus({ tasks: [] });

    expect(status).toEqual(prototypeStatusForScenario('empty'));
    expect(JSON.stringify(status)).not.toMatch(/provider\.invoke|runtime\.execute|shell|input_snapshot|retry/);
  });

  it('uses the generated ready status copy when at least one task projection exists', () => {
    const status = buildPrototypeRuntimeReadyStatus({
      tasks: [{ id: 'task-1', project: 'demo', title: 'Demo task', status: 'active' }],
    });

    expect(status).toEqual(prototypeStatusForScenario('ready'));
    expect(JSON.stringify(status)).not.toMatch(/provider\.invoke|runtime\.execute|shell|input_snapshot|retry/);
  });
});

describe('bridge runtime status builders', () => {
  it('builds loading, ready, reconciling, and degraded status from generated bridge copy', () => {
    const copy = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind;

    expect(buildPrototypeBridgeLoadingStatus()).toEqual({
      kind: 'loading',
      title: copy.loading.title,
      detail: copy.loading.detail,
    });
    expect(buildPrototypeBridgeEventStatus(42)).toEqual({
      kind: 'ready',
      title: copy.ready.title,
      detail: copy.ready.detail,
      lastEventSeq: 42,
    });
    expect(buildPrototypeBridgeReconcilingStatus()).toEqual({
      kind: 'reconciling',
      title: copy.reconciling.title,
      detail: copy.reconciling.detail,
    });
    expect(buildPrototypeBridgeDegradedStatus(7)).toEqual({
      kind: 'degraded',
      title: copy.degraded.title,
      detail: copy.degraded.detail,
      retryable: true,
      lastEventSeq: 7,
    });
  });

  it('builds disconnected/auth-denied/error recovery statuses without execution payloads', () => {
    const copy = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind;
    const statuses = [
      buildPrototypeBridgeAuthDeniedStatus(),
      buildPrototypeBridgeDisconnectedStatus(),
      buildPrototypeBridgeErrorStatus('malformed projection event'),
      buildPrototypeBridgeErrorStatus(''),
    ];

    expect(statuses).toEqual([
      {
        kind: 'auth-denied',
        title: copy['auth-denied'].title,
        detail: copy['auth-denied'].detail,
        retryable: false,
      },
      {
        kind: 'disconnected',
        title: copy.disconnected.title,
        detail: copy.disconnected.detail,
        retryable: true,
      },
      {
        kind: 'error',
        title: copy.error.title,
        detail: 'malformed projection event',
        retryable: true,
      },
      {
        kind: 'error',
        title: copy.error.title,
        detail: copy.error.detail,
        retryable: true,
      },
    ]);
    expect(JSON.stringify(statuses)).not.toMatch(/provider\.invoke|runtime\.execute|shell|input_snapshot|memory\.write|rerun/);
  });

  it('classifies structured Host error codes before legacy message fallback', () => {
    expect(prototypeBridgeRecoveryKindFromError({ code: 'PERMISSION_DENIED' })).toBe('auth-denied');
    expect(prototypeBridgeRecoveryKindFromError({ code: 'connection_closed' })).toBe('disconnected');
    expect(prototypeBridgeRecoveryKindFromError(Object.assign(new Error('opaque'), {
      cause: { error: { code: 'FORBIDDEN' } },
    }))).toBe('auth-denied');
    expect(prototypeBridgeRecoveryKindFromError({
      error: { code: 'STREAM_DISCONNECTED', message: 'stream closed without legacy keyword' },
    })).toBe('disconnected');
    expect(prototypeBridgeRecoveryKindFromError({ code: 'SOME_UNKNOWN_CODE' })).toBeUndefined();

    expect(buildPrototypeBridgeStatusFromError({ code: 'PERMISSION_DENIED' })).toMatchObject({
      kind: 'auth-denied',
      retryable: false,
    });
    expect(buildPrototypeBridgeStatusFromError({ code: 'CONNECTION_CLOSED' })).toMatchObject({
      kind: 'disconnected',
      retryable: true,
    });
    expect(buildPrototypeBridgeStatusFromError({
      error: { code: 'PERMISSION_DENIED', message: 'Access rejected without legacy keyword' },
    })).toMatchObject({
      kind: 'auth-denied',
      retryable: false,
    });
    expect(buildPrototypeBridgeStatusFromError({ code: 'SOME_UNKNOWN_CODE' })).toMatchObject({
      kind: 'error',
      retryable: true,
    });
  });

  it('uses legacy message fallback only when structured recovery code is absent', () => {
    expect(buildPrototypeBridgeStatusFromError(new Error('PERMISSION_DENIED unauthorized'))).toMatchObject({
      kind: 'auth-denied',
      retryable: false,
    });
    expect(buildPrototypeBridgeStatusFromError(new Error('network stream disconnected'))).toMatchObject({
      kind: 'disconnected',
      retryable: true,
    });
    expect(buildPrototypeBridgeStatusFromError(new Error('malformed projection event'))).toMatchObject({
      kind: 'error',
      detail: 'malformed projection event',
      retryable: true,
    });
  });
});

describe('derivePrototypeRecoveryView', () => {
  it('uses generated severity and symbol taxonomy for stable prototype visuals', () => {
    expect(derivePrototypeRecoveryView(prototypeStatusForScenario('loading'))).toEqual({
      severity: 'info',
      symbol: '◌',
      retryVisible: false,
    });
    expect(derivePrototypeRecoveryView(prototypeStatusForScenario('ready'))).toEqual({
      severity: 'info',
      symbol: '✓',
      retryVisible: false,
    });
    expect(derivePrototypeRecoveryView(prototypeStatusForScenario('auth-denied'))).toEqual({
      severity: 'danger',
      symbol: '!',
      retryVisible: false,
    });
  });

  it('shows retry only when runtime retryable and generated retry taxonomy agree', () => {
    expect(derivePrototypeRecoveryView(prototypeStatusForScenario('disconnected'))).toMatchObject({
      retryVisible: true,
    });
    expect(derivePrototypeRecoveryView(prototypeStatusForScenario('error'))).toMatchObject({
      retryVisible: true,
    });
    expect(derivePrototypeRecoveryView({ ...prototypeStatusForScenario('disconnected'), retryable: false })).toMatchObject({
      retryVisible: false,
    });
    expect(derivePrototypeRecoveryView({ ...prototypeStatusForScenario('auth-denied'), retryable: true })).toMatchObject({
      retryVisible: false,
    });
  });
});

describe('derivePrototypePageSurface', () => {
  it('uses ready/no-stream as the only implicit empty affordance', () => {
    expect(derivePrototypePageSurface({ status: prototypeStatusForScenario('ready'), streamLength: 0 })).toEqual({
      recoveryStatus: undefined,
      emptyVisible: true,
      streamVisible: false,
    });
    expect(derivePrototypePageSurface({ status: prototypeStatusForScenario('empty'), streamLength: 0 })).toMatchObject({
      recoveryStatus: prototypeStatusForScenario('empty'),
      emptyVisible: false,
      streamVisible: false,
    });
  });

  it('lets loading own the page and preserves stream for non-loading recovery states', () => {
    expect(derivePrototypePageSurface({ status: prototypeStatusForScenario('loading'), streamLength: 3 })).toMatchObject({
      recoveryStatus: prototypeStatusForScenario('loading'),
      emptyVisible: false,
      streamVisible: false,
    });
    expect(derivePrototypePageSurface({ status: prototypeStatusForScenario('auth-denied'), streamLength: 3 })).toMatchObject({
      recoveryStatus: prototypeStatusForScenario('auth-denied'),
      emptyVisible: false,
      streamVisible: true,
    });
    expect(derivePrototypePageSurface({ status: prototypeStatusForScenario('degraded'), streamLength: 3 })).toMatchObject({
      recoveryStatus: prototypeStatusForScenario('degraded'),
      emptyVisible: false,
      streamVisible: true,
    });
  });

  it('keeps retryable recovery surfaces above implicit empty affordance', () => {
    expect(derivePrototypePageSurface({ status: prototypeStatusForScenario('disconnected'), streamLength: 0 })).toMatchObject({
      recoveryStatus: prototypeStatusForScenario('disconnected'),
      emptyVisible: false,
      streamVisible: false,
    });
    expect(derivePrototypeRecoveryView(prototypeStatusForScenario('disconnected'))).toMatchObject({
      retryVisible: true,
      severity: 'warning',
    });
    expect(derivePrototypePageSurface({ status: prototypeStatusForScenario('error'), streamLength: 0 })).toMatchObject({
      recoveryStatus: prototypeStatusForScenario('error'),
      emptyVisible: false,
      streamVisible: false,
    });
    expect(derivePrototypeRecoveryView(prototypeStatusForScenario('error'))).toMatchObject({
      retryVisible: true,
      severity: 'danger',
    });
  });

  it('covers every generated view status in the page surface matrix', () => {
    const expectedForStatus = (status: (typeof ATELIER_VIEW_STATUSES)[number], streamLength: number) => {
      if (status === 'ready') {
        return {
          recoveryKind: undefined,
          emptyVisible: streamLength === 0,
          streamVisible: streamLength > 0,
        };
      }
      return {
        recoveryKind: status,
        emptyVisible: false,
        streamVisible: streamLength > 0 && status !== 'loading',
      };
    };

    for (const streamLength of [0, 2]) {
      const coveredStatuses: string[] = [];
      for (const status of ATELIER_VIEW_STATUSES) {
        const surface = derivePrototypePageSurface({ status: prototypeStatusForScenario(status), streamLength });
        const expected = expectedForStatus(status, streamLength);

        coveredStatuses.push(status);
        expect(surface.recoveryStatus?.kind).toBe(expected.recoveryKind);
        expect(surface.emptyVisible).toBe(expected.emptyVisible);
        expect(surface.streamVisible).toBe(expected.streamVisible);
        expect(surface.emptyVisible && surface.streamVisible).toBe(false);
        expect(surface.emptyVisible && Boolean(surface.recoveryStatus)).toBe(false);
        if (status === 'loading') {
          expect(surface.streamVisible).toBe(false);
        }
      }
      expect(coveredStatuses).toEqual([...ATELIER_VIEW_STATUSES]);
    }
  });

  it('derives create, retry, and no-action policy from prototype page surface', () => {
    expect(derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario('ready'), streamLength: 0 })).toEqual({
      primaryAction: 'create-project',
      createProjectVisible: true,
      retryVisible: false,
    });
    expect(derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario('empty'), streamLength: 0 })).toEqual({
      primaryAction: 'create-project',
      createProjectVisible: true,
      retryVisible: false,
    });
    expect(derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario('loading'), streamLength: 2 })).toEqual({
      primaryAction: 'none',
      createProjectVisible: false,
      retryVisible: false,
    });
    expect(derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario('auth-denied'), streamLength: 2 })).toEqual({
      primaryAction: 'none',
      createProjectVisible: false,
      retryVisible: false,
    });
    expect(derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario('disconnected'), streamLength: 2 })).toEqual({
      primaryAction: 'retry',
      createProjectVisible: false,
      retryVisible: true,
    });
    expect(derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario('error'), streamLength: 0 })).toEqual({
      primaryAction: 'retry',
      createProjectVisible: false,
      retryVisible: true,
    });
    expect(derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario('degraded'), streamLength: 2 })).toEqual({
      primaryAction: 'none',
      createProjectVisible: false,
      retryVisible: false,
    });
    for (const policy of [
      derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario('ready'), streamLength: 0 }),
      derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario('disconnected'), streamLength: 2 }),
      derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario('auth-denied'), streamLength: 2 }),
    ]) {
      expect(Object.keys(policy).sort()).toEqual(['createProjectVisible', 'primaryAction', 'retryVisible']);
      expect(isPrototypeStatusActionPolicyConsistent(policy)).toBe(true);
      expect(JSON.stringify(policy)).not.toMatch(/provider\.invoke|gate\.run|artifact\.write|trace\.write|checkpoint\.write|resume\.execute|memory\.write|input_snapshot|shell|file\.write|run\.execute/);
    }
    expect(isPrototypeStatusActionPolicyConsistent({ primaryAction: 'create-project', createProjectVisible: false, retryVisible: false })).toBe(false);
    expect(isPrototypeStatusActionPolicyConsistent({ primaryAction: 'retry', createProjectVisible: true, retryVisible: true })).toBe(false);
    expect(isPrototypeStatusActionPolicyConsistent({ primaryAction: 'none', createProjectVisible: false, retryVisible: true })).toBe(false);
  });

  it('covers every generated view status in the action policy matrix', () => {
    const expectedForStatus = (status: (typeof ATELIER_VIEW_STATUSES)[number], streamLength: number) => {
      if (status === 'empty' || (status === 'ready' && streamLength === 0)) {
        return { primaryAction: 'create-project', createProjectVisible: true, retryVisible: false };
      }
      if (status === 'disconnected' || status === 'error') {
        return { primaryAction: 'retry', createProjectVisible: false, retryVisible: true };
      }
      return { primaryAction: 'none', createProjectVisible: false, retryVisible: false };
    };

    for (const streamLength of [0, 2]) {
      const coveredStatuses: string[] = [];
      for (const status of ATELIER_VIEW_STATUSES) {
        const policy = derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario(status), streamLength });
        coveredStatuses.push(status);
        expect(policy).toEqual(expectedForStatus(status, streamLength));
        expect(isPrototypeStatusActionPolicyConsistent(policy)).toBe(true);
      }
      expect(coveredStatuses).toEqual([...ATELIER_VIEW_STATUSES]);
    }
  });
});
