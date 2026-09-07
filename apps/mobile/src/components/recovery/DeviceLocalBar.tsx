/**
 * DeviceLocalBar — device-local operating mode indicator.
 *
 * Shown when the app is operating without network or Station
 * connectivity. The app can still read cached data but cannot
 * send commands.
 */

import type { DeviceLocalFlagState } from '../../runtimes/recoveryProjection';

interface DeviceLocalBarProps {
  readonly state: DeviceLocalFlagState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

export function DeviceLocalBar({ state, t }: DeviceLocalBarProps) {
  const reasonKey = `mobile.recovery.deviceLocal.reason.${state.reason}` as const;

  return (
    <div
      className="recovery-bar recovery-device-local"
      role="status"
      aria-label={t('mobile.recovery.deviceLocal.title')}
    >
      <span className="recovery-bar__icon" aria-hidden="true">
        &#x1F4F5;
      </span>
      <span className="recovery-bar__text">
        {t(reasonKey)}
      </span>
    </div>
  );
}
