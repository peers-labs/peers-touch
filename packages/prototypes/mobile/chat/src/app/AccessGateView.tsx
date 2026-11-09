/**
 * AccessGateView — pure renderer for the Station access decision gate.
 *
 * Branch order and gating predicates mirror the native AccessGateHost
 * (apps/mobile/src/features/auth/AccessGateHost.tsx): recovery-only states
 * own the whole surface, then invite-code, schema-driven, login (with
 * Station-advertised credential choices) and finally the unsupported-gate
 * fallback. The component holds only input drafts; every decision transition
 * is a reducer action over the fixture AccessDecision.
 */
import { useEffect, useState } from 'react';
import {
  Alert, BrandMark, Button, Checkbox, Field, Icon, NumberField, PasswordField,
  Segmented, Select, TextField,
} from '@peers-touch/ui';
import { useT, type StringKey } from '../../../../shared/ui-system/prefs';
import {
  accessDecisionMessage,
  advertisedCredentialChoices,
  currentAccessGate,
  hasSchemaValue,
  isAccessBlocked,
  isAccessFailed,
  isAccessGranted,
  isAccessPending,
  isInviteCodeGate,
  isLoginGate,
  isSchemaDrivenGate,
  oauthPhaseMessageKey,
  oauthRecovery,
  parseGateFields,
  rememberEmail,
  type AccessDecision,
  type OAuthPhase,
  type OAuthProvider,
} from './accessGate';

type Dispatch = (a: import('./state').Action) => void;
type SchemaValues = Record<string, string | boolean | number>;

interface AccessGateViewProps {
  decision: AccessDecision;
  stationName: string;
  stationId: string;
  loading: boolean;
  errorKey: StringKey | null;
  oauthPhase: OAuthPhase;
  oauthErrorKey: StringKey | null;
  rememberedEmails: string[];
  sessionExpired: boolean;
  dispatch: Dispatch;
}

const OAUTH_PROVIDERS: { id: OAuthProvider; labelKey: StringKey; brand: OAuthProvider }[] = [
  { id: 'github', labelKey: 'mobile.auth.oauthGithub', brand: 'github' },
  { id: 'google', labelKey: 'mobile.auth.oauthGoogle', brand: 'google' },
];

type LoginTab = 'quick' | 'email';

