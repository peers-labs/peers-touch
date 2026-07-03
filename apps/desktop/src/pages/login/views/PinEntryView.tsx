import React, { memo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Spin, Typography, theme } from 'antd';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { UserSquareAvatar } from '../../../components/common/UserSquareAvatar';
import { PinInput } from '../../../components/common/PinInput';
import type { SessionUser } from '../types';

const { Text } = Typography;

export interface PinEntryViewProps {
  account: SessionUser;
  revoked: boolean;
  loading: boolean;
  error: string;
  onBack: () => void;
  onSubmit: (pin: string) => void;
}

export const PinEntryView = memo(function PinEntryView({
  account,
  revoked,
  loading,
  error,
  onBack,
  onSubmit,
}: PinEntryViewProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('auth');
  const [resetKey, setResetKey] = useState(0);

  // Reset PinInput when error or revoked changes
  const prevErrorRef = React.useRef(error);
  const prevRevokedRef = React.useRef(revoked);
  if (error !== prevErrorRef.current || revoked !== prevRevokedRef.current) {
    prevErrorRef.current = error;
    prevRevokedRef.current = revoked;
    // Schedule a reset on next render
  }

  const handleComplete = useCallback((pin: string) => {
    onSubmit(pin);
    // After submit, we might get an error — reset will be triggered by error prop change
  }, [onSubmit]);

  // Reset PIN input whenever error changes (wrong pin scenario)
  React.useEffect(() => {
    if (error) {
      setResetKey(k => k + 1);
    }
  }, [error]);

  // Reset PIN input when revoked changes
  React.useEffect(() => {
    if (revoked) {
      setResetKey(k => k + 1);
    }
  }, [revoked]);

  return (
    <>
      <button
        onClick={onBack}
        style={{
          position: 'absolute', top: 16, left: 16,
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', cursor: 'pointer',
          color: token.colorTextSecondary, fontSize: 12,
          padding: '4px 8px', borderRadius: 8,
        }}
      >
        <ArrowLeft size={14} />
        {t('auth.pin.back', { defaultValue: 'Back' })}
      </button>

      <div style={{ position: 'relative', marginBottom: 16, marginTop: 8 }}>
        <UserSquareAvatar
          remoteUrl={account.avatar}
          name={account.name}
          size={72}
          radius={12}
          border={`3px solid ${token.colorBgContainer}`}
        />
        {loading && (
          <div
            style={{
              position: 'absolute', inset: 0, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.9)',
            }}
          >
            <Spin size="small" />
          </div>
        )}
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, color: token.colorText, margin: '0 0 4px' }}>
        {account.name}
      </h3>
      <Text type="secondary" style={{ fontSize: 12, marginBottom: 24 }}>
        {revoked
          ? t('auth.pin.sessionExpiredHint', { defaultValue: 'Saved session is no longer valid' })
          : t('auth.pin.enterPin', { defaultValue: 'Enter your PIN to unlock' })}
      </Text>

      {revoked ? (
        <Flexbox
          gap={10}
          align="center"
          style={{
            width: '100%',
            padding: '14px 16px',
            borderRadius: 12,
            background: token.colorWarningBg,
            border: `1px solid ${token.colorWarningBorder}`,
          }}
        >
          <AlertTriangle size={28} color={token.colorWarningText} />
          <Text strong style={{ fontSize: 14, color: token.colorWarningText, textAlign: 'center' }}>
            {t('auth.pin.sessionExpiredTitle', { defaultValue: 'Session expired' })}
          </Text>
          <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
            {t('auth.pin.sessionExpiredRedirect', {
              defaultValue: 'Redirecting you to sign in again…',
            })}
          </Text>
          <Spin size="small" />
        </Flexbox>
      ) : (
        <PinInput
          onComplete={handleComplete}
          disabled={loading}
          error={error}
          resetKey={resetKey}
          autoFocus
        />
      )}
    </>
  );
});
