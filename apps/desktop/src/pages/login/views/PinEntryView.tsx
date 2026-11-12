import { memo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Icon } from '@peers-touch/ui';
import { UserSquareAvatar } from '../../../components/common/UserSquareAvatar';
import { PinInput } from '../../../components/common/PinInput';
import type { SessionUser } from '../types';

export interface PinEntryViewProps {
  account: SessionUser;
  revoked: boolean;
  loading: boolean;
  error: string;
  onBack: () => void;
  onSubmit: (pin: string) => void;
  onForgotPin?: () => void;
}

export const PinEntryView = memo(function PinEntryView({
  account,
  revoked,
  loading,
  error,
  onBack,
  onSubmit,
  onForgotPin,
}: PinEntryViewProps) {
  const { t } = useTranslation('auth');
  const [resetKey, setResetKey] = useState(0);

  const handleComplete = useCallback((pin: string) => {
    onSubmit(pin);
  }, [onSubmit]);

  useEffect(() => {
    if (error || revoked) setResetKey((key) => key + 1);
  }, [error, revoked]);

  return (
    <div className="pt-auth-form">
      <div className="pt-auth-back">
        <Button
          actionId="auth.pin.back"
          emphasis="quiet"
          density="compact"
          leading={<Icon iconId="arrow-left" size={14} />}
          onActivate={onBack}
        >
          {t('auth.pin.back', { defaultValue: 'Back' })}
        </Button>
      </div>

      <div className="pt-auth-identity" style={{ position: 'relative', marginTop: 4 }}>
        <UserSquareAvatar
          remoteUrl={account.avatar}
          avatarLocalPath={account.avatarLocalPath}
          name={account.name}
          size={64}
          radius={12}
        />
        {loading && (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--pt-primary)',
            }}
          >
            <Icon iconId="refresh-cw" size={22} className="spin" />
          </span>
        )}
      </div>
      <div className="pt-auth-identity">
        <span className="pt-auth-identity-name">{account.name}</span>
        <span className="pt-auth-identity-handle">
          {revoked
            ? t('auth.pin.sessionExpiredHint', { defaultValue: 'Saved session is no longer valid' })
            : t('auth.pin.enterPin', { defaultValue: 'Enter your PIN to unlock' })}
        </span>
      </div>

      {revoked ? (
        <Alert
          tone="warning"
          title={t('auth.pin.sessionExpiredTitle', { defaultValue: 'Session expired' })}
          description={t('auth.pin.sessionExpiredRedirect', {
            defaultValue: 'Redirecting you to sign in again…',
          })}
        />
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <PinInput
              onComplete={handleComplete}
              disabled={loading}
              error={error}
              resetKey={resetKey}
              autoFocus
            />
          </div>
          {onForgotPin && !loading && (
            <Button
              actionId="auth.pin.forgot"
              emphasis="inline"
              density="compact"
              className="pt-auth-pin-forgot"
              onActivate={onForgotPin}
            >
              {t('auth.pin.forgot', { defaultValue: 'Forgot PIN?' })}
            </Button>
          )}
        </>
      )}
    </div>
  );
});
