import {
  ATELIER_PROTOTYPE_RECOVERY_SEVERITY_BY_STATUS,
  ATELIER_PROTOTYPE_RECOVERY_SYMBOL_BY_STATUS,
  ATELIER_RECOVERY_RETRYABLE_KINDS,
} from './projection.contract.generated';
import type { AtelierPrototypeRecoverySeverity, AtelierPrototypeRecoverySymbol } from './projection.contract.generated';
import type { AtelierRuntimeStatus } from './runtime';

export const ATELIER_PROTOTYPE_STATUS_SCENARIOS = ['loading', 'empty', 'disconnected', 'auth-denied'] as const;

export type AtelierPrototypeStatusScenario = (typeof ATELIER_PROTOTYPE_STATUS_SCENARIOS)[number];

export interface PrototypeRecoveryView {
  severity: AtelierPrototypeRecoverySeverity;
  symbol: AtelierPrototypeRecoverySymbol;
  retryVisible: boolean;
}

export interface PrototypePageSurface {
  recoveryStatus?: AtelierRuntimeStatus;
  emptyVisible: boolean;
  streamVisible: boolean;
}

export function derivePrototypeRecoveryView(status: AtelierRuntimeStatus): PrototypeRecoveryView {
  const retryableKinds = ATELIER_RECOVERY_RETRYABLE_KINDS as readonly string[];
  return {
    severity: ATELIER_PROTOTYPE_RECOVERY_SEVERITY_BY_STATUS[status.kind],
    symbol: ATELIER_PROTOTYPE_RECOVERY_SYMBOL_BY_STATUS[status.kind],
    retryVisible: status.retryable === true && retryableKinds.includes(status.kind),
  };
}

export function resolvePrototypeStatusScenario(search: string): AtelierPrototypeStatusScenario | undefined {
  const value = new URLSearchParams(search).get('atelierStatus')?.trim();
  return (ATELIER_PROTOTYPE_STATUS_SCENARIOS as readonly string[]).includes(value ?? '')
    ? (value as AtelierPrototypeStatusScenario)
    : undefined;
}

export function prototypeStatusForScenario(scenario: AtelierPrototypeStatusScenario): AtelierRuntimeStatus {
  switch (scenario) {
    case 'loading':
      return {
        kind: 'loading',
        title: 'Loading Atelier projection',
        detail: 'Controlled prototype scenario: loading owns the surface and hides stale stream content.',
      };
    case 'empty':
      return {
        kind: 'empty',
        title: 'No Atelier tasks yet',
        detail: 'Controlled prototype scenario: empty state is distinct from disconnected or auth-denied recovery.',
      };
    case 'disconnected':
      return {
        kind: 'disconnected',
        title: 'Projection stream disconnected',
        detail: 'Controlled prototype scenario: existing projection remains visible while retry stays projection-only.',
        retryable: true,
      };
    case 'auth-denied':
      return {
        kind: 'auth-denied',
        title: 'Atelier access denied',
        detail: 'Controlled prototype scenario: auth denied is non-retryable and does not expose execution capability.',
        retryable: false,
      };
  }
}

export function derivePrototypePageSurface(input: {
  status?: AtelierRuntimeStatus;
  streamLength: number;
}): PrototypePageSurface {
  const recoveryStatus = input.status && input.status.kind !== 'ready' ? input.status : undefined;
  return {
    recoveryStatus,
    emptyVisible: !recoveryStatus && input.streamLength === 0,
    streamVisible: input.streamLength > 0 && recoveryStatus?.kind !== 'loading',
  };
}
