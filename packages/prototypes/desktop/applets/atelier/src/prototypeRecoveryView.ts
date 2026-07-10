import {
  ATELIER_VIEW_STATUSES,
  ATELIER_VIEW_SURFACE,
  ATELIER_PROTOTYPE_RECOVERY_SEVERITY_BY_STATUS,
  ATELIER_PROTOTYPE_RECOVERY_SYMBOL_BY_STATUS,
  ATELIER_RECOVERY_RETRYABLE_KINDS,
} from './projection.contract.generated';
import type { AtelierPrototypeRecoverySeverity, AtelierPrototypeRecoverySymbol, AtelierViewStatus } from './projection.contract.generated';
import type { AtelierRuntimeStatus } from './runtime';
import type { AtelierState } from './types';

export const ATELIER_PROTOTYPE_STATUS_SCENARIOS = ATELIER_VIEW_STATUSES;

export type AtelierPrototypeStatusScenario = AtelierViewStatus;

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

export type PrototypeStatusActionKind = 'create-project' | 'retry' | 'none';

export interface PrototypeStatusActionPolicy {
  primaryAction: PrototypeStatusActionKind;
  createProjectVisible: boolean;
  retryVisible: boolean;
}

export function isPrototypeStatusActionPolicyConsistent(policy: PrototypeStatusActionPolicy): boolean {
  if (policy.createProjectVisible && policy.retryVisible) return false;
  if (policy.primaryAction === 'create-project') {
    return policy.createProjectVisible && !policy.retryVisible;
  }
  if (policy.primaryAction === 'retry') {
    return !policy.createProjectVisible && policy.retryVisible;
  }
  return !policy.createProjectVisible && !policy.retryVisible;
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
  const copy = ATELIER_VIEW_SURFACE.prototypeStatusScenarioCopyByStatus[scenario];
  switch (scenario) {
    case 'loading':
      return {
        kind: 'loading',
        title: copy.title,
        detail: copy.detail,
      };
    case 'empty':
      return {
        kind: 'empty',
        title: copy.title,
        detail: copy.detail,
      };
    case 'ready':
      return {
        kind: 'ready',
        title: copy.title,
        detail: copy.detail,
      };
    case 'reconciling':
      return {
        kind: 'reconciling',
        title: copy.title,
        detail: copy.detail,
      };
    case 'degraded':
      return {
        kind: 'degraded',
        title: copy.title,
        detail: copy.detail,
        lastEventSeq: 7,
      };
    case 'disconnected':
      return {
        kind: 'disconnected',
        title: copy.title,
        detail: copy.detail,
        retryable: true,
      };
    case 'auth-denied':
      return {
        kind: 'auth-denied',
        title: copy.title,
        detail: copy.detail,
        retryable: false,
      };
    case 'error':
      return {
        kind: 'error',
        title: copy.title,
        detail: copy.detail,
        retryable: true,
      };
  }
}

export function buildPrototypeRuntimeReadyStatus(state: Pick<AtelierState, 'tasks'>): AtelierRuntimeStatus {
  return prototypeStatusForScenario(state.tasks.length === 0 ? 'empty' : 'ready');
}

export function buildPrototypeBridgeLoadingStatus(): AtelierRuntimeStatus {
  const copy = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind.loading;
  return {
    kind: 'loading',
    title: copy.title,
    detail: copy.detail,
  };
}

export function buildPrototypeBridgeEventStatus(lastEventSeq: number): AtelierRuntimeStatus {
  const copy = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind.ready;
  return {
    kind: 'ready',
    title: copy.title,
    detail: copy.detail,
    lastEventSeq,
  };
}

export function buildPrototypeBridgeReconcilingStatus(): AtelierRuntimeStatus {
  const copy = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind.reconciling;
  return {
    kind: 'reconciling',
    title: copy.title,
    detail: copy.detail,
  };
}

export function buildPrototypeBridgeDegradedStatus(lastEventSeq: number): AtelierRuntimeStatus {
  const copy = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind.degraded;
  return {
    kind: 'degraded',
    title: copy.title,
    detail: copy.detail,
    retryable: true,
    lastEventSeq,
  };
}

