import { useState } from 'react';
import { Button, Icon, PasswordField, TextField } from '@peers-touch/ui';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

const GitHubIcon = () => <Icon iconId="github" size={18} />;
const MailIcon = () => <Icon iconId="mail" size={18} />;

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
  };
  onBack: () => void;
  onLogin: () => void;
}) {
  const [loginTab, setLoginTab] = useState<'quick' | 'email'>('quick');
  const [email, setEmail] = useState('alice@peers.social');
  const [password, setPassword] = useState('password123');
  const [canLogin, setCanLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);

  const rememberedAccounts = [{ email: 'alice@peers.social', displayName: 'Alice Chen' }];

  function handleLogin() {
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      onLogin();
    }, 600);
  }

  function handleOAuth(provider: string) {
    setOauthProvider(provider);
    const t1 = 1200;
    const t2 = 3600;
    const oauthTimers = [
      window.setTimeout(() => setOauthProvider('done'), t1),
      window.setTimeout(() => {
        onLogin();
      }, t2),
    ];
    return () => oauthTimers.forEach((t) => window.clearTimeout(t));
  }

  return (
    <main className="mp-auth-screen">
      <div className="mp-auth-toolbar"><LanguageSwitcher /></div>
      <div className="mp-auth-card" style={{ margin: 'auto 0' }}>
        <section className="mp-auth-brand">
          <div className="mp-auth-logo-placeholder" aria-hidden="true">
            <Icon iconId="users-round" size={22} />
          </div>
          <div className="mp-auth-brand-copy">
            <h1 className="mp-auth-title" id="auth-title">Sign In</h1>
            <span className="mp-auth-subtitle">
              Log in before entering this Station
            </span>
          </div>
        </section>
        {expiredSession && (
          <div className="mp-auth-session-notice" role="status">
            <Icon iconId="attention" size={16} />
            <span className="mp-auth-session-notice-copy">
              <TextStub title={expiredSession.displayName} />
              <span>{expiredSession.email}</span>
            </span>
          </div>
        )}
        <div className="mp-auth-station-summary">
          <span className="mp-auth-station-icon"><Icon iconId="server" size={18} /></span>
          <span className="mp-auth-station-copy">
            <strong>{stationLabel}</strong>
            <span>Connected to this Station</span>
          </span>
        </div>
        <div className="mp-auth-tab-row" role="tablist" aria-label="Login method">
          <button type="button" className={`mp-auth-tab ${loginTab === 'quick' ? 'active' : ''}`}
            aria-selected={loginTab === 'quick'} onClick={() => setLoginTab('quick')}>
            Quick Login
          </button>
          <button type="button" className={`mp-auth-tab ${loginTab === 'email' ? 'active' : ''}`}
            aria-selected={loginTab === 'email'} onClick={() => setLoginTab('email')}>
            Email Login
          </button>
        </div>
        <div className="mp-auth-tab-content">
          <div className={`mp-auth-oauth ${loginTab === 'quick' ? 'active' : ''}`}>
            <Button actionId="auth.github" className="mp-oauth-btn mp-oauth-github"
              leading={<GitHubIcon />}
              execution={oauthProvider === 'github' ? 'pending' : 'idle'}
              executionLabel="Redirecting to GitHub"
              onActivate={() => handleOAuth('github')}>
              Continue with GitHub
            </Button>
            <Button actionId="auth.google" className="mp-oauth-btn mp-oauth-google"
              leading={<MailIcon />}
              onActivate={() => handleOAuth('email')}>
              Continue with Email
            </Button>
          </div>
          <div className={`mp-auth-fields ${loginTab === 'email' ? 'active' : ''}`}>
            {!expiredSession && rememberedAccounts.length > 0 && (
              <div className="mp-auth-account-history">
                <TextMuted>Recent accounts</TextMuted>
                <div className="mp-auth-account-list">
                  {rememberedAccounts.map((account) => (
                    <button key={account.email} type="button" className="mp-auth-account-chip"
                      onClick={() => { setEmail(account.email); setCanLogin(true); }}>
                      <span>{account.displayName}</span>
                      <small>{account.email}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <TextField type="email" aria-label="Email address" value={email}
              leading={<Icon iconId="mail" size={16} />}
              onValueChange={(v) => { setEmail(v); setCanLogin(v.trim().length > 0); }} />
            <PasswordField aria-label="Password" value={password}
              leading={<Icon iconId="lock" size={16} />}
              onValueChange={(v) => { setPassword(v); setCanLogin(v.length >= 6); }} />
          </div>
        </div>
        <div className={`mp-auth-actions ${loginTab === 'quick' ? 'single' : ''}`}>
          <Button actionId="auth.back" onClick={onBack}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon iconId="arrow-left" size={15} /> Change Station
            </span>
          </Button>
          {loginTab === 'email' && (
            <Button actionId="auth.submit" emphasis="primary"
              execution={loading ? 'pending' : 'idle'}
              availability={!canLogin || loading ? { kind: 'disabled', reason: 'Enter email and password' } : undefined}
              onActivate={handleLogin}>
              Sign In
            </Button>
          )}
        </div>
      </div>
      {oauthProvider && (
        <div className="mp-oauth-overlay">
          <div className="mp-oauth-overlay-card">
            {oauthProvider === 'done' ? <Icon iconId="circle-check-big" size={32} /> : <Icon iconId="refresh-ccw" size={32} className="mp-oauth-icon-spin" />}
            {oauthProvider === 'done' ? <strong>Login successful</strong> : <strong>Authenticating with GitHub...</strong>}
            <span>Waiting for authorization...</span>
          </div>
        </div>
      )}
    </main>
  );
}

function TextStub({ title }: { title: string }) {
  return <strong>Welcome back, {title}</strong>;
}
function TextMuted({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, color: 'var(--pt-secondary)' }}>{children}</span>;
}
