import React, { memo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@peers-touch/ui';
import { PinInput, type PinInputRef } from '../../../components/common/PinInput';

export interface SetPinViewProps {
  canSkip: boolean;
  loading: boolean;
  error: string;
  onComplete: (pin: string) => void;
  onSkip: () => void;
  title?: string;
}

export const SetPinView = memo(function SetPinView({
  canSkip,
  loading,
  error,
  onComplete,
  onSkip,
  title: titleOverride,
}: SetPinViewProps) {
  const { t } = useTranslation('auth');
  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [createdPin, setCreatedPin] = useState('');
  const [internalError, setInternalError] = useState('');
  const [resetKey, setResetKey] = useState(0);

  const confirmRef = React.useRef<PinInputRef>(null);

  const displayError = error || internalError;

  useEffect(() => {
    if (error) {
      setStep('create');
      setCreatedPin('');
      setInternalError('');
      setResetKey((key) => key + 1);
    }
  }, [error]);

  const handleCreateComplete = useCallback((pin: string) => {
    setCreatedPin(pin);
    setStep('confirm');
    setInternalError('');
    setResetKey((key) => key + 1);
  }, []);

  const handleConfirmComplete = useCallback((pin: string) => {
    if (pin !== createdPin) {
      setInternalError(t('auth.pin.mismatch', { defaultValue: 'PINs do not match. Try again.' }));
      setStep('create');
      setCreatedPin('');
      setResetKey((key) => key + 1);
      return;
    }
    setInternalError('');
    onComplete(pin);
  }, [createdPin, onComplete, t]);

  return (
    <div className="pt-auth-form">
      <div className="pt-auth-identity">
        <span className="pt-auth-pin-icon">
          <Icon iconId="shield-check" size={24} />
        </span>
      </div>
      <h2 className="pt-auth-title">
        {step === 'create'
          ? (titleOverride || t('auth.pin.setTitle', { defaultValue: 'Set a PIN' }))
          : t('auth.pin.confirmTitle', { defaultValue: 'Confirm PIN' })}
      </h2>
      <p className="pt-auth-subtitle">
        {step === 'create'
          ? t('auth.pin.setSubtitle', { defaultValue: 'Create a 6-digit PIN to protect your account' })
          : t('auth.pin.confirmSubtitle', { defaultValue: 'Enter the same PIN again to confirm' })}
      </p>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        {step === 'create' ? (
          <PinInput
            onComplete={handleCreateComplete}
            disabled={loading}
            error={displayError}
            resetKey={resetKey}
            autoFocus
          />
        ) : (
          <PinInput
            ref={confirmRef}
            onComplete={handleConfirmComplete}
            disabled={loading}
            error={displayError}
            resetKey={resetKey}
            autoFocus
          />
        )}
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--pt-primary)' }}>
          <Icon iconId="refresh-cw" size={18} className="spin" />
        </div>
      )}

      {canSkip && (
        <Button
          actionId="auth.pin.skip"
          emphasis="inline"
          density="compact"
          data-login-pin-skip
          availability={loading ? { kind: 'disabled', reason: t('auth.login.waiting') } : undefined}
          onActivate={onSkip}
        >
          {t('auth.pin.skipForNow', { defaultValue: 'Skip for now' })}
        </Button>
      )}
    </div>
  );
});
