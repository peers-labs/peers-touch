import { describe, expect, it } from 'vitest';
import {
  ATELIER_DEGRADED_EVENT_STREAM_STATES,
  ATELIER_RECOVERY_RETRYABLE_KINDS,
  ATELIER_RECOVERY_TONE_BY_KIND,
  ATELIER_RECONCILING_EVENT_STREAM_STATE,
  ATELIER_STATUS_LABEL_KEY_BY_STATUS,
  ATELIER_STATUS_NOTICE_KINDS,
  ATELIER_TYPED_RECOVERY_KINDS,
  ATELIER_VIEW_STATUSES,
  ATELIER_VIEW_SURFACE,
} from '../domain/projection.contract.generated';
import type { AtelierErrorKind } from '../infrastructure/capability/atelierClient';
import { deriveOfficialCenteredStateView, type OfficialCenteredStateKind } from './centeredStateView';
import { nextAtelierEventStreamRetryDelayMs } from './eventStreamRecovery';
import { deriveOfficialRecoveryView, deriveOfficialStatusActionPolicy, isOfficialStatusActionPolicyConsistent } from './officialRecoveryView';
import { deriveAtelierPageSurface } from './pageComposition';
import { deriveOfficialStatusNoticeView } from './statusNoticeView';
import { deriveOfficialStatusPillView } from './statusPillView';
import { deriveAtelierViewStatus, type AtelierViewStatusInput } from './viewStatus';

const baseStatusInput = {
  loading: false,
  error: '',
  errorKind: '',
  eventStreamErrorKind: '',
  eventStreamState: 'idle',
  taskCount: 1,
  replayHasMore: false,
} satisfies AtelierViewStatusInput;

describe('deriveAtelierViewStatus', () => {
  it('keeps loading as the top-level state', () => {
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        loading: true,
        errorKind: 'auth-denied',
        error: 'stale error',
        taskCount: 0,
      }),
    ).toBe('loading');
  });

  it('keeps loading above typed recovery, stream degradation, replay, and empty states', () => {
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        loading: true,
        eventStreamErrorKind: 'disconnected',
        eventStreamState: ATELIER_DEGRADED_EVENT_STREAM_STATES[0],
        replayHasMore: true,
        taskCount: 0,
      }),
    ).toBe('loading');
  });

  it('keeps empty below typed recovery, reconciling, and degraded stream states', () => {
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        errorKind: 'auth-denied',
        taskCount: 0,
      }),
    ).toBe('auth-denied');
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        eventStreamErrorKind: 'disconnected',
        taskCount: 0,
      }),
    ).toBe('disconnected');
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        eventStreamState: ATELIER_RECONCILING_EVENT_STREAM_STATE,
        taskCount: 0,
      }),
    ).toBe('reconciling');
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        eventStreamState: ATELIER_DEGRADED_EVENT_STREAM_STATES[0],
        taskCount: 0,
      }),
    ).toBe('degraded');
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        replayHasMore: true,
        taskCount: 0,
      }),
    ).toBe('degraded');
  });

  it('maps typed recovery before generic errors', () => {
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        errorKind: 'auth-denied',
        error: 'permission denied',
      }),
    ).toBe('auth-denied');
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        eventStreamErrorKind: 'disconnected',
        error: 'stream closed',
      }),
    ).toBe('disconnected');
  });

  it('distinguishes generic error, reconciling, degraded, empty, and ready states', () => {
    expect(deriveAtelierViewStatus({ ...baseStatusInput, error: 'invalid projection' })).toBe('error');
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        eventStreamState: ATELIER_RECONCILING_EVENT_STREAM_STATE,
      }),
    ).toBe('reconciling');
    expect(
      deriveAtelierViewStatus({
        ...baseStatusInput,
        eventStreamState: ATELIER_DEGRADED_EVENT_STREAM_STATES[0],
      }),
    ).toBe('degraded');
    expect(deriveAtelierViewStatus({ ...baseStatusInput, replayHasMore: true })).toBe('degraded');
    expect(deriveAtelierViewStatus({ ...baseStatusInput, taskCount: 0 })).toBe('empty');
    expect(deriveAtelierViewStatus(baseStatusInput)).toBe('ready');
  });
});

