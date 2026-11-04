import { useEffect, useRef, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';

type RecoveryFailureKind = 'no-backup' | 'generic';
type BackupCheckState =
  | { status: 'checking' }
  | { status: 'absent' }
  | { status: 'available' }
  | { status: 'error' };

interface ActorIdentityRecoveryOverlayProps {
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  readonly onRecover: () => Promise<void>;
  readonly onSwitchStation: () => Promise<void>;
  readonly backupAvailable: boolean | null;
  readonly backupChecking: boolean;
  readonly backupCheckError: boolean;
}

function classifyRecoveryFailure(error: unknown): RecoveryFailureKind {
  const message = error instanceof Error ? error.message : String(error);
  // The Station holds no encrypted recovery revision for this actor (the
  // original device never uploaded one). No phrase can succeed here; telling
  // users the phrase was wrong would send them hunting forever.
  return message.includes('messaging recovery revision is incomplete')
    ? 'no-backup'
    : 'generic';
}

export function ActorIdentityRecoveryOverlay({
  t,
  onRecover,
  onSwitchStation,
  backupAvailable,
  backupChecking,
  backupCheckError,
}: ActorIdentityRecoveryOverlayProps) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<'recover' | 'switch-station' | null>(null);
  const [failureKind, setFailureKind] = useState<RecoveryFailureKind | null>(null);

  const backupState: BackupCheckState = backupChecking
    ? { status: 'checking' }
    : backupCheckError
      ? { status: 'error' }
      : backupAvailable === false
        ? { status: 'absent' }
        : { status: 'available' };

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
    setFailureKind(null);
    try {
      await operation();
    } catch (error) {
      setFailureKind(classifyRecoveryFailure(error));
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
      aria-busy={pending !== null || backupState.status === 'checking'}
      data-recovery-backup-state={backupState.status}
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
          {backupState.status === 'absent'
            ? t('mobile.recovery.actorIdentity.noBackup')
            : t('mobile.recovery.actorIdentity.body')}
        </p>

        {backupState.status === 'absent' ? (
          <div className="recovery-panel__actions">
            <button
              ref={primaryActionRef}
              type="button"
              className="recovery-btn recovery-btn--primary"
              disabled={pending !== null}
              onClick={() => void run('switch-station', onSwitchStation)}
            >
              {t('mobile.recovery.actorIdentity.switchStation')}
            </button>
          </div>
        ) : (
          <>
            <div className="recovery-panel__status" role="status">
              <KeyRound size={15} aria-hidden="true" />
              <span>
                {backupState.status === 'checking'
                  ? t('mobile.recovery.actorIdentity.checking')
                  : t('mobile.recovery.actorIdentity.secureInput')}
              </span>
            </div>
            <div className="recovery-panel__actions">
              <button
                type="button"
                className="recovery-btn recovery-btn--secondary"
                disabled={pending !== null || backupState.status === 'checking'}
                onClick={() => void run('switch-station', onSwitchStation)}
              >
                {t('mobile.recovery.actorIdentity.switchStation')}
              </button>
              <button
                ref={primaryActionRef}
                type="button"
                className="recovery-btn recovery-btn--primary"
                data-acceptance-id="recovery-actor-identity-submit"
                disabled={pending !== null || backupState.status !== 'available'}
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
          </>
        )}
        {failureKind ? (
          <span className="recovery-panel__error" role="alert">
            {failureKind === 'no-backup'
              ? t('mobile.recovery.actorIdentity.noBackup')
              : t('mobile.recovery.actorIdentity.failed')}
          </span>
        ) : null}
      </section>
    </main>
  );
}
