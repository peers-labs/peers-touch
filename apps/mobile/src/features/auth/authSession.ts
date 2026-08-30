import {
  getSecureStorageValue,
  removeSecureStorageValue,
  setSecureStorageValue,
} from '../../services/mobileCommands';
import {
  mobileAuthScope,
  mobileAuthScopeKey,
  parseMobileAuthSession,
  type MobileActorRef,
  type MobileAuthSession,
} from './mobileAuthIdentity';

export type { MobileActorRef, MobileAuthSession } from './mobileAuthIdentity';

export interface StationLoginInput {
  stationPeerId: string;
  stationUrl: string;
  email: string;
  password: string;
}

export interface RememberedLoginAccount {
  stationPeerId: string;
  stationUrl: string;
  email: string;
  ptid: string;
  displayName: string;
  lastUsedAt: number;
}

export const ACCESS_GATE_TYPE_AUTH_LOGIN = 2;
export const ACCESS_GATE_TYPE_INVITE_CODE = 5;
export const ACCESS_DECISION_ACTION_REQUIRED = 2;
export const ACCESS_DECISION_GRANTED = 3;
export const ACCESS_DECISION_BLOCKED = 4;
export const ACCESS_DECISION_FAILED = 5;

// A single field descriptor parsed from a gate's input_schema_json. The Station
// owns the schema so a gate's form can change without a client release.
export interface AccessGateField {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
}

export interface AccessGate {
  gateId: string;
  type: number | string;
  state: number | string;
  title?: string;
  description?: string;
  blockingReason?: string;
  submitAction?: string;
  inputSchemaJson?: string;
}

/** Parse a gate's input_schema_json into a field list. Unparseable schemas
 * yield an empty list so the host can fall back to its default rendering. */
export function parseGateFields(gate: AccessGate | undefined): AccessGateField[] {
  if (!gate?.inputSchemaJson) return [];
  try {
    const parsed = JSON.parse(gate.inputSchemaJson) as { fields?: AccessGateField[] };
    return Array.isArray(parsed.fields) ? parsed.fields : [];
  } catch {
    return [];
  }
}

/** True when the gate type denotes self-service invite-code redemption. */
export function isInviteCodeGate(gate: AccessGate | undefined): boolean {
  return gate?.type === ACCESS_GATE_TYPE_INVITE_CODE
    || gate?.type === 'ACCESS_GATE_TYPE_INVITE_CODE';
}

/** True when the gate type denotes the login credential gate. */
export function isLoginGate(gate: AccessGate | undefined): boolean {
  return gate?.type === ACCESS_GATE_TYPE_AUTH_LOGIN
    || gate?.type === 'ACCESS_GATE_TYPE_AUTH_LOGIN';
}

export interface AccessDecision {
  state: number | string;
  attemptId: string;
  currentGateId?: string;
  gates: AccessGate[];
  accessGrantId?: string;
  message?: string;
}

interface StationLoginEnvelope {
  code?: string;
  msg?: string;
  data?: StationLoginPayload | AccessStartPayload | AccessSubmitPayload;
}

export interface StationLoginPayload {
  tokens?: {
    token?: string;
    access_token?: string;
    accessToken?: string;
    refresh_token?: string;
    refreshToken?: string;
    token_type?: string;
    tokenType?: string;
    expires_at?: string;
    expiresAt?: string;
  };
  session_id?: string;
  sessionId?: string;
  actor_ref?: MobileActorRef;
  actorRef?: MobileActorRef;
}

interface AccessStartPayload {
  decision?: RawAccessDecision;
}

interface AccessSubmitPayload {
  decision?: RawAccessDecision;
  login_response?: StationLoginPayload;
  loginResponse?: StationLoginPayload;
}

interface RawAccessDecision {
  state?: number | string;
  attempt_id?: string;
  attemptId?: string;
  current_gate_id?: string;
  currentGateId?: string;
  gates?: RawAccessGate[];
  access_grant_id?: string;
  accessGrantId?: string;
  message?: string;
}

