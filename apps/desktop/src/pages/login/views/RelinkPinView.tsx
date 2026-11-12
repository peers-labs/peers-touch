import { memo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@peers-touch/ui';
import { PinInput } from '../../../components/common/PinInput';

export interface RelinkPinViewProps {
  loading: boolean;
  error: string;
  onSubmit: (pin: string) => void;
}

export const RelinkPinView = memo(function RelinkPinView({
  loading,
  error,
  onSubmit,
}: RelinkPinViewProps) {
  const { t } = useTranslation('auth');
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (error) setResetKey((key) => key + 1);
  }, [error]);

  const handleComplete = useCallback((pin: string) => {
    onSubmit(pin);
  }, [onSubmit]);

  return (
    <div className="pt-auth-form">
      <div className="pt-auth-identity">
        <span className="pt-auth-pin-icon">
          <Icon iconId="shield-check" size={24} />
        </span>
      </div>
      <h2 className="pt-auth-title">
        {t('auth.pin.relinkTitle', { defaultValue: 'Enter PIN' })}
      </h2>
      <p className="pt-auth-subtitle">
        {t('auth.pin.relinkSubtitle', {
          defaultValue: 'Use your existing PIN to keep quick login enabled.',
        })}
      </p>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <PinInput
          onComplete={handleComplete}
          disabled={loading}
          error={error}
          resetKey={resetKey}
          autoFocus
        />
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--pt-primary)' }}>
          <Icon iconId="refresh-cw" size={18} className="spin" />
        </div>
      )}
    </div>
  );
});
