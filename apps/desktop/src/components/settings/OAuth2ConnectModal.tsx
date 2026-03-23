import { useState, useEffect, useCallback } from 'react';
import { Modal, Radio, Button, Typography, Spin, Result, theme, Space, Alert } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { LogIn, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { OAuth2ProviderSummary } from '../../services/api';
import { useOAuth2Store } from '../../store/oauth2';
import { PlatformLogo } from '../common/PlatformLogo';

const { Text, Title } = Typography;

type AuthState = 'idle' | 'selecting_env' | 'waiting' | 'success' | 'error';

interface Props {
  provider: OAuth2ProviderSummary | null;
  open: boolean;
  onClose: () => void;
}

export function OAuth2ConnectModal({ provider, open, onClose }: Props) {
  const { token } = theme.useToken();
  const { startAuth, connections } = useOAuth2Store();
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [selectedEnv, setSelectedEnv] = useState<string>('');
  const [error, setError] = useState('');

  const hasEnvironments = provider && provider.environments && provider.environments.length > 0;
  const hasCreds = provider?.has_credentials ?? false;

  useEffect(() => {
    if (open && provider) {
      setError('');
      if (hasEnvironments) {
        const defaultEnv = provider.environments!.find(e => e.default);
        setSelectedEnv(defaultEnv?.id || provider.environments![0].id);
        setAuthState('selecting_env');
      } else {
        setAuthState('idle');
      }
    }
  }, [open, provider, hasEnvironments]);

  const handleSignIn = useCallback(async () => {
    if (!provider) return;
    setAuthState('waiting');
    setError('');
    try {
      await startAuth(provider.id, hasEnvironments ? selectedEnv : undefined);
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
  }, [provider, startAuth, hasEnvironments, selectedEnv]);

  if (!provider) return null;

  const renderContent = () => {
    switch (authState) {
      case 'selecting_env':
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
            <Title level={5} style={{ margin: 0 }}>
              Sign in with {provider.name}
            </Title>
            <Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
              You will be redirected to {provider.name} to authorize Agent Box.
            </Text>
            <Flexbox gap={8} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                Select your environment:
              </Text>
              <Radio.Group
                value={selectedEnv}
                onChange={e => setSelectedEnv(e.target.value)}
                style={{ width: '100%' }}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  {provider.environments!.map(env => (
                    <Radio
                      key={env.id}
                      value={env.id}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: `1px solid ${selectedEnv === env.id ? provider.color : token.colorBorderSecondary}`,
                        background: selectedEnv === env.id ? provider.color + '08' : 'transparent',
                        width: '100%',
                        transition: 'all 0.2s',
                      }}
                    >
                      <Text strong={selectedEnv === env.id}>{env.name}</Text>
                    </Radio>
                  ))}
                </Space>
              </Radio.Group>
            </Flexbox>
            {!hasCreds && (
              <Alert
                type="warning"
                showIcon
                icon={<AlertTriangle size={14} style={{ marginTop: 2 }} />}
                message={
                  <span style={{ fontSize: 12 }}>
                    Credentials not configured. Configure them in the Connections section first.
                  </span>
                }
                style={{ borderRadius: 8, width: '100%' }}
              />
            )}
            <Button
              type="primary"
              size="large"
              icon={<LogIn size={16} />}
              onClick={handleSignIn}
              disabled={!hasCreds}
              style={{ background: hasCreds ? provider.color : undefined, width: '100%', marginTop: 4 }}
            >
              Sign In
            </Button>
          </Flexbox>
        );

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
                You will be redirected to {provider.name} to authorize Agent Box to access your account.
              </Text>
            </Flexbox>
            {!hasCreds && (
              <Alert
                type="warning"
                showIcon
                icon={<AlertTriangle size={14} style={{ marginTop: 2 }} />}
                message={
                  <span style={{ fontSize: 12 }}>
                    Credentials not configured. Configure them in the Connections section first.
                  </span>
                }
                style={{ borderRadius: 8, width: '100%' }}
              />
            )}
            <Button
              type="primary"
              size="large"
              icon={<LogIn size={16} />}
              onClick={handleSignIn}
              disabled={!hasCreds}
              style={{ background: hasCreds ? provider.color : undefined, width: '100%' }}
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
                  onClick={() => setAuthState(hasEnvironments ? 'selecting_env' : 'idle')}
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