interface RawAccessGate {
  gate_id?: string;
  gateId?: string;
  type?: number | string;
  state?: number | string;
  title?: string;
  description?: string;
  blocking_reason?: string;
  blockingReason?: string;
  submit_action?: string;
  submitAction?: string;
  input_schema_json?: string;
  inputSchemaJson?: string;
}

const LEGACY_AUTH_SESSION_KEY = 'peers-touch.mobile.auth-session.v1';
const LEGACY_AUTH_ACCOUNT_HISTORY_KEY = 'peers-touch.mobile.auth-accounts.v1';
const ACTIVE_AUTH_SCOPE_KEY = 'peers-touch.mobile.auth-active-scope.v1';
const AUTH_SESSION_KEY_PREFIX = 'peers-touch.mobile.auth-session.v1';
const AUTH_ACCOUNT_HISTORY_KEY_PREFIX = 'peers-touch.mobile.auth-accounts.v1';
let oauthAccessGrantFinalizer: (() => Promise<void>) | null = null;

// Locale keys used as error identifiers. Callers should translate with t().
export const AUTH_ERROR_KEYS = {
  LOGIN_FAILED: 'mobile.auth.loginFailed',
  GATE_UNAVAILABLE: 'mobile.auth.gateUnavailable',
  GATE_MISSING_ATTEMPT: 'mobile.auth.gateMissingAttempt',
  GATE_NOT_READY: 'mobile.auth.gateNotReady',
  ACCESS_DENIED: 'mobile.auth.accessDenied',
  MISSING_SESSION: 'mobile.auth.missingSession',
  MISSING_IDENTITY_SCOPE: 'mobile.auth.missingIdentityScope',
  INVITE_CODE_REQUIRED: 'mobile.auth.inviteCodeRequired',
  INVITE_CODE_REJECTED: 'mobile.auth.inviteCodeRejected',
} as const;

export async function loginToStation(input: StationLoginInput): Promise<MobileAuthSession> {
  const decision = await startStationAccessAttempt(input.stationPeerId, input.stationUrl);
  const result = await submitStationLoginGate({
    stationPeerId: input.stationPeerId,
    stationUrl: input.stationUrl,
    attemptId: decision.attemptId,
    email: input.email,
    password: input.password,
  });
  return result.session;
}

export async function startStationAccessAttempt(
  stationPeerId: string,
  stationUrl: string,
  sessionId?: string,
): Promise<AccessDecision> {
  const baseUrl = stationUrl.replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/actor/access/start`, {
      body: JSON.stringify({
        station_peer_id: stationPeerId.trim(),
        station_url: baseUrl,
        client: {
          platform: 'mobile',
          app_version: '0.1.0',
          device_id: '',
          locale: navigator.language || '',
        },
        session_id: sessionId ?? '',
      }),
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`${baseUrl} → ${raw}`);
  }

  const envelope = (await response.json().catch(() => null)) as StationLoginEnvelope | null;
  if (!response.ok || envelope?.code !== '200' || !envelope.data) {
    const serverMsg = envelope?.msg || (envelope as Record<string, unknown>)?.message as string;
    throw new Error(serverMsg || AUTH_ERROR_KEYS.GATE_UNAVAILABLE);
  }
  const decision = normalizeDecision((envelope.data as AccessStartPayload).decision);
  if (!decision.attemptId) throw new Error(AUTH_ERROR_KEYS.GATE_MISSING_ATTEMPT);
  return decision;
}

export async function submitStationLoginGate(input: StationLoginInput & { attemptId: string }): Promise<{
  decision: AccessDecision;
  session: MobileAuthSession;
}> {
  const stationUrl = input.stationUrl.replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${stationUrl}/actor/access/submit`, {
      body: JSON.stringify({
        attempt_id: input.attemptId,
        gate_id: 'auth.login',
        type: ACCESS_GATE_TYPE_AUTH_LOGIN,
        login: {
          email: input.email.trim(),
          password: input.password,
          device_type: 'mobile',
        },
      }),
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`${stationUrl} → ${raw}`);
  }

  const envelope = (await response.json().catch(() => null)) as StationLoginEnvelope | null;
  if (!response.ok || envelope?.code !== '200' || !envelope.data) {
    // Error responses use "message" field; success envelope uses "msg"
    const serverMsg = envelope?.msg || (envelope as Record<string, unknown>)?.message as string;
    throw new Error(serverMsg || `HTTP ${response.status}: ${AUTH_ERROR_KEYS.LOGIN_FAILED}`);
  }

  const payload = envelope.data as AccessSubmitPayload;
  const decision = normalizeDecision(payload.decision);
  if (!isAccessGranted(decision)) {
    throw new Error(accessDecisionMessage(decision) || AUTH_ERROR_KEYS.ACCESS_DENIED);
  }

  const loginResponse = payload.login_response ?? payload.loginResponse;
  if (!loginResponse) {
    throw new Error(AUTH_ERROR_KEYS.MISSING_SESSION);
  }

  const session = await activateStationSession(input.stationPeerId, stationUrl, loginResponse);
  return { decision, session };
}

