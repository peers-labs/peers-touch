import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';

type MobileNoticeTone = 'error' | 'info' | 'success';

const noticeIcons: Record<MobileNoticeTone, typeof AlertCircle> = {
  error: AlertCircle,
  info: Info,
  success: CheckCircle2,
};

export function MobileNotice({
  tone = 'error',
  children,
  onClose,
}: {
  tone?: MobileNoticeTone;
  children: ReactNode;
  onClose?: () => void;
}) {
  const { t } = useMobileI18n();
  const Icon = noticeIcons[tone];

  return (
    <div className={`mobile-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={16} className="mobile-notice-icon" />
      <div className="mobile-notice-copy">{children}</div>
      {onClose ? (
        <button
          type="button"
          className="mobile-notice-close"
          aria-label={t('mobile.error.dismiss')}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}
