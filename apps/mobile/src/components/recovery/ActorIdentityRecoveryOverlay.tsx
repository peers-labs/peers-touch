import { useEffect, useRef, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';

interface ActorIdentityRecoveryOverlayProps {
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  readonly onRecover: () => Promise<void>;
  readonly onSwitchStation: () => Promise<void>;
}

export function ActorIdentityRecoveryOverlay({
  t,
  onRecover,
  onSwitchStation,
}: ActorIdentityRecoveryOverlayProps) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<'recover' | 'switch-station' | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const previousFocus = document.activeElement;
    primaryActionRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  async function run(
    action: 'recover' | 'switch-station',
    operation: () => Promise<void>,
  ) {
    if (pending) return;
    setPending(action);
    setFailed(false);
    try {
      await operation();
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  return (
    <main
      className="recovery-screen recovery-actor-identity"
      data-acceptance-id="recovery-actor-identity"
      data-product-surface="messaging.actor-identity-recovery"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="recovery-actor-identity-title"
      aria-describedby="recovery-actor-identity-description"
      aria-busy={pending !== null}
    >
      <section className="recovery-panel">
        <span className="recovery-panel__icon" aria-hidden="true">
          <KeyRound size={24} />
        </span>
        <h1 id="recovery-actor-identity-title" className="recovery-panel__title">
          {t('mobile.recovery.actorIdentity.title')}
        </h1>
        <p
          id="recovery-actor-identity-description"
          className="recovery-panel__description"
        >
          {t('mobile.recovery.actorIdentity.body')}
        </p>
        <div className="recovery-panel__status" role="status">
          <KeyRound size={15} aria-hidden="true" />
          <span>{t('mobile.recovery.actorIdentity.secureInput')}</span>
        </div>
        <div className="recovery-panel__actions">
          <button
            type="button"
            className="recovery-btn recovery-btn--secondary"
            disabled={pending !== null}
            onClick={() => void run('switch-station', onSwitchStation)}
          >
            {t('mobile.recovery.actorIdentity.switchStation')}
          </button>
          <button
            ref={primaryActionRef}
            type="button"
            className="recovery-btn recovery-btn--primary"
            data-acceptance-id="recovery-actor-identity-submit"
            disabled={pending !== null}
            onClick={() => void run('recover', onRecover)}
          >
            <RefreshCw
              size={16}
              className={pending === 'recover' ? 'recovery-icon--spinning' : undefined}
              aria-hidden="true"
            />
            {t('mobile.recovery.actorIdentity.action')}
          </button>
        </div>
        {failed && (
          <span className="recovery-panel__error" role="alert">
            {t('mobile.recovery.actorIdentity.failed')}
          </span>
        )}
      </section>
    </main>
  );
}
