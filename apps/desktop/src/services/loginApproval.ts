import { invoke } from '@tauri-apps/api/core';

// State enum mirrors model/domain/auth/login_approval.proto.
export const LOGIN_APPROVAL_STATE = {
  UNSPECIFIED: 0,
  PENDING: 1,
  APPROVED: 2,
  IDENTITY_DELIVERY: 3,
  DEVICE_PROVED: 4,
  ACCESS_PENDING: 5,
  CREDENTIAL_DELIVERY: 6,
  COMMITTED: 7,
  DENIED: 8,
  CANCELLED: 9,
  EXPIRED: 10,
} as const;

export type LoginApprovalState = (typeof LOGIN_APPROVAL_STATE)[keyof typeof LOGIN_APPROVAL_STATE];

export interface LoginApprovalProjection {
  approvalId: string;
  state: LoginApprovalState;
  revision: number;
  expiresAtUnixMs: number;
  comparisonCode: string;
  reason: number;
}

export interface PendingLoginApproval {
  approvalId: string;
  claimantDeviceId: string;
  platform: 'desktop' | 'android' | 'ios';
  deviceLabel: string;
  comparisonCode: string;
  expiresAtUnixMs: number;
  revision: number;
}

export interface CreateLoginApprovalInput {
  accessAttemptId: string;
  accessDecisionRevision: number;
  stationPeerId: string;
  claimantDeviceId: string;
  platform: 'desktop' | 'android' | 'ios';
  deviceLabel: string;
}

interface NativeResult<T> { ok: boolean; data?: T; error?: { message: string } }

async function call<T>(command: string, input?: object): Promise<T> {
  const result = await invoke<NativeResult<T>>(command, input ? { input } : undefined);
  if (!result.ok) throw new Error(result.error?.message ?? 'loginApproval.runtimeFailed');
  return result.data as T;
}

// Claimant surface: the native layer attaches the possession capability and
// routes without a session JWT. Renderer never holds the raw capability.
export const loginApprovalClaimantCommands = {
  create: (input: CreateLoginApprovalInput) =>
    call<LoginApprovalProjection>('login_approval_create', input),
  status: (observedRevision: number) =>
    call<LoginApprovalProjection>('login_approval_status', { observedRevision }),
  cancel: (observedRevision: number) =>
    call<LoginApprovalProjection>('login_approval_cancel', { observedRevision }),
};

// Approver surface: authenticated commands backed by the active session JWT.
export const loginApprovalApproverCommands = {
  listPending: (observedRevision: number) =>
    call<{ approvals: PendingLoginApproval[] }>('login_approval_list_pending', { observedRevision }),
  approve: (approvalId: string, observedRevision: number) =>
    call<LoginApprovalProjection>('login_approval_approve', { approvalId, observedRevision }),
  deny: (approvalId: string, observedRevision: number) =>
    call<LoginApprovalProjection>('login_approval_deny', { approvalId, observedRevision }),
};
