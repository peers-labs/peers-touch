/**
 * SessionMismatchOverlay — Station identity changed between sessions.
 *
 * Full-screen modal that blocks interaction until the user
 * re-authenticates or switches Station. Does not perform
 * re-authentication — delegates to the auth runtime.
 */

import { useCallback } from 'react';

import type { SessionMismatchState } from '../../runtimes/recoveryProjection';
import { getRecoveryProjection } from '../../runtimes/recoveryProjection';

interface SessionMismatchOverlayProps {
  readonly state: SessionMismatchState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

export function SessionMismatchOverlay({ state, t }: SessionMismatchOverlayProps) {
  const handleReAuthenticate = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('recovery:session-mismatch', { detail: { action: 're-authenticate' } }),
    );
    getRecoveryProjection().clearSessionMismatch();
  }, []);

  const handleSwitchStation = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('recovery:session-mismatch', { detail: { action: 'switch-station' } }),
    );
    getRecoveryProjection().clearSessionMismatch();
  }, []);

  return (
    <div
      className="recovery-overlay recovery-session-mismatch"
      role="alertdialog"
      aria-modal="true"
      aria-label={t('mobile.recovery.sessionMismatch.title')}
    >
      <div className="recovery-overlay__backdrop" />
      <div className="recovery-overlay__panel">
        <h3 className="recovery-overlay__title">
          {t('mobile.recovery.sessionMismatch.title')}
        </h3>
        <p className="recovery-overlay__body">
          {t('mobile.recovery.sessionMismatch.body')}
        </p>
        <dl className="recovery-session-mismatch__details">
          <dt>{t('mobile.recovery.sessionMismatch.expected')}</dt>
          <dd className="recovery-session-mismatch__peer-id">{state.expectedStationPeerId}</dd>
          <dt>{t('mobile.recovery.sessionMismatch.actual')}</dt>
          <dd className="recovery-session-mismatch__peer-id">{state.actualStationPeerId}</dd>
        </dl>
        <div className="recovery-overlay__actions">
          <button
            type="button"
            className="recovery-btn recovery-btn--secondary"
            onClick={handleSwitchStation}
          >
            {t('mobile.recovery.sessionMismatch.switchStation')}
          </button>
          <button
            type="button"
            className="recovery-btn recovery-btn--primary"
            onClick={handleReAuthenticate}
          >
            {t('mobile.recovery.sessionMismatch.reAuthenticate')}
          </button>
        </div>
      </div>
    </div>
  );
}
