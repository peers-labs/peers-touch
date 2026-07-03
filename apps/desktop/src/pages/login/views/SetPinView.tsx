import React, { memo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Spin, Typography, theme } from 'antd';
import { ShieldCheck } from 'lucide-react';
import { PinInput, type PinInputRef } from '../../../components/common/PinInput';

const { Text } = Typography;

export interface SetPinViewProps {
  canSkip: boolean;
  loading: boolean;
  error: string;
  onComplete: (pin: string) => void;
  onSkip: () => void;
}

export const SetPinView = memo(function SetPinView({
  canSkip,
  loading,
  error,
  onComplete,
  onSkip,
}: SetPinViewProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('auth');
  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [createdPin, setCreatedPin] = useState('');
  const [internalError, setInternalError] = useState('');
  const [resetKey, setResetKey] = useState(0);

  const confirmRef = React.useRef<PinInputRef>(null);

  // Propagate external error
  const displayError = error || internalError;

  // Reset to create step on external error
  useEffect(() => {
    if (error) {
      setStep('create');
      setCreatedPin('');
      setInternalError('');
      setResetKey(k => k + 1);
    }
  }, [error]);

  const handleCreateComplete = useCallback((pin: string) => {
    setCreatedPin(pin);
    setStep('confirm');
    setInternalError('');
    setResetKey(k => k + 1);
  }, []);

  const handleConfirmComplete = useCallback((pin: string) => {
    if (pin !== createdPin) {
      setInternalError(t('auth.pin.mismatch', { defaultValue: 'PINs do not match. Try again.' }));
      setStep('create');
      setCreatedPin('');
      setResetKey(k => k + 1);
      return;
    }
    setInternalError('');
    onComplete(pin);
  }, [createdPin, onComplete, t]);

  return (
    <>
      <div style={{
        width: 52, height: 52, borderRadius: 14,
        background: `${token.colorPrimary}12`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16,
      }}>
        <ShieldCheck size={26} color={token.colorPrimary} />
      </div>

      <h2 style={{ fontSize: 20, fontWeight: 700, color: token.colorText, margin: '0 0 4px' }}>
        {step === 'create'
          ? t('auth.pin.setTitle', { defaultValue: 'Set a PIN' })
          : t('auth.pin.confirmTitle', { defaultValue: 'Confirm PIN' })
        }
      </h2>
      <Text type="secondary" style={{ fontSize: 13, marginBottom: 24, textAlign: 'center' }}>
        {step === 'create'
          ? t('auth.pin.setSubtitle', { defaultValue: 'Create a 6-digit PIN to protect your account' })
          : t('auth.pin.confirmSubtitle', { defaultValue: 'Enter the same PIN again to confirm' })
        }
      </Text>

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

      {loading && (
        <Spin size="small" style={{ marginTop: 12 }} />
      )}

      {canSkip && (
        <Button
          type="link"
          size="small"
          onClick={onSkip}
          disabled={loading}
          style={{ marginTop: 20, fontSize: 12, color: token.colorTextTertiary }}
        >
          {t('auth.pin.skipForNow', { defaultValue: 'Skip for now' })}
        </Button>
      )}
    </>
  );
});
