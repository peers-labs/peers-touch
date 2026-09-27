import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, Input, InputNumber, Select, Typography } from 'antd';
import {
  AlertTriangle,
  ArrowLeft,
  KeyRound,
  Lock,
  Mail,
  Server,
  ShieldAlert,
} from 'lucide-react';

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
  getRecoveryProjection,
  type DeviceLocalFlagState,
  type RecoveryProjectionSnapshot,
} from '../../runtimes/recoveryProjection';
import {
  accessDecisionMessage,
  advertisedCredentialChoices,
  currentAccessGate,
  isAccessBlocked,
  isAccessFailed,
  isAccessGranted,
  isAccessPending,
  isInviteCodeGate,
  isLoginGate,
  isSchemaDrivenGate,
  parseGateFields,
  type AccessDecision,
  type RememberedLoginAccount,
  type StationLoginInput,
} from './authSession';

const { Text, Title } = Typography;

type LoginTab = 'quick' | 'email';

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

function sessionExpiredState(
  snapshot: RecoveryProjectionSnapshot,
): DeviceLocalFlagState | null {
  return snapshot.states.find(
    (state): state is DeviceLocalFlagState => (
      state.kind === 'device-local-flag'
      && state.reason === 'session-expired'
    ),
  ) ?? null;
}

