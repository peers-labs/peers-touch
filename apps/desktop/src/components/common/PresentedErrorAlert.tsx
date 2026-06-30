import { Alert } from 'antd';
import type { PresentedError } from '../../services/errorPresenter';

interface PresentedErrorAlertProps {
  error: PresentedError;
  onClose?: () => void;
}

export function PresentedErrorAlert({ error, onClose }: PresentedErrorAlertProps) {
  return (
    <Alert
      type={error.severity === 'warning' ? 'warning' : error.severity === 'info' ? 'info' : 'error'}
      showIcon
      closable={Boolean(onClose)}
      onClose={onClose}
      message={error.message}
    />
  );
}
