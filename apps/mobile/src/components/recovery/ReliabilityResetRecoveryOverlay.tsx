import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

interface ReliabilityResetRecoveryOverlayProps {
  readonly t: (key: string) => string;
  readonly onRetry: () => Promise<void>;
}

export function ReliabilityResetRecoveryOverlay({
  t,
  onRetry,
}: ReliabilityResetRecoveryOverlayProps) {
  const retryRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    retryRef.current?.focus();
  }, []);

  async function retry() {
    if (pending) return;
    setFailed(false);
    setPending(true);
    try {
      await onRetry();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="recovery-overlay recovery-reset-incomplete"
      data-acceptance-id="recovery-reset-incomplete"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="reliability-reset-title"
      aria-describedby="reliability-reset-description"
      aria-busy={pending}
    >
      <div className="recovery-overlay__backdrop" />
      <section className="recovery-overlay__panel">
        <h2 id="reliability-reset-title" className="recovery-overlay__title">
          {t('mobile.recovery.resetIncomplete.title')}
        </h2>
        <p id="reliability-reset-description" className="recovery-overlay__body">
          {t('mobile.recovery.resetIncomplete.body')}
        </p>
        <div className="recovery-overlay__actions">
          <button
            ref={retryRef}
            type="button"
            data-acceptance-id="recovery-reset-finish"
            className="recovery-btn recovery-btn--danger"
            disabled={pending}
            onClick={() => {
              void retry();
            }}
          >
            <RotateCcw size={16} aria-hidden="true" />
            {t('mobile.recovery.resetIncomplete.retry')}
          </button>
        </div>
        {failed && (
          <span className="recovery-panel__error" role="alert">
            {t('mobile.recovery.resetIncomplete.error')}
          </span>
        )}
      </section>
    </div>
  );
}