export async function activateStationSession(
  stationPeerId: string,
  stationUrl: string,
  loginResponse: StationLoginPayload,
): Promise<MobileAuthSession> {
  const accessToken = loginResponse.tokens?.access_token || loginResponse.tokens?.accessToken || loginResponse.tokens?.token;
  const sessionId = loginResponse.session_id || loginResponse.sessionId;
  const actorRef = normalizeActorRef(loginResponse.actor_ref ?? loginResponse.actorRef);
  if (!accessToken || !sessionId || !actorRef) {
    throw new Error(AUTH_ERROR_KEYS.MISSING_SESSION);
  }

  const session: MobileAuthSession = {
    stationPeerId: stationPeerId.trim(),
    stationUrl: stationUrl.replace(/\/+$/, ''),
    sessionId,
    accessToken,
    refreshToken: loginResponse.tokens?.refresh_token || loginResponse.tokens?.refreshToken,
    tokenType: loginResponse.tokens?.token_type || loginResponse.tokens?.tokenType,
    expiresAt: loginResponse.tokens?.expires_at || loginResponse.tokens?.expiresAt,
    actorRef,
    authenticatedAt: Date.now(),
  };
  mobileAuthScope(session);
  await persistAuthSession(session);
  return session;
}

// submitStationInviteCodeGate redeems a self-service invite code for the live
// attempt and returns the re-evaluated decision. It never produces a session;
// the chain continues to the login gate once the code passes.
export async function submitStationInviteCodeGate(input: {
  stationUrl: string;
  attemptId: string;
  inviteCode: string;
}): Promise<AccessDecision> {
  const stationUrl = input.stationUrl.replace(/\/+$/, '');
  const code = input.inviteCode.trim();
  if (!code) throw new Error(AUTH_ERROR_KEYS.INVITE_CODE_REQUIRED);

  let response: Response;
  try {
    response = await fetch(`${stationUrl}/actor/access/submit`, {
      body: JSON.stringify({
        attempt_id: input.attemptId,
        gate_id: 'invite.code',
        type: ACCESS_GATE_TYPE_INVITE_CODE,
        invite_code: code,
      }),
      cache: 'no-store',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(`${stationUrl} → ${raw}`);
  }

  const envelope = (await response.json().catch(() => null)) as StationLoginEnvelope | null;
  if (!response.ok || envelope?.code !== '200' || !envelope.data) {
    const serverMsg = envelope?.msg || (envelope as Record<string, unknown>)?.message as string;
    throw new Error(serverMsg || AUTH_ERROR_KEYS.INVITE_CODE_REJECTED);
  }

  const decision = normalizeDecision((envelope.data as AccessSubmitPayload).decision);
  if (isAccessGranted(decision) && oauthAccessGrantFinalizer) {
    await oauthAccessGrantFinalizer();
  }
  return decision;
}

export function registerOAuthAccessGrantFinalizer(finalizer: () => Promise<void>): () => void {
  oauthAccessGrantFinalizer = finalizer;
  return () => {
    if (oauthAccessGrantFinalizer === finalizer) oauthAccessGrantFinalizer = null;
  };
}

function normalizeActorRef(actorRef: MobileActorRef | undefined): MobileActorRef | null {
  const ptid = actorRef?.ptid?.trim();
  if (!ptid) return null;
  return {
    ptid,
    acct: actorRef?.acct,
    kind: actorRef?.kind,
  };
}

export async function restoreAuthSession(): Promise<MobileAuthSession | null> {
  await removeSecureStorageValue(LEGACY_AUTH_SESSION_KEY);
  const activeScopeRaw = await getSecureStorageValue(ACTIVE_AUTH_SCOPE_KEY);
  if (!activeScopeRaw) return null;
  let sessionKey = '';
  try {
    const activeScope = JSON.parse(activeScopeRaw) as Partial<{ stationPeerId: string; ptid: string }>;
    const stationPeerId = String(activeScope.stationPeerId ?? '').trim();
    const ptid = String(activeScope.ptid ?? '').trim();
    if (!stationPeerId || !ptid) {
      await removeSecureStorageValue(ACTIVE_AUTH_SCOPE_KEY);
      return null;
    }

    sessionKey = scopedAuthSessionKey(stationPeerId, ptid);
    const raw = await getSecureStorageValue(sessionKey);
    const session = raw ? parseMobileAuthSession(JSON.parse(raw)) : null;
    if (!session || session.stationPeerId !== stationPeerId || session.actorRef.ptid !== ptid) {
      await removeSecureStorageValue(sessionKey);
      await removeSecureStorageValue(ACTIVE_AUTH_SCOPE_KEY);
      return null;
    }
    return session;
  } catch {
    if (sessionKey) await removeSecureStorageValue(sessionKey);
    await removeSecureStorageValue(ACTIVE_AUTH_SCOPE_KEY);
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  const activeScopeRaw = await getSecureStorageValue(ACTIVE_AUTH_SCOPE_KEY);
  if (activeScopeRaw) {
    try {
      const activeScope = JSON.parse(activeScopeRaw) as Partial<{ stationPeerId: string; ptid: string }>;
      const stationPeerId = String(activeScope.stationPeerId ?? '').trim();
      const ptid = String(activeScope.ptid ?? '').trim();
      if (stationPeerId && ptid) {
        await removeSecureStorageValue(scopedAuthSessionKey(stationPeerId, ptid));
      }
    } catch {
      // Invalid active scope contains no usable scoped credential locator.
    }
  }
  await removeSecureStorageValue(ACTIVE_AUTH_SCOPE_KEY);
  await removeSecureStorageValue(LEGACY_AUTH_SESSION_KEY);
}

export async function loadRememberedLoginAccounts(stationPeerId?: string): Promise<RememberedLoginAccount[]> {
  await removeSecureStorageValue(LEGACY_AUTH_ACCOUNT_HISTORY_KEY);
  const scope = stationPeerId?.trim();
  if (!scope) return [];
  const raw = await getSecureStorageValue(scopedAccountHistoryKey(scope));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Partial<RememberedLoginAccount>[];
    const normalized = parsed
      .map(normalizeRememberedAccount)
      .filter((account): account is RememberedLoginAccount => account?.stationPeerId === scope)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    return normalized;
  } catch {
    await removeSecureStorageValue(scopedAccountHistoryKey(scope));
    return [];
  }
}

export async function rememberLoginAccount(session: MobileAuthSession, email: string): Promise<void> {
  const account = normalizeRememberedAccount({
    stationPeerId: session.stationPeerId,
    stationUrl: session.stationUrl,
    email,
    ptid: session.actorRef.ptid,
    displayName: session.actorRef.acct || email,
    lastUsedAt: Date.now(),
  });
  if (!account) return;

  const current = await loadRememberedLoginAccounts(session.stationPeerId);
  const next = [
    account,
    ...current.filter((item) => item.ptid !== account.ptid && item.email !== account.email),
  ].slice(0, 12);
  await setSecureStorageValue(scopedAccountHistoryKey(session.stationPeerId), JSON.stringify(next));
}

async function persistAuthSession(session: MobileAuthSession): Promise<void> {
  const scope = mobileAuthScope(session);
  await setSecureStorageValue(scopedAuthSessionKey(scope.stationPeerId, scope.ptid), JSON.stringify(session));
  await setSecureStorageValue(ACTIVE_AUTH_SCOPE_KEY, JSON.stringify(scope));
  await removeSecureStorageValue(LEGACY_AUTH_SESSION_KEY);
}

function normalizeRememberedAccount(input: Partial<RememberedLoginAccount> | undefined): RememberedLoginAccount | null {
  if (!input) return null;
  const stationPeerId = String(input.stationPeerId ?? '').trim();
  const stationUrl = String(input.stationUrl ?? '').replace(/\/+$/, '');
  const email = String(input.email ?? '').trim();
  const ptid = String(input.ptid ?? '').trim();
  if (!stationPeerId || !stationUrl || !email || !ptid) return null;
  return {
    stationPeerId,
    stationUrl,
    email,
    ptid,
    displayName: String(input.displayName ?? email),
    lastUsedAt: Number(input.lastUsedAt ?? 0),
  };
}

function scopedAuthSessionKey(stationPeerId: string, ptid: string): string {
  return `${AUTH_SESSION_KEY_PREFIX}.${safeScopePart(stationPeerId)}.${safeScopePart(ptid)}`;
}

function scopedAccountHistoryKey(stationPeerId: string): string {
  return `${AUTH_ACCOUNT_HISTORY_KEY_PREFIX}.${safeScopePart(stationPeerId)}`;
}

function safeScopePart(value: string): string {
  return encodeURIComponent(value);
}

export function isAccessGranted(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION_GRANTED || decision?.state === 'ACCESS_DECISION_STATE_GRANTED';
}

export function isAccessActionRequired(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION_ACTION_REQUIRED || decision?.state === 'ACCESS_DECISION_STATE_ACTION_REQUIRED';
}

export function isAccessBlocked(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION_BLOCKED || decision?.state === 'ACCESS_DECISION_STATE_BLOCKED';
}

export function accessDecisionMessage(decision: AccessDecision | null): string {
  if (!decision) return '';
  if (decision.message) return decision.message;
  return decision.gates.map((gate) => gate.blockingReason).find(Boolean) ?? '';
}

export function normalizeDecision(raw?: RawAccessDecision): AccessDecision {
  return {
    state: raw?.state ?? 0,
    attemptId: raw?.attempt_id ?? raw?.attemptId ?? '',
    currentGateId: raw?.current_gate_id ?? raw?.currentGateId,
    accessGrantId: raw?.access_grant_id ?? raw?.accessGrantId,
    message: raw?.message,
    gates: (raw?.gates ?? []).map((gate) => ({
      gateId: gate.gate_id ?? gate.gateId ?? '',
      type: gate.type ?? 0,
      state: gate.state ?? 0,
      title: gate.title,
      description: gate.description,
      blockingReason: gate.blocking_reason ?? gate.blockingReason,
      submitAction: gate.submit_action ?? gate.submitAction,
      inputSchemaJson: gate.input_schema_json ?? gate.inputSchemaJson,
    })),
  };
}