export function buildPrototypeBridgeAuthDeniedStatus(): AtelierRuntimeStatus {
  const copy = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind['auth-denied'];
  return {
    kind: 'auth-denied',
    title: copy.title,
    detail: copy.detail,
    retryable: false,
  };
}

export function buildPrototypeBridgeDisconnectedStatus(): AtelierRuntimeStatus {
  const copy = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind.disconnected;
  return {
    kind: 'disconnected',
    title: copy.title,
    detail: copy.detail,
    retryable: true,
  };
}

export function buildPrototypeBridgeErrorStatus(detail: string): AtelierRuntimeStatus {
  const copy = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind.error;
  return {
    kind: 'error',
    title: copy.title,
    detail: detail || copy.detail,
    retryable: true,
  };
}

export function buildPrototypeBridgeStatusFromError(error: unknown): AtelierRuntimeStatus {
  const message = error instanceof Error ? error.message : String(error);
  const codeKind = prototypeBridgeRecoveryKindFromError(error);
  if (codeKind === 'auth-denied') {
    return buildPrototypeBridgeAuthDeniedStatus();
  }
  if (codeKind === 'disconnected') {
    return buildPrototypeBridgeDisconnectedStatus();
  }
  const normalized = message.toLowerCase();
  if (
    normalized.includes('permission') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('auth')
  ) {
    return buildPrototypeBridgeAuthDeniedStatus();
  }
  if (
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('disconnect') ||
    normalized.includes('stream')
  ) {
    return buildPrototypeBridgeDisconnectedStatus();
  }
  return buildPrototypeBridgeErrorStatus(message);
}

export function prototypeBridgeRecoveryKindFromError(
  error: unknown,
): 'auth-denied' | 'disconnected' | 'error' | undefined {
  const code = prototypeBridgeRuntimeErrorCode(error);
  if (!code) return undefined;
  const normalizedCode = code.trim().toUpperCase();
  return ATELIER_VIEW_SURFACE.bridgeRuntimeRecoveryCodeKindByCode[
    normalizedCode as keyof typeof ATELIER_VIEW_SURFACE.bridgeRuntimeRecoveryCodeKindByCode
  ];
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

export function derivePrototypeStatusActionPolicy(input: {
  status?: AtelierRuntimeStatus;
  streamLength: number;
}): PrototypeStatusActionPolicy {
  const pageSurface = derivePrototypePageSurface(input);
  if (pageSurface.emptyVisible || pageSurface.recoveryStatus?.kind === 'empty') {
    return {
      primaryAction: 'create-project',
      createProjectVisible: true,
      retryVisible: false,
    };
  }
  if (pageSurface.recoveryStatus) {
    const recoveryView = derivePrototypeRecoveryView(pageSurface.recoveryStatus);
    return {
      primaryAction: recoveryView.retryVisible ? 'retry' : 'none',
      createProjectVisible: false,
      retryVisible: recoveryView.retryVisible,
    };
  }
  return {
    primaryAction: 'none',
    createProjectVisible: false,
    retryVisible: false,
  };
}

function prototypeBridgeRuntimeErrorCode(error: unknown): string | undefined {
  if (isPrototypeRecord(error) && typeof error.code === 'string' && error.code.trim().length > 0) {
    return error.code;
  }
  if (isPrototypeRecord(error) && isPrototypeRecord(error.error) && typeof error.error.code === 'string' && error.error.code.trim().length > 0) {
    return error.error.code;
  }
  if (error instanceof Error && isPrototypeRecord(error.cause)) {
    const cause = error.cause;
    if (typeof cause.code === 'string' && cause.code.trim().length > 0) {
      return cause.code;
    }
    if (isPrototypeRecord(cause.error) && typeof cause.error.code === 'string' && cause.error.code.trim().length > 0) {
      return cause.error.code;
    }
  }
  return undefined;
}

function isPrototypeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
