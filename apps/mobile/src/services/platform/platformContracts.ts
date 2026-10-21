export type ClientFormId = 'mobile';
export type ReleaseTargetId = 'android' | 'ios';

export type RuntimePortId =
  | 'clock'
  | 'random'
  | 'network'
  | 'secure-storage'
  | 'file-storage'
  | 'key-material'
  | 'notifications'
  | 'background-execution'
  | 'deep-link'
  | 'lifecycle'
  | 'telemetry'
  | 'system-action';

export type CapabilityFactState =
  | 'available'
  | 'unavailable'
  | 'denied'
  | 'restricted'
  | 'unsupported'
  | 'unknown';

export interface CapabilityFact {
  readonly capability: string;
  readonly releaseTarget: ReleaseTargetId;
  readonly state: CapabilityFactState;
  readonly observedAt: string;
  readonly source: string;
  readonly detail?: string;
}

export type AdmissionState =
  | 'available'
  | 'degraded'
  | 'blocked'
  | 'unknown';

export interface AdmissionProjection {
  readonly capability: string;
  readonly state: AdmissionState;
  readonly reasons: readonly string[];
  readonly facts: readonly CapabilityFact[];
  readonly stationPolicyRevision?: string;
  readonly runtimeRevision: string;
  readonly evaluatedAt: string;
}

export type RuntimeReadiness = 'ready' | 'degraded' | 'blocked' | 'unknown';
export type StationCapabilityPolicy = 'allowed' | 'denied' | 'unknown';
export type ProductCapabilityPolicy = 'required' | 'optional' | 'unsupported';

export interface AdmissionInput {
  readonly capability: string;
  readonly facts: readonly CapabilityFact[];
  readonly runtimeReadiness: RuntimeReadiness;
  readonly stationPolicy: StationCapabilityPolicy;
  readonly productPolicy: ProductCapabilityPolicy;
  readonly stationPolicyRevision?: string;
  readonly runtimeRevision: string;
  readonly evaluatedAt: string;
}

export type SystemAction =
  | { readonly kind: 'open_app_settings' }
  | { readonly kind: 'open_external_url'; readonly url: string }
  | {
    readonly kind: 'share';
    readonly text: string;
    readonly url?: string;
  }
  | { readonly kind: 'return_to_system' };

export interface SystemActionOutcome {
  readonly releaseTarget: ReleaseTargetId;
  readonly state: 'completed' | 'cancelled' | 'unavailable' | 'failed';
  readonly reason?: string;
}

export interface CapabilityFactPort {
  observe(capability: string): Promise<CapabilityFact>;
}

export interface SystemActionPort {
  execute(action: SystemAction): Promise<SystemActionOutcome>;
}

export interface MobileReleaseIdentity {
  readonly clientForm: ClientFormId;
  readonly releaseTarget: ReleaseTargetId;
  readonly processModel: 'tauri-mobile';
}

export function projectCapabilityAdmission(
  input: AdmissionInput,
): AdmissionProjection {
  const relevantFacts = input.facts.filter(
    (fact) => fact.capability === input.capability,
  );
  const reasons: string[] = [];
  let state: AdmissionState = 'available';

  if (input.productPolicy === 'unsupported') {
    state = 'blocked';
    reasons.push('product-policy-unsupported');
  }
  if (input.stationPolicy === 'denied') {
    state = 'blocked';
    reasons.push('station-policy-denied');
  } else if (input.stationPolicy === 'unknown') {
    state = state === 'blocked' ? state : 'unknown';
    reasons.push('station-policy-unknown');
  }
  if (input.runtimeReadiness === 'blocked') {
    state = 'blocked';
    reasons.push('runtime-blocked');
  } else if (input.runtimeReadiness === 'unknown') {
    state = state === 'blocked' ? state : 'unknown';
    reasons.push('runtime-unknown');
  } else if (
    input.runtimeReadiness === 'degraded'
  ) {
    if (state === 'available') state = 'degraded';
    reasons.push('runtime-degraded');
  }

  if (relevantFacts.length === 0) {
    state = state === 'blocked' ? state : 'unknown';
    reasons.push('capability-fact-missing');
  }
  for (const fact of relevantFacts) {
    switch (fact.state) {
      case 'available':
        break;
      case 'unknown':
        state = state === 'blocked' ? state : 'unknown';
        reasons.push('capability-unknown');
        break;
      case 'unavailable':
      case 'denied':
      case 'restricted':
      case 'unsupported':
        state = input.productPolicy === 'optional' && state !== 'blocked'
          ? 'degraded'
          : 'blocked';
        reasons.push(`capability-${fact.state}`);
        break;
    }
  }

  return {
    capability: input.capability,
    state,
    reasons: [...new Set(reasons)],
    facts: relevantFacts,
    ...(input.stationPolicyRevision
      ? { stationPolicyRevision: input.stationPolicyRevision }
      : {}),
    runtimeRevision: input.runtimeRevision,
    evaluatedAt: input.evaluatedAt,
  };
}
