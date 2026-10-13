import { useEffect, useRef, useState } from 'react';
import { Button, Card, Input, Typography } from 'antd';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Github,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Server,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import logo from '../assets/logo.png';

const { Text, Title } = Typography;
type LoginTab = 'quick' | 'email';
type QuickMode = 'oauth' | 'pin' | 'accounts';
type ProviderId = 'github' | 'google';
type OAuthPhase = 'idle' | 'opening' | 'waiting' | 'initializing' | 'success' | 'error';

function GoogleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 0 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export function AuthGateScreen({
  stationLabel,
  expiredSession,
  onBack,
  onLogin,
}: {
  stationLabel: string;
  expiredSession?: {
    displayName: string;
    email: string;
  } | null;
  onBack: () => void;
  onLogin: () => void;
}) {
  const [email, setEmail] = useState('alice@peers.social');
  const [password, setPassword] = useState('1');
  const [loading, setLoading] = useState(false);
  const [loginTab, setLoginTab] = useState<LoginTab>('quick');
  const [quickMode, setQuickMode] = useState<QuickMode>('oauth');
  const [pin, setPin] = useState('1234');
  const [providerId, setProviderId] = useState<ProviderId | null>(null);
  const [oauthPhase, setOauthPhase] = useState<OAuthPhase>('idle');
  const timersRef = useRef<number[]>([]);
  const canLogin = Boolean(email.trim() && password);

  const clearTimers = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  };

  useEffect(() => clearTimers, []);

  function handleLogin() {
    if (!canLogin || loading) return;
    setLoading(true);
    const timer = window.setTimeout(() => {
      setLoading(false);
      onLogin();
    }, 600);
    timersRef.current.push(timer);
  }

  function startOAuth(provider: ProviderId) {
    clearTimers();
    setProviderId(provider);
    setOauthPhase('opening');
    timersRef.current = [
      window.setTimeout(() => setOauthPhase('waiting'), 500),
      window.setTimeout(() => setOauthPhase('initializing'), 1_500),
      window.setTimeout(() => setOauthPhase('success'), 2_300),
      window.setTimeout(onLogin, 2_900),
    ];
  }

  function handlePinLogin() {
    if (pin.length < 4 || loading) return;
    setLoading(true);
    const timer = window.setTimeout(() => {
      setLoading(false);
      onLogin();
    }, 500);
    timersRef.current.push(timer);
  }

  function cancelOAuth() {
    clearTimers();
    setProviderId(null);
    setOauthPhase('idle');
  }

  const providerState = (provider: ProviderId) => providerId === provider ? oauthPhase : 'idle';
  const providerLabel = (provider: ProviderId, name: string) => {
    const phase = providerState(provider);
    if (phase === 'opening') return `Opening ${name}...`;
    if (phase === 'waiting') return 'Waiting for authorization...';
    if (phase === 'initializing') return 'Preparing your account...';
    if (phase === 'success') return 'Login successful';
    if (phase === 'error') return `Retry ${name}`;
    return `Continue with ${name}`;
  };
  const providerIcon = (provider: ProviderId) => {
    const phase = providerState(provider);
    if (phase === 'opening' || phase === 'waiting' || phase === 'initializing') {
      return <Loader2 size={17} className="mp-oauth-icon-spin" />;
    }
    if (phase === 'success') return <Check size={17} />;
    return provider === 'github' ? <Github size={17} /> : <GoogleIcon />;
  };

  return (
    <main className="mp-auth-screen" data-session-expired={expiredSession ? 'true' : 'false'}>
      <div className="mp-access-network" aria-hidden="true">
        <span /><span /><span /><span /><span /><span />
      </div>
      <div className="mp-auth-toolbar"><LanguageSwitcher /></div>
      <Card className="mp-auth-card" variant="borderless">
        <section className="mp-auth-brand">
          <img src={logo} alt="Peers" className="mp-auth-logo" />
          <Title level={1} className="mp-auth-title">
            {expiredSession ? 'Welcome back' : 'Welcome'}
          </Title>
          <Text type="secondary" className="mp-auth-subtitle">
            {expiredSession
              ? 'Sign in again to continue where you left off.'
              : 'Sign in to your account to continue'}
          </Text>
        </section>

        {expiredSession && (
          <div className="mp-auth-session-notice" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <span className="mp-auth-session-notice-copy">
              <Text strong>Session expired</Text>
              <Text type="secondary">{expiredSession.displayName} · {expiredSession.email}</Text>
            </span>
          </div>
        )}

        <div className="mp-auth-station-summary">
          <span className="mp-auth-station-icon"><Server size={18} /></span>
          <span className="mp-auth-station-copy">
            <Text strong>{stationLabel}</Text>
            <Text type="secondary"><ShieldCheck size={11} /> Verified Station</Text>
          </span>
        </div>

        <div className="mp-auth-tab-row" role="group" aria-label="Sign-in method">
          <button
            type="button"
            aria-pressed={loginTab === 'quick'}
            className={`mp-auth-tab ${loginTab === 'quick' ? 'active' : ''}`}
            disabled={providerId !== null}
            onClick={() => setLoginTab('quick')}
          >
            Quick Login
          </button>
          <button
            type="button"
            aria-pressed={loginTab === 'email'}
            className={`mp-auth-tab ${loginTab === 'email' ? 'active' : ''}`}
            disabled={providerId !== null}
            onClick={() => setLoginTab('email')}
          >
            Email Login
          </button>
        </div>

        <div className="mp-auth-tab-content">
          <div className={`mp-auth-quick ${loginTab === 'quick' ? 'active' : ''}`}>
            <div className="mp-auth-quick-modes" role="group" aria-label="Quick login mode">
              {([
                ['oauth', 'OAuth'],
                ['pin', 'PIN'],
                ['accounts', 'Accounts'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={quickMode === mode}
                  className={quickMode === mode ? 'active' : ''}
                  disabled={providerId !== null}
                  onClick={() => setQuickMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            {quickMode === 'oauth' && (
              <div className="mp-auth-oauth">
                {([
                  ['github', 'GitHub'],
                  ['google', 'Google'],
                ] as const).map(([provider, name]) => {
                  const active = providerId === provider;
                  const pending = active && ['opening', 'waiting', 'initializing'].includes(oauthPhase);
                  return (
                    <div key={provider} className="mp-oauth-action">
                      <Button
                        block
                        size="large"
                        className="mp-oauth-btn"
                        icon={providerIcon(provider)}
                        aria-label={providerLabel(provider, name)}
                        data-oauth-provider={provider}
                        data-oauth-state={providerState(provider)}
                        disabled={(providerId !== null && !active) || pending}
                        onClick={() => startOAuth(provider)}
                      >
                        {providerLabel(provider, name)}
                      </Button>
                      {active && (oauthPhase === 'opening' || oauthPhase === 'waiting' || oauthPhase === 'error') && (
                        <button type="button" className="mp-oauth-cancel" aria-label={`Cancel ${name} sign-in`} onClick={cancelOAuth}>
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {quickMode === 'pin' && (
              <div className="mp-auth-pin">
                <div className="mp-auth-remembered-account">
                  <span className="mp-auth-account-avatar"><UserRound size={18} /></span>
                  <span><Text strong>Alice Chen</Text><Text type="secondary">alice@peers.social</Text></span>
                </div>
                <Input.Password
                  autoFocus
                  aria-label="Account PIN"
                  inputMode="numeric"
                  maxLength={8}
                  prefix={<KeyRound size={16} />}
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                  onPressEnter={handlePinLogin}
                />
                <Button block type="primary" loading={loading} disabled={pin.length < 4 || loading} onClick={handlePinLogin}>
                  Unlock
                </Button>
              </div>
            )}
            {quickMode === 'accounts' && (
              <div className="mp-auth-accounts">
                <button type="button" onClick={() => setQuickMode('pin')}>
                  <span className="mp-auth-account-avatar"><UserRound size={18} /></span>
                  <span><strong>Alice Chen</strong><small>alice@peers.social</small></span>
                  <span>Use</span>
                </button>
                <button type="button" onClick={() => setLoginTab('email')}>
                  <span className="mp-auth-account-avatar"><Mail size={18} /></span>
                  <span><strong>Another account</strong><small>Sign in with email</small></span>
                  <span>Open</span>
                </button>
              </div>
            )}
          </div>

          <div className={`mp-auth-fields ${loginTab === 'email' ? 'active' : ''}`}>
            <Input
              value={email}
              placeholder="Email address"
              size="large"
              prefix={<Mail size={16} aria-hidden="true" />}
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(event) => setEmail(event.target.value)}
              onPressEnter={handleLogin}
            />
            <Input.Password
              value={password}
              placeholder="Passport"
              size="large"
              prefix={<Lock size={16} aria-hidden="true" />}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              onPressEnter={handleLogin}
            />
          </div>
        </div>

        <div className={`mp-auth-actions ${loginTab === 'quick' ? 'single' : ''}`}>
          <Button icon={<ArrowLeft size={16} />} disabled={providerId !== null} onClick={onBack}>
            Change Station
          </Button>
          {loginTab === 'email' && (
            <Button type="primary" loading={loading} disabled={!canLogin || loading} onClick={handleLogin}>
              Sign In
            </Button>
          )}
        </div>
      </Card>
    </main>
  );
}
