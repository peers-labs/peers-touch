// Desktop access-gate projection and predicates. Rust owns protobuf decoding;
// the renderer receives one stable camelCase, string-enum contract.

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
  gateType: string;
  state: string;
  title: string;
  description: string;
  blockingReason: string;
  submitAction: string;
  inputSchemaJson: string;
  alternativeActions: AccessGateAction[];
  actionId: string;
  schemaRevision: number;
  schemaDigest: string;
}

export interface AccessGateAction {
  actionId: string;
  actionType: string;
  submitAction: string;
  schemaRevision: number;
  schemaDigest: string;
}

export interface AccessDecision {
  state: string;
  attemptId: string;
  currentGateId: string;
  gates: AccessGate[];
  actorPtid?: string;
  accessGrantId: string;
  expiresAtUnixMs?: number;
  message: string;
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

const pendingSubmissionIds = new Map<string, string>();
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

/** Parse a gate's input_schema_json into a field list. Unparseable schemas
 *  yield an empty list so the host can fall back to its default rendering. */
export function parseGateFields(gate: AccessGate | undefined): AccessGateField[] {
  if (!gate?.inputSchemaJson) return [];
  try {
    const parsed = JSON.parse(gate.inputSchemaJson) as { fields?: AccessGateField[] };
    return Array.isArray(parsed.fields) ? parsed.fields : [];
  } catch {
    return [];
  }
}

export function currentGate(decision: AccessDecision | null): AccessGate | undefined {
  if (!decision) return undefined;
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
      const gate = currentGate(value);
      if (!gate || !KNOWN_GATE_TYPES.has(gate.gateType)) {
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

/** True when the gate type denotes self-service invite-code redemption. */
export function isInviteCodeGate(gate: AccessGate | undefined): boolean {
  return gate?.gateType === 'ACCESS_GATE_TYPE_INVITE_CODE';
}

/** True when the gate type denotes the login credential gate. */
export function isLoginGate(gate: AccessGate | undefined): boolean {
  return gate?.gateType === 'ACCESS_GATE_TYPE_AUTH_LOGIN';
}

export function isAccessGranted(decision: AccessDecision | null): boolean {
  return decision?.state === 'ACCESS_DECISION_STATE_GRANTED';
}

export function isAccessActionRequired(decision: AccessDecision | null): boolean {
  return decision?.state === 'ACCESS_DECISION_STATE_ACTION_REQUIRED';
}

export function isAccessBlocked(decision: AccessDecision | null): boolean {
  return decision?.state === 'ACCESS_DECISION_STATE_BLOCKED';
}

export function accessDecisionMessage(decision: AccessDecision | null): string {
  if (!decision) return '';
  if (decision.message) return decision.message;
  return decision.gates.map((gate) => gate.blockingReason).find(Boolean) ?? '';
}

export function accessGateTypeNumber(gate: AccessGate): number {
  if (gate.gateType === 'ACCESS_GATE_TYPE_AUTH_LOGIN') return ACCESS_GATE_TYPE_AUTH_LOGIN;
  if (gate.gateType === 'ACCESS_GATE_TYPE_INVITE_CODE') return ACCESS_GATE_TYPE_INVITE_CODE;
  throw new Error('auth.gate.unsupported');
}

export function newAccessSubmissionId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value) throw new Error('auth.gate.submissionIdentityUnavailable');
  return value;
}

export function accessSubmissionDescriptor(attemptId: string, gate: AccessGate) {
  const key = [attemptId, gate.gateId, gate.actionId, gate.schemaRevision, gate.schemaDigest].join('\0');
  const submissionId = pendingSubmissionIds.get(key) ?? newAccessSubmissionId();
  pendingSubmissionIds.set(key, submissionId);
  return {
    key,
    gate_id: gate.gateId,
    gate_type: accessGateTypeNumber(gate),
    action_id: gate.actionId,
    schema_revision: gate.schemaRevision,
    schema_digest: gate.schemaDigest,
    submission_id: submissionId,
  };
}

export function completeAccessSubmission(key: string): void {
  pendingSubmissionIds.delete(key);
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
    const details = (value as Error & { details?: unknown }).details;
    return `${String(code ?? '')} ${value.message} ${safeString(details)}`;
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
