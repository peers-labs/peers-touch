import {
  accessCancel,
  accessDecision,
  accessStart,
  accessSubmit,
  getSecureStorageValue,
  removeSecureStorageValue,
  setSecureStorageValue,
  type NativeAccessGateInput,
  type NativeAccessProjection,
  type NativeGenericFieldValue,
  type OAuthAccessDecisionProjection,
  type OAuthSessionProjection,
} from '../../services/mobileCommands';
import {
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
export const ACCESS_GATE_TYPE_DEVICE_TRUST = 6;
export const ACCESS_GATE_TYPE_TERMS_ACCEPTANCE = 8;
export const ACCESS_GATE_TYPE_AUTH_OAUTH = 9;
export const ACCESS_GATE_TYPE_CUSTOM = 100;
export const ACCESS_GATE_STATE_ACTION_REQUIRED = 2;
export const ACCESS_DECISION_PENDING = 1;
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
  options?: AccessGateFieldOption[];
}

export interface AccessGateFieldOption {
  value: string;
  label?: string;
}

export interface AccessGateAction {
  actionId: string;
  type: string;
  submitAction: string;
  schemaRevision: number;
  schemaDigest: string;
}

export interface AccessGate {
  gateId: string;
  type: string;
  state: string;
  title?: string;
  description?: string;
  blockingReason?: string;
  submitAction?: string;
  inputSchemaJson?: string;
  alternativeActions: AccessGateAction[];
  actionId: string;
  schemaRevision: number;
  schemaDigest: string;
}

export interface NativeAccessSession {
  stationPeerId: string;
  stationUrl: string;
  sessionId: string;
  actorPtid: string;
  deviceId: string;
  lifecycleGeneration: number;
  expiresAt: string;
}

/** Parse a gate's input_schema_json into a field list. Unparseable schemas
 * yield an empty list so the host can fall back to its default rendering. */
export function parseGateFields(gate: AccessGate | undefined): AccessGateField[] {
  if (!gate?.inputSchemaJson) return [];
  try {
    const parsed = JSON.parse(gate.inputSchemaJson) as { fields?: unknown[] };
    if (!Array.isArray(parsed.fields)) return [];
    return parsed.fields.flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
      const type = typeof candidate.type === 'string' ? candidate.type.trim().toLowerCase() : '';
      if (!name || !type) return [];
      const options = Array.isArray(candidate.options)
        ? candidate.options.flatMap((option) => {
            if (typeof option === 'string') return [{ value: option }];
            if (!isRecord(option) || typeof option.value !== 'string') return [];
            return [{
              value: option.value,
              ...(typeof option.label === 'string' ? { label: option.label } : {}),
            }];
          })
        : undefined;
      return [{
        name,
        type,
        ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
        ...(typeof candidate.required === 'boolean' ? { required: candidate.required } : {}),
        ...(typeof candidate.placeholder === 'string'
          ? { placeholder: candidate.placeholder }
          : {}),
        ...(options ? { options } : {}),
      }];
    });
  } catch {
    return [];
  }
}

/** True when the gate type denotes self-service invite-code redemption. */
export function isInviteCodeGate(gate: AccessGate | undefined): boolean {
  return gate?.type === 'ACCESS_GATE_TYPE_INVITE_CODE';
}

/** True when the gate type denotes the login credential gate. */
export function isLoginGate(gate: AccessGate | undefined): boolean {
  return gate?.type === 'ACCESS_GATE_TYPE_AUTH_LOGIN';
}

export interface AdvertisedCredentialChoices {
  emailPassword: boolean;
  oauth: boolean;
}

/**
 * Project only credential actions whose complete Station advertisement maps
 * to a transport Mobile currently supports. Unknown actions stay in the gate
 * model but never become UI fallbacks.
 */
export function advertisedCredentialChoices(
  gate: AccessGate | undefined,
): AdvertisedCredentialChoices {
  if (!isLoginGate(gate)) {
    return { emailPassword: false, oauth: false };
  }
  const actions = gate?.alternativeActions ?? [];
  return {
    emailPassword: actions.some((action) => (
      action.actionId === 'auth.password'
      && action.submitAction === 'submit_login'
      && action.type === 'ACCESS_GATE_TYPE_AUTH_LOGIN'
    )),
    oauth: actions.some((action) => (
      action.actionId === 'auth.oauth'
      && action.submitAction === 'start_oauth'
      && action.type === 'ACCESS_GATE_TYPE_AUTH_OAUTH'
    )),
  };
}

