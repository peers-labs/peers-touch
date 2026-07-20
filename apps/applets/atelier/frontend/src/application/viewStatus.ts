import {
  ATELIER_DEGRADED_EVENT_STREAM_STATES,
  ATELIER_RECONCILING_EVENT_STREAM_STATE,
  ATELIER_TYPED_RECOVERY_KINDS,
} from '../domain/projection.contract.generated';
import type { AtelierEventStreamState, AtelierTypedRecoveryKind, AtelierViewStatus } from '../domain/projection.contract.generated';
import type { AtelierErrorKind } from '../infrastructure/capability/atelierClient';

export type { AtelierEventStreamState, AtelierViewStatus } from '../domain/projection.contract.generated';

export interface AtelierViewStatusInput {
  loading: boolean;
  error: string;
  errorKind: AtelierErrorKind | '';
  eventStreamErrorKind: AtelierErrorKind | '';
  eventStreamState: AtelierEventStreamState;
  taskCount: number;
  replayHasMore: boolean;
}

export function deriveAtelierViewStatus(input: AtelierViewStatusInput): AtelierViewStatus {
  const effectiveTypedErrorKind = input.errorKind || input.eventStreamErrorKind;
  if (input.loading) return 'loading';
  if (isAtelierTypedRecoveryKind(effectiveTypedErrorKind)) return effectiveTypedErrorKind;
  if (input.error) return 'error';
  if (input.eventStreamState === ATELIER_RECONCILING_EVENT_STREAM_STATE) return 'reconciling';
  if (isAtelierDegradedEventStreamState(input.eventStreamState) || input.replayHasMore) return 'degraded';
  if (input.taskCount === 0) return 'empty';
  return 'ready';
}

function isAtelierTypedRecoveryKind(kind: AtelierErrorKind | ''): kind is AtelierTypedRecoveryKind {
  return kind.length > 0 && (ATELIER_TYPED_RECOVERY_KINDS as readonly string[]).includes(kind);
}

function isAtelierDegradedEventStreamState(state: AtelierEventStreamState): boolean {
  return (ATELIER_DEGRADED_EVENT_STREAM_STATES as readonly string[]).includes(state);
}