export function AccessGateView({
  decision,
  stationName,
  stationId,
  loading,
  errorKey,
  oauthPhase,
  oauthErrorKey,
  rememberedEmails,
  sessionExpired,
  dispatch,
}: AccessGateViewProps) {
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [schemaValues, setSchemaValues] = useState<SchemaValues>({});
  const [loginTab, setLoginTab] = useState<LoginTab>('quick');

  const gate = currentAccessGate(decision);
  const blocked = isAccessBlocked(decision);
  const failed = isAccessFailed(decision);
  const pending = isAccessPending(decision);
  const recoveryOnly = blocked || failed || pending;

  const showInviteCode = !recoveryOnly && isInviteCodeGate(gate);
  const credentialGateActive = !recoveryOnly && !isAccessGranted(decision) && isLoginGate(gate);
  const credentialChoices = advertisedCredentialChoices(gate);
  const showEmailLogin = credentialGateActive && credentialChoices.emailPassword;
  const showOAuthLogin = credentialGateActive && credentialChoices.oauth;
  const showSchemaGate = !recoveryOnly && !isAccessGranted(decision) && isSchemaDrivenGate(gate);
  const showLogin = showEmailLogin || showOAuthLogin;
  const showUnavailableGate = !recoveryOnly && !isAccessGranted(decision)
    && !showInviteCode && !showLogin && !showSchemaGate;

  const gateFields = parseGateFields(gate);
  const activeLoginTab: LoginTab = showLogin
    ? (showOAuthLogin ? (showEmailLogin ? loginTab : 'quick') : 'email')
    : loginTab;
  const canLogin = Boolean(showEmailLogin && email.trim() && password);
  const canSubmitInvite = Boolean(showInviteCode && inviteCode.trim());
  const canSubmitSchema = showSchemaGate && gateFields.length > 0
    && gateFields.every(field => !field.required || hasSchemaValue(field, schemaValues[field.name]));

  // Remembered emails seed the draft exactly once per gate mount.
  useEffect(() => {
    if (email.trim() || rememberedEmails.length === 0) return;
    setEmail(rememberedEmails[0]);
  }, [email, rememberedEmails]);

  // Station-owned schema revisions replace the form; stale drafts must never
  // cross gate boundaries.
  useEffect(() => {
    setSchemaValues({});
  }, [gate?.gateId, gate?.schemaDigest]);

  // The fixture grants every non-empty credential pair (same canLogin rule as
  // the native host), so account history persists deterministically at submit.
  function submitLogin() {
    if (!canLogin || loading) return;
    dispatch({ type: 'access/remembered', emails: rememberEmail(stationId, email) });
    dispatch({ type: 'access/submit-login', email, password });
    setPassword('');
  }

  const oauthBusy = oauthPhase !== 'idle' && oauthPhase !== 'active_session' && oauthPhase !== 'failed';
  const oauthVisible = Boolean(oauthErrorKey) || (oauthPhase !== 'idle');
  const oauthMessage = oauthErrorKey
    ? t(oauthErrorKey)
    : t(oauthPhaseMessageKey(oauthPhase) as StringKey);
  const recovery = oauthRecovery(oauthPhase, oauthErrorKey);
  const blockedMessage = accessDecisionMessage(decision);

  const titleKey: StringKey = blocked
    ? 'mobile.auth.blockedTitle'
    : failed
      ? 'mobile.auth.failedTitle'
      : pending
        ? 'mobile.auth.pendingTitle'
        : showInviteCode
          ? 'mobile.auth.inviteCodeTitle'
          : showSchemaGate || showUnavailableGate
            ? ((gate?.title as StringKey) ?? 'mobile.auth.title')
            : sessionExpired
              ? 'mobile.auth.welcomeBackTitle'
              : 'mobile.auth.signInTitle';
  // Recovery-only and unsupported states carry their specific message in the
  // inline copy; the generic subtitle must not duplicate it.
  const suppressSubtitle = recoveryOnly || showUnavailableGate;
  const subtitleKey: StringKey | null = suppressSubtitle
    ? null
    : sessionExpired && showLogin
      ? 'mobile.auth.expiredSubtitle'
      : showLogin
        ? 'mobile.auth.subtitle'
        : ((gate?.description as StringKey) ?? 'mobile.auth.subtitle');

  const surface = pending
    ? 'recovery-pending'
    : failed || blocked
      ? 'recovery-failed'
      : showSchemaGate
        ? 'schema'
        : showUnavailableGate
          ? 'unavailable'
          : showInviteCode
            ? 'invite'
            : activeLoginTab === 'quick' && showOAuthLogin
              ? 'oauth'
              : 'login';

  return (
    <div className="ma-gate" data-access-gate data-gate-surface={surface}>
      <header className="ma-gate-brand">
        <h2 className="ma-gate-title">{t(titleKey)}</h2>
        {subtitleKey && <p className="ma-gate-subtitle">{t(subtitleKey)}</p>}
        <p className="ma-gate-station">
          <Icon iconId="server" size={15} />
          <span>{stationName}</span>
        </p>
      </header>

      {sessionExpired && showLogin && (
        <Alert className="ma-gate-session-notice" tone="warning"
          data-session-expired
          title={t('mobile.auth.sessionExpiredTitle')}
          description={rememberedEmails[0]} />
      )}

      {recoveryOnly && (
        <div className="ma-gate-recovery-copy" data-gate-recovery>
          <Icon iconId="shield-alert" size={20} />
          <span>{blockedMessage ? t(blockedMessage as StringKey) : t('mobile.auth.gateUnavailable')}</span>
        </div>
      )}

      {showInviteCode && (
        <div className="ma-gate-fields" data-gate-kind="invite">
          <Field label={t('mobile.auth.inviteCode')} required>
            <TextField aria-label={t('mobile.auth.inviteCode')}
              placeholder={t('mobile.auth.inviteCodePlaceholder')}
              autoCapitalize="characters" autoCorrect="off"
              value={inviteCode} onValueChange={setInviteCode}
              onEnter={() => canSubmitInvite && dispatch({ type: 'access/submit-invite', code: inviteCode.trim() })} />
          </Field>
          <p className="ma-gate-hint">{t('mobile.auth.inviteDemoHint', { code: 'PEERS-2026' })}</p>
        </div>
      )}

      {showSchemaGate && (
        <div className="ma-gate-fields" data-gate-kind="schema" data-schema-gate>
          {gateFields.map(field => (
            <div className="ma-gate-schema-field" key={field.name} data-schema-type={field.type}>
              {field.type === 'checkbox' || field.type === 'boolean' || field.type === 'bool' ? (
                <Checkbox checked={schemaValues[field.name] === true}
                  onCheckedChange={checked => setSchemaValues(current => ({ ...current, [field.name]: checked }))}
                  label={field.label ? t(field.label as StringKey) : field.name} />
              ) : field.type === 'select' ? (
                <Field label={field.label ? t(field.label as StringKey) : field.name} required={field.required}>
                  <Select aria-label={field.label ? t(field.label as StringKey) : field.name}
                    value={typeof schemaValues[field.name] === 'string' ? schemaValues[field.name] as string : undefined}
                    placeholder={t('mobile.auth.schemaSelectPlaceholder')}
                    options={(field.options ?? []).map(option => ({
                      value: option.value,
                      label: option.label ? t(option.label as StringKey) : option.value,
                    }))}
                    onValueChange={value => setSchemaValues(current => ({
                      ...current,
                      [field.name]: Array.isArray(value) ? value[0] : (value ?? ''),
                    }))} />
                </Field>
              ) : field.type === 'integer' || field.type === 'number' ? (
                <Field label={field.label ? t(field.label as StringKey) : field.name} required={field.required}>
                  <NumberField aria-label={field.label ? t(field.label as StringKey) : field.name}
                    precision={field.type === 'integer' ? 0 : undefined}
                    placeholder={field.placeholder}
                    value={typeof schemaValues[field.name] === 'number' ? schemaValues[field.name] as number : null}
                    onValueChange={value => value !== null && setSchemaValues(current => ({ ...current, [field.name]: value }))} />
                </Field>
              ) : (
                <Field label={field.label ? t(field.label as StringKey) : field.name} required={field.required}>
                  <TextField aria-label={field.label ? t(field.label as StringKey) : field.name}
                    inputMode={field.type === 'email' ? 'email' : 'text'}
                    placeholder={field.placeholder}
                    value={typeof schemaValues[field.name] === 'string' ? schemaValues[field.name] as string : ''}
                    onValueChange={value => setSchemaValues(current => ({ ...current, [field.name]: value }))}
                    onEnter={() => canSubmitSchema && dispatch({ type: 'access/submit-schema', values: schemaValues })} />
                </Field>
              )}
            </div>
          ))}
        </div>
      )}

      {showUnavailableGate && (
        <div className="ma-gate-recovery-copy" data-gate-kind="unavailable">
          <Icon iconId="shield-alert" size={20} />
          <span>{gate?.description ? t(gate.description as StringKey) : t('mobile.auth.gateUnavailable')}</span>
        </div>
      )}

      {showLogin && (
        <div className="ma-gate-login" data-gate-kind="login">
          {showEmailLogin && showOAuthLogin && (
            <Segmented className="ma-gate-tabs"
              label={t('mobile.auth.loginMethod')}
              value={activeLoginTab}
              options={[
                { value: 'quick', label: t('mobile.auth.tabQuickLogin') },
                { value: 'email', label: t('mobile.auth.tabEmailLogin') },
              ]}
              onValueChange={value => setLoginTab((Array.isArray(value) ? value[0] : value) as LoginTab)} />
          )}

          {showOAuthLogin && (
            <div className={`ma-gate-tab-panel ma-gate-oauth-panel${activeLoginTab === 'quick' ? ' is-active' : ''}`}
              data-oauth-panel data-login-tab={activeLoginTab}>
                {OAUTH_PROVIDERS.map(provider => (
                  <Button key={provider.id} actionId={`auth.oauth.${provider.id}`}
                    emphasis="secondary" fullWidth className="ma-gate-oauth-button"
                    leading={<BrandMark brandId={provider.brand} size={18} />}
                    availability={oauthBusy ? { kind: 'disabled', reason: t('mobile.auth.authenticating') } : undefined}
                    onActivate={() => dispatch({ type: 'access/oauth-start', provider: provider.id })}>
                    {t(provider.labelKey)}
                  </Button>
                ))}
                {oauthVisible && (
                  <div className="ma-gate-oauth-state" data-oauth-phase={oauthPhase}
                    role={oauthErrorKey ? 'alert' : 'status'}>
                    <span>{oauthMessage}</span>
                    <div className="ma-gate-oauth-recovery">
                      {recovery === 'retry-provider' && (
                        <Button actionId="auth.oauth.retry-provider" emphasis="quiet" density="compact"
                          onActivate={() => dispatch({ type: 'access/oauth-retry' })}>
                          {t('mobile.auth.oauthRetryProvider')}
                        </Button>
                      )}
                      {recovery === 'check-status' && (
                        <Button actionId="auth.oauth.check-status" emphasis="quiet" density="compact"
                          onActivate={() => dispatch({ type: 'access/oauth-check-status' })}>
                          {t('mobile.auth.oauthCheckStatus')}
                        </Button>
                      )}
                      {recovery === 'restart' && (
                        <Button actionId="auth.oauth.restart" emphasis="quiet" density="compact"
                          onActivate={() => dispatch({ type: 'access/oauth-retry' })}>
                          {t('mobile.auth.oauthRestart')}
                        </Button>
                      )}
                      {oauthPhase === 'awaiting_provider' && (
                        <Button actionId="auth.oauth.cancel" emphasis="quiet" density="compact"
                          onActivate={() => dispatch({ type: 'access/oauth-cancel' })}>
                          {t('mobile.auth.oauthCancel')}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

          {showEmailLogin && (
            <div className={`ma-gate-tab-panel ma-gate-email-panel${activeLoginTab === 'email' ? ' is-active' : ''}`}
              data-email-panel data-login-tab={activeLoginTab}>
                {rememberedEmails.length > 0 && (
                  <div className="ma-gate-accounts" aria-label={t('mobile.auth.recentAccounts')}>
                    <span className="ma-gate-accounts-label">{t('mobile.auth.recentAccounts')}</span>
                    <div className="ma-gate-account-list">
                      {rememberedEmails.map(remembered => (
                        <button key={remembered} type="button"
                          className={`ma-gate-account-chip${remembered === email ? ' is-active' : ''}`}
                          data-account-email
                          onClick={() => setEmail(remembered)}>
                          {remembered}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Field label={t('mobile.auth.emailAddress')}>
                  <TextField aria-label={t('mobile.auth.emailAddress')}
                    inputMode="email" autoCapitalize="none" autoCorrect="off"
                    leading={<Icon iconId="mail" size={16} />}
                    value={email} onValueChange={setEmail}
                    onEnter={submitLogin} />
                </Field>
                <Field label={t('mobile.auth.password')}>
                  <PasswordField aria-label={t('mobile.auth.password')}
                    autoComplete="current-password"
                    leading={<Icon iconId="lock" size={16} />}
                    value={password} onValueChange={setPassword}
                    onEnter={submitLogin} />
                </Field>
            </div>
          )}
        </div>
      )}

      {errorKey && (
        <Alert className="ma-gate-error" tone="danger" data-gate-error
          title={t(errorKey)} />
      )}

      <div className="ma-gate-actions">
        <Button actionId="auth.change-station" emphasis="quiet" fullWidth
          leading={<Icon iconId="arrow-left" size={16} />}
          availability={loading ? { kind: 'disabled', reason: t('mobile.auth.gateNotReady') } : undefined}
          onActivate={() => dispatch({ type: 'access/abandon' })}>
          {t('mobile.auth.changeStation')}
        </Button>

        {recoveryOnly && (
          <Button actionId="auth.retry" emphasis="secondary" fullWidth
            execution={loading ? 'pending' : 'idle'}
            onActivate={() => dispatch({ type: 'access/refresh' })}>
            {t('mobile.auth.retryDecision')}
          </Button>
        )}
        {showInviteCode && (
          <Button actionId="auth.invite.submit" emphasis="primary" fullWidth
            execution={loading ? 'pending' : 'idle'}
            availability={!canSubmitInvite ? { kind: 'disabled', reason: t('mobile.auth.inviteCodeRequired') } : undefined}
            onActivate={() => dispatch({ type: 'access/submit-invite', code: inviteCode.trim() })}>
            {t('mobile.auth.inviteCodeSubmit')}
          </Button>
        )}
        {showSchemaGate && (
          <Button actionId="auth.schema.submit" emphasis="primary" fullWidth
            execution={loading ? 'pending' : 'idle'}
            availability={!canSubmitSchema ? { kind: 'disabled', reason: t('mobile.auth.gateUnavailable') } : undefined}
            onActivate={() => dispatch({ type: 'access/submit-schema', values: schemaValues })}>
            {t('mobile.launch.continue')}
          </Button>
        )}
        {showEmailLogin && activeLoginTab === 'email' && (
          <Button actionId="auth.signin" emphasis="primary" fullWidth
            execution={loading ? 'pending' : 'idle'}
            availability={!canLogin ? { kind: 'disabled', reason: t('mobile.auth.loginFailed') } : undefined}
            onActivate={submitLogin}>
            {t('mobile.auth.signIn')}
          </Button>
        )}
      </div>
    </div>
  );
}