/** True for Station-owned schema gates whose values remain opaque to Mobile. */
export function isSchemaDrivenGate(gate: AccessGate | undefined): boolean {
  return isTermsAcceptanceGate(gate)
    || isCustomGate(gate);
}

export function isDeviceTrustGate(gate: AccessGate | undefined): boolean {
  return gate?.type === 'ACCESS_GATE_TYPE_DEVICE_TRUST';
}

export function isTermsAcceptanceGate(gate: AccessGate | undefined): boolean {
  return gate?.type === 'ACCESS_GATE_TYPE_TERMS_ACCEPTANCE'
    || gate?.type === 'ACCESS_GATE_TYPE_TERMS';
}

export function isCustomGate(gate: AccessGate | undefined): boolean {
  return gate?.type === 'ACCESS_GATE_TYPE_CUSTOM';
}

export interface AccessDecision {
  state: string;
  attemptId: string;
  currentGateId?: string;
  gates: AccessGate[];
  accessGrantId?: string;
  expiresAtUnixMs?: number;
  message?: string;
}

export const STATION_ACCESS_UNKNOWN_GATE = 'STATION_ACCESS_UNKNOWN_GATE';
export const STATION_ACCESS_IDENTITY_MISMATCH = 'STATION_ACCESS_IDENTITY_MISMATCH';
export const STATION_ACCESS_ATTEMPT_EXPIRED = 'STATION_ACCESS_ATTEMPT_EXPIRED';

export type StationAccessFailureOutcome =
  | typeof STATION_ACCESS_UNKNOWN_GATE
  | typeof STATION_ACCESS_IDENTITY_MISMATCH
  | typeof STATION_ACCESS_ATTEMPT_EXPIRED;

export class StationAccessOutcomeError extends Error {
  readonly code: StationAccessFailureOutcome;

  constructor(code: StationAccessFailureOutcome) {
    super(code);
    this.name = 'StationAccessOutcomeError';
    this.code = code;
  }
}

const AUTH_ACCOUNT_HISTORY_KEY_PREFIX = 'peers-touch.mobile.auth-accounts.v1';
const MAX_PENDING_ACCESS_SUBMISSIONS = 32;
const pendingAccessSubmissions = new Map<string, string>();
let oauthAccessGrantFinalizer: (() => Promise<void>) | null = null;
const KNOWN_GATE_TYPES = new Set([
  'ACCESS_GATE_TYPE_STATION_CAPABILITY',
  'ACCESS_GATE_TYPE_AUTH_LOGIN',
  'ACCESS_GATE_TYPE_AUTH_SESSION_RESTORE',
  'ACCESS_GATE_TYPE_INVITE_ALLOWLIST',
  'ACCESS_GATE_TYPE_INVITE_CODE',
  'ACCESS_GATE_TYPE_DEVICE_TRUST',
  'ACCESS_GATE_TYPE_MAINTENANCE',
  'ACCESS_GATE_TYPE_TERMS_ACCEPTANCE',
  'ACCESS_GATE_TYPE_AUTH_OAUTH',
  'ACCESS_GATE_TYPE_CUSTOM',
]);

// Locale keys used as error identifiers. Callers should translate with t().
export const AUTH_ERROR_KEYS = {
  LOGIN_FAILED: 'mobile.auth.loginFailed',
  GATE_UNAVAILABLE: 'mobile.auth.gateUnavailable',
  GATE_MISSING_ATTEMPT: 'mobile.auth.gateMissingAttempt',
  GATE_ATTEMPT_MISMATCH: 'mobile.auth.gateAttemptMismatch',
  GATE_REFRESH_FAILED: 'mobile.auth.gateRefreshFailed',
  GATE_CANCEL_FAILED: 'mobile.auth.gateCancelFailed',
  GATE_CANCEL_INVALID: 'mobile.auth.gateCancelInvalid',
  GATE_NOT_READY: 'mobile.auth.gateNotReady',
  ACCESS_DENIED: 'mobile.auth.accessDenied',
  MISSING_SESSION: 'mobile.auth.missingSession',
  MISSING_IDENTITY_SCOPE: 'mobile.auth.missingIdentityScope',
  INVITE_CODE_REQUIRED: 'mobile.auth.inviteCodeRequired',
  INVITE_CODE_REJECTED: 'mobile.auth.inviteCodeRejected',
} as const;

