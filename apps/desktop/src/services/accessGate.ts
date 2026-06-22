// Desktop access-gate decision model and predicates.
//
// Transport lives in the Rust layer (`access_start`, `access_submit_invite_code`,
// `access_submit_login`); the frontend only normalizes the raw Station
// `AccessDecision` (snake_case keys, string-or-numeric enums) into a stable
// shape and decides which gate to render. This mirrors the mobile contract in
// `apps/mobile/src/features/auth/authSession.ts` so both clients stay aligned.

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

export interface AccessDecision {
  state: number | string;
  attemptId: string;
  currentGateId?: string;
  gates: AccessGate[];
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

export function normalizeDecision(raw: unknown): AccessDecision {
  const decision = (raw ?? {}) as RawAccessDecision;
  return {
    state: decision.state ?? 0,
    attemptId: decision.attempt_id ?? decision.attemptId ?? '',
    currentGateId: decision.current_gate_id ?? decision.currentGateId,
    accessGrantId: decision.access_grant_id ?? decision.accessGrantId,
    message: decision.message,
    gates: (decision.gates ?? []).map((gate) => ({
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

export function isAccessGranted(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION_GRANTED
    || decision?.state === 'ACCESS_DECISION_STATE_GRANTED';
}

export function isAccessActionRequired(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION_ACTION_REQUIRED
    || decision?.state === 'ACCESS_DECISION_STATE_ACTION_REQUIRED';
}

export function isAccessBlocked(decision: AccessDecision | null): boolean {
  return decision?.state === ACCESS_DECISION_BLOCKED
    || decision?.state === 'ACCESS_DECISION_STATE_BLOCKED';
}

export function accessDecisionMessage(decision: AccessDecision | null): string {
  if (!decision) return '';
  if (decision.message) return decision.message;
  return decision.gates.map((gate) => gate.blockingReason).find(Boolean) ?? '';
}
