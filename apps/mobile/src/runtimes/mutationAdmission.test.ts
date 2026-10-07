import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bindMobileMutationAdmission,
  bindMobileSessionMutationAdmission,
  MobileMutationAdmissionError,
  requireMobileMutationAdmission,
  WRITE_ADMISSION_ERROR_KEY,
} from './mutationAdmission';
import {
  destroyRecoveryProjection,
  getRecoveryProjection,
} from './recoveryProjection';
import type {
  IngressState,
  ProjectionStaleness,
  SocialIngressDomain,
  WriteAdmission,
} from './socialEventIngress';

interface MutableAdmissionState {
  lifecycle: IngressState['lifecycle'];
  staleness: Record<SocialIngressDomain, ProjectionStaleness>;
  writeAdmission: WriteAdmission;
}

let release: (() => void) | null = null;
let releaseSession: (() => void) | null = null;

afterEach(() => {
  release?.();
  release = null;
  releaseSession?.();
  releaseSession = null;
  destroyRecoveryProjection();
});

beforeEach(() => {
  releaseSession = bindMobileSessionMutationAdmission(() => ({
    scopeKey: 'station-a|ptid:alice',
    open: true,
    reason: 'session_active',
  }));
});

describe('Mobile mutation admission', () => {
  it('fails closed without an active Social ingress owner', () => {
    expect(() => requireMobileMutationAdmission('station-a|ptid:alice'))
      .toThrowError(
      expect.objectContaining({
        code: 'MOBILE_WRITE_ADMISSION_CLOSED',
        message: WRITE_ADMISSION_ERROR_KEY,
        reason: 'runtime_unavailable',
      }),
    );
  });

  it('reads the owning ingress state for every mutation', () => {
    const state = admissionState();
    release = bindMobileMutationAdmission(
      'station-a|ptid:alice',
      () => state,
    );

    expect(() => requireMobileMutationAdmission(
      'station-a|ptid:alice',
      'social',
    )).not.toThrow();
    expect(() => requireMobileMutationAdmission(
      'station-a|ptid:alice',
      'group',
    )).not.toThrow();

    state.writeAdmission = {
      open: false,
      reason: 'control_event_loss_threshold',
      closedAt: 42,
    };

    expect(() => requireMobileMutationAdmission(
      'station-a|ptid:alice',
      'social',
    )).toThrowError(
      expect.objectContaining({
        code: 'MOBILE_WRITE_ADMISSION_CLOSED',
        reason: 'control_event_loss_threshold',
      }),
    );
  });

  it('closes every mutation while the Session owner is refreshing', () => {
    releaseSession?.();
    releaseSession = bindMobileSessionMutationAdmission(() => ({
      scopeKey: 'station-a|ptid:alice',
      open: false,
      reason: 'session_refreshing',
    }));
    release = bindMobileMutationAdmission(
      'station-a|ptid:alice',
      admissionState,
    );

    expect(() => requireMobileMutationAdmission(
      'station-a|ptid:alice',
      'social',
    )).toThrowError(expect.objectContaining({
      code: 'MOBILE_WRITE_ADMISSION_CLOSED',
      reason: 'session_refreshing',
    }));
  });

  it('rejects the wrong account scope and a stale target domain', () => {
    const state = admissionState();
    release = bindMobileMutationAdmission(
      'station-a|ptid:alice',
      () => state,
    );

    expect(() => requireMobileMutationAdmission(
      'station-b|ptid:alice',
      'moments',
    )).toThrowError(expect.objectContaining({
      reason: 'session_runtime_unavailable',
    }));

    state.staleness.moments = {
      stale: true,
      reason: 'data_capacity_overflow',
      since: 42,
    };

    expect(() => requireMobileMutationAdmission(
      'station-a|ptid:alice',
      'moments',
    )).toThrowError(expect.objectContaining({
      reason: 'moments:data_capacity_overflow',
    }));
    expect(() => requireMobileMutationAdmission(
      'station-a|ptid:alice',
      'social',
    )).not.toThrow();
  });

  it('closes mutation admission while command-ledger capacity is exhausted', () => {
    release = bindMobileMutationAdmission(
      'station-a|ptid:alice',
      admissionState,
    );
    const recovery = getRecoveryProjection();
    recovery.reportCapacityReadOnly({
      recordCount: 512,
      recordLimit: 512,
      byteUsage: 4096,
      byteLimit: 16_777_216,
      exhaustionCauses: ['record-count'],
    });

    expect(() => requireMobileMutationAdmission(
      'station-a|ptid:alice',
      'social',
    )).toThrowError(expect.objectContaining({
      code: 'MOBILE_WRITE_ADMISSION_CLOSED',
      reason: 'recovery_projection_blocked',
    }));

    recovery.clearCapacityReadOnly();
    expect(() => requireMobileMutationAdmission(
      'station-a|ptid:alice',
      'social',
    )).not.toThrow();
  });

  it('keeps one runtime owner and releases only its own binding', () => {
    release = bindMobileMutationAdmission(
      'station-a|ptid:alice',
      admissionState,
    );

    expect(() => bindMobileMutationAdmission(
      'station-a|ptid:alice',
      admissionState,
    ))
      .toThrow('mobile.social.mutationAdmissionAlreadyBound');

    release();
    release = null;
    expect(() => requireMobileMutationAdmission('station-a|ptid:alice'))
      .toThrow(MobileMutationAdmissionError);
  });
});

function admissionState(): MutableAdmissionState {
  return {
    lifecycle: 'active',
    writeAdmission: { open: true },
    staleness: {
      social: { stale: false },
      moments: { stale: false },
      notification: { stale: false },
      profile: { stale: false },
      control: { stale: false },
    },
  };
}
