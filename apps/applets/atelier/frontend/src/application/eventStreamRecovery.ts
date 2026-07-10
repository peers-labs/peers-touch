import { ATELIER_RECOVERY_RETRYABLE_KINDS } from '../domain/projection.contract.generated';
import type { AtelierErrorKind } from '../infrastructure/capability/atelierClient';

export const ATELIER_EVENT_STREAM_RETRY_DELAYS_MS = [500, 1500, 5000] as const;

export interface AtelierEventStreamRetryInput {
  attempt: number;
  errorKind: AtelierErrorKind | '';
  hasSnapshot: boolean;
}

export function nextAtelierEventStreamRetryDelayMs(input: AtelierEventStreamRetryInput): number | null {
  if (!input.hasSnapshot) return null;
  if (!(ATELIER_RECOVERY_RETRYABLE_KINDS as readonly string[]).includes(input.errorKind)) return null;
  return ATELIER_EVENT_STREAM_RETRY_DELAYS_MS[input.attempt] ?? null;
}
