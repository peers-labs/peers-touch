/**
 * OverflowReconcileBar — event ingress overflow notification.
 *
 * Non-modal bar showing which domains have stale projections
 * due to event overflow. Reconciliation is performed by the
 * social projection runtime, not by this component.
 */

import type { EventOverflowReconcileState } from '../../runtimes/recoveryProjection';

interface OverflowReconcileBarProps {
  readonly state: EventOverflowReconcileState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

export function OverflowReconcileBar({ state, t }: OverflowReconcileBarProps) {
  const domainNames = state.staleDomains.map((entry) => entry.domain).join(', ');

  return (
    <div
      className="recovery-bar recovery-overflow-reconcile"
      role="status"
      aria-label={t('mobile.recovery.overflowReconcile.title')}
    >
      <span className="recovery-bar__icon" aria-hidden="true">
        &#x1F504;
      </span>
      <span className="recovery-bar__text">
        {t('mobile.recovery.overflowReconcile.body', {
          domains: domainNames,
          count: state.staleDomains.length,
        })}
      </span>
    </div>
  );
}
