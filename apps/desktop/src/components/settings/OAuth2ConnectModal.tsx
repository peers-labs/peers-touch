import { useState, useEffect, useCallback } from 'react';
import { Button } from '@lobehub/ui';
import { Modal, Typography, Spin, Result, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { LogIn, CheckCircle2, XCircle } from 'lucide-react';
import type { OAuth2ProviderSummary } from '../../services/desktop_api';
import { useOAuth2Store } from '../../store/oauth2';
import { PlatformLogo } from '../common/PlatformLogo';
import { useTranslation } from 'react-i18next';
import { log } from '../../utils/logger';

const { Text, Title } = Typography;

type AuthState = 'idle' | 'waiting' | 'success' | 'error';

interface Props {
  provider: OAuth2ProviderSummary | null;
  open: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

export function OAuth2ConnectModal({ provider, open, onCancel, onSuccess }: Props) {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const { startAuth, connections } = useOAuth2Store();
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [error, setError] = useState('');

  const hasRemoteOAuth = provider ? ['github', 'google'].includes(provider.id) : false;
  const canSignIn = hasRemoteOAuth || (provider?.has_credentials ?? false);

  useEffect(() => {
    if (open && provider) {
      setError('');
      setAuthState('idle');
    }
  }, [open, provider]);

  const handleSignIn = useCallback(async () => {
    if (!provider) return;
    setAuthState('waiting');
    setError('');
    try {
      await startAuth(provider.id);
      const updatedConn = useOAuth2Store.getState().connections.find(
        c => c.provider_id === provider.id,
      );
      if (updatedConn) {
        setAuthState('success');
      } else {
        setAuthState('error');
        setError(t('provider.oauth.connect.loginIncomplete'));
      }
    } catch (err: any) {
      setAuthState('error');
      setError(err?.message || t('provider.oauth.connect.loginFailed'));
    }
  }, [provider, startAuth, t]);

  if (!provider) return null;

  const renderContent = () => {
    switch (authState) {
      case 'idle':
        return (
          <Flexbox gap={20} align="center" style={{ padding: '12px 0' }}>
            <Flexbox
              align="center" justify="center"
              style={{
                width: 56, height: 56, borderRadius: 14,
                background: provider.color + '18',
              }}
            >
              <PlatformLogo providerId={provider.id} size={28} color={provider.color} />
            </Flexbox>
            <Flexbox gap={4} align="center">
              <Title level={5} style={{ margin: 0 }}>
                {t('provider.oauth.connect.loginWith', { name: provider.name })}
              </Title>
              <Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
                {t('provider.oauth.connect.clickToAuth', { name: provider.name })}
              </Text>
            </Flexbox>
            <Button
              type="primary"
              size="large"
              icon={<LogIn size={16} />}
              onClick={handleSignIn}
              disabled={!canSignIn}
              style={{ background: canSignIn ? provider.color : undefined, width: '100%' }}
            >
              {t('provider.oauth.connect.loginBtn', { name: provider.name })}
            </Button>
          </Flexbox>
        );

      case 'waiting':
        return (
          <Flexbox gap={20} align="center" style={{ padding: '24px 0' }}>
            <Spin size="large" />
            <Flexbox gap={4} align="center">
              <Title level={5} style={{ margin: 0 }}>
                {t('provider.oauth.connect.waitingTitle')}
              </Title>
              <Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
                {t('provider.oauth.connect.waitingDesc')}
              </Text>
            </Flexbox>
          </Flexbox>
        );

      case 'success': {
        const conn = connections.find(c => c.provider_id === provider.id);
        return (
          <Result
            status="success"
            icon={<CheckCircle2 size={48} color={token.colorSuccess} />}
            title={t('provider.oauth.connect.successTitle')}
            subTitle={conn ? t('provider.oauth.connect.welcomeUser', { name: conn.user_name || conn.user_id }) : t('provider.oauth.connect.accountAuthorized')}
            extra={
              <Button type="primary" onClick={onSuccess}>
                {t('provider.oauth.connect.doneBtn')}
              </Button>
            }
          />
        );
      }

      case 'error':
        return (
          <Result
            status="error"
            icon={<XCircle size={48} color={token.colorError} />}
            title={t('provider.oauth.connect.failedTitle')}
            subTitle={error}
            extra={
              <Flexbox horizontal gap={8} justify="center">
                <Button onClick={onCancel}>{t('provider.oauth.connect.cancelBtn')}</Button>
                <Button
                  type="primary"
                  onClick={handleSignIn}
                >
                  {t('provider.oauth.connect.retryBtn')}
                </Button>
              </Flexbox>
            }
          />
        );
    }
  };

  const handleModalCancel = useCallback(() => {
    log.warn('OAuth2Modal', 'handleModalCancel called', { authState });
    if (authState === 'success') {
      log.warn('OAuth2Modal', '-> routing to onSuccess');
      onSuccess();
    } else {
      log.warn('OAuth2Modal', '-> routing to onCancel');
      onCancel();
    }
  }, [authState, onCancel, onSuccess]);

  return (
    <Modal
      open={open}
      onCancel={handleModalCancel}
      footer={null}
      width={420}
      centered
      destroyOnClose
      closable={authState !== 'waiting'}
      maskClosable={authState !== 'waiting'}
    >
      {renderContent()}
    </Modal>
  );
}
