/**
 * CapacityWarning — read-only mode when the command ledger is full.
 *
 * Displays current depth vs max capacity. The owning runtime
 * performs purge; this component only visualizes the state.
 */

import type { CapacityReadOnlyState } from '../../runtimes/recoveryProjection';

interface CapacityWarningProps {
  readonly state: CapacityReadOnlyState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

export function CapacityWarning({ state, t }: CapacityWarningProps) {
  return (
    <div
      className="recovery-bar recovery-capacity-warning"
      role="alert"
      aria-label={t('mobile.recovery.capacityWarning.title')}
    >
      <span className="recovery-bar__icon" aria-hidden="true">
        &#x1F6AB;
      </span>
      <span className="recovery-bar__text">
        {t('mobile.recovery.capacityWarning.body', {
          current: state.currentDepth,
          max: state.maxCapacity,
        })}
      </span>
    </div>
  );
}