export async function loginToStation(
  input: StationLoginInput,
): Promise<NativeAccessSession | null> {
  const decision = await startStationAccessAttempt(input.stationPeerId, input.stationUrl);
  const gate = requireCurrentGate(decision);
  const result = await submitStationLoginGate({
    stationPeerId: input.stationPeerId,
    stationUrl: input.stationUrl,
    attemptId: decision.attemptId,
    gate,
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
  const result = await callAccess(() => accessStart({
      stationOrigin: stationUrl.replace(/\/+$/, ''),
      stationPeerId: stationPeerId.trim(),
      locale: globalThis.navigator?.language ?? '',
      sessionId,
    }));
  const decision = accessDecisionFromProjection(result.decision);
  if (!decision.attemptId) throw new Error(AUTH_ERROR_KEYS.GATE_MISSING_ATTEMPT);
  return decision;
}

export async function getStationAccessDecision(input: {
  stationPeerId: string;
  stationUrl: string;
  attemptId: string;
}): Promise<AccessDecision> {
  const attemptId = input.attemptId.trim();
  if (!attemptId) throw new Error(AUTH_ERROR_KEYS.GATE_MISSING_ATTEMPT);
  const result = await callAccess(() => accessDecision({
    stationOrigin: input.stationUrl.replace(/\/+$/, ''),
    stationPeerId: input.stationPeerId.trim(),
    attemptId,
  }));
  const decision = accessDecisionFromProjection(result.decision);
  if (!decision.attemptId) throw new Error(AUTH_ERROR_KEYS.GATE_MISSING_ATTEMPT);
  if (decision.attemptId !== attemptId) {
    throw new Error(AUTH_ERROR_KEYS.GATE_ATTEMPT_MISMATCH);
  }
  if (isAccessGranted(decision) && oauthAccessGrantFinalizer) {
    await oauthAccessGrantFinalizer();
  }
  return decision;
}

export async function cancelStationAccessAttempt(input: {
  stationPeerId: string;
  stationUrl: string;
  attemptId: string;
}): Promise<boolean> {
  const attemptId = input.attemptId.trim();
  if (!attemptId) throw new Error(AUTH_ERROR_KEYS.GATE_MISSING_ATTEMPT);
  return callAccess(() => accessCancel({
    stationOrigin: input.stationUrl.replace(/\/+$/, ''),
    stationPeerId: input.stationPeerId.trim(),
    attemptId,
  }));
}

export async function submitStationLoginGate(input: StationLoginInput & {
  attemptId: string;
  gate: AccessGate;
  submissionId?: string;
}): Promise<{
  decision: AccessDecision;
  session: NativeAccessSession | null;
}> {
  const stationUrl = input.stationUrl.replace(/\/+$/, '');
  const result = await submitNativeAccessGate({
    stationPeerId: input.stationPeerId,
    stationUrl,
    attemptId: input.attemptId,
    gate: input.gate,
    submissionId: input.submissionId,
    actionInput: {
      kind: 'login',
      email: input.email.trim(),
      password: input.password,
    },
  });
  const decision = accessDecisionFromProjection(result.decision);
  const session = nativeAccessSession(input.stationPeerId, stationUrl, result.session);
  if (isAccessGranted(decision) && !session) throw new Error(AUTH_ERROR_KEYS.MISSING_SESSION);
  return { decision, session };
}

// submitStationInviteCodeGate redeems a self-service invite code for the live
// attempt and returns the re-evaluated decision. It never produces a session;
// the chain continues to the login gate once the code passes.
export async function submitStationInviteCodeGate(input: {
  stationPeerId: string;
  stationUrl: string;
  attemptId: string;
  gate: AccessGate;
  inviteCode: string;
  submissionId?: string;
}): Promise<{ decision: AccessDecision; session: NativeAccessSession | null }> {
  const stationUrl = input.stationUrl.replace(/\/+$/, '');
  const code = input.inviteCode.trim();
  if (!code) throw new Error(AUTH_ERROR_KEYS.INVITE_CODE_REQUIRED);

  const result = await submitNativeAccessGate({
    stationPeerId: input.stationPeerId,
    stationUrl,
    attemptId: input.attemptId,
    gate: input.gate,
    submissionId: input.submissionId,
    actionInput: { kind: 'invite_code', inviteCode: code },
  });
  const decision = accessDecisionFromProjection(result.decision);
  if (isAccessGranted(decision) && oauthAccessGrantFinalizer) {
    await oauthAccessGrantFinalizer();
  }
  return {
    decision,
    session: nativeAccessSession(input.stationPeerId, stationUrl, result.session),
  };
}

export async function submitStationSchemaGate(input: {
  stationPeerId: string;
  stationUrl: string;
  attemptId: string;
  gate: AccessGate;
  values: Record<string, string | boolean | number>;
  submissionId?: string;
}): Promise<{ decision: AccessDecision; session: NativeAccessSession | null }> {
  const fields = parseGateFields(input.gate);
  const values = fields.flatMap((field): NativeGenericFieldValue[] => {
    const value = input.values[field.name];
    if (value === undefined && !field.required) return [];
    return [{
      fieldName: field.name,
      value: scalarValue(field, value),
    }];
  });
  const result = await submitNativeAccessGate({
    stationPeerId: input.stationPeerId,
    stationUrl: input.stationUrl,
    attemptId: input.attemptId,
    gate: input.gate,
    submissionId: input.submissionId,
    actionInput: { kind: 'generic', fields: values },
  });
  const decision = accessDecisionFromProjection(result.decision);
  if (isAccessGranted(decision) && oauthAccessGrantFinalizer) {
    await oauthAccessGrantFinalizer();
  }
  return {
    decision,
    session: nativeAccessSession(input.stationPeerId, input.stationUrl, result.session),
  };
}

async function submitNativeAccessGate(input: {
  stationPeerId: string;
  stationUrl: string;
  attemptId: string;
  gate: AccessGate;
  actionInput: NativeAccessGateInput;
  submissionId?: string;
}): Promise<NativeAccessProjection> {
  const actionId = input.gate.actionId.trim();
  const schemaDigest = input.gate.schemaDigest.trim();
  if (!actionId || input.gate.schemaRevision <= 0 || !/^[a-f0-9]{64}$/i.test(schemaDigest)) {
    throw new Error(AUTH_ERROR_KEYS.GATE_UNAVAILABLE);
  }
  const pendingKey = pendingSubmissionKey(input);
  const submissionId = input.submissionId ?? pendingSubmissionId(pendingKey);
  const result = await callAccess(() => accessSubmit({
    stationOrigin: input.stationUrl.replace(/\/+$/, ''),
    stationPeerId: input.stationPeerId.trim(),
    attemptId: input.attemptId.trim(),
    gateId: input.gate.gateId,
    gateType: gateTypeNumber(input.gate.type),
    actionId,
    schemaRevision: input.gate.schemaRevision,
    schemaDigest,
    submissionId,
    input: input.actionInput,
  }));
  if (input.submissionId === undefined) {
    pendingAccessSubmissions.delete(pendingKey);
  }
  return result;
}

function nativeAccessSession(
  stationPeerId: string,
  stationUrl: string,
  session: OAuthSessionProjection | undefined,
): NativeAccessSession | null {
  const sessionId = session?.sessionId.trim();
  const actorPtid = session?.actorPtid.trim();
  const deviceId = session?.deviceId.trim();
  const lifecycleGeneration = session?.lifecycleGeneration ?? 0;
  const expiresAt = session?.expiresAt.trim();
  if (
    !sessionId
    || !actorPtid
    || !deviceId
    || !Number.isSafeInteger(lifecycleGeneration)
    || lifecycleGeneration <= 0
    || !expiresAt
  ) {
    return null;
  }
  return {
    stationPeerId: stationPeerId.trim(),
    stationUrl: stationUrl.replace(/\/+$/, ''),
    sessionId,
    actorPtid,
    deviceId,
    lifecycleGeneration,
    expiresAt,
  };
}

function scalarValue(
  field: AccessGateField,
  value: string | boolean | number | undefined,
): NativeGenericFieldValue['value'] {
  switch (field.type) {
    case 'checkbox':
    case 'boolean':
    case 'bool':
      if (typeof value !== 'boolean') throw new Error(AUTH_ERROR_KEYS.GATE_UNAVAILABLE);
      return { kind: 'boolean', value };
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new Error(AUTH_ERROR_KEYS.GATE_UNAVAILABLE);
      }
      return { kind: 'integer', value };
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(AUTH_ERROR_KEYS.GATE_UNAVAILABLE);
      }
      return { kind: 'number', value };
    case 'text':
    case 'string':
    case 'email':
    case 'select':
      if (typeof value !== 'string') throw new Error(AUTH_ERROR_KEYS.GATE_UNAVAILABLE);
      return { kind: 'string', value };
    default:
      throw new Error(AUTH_ERROR_KEYS.GATE_UNAVAILABLE);
  }
}