function stationHost(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    return new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate}`,
    ).host.toLowerCase();
  } catch {
    return null;
  }
}

export function authStationLabel(
  stationLabel: string,
  stationUrl: string,
  fallback: string,
): string {
  const candidate = stationLabel.trim();
  if (!candidate) return fallback;
  const candidateHost = stationHost(candidate);
  const selectedHost = stationHost(stationUrl);
  if (
    /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
    || (candidateHost && selectedHost && candidateHost === selectedHost)
  ) {
    return fallback;
  }
  return candidate;
}

function hasSchemaValue(
  field: { type: string },
  value: string | boolean | number | undefined,
): boolean {
  if (field.type === 'checkbox' || field.type === 'boolean' || field.type === 'bool') {
    return value === true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim().length > 0;
}

export function AccessGateHost({
  decision,
  stationLabel,
  stationUrl,
  error,
  loading,
  rememberedAccounts,
  onBack,
  onRefresh,
  onLogin,
  onInviteCode,
  onSchemaSubmit,
}: {
  decision: AccessDecision | null;
  stationLabel: string;
  stationUrl: string;
  error: string | null;
  loading: boolean;
  rememberedAccounts: RememberedLoginAccount[];
  onBack: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onLogin: (input: Omit<StationLoginInput, 'stationPeerId' | 'stationUrl'>) => Promise<void>;
  onInviteCode: (code: string) => Promise<void>;
  onSchemaSubmit: (values: Record<string, string | boolean | number>) => Promise<void>;
}) {
  const { t } = useMobileI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [schemaValues, setSchemaValues] = useState<Record<string, string | boolean | number>>({});
  const [loginTab, setLoginTab] = useState<LoginTab>('quick');
  const [expiredSession, setExpiredSession] = useState<DeviceLocalFlagState | null>(
    () => sessionExpiredState(getRecoveryProjection().getSnapshot()),
  );
  const oauth = useAuthRuntime();

  const ready = Boolean(decision);
  const blocked = isAccessBlocked(decision);
  const failed = isAccessFailed(decision);
  const pending = isAccessPending(decision);
  const recoveryOnly = blocked || failed || pending;
  const blockedMessage = accessDecisionMessage(decision);
  const currentGate = currentAccessGate(decision);

  const showInviteCode = ready && !recoveryOnly && isInviteCodeGate(currentGate);
  const credentialGateActive = ready
    && !recoveryOnly
    && !isAccessGranted(decision)
    && isLoginGate(currentGate);
  const credentialChoices = advertisedCredentialChoices(currentGate);
  const showEmailLogin = credentialGateActive && credentialChoices.emailPassword;
  const showOAuthLogin = credentialGateActive && credentialChoices.oauth;
  const showSchemaGate = ready
    && !recoveryOnly
    && !isAccessGranted(decision)
    && isSchemaDrivenGate(currentGate);
  const showLogin = showEmailLogin || showOAuthLogin;
  const showUnavailableGate = ready
    && !recoveryOnly
    && !isAccessGranted(decision)
    && !showInviteCode
    && !showLogin
    && !showSchemaGate;

  const gateFields = parseGateFields(currentGate);
  const inviteFieldLabel = gateFields[0]?.label;
  const invitePlaceholder = gateFields[0]?.placeholder;

  const activeLoginTab: LoginTab = showOAuthLogin
    ? (showEmailLogin ? loginTab : 'quick')
    : 'email';
  const canLogin = Boolean(showEmailLogin && email.trim() && password);
  const canSubmitInvite = Boolean(showInviteCode && inviteCode.trim());
  const canSubmitSchema = showSchemaGate && gateFields.length > 0
    && gateFields.every((field) => (
      !field.required || hasSchemaValue(field, schemaValues[field.name])
    ));
  const rememberedAccount = rememberedAccounts[0] ?? null;

  useEffect(() => {
    if (email.trim() || rememberedAccounts.length === 0) return;
    setEmail(rememberedAccounts[0].email);
  }, [email, rememberedAccounts]);

  useEffect(() => {
    const projection = getRecoveryProjection();
    return projection.subscribe((snapshot) => {
      setExpiredSession(sessionExpiredState(snapshot));
    });
  }, []);

  useEffect(() => {
    setSchemaValues({});
  }, [currentGate?.gateId, currentGate?.schemaDigest]);

  async function submitLogin() {
    if (!canLogin || loading || recoveryOnly) return;
    await onLogin({ email, password });
    setPassword('');
  }

  async function submitInvite() {
    if (!canSubmitInvite || loading || recoveryOnly) return;
    await onInviteCode(inviteCode.trim());
    setInviteCode('');
  }

  async function submitSchema() {
    if (!canSubmitSchema || loading || recoveryOnly) return;
    await onSchemaSubmit(schemaValues);
  }

  async function submitOAuth(provider: MobileOAuthProvider) {
    if (!showOAuthLogin || loading || !decision?.attemptId) return;
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
  const pageTitle = blocked
    ? t('mobile.auth.blockedTitle')
    : failed
      ? t('mobile.auth.failedTitle')
      : pending
        ? t('mobile.auth.pendingTitle')
    : showInviteCode
      ? t('mobile.auth.inviteCodeTitle')
      : showSchemaGate || showUnavailableGate
        ? currentGate?.title || t('mobile.auth.title')
        : expiredSession
          ? t('mobile.auth.welcomeBackTitle')
          : t('mobile.auth.signInTitle');
  const pageSubtitle = expiredSession && showLogin
    ? t('mobile.auth.expiredSubtitle')
    : currentGate?.description || t('mobile.auth.subtitle');
  const hasPrimaryAction = showInviteCode
    || (showEmailLogin && activeLoginTab === 'email');
  const visibleStationLabel = authStationLabel(
    stationLabel,
    stationUrl,
    t('common.stationPicker.fallbackLabel'),
  );


  return (
    <main
      className="auth-gate-screen"
      data-session-expired={expiredSession ? 'true' : 'false'}
    >
      <div className="auth-gate-toolbar">
        <LanguageSwitcher />
      </div>
      <Card className="auth-gate-card" variant="borderless">
        <section className="auth-gate-brand">
          <img src={logo} alt="Peers" className="auth-gate-logo" />
          <Title level={1} className="auth-gate-title">
            {pageTitle}
          </Title>
          <Text type="secondary" className="auth-gate-subtitle">
            {pageSubtitle}
          </Text>
        </section>

        {expiredSession && showLogin ? (
          <div
            className="auth-session-notice"
            data-acceptance-id="auth-session-expired"
            role="status"
          >
            <AlertTriangle size={16} aria-hidden="true" />
            <span className="auth-session-notice-copy">
              <Text strong>{t('mobile.auth.sessionExpiredTitle')}</Text>
              <Text type="secondary">
                {rememberedAccount?.displayName || rememberedAccount?.email || t('mobile.auth.signInTitle')}
              </Text>
            </span>
          </div>
        ) : null}

        <div className="auth-station-summary">
          <span className="auth-station-icon">
            <Server size={18} />
          </span>
          <span className="auth-station-copy">
            <Text strong>{visibleStationLabel}</Text>
            <Text type="secondary">{t('mobile.settings.connected')}</Text>
          </span>
        </div>

        {recoveryOnly ? (
          <div className="auth-gate-copy">
            <ShieldAlert size={18} />
            <Text type="secondary">
              {blockedMessage || t(
                blocked
                  ? 'mobile.auth.blockedSubtitle'
                  : failed
                    ? 'mobile.auth.failedSubtitle'
                    : 'mobile.auth.pendingSubtitle',
              )}
            </Text>
          </div>
        ) : null}

        {showInviteCode ? (
          <>
            <div className="auth-gate-copy">
              <KeyRound size={18} />
              <Text type="secondary">{currentGate?.description || t('mobile.auth.inviteCodeSubtitle')}</Text>
            </div>
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
          </>
        ) : null}

        {showSchemaGate ? (
          <div className="auth-fields" data-acceptance-id="schema-access-gate">
            {gateFields.map((field) => (
              <div className="auth-schema-field" key={field.name}>
                {field.type === 'checkbox' || field.type === 'boolean' || field.type === 'bool' ? (
                  <Checkbox
                    checked={schemaValues[field.name] === true}
                    onChange={(event) => setSchemaValues((current) => ({
                      ...current,
                      [field.name]: event.target.checked,
                    }))}
                  >
                    {field.label || field.name}
                  </Checkbox>
                ) : field.type === 'select' ? (
                  <>
                    <Text>{field.label || field.name}</Text>
                    <Select
                      aria-label={field.label || field.name}
                      value={typeof schemaValues[field.name] === 'string'
                        ? schemaValues[field.name] as string
                        : undefined}
                      options={(field.options ?? []).map((option) => ({
                        label: option.label || option.value,
                        value: option.value,
                      }))}
                      onChange={(value) => setSchemaValues((current) => ({
                        ...current,
                        [field.name]: value,
                      }))}
                    />
                  </>
                ) : field.type === 'integer' || field.type === 'number' ? (
                  <>
                    <Text>{field.label || field.name}</Text>
                    <InputNumber
                      aria-label={field.label || field.name}
                      value={typeof schemaValues[field.name] === 'number'
                        ? schemaValues[field.name] as number
                        : null}
                      precision={field.type === 'integer' ? 0 : undefined}
                      placeholder={field.placeholder}
                      onChange={(value) => setSchemaValues((current) => ({
                        ...current,
                        ...(typeof value === 'number' ? { [field.name]: value } : {}),
                      }))}
                    />
                  </>
                ) : (
                  <>
                    <Text>{field.label || field.name}</Text>
                    <Input
                      aria-label={field.label || field.name}
                      value={typeof schemaValues[field.name] === 'string'
                        ? schemaValues[field.name] as string
                        : ''}
                      inputMode={field.type === 'email' ? 'email' : 'text'}
                      placeholder={field.placeholder}
                      onChange={(event) => setSchemaValues((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))}
                      onPressEnter={submitSchema}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        ) : null}

        {showUnavailableGate ? (
          <div className="auth-gate-copy">
            <ShieldAlert size={18} />
            <Text type="secondary">
              {currentGate?.description || t('mobile.launch.unavailable')}
            </Text>
          </div>
        ) : null}

        {showLogin ? (
          <>
            {showEmailLogin && showOAuthLogin ? (
              <div className="auth-tab-row">
                <button
                  type="button"
                  className={`auth-tab ${activeLoginTab === 'quick' ? 'active' : ''}`}
                  onClick={() => setLoginTab('quick')}
                >{t('mobile.auth.tabQuickLogin')}</button>
                <button
                  type="button"
                  className={`auth-tab ${activeLoginTab === 'email' ? 'active' : ''}`}
                  onClick={() => setLoginTab('email')}
                >{t('mobile.auth.tabEmailLogin')}</button>
              </div>
            ) : null}

            <div className="auth-tab-content">
              {showOAuthLogin ? (
                <div className={`auth-tab-panel auth-oauth-panel ${activeLoginTab === 'quick' ? 'active' : ''}`}>
                  <Button
                    block
                    size="large"
                    className="auth-oauth-btn auth-oauth-github"
                    icon={<GitHubIcon />}
                    loading={oauthBusy && oauth.provider === 'github'}
                    disabled={loading || oauthBusy}
                    onClick={() => submitOAuth('github')}
                  >
                    {t('mobile.auth.oauthGithub')}
                  </Button>
                  <Button
                    block
                    size="large"
                    className="auth-oauth-btn auth-oauth-google"
                    icon={<GoogleIcon />}
                    loading={oauthBusy && oauth.provider === 'google'}
                    disabled={loading || oauthBusy}
                    onClick={() => submitOAuth('google')}
                  >
                    {t('mobile.auth.oauthGoogle')}
                  </Button>
                </div>
              ) : null}

              {showEmailLogin ? (
                <div className={`auth-tab-panel auth-email-panel ${activeLoginTab === 'email' ? 'active' : ''}`}>
                  {!expiredSession && rememberedAccounts.length > 0 ? (
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
                    placeholder={t('mobile.auth.emailAddress')}
                    size="large"
                    prefix={<Mail size={16} aria-hidden="true" />}
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    onChange={(event) => setEmail(event.target.value)}
                    onPressEnter={submitLogin}
                  />
                  <Input.Password
                    value={password}
                    placeholder={t('mobile.auth.password')}
                    size="large"
                    prefix={<Lock size={16} aria-hidden="true" />}
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    onPressEnter={submitLogin}
                  />
                </div>
              ) : null}
            </div>
          </>
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
                <Button size="small" onClick={() => void onBack()}>
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

        {recoveryOnly ? (
          <div className="auth-gate-recovery">
            <Button loading={loading} disabled={loading} onClick={() => void onRefresh()}>
              {t('mobile.auth.retryDecision')}
            </Button>
            <Button danger disabled={loading} onClick={() => void onBack()}>
              {t('mobile.auth.changeStation')}
            </Button>
          </div>
        ) : null}

        {error ? (
          <Text type="danger" className="auth-error">
            {t(error) !== error ? t(error) : error}
          </Text>
        ) : null}
        {!recoveryOnly ? (
          <div className={`auth-actions ${hasPrimaryAction ? '' : 'single'}`}>
            <Button icon={<ArrowLeft size={16} />} disabled={loading} onClick={() => void onBack()}>
              {t('mobile.auth.changeStation')}
            </Button>
            {showInviteCode ? (
              <Button type="primary" loading={loading} disabled={!canSubmitInvite || loading} onClick={submitInvite}>
                {t('mobile.auth.inviteCodeSubmit')}
              </Button>
            ) : null}
            {showEmailLogin && activeLoginTab === 'email' ? (
              <Button type="primary" loading={loading} disabled={!canLogin || loading} onClick={submitLogin}>
                {t('mobile.auth.signIn')}
              </Button>
            ) : null}
            {showSchemaGate ? (
              <Button
                type="primary"
                loading={loading}
                disabled={!canSubmitSchema || loading}
                onClick={submitSchema}
              >
                {t('common.continue')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
    </main>
  );
}
