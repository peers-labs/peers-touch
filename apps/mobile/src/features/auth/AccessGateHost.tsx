import { useEffect, useState } from 'react';
import { Button, Card, Input, Typography } from 'antd';
import { ArrowLeft, KeyRound, LockKeyhole, Server, ShieldAlert } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import {
  accessDecisionMessage,
  isAccessBlocked,
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
  onLogin: (input: Omit<StationLoginInput, 'stationUrl'>) => Promise<void>;
  onInviteCode: (code: string) => Promise<void>;
}) {
  const { t } = useMobileI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const ready = Boolean(decision);
  const blocked = isAccessBlocked(decision);
  const blockedMessage = accessDecisionMessage(decision);
  const currentGate = decision?.gates.find((gate) => gate.gateId === decision.currentGateId);

  // The Station drives which gate renders. Invite-code is schema-driven; the
  // login gate keeps its purpose-built credential form. When no gate is named
  // we default to the login form so the legacy flow is unaffected.
  const showInviteCode = ready && !blocked && isInviteCodeGate(currentGate);
  const showLogin = ready && !blocked && (isLoginGate(currentGate) || !currentGate);

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
