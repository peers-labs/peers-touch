import { invoke } from '@tauri-apps/api/core';

// Mirrors model/domain/auth/login_approval.proto. The native layer owns the
// possession capability and HPKE keys; the web side only reads projections.
export const LoginApprovalState = {
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

export type LoginApprovalState = (typeof LoginApprovalState)[keyof typeof LoginApprovalState];

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

// Claimant surface (no session JWT; the native runtime attaches the capability).
export const createLoginApproval = (input: CreateLoginApprovalInput) =>
  invoke<LoginApprovalProjection>('login_approval_create', { input });
export const readLoginApproval = (observedRevision: number) =>
  invoke<LoginApprovalProjection>('login_approval_status', { input: { observedRevision } });
export const cancelLoginApproval = (observedRevision: number) =>
  invoke<LoginApprovalProjection>('login_approval_cancel', { input: { observedRevision } });

// Approver surface (authenticated by the active session in the native layer).
export const listPendingLoginApprovals = (observedRevision: number) =>
  invoke<{ approvals: PendingLoginApproval[] }>('login_approval_list_pending', {
    input: { observedRevision },
  });
export const approveLoginApproval = (approvalId: string, observedRevision: number) =>
  invoke<LoginApprovalProjection>('login_approval_approve', {
    input: { approvalId, observedRevision },
  });
export const denyLoginApproval = (approvalId: string, observedRevision: number) =>
  invoke<LoginApprovalProjection>('login_approval_deny', {
    input: { approvalId, observedRevision },
  });