describe('deriveAtelierPageSurface', () => {
  it('renders centered loading and empty states without main content', () => {
    expect(
      deriveAtelierPageSurface({
        error: '',
        loading: true,
        taskCount: 0,
        viewStatus: 'loading',
      }),
    ).toMatchObject({
      globalErrorVisible: false,
      loadingVisible: true,
      emptyVisible: false,
      mainContentVisible: false,
    });
    expect(
      deriveAtelierPageSurface({
        error: '',
        loading: true,
        taskCount: 1,
        viewStatus: 'degraded',
      }),
    ).toMatchObject({
      typedRecoveryKind: '',
      statusNotice: '',
      loadingVisible: true,
      emptyVisible: false,
      mainContentVisible: false,
    });
    expect(
      deriveAtelierPageSurface({
        error: '',
        loading: false,
        taskCount: 0,
        viewStatus: 'empty',
      }),
    ).toMatchObject({
      typedRecoveryKind: '',
      statusNotice: '',
      loadingVisible: false,
      emptyVisible: true,
      mainContentVisible: false,
    });
  });

  it('keeps empty CTA hidden behind recovery and status surfaces', () => {
    expect(
      deriveAtelierPageSurface({
        error: '',
        loading: false,
        taskCount: 0,
        viewStatus: 'disconnected',
      }),
    ).toMatchObject({
      typedRecoveryKind: 'disconnected',
      statusNotice: '',
      emptyVisible: false,
      mainContentVisible: false,
    });
    expect(
      deriveAtelierPageSurface({
        error: '',
        loading: false,
        taskCount: 0,
        viewStatus: 'degraded',
      }),
    ).toMatchObject({
      typedRecoveryKind: '',
      statusNotice: 'degraded',
      emptyVisible: false,
      mainContentVisible: false,
    });
  });

  it('keeps auth-denied empty workspaces on the non-retryable recovery surface', () => {
    expect(
      deriveAtelierPageSurface({
        error: '',
        loading: false,
        taskCount: 0,
        viewStatus: 'auth-denied',
      }),
    ).toMatchObject({
      typedRecoveryKind: 'auth-denied',
      statusNotice: '',
      emptyVisible: false,
      mainContentVisible: false,
    });
    expect(deriveOfficialRecoveryView('auth-denied')).toMatchObject({
      retryVisible: false,
      tone: 'danger',
    });
  });

  it('keeps disconnected empty workspaces on the retryable recovery surface', () => {
    expect(
      deriveAtelierPageSurface({
        error: '',
        loading: false,
        taskCount: 0,
        viewStatus: 'disconnected',
      }),
    ).toMatchObject({
      typedRecoveryKind: 'disconnected',
      statusNotice: '',
      emptyVisible: false,
      mainContentVisible: false,
    });
    expect(deriveOfficialRecoveryView('disconnected')).toMatchObject({
      retryVisible: true,
      tone: 'warning',
    });
  });

  it('keeps recovery and status notices projection-only while preserving visible content', () => {
    expect(
      deriveAtelierPageSurface({
        error: '',
        loading: false,
        taskCount: 1,
        viewStatus: 'auth-denied',
      }),
    ).toMatchObject({
      typedRecoveryKind: 'auth-denied',
      statusNotice: '',
      mainContentVisible: true,
    });
    expect(
      deriveAtelierPageSurface({
        error: '',
        loading: false,
        taskCount: 1,
        viewStatus: 'degraded',
      }),
    ).toMatchObject({
      typedRecoveryKind: '',
      statusNotice: 'degraded',
      mainContentVisible: true,
    });
  });

  it('lets global errors own the surface', () => {
    expect(
      deriveAtelierPageSurface({
        error: 'malformed response',
        loading: false,
        taskCount: 1,
        viewStatus: 'ready',
      }),
    ).toMatchObject({
      globalErrorVisible: true,
      typedRecoveryKind: '',
      statusNotice: '',
      loadingVisible: false,
      emptyVisible: false,
      mainContentVisible: false,
    });
  });

  it('keeps global errors above loading, recovery, and empty surfaces', () => {
    expect(
      deriveAtelierPageSurface({
        error: 'host returned malformed projection',
        loading: true,
        taskCount: 0,
        viewStatus: 'auth-denied',
      }),
    ).toMatchObject({
      globalErrorVisible: true,
      typedRecoveryKind: '',
      statusNotice: '',
      loadingVisible: false,
      emptyVisible: false,
      mainContentVisible: false,
    });
  });

  it('covers every generated view status in the official page surface matrix', () => {
    const typedRecoveryKinds = ATELIER_TYPED_RECOVERY_KINDS as readonly string[];
    const statusNoticeKinds = ATELIER_STATUS_NOTICE_KINDS as readonly string[];
    const expectedForStatus = (viewStatus: (typeof ATELIER_VIEW_STATUSES)[number], taskCount: number) => {
      const loading = viewStatus === 'loading';
      return {
        globalErrorVisible: false,
        typedRecoveryKind: !loading && typedRecoveryKinds.includes(viewStatus) ? viewStatus : '',
        statusNotice: !loading && statusNoticeKinds.includes(viewStatus) ? viewStatus : '',
        loadingVisible: loading,
        emptyVisible: !loading && taskCount === 0 && viewStatus === 'empty',
        mainContentVisible: !loading && taskCount > 0,
      };
    };

    for (const taskCount of [0, 1]) {
      const coveredStatuses: string[] = [];
      for (const viewStatus of ATELIER_VIEW_STATUSES) {
        const surface = deriveAtelierPageSurface({
          error: '',
          loading: viewStatus === 'loading',
          taskCount,
          viewStatus,
        });
        const expected = expectedForStatus(viewStatus, taskCount);

        coveredStatuses.push(viewStatus);
        expect(surface).toEqual(expected);
        expect(surface.emptyVisible && surface.loadingVisible).toBe(false);
        expect(surface.emptyVisible && Boolean(surface.typedRecoveryKind)).toBe(false);
        expect(surface.emptyVisible && Boolean(surface.statusNotice)).toBe(false);
        expect(surface.loadingVisible && surface.mainContentVisible).toBe(false);
      }
      expect(coveredStatuses).toEqual([...ATELIER_VIEW_STATUSES]);
    }
  });
});

