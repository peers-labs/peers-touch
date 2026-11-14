import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loginApprovalApproverCommands,
  loginApprovalClaimantCommands,
  LOGIN_APPROVAL_STATE,
} from './loginApproval';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('loginApproval service contract', () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('routes claimant create through the native no-session command', async () => {
    invokeMock.mockResolvedValue({ ok: true, data: { approvalId: 'a1', state: LOGIN_APPROVAL_STATE.PENDING, revision: 1 } });
    const input = {
      accessAttemptId: 'attempt-1', accessDecisionRevision: 3, stationPeerId: 'station-test',
      claimantDeviceId: 'phone-new', platform: 'ios' as const, deviceLabel: 'iPhone',
    };
    const projection = await loginApprovalClaimantCommands.create(input);
    expect(projection.approvalId).toBe('a1');
    expect(invokeMock).toHaveBeenCalledWith('login_approval_create', { input });
  });

  it('surfaces typed native failures instead of swallowing them', async () => {
    invokeMock.mockResolvedValue({ ok: false, error: { message: 'loginApproval.capabilityInvalid' } });
    await expect(loginApprovalClaimantCommands.status(1)).rejects.toThrow('loginApproval.capabilityInvalid');
    expect(invokeMock).toHaveBeenCalledWith('login_approval_status', { input: { observedRevision: 1 } });
  });

  it('keeps approver commands on the authenticated command surface', async () => {
    invokeMock.mockResolvedValue({ ok: true, data: { approvals: [] } });
    await loginApprovalApproverCommands.listPending(0);
    expect(invokeMock).toHaveBeenCalledWith('login_approval_list_pending', { input: { observedRevision: 0 } });

    invokeMock.mockResolvedValue({ ok: true, data: { approvalId: 'a1', state: LOGIN_APPROVAL_STATE.APPROVED, revision: 2 } });
    await loginApprovalApproverCommands.deny('a1', 1);
    expect(invokeMock).toHaveBeenCalledWith('login_approval_deny', { input: { approvalId: 'a1', observedRevision: 1 } });
  });
});
