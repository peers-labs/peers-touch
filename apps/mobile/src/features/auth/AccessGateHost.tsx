import { useEffect, useState } from 'react';
import { Button, Card, Input, Typography } from 'antd';
import { ArrowLeft, Code2, Globe2, KeyRound, LockKeyhole, Server, ShieldAlert } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import {
  cancelOAuth,
  oauthPhaseMessageKey,
  refreshOAuthStatus,
  retryOAuthBrowser,
  startOAuth,
  useAuthRuntime,
  type MobileOAuthProvider,
} from '../../runtimes/authRuntime';
import {
  accessDecisionMessage,
  isAccessBlocked,
  isAccessGranted,
  isInviteCodeGate,
  isLoginGate,
  parseGateFields,
  type AccessDecision,
  type RememberedLoginAccount,
  type StationLoginInput,
} from './authSession';

const { Text, Title } = Typography;

export function AccessGateHost({
  decision,
  stationLabel,
  stationUrl,
  error,
  loading,
  rememberedAccounts,
  onBack,
  onLogin,
  onInviteCode,
}: {
  decision: AccessDecision | null;
  stationLabel: string;
  stationUrl: string;
  error: string | null;
  loading: boolean;
  rememberedAccounts: RememberedLoginAccount[];
  onBack: () => void;
  onLogin: (input: Omit<StationLoginInput, 'stationPeerId' | 'stationUrl'>) => Promise<void>;
  onInviteCode: (code: string) => Promise<void>;
}) {
  const { t } = useMobileI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const oauth = useAuthRuntime();

  const ready = Boolean(decision);
  const blocked = isAccessBlocked(decision);
  const blockedMessage = accessDecisionMessage(decision);
  const currentGate = decision?.gates.find((gate) => gate.gateId === decision.currentGateId);

  // The Station drives which gate renders. Invite-code is schema-driven; the
  // login gate keeps its purpose-built credential form. When no gate is named
  // we default to the login form so the legacy flow is unaffected.
  const showInviteCode = ready && !blocked && isInviteCodeGate(currentGate);
  const showLogin = ready
    && !blocked
    && !isAccessGranted(decision)
    && (isLoginGate(currentGate) || !currentGate);

  const inviteFields = parseGateFields(currentGate);
  const inviteFieldLabel = inviteFields[0]?.label;
  const invitePlaceholder = inviteFields[0]?.placeholder;

  const canLogin = Boolean(showLogin && email.trim() && password);
  const canSubmitInvite = Boolean(showInviteCode && inviteCode.trim());

  useEffect(() => {
    if (email.trim() || rememberedAccounts.length === 0) return;
    setEmail(rememberedAccounts[0].email);
  }, [email, rememberedAccounts]);

  async function submitLogin() {
    if (!canLogin || loading || blocked) return;
    await onLogin({ email, password });
    setPassword('');
  }

  async function submitInvite() {
    if (!canSubmitInvite || loading || blocked) return;
    await onInviteCode(inviteCode.trim());
    setInviteCode('');
  }

  async function submitOAuth(provider: MobileOAuthProvider) {
    if (!showLogin || loading || !decision?.attemptId) return;
    await startOAuth({
      provider,
      stationUrl,
      accessAttemptId: decision.attemptId,
      gateId: currentGate?.gateId || 'auth.login',
    });
  }

  const oauthBusy = ['starting', 'callback_received', 'exchanging', 'credential_delivery'].includes(oauth.phase);
  const oauthVisible = Boolean(oauth.errorKey)
    || (oauth.phase !== 'idle' && oauth.phase !== 'cancelled');
  const oauthMessage = oauth.errorKey
    ? t(oauth.errorKey)
    : t(oauthPhaseMessageKey(oauth.phase));

  const headerCopy = !ready
    ? t('mobile.auth.preparing')
    : blocked
      ? (blockedMessage || t('mobile.auth.blockedSubtitle'))
      : showInviteCode
        ? (currentGate?.description || t('mobile.auth.inviteCodeSubtitle'))
        : t('mobile.auth.subtitle');

  return (
    <main className="auth-gate-screen">
      <section className="auth-gate-brand">
        <div className="launch-brand-top">
          <img src={logo} alt="Peers Touch" className="launch-logo" />
          <LanguageSwitcher />
        </div>
        <div>
          <Text className="launch-kicker">{t('mobile.launch.brand')}</Text>
          <Title level={1} className="auth-gate-title">
            {blocked
              ? t('mobile.auth.blockedTitle')
              : showInviteCode
                ? t('mobile.auth.inviteCodeTitle')
                : t('mobile.auth.title')}
          </Title>
        </div>
      </section>

      <Card className="auth-gate-card" bordered={false}>
        <div className="auth-station-summary">
          <span className="auth-station-icon">
            <Server size={18} />
          </span>
          <span className="auth-station-copy">
            <Text strong>{stationLabel}</Text>
            <Text type="secondary" ellipsis>
              {stationUrl}
            </Text>
          </span>
        </div>

        <div className="auth-gate-copy">
          {blocked ? <ShieldAlert size={18} /> : showInviteCode ? <KeyRound size={18} /> : <LockKeyhole size={18} />}
          <Text type="secondary">{headerCopy}</Text>
        </div>

        {showInviteCode ? (
          <div className="auth-fields">
            <Input
              value={inviteCode}
              placeholder={invitePlaceholder || inviteFieldLabel || t('mobile.auth.inviteCode')}
              autoCapitalize="characters"
              autoCorrect="off"
              onChange={(event) => setInviteCode(event.target.value)}
              onPressEnter={submitInvite}
            />
          </div>
        ) : null}

        {showLogin ? (
          <div className="auth-fields">
            {rememberedAccounts.length > 0 ? (
              <div className="auth-account-history" aria-label={t('mobile.auth.recentAccounts')}>
                <Text type="secondary">{t('mobile.auth.recentAccounts')}</Text>
                <div className="auth-account-list">
                  {rememberedAccounts.map((account) => (
                    <button
                      key={`${account.stationUrl}:${account.email}`}
                      type="button"
                      className={`auth-account-chip ${account.email === email ? 'active' : ''}`}
                      onClick={() => setEmail(account.email)}
                    >
                      <span>{account.displayName || account.email}</span>
                      <small>{account.email}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <Input
              value={email}
              placeholder={t('mobile.auth.email')}
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(event) => setEmail(event.target.value)}
              onPressEnter={submitLogin}
            />
            <Input.Password
              value={password}
              placeholder={t('mobile.auth.password')}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              onPressEnter={submitLogin}
            />
            <div className="auth-oauth-divider" role="separator">
              <span>{t('mobile.auth.oauthOr')}</span>
            </div>
            <div className="auth-oauth-providers" aria-label={t('mobile.auth.oauthProviders')}>
              <Button
                icon={<Code2 size={17} />}
                loading={oauthBusy && oauth.provider === 'github'}
                disabled={loading || oauthBusy}
                onClick={() => submitOAuth('github')}
              >
                {t('mobile.auth.oauthGithub')}
              </Button>
              <Button
                icon={<Globe2 size={17} />}
                loading={oauthBusy && oauth.provider === 'google'}
                disabled={loading || oauthBusy}
                onClick={() => submitOAuth('google')}
              >
                {t('mobile.auth.oauthGoogle')}
              </Button>
            </div>
          </div>
        ) : null}

        {oauthVisible ? (
          <div className={`auth-oauth-state auth-oauth-state-${oauth.phase}`} role={oauth.errorKey ? 'alert' : 'status'}>
            <Text type={oauth.errorKey ? 'danger' : 'secondary'}>{oauthMessage}</Text>
            <div className="auth-oauth-recovery">
              {oauth.recovery === 'retry-provider' ? (
                <Button size="small" onClick={() => void retryOAuthBrowser()}>
                  {t('mobile.auth.oauthRetryProvider')}
                </Button>
              ) : null}
              {oauth.recovery === 'check-status' ? (
                <Button size="small" onClick={() => void refreshOAuthStatus()}>
                  {t('mobile.auth.oauthCheckStatus')}
                </Button>
              ) : null}
              {oauth.recovery === 'restart' ? (
                <Button size="small" onClick={() => void cancelOAuth()}>
                  {t('mobile.auth.oauthRestart')}
                </Button>
              ) : null}
              {oauth.recovery === 'change-station' ? (
                <Button size="small" onClick={onBack}>
                  {t('mobile.auth.changeStation')}
                </Button>
              ) : null}
              {oauth.phase === 'awaiting_provider' ? (
                <Button size="small" onClick={() => void cancelOAuth()}>
                  {t('mobile.auth.oauthCancel')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? (
          <Text type="danger" className="auth-error">
            {error}
          </Text>
        ) : null}

        <div className="auth-actions">
          <Button icon={<ArrowLeft size={16} />} onClick={onBack}>
            {t('mobile.auth.changeStation')}
          </Button>
          {showInviteCode ? (
            <Button type="primary" loading={loading} disabled={!canSubmitInvite || loading} onClick={submitInvite}>
              {t('mobile.auth.inviteCodeSubmit')}
            </Button>
          ) : null}
          {showLogin ? (
            <Button type="primary" loading={loading} disabled={!canLogin || loading} onClick={submitLogin}>
              {t('mobile.auth.login')}
            </Button>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
