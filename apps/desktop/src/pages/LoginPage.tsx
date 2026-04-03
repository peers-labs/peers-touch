import { useState, useEffect, useMemo, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, message, theme, Typography } from 'antd';
import { Github, Mail, Eye, EyeOff, ArrowRight, RefreshCw, Lock } from 'lucide-react';
import { useOAuth2Store } from '../store/oauth2';
import { OAuth2ConnectModal } from '../components/settings/OAuth2ConnectModal';
import type { OAuth2ProviderSummary } from '../services/desktop_api';
import { UserSquareAvatar } from '../components/common/UserSquareAvatar';
import { BRANDING } from '../branding';

const { Text } = Typography;

type LoginState = 'logged_out' | 'welcome_back';
type LoginTab = 'quick' | 'email';

interface SessionUser {
  name: string;
  email: string;
  avatar?: string;
}

interface Props {
  onComplete: () => void;
  restoredUser?: SessionUser | null;
}

export function LoginPage({ onComplete, restoredUser }: Props) {
  const { token } = theme.useToken();
  const { providers, connections, loadAll, loginWithPassword } = useOAuth2Store();

  const [loginState, setLoginState] = useState<LoginState>(restoredUser ? 'welcome_back' : 'logged_out');
  const [tab, setTab] = useState<LoginTab>('quick');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connectProvider, setConnectProvider] = useState<OAuth2ProviderSummary | null>(null);

  useEffect(() => {
    loadAll().then(() => {
      const conn = useOAuth2Store.getState().connections
        .find(c => c.status === 'active' && c.user_id && c.user_id !== 'unknown');
      if (conn && !restoredUser) {
        setLoginState('welcome_back');
      }
    });
  }, [loadAll, restoredUser]);

  const oauth2AccountProviders = useMemo(
    () => providers.filter(p => p.id === 'github' || p.id === 'google'),
    [providers],
  );

  const activeConnection = useMemo(
    () => connections.find(c => c.status === 'active' && c.user_id && c.user_id !== 'unknown'),
    [connections],
  );

  const welcomeUser: SessionUser = useMemo(() => {
    if (restoredUser) return restoredUser;
    if (activeConnection) {
      return {
        name: activeConnection.user_name || activeConnection.user_id || 'User',
        email: activeConnection.email || '',
        avatar: activeConnection.avatar_url,
      };
    }
    return { name: 'User', email: '' };
  }, [restoredUser, activeConnection]);

  const handleEmailLogin = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    try {
      await loginWithPassword(email.trim(), password);
      onComplete();
    } catch (err: any) {
      message.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }, [email, password, loginWithPassword, onComplete]);

  const handleOAuthConnect = useCallback((provider: OAuth2ProviderSummary) => {
    setConnectProvider(provider);
  }, []);

  const handleOAuthCancel = useCallback(() => {
    setConnectProvider(null);
  }, []);

  const handleOAuthSuccess = useCallback(() => {
    setConnectProvider(null);
    onComplete();
  }, [onComplete]);

  const handleSwitchAccount = useCallback(() => {
    setLoginState('logged_out');
    setTab('quick');
  }, []);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 0',
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    background: active ? token.colorBgContainer : 'transparent',
    color: active ? token.colorText : token.colorTextSecondary,
    boxShadow: active ? token.boxShadowTertiary : 'none',
  });

  const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );

  const oauthButtonStyle: React.CSSProperties = {
    width: '100%',
    height: 44,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    fontSize: 14,
    fontWeight: 500,
  };

  return (
    <Flexbox
      align="center"
      justify="center"
      style={{ width: '100%', height: '100%', background: token.colorBgLayout }}
    >
      {loginState === 'logged_out' ? (
        <Flexbox
          style={{
            width: '100%',
            maxWidth: 400,
            background: token.colorBgContainer,
            borderRadius: 24,
            boxShadow: token.boxShadow,
            border: `1px solid ${token.colorBorderSecondary}`,
            padding: '36px 32px',
          }}
          align="center"
          gap={0}
        >
          <img
            src={BRANDING.logos.desktop}
            alt={BRANDING.appName}
            style={{ width: 56, height: 56, borderRadius: 14, marginBottom: 20 }}
          />

          <h2 style={{ fontSize: 22, fontWeight: 700, color: token.colorText, margin: '0 0 6px' }}>
            Welcome
          </h2>
          <Text type="secondary" style={{ fontSize: 13, marginBottom: 24 }}>
            Sign in to your account to continue
          </Text>

          <div
            style={{
              width: '100%',
              background: token.colorFillQuaternary,
              padding: 4,
              borderRadius: 10,
              display: 'flex',
              marginBottom: 24,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <button style={tabStyle(tab === 'quick')} onClick={() => setTab('quick')}>
              Quick Login
            </button>
            <button style={tabStyle(tab === 'email')} onClick={() => setTab('email')}>
              Email Login
            </button>
          </div>

          <div style={{ width: '100%' }}>
            {tab === 'quick' ? (
              <Flexbox gap={10}>
                {oauth2AccountProviders.map(provider => (
                  <Button
                    key={provider.id}
                    style={oauthButtonStyle}
                    icon={
                      provider.id === 'github'
                        ? <Github size={18} />
                        : <GoogleIcon />
                    }
                    onClick={() => handleOAuthConnect(provider)}
                  >
                    Continue with {provider.name}
                  </Button>
                ))}
                {oauth2AccountProviders.length === 0 && (
                  <>
                    <Button style={oauthButtonStyle} icon={<Github size={18} />} disabled>
                      Continue with GitHub
                    </Button>
                    <Button style={oauthButtonStyle} icon={<GoogleIcon />} disabled>
                      Continue with Google
                    </Button>
                  </>
                )}
              </Flexbox>
            ) : (
              <form onSubmit={handleEmailLogin}>
                <Flexbox gap={16}>
                  <Flexbox gap={4}>
                    <Text strong style={{ fontSize: 13 }}>Email address</Text>
                    <Input
                      size="large"
                      prefix={<Mail size={16} style={{ color: token.colorTextQuaternary }} />}
                      placeholder="you@example.com"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      style={{ borderRadius: 12 }}
                      required
                    />
                  </Flexbox>
                  <Flexbox gap={4}>
                    <Text strong style={{ fontSize: 13 }}>Password</Text>
                    <Input
                      size="large"
                      prefix={<Lock size={16} style={{ color: token.colorTextQuaternary }} />}
                      suffix={
                        <span
                          onClick={() => setShowPassword(!showPassword)}
                          style={{ cursor: 'pointer', color: token.colorTextQuaternary, display: 'flex' }}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </span>
                      }
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      style={{ borderRadius: 12 }}
                      required
                    />
                  </Flexbox>
                  <Button
                    type="primary"
                    htmlType="submit"
                    size="large"
                    loading={loading}
                    style={{
                      width: '100%',
                      height: 44,
                      borderRadius: 12,
                      fontWeight: 500,
                      marginTop: 4,
                    }}
                    icon={!loading ? <ArrowRight size={16} /> : undefined}
                    iconPosition="end"
                  >
                    Sign In
                  </Button>
                </Flexbox>
              </form>
            )}
          </div>

          {(restoredUser || activeConnection) && (
            <Button
              type="link"
              size="small"
              style={{ marginTop: 16, fontSize: 13 }}
              onClick={() => setLoginState('welcome_back')}
            >
              ← Back to {welcomeUser.name}
            </Button>
          )}
        </Flexbox>
      ) : (
        <Flexbox
          style={{
            width: '100%',
            maxWidth: 400,
            background: token.colorBgContainer,
            borderRadius: 24,
            boxShadow: token.boxShadow,
            border: `1px solid ${token.colorBorderSecondary}`,
            padding: '40px 32px',
          }}
          align="center"
          gap={0}
        >
          <div style={{ position: 'relative', marginBottom: 20 }}>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: BRANDING.colors.gradient,
                borderRadius: '50%',
                filter: 'blur(20px)',
                opacity: 0.2,
              }}
            />
            <UserSquareAvatar
              url={welcomeUser.avatar}
              name={welcomeUser.name}
              size={88}
              radius={44}
              border={`3px solid ${token.colorBgContainer}`}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 2,
                right: 2,
                width: 18,
                height: 18,
                background: '#52c41a',
                border: `2px solid ${token.colorBgContainer}`,
                borderRadius: '50%',
              }}
            />
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, color: token.colorText, margin: '0 0 4px' }}>
            Welcome back,
          </h2>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: token.colorText, margin: '0 0 6px' }}>
            {welcomeUser.name}
          </h3>
          {welcomeUser.email && (
            <Text type="secondary" style={{ fontSize: 13, marginBottom: 28 }}>
              {welcomeUser.email}
            </Text>
          )}
          {!welcomeUser.email && <div style={{ marginBottom: 28 }} />}

          <Flexbox horizontal gap={12} style={{ width: '100%' }}>
            <Button
              size="large"
              style={{
                flex: 1,
                height: 44,
                borderRadius: 12,
                fontWeight: 500,
              }}
              icon={<RefreshCw size={16} />}
              onClick={handleSwitchAccount}
            >
              Switch Account
            </Button>
            <Button
              type="primary"
              size="large"
              style={{
                flex: 1,
                height: 44,
                borderRadius: 12,
                fontWeight: 500,
              }}
              icon={<ArrowRight size={16} />}
              iconPosition="end"
              onClick={onComplete}
            >
              Continue
            </Button>
          </Flexbox>
        </Flexbox>
      )}

      <OAuth2ConnectModal
        provider={connectProvider}
        open={!!connectProvider}
        onCancel={handleOAuthCancel}
        onSuccess={handleOAuthSuccess}
      />
    </Flexbox>
  );
}
