/**
 * SessionMismatchOverlay — Station identity changed between sessions.
 *
 * Full-screen trust boundary that blocks interaction until the owning
 * Station/auth flow verifies the saved Station or returns to selection.
 */

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';

import type { SessionMismatchState } from '../../runtimes/recoveryProjection';

interface SessionMismatchOverlayProps {
  readonly state: SessionMismatchState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  readonly onReAuthenticate: (state: SessionMismatchState) => Promise<void>;
  readonly onSwitchStation: (state: SessionMismatchState) => Promise<void>;
}

export function SessionMismatchOverlay({
  state,
  t,
  onReAuthenticate,
  onSwitchStation,
}: SessionMismatchOverlayProps) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [pendingAction, setPendingAction] = useState<'re-authenticate' | 'switch-station' | null>(null);
  const [actionFailed, setActionFailed] = useState(false);

  useEffect(() => {
    const previousFocus = document.activeElement;
    primaryActionRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  async function runAction(
    action: 're-authenticate' | 'switch-station',
    handler: (currentState: SessionMismatchState) => Promise<void>,
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
    <main
      className="recovery-screen recovery-session-mismatch"
      data-acceptance-id="recovery-session-mismatch"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="recovery-session-mismatch-title"
      aria-describedby="recovery-session-mismatch-description"
      aria-busy={pendingAction !== null}
    >
      <section className="recovery-panel">
        <span className="recovery-panel__icon" aria-hidden="true">
          <ShieldAlert size={24} />
        </span>
        <h1
          id="recovery-session-mismatch-title"
          className="recovery-panel__title"
        >
          {t('mobile.recovery.sessionMismatch.title')}
        </h1>
        <p
          id="recovery-session-mismatch-description"
          className="recovery-panel__description"
        >
          {t('mobile.recovery.sessionMismatch.body')}
        </p>
        <div className="recovery-panel__status" role="status">
          <ShieldAlert size={15} />
          <span>{t('mobile.launch.stationIdentityMismatch')}</span>
        </div>
        <div className="recovery-panel__actions">
          <button
            type="button"
            data-acceptance-id="recovery-session-switch-station"
            className="recovery-btn recovery-btn--secondary"
            disabled={pendingAction !== null}
            onClick={() => {
              void runAction('switch-station', onSwitchStation);
            }}
          >
            {t('mobile.recovery.sessionMismatch.switchStation')}
          </button>
          <button
            ref={primaryActionRef}
            type="button"
            data-acceptance-id="recovery-session-reauthenticate"
            className="recovery-btn recovery-btn--primary"
            disabled={pendingAction !== null}
            onClick={() => {
              void runAction('re-authenticate', onReAuthenticate);
            }}
          >
            <RefreshCw
              size={16}
              className={pendingAction === 're-authenticate' ? 'recovery-icon--spinning' : undefined}
              aria-hidden="true"
            />
            {t('mobile.recovery.sessionMismatch.reAuthenticate')}
          </button>
        </div>
        {actionFailed && (
          <span className="recovery-panel__error" role="alert">
            {t('mobile.recovery.actionFailed')}
          </span>
        )}
      </section>
    </main>
  );
}
