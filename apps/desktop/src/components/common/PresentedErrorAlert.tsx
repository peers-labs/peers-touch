import { useTranslation } from 'react-i18next';
import { Alert } from '@peers-touch/ui';
import type { PresentedError } from '../../services/errorPresenter';

interface PresentedErrorAlertProps {
  error: PresentedError;
  onClose?: () => void;
}

export function PresentedErrorAlert({ error, onClose }: PresentedErrorAlertProps) {
  const { t } = useTranslation('common');
  const tone = error.severity === 'warning'
    ? 'warning'
    : error.severity === 'info'
      ? 'info'
      : 'danger';
  return (
    <Alert
      tone={tone}
      title={error.message}
      onDismiss={onClose}
      dismissLabel={t('common.action.close')}
    />
  );
}
