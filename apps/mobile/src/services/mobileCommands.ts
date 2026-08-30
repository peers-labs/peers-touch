import { invoke } from '@tauri-apps/api/core';

export async function setSecureStorageValue(key: string, value: string): Promise<void> {
  await invoke('secure_storage_set', { key, value });
}

export async function getSecureStorageValue(key: string): Promise<string | null> {
  return invoke<string | null>('secure_storage_get', { key });
}

export async function removeSecureStorageValue(key: string): Promise<void> {
  await invoke('secure_storage_remove', { key });
}

export interface VerifyStationIdentityProofInput {
  requestedOrigin: string;
  challenge: number[];
  statementBytes: number[];
  hostPublicKey: number[];
  signature: number[];
  requiredCapabilities: string[];
}

export interface VerifiedStationIdentity {
  stationPeerId: string;
  canonicalOrigin: string;
  capabilities: string[];
  verifiedAt: number;
}

export async function verifyStationIdentityProof(
  input: VerifyStationIdentityProofInput,
): Promise<VerifiedStationIdentity> {
  return invoke<VerifiedStationIdentity>('station_identity_verify', { input });
}

export type MobileOAuthProvider = 'github' | 'google';

export type OAuthPublicPhase =
  | 'idle'
  | 'starting'
  | 'awaiting_provider'
  | 'callback_received'
  | 'exchanging'
  | 'following_gate'
  | 'credential_delivery'
  | 'active_session'
  | 'cancelled'
  | 'expired'
  | 'failed';

export interface OAuthStartInput {
  stationOrigin: string;
  stationPeerId: string;
  accessAttemptId: string;
  gateId: string;
  provider: MobileOAuthProvider;
}

export interface OAuthScopeInput {
  stationOrigin: string;
  stationPeerId: string;
}

export interface OAuthCandidateProjection {
  candidateId: string;
  actorPtid: string;
  accessAttemptId: string;
  stationPeerId: string;
  decisionRevision: number;
  issuedAtUnixMs?: number;
  expiresAtUnixMs?: number;
}

export interface OAuthGateActionProjection {
  actionId: string;
  actionType: string;
  submitAction: string;
}

export interface OAuthGateProjection {
  gateId: string;
  gateType: string;
  state: string;
  title: string;
  description: string;
  blockingReason: string;
  submitAction: string;
  inputSchemaJson: string;
  alternativeActions: OAuthGateActionProjection[];
}

export interface OAuthAccessDecisionProjection {
  state: string;
  attemptId: string;
  currentGateId: string;
  gates: OAuthGateProjection[];
  actorPtid?: string;
  accessGrantId: string;
  expiresAtUnixMs?: number;
  message: string;
}

export interface OAuthSessionProjection {
  sessionId: string;
  actorPtid: string;
  expiresAt: string;
}

export interface OAuthPublicProjection {
  phase: OAuthPublicPhase;
  stationPeerId?: string;
  provider?: string;
  accessAttemptId?: string;
  gateId?: string;
  expiresAtUnixMs?: number;
  result?: string;
  errorCode?: string;
  candidate?: OAuthCandidateProjection;
  accessDecision?: OAuthAccessDecisionProjection;
  session?: OAuthSessionProjection;
}

export async function oauthStart(input: OAuthStartInput): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_start', { input });
}

export async function oauthStatus(input: OAuthScopeInput): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_status', { input });
}

export async function oauthCancel(input: OAuthScopeInput): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_cancel', { input });
}

export async function oauthRestore(input: OAuthScopeInput): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_restore', { input });
}

export async function oauthRetryBrowser(): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_retry_browser');
}

export async function oauthProjection(): Promise<OAuthPublicProjection> {
  return invoke<OAuthPublicProjection>('oauth_projection');
}
