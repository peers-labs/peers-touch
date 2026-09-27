import type {
  IngressState,
  SocialIngressDomain,
} from './socialEventIngress';
import { getRecoveryProjection } from './recoveryProjection';

export const WRITE_ADMISSION_ERROR_KEY =
  'mobile.recovery.writeRevocation.body';

export type MobileMutationDomain = Exclude<SocialIngressDomain, 'control'>;

type MutationAdmissionState = Pick<
  IngressState,
  'lifecycle' | 'staleness' | 'writeAdmission'
>;

type WriteAdmissionReader = () => MutationAdmissionState;

let activeReader: WriteAdmissionReader | null = null;
let activeOwner: symbol | null = null;
let activeScopeKey: string | null = null;
let activeSessionReader: (() => {
  readonly scopeKey: string | null;
  readonly open: boolean;
  readonly reason: string;
}) | null = null;
let activeSessionOwner: symbol | null = null;

export class MobileMutationAdmissionError extends Error {
  readonly code = 'MOBILE_WRITE_ADMISSION_CLOSED';
  readonly reason: string;

  constructor(reason: string) {
    super(WRITE_ADMISSION_ERROR_KEY);
    this.name = 'MobileMutationAdmissionError';
    this.reason = reason;
  }
}

export function bindMobileMutationAdmission(
  scopeKey: string,
  readAdmission: WriteAdmissionReader,
): () => void {
  if (!scopeKey.trim()) {
    throw new Error('mobile.auth.missingIdentityScope');
  }
  if (activeReader || activeScopeKey) {
    throw new Error('mobile.social.mutationAdmissionAlreadyBound');
  }

  const owner = Symbol('mobile-mutation-admission-owner');
  activeScopeKey = scopeKey;
  activeReader = readAdmission;
  activeOwner = owner;

  return () => {
    if (activeOwner !== owner) return;
    activeScopeKey = null;
    activeReader = null;
    activeOwner = null;
  };
}

export function bindMobileSessionMutationAdmission(
  readAdmission: () => {
    readonly scopeKey: string | null;
    readonly open: boolean;
    readonly reason: string;
  },
): () => void {
  if (activeSessionReader) {
    throw new Error('mobile.auth.sessionMutationAdmissionAlreadyBound');
  }
  const owner = Symbol('mobile-session-mutation-admission-owner');
  activeSessionReader = readAdmission;
  activeSessionOwner = owner;
  return () => {
    if (activeSessionOwner !== owner) return;
    activeSessionReader = null;
    activeSessionOwner = null;
  };
}

export function requireMobileMutationAdmission(
  scopeKey: string,
  domain?: MobileMutationDomain,
): void {
  const session = activeSessionReader?.();
  if (!session || session.scopeKey !== scopeKey) {
    throw new MobileMutationAdmissionError('session_runtime_unavailable');
  }
  if (!session.open) {
    throw new MobileMutationAdmissionError(session.reason);
  }
  const state = activeReader?.();
  if (!state || activeScopeKey !== scopeKey) {
    throw new MobileMutationAdmissionError('runtime_unavailable');
  }
  if (state.lifecycle !== 'active') {
    throw new MobileMutationAdmissionError(`runtime_${state.lifecycle}`);
  }
  if (!state.writeAdmission.open) {
    throw new MobileMutationAdmissionError(state.writeAdmission.reason);
  }
  if (domain && state.staleness[domain].stale) {
    throw new MobileMutationAdmissionError(
      `${domain}:${state.staleness[domain].reason}`,
    );
  }
  if (getRecoveryProjection().getSnapshot().isWriteBlocked) {
    throw new MobileMutationAdmissionError('recovery_projection_blocked');
  }
}

export function mobileMutationScopeKey(
  stationPeerId: string,
  actorPtid: string,
  deviceId: string,
  lifecycleGeneration: number,
): string {
  const station = stationPeerId.trim();
  const actor = actorPtid.trim();
  const device = deviceId.trim();
  if (
    !station
    || !actor
    || !device
    || !Number.isSafeInteger(lifecycleGeneration)
    || lifecycleGeneration <= 0
  ) {
    throw new Error('mobile.auth.missingIdentityScope');
  }
  return `${station}|${actor}|${device}|${lifecycleGeneration}`;
}
