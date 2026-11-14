import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commands = vi.hoisted(() => ({
  create: vi.fn(),
  read: vi.fn(),
  cancel: vi.fn(),
  list: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
}));

vi.mock('../services/loginApproval', () => ({
  LoginApprovalState: { PENDING: 1, APPROVED: 2, COMMITTED: 7, DENIED: 8, CANCELLED: 9, EXPIRED: 10 },
  createLoginApproval: commands.create,
  readLoginApproval: commands.read,
  cancelLoginApproval: commands.cancel,
  listPendingLoginApprovals: commands.list,
  approveLoginApproval: commands.approve,
  denyLoginApproval: commands.deny,
}));

import {
  approvePendingLoginApproval,
  cancelClaimantLoginApproval,
  clearClaimantLoginApproval,
  loginApprovalRuntime,
  requestLoginApproval,
  __testing,
} from './loginApprovalRuntime';
import { useLoginApprovalStore } from '../features/auth/loginApprovalStore';

const claimant = (state: number, revision = 1) => ({
  approvalId: 'a1',
  state,
  revision,
  expiresAtUnixMs: Date.now() + 600_000,
  comparisonCode: '123456',
  reason: 0,
});

const input = {
  accessAttemptId: 'attempt-1',
  accessDecisionRevision: 3,
  stationPeerId: 'station-test',
  claimantDeviceId: 'phone-new',
  platform: 'ios' as const,
  deviceLabel: 'iPhone',
};

describe('loginApprovalRuntime (mobile)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    Object.values(commands).forEach((mock) => mock.mockReset());
    useLoginApprovalStore.getState().reset();
  });

  afterEach(() => {
    __testing.resetTimers();
    vi.useRealTimers();
  });

  it('projects the claimant waiting state and stops polling once terminal', async () => {
    commands.create.mockResolvedValue(claimant(1));
    commands.read.mockResolvedValue(claimant(7, 2));

    await requestLoginApproval(input);
    expect(useLoginApprovalStore.getState().claimant?.state).toBe(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(commands.read).toHaveBeenCalledTimes(1);
    expect(useLoginApprovalStore.getState().claimant?.state).toBe(7);

    commands.read.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(commands.read).not.toHaveBeenCalled();
  });

  it('cancels a pending request and projects the terminal state', async () => {
    commands.create.mockResolvedValue(claimant(1));
    commands.cancel.mockResolvedValue(claimant(9, 2));

    await requestLoginApproval(input);
    await cancelClaimantLoginApproval();

    expect(commands.cancel).toHaveBeenCalledWith(1);
    expect(useLoginApprovalStore.getState().claimant?.state).toBe(9);
  });

  it('removes an approval after the approver allows it', async () => {
    useLoginApprovalStore.getState().setPending([
      {
        approvalId: 'a1',
        claimantDeviceId: 'phone-new',
        platform: 'ios',
        deviceLabel: 'iPhone',
        comparisonCode: '123456',
        expiresAtUnixMs: Date.now() + 600_000,
        revision: 1,
      },
    ]);
    commands.approve.mockResolvedValue(claimant(2, 2));

    await approvePendingLoginApproval('a1', 1);
    expect(commands.approve).toHaveBeenCalledWith('a1', 1);
    expect(useLoginApprovalStore.getState().pending).toHaveLength(0);
  });

  it('never polls while the document is hidden', async () => {
    commands.create.mockResolvedValue(claimant(1));
    await requestLoginApproval(input);
    (document as { hidden: boolean }).hidden = true;
    commands.read.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(commands.read).not.toHaveBeenCalled();
    (document as { hidden: boolean }).hidden = false;
  });

  it('teardown clears all projections and timers', async () => {
    await loginApprovalRuntime.teardown({ reason: 'app-unmount' });
    expect(useLoginApprovalStore.getState().claimant).toBeNull();
    expect(useLoginApprovalStore.getState().pending).toHaveLength(0);
  });

  it('exposes a stable id and resets the claimant on explicit clear', async () => {
    expect(loginApprovalRuntime.id).toBe('login-approval');
    commands.create.mockResolvedValue(claimant(1));
    await requestLoginApproval(input);
    clearClaimantLoginApproval();
    expect(useLoginApprovalStore.getState().claimant).toBeNull();
  });
});
