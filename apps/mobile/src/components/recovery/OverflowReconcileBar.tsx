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
  const projectionStale = state.staleDomains.some(
    (entry) => entry.staleness.stale
      && entry.staleness.reason === 'projection-stale',
  );
  const titleKey = projectionStale
    ? 'mobile.recovery.projectionStale.title'
    : 'mobile.recovery.overflowReconcile.title';
  const bodyKey = projectionStale
    ? 'mobile.recovery.projectionStale.body'
    : 'mobile.recovery.overflowReconcile.body';

  return (
    <div
      className="recovery-bar recovery-overflow-reconcile"
      data-acceptance-id="recovery-event-overflow"
      data-product-surface={
        projectionStale ? 'recovery.projection-stale' : undefined
      }
      role="status"
      aria-label={t(titleKey)}
    >
      <span className="recovery-bar__icon" aria-hidden="true">
        &#x1F504;
      </span>
      <span className="recovery-bar__text">
        {t(bodyKey, {
          count: state.staleDomains.length,
        })}
      </span>
    </div>
  );
}