function gateTypeNumber(type: string): number {
  const values: Record<string, number> = {
    ACCESS_GATE_TYPE_AUTH_LOGIN,
    ACCESS_GATE_TYPE_INVITE_CODE,
    ACCESS_GATE_TYPE_DEVICE_TRUST,
    ACCESS_GATE_TYPE_TERMS_ACCEPTANCE,
    ACCESS_GATE_TYPE_AUTH_OAUTH,
    ACCESS_GATE_TYPE_CUSTOM,
  };
  const value = values[type];
  if (value === undefined) throw new Error(AUTH_ERROR_KEYS.GATE_UNAVAILABLE);
  return value;
}

function newSubmissionId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.some((value) => value !== 0)) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('mobile.auth.submissionIdentityUnavailable');
}

function pendingSubmissionKey(input: {
  stationPeerId: string;
  attemptId: string;
  gate: AccessGate;
}): string {
  return [
    input.stationPeerId.trim(),
    input.attemptId.trim(),
    input.gate.gateId.trim(),
    input.gate.actionId.trim(),
    String(input.gate.schemaRevision),
    input.gate.schemaDigest.trim().toLowerCase(),
  ].join('\u0000');
}

function pendingSubmissionId(key: string): string {
  const existing = pendingAccessSubmissions.get(key);
  if (existing) return existing;
  if (pendingAccessSubmissions.size >= MAX_PENDING_ACCESS_SUBMISSIONS) {
    const oldest = pendingAccessSubmissions.keys().next().value;
    if (oldest !== undefined) pendingAccessSubmissions.delete(oldest);
  }
  const created = newSubmissionId();
  pendingAccessSubmissions.set(key, created);
  return created;
}

