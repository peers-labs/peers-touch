// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../../features/auth/authSession';
import {
  bindMobileMutationAdmission,
  bindMobileSessionMutationAdmission,
} from '../../runtimes/mutationAdmission';
import type {
  IngressState,
  ProjectionStaleness,
  SocialIngressDomain,
  WriteAdmission,
} from '../../runtimes/socialEventIngress';
import { createGatewayTransport } from './gatewayTypes';

const executeStationOperation = vi.hoisted(() => vi.fn());

vi.mock('../stationTransport', () => ({
  executeStationOperation,
  responseJson: (response: { bodyBytes: number[] }) =>
    JSON.parse(new TextDecoder().decode(Uint8Array.from(response.bodyBytes))),
}));

interface MutableAdmissionState {
  lifecycle: IngressState['lifecycle'];
  staleness: Record<SocialIngressDomain, ProjectionStaleness>;
  writeAdmission: WriteAdmission;
}

const session = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
} satisfies MobileAuthSession;

let admission: MutableAdmissionState;
let release: (() => void) | null = null;
let releaseSession: (() => void) | null = null;

beforeEach(() => {
  admission = activeAdmission();
  releaseSession = bindMobileSessionMutationAdmission(() => ({
    scopeKey: 'station-a|ptid:alice',
    open: true,
    reason: 'session_active',
  }));
  release = bindMobileMutationAdmission(
    'station-a|ptid:alice',
    () => admission,
  );
  executeStationOperation.mockResolvedValue({
    status: 200,
    contentType: 'application/json',
    bodyBytes: Array.from(new TextEncoder().encode(JSON.stringify({
      data: { value: 'ok' },
    }))),
  });
});

afterEach(() => {
  release?.();
  release = null;
  releaseSession?.();
  releaseSession = null;
  executeStationOperation.mockReset();
});

describe('gateway mutation admission', () => {
  it('keeps reads available while global writes are closed', async () => {
    admission.writeAdmission = {
      open: false,
      reason: 'control_event_lost',
      closedAt: 10,
    };
    const transport = createGatewayTransport(session, 'profile');

    await expect(transport.request({
      method: 'GET',
      path: '/actor/profile',
    })).resolves.toEqual({ value: 'ok' });
    await expect(transport.request({
      method: 'POST',
      path: '/actor/profile',
      body: { display_name: 'Alice' },
    })).rejects.toMatchObject({
      code: 'MOBILE_WRITE_ADMISSION_CLOSED',
      reason: 'control_event_lost',
    });
    expect(executeStationOperation).toHaveBeenCalledExactlyOnceWith(
      session,
      { operationId: 'actor_profile_get' },
    );
  });

  it('blocks only the stale mutation domain', async () => {
    admission.staleness.moments = {
      stale: true,
      reason: 'data_capacity_overflow',
      since: 10,
    };

    const moments = createGatewayTransport(session, 'moments');
    const profile = createGatewayTransport(session, 'profile');

    await expect(moments.command({
      method: 'POST',
      path: '/api/v1/social/moments',
      body: {},
    })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'MOBILE_WRITE_ADMISSION_CLOSED',
        message: 'mobile.recovery.writeRevocation.body',
      },
    });
    await expect(profile.request({
      method: 'POST',
      path: '/actor/profile',
      body: { display_name: 'Alice' },
    })).resolves.toEqual({ value: 'ok' });
    expect(executeStationOperation).toHaveBeenCalledExactlyOnceWith(
      session,
      {
        operationId: 'actor_profile_update',
        input: { display_name: 'Alice' },
      },
    );
  });
});

function activeAdmission(): MutableAdmissionState {
  return {
    lifecycle: 'active',
    writeAdmission: { open: true },
    staleness: {
      social: { stale: false },
      group: { stale: false },
      moments: { stale: false },
      notification: { stale: false },
      profile: { stale: false },
      control: { stale: false },
    },
  };
}
