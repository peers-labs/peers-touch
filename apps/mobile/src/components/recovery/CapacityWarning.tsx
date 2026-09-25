/**
 * CapacityWarning — read-only mode when the command ledger is full.
 *
 * Displays the exact exhausted resource. The owning runtime performs purge;
 * this component only visualizes the Rust-owned state.
 */

import type { CapacityReadOnlyState } from '../../runtimes/recoveryProjection';

interface CapacityWarningProps {
  readonly state: CapacityReadOnlyState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

export function CapacityWarning({ state, t }: CapacityWarningProps) {
  const exhaustedByRecords = state.exhaustionCauses.includes('record-count');
  const exhaustedByBytes = state.exhaustionCauses.includes('byte-capacity');
  const bodyKey = exhaustedByRecords && exhaustedByBytes
    ? 'mobile.recovery.capacityWarning.bodyBoth'
    : exhaustedByBytes
      ? 'mobile.recovery.capacityWarning.bodyBytes'
      : 'mobile.recovery.capacityWarning.bodyRecords';

  return (
    <div
      className="recovery-bar recovery-capacity-warning"
      data-acceptance-id="recovery-capacity"
      role="alert"
      aria-label={t('mobile.recovery.capacityWarning.title')}
    >
      <span className="recovery-bar__icon" aria-hidden="true">
        &#x1F6AB;
      </span>
      <span className="recovery-bar__text">
        {t(bodyKey, {
          current: state.currentDepth,
          max: state.maxCapacity,
          currentBytes: formatCapacityBytes(state.currentBytes),
          maxBytes: formatCapacityBytes(state.maxBytes),
        })}
      </span>
    </div>
  );
}

export function formatCapacityBytes(bytes: number): string {
  const kibibyte = 1024;
  const mebibyte = kibibyte * 1024;
  if (bytes >= mebibyte) {
    const value = bytes / mebibyte;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} MiB`;
  }
  if (bytes >= kibibyte) {
    const value = bytes / kibibyte;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} KiB`;
  }
  return `${bytes} B`;
}
