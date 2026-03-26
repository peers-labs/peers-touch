import { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Typography, Spin, Result, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { LogIn, CheckCircle2, XCircle } from 'lucide-react';
import type { OAuth2ProviderSummary } from '../../services/desktop_api';
import { useOAuth2Store } from '../../store/oauth2';
import { PlatformLogo } from '../common/PlatformLogo';

const { Text, Title } = Typography;

type AuthState = 'idle' | 'waiting' | 'success' | 'error';

interface Props {
  provider: OAuth2ProviderSummary | null;
  open: boolean;
  onClose: () => void;
}

export function OAuth2ConnectModal({ provider, open, onClose }: Props) {
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
        setError('Authorization was cancelled or failed. Please try again.');
      }
    } catch (err: any) {
      setAuthState('error');
      setError(err?.message || 'Authorization failed');
    }
  }, [provider, startAuth]);

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
                Sign in with {provider.name}
              </Title>
              <Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
                You will be redirected to {provider.name} to authorize Peers Touch to access your account.
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
              Sign in with {provider.name}
            </Button>
          </Flexbox>
        );

      case 'waiting':
        return (
          <Flexbox gap={20} align="center" style={{ padding: '24px 0' }}>
            <Spin size="large" />
            <Flexbox gap={4} align="center">
              <Title level={5} style={{ margin: 0 }}>
                Waiting for authorization...
              </Title>
              <Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
                Complete the sign-in in the popup window.
                <br />
                This dialog will update automatically.
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
            title="Signed In Successfully"
            subTitle={conn ? `Welcome, ${conn.user_name || conn.user_id}` : 'Account authorized'}
            extra={
              <Button type="primary" onClick={onClose}>
                Done
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
            title="Sign In Failed"
            subTitle={error}
            extra={
              <Flexbox horizontal gap={8} justify="center">
                <Button onClick={onClose}>Cancel</Button>
                <Button
                  type="primary"
                  onClick={handleSignIn}
                >
                  Try Again
                </Button>
              </Flexbox>
            }
          />
        );
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={420}
      centered
      destroyOnClose
      closable
      maskClosable
    >
      {renderContent()}
    </Modal>
  );
}
