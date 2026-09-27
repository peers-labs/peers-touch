import { useState, useEffect } from 'react';
import { Button, Card, Input, Typography } from 'antd';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  Mail,
  Server,
} from 'lucide-react';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import logo from '../assets/logo.png';

const { Text, Title } = Typography;

const GitHubIcon = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

const GoogleIcon = () => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);

/** OAuth redirect simulation overlay */
function OAuthOverlay({ provider, onDone }: { provider: string; onDone: () => void }) {
  const [phase, setPhase] = useState<'redirect' | 'auth' | 'callback' | 'done'>('redirect');

  const providerName = provider === 'github' ? 'GitHub' : 'Google';
  const providerColor = provider === 'github' ? '#1f2330' : '#4285F4';

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('auth'), 1200);
    const t2 = setTimeout(() => setPhase('callback'), 2800);
    const t3 = setTimeout(() => setPhase('done'), 3600);
    const t4 = setTimeout(onDone, 4200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [onDone]);

  return (
    <div className="mp-oauth-overlay">
      <div className="mp-oauth-overlay-card">
        {phase === 'redirect' && (
          <>
            <ExternalLink size={32} color={providerColor} className="mp-oauth-icon-spin" />
            <Text strong>Redirecting to {providerName}...</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>Opening secure login page</Text>
          </>
        )}
        {phase === 'auth' && (
          <>
            <Loader2 size={32} color={providerColor} className="mp-oauth-icon-spin" />
            <Text strong>Authenticating with {providerName}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>Waiting for authorization...</Text>
          </>
        )}
        {phase === 'callback' && (
          <>
            <Loader2 size={32} color="var(--mp-primary)" className="mp-oauth-icon-spin" />
            <Text strong>Authorization received</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>Verifying with station...</Text>
          </>
        )}
        {phase === 'done' && (
          <>
            <CheckCircle2 size={32} color="var(--mp-success)" />
            <Text strong>Login successful</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>Welcome back, Alice!</Text>
          </>
        )}
      </div>
    </div>
  );
}

export function AuthGateScreen({
  stationLabel, expiredSession, onBack, onLogin,
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
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [loginTab, setLoginTab] = useState<'quick' | 'email'>('quick');
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);

  const rememberedAccounts = [{ email: 'alice@peers.social', displayName: 'Alice Chen' }];
  const canLogin = Boolean(email.trim() && password);

  function handleLogin() {
    if (!canLogin || loading) return;
    setLoading(true);
    setTimeout(() => { setLoading(false); onLogin(); }, 600);
  }

  function handleOAuth(provider: string) {
    setOauthProvider(provider);
  }

  function handleOAuthDone() {
    setOauthProvider(null);
    onLogin();
  }

  return (
    <main
      className="mp-auth-screen"
      data-session-expired={expiredSession ? 'true' : 'false'}
    >
      {oauthProvider && <OAuthOverlay provider={oauthProvider} onDone={handleOAuthDone} />}
      <div className="mp-auth-toolbar"><LanguageSwitcher /></div>
      <Card className="mp-auth-card" variant="borderless">
        <section className="mp-auth-brand">
          <img src={logo} alt="Peers" className="mp-auth-logo" />
          <Title level={1} className="mp-auth-title">
            {expiredSession ? 'Welcome back' : 'Sign In'}
          </Title>
          <Text type="secondary" className="mp-auth-subtitle">
            {expiredSession
              ? 'Sign in again to continue where you left off.'
              : 'Log in before entering this Station'}
          </Text>
        </section>

        {expiredSession && (
          <div className="mp-auth-session-notice" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <span className="mp-auth-session-notice-copy">
              <Text strong>Session expired</Text>
              <Text type="secondary">{expiredSession.displayName}</Text>
              <Text type="secondary">{expiredSession.email}</Text>
            </span>
          </div>
        )}

        <div className="mp-auth-station-summary">
          <span className="mp-auth-station-icon"><Server size={18} /></span>
          <span className="mp-auth-station-copy">
            <Text strong>{stationLabel}</Text>
            <Text type="secondary">Connected to this Station</Text>
          </span>
        </div>

        {/* Tab switcher */}
        <div className="mp-auth-tab-row">
          <button
            type="button"
            className={`mp-auth-tab ${loginTab === 'quick' ? 'active' : ''}`}
            onClick={() => setLoginTab('quick')}
          >Quick Login</button>
          <button
            type="button"
            className={`mp-auth-tab ${loginTab === 'email' ? 'active' : ''}`}
            onClick={() => setLoginTab('email')}
          >Email Login</button>
        </div>

        {/* Tab content — both rendered, overlaid via grid to lock height */}
        <div className="mp-auth-tab-content">
          <div className={`mp-auth-oauth ${loginTab === 'quick' ? 'active' : ''}`}>
            <Button
              block
              size="large"
              className="mp-oauth-btn mp-oauth-github"
              icon={<GitHubIcon />}
              onClick={() => handleOAuth('github')}
              disabled={loading}
            >
              Continue with GitHub
            </Button>
            <Button
              block
              size="large"
              className="mp-oauth-btn mp-oauth-google"
              icon={<GoogleIcon />}
              onClick={() => handleOAuth('google')}
              disabled={loading}
            >
              Continue with Google
            </Button>
          </div>

          <div className={`mp-auth-fields ${loginTab === 'email' ? 'active' : ''}`}>
            {!expiredSession && rememberedAccounts.length > 0 && (
              <div className="mp-auth-account-history">
                <Text type="secondary">Recent accounts</Text>
                <div className="mp-auth-account-list">
                  {rememberedAccounts.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      className={`mp-auth-account-chip ${account.email === email ? 'active' : ''}`}
                      onClick={() => setEmail(account.email)}
                    >
                      <span>{account.displayName}</span>
                      <small>{account.email}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Input value={email} placeholder="Email address" size="large"
              prefix={<Mail size={16} aria-hidden="true" />} inputMode="email"
              autoCapitalize="none" autoCorrect="off"
              onChange={(e) => setEmail(e.target.value)} onPressEnter={handleLogin} />
            <Input.Password value={password} placeholder="Password" size="large"
              prefix={<Lock size={16} aria-hidden="true" />}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} onPressEnter={handleLogin} />
          </div>
        </div>

        <div className={`mp-auth-actions ${loginTab === 'quick' ? 'single' : ''}`}>
          <Button icon={<ArrowLeft size={16} />} onClick={onBack}>Change Station</Button>
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
