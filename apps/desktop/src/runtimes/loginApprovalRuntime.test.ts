import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// Mock the native command surface before importing the runtime under test.
const commands = vi.hoisted(() => ({
  create: vi.fn(),
  status: vi.fn(),
  cancel: vi.fn(),
  listPending: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
}));

vi.mock('../services/loginApproval', () => ({
  LOGIN_APPROVAL_STATE: {
    PENDING: 1, APPROVED: 2, COMMITTED: 7, DENIED: 8, CANCELLED: 9, EXPIRED: 10,
  },
  loginApprovalClaimantCommands: {
    create: commands.create,
    status: commands.status,
    cancel: commands.cancel,
  },
  loginApprovalApproverCommands: {
    listPending: commands.listPending,
    approve: commands.approve,
    deny: commands.deny,
  },
}));

vi.mock('../store/session', () => ({
  useSessionStore: {
    getState: () => ({ sessionEpoch: 1 }),
    subscribe: vi.fn(() => vi.fn()),
  },
}));

import { loginApprovalActions, loginApprovalRuntime, __testing } from './loginApprovalRuntime';
import { useLoginApprovalStore } from '../store/loginApproval';

const pendingProjection = (state: number, revision = 1) => ({
  approvalId: 'a1', state, revision, expiresAtUnixMs: Date.now() + 600_000,
  comparisonCode: '123456', reason: 0,
});

describe('loginApprovalRuntime', () => {
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

  it('projects the claimant waiting state after create and stops polling at a terminal state', async () => {
    commands.create.mockResolvedValue(pendingProjection(1));
    commands.status.mockResolvedValue(pendingProjection(7, 2));

    await loginApprovalActions.requestApproval({
      accessAttemptId: 'attempt-1', accessDecisionRevision: 3, stationPeerId: 'station-test',
      claimantDeviceId: 'phone-new', platform: 'ios', deviceLabel: 'iPhone',
    });

    expect(useLoginApprovalStore.getState().claimant?.state).toBe(1);
    expect(commands.create).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(commands.status).toHaveBeenCalledTimes(1);
    expect(useLoginApprovalStore.getState().claimant?.state).toBe(7);

    // A terminal projection must not schedule another poll.
    commands.status.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(commands.status).not.toHaveBeenCalled();
  });

  it('cancels a pending request and projects the terminal cancellation', async () => {
    commands.create.mockResolvedValue(pendingProjection(1));
    commands.cancel.mockResolvedValue(pendingProjection(9, 2));

    await loginApprovalActions.requestApproval({
      accessAttemptId: 'attempt-1', accessDecisionRevision: 3, stationPeerId: 'station-test',
      claimantDeviceId: 'phone-new', platform: 'ios', deviceLabel: 'iPhone',
    });
    await loginApprovalActions.cancelClaimant();

    expect(commands.cancel).toHaveBeenCalledWith(1);
    expect(useLoginApprovalStore.getState().claimant?.state).toBe(9);
  });

  it('removes an approval from the pending list after the approver allows it', async () => {
    useLoginApprovalStore.getState().setPending([{
      approvalId: 'a1', claimantDeviceId: 'phone-new', platform: 'ios',
      deviceLabel: 'iPhone', comparisonCode: '123456', expiresAtUnixMs: Date.now() + 600_000, revision: 1,
    }]);
    commands.approve.mockResolvedValue(pendingProjection(2, 2));

    await loginApprovalActions.approve('a1', 1);

    expect(commands.approve).toHaveBeenCalledWith('a1', 1);
    expect(useLoginApprovalStore.getState().pending).toHaveLength(0);
  });

  it('never polls while the document is hidden', async () => {
    commands.create.mockResolvedValue(pendingProjection(1));
    await loginApprovalActions.requestApproval({
      accessAttemptId: 'attempt-1', accessDecisionRevision: 3, stationPeerId: 'station-test',
      claimantDeviceId: 'phone-new', platform: 'ios', deviceLabel: 'iPhone',
    });
    (document as { hidden: boolean }).hidden = true;
    commands.status.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(commands.status).not.toHaveBeenCalled();
    (document as { hidden: boolean }).hidden = false;
  });

  it('teardown clears all projections and timers', () => {
    loginApprovalRuntime.teardown();
    expect(useLoginApprovalStore.getState().claimant).toBeNull();
    expect(useLoginApprovalStore.getState().pending).toHaveLength(0);
  });
});
