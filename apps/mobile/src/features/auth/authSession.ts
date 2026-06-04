import {
  getSecureStorageValue,
  removeSecureStorageValue,
  setSecureStorageValue,
} from '../../services/mobileCommands';

export interface MobileAuthSession {
  stationUrl: string;
  sessionId: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
  actor?: {
    id?: string;
    actorId?: number | string;
    actor_id?: number | string;
    username?: string;
    displayName?: string;
    display_name?: string;
    email?: string;
  };
  authenticatedAt: number;
}

export interface StationLoginInput {
  stationUrl: string;
  email: string;
  password: string;
}

export const ACCESS_GATE_TYPE_AUTH_LOGIN = 2;
export const ACCESS_DECISION_ACTION_REQUIRED = 2;
export const ACCESS_DECISION_GRANTED = 3;
export const ACCESS_DECISION_BLOCKED = 4;
export const ACCESS_DECISION_FAILED = 5;

export interface AccessGate {
  gateId: string;
  type: number | string;
  state: number | string;
  title?: string;
  description?: string;
  blockingReason?: string;
  submitAction?: string;
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

interface StationLoginPayload {
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
  actor?: MobileAuthSession['actor'];
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
}

const AUTH_SESSION_KEY = 'peers-touch.mobile.auth-session.v1';

// Locale keys used as error identifiers. Callers should translate with t().
export const AUTH_ERROR_KEYS = {
  LOGIN_FAILED: 'mobile.auth.loginFailed',
  GATE_UNAVAILABLE: 'mobile.auth.gateUnavailable',
  GATE_MISSING_ATTEMPT: 'mobile.auth.gateMissingAttempt',
  GATE_NOT_READY: 'mobile.auth.gateNotReady',
  ACCESS_DENIED: 'mobile.auth.accessDenied',
  MISSING_SESSION: 'mobile.auth.missingSession',
} as const;

export async function loginToStation(input: StationLoginInput): Promise<MobileAuthSession> {
  const decision = await startStationAccessAttempt(input.stationUrl);
  const result = await submitStationLoginGate({
    stationUrl: input.stationUrl,
    attemptId: decision.attemptId,
    email: input.email,
    password: input.password,
  });
  return result.session;
}

export async function startStationAccessAttempt(stationUrl: string, sessionId?: string): Promise<AccessDecision> {
  const baseUrl = stationUrl.replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/actor/access/start`, {
      body: JSON.stringify({
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
  persistenceError?: string;
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

  const accessToken = loginResponse.tokens?.access_token || loginResponse.tokens?.accessToken || loginResponse.tokens?.token;
  const sessionId = loginResponse.session_id || loginResponse.sessionId;
  if (!accessToken || !sessionId) {
    throw new Error(AUTH_ERROR_KEYS.MISSING_SESSION);
  }

  const session: MobileAuthSession = {
    stationUrl,
    sessionId,
    accessToken,
    refreshToken: loginResponse.tokens?.refresh_token || loginResponse.tokens?.refreshToken,
    tokenType: loginResponse.tokens?.token_type || loginResponse.tokens?.tokenType,
    expiresAt: loginResponse.tokens?.expires_at || loginResponse.tokens?.expiresAt,
    actor: normalizeAuthActor(loginResponse.actor),
    authenticatedAt: Date.now(),
  };

  const persistenceError = await persistAuthSession(session);
  return { decision, session, persistenceError };
}

function normalizeAuthActor(actor: MobileAuthSession['actor']): MobileAuthSession['actor'] {
  if (!actor) return undefined;
  const id = actor.id || (actor.actor_id ? String(actor.actor_id) : '') || (actor.actorId ? String(actor.actorId) : '');
  return {
    id,
    actorId: id || actor.actorId,
    username: actor.username,
    displayName: actor.displayName || actor.display_name,
    email: actor.email,
  };
}

export async function restoreAuthSession(): Promise<MobileAuthSession | null> {
  const raw = await getSecureStorageValue(AUTH_SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<MobileAuthSession>;
    if (!parsed.stationUrl || !parsed.sessionId || !parsed.accessToken || !parsed.authenticatedAt) return null;
    return { ...parsed, actor: normalizeAuthActor(parsed.actor) } as MobileAuthSession;
  } catch {
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  await removeSecureStorageValue(AUTH_SESSION_KEY);
}

async function persistAuthSession(session: MobileAuthSession): Promise<string | undefined> {
  try {
    await setSecureStorageValue(AUTH_SESSION_KEY, JSON.stringify(session));
    return undefined;
  } catch (error) {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return JSON.stringify(error);
  }
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

function normalizeDecision(raw?: RawAccessDecision): AccessDecision {
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
    })),
  };
}
