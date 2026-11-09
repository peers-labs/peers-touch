/**
 * Local Access Gate contract — a prototype-local mirror of the real mobile
 * access decision machine (apps/mobile/src/features/auth/authSession.ts and
 * model/domain/access_gate/access_gate.proto).
 *
 * The prototype has no Station RPC transport, so accessStart/accessSubmit are
 * simulated by deterministic fixture decisions. The CONTRACT is not simulated
 * away: gate type numbers, decision states, the Station-owned input schema,
 * advertised credential choices, gate chaining and the GRANTED admission fence
 * keep the same shape and semantics as the native client, so the rendered gate
 * is a state injection of the real product, never a second skin.
 */

// ── Proto-aligned enumeration values (access_gate.proto, never re-numbered) ──

export const ACCESS_GATE_TYPE = {
  STATION_CAPABILITY: 1,
  AUTH_LOGIN: 2,
  AUTH_SESSION_RESTORE: 3,
  INVITE_ALLOWLIST: 4,
  INVITE_CODE: 5,
  DEVICE_TRUST: 6,
  MAINTENANCE: 7,
  TERMS_ACCEPTANCE: 8,
  AUTH_OAUTH: 9,
  CUSTOM: 100,
} as const;

export const ACCESS_GATE_STATE = {
  UNSPECIFIED: 0,
  PENDING: 1,
  ACTION_REQUIRED: 2,
  PASSED: 3,
  BLOCKED: 4,
  FAILED: 5,
  SKIPPED: 6,
} as const;

export const ACCESS_DECISION = {
  UNSPECIFIED: 0,
  PENDING: 1,
  ACTION_REQUIRED: 2,
  GRANTED: 3,
  BLOCKED: 4,
  FAILED: 5,
} as const;

// ── Decision model (same field semantics as authSession.AccessDecision) ──

export interface AccessGateFieldOption {
  value: string;
  label?: string;
}

export interface AccessGateField {
  name: string;
  type: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
  options?: AccessGateFieldOption[];
}

export interface AccessGateAction {
  actionId: string;
  type: number | string;
  submitAction: string;
  schemaRevision: number;
  schemaDigest: string;
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
  alternativeActions: AccessGateAction[];
  actionId: string;
  schemaRevision: number;
  schemaDigest: string;
}

export interface AccessDecision {
  state: number;
  attemptId: string;
  currentGateId?: string;
  gates: AccessGate[];
  accessGrantId?: string;
  expiresAtUnixMs?: number;
  message?: string;
}

/** Station-owned gate profiles. A Station advertises exactly one access
    policy; the prototype binds one profile per seed Station. */
export type GateProfileId =
  | 'login-full'
  | 'login-email'
  | 'login-oauth'
  | 'invite-then-login'
  | 'terms-schema'
  | 'custom-schema'
  | 'device-trust'
  | 'blocked'
  | 'failed'
  | 'pending';

export type OAuthPhase =
  | 'idle'
  | 'starting'
  | 'awaiting_provider'
  | 'callback_received'
  | 'exchanging'
  | 'credential_delivery'
  | 'active_session'
  | 'failed';

/** Providers the native host's directory can advertise; same fixed catalog
    as authRuntime KNOWN_OAUTH_PROVIDERS. */
export type OAuthProvider = 'github' | 'google';

export type OAuthRecovery = 'none' | 'retry-provider' | 'check-status' | 'restart' | 'change-station';

// ── Pure classifiers (mirror authSession.ts one-for-one) ──

export function isAccessGranted(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION.GRANTED;
}

export function isAccessActionRequired(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION.ACTION_REQUIRED;
}

export function isAccessPending(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION.PENDING;
}

export function isAccessBlocked(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION.BLOCKED;
}

export function isAccessFailed(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION.FAILED;
}

export function currentAccessGate(decision: AccessDecision | null): AccessGate | undefined {
  if (!decision?.currentGateId) return undefined;
  return decision.gates.find(gate => gate.gateId === decision.currentGateId);
}

export function isInviteCodeGate(gate: AccessGate | undefined): boolean {
  return gate?.type === ACCESS_GATE_TYPE.INVITE_CODE;
}

export function isLoginGate(gate: AccessGate | undefined): boolean {
  return gate?.type === ACCESS_GATE_TYPE.AUTH_LOGIN;
}

export function isDeviceTrustGate(gate: AccessGate | undefined): boolean {
  return gate?.type === ACCESS_GATE_TYPE.DEVICE_TRUST;
}

