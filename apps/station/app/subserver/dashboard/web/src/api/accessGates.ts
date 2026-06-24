/**
 * Dashboard access-gate API — read/update the Station access policy and manage
 * invite codes. Mirrors the Station gatepb contract; the Dashboard is the only
 * owner of policy and invite-code mutation.
 *
 * Wire format note: the Station serialises proto responses via protojson with
 * UseProtoNames=true and EmitUnpopulated=true, so JSON keys are snake_case and
 * enums arrive as their string names (e.g. "ACCESS_POLICY_MODE_OPEN"). Requests
 * are decoded with protojson too, which accepts snake_case keys and string or
 * numeric enum values.
 */

import client from './client';

// AccessGateType enum names, kept in sync with model/domain/access_gate.proto.
export const ACCESS_GATE_TYPE = {
  STATION_CAPABILITY: 'ACCESS_GATE_TYPE_STATION_CAPABILITY',
  AUTH_LOGIN: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
  AUTH_SESSION_RESTORE: 'ACCESS_GATE_TYPE_AUTH_SESSION_RESTORE',
  INVITE_ALLOWLIST: 'ACCESS_GATE_TYPE_INVITE_ALLOWLIST',
  INVITE_CODE: 'ACCESS_GATE_TYPE_INVITE_CODE',
  DEVICE_TRUST: 'ACCESS_GATE_TYPE_DEVICE_TRUST',
  MAINTENANCE: 'ACCESS_GATE_TYPE_MAINTENANCE',
  TERMS_ACCEPTANCE: 'ACCESS_GATE_TYPE_TERMS_ACCEPTANCE',
} as const;

export type AccessGateType = (typeof ACCESS_GATE_TYPE)[keyof typeof ACCESS_GATE_TYPE];

// AccessPolicyMode enum names, kept in sync with the proto.
export const ACCESS_POLICY_MODE = {
  UNSPECIFIED: 'ACCESS_POLICY_MODE_UNSPECIFIED',
  OPEN: 'ACCESS_POLICY_MODE_OPEN',
  INVITE_ONLY: 'ACCESS_POLICY_MODE_INVITE_ONLY',
  FIXED_USERS: 'ACCESS_POLICY_MODE_FIXED_USERS',
  CLOSED: 'ACCESS_POLICY_MODE_CLOSED',
} as const;

export type AccessPolicyMode = (typeof ACCESS_POLICY_MODE)[keyof typeof ACCESS_POLICY_MODE];

export interface AccessPolicy {
  mode: AccessPolicyMode;
  allowed_emails?: string[];
  allowed_usernames?: string[];
  allowed_actor_ids?: number[];
  enabled_gates?: AccessGateType[];
  self_service_invite?: boolean;
  updated_at?: string;
  updated_by?: string;
}

export interface InviteCode {
  id: string;
  code: string;
  note?: string;
  max_uses?: number;
  used_count?: number;
  revoked?: boolean;
  created_by?: string;
  created_at?: string;
  expires_at?: string;
  last_used_at?: string;
}

export interface CreateInviteCodeRequest {
  code?: string;
  note?: string;
  max_uses?: number;
  expires_at?: string;
}

/** Read the Station access policy. */
export async function getAccessPolicy(): Promise<AccessPolicy> {
  const { data } = await client.get('/access-gates/policy');
  return data.policy ?? {};
}

/** Replace the Station access policy. */
export async function updateAccessPolicy(policy: AccessPolicy): Promise<AccessPolicy> {
  const { data } = await client.post('/access-gates/policy', { policy });
  return data.policy ?? {};
}

/** List invite codes, optionally including revoked ones. */
export async function listInviteCodes(includeRevoked = false): Promise<InviteCode[]> {
  const { data } = await client.get('/access-gates/invite-codes', {
    params: { include_revoked: includeRevoked ? 1 : 0 },
  });
  return data.invite_codes ?? [];
}

/** Mint a new invite code. An empty code asks the Station to generate one. */
export async function createInviteCode(req: CreateInviteCodeRequest): Promise<InviteCode> {
  const { data } = await client.post('/access-gates/invite-codes', req);
  return data.invite_code ?? {};
}

/** Revoke an invite code permanently. */
export async function revokeInviteCode(id: string): Promise<InviteCode> {
  const { data } = await client.delete(`/access-gates/invite-codes/${id}`);
  return data.invite_code ?? {};
}
