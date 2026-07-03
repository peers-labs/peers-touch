import { memo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Spin, Typography, theme } from 'antd';
import { ShieldCheck } from 'lucide-react';
import { PinInput } from '../../../components/common/PinInput';

const { Text } = Typography;

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
  const { token } = theme.useToken();
  const { t } = useTranslation('auth');
  const [resetKey, setResetKey] = useState(0);

  // Reset PIN input when error changes
  useEffect(() => {
    if (error) {
      setResetKey(k => k + 1);
    }
  }, [error]);

  const handleComplete = useCallback((pin: string) => {
    onSubmit(pin);
  }, [onSubmit]);

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
        {t('auth.pin.relinkTitle', { defaultValue: 'Enter PIN' })}
      </h2>
      <Text type="secondary" style={{ fontSize: 13, marginBottom: 24, textAlign: 'center' }}>
        {t('auth.pin.relinkSubtitle', {
          defaultValue: 'Use your existing PIN to keep quick login enabled.',
        })}
      </Text>

      <PinInput
        onComplete={handleComplete}
        disabled={loading}
        error={error}
        resetKey={resetKey}
        autoFocus
      />

      {loading && (
        <Spin size="small" style={{ marginTop: 12 }} />
      )}
    </>
  );
});
