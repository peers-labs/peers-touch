/**
 * DeviceLocalBar — device-local operating mode indicator.
 *
 * Shown when the app is operating without network/Station connectivity or
 * when the session must return to the access flow. Recovery is delegated to
 * the owning App/lifecycle boundary.
 */

import { useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';

import type { DeviceLocalFlagState } from '../../runtimes/recoveryProjection';

interface DeviceLocalBarProps {
  readonly state: DeviceLocalFlagState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  readonly onRetry: (state: DeviceLocalFlagState) => Promise<void>;
  readonly onChangeStation: (state: DeviceLocalFlagState) => Promise<void>;
}

export function DeviceLocalBar({
  state,
  t,
  onRetry,
  onChangeStation,
}: DeviceLocalBarProps) {
  const [pendingAction, setPendingAction] = useState<'retry' | 'change-station' | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const reasonKey = `mobile.recovery.deviceLocal.reason.${state.reason}` as const;
  const titleKey = state.reason === 'session-expired'
    ? 'mobile.auth.signInTitle'
    : 'mobile.recovery.deviceLocal.title';
  const retryLabelKey = state.reason === 'session-expired'
    ? 'mobile.recovery.sessionMismatch.reAuthenticate'
    : 'common.action.retry';

  async function runAction(
    action: 'retry' | 'change-station',
    handler: (currentState: DeviceLocalFlagState) => Promise<void>,
  ) {
    if (pendingAction) return;
    setActionFailed(false);
    setPendingAction(action);
    try {
      await handler(state);
    } catch {
      setActionFailed(true);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      className="recovery-notice recovery-device-local"
      data-acceptance-id="recovery-device-local"
      role="status"
      aria-label={t(reasonKey)}
      aria-busy={pendingAction !== null}
    >
      <span className="recovery-notice__icon" aria-hidden="true">
        <WifiOff size={18} />
      </span>
      <div className="recovery-notice__content">
        <strong className="recovery-notice__title">
          {t(titleKey)}
        </strong>
        <span className="recovery-notice__text">{t(reasonKey)}</span>
        <div className="recovery-notice__actions">
          <button
            type="button"
            data-acceptance-id="recovery-device-local-retry"
            className="recovery-btn recovery-btn--compact recovery-btn--primary"
            disabled={pendingAction !== null}
            onClick={() => {
              void runAction('retry', onRetry);
            }}
          >
            <RefreshCw
              size={14}
              className={pendingAction === 'retry' ? 'recovery-icon--spinning' : undefined}
              aria-hidden="true"
            />
            {t(retryLabelKey)}
          </button>
          <button
            type="button"
            data-acceptance-id="recovery-device-local-switch-station"
            className="recovery-btn recovery-btn--compact recovery-btn--secondary"
            disabled={pendingAction !== null}
            onClick={() => {
              void runAction('change-station', onChangeStation);
            }}
          >
            {t('mobile.auth.changeStation')}
          </button>
        </div>
        {actionFailed && (
          <span className="recovery-notice__error" role="alert">
            {t('mobile.recovery.actionFailed')}
          </span>
        )}
      </div>
    </section>
  );
}