describe('official recovery/status views', () => {
  it('makes disconnected retryable but auth-denied non-retryable', () => {
    expect(deriveOfficialRecoveryView('disconnected')).toMatchObject({
      tone: 'warning',
      retryVisible: true,
      titleKey: 'atelier.error.disconnectedTitle',
    });
    expect(deriveOfficialRecoveryView('auth-denied')).toMatchObject({
      tone: 'danger',
      retryVisible: false,
      titleKey: 'atelier.error.authDeniedTitle',
    });
  });

  it('covers every generated recovery kind in the official recovery view matrix', () => {
    const retryableKinds = ATELIER_RECOVERY_RETRYABLE_KINDS as readonly string[];
    const recoveryKinds = Object.keys(ATELIER_VIEW_SURFACE.recovery.labelKeyByKind) as AtelierErrorKind[];

    for (const recoveryKind of recoveryKinds) {
      expect(deriveOfficialRecoveryView(recoveryKind)).toEqual({
        tone: ATELIER_RECOVERY_TONE_BY_KIND[recoveryKind],
        retryVisible: retryableKinds.includes(recoveryKind),
        ...ATELIER_VIEW_SURFACE.recovery.labelKeyByKind[recoveryKind],
      });
    }
    expect(recoveryKinds.sort()).toEqual(Object.keys(ATELIER_VIEW_SURFACE.recovery.labelKeyByKind).sort());
    expect(recoveryKinds.filter((kind) => deriveOfficialRecoveryView(kind).retryVisible).sort()).toEqual([...ATELIER_RECOVERY_RETRYABLE_KINDS].sort());
    expect(deriveOfficialRecoveryView('')).toEqual({
      tone: ATELIER_RECOVERY_TONE_BY_KIND.error,
      retryVisible: false,
      titleKey: 'atelier.status.error',
    });
  });

  it('uses generated status pill severity and labels', () => {
    expect(deriveOfficialStatusPillView('ready')).toEqual({
      tone: 'success',
      labelKey: 'atelier.status.ready',
    });
    expect(deriveOfficialStatusPillView('auth-denied')).toEqual({
      tone: 'danger',
      labelKey: 'atelier.status.authDenied',
    });
  });

  it('covers every generated view status in the official status pill matrix', () => {
    const coveredStatuses: string[] = [];
    for (const viewStatus of ATELIER_VIEW_STATUSES) {
      coveredStatuses.push(viewStatus);
      expect(deriveOfficialStatusPillView(viewStatus)).toEqual({
        tone: ATELIER_VIEW_SURFACE.recovery.statusSeverityByStatus[viewStatus],
        labelKey: ATELIER_STATUS_LABEL_KEY_BY_STATUS[viewStatus],
      });
    }
    expect(coveredStatuses).toEqual([...ATELIER_VIEW_STATUSES]);
    expect(Object.keys(ATELIER_VIEW_SURFACE.recovery.statusSeverityByStatus).sort()).toEqual([...ATELIER_VIEW_STATUSES].sort());
    expect(Object.keys(ATELIER_STATUS_LABEL_KEY_BY_STATUS).sort()).toEqual([...ATELIER_VIEW_STATUSES].sort());
  });

  it('covers every generated status notice kind in the official status notice matrix', () => {
    const coveredStatuses: string[] = [];
    for (const statusNoticeKind of ATELIER_STATUS_NOTICE_KINDS) {
      coveredStatuses.push(statusNoticeKind);
      expect(deriveOfficialStatusNoticeView(statusNoticeKind)).toEqual(
        ATELIER_VIEW_SURFACE.statusNoticeLabelKeyByStatus[statusNoticeKind],
      );
    }
    expect(coveredStatuses).toEqual([...ATELIER_STATUS_NOTICE_KINDS]);
    expect(Object.keys(ATELIER_VIEW_SURFACE.statusNoticeLabelKeyByStatus).sort()).toEqual([...ATELIER_STATUS_NOTICE_KINDS].sort());
  });

  it('covers every generated centered state kind in the official centered state matrix', () => {
    const centeredStateKinds = Object.keys(ATELIER_VIEW_SURFACE.centeredStateLabelKeyByStatus) as OfficialCenteredStateKind[];
    const coveredStatuses: string[] = [];
    for (const centeredStateKind of centeredStateKinds) {
      coveredStatuses.push(centeredStateKind);
      expect(deriveOfficialCenteredStateView(centeredStateKind)).toEqual(
        ATELIER_VIEW_SURFACE.centeredStateLabelKeyByStatus[centeredStateKind],
      );
    }
    expect(coveredStatuses.sort()).toEqual(['empty', 'loading']);
    expect(Object.keys(ATELIER_VIEW_SURFACE.centeredStateLabelKeyByStatus).sort()).toEqual(['empty', 'loading']);
  });

  it('derives create, retry, and no-action policy from the page surface', () => {
    const policyInput = {
      error: '',
      errorKind: '',
      loading: false,
      taskCount: 0,
      viewStatus: 'empty',
    } as const;

    expect(deriveOfficialStatusActionPolicy(policyInput)).toEqual({
      primaryAction: 'create-project',
      createProjectVisible: true,
      retryVisible: false,
    });
    expect(deriveOfficialStatusActionPolicy({ ...policyInput, loading: true, viewStatus: 'loading' })).toEqual({
      primaryAction: 'none',
      createProjectVisible: false,
      retryVisible: false,
    });
    expect(deriveOfficialStatusActionPolicy({ ...policyInput, viewStatus: 'auth-denied' })).toEqual({
      primaryAction: 'none',
      createProjectVisible: false,
      retryVisible: false,
    });
    expect(deriveOfficialStatusActionPolicy({ ...policyInput, viewStatus: 'disconnected' })).toEqual({
      primaryAction: 'retry',
      createProjectVisible: false,
      retryVisible: true,
    });
    expect(deriveOfficialStatusActionPolicy({
      ...policyInput,
      error: 'stream closed',
      errorKind: 'disconnected',
      taskCount: 1,
      viewStatus: 'ready',
    })).toEqual({
      primaryAction: 'retry',
      createProjectVisible: false,
      retryVisible: true,
    });
    expect(deriveOfficialStatusActionPolicy({
      ...policyInput,
      error: 'permission denied',
      errorKind: 'auth-denied',
      taskCount: 1,
      viewStatus: 'ready',
    })).toEqual({
      primaryAction: 'none',
      createProjectVisible: false,
      retryVisible: false,
    });
    for (const policy of [
      deriveOfficialStatusActionPolicy(policyInput),
      deriveOfficialStatusActionPolicy({ ...policyInput, viewStatus: 'disconnected' }),
      deriveOfficialStatusActionPolicy({ ...policyInput, error: 'permission denied', errorKind: 'auth-denied', taskCount: 1, viewStatus: 'ready' }),
    ]) {
      expect(Object.keys(policy).sort()).toEqual(['createProjectVisible', 'primaryAction', 'retryVisible']);
      expect(isOfficialStatusActionPolicyConsistent(policy)).toBe(true);
      expect(JSON.stringify(policy)).not.toMatch(/provider\.invoke|gate\.run|artifact\.write|trace\.write|checkpoint\.write|resume\.execute|memory\.write|input_snapshot|shell|file\.write|run\.execute/);
    }
    expect(isOfficialStatusActionPolicyConsistent({ primaryAction: 'create-project', createProjectVisible: false, retryVisible: false })).toBe(false);
    expect(isOfficialStatusActionPolicyConsistent({ primaryAction: 'retry', createProjectVisible: true, retryVisible: true })).toBe(false);
    expect(isOfficialStatusActionPolicyConsistent({ primaryAction: 'none', createProjectVisible: false, retryVisible: true })).toBe(false);
  });

  it('covers every generated view status in the action policy matrix', () => {
    const expectedForStatus = (viewStatus: (typeof ATELIER_VIEW_STATUSES)[number], taskCount: number) => {
      if (viewStatus === 'empty' && taskCount === 0) {
        return { primaryAction: 'create-project', createProjectVisible: true, retryVisible: false };
      }
      if (viewStatus === 'disconnected') {
        return { primaryAction: 'retry', createProjectVisible: false, retryVisible: true };
      }
      return { primaryAction: 'none', createProjectVisible: false, retryVisible: false };
    };

    for (const taskCount of [0, 1]) {
      const coveredStatuses: string[] = [];
      for (const viewStatus of ATELIER_VIEW_STATUSES) {
        const policy = deriveOfficialStatusActionPolicy({
          error: '',
          errorKind: '',
          loading: viewStatus === 'loading',
          taskCount,
          viewStatus,
        });
        coveredStatuses.push(viewStatus);
        expect(policy).toEqual(expectedForStatus(viewStatus, taskCount));
        expect(isOfficialStatusActionPolicyConsistent(policy)).toBe(true);
      }
      expect(coveredStatuses).toEqual([...ATELIER_VIEW_STATUSES]);
    }
  });

  it('covers every generated recovery kind in global-error action policy', () => {
    const recoveryKinds = Object.keys(ATELIER_VIEW_SURFACE.recovery.labelKeyByKind) as AtelierErrorKind[];
    for (const errorKind of recoveryKinds) {
      const policy = deriveOfficialStatusActionPolicy({
        error: 'global recovery',
        errorKind,
        loading: false,
        taskCount: 1,
        viewStatus: 'ready',
      });
      expect(policy).toEqual({
        primaryAction: (ATELIER_RECOVERY_RETRYABLE_KINDS as readonly string[]).includes(errorKind) ? 'retry' : 'none',
        createProjectVisible: false,
        retryVisible: (ATELIER_RECOVERY_RETRYABLE_KINDS as readonly string[]).includes(errorKind),
      });
      expect(isOfficialStatusActionPolicyConsistent(policy)).toBe(true);
    }
    expect(recoveryKinds.sort()).toEqual(Object.keys(ATELIER_VIEW_SURFACE.recovery.labelKeyByKind).sort());
  });
});

describe('nextAtelierEventStreamRetryDelayMs', () => {
  it('uses bounded retry only for retryable recovery kinds with an existing snapshot', () => {
    expect(nextAtelierEventStreamRetryDelayMs({ attempt: 0, errorKind: 'disconnected', hasSnapshot: true })).toBe(500);
    expect(nextAtelierEventStreamRetryDelayMs({ attempt: 1, errorKind: 'error', hasSnapshot: true })).toBe(1500);
    expect(nextAtelierEventStreamRetryDelayMs({ attempt: 3, errorKind: 'disconnected', hasSnapshot: true })).toBeNull();
    expect(nextAtelierEventStreamRetryDelayMs({ attempt: 0, errorKind: 'auth-denied', hasSnapshot: true })).toBeNull();
    expect(nextAtelierEventStreamRetryDelayMs({ attempt: 0, errorKind: 'disconnected', hasSnapshot: false })).toBeNull();
    expect(nextAtelierEventStreamRetryDelayMs({ attempt: 0, errorKind: '' as AtelierErrorKind | '', hasSnapshot: true })).toBeNull();
  });
});