export function isTermsAcceptanceGate(gate: AccessGate | undefined): boolean {
  return gate?.type === ACCESS_GATE_TYPE.TERMS_ACCEPTANCE;
}

export function isCustomGate(gate: AccessGate | undefined): boolean {
  return gate?.type === ACCESS_GATE_TYPE.CUSTOM;
}

/** Station-owned schema gates whose field values stay opaque to the client. */
export function isSchemaDrivenGate(gate: AccessGate | undefined): boolean {
  return isTermsAcceptanceGate(gate) || isCustomGate(gate);
}

export interface AdvertisedCredentialChoices {
  emailPassword: boolean;
  oauth: boolean;
}

/** Project only credential actions whose complete Station advertisement maps
    to a transport the client supports — same predicate as the native host. */
export function advertisedCredentialChoices(gate: AccessGate | undefined): AdvertisedCredentialChoices {
  if (!isLoginGate(gate)) return { emailPassword: false, oauth: false };
  const actions = gate?.alternativeActions ?? [];
  return {
    emailPassword: actions.some(action => (
      action.actionId === 'auth.password'
      && action.submitAction === 'submit_login'
      && action.type === ACCESS_GATE_TYPE.AUTH_LOGIN
    )),
    oauth: actions.some(action => (
      action.actionId === 'auth.oauth'
      && action.submitAction === 'start_oauth'
      && action.type === ACCESS_GATE_TYPE.AUTH_OAUTH
    )),
  };
}

/** Parse a gate's input_schema_json into a field list. Unparseable schemas
    yield an empty list so the host falls back to its default rendering. */
export function parseGateFields(gate: AccessGate | undefined): AccessGateField[] {
  if (!gate?.inputSchemaJson) return [];
  try {
    const parsed = JSON.parse(gate.inputSchemaJson) as { fields?: unknown[] };
    if (!Array.isArray(parsed.fields)) return [];
    return parsed.fields.flatMap((candidate): AccessGateField[] => {
      if (!isRecord(candidate)) return [];
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
      const type = typeof candidate.type === 'string' ? candidate.type.trim().toLowerCase() : '';
      if (!name || !type) return [];
      const options = Array.isArray(candidate.options)
        ? candidate.options.flatMap((option): AccessGateFieldOption[] => {
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
        ...(typeof candidate.placeholder === 'string' ? { placeholder: candidate.placeholder } : {}),
        ...(options ? { options } : {}),
      }];
    });
  } catch {
    return [];
  }
}

