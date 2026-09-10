import { PauseCircle } from 'lucide-react';

interface WriteRevocationNoticeProps {
  readonly t: (key: string) => string;
}

export function WriteRevocationNotice({
  t,
}: WriteRevocationNoticeProps) {
  return (
    <section
      className="recovery-notice recovery-write-revocation"
      role="status"
      aria-label={t('mobile.recovery.writeRevocation.title')}
    >
      <span className="recovery-notice__icon" aria-hidden="true">
        <PauseCircle size={18} />
      </span>
      <div className="recovery-notice__content">
        <strong className="recovery-notice__title">
          {t('mobile.recovery.writeRevocation.title')}
        </strong>
        <span className="recovery-notice__text">
          {t('mobile.recovery.writeRevocation.body')}
        </span>
      </div>
    </section>
  );
}