function requireCurrentGate(decision: AccessDecision): AccessGate {
  const gate = currentAccessGate(decision);
  if (!gate) throw new Error(AUTH_ERROR_KEYS.GATE_NOT_READY);
  return gate;
}

export function registerOAuthAccessGrantFinalizer(finalizer: () => Promise<void>): () => void {
  oauthAccessGrantFinalizer = finalizer;
  return () => {
    if (oauthAccessGrantFinalizer === finalizer) oauthAccessGrantFinalizer = null;
  };
}

export async function loadRememberedLoginAccounts(stationPeerId?: string): Promise<RememberedLoginAccount[]> {
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

export async function rememberLoginAccount(
  session: MobileAuthSession | {
    stationPeerId: string;
    stationUrl: string;
    actorPtid: string;
  },
  email: string,
): Promise<void> {
  const actorPtid = 'actorRef' in session ? session.actorRef.ptid : session.actorPtid;
  const actorLabel = 'actorRef' in session ? session.actorRef.acct : undefined;
  const account = normalizeRememberedAccount({
    stationPeerId: session.stationPeerId,
    stationUrl: session.stationUrl,
    email,
    ptid: actorPtid,
    displayName: actorLabel || email,
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

function scopedAccountHistoryKey(stationPeerId: string): string {
  return `${AUTH_ACCOUNT_HISTORY_KEY_PREFIX}.${safeScopePart(stationPeerId)}`;
}

function safeScopePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isAccessGranted(decision: AccessDecision | null): boolean {
  return decision?.state === 'ACCESS_DECISION_STATE_GRANTED';
}

export function isAccessActionRequired(decision: AccessDecision | null): boolean {
  return decision?.state === 'ACCESS_DECISION_STATE_ACTION_REQUIRED';
}

export function isAccessPending(decision: AccessDecision | null): boolean {
  return decision?.state === 'ACCESS_DECISION_STATE_PENDING';
}

export function isAccessBlocked(decision: AccessDecision | null): boolean {
  return decision?.state === 'ACCESS_DECISION_STATE_BLOCKED';
}

export function isAccessFailed(decision: AccessDecision | null): boolean {
  return decision?.state === 'ACCESS_DECISION_STATE_FAILED';
}

export function currentAccessGate(decision: AccessDecision | null): AccessGate | undefined {
  if (!decision?.currentGateId) return undefined;
  return decision.gates.find((gate) => gate.gateId === decision.currentGateId);
}

export function stationAccessFailureOutcome(
  value: AccessDecision | unknown,
  now = Date.now(),
): StationAccessFailureOutcome | null {
  if (isAccessDecision(value)) {
    if (
      value.expiresAtUnixMs !== undefined
      && (!Number.isFinite(value.expiresAtUnixMs) || value.expiresAtUnixMs <= now)
    ) {
      return STATION_ACCESS_ATTEMPT_EXPIRED;
    }
    if (value.state === 'ACCESS_DECISION_STATE_ACTION_REQUIRED') {
      const gate = currentAccessGate(value);
      if (!gate || !KNOWN_GATE_TYPES.has(gate.type)) {
        return STATION_ACCESS_UNKNOWN_GATE;
      }
    }
  }

  const message = accessFailureText(value);
  if (/access attempt.*(?:expired|not found)|attempt.*expired/i.test(message)) {
    return STATION_ACCESS_ATTEMPT_EXPIRED;
  }
  if (/station[_ .-]?identity.*mismatch|identity.*mismatch|peer.*mismatch/i.test(message)) {
    return STATION_ACCESS_IDENTITY_MISMATCH;
  }
  if (/unsupported.*(?:access )?gate|unknown.*gate|gate.*unsupported/i.test(message)) {
    return STATION_ACCESS_UNKNOWN_GATE;
  }
  return null;
}

export function requireSupportedAccessDecision(
  decision: AccessDecision,
  now = Date.now(),
): AccessDecision {
  const outcome = stationAccessFailureOutcome(decision, now);
  if (outcome) throw new StationAccessOutcomeError(outcome);
  return decision;
}

export function stationAccessError(error: unknown): Error {
  if (error instanceof StationAccessOutcomeError) return error;
  const outcome = stationAccessFailureOutcome(error);
  if (outcome) return new StationAccessOutcomeError(outcome);
  return error instanceof Error ? error : new Error(String(error));
}

export function accessDecisionMessage(decision: AccessDecision | null): string {
  if (!decision) return '';
  if (decision.message) return decision.message;
  return decision.gates.map((gate) => gate.blockingReason).find(Boolean) ?? '';
}

export function accessDecisionFromProjection(
  projection: OAuthAccessDecisionProjection,
): AccessDecision {
  return requireSupportedAccessDecision({
    state: projection.state,
    attemptId: projection.attemptId,
    currentGateId: projection.currentGateId,
    accessGrantId: projection.accessGrantId,
    expiresAtUnixMs: projection.expiresAtUnixMs,
    message: projection.message,
    gates: projection.gates.map((gate) => ({
      gateId: gate.gateId,
      type: gate.gateType,
      state: gate.state,
      title: gate.title,
      description: gate.description,
      blockingReason: gate.blockingReason,
      submitAction: gate.submitAction,
      inputSchemaJson: gate.inputSchemaJson,
      actionId: gate.actionId,
      schemaRevision: gate.schemaRevision,
      schemaDigest: gate.schemaDigest,
      alternativeActions: gate.alternativeActions
        .map((action) => ({
          actionId: action.actionId,
          type: action.actionType,
          submitAction: action.submitAction,
          schemaRevision: action.schemaRevision,
          schemaDigest: action.schemaDigest,
        })),
    })),
  });
}

async function callAccess<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw stationAccessError(error);
  }
}

function isAccessDecision(value: unknown): value is AccessDecision {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as Partial<AccessDecision>).state === 'string'
    && Array.isArray((value as Partial<AccessDecision>).gates),
  );
}

function accessFailureText(value: unknown): string {
  if (value instanceof Error) {
    const code = (value as Error & { code?: unknown }).code;
    return `${String(code ?? '')} ${value.message}`;
  }
  return safeString(value);
}

function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}
