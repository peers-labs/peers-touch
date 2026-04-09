import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, message, theme, Typography, Spin } from 'antd';
import { Github, Mail, Eye, EyeOff, ArrowRight, RefreshCw, Lock, LogIn, CheckCircle2, XCircle, X, ChevronRight } from 'lucide-react';
import { useOAuth2Store } from '../store/oauth2';
import type { OAuth2ProviderSummary } from '../services/desktop_api';
import { UserSquareAvatar } from '../components/common/UserSquareAvatar';
import { PlatformLogo } from '../components/common/PlatformLogo';
import { BRANDING } from '../branding';

const { Text } = Typography;

type LoginState = 'logged_out' | 'welcome_back';
type LoginTab = 'quick' | 'email';
type AuthState = 'idle' | 'waiting' | 'success' | 'error';

interface SessionUser {
  name: string;
  email: string;
  avatar?: string;
}

interface Props {
  onComplete: () => void;
  restoredUser?: SessionUser | null;
  embedded?: boolean;
}

const CARD_WIDTH = 400;
const CARD_MIN_HEIGHT = 420;
const PANEL_WIDTH = 250;
const ARROW_SIZE = 8;
const PANEL_GAP = 8;

export function LoginPage({ onComplete, restoredUser, embedded }: Props) {
  const { token } = theme.useToken();
  const { providers, connections, loadAll, loginWithPassword, startAuth } = useOAuth2Store();

  const [loginState, setLoginState] = useState<LoginState>(restoredUser ? 'welcome_back' : 'logged_out');
  const [tab, setTab] = useState<LoginTab>('quick');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [connectProvider, setConnectProvider] = useState<OAuth2ProviderSummary | null>(null);
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [authError, setAuthError] = useState('');
  const [arrowTop, setArrowTop] = useState(0);
  const buttonRefs = useRef<Record<string, HTMLElement | null>>({});
  const cardRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelTop, setPanelTop] = useState(0);

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
    const btn = buttonRefs.current[provider.id];
    const card = cardRef.current;
    if (btn && card) {
      const btnRect = btn.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      setArrowTop(btnRect.top - cardRect.top + btnRect.height / 2);
    }
    setConnectProvider(provider);
    setAuthState('idle');
    setAuthError('');
  }, []);

  const handleDrawerClose = useCallback(() => {
    if (authState === 'waiting') return;
    setConnectProvider(null);
    setAuthState('idle');
    setAuthError('');
  }, [authState]);

  const handleSignIn = useCallback(async () => {
    if (!connectProvider) return;
    setAuthState('waiting');
    setAuthError('');
    try {
      await startAuth(connectProvider.id);
      const updatedConn = useOAuth2Store.getState().connections.find(
        c => c.provider_id === connectProvider.id,
      );
      if (updatedConn) {
        setAuthState('success');
      } else {
        setAuthState('error');
        setAuthError('登录未完成，请重试。');
      }
    } catch (err: any) {
      setAuthState('error');
      setAuthError(err?.message || '登录失败，请重试。');
    }
  }, [connectProvider, startAuth]);

  const handleAuthDone = useCallback(() => {
    setConnectProvider(null);
    setAuthState('idle');
    onComplete();
  }, [onComplete]);

  const handleSwitchAccount = useCallback(() => {
    setConnectProvider(null);
    setAuthState('idle');
    setAuthError('');
    setLoginState('logged_out');
    setTab('quick');
  }, []);

  const handleBackToWelcome = useCallback(() => {
    setConnectProvider(null);
    setAuthState('idle');
    setAuthError('');
    setLoginState('welcome_back');
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

  const panelOpen = !!connectProvider && loginState === 'logged_out';
  const hasSignedInUser = !!(restoredUser || activeConnection);

  useEffect(() => {
    if (!panelOpen) return;
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      const card = cardRef.current;
      if (!panel || !card) return;
      const panelH = panel.offsetHeight;
      const cardH = card.offsetHeight;
      const idealTop = arrowTop - panelH / 2;
      const clamped = Math.max(0, Math.min(idealTop, cardH - panelH));
      setPanelTop(clamped);
    });
  }, [panelOpen, arrowTop]);

  const cardStyle: React.CSSProperties = {
    width: CARD_WIDTH,
    minHeight: CARD_MIN_HEIGHT,
    background: token.colorBgContainer,
    borderRadius: 24,
    boxShadow: token.boxShadow,
    border: `1px solid ${token.colorBorderSecondary}`,
    padding: '36px 32px',
    position: 'relative',
  };

  const renderDrawerContent = () => {
    if (!connectProvider) return null;

    const hasRemoteOAuth = ['github', 'google'].includes(connectProvider.id);
    const canSignIn = hasRemoteOAuth || (connectProvider.has_credentials ?? false);

    switch (authState) {
      case 'idle':
        return (
          <Flexbox gap={12} align="center">
            <Flexbox
              align="center" justify="center"
              style={{
                width: 40, height: 40, borderRadius: 10,
                background: connectProvider.color + '12',
              }}
            >
              <PlatformLogo providerId={connectProvider.id} size={20} color={connectProvider.color} />
            </Flexbox>
            <Flexbox gap={2} align="center">
              <Text strong style={{ fontSize: 13 }}>
                使用 {connectProvider.name} 登录
              </Text>
              <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>
                将前往 {connectProvider.name} 完成授权
              </Text>
            </Flexbox>
            <Button
              type="primary"
              size="small"
              icon={<LogIn size={13} />}
              onClick={handleSignIn}
              disabled={!canSignIn}
              style={{
                background: canSignIn ? connectProvider.color : undefined,
                width: '100%', borderRadius: 8, height: 32, fontSize: 12,
              }}
            >
              开始登录
            </Button>
          </Flexbox>
        );

      case 'waiting':
        return (
          <Flexbox gap={12} align="center" style={{ padding: '6px 0' }}>
            <Spin size="small" />
            <Text strong style={{ fontSize: 12 }}>等待完成登录...</Text>
            <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>
              请在新打开的窗口完成授权
            </Text>
          </Flexbox>
        );

      case 'success': {
        const conn = connections.find(c => c.provider_id === connectProvider.id);
        return (
          <Flexbox gap={12} align="center">
            <CheckCircle2 size={28} color={token.colorSuccess} />
            <Text strong style={{ fontSize: 13 }}>登录成功</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {conn ? `欢迎，${conn.user_name || conn.user_id}` : '账号已授权'}
            </Text>
            <Button type="primary" size="small" onClick={handleAuthDone} style={{ width: '100%', borderRadius: 8, height: 32, fontSize: 12 }}>
              完成
            </Button>
          </Flexbox>
        );
      }

      case 'error':
        return (
          <Flexbox gap={12} align="center">
            <XCircle size={28} color={token.colorError} />
            <Text strong style={{ fontSize: 13 }}>登录失败</Text>
            <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>{authError}</Text>
            <Flexbox horizontal gap={6} style={{ width: '100%' }}>
              <Button size="small" onClick={handleDrawerClose} style={{ flex: 1, borderRadius: 8, height: 32, fontSize: 12 }}>取消</Button>
              <Button type="primary" size="small" onClick={handleSignIn} style={{ flex: 1, borderRadius: 8, height: 32, fontSize: 12 }}>重试</Button>
            </Flexbox>
          </Flexbox>
        );
    }
  };

  const shiftX = panelOpen ? -(PANEL_WIDTH + PANEL_GAP + ARROW_SIZE) / 2 : 0;

  const cardContent = (
      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        transform: `translateX(${shiftX}px)`,
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <Flexbox
          ref={cardRef}
          style={cardStyle}
          align="center"
          justify="center"
          gap={0}
        >
          {loginState === 'logged_out' ? (
            <>
              {hasSignedInUser && (
                <button
                  onClick={handleBackToWelcome}
                  style={{
                    position: 'absolute',
                    top: 16,
                    left: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'none',
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 20,
                    padding: '4px 10px 4px 4px',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = token.colorFillQuaternary;
                    e.currentTarget.style.borderColor = token.colorBorder;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'none';
                    e.currentTarget.style.borderColor = token.colorBorderSecondary;
                  }}
                >
                  <UserSquareAvatar
                    url={welcomeUser.avatar}
                    name={welcomeUser.name}
                    size={24}
                    radius={12}
                  />
                  <ChevronRight size={12} style={{ color: token.colorTextTertiary }} />
                </button>
              )}

              {!embedded && (
                <img
                  src={BRANDING.logos.desktop}
                  alt={BRANDING.appName}
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    marginBottom: 16,
                    boxShadow: `0 2px 12px rgba(0,0,0,0.08), 0 0 0 1px ${token.colorBorderSecondary}`,
                  }}
                />
              )}

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
                <button style={tabStyle(tab === 'quick')} onClick={() => { setTab('quick'); }}>
                  Quick Login
                </button>
                <button style={tabStyle(tab === 'email')} onClick={() => { setTab('email'); setConnectProvider(null); setAuthState('idle'); setAuthError(''); }}>
                  Email Login
                </button>
              </div>

              <div style={{ width: '100%' }}>
                {tab === 'quick' ? (
                  <Flexbox gap={10}>
                    {oauth2AccountProviders.map(provider => (
                      <Button
                        key={provider.id}
                        ref={(el) => { buttonRefs.current[provider.id] = el; }}
                        style={{
                          ...oauthButtonStyle,
                          ...(connectProvider?.id === provider.id
                            ? { borderColor: provider.color || token.colorPrimary, color: provider.color || token.colorPrimary }
                            : {}),
                        }}
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
                    <Flexbox gap={10}>
                      <Input
                        size="large"
                        prefix={<Mail size={16} style={{ color: token.colorTextQuaternary }} />}
                        placeholder="Email address"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        style={{ borderRadius: 12, height: 44 }}
                        required
                      />
                      <Flexbox horizontal gap={8} align="center">
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
                          placeholder="Password"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          style={{ borderRadius: 12, height: 44, flex: 1 }}
                          required
                        />
                        <Button
                          type="primary"
                          htmlType="submit"
                          loading={loading}
                          style={{
                            height: 44,
                            borderRadius: 12,
                            fontWeight: 500,
                            padding: '0 16px',
                            flexShrink: 0,
                          }}
                          icon={!loading ? <ArrowRight size={16} /> : undefined}
                          iconPosition="end"
                        >
                          Sign In
                        </Button>
                      </Flexbox>
                    </Flexbox>
                  </form>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ position: 'relative', marginBottom: 20 }}>
                <div
                  style={{
                    position: 'absolute',
                    inset: -4,
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
                  style={{ flex: 1, height: 44, borderRadius: 12, fontWeight: 500 }}
                  icon={<RefreshCw size={16} />}
                  onClick={handleSwitchAccount}
                >
                  Switch Account
                </Button>
                <Button
                  type="primary"
                  size="large"
                  style={{ flex: 1, height: 44, borderRadius: 12, fontWeight: 500 }}
                  icon={<ArrowRight size={16} />}
                  iconPosition="end"
                  onClick={onComplete}
                >
                  Continue
                </Button>
              </Flexbox>
            </>
          )}
        </Flexbox>

        {panelOpen && (
          <div
            style={{
              position: 'absolute',
              left: `calc(100% + ${PANEL_GAP}px)`,
              top: 0,
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            <svg
              width={ARROW_SIZE}
              height={ARROW_SIZE * 2}
              style={{
                position: 'absolute',
                top: arrowTop,
                left: 0,
                transform: 'translateY(-50%)',
                filter: 'drop-shadow(-1px 0 1px rgba(0,0,0,0.05))',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            >
              <polygon
                points={`${ARROW_SIZE},0 0,${ARROW_SIZE} ${ARROW_SIZE},${ARROW_SIZE * 2}`}
                fill={token.colorBgContainer}
              />
            </svg>

            <div
              ref={panelRef}
              style={{
                position: 'absolute',
                top: panelTop,
                left: ARROW_SIZE,
                pointerEvents: 'auto',
              }}
            >
              <Flexbox
                style={{
                  width: PANEL_WIDTH,
                  background: token.colorBgContainer,
                  borderRadius: 14,
                  boxShadow: `0 4px 20px rgba(0,0,0,0.08), 0 0 0 1px ${token.colorBorderSecondary}`,
                  padding: '14px 14px',
                  position: 'relative',
                }}
                gap={0}
              >
                {authState !== 'waiting' && (
                  <button
                    onClick={handleDrawerClose}
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
                {renderDrawerContent()}
              </Flexbox>
            </div>
          </div>
        )}
      </div>
  );

  if (embedded) return cardContent;

  return (
    <Flexbox
      align="center"
      justify="center"
      style={{ width: '100%', height: '100%', background: token.colorBgLayout }}
    >
      {cardContent}
    </Flexbox>
  );
}