export function hasSchemaValue(
  field: { type: string },
  value: string | boolean | number | undefined,
): boolean {
  if (field.type === 'checkbox' || field.type === 'boolean' || field.type === 'bool') {
    return value === true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim().length > 0;
}

export function accessDecisionMessage(decision: AccessDecision | null): string {
  if (!decision) return '';
  if (decision.message) return decision.message;
  return decision.gates.map(gate => gate.blockingReason).find(Boolean) ?? '';
}

// ── Fixture construction ──

const FIXTURE_SCHEMA_DIGEST = 'a'.repeat(64);
const FIXTURE_SCHEMA_REVISION = 1;
/** Demo invite code advertised by the fixture Station; any other code is
    rejected so the failure branch stays reachable in the prototype. */
export const FIXTURE_INVITE_CODE = 'PEERS-2026';

function gateAction(actionId: string, submitAction: string, type: number): AccessGateAction {
  return { actionId, submitAction, type, schemaRevision: FIXTURE_SCHEMA_REVISION, schemaDigest: FIXTURE_SCHEMA_DIGEST };
}

function loginGate(credentials: { emailPassword: boolean; oauth: boolean }): AccessGate {
  const alternativeActions: AccessGateAction[] = [];
  if (credentials.emailPassword) {
    alternativeActions.push(gateAction('auth.password', 'submit_login', ACCESS_GATE_TYPE.AUTH_LOGIN));
  }
  if (credentials.oauth) {
    alternativeActions.push(gateAction('auth.oauth', 'start_oauth', ACCESS_GATE_TYPE.AUTH_OAUTH));
  }
  return {
    gateId: 'auth.login',
    type: ACCESS_GATE_TYPE.AUTH_LOGIN,
    state: ACCESS_GATE_STATE.ACTION_REQUIRED,
    actionId: 'auth.login',
    submitAction: 'submit_login',
    alternativeActions,
    schemaRevision: FIXTURE_SCHEMA_REVISION,
    schemaDigest: FIXTURE_SCHEMA_DIGEST,
  };
}

function inviteGate(): AccessGate {
  return {
    gateId: 'invite.code',
    type: ACCESS_GATE_TYPE.INVITE_CODE,
    state: ACCESS_GATE_STATE.ACTION_REQUIRED,
    description: 'mobile.auth.inviteCodeSubtitle',
    actionId: 'invite.code',
    submitAction: 'submit_invite_code',
    inputSchemaJson: JSON.stringify({
      fields: [{
        name: 'inviteCode',
        type: 'text',
        label: 'mobile.auth.inviteCode',
        placeholder: 'mobile.auth.inviteCode',
        required: true,
      }],
    }),
    alternativeActions: [],
    schemaRevision: FIXTURE_SCHEMA_REVISION,
    schemaDigest: FIXTURE_SCHEMA_DIGEST,
  };
}

function termsGate(): AccessGate {
  return {
    gateId: 'terms.accept',
    type: ACCESS_GATE_TYPE.TERMS_ACCEPTANCE,
    state: ACCESS_GATE_STATE.ACTION_REQUIRED,
    title: 'mobile.auth.termsTitle',
    description: 'mobile.auth.termsSubtitle',
    actionId: 'terms.accept',
    submitAction: 'submit_terms',
    inputSchemaJson: JSON.stringify({
      fields: [{
        name: 'accepted',
        type: 'checkbox',
        label: 'mobile.auth.termsAccept',
        required: true,
      }],
    }),
    alternativeActions: [],
    schemaRevision: FIXTURE_SCHEMA_REVISION,
    schemaDigest: FIXTURE_SCHEMA_DIGEST,
  };
}

function customGate(): AccessGate {
  return {
    gateId: 'custom.intake',
    type: ACCESS_GATE_TYPE.CUSTOM,
    state: ACCESS_GATE_STATE.ACTION_REQUIRED,
    title: 'mobile.auth.customTitle',
    description: 'mobile.auth.customSubtitle',
    actionId: 'custom.intake',
    submitAction: 'submit_custom',
    inputSchemaJson: JSON.stringify({
      fields: [
        {
          name: 'neighborhood',
          type: 'select',
          label: 'mobile.auth.customFieldNeighborhood',
          required: true,
          options: [
            { value: 'songlv', label: 'mobile.auth.customOptionSonglv' },
            { value: 'jiangbian', label: 'mobile.auth.customOptionJiangbian' },
          ],
        },
        { name: 'referral', type: 'text', label: 'mobile.auth.customFieldReferral', required: false },
      ],
    }),
    alternativeActions: [],
    schemaRevision: FIXTURE_SCHEMA_REVISION,
    schemaDigest: FIXTURE_SCHEMA_DIGEST,
  };
}

function deviceTrustGate(): AccessGate {
  return {
    gateId: 'device.trust',
    type: ACCESS_GATE_TYPE.DEVICE_TRUST,
    state: ACCESS_GATE_STATE.ACTION_REQUIRED,
    title: 'mobile.auth.deviceApprovalTitle',
    description: 'mobile.auth.deviceApprovalSubtitle',
    actionId: 'device.trust',
    submitAction: 'approve_device',
    alternativeActions: [],
    schemaRevision: FIXTURE_SCHEMA_REVISION,
    schemaDigest: FIXTURE_SCHEMA_DIGEST,
  };
}

function recoveryDecision(
  state: typeof ACCESS_DECISION.BLOCKED | typeof ACCESS_DECISION.FAILED | typeof ACCESS_DECISION.PENDING,
  attemptId: string,
  messageKey: string,
): AccessDecision {
  return {
    state,
    attemptId,
    currentGateId: 'access.recovery',
    gates: [{
      gateId: 'access.recovery',
      type: ACCESS_GATE_TYPE.MAINTENANCE,
      state,
      blockingReason: messageKey,
      actionId: 'access.recovery',
      alternativeActions: [],
      schemaRevision: FIXTURE_SCHEMA_REVISION,
      schemaDigest: FIXTURE_SCHEMA_DIGEST,
    }],
    message: messageKey,
  };
}

/** Build the Station-advertised fixture decision for a gate profile. The
    attempt id is stable for one launch flow, exactly like accessStart. */
export function buildFixtureDecision(profile: GateProfileId, attemptId: string): AccessDecision {
  switch (profile) {
    case 'login-full':
      return actionRequired(attemptId, loginGate({ emailPassword: true, oauth: true }), [loginGate({ emailPassword: true, oauth: true })]);
    case 'login-email':
      return actionRequired(attemptId, loginGate({ emailPassword: true, oauth: false }), [loginGate({ emailPassword: true, oauth: false })]);
    case 'login-oauth':
      return actionRequired(attemptId, loginGate({ emailPassword: false, oauth: true }), [loginGate({ emailPassword: false, oauth: true })]);
    case 'invite-then-login': {
      const invite = inviteGate();
      const login = loginGate({ emailPassword: true, oauth: true });
      return {
        state: ACCESS_DECISION.ACTION_REQUIRED,
        attemptId,
        currentGateId: invite.gateId,
        gates: [invite, login],
      };
    }
    case 'terms-schema':
      return actionRequired(attemptId, termsGate(), [termsGate()]);
    case 'custom-schema':
      return actionRequired(attemptId, customGate(), [customGate()]);
    case 'device-trust':
      return actionRequired(attemptId, deviceTrustGate(), [deviceTrustGate()]);
    case 'blocked':
      return recoveryDecision(ACCESS_DECISION.BLOCKED, attemptId, 'mobile.auth.blockedSubtitle');
    case 'failed':
      return recoveryDecision(ACCESS_DECISION.FAILED, attemptId, 'mobile.auth.failedSubtitle');
    case 'pending':
      return recoveryDecision(ACCESS_DECISION.PENDING, attemptId, 'mobile.auth.pendingSubtitle');
  }
}

function actionRequired(attemptId: string, gate: AccessGate, gates: AccessGate[]): AccessDecision {
  return {
    state: ACCESS_DECISION.ACTION_REQUIRED,
    attemptId,
    currentGateId: gate.gateId,
    gates,
  };
}

// ── Submit transition engine (local stand-in for accessSubmit) ──

export interface GateSubmitResult {
  decision: AccessDecision;
  granted: boolean;
  /** Locale key when the Station rejected the submission (decision FAILED). */
  errorKey: string | null;
}

function grantedDecision(previous: AccessDecision): AccessDecision {
  return {
    ...previous,
    state: ACCESS_DECISION.GRANTED,
    currentGateId: undefined,
    accessGrantId: `grant-${previous.attemptId}`,
    gates: previous.gates.map(gate => ({ ...gate, state: ACCESS_GATE_STATE.PASSED })),
    message: undefined,
  };
}

/** OAuth admission shares the GRANTED transition with credential submission:
    once the provider flow reaches active_session, the same attempt is granted. */
export function grantFixtureDecision(previous: AccessDecision): AccessDecision {
  return grantedDecision(previous);
}

/** Redeem an invite code. A valid code advances the chain to the next gate;
    an invalid code keeps the SAME action-required decision with an inline
    error — mirroring the native catch path, which never replaces the
    decision on submission rejection and never grants on its own. */
export function submitInviteFixture(decision: AccessDecision, code: string): GateSubmitResult {
  const gate = currentAccessGate(decision);
  if (!gate || !isInviteCodeGate(gate)) {
    return { decision, granted: false, errorKey: 'mobile.auth.gateNotReady' };
  }
  if (code.trim() !== FIXTURE_INVITE_CODE) {
    return { decision, granted: false, errorKey: 'mobile.auth.inviteCodeRejected' };
  }
  const nextGate = decision.gates.find(candidate => candidate.gateId !== gate.gateId);
  const advanced: AccessDecision = {
    ...decision,
    state: ACCESS_DECISION.ACTION_REQUIRED,
    currentGateId: nextGate?.gateId,
    gates: decision.gates.map(candidate => candidate.gateId === gate.gateId
      ? { ...candidate, state: ACCESS_GATE_STATE.PASSED }
      : candidate),
    message: undefined,
  };
  return { decision: advanced, granted: isAccessGranted(advanced), errorKey: null };
}

/** Email/password login. The fixture enforces the same canLogin rule as the
    native host; a rejected submission preserves the decision and surfaces an
    inline error, any non-empty credential pair is admitted locally. */
export function submitLoginFixture(
  decision: AccessDecision,
  credentials: { email: string; password: string },
): GateSubmitResult {
  const gate = currentAccessGate(decision);
  if (!gate || !isLoginGate(gate)) {
    return { decision, granted: false, errorKey: 'mobile.auth.gateNotReady' };
  }
  if (!credentials.email.trim() || !credentials.password) {
    return { decision, granted: false, errorKey: 'mobile.auth.loginFailed' };
  }
  const granted = grantedDecision(decision);
  return { decision: granted, granted: true, errorKey: null };
}

/** Submit a Station-owned schema gate. Required-field validation mirrors
    hasSchemaValue; an invalid submission stays on the same gate with an
    inline error, a valid one admits through the GRANTED transition. */
export function submitSchemaFixture(
  decision: AccessDecision,
  values: Record<string, string | boolean | number>,
): GateSubmitResult {
  const gate = currentAccessGate(decision);
  if (!gate || !isSchemaDrivenGate(gate)) {
    return { decision, granted: false, errorKey: 'mobile.auth.gateNotReady' };
  }
  const fields = parseGateFields(gate);
  const missingRequired = fields.some(field => field.required && !hasSchemaValue(field, values[field.name]));
  if (missingRequired) {
    return { decision, granted: false, errorKey: 'mobile.auth.gateUnavailable' };
  }
  const granted = grantedDecision(decision);
  return { decision: granted, granted: true, errorKey: null };
}

/** Re-evaluate a recovery-only attempt. Blocked/failed Stations stay closed
    in the fixture (the user must change Station); a pending attempt retries
    into its original gate profile. */
export function refreshFixtureDecision(decision: AccessDecision, profile: GateProfileId): AccessDecision {
  if (isAccessPending(decision)) {
    return buildFixtureDecision(profile, decision.attemptId);
  }
  return decision;
}

// ── OAuth phase machine (prototype subset of authRuntime PUBLIC_PHASES) ──

/** Happy-path phases driven by the view's local timer; the native transport
    runs the same sequence before active_session. */
export const OAUTH_SUCCESS_SEQUENCE: readonly OAuthPhase[] = [
  'starting',
  'awaiting_provider',
  'callback_received',
  'exchanging',
  'credential_delivery',
  'active_session',
];

export function nextOAuthPhase(phase: OAuthPhase): OAuthPhase {
  const index = OAUTH_SUCCESS_SEQUENCE.indexOf(phase);
  if (index < 0 || index === OAUTH_SUCCESS_SEQUENCE.length - 1) return phase;
  return OAUTH_SUCCESS_SEQUENCE[index + 1];
}

/** Locale key for an OAuth phase, same key contract as oauthPhaseMessageKey. */
export function oauthPhaseMessageKey(phase: OAuthPhase): string {
  if (phase === 'credential_delivery') return 'mobile.auth.oauthState.exchanging';
  return `mobile.auth.oauthState.${phase.replace(/_/g, '-')}`;
}

export function oauthRecovery(phase: OAuthPhase, errorKey: string | null): OAuthRecovery {
  if (phase === 'credential_delivery') return 'check-status';
  if (errorKey === 'mobile.auth.oauthBrowserUnavailable') return 'retry-provider';
  if (errorKey === 'mobile.auth.oauthStationMismatch') return 'change-station';
  if (phase === 'failed') return 'restart';
  return 'none';
}

// ── Remembered accounts (localStorage, Station-scoped, cap 12) ──

const REMEMBERED_PREFIX = 'peers-touch:prototype:auth-accounts';
const REMEMBERED_CAP = 12;

function storageKey(stationId: string): string {
  return `${REMEMBERED_PREFIX}.${stationId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export function loadRememberedEmails(stationId: string): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(stationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  } catch {
    return [];
  }
}

export function rememberEmail(stationId: string, email: string): string[] {
  const normalized = email.trim();
  if (!normalized) return loadRememberedEmails(stationId);
  const next = [normalized, ...loadRememberedEmails(stationId).filter(value => value !== normalized)]
    .slice(0, REMEMBERED_CAP);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(storageKey(stationId), JSON.stringify(next));
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ── Prototype access runtime projection (mirrors accessRuntime snapshot) ──

export interface AccessRuntimeState {
  /** idle = station picker; handshake = discovery/decision fetch in flight;
      gate = a decision is rendered by AccessGateView. */
  phase: 'idle' | 'handshake' | 'gate';
  attemptId: string;
  decision: AccessDecision | null;
  loading: boolean;
  errorKey: string | null;
  oauthPhase: OAuthPhase;
  oauthErrorKey: string | null;
  /** Only a user-started provider flow drives the local phase timer;
      fixture-seeded evidence phases stay frozen for inspection. */
  oauthStarted: boolean;
  rememberedEmails: string[];
  sessionExpired: boolean;
  /** Gate profile bound to the active Station; refresh rebuilds its fixture. */
  profile: GateProfileId | null;
}

export function emptyAccessState(): AccessRuntimeState {
  return {
    phase: 'idle',
    attemptId: '',
    decision: null,
    loading: false,
    errorKey: null,
    oauthPhase: 'idle',
    oauthErrorKey: null,
    oauthStarted: false,
    rememberedEmails: [],
    sessionExpired: false,
    profile: null,
  };
}
