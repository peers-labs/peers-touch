/**
 * DeferredCapabilityNotice — features unavailable during bootstrap.
 *
 * Shows which runtimes have not yet completed bootstrap or have
 * failed, causing certain features to be temporarily unavailable.
 */

import type { DeferredCapabilityState } from '../../runtimes/recoveryProjection';

interface DeferredCapabilityNoticeProps {
  readonly state: DeferredCapabilityState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

export function DeferredCapabilityNotice({ state, t }: DeferredCapabilityNoticeProps) {
  return (
    <div
      className="recovery-bar recovery-deferred-capability"
      role="status"
      aria-label={t('mobile.recovery.deferredCapability.title')}
    >
      <span className="recovery-bar__icon" aria-hidden="true">
        &#x23F3;
      </span>
      <div className="recovery-bar__content">
        <span className="recovery-bar__text">
          {t('mobile.recovery.deferredCapability.body', {
            count: state.unavailableRuntimes.length,
          })}
        </span>
        <ul className="recovery-deferred-list" role="list">
          {state.unavailableRuntimes.map((entry) => (
            <li key={entry.runtimeId} className="recovery-deferred-list__item">
              <span className="recovery-deferred-list__title">{entry.title}</span>
              <span className="recovery-deferred-list__status">
                {t(`mobile.recovery.runtimeStatus.${entry.status}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
