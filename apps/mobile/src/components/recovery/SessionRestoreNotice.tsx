import { CheckCircle2 } from 'lucide-react';

interface SessionRestoreNoticeProps {
  readonly t: (key: string) => string;
  readonly onContinue: () => void;
}

export function SessionRestoreNotice({
  t,
  onContinue,
}: SessionRestoreNoticeProps) {
  return (
    <section
      className="recovery-notice recovery-session-restored"
      data-product-surface="recovery.session-valid-restore"
      role="status"
      aria-label={t('mobile.recovery.sessionRestore.title')}
    >
      <span className="recovery-notice__icon recovery-notice__icon--success" aria-hidden="true">
        <CheckCircle2 size={18} />
      </span>
      <div className="recovery-notice__content">
        <strong className="recovery-notice__title">
          {t('mobile.recovery.sessionRestore.title')}
        </strong>
        <span className="recovery-notice__text">
          {t('mobile.recovery.sessionRestore.body')}
        </span>
        <div className="recovery-notice__actions">
          <button
            type="button"
            className="recovery-btn recovery-btn--compact recovery-btn--primary"
            onClick={onContinue}
          >
            {t('common.action.done')}
          </button>
        </div>
      </div>
    </section>
  );
}
