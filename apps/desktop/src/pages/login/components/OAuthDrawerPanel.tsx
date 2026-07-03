import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Spin, Typography, theme } from 'antd';
import { CheckCircle2, LogIn, X, XCircle } from 'lucide-react';
import { PlatformLogo } from '../../../components/common/PlatformLogo';
import type { AuthState, OAuth2ProviderSummary } from '../types';

const { Text } = Typography;

export interface OAuthDrawerPanelProps {
  provider: OAuth2ProviderSummary | null;
  authState: AuthState;
  authError: string;
  connection?: { user_name?: string; user_id?: string } | null;
  onSignIn: () => void;
  onDone: () => void;
  onClose: () => void;
}

export const OAuthDrawerPanel = memo(function OAuthDrawerPanel({
  provider,
  authState,
  authError,
  connection,
  onSignIn,
  onDone,
  onClose,
}: OAuthDrawerPanelProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('auth');

  if (!provider) return null;

  const hasRemoteOAuth = ['github', 'google'].includes(provider.id);
  const canSignIn = hasRemoteOAuth || (provider.has_credentials ?? false);

  const renderContent = () => {
    switch (authState) {
      case 'idle':
        return (
          <Flexbox gap={12} align="center">
            <Flexbox
              align="center" justify="center"
              style={{
                width: 40, height: 40, borderRadius: 10,
                background: provider.color + '12',
              }}
            >
              <PlatformLogo providerId={provider.id} size={20} color={provider.color} />
            </Flexbox>
            <Flexbox gap={2} align="center">
              <Text strong style={{ fontSize: 13 }}>
                {t('auth.login.loginWith', { provider: provider.name })}
              </Text>
              <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>
                {t('auth.login.redirectHint', { provider: provider.name })}
              </Text>
            </Flexbox>
            <Button
              type="primary"
              size="small"
              icon={<LogIn size={13} />}
              onClick={onSignIn}
              disabled={!canSignIn}
              style={{
                background: canSignIn ? provider.color : undefined,
                width: '100%', borderRadius: 8, height: 32, fontSize: 12,
              }}
            >
              {t('auth.login.startAuth')}
            </Button>
          </Flexbox>
        );

      case 'waiting':
        return (
          <Flexbox gap={12} align="center" style={{ padding: '6px 0' }}>
            <Spin size="small" />
            <Text strong style={{ fontSize: 12 }}>{t('auth.login.waiting')}</Text>
            <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>
              {t('auth.login.waitingHint')}
            </Text>
          </Flexbox>
        );

      case 'success':
        return (
          <Flexbox gap={12} align="center">
            <CheckCircle2 size={28} color={token.colorSuccess} />
            <Text strong style={{ fontSize: 13 }}>{t('auth.login.success')}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {connection ? t('auth.login.successWelcome', { name: connection.user_name || connection.user_id }) : t('auth.login.accountAuthorized')}
            </Text>
            <Button type="primary" size="small" onClick={onDone} style={{ width: '100%', borderRadius: 8, height: 32, fontSize: 12 }}>
              {t('auth.welcomeBack.continue')}
            </Button>
          </Flexbox>
        );

      case 'error':
        return (
          <Flexbox gap={12} align="center">
            <XCircle size={28} color={token.colorError} />
            <Text strong style={{ fontSize: 13 }}>{t('auth.login.failed')}</Text>
            <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>{authError}</Text>
            <Flexbox horizontal gap={6} style={{ width: '100%' }}>
              <Button size="small" onClick={onClose} style={{ flex: 1, borderRadius: 8, height: 32, fontSize: 12 }}>{t('auth.login.cancelAction')}</Button>
              <Button type="primary" size="small" onClick={onSignIn} style={{ flex: 1, borderRadius: 8, height: 32, fontSize: 12 }}>{t('auth.login.retryAction')}</Button>
            </Flexbox>
          </Flexbox>
        );
    }
  };

  return (
    <Flexbox
      style={{
        position: 'relative',
        padding: '14px 14px',
      }}
      gap={0}
    >
      {authState !== 'waiting' && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 3,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: token.colorTextQuaternary,
            transition: 'color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = token.colorFillSecondary;
            e.currentTarget.style.color = token.colorText;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.color = token.colorTextQuaternary;
          }}
        >
          <X size={14} />
        </button>
      )}
      {renderContent()}
    </Flexbox>
  );
});
