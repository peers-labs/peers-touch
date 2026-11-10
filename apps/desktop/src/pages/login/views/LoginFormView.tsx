import React, { memo, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  BrandMark,
  Button,
  Icon,
  IconButton,
  Segmented,
  TextField,
} from '@peers-touch/ui';
import { UserSquareAvatar } from '../../../components/common/UserSquareAvatar';
import {
  currentGate,
  parseGateFields,
  type AccessDecision,
} from '../../../services/accessGate';
import type {
  AuthState,
  SessionUser,
  LoginTab,
  OAuth2ProviderSummary,
} from '../types';

export interface GateState {
  decision: AccessDecision;
  inviteCode: string;
  error: string;
  loading: boolean;
  onSubmitCode: (code: string) => Promise<void>;
  onCancel: () => void;
}

export interface LoginFormViewProps {
  embedded?: boolean;
  tab: LoginTab;
  expiredAccount?: SessionUser | null;
  reauthReason: 'revoked' | 'continue';
  hasBackButton: boolean;
  oauth2Providers: OAuth2ProviderSummary[];
  oauthActionProviderId?: string | null;
  oauthActionState: AuthState;
  oauthActionError?: string;
  emailError?: string;
  onBack: () => void;
  onEmailLogin: (email: string, password: string) => Promise<void>;
  onOAuthLogin: (provider: OAuth2ProviderSummary) => void;
  onOAuthCancel: () => void;
  onTabChange: (tab: LoginTab) => void;
  gateState?: GateState | null;
  backContent?: React.ReactNode;
  title?: string;
  /**
   * The back control is promoted into the card header (symmetric with the
   * language switcher); the form body then renders no inline back row.
   */
  backInHeader?: boolean;
  /**
   * Activates the re-authentication identity tile. Routes the user to the
   * sign-in method that matches the expired account's provider. When omitted
   * the identity tile is not rendered interactive.
   */
  onReauthIdentity?: () => void;
  /** Focus the password field once the email tab is shown via the identity tile. */
  reauthFocusPassword?: boolean;
}

export const LoginFormView = memo(function LoginFormView({
  tab,
  expiredAccount,
  reauthReason,
  hasBackButton,
  oauth2Providers,
  oauthActionProviderId,
  oauthActionState,
  oauthActionError,
  emailError,
  onBack,
  onEmailLogin,
  onOAuthLogin,
  onOAuthCancel,
  onTabChange,
  gateState,
  backContent,
  title: titleOverride,
  backInHeader = false,
  onReauthIdentity,
  reauthFocusPassword = false,
}: LoginFormViewProps) {
  const { t } = useTranslation('auth');

  // An expired/revoked saved session gets an explicit re-login notice so the
  // routed sign-in form carries context instead of appearing as a silent
  // dead-end. A plain "continue" re-auth shows no notice.
  const showReauthNotice = !!expiredAccount && reauthReason === 'revoked' && !gateState;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const oauthActionRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const oauthCancelRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const previousOAuthProviderRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (expiredAccount?.email) setEmail(expiredAccount.email);
  }, [expiredAccount]);

  React.useEffect(() => {
    const previousProviderId = previousOAuthProviderRef.current;
    previousOAuthProviderRef.current = oauthActionProviderId ?? null;
    const frame = window.requestAnimationFrame(() => {
      if (!oauthActionProviderId) {
        if (previousProviderId) {
          oauthActionRefs.current[previousProviderId]
            ?.querySelector<HTMLElement>('[data-pt-login-oauth-provider]')
            ?.focus();
        }
        return;
      }
      if (['opening', 'waiting'].includes(oauthActionState)) {
        oauthCancelRefs.current[oauthActionProviderId]?.focus();
        return;
      }
      if (oauthActionState === 'error') {
        oauthActionRefs.current[oauthActionProviderId]
          ?.querySelector<HTMLElement>('[data-pt-login-oauth-provider]')
          ?.focus();
        return;
      }
      oauthActionRefs.current[oauthActionProviderId]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [oauthActionProviderId, oauthActionState]);

  const handleEmailSubmit = useCallback(async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    try {
      await onEmailLogin(email.trim(), password);
    } finally {
      setLoading(false);
    }
  }, [email, password, onEmailLogin]);

  const handleInviteSubmit = useCallback(async () => {
    if (!gateState || !inviteCode.trim()) return;
    await gateState.onSubmitCode(inviteCode.trim());
  }, [gateState, inviteCode]);

  const oauthFlowLocked = !!oauthActionProviderId
    && ['opening', 'waiting', 'initializing', 'success'].includes(oauthActionState);

  const oauth2AccountProviders = useMemo(
    () => oauth2Providers.filter((provider) => provider.id === 'github' || provider.id === 'google'),
    [oauth2Providers],
  );

  const providerIcon = (provider: OAuth2ProviderSummary, state: AuthState) => {
    if (state === 'opening' || state === 'waiting' || state === 'initializing') {
      return <Icon iconId="refresh-cw" size={18} className="spin" />;
    }
    if (state === 'success') return <Icon iconId="check" size={18} />;
    if (state === 'error') return <Icon iconId="refresh-ccw" size={18} />;
    return <BrandMark brandId={provider.id === 'google' ? 'google' : 'github'} size={18} />;
  };

  return (
    <div className="pt-auth-form">
      {hasBackButton && !backInHeader && (
        <div className="pt-auth-back">
          <Button
            actionId="auth.back"
            emphasis="quiet"
            density="compact"
            onActivate={onBack}
          >
            {backContent}
          </Button>
        </div>
      )}

      <h2 className="pt-auth-title">
        {titleOverride
          ? titleOverride
          : expiredAccount
            ? t('auth.login.welcomeBackTitle', { defaultValue: 'Welcome back' })
            : t('auth.login.title')}
      </h2>
      {expiredAccount && (
        <Button
          actionId="auth.reauth.identity"
          fullWidth
          emphasis="secondary"
          className="pt-auth-reauth"
          data-login-reauth-account={expiredAccount.accountId}
          aria-label={t('auth.login.reauthIdentity', { name: expiredAccount.name })}
          availability={
            oauthFlowLocked
              ? { kind: 'disabled', reason: t('auth.login.waiting') }
              : undefined
          }
          leading={
            <UserSquareAvatar
              remoteUrl={expiredAccount.avatar}
              avatarLocalPath={expiredAccount.avatarLocalPath}
              name={expiredAccount.name}
              size={30}
              radius={7}
            />
          }
          trailing={<Icon iconId="chevron-right" size={15} />}
          onActivate={() => onReauthIdentity?.()}
        >
          <span className="pt-auth-reauth-meta">
            <span className="pt-auth-reauth-name">{expiredAccount.name}</span>
            {expiredAccount.email && (
              <span className="pt-auth-reauth-handle">{expiredAccount.email}</span>
            )}
          </span>
        </Button>
      )}

      {showReauthNotice && (
        <Alert
          tone="warning"
          data-login-reauth-notice
          title={t('auth.login.expiredAlertTitle')}
          description={t('auth.login.expiredSubtitle')}
        />
      )}

      <Segmented<LoginTab>
        className="pt-auth-segmented"
        value={tab}
        disabled={oauthFlowLocked}
        onValueChange={onTabChange}
        options={[
          { value: 'quick', label: t('auth.login.tab.quick') },
          { value: 'email', label: t('auth.login.tab.email') },
        ]}
      />

      {tab === 'quick' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {oauth2AccountProviders.map((provider) => {
            const active = oauthActionProviderId === provider.id;
            const actionState = active ? oauthActionState : 'idle';
            const anotherProviderActive = !!oauthActionProviderId && !active;
            const actionPending = ['opening', 'waiting', 'initializing', 'success'].includes(actionState);
            const cancellable = active && ['opening', 'waiting', 'error'].includes(actionState);
            const label = actionState === 'opening'
              ? t('auth.login.openingBrowser', { provider: provider.name })
              : actionState === 'waiting'
                ? t('auth.login.waiting')
                : actionState === 'initializing'
                  ? t('auth.login.initializing')
                  : actionState === 'success'
                    ? t('auth.login.success')
                    : actionState === 'error'
                      ? t('auth.login.retryWith', { provider: provider.name })
                      : t('auth.login.continueWith', { provider: provider.name });
            return (
              <div
                aria-live={active ? 'polite' : undefined}
                className="pt-auth-oauth"
                data-pt-login-oauth-action={provider.id}
                key={provider.id}
                ref={(element) => { oauthActionRefs.current[provider.id] = element; }}
                role={active ? 'status' : undefined}
                tabIndex={active ? -1 : undefined}
              >
                <Button
                  actionId={`auth.oauth.${provider.id}`}
                  fullWidth
                  emphasis="secondary"
                  tone={actionState === 'error' ? 'danger' : 'neutral'}
                  className="login-oauth-action__button"
                  data-pt-login-oauth-provider={provider.id}
                  data-pt-login-oauth-state={actionState}
                  availability={
                    anotherProviderActive || actionPending
                      ? { kind: 'disabled', reason: t('auth.login.waiting') }
                      : undefined
                  }
                  aria-label={
                    actionState === 'error' && oauthActionError
                      ? `${label}. ${oauthActionError}`
                      : label
                  }
                  title={actionState === 'error' ? oauthActionError : undefined}
                  leading={providerIcon(provider, actionState)}
                  onActivate={() => onOAuthLogin(provider)}
                >
                  {label}
                </Button>
                {cancellable && (
                  <span className="pt-auth-oauth__cancel">
                    <IconButton
                      actionId={`auth.oauth.cancel.${provider.id}`}
                      iconId="close"
                      label={t('auth.login.cancelAction')}
                      density="compact"
                      emphasis="quiet"
                      data-pt-login-oauth-cancel={provider.id}
                      ref={(element) => { oauthCancelRefs.current[provider.id] = element; }}
                      onActivate={onOAuthCancel}
                    />
                  </span>
                )}
              </div>
            );
          })}
          {oauth2AccountProviders.length === 0 && (
            <>
              <Button
                actionId="auth.oauth.github.placeholder"
                fullWidth
                emphasis="secondary"
                data-pt-login-oauth-provider="github"
                availability={{ kind: 'disabled', reason: t('auth.login.providersUnavailable') }}
                leading={<BrandMark brandId="github" size={18} />}
              >
                {t('auth.login.continueWith', { provider: 'GitHub' })}
              </Button>
              <Button
                actionId="auth.oauth.google.placeholder"
                fullWidth
                emphasis="secondary"
                data-pt-login-oauth-provider="google"
                availability={{ kind: 'disabled', reason: t('auth.login.providersUnavailable') }}
                leading={<BrandMark brandId="google" size={18} />}
              >
                {t('auth.login.continueWith', { provider: 'Google' })}
              </Button>
            </>
          )}
        </div>
      ) : gateState ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Alert
            tone="info"
            title={
              currentGate(gateState.decision)?.title
              || t('auth.gate.inviteCode.title')
            }
            description={
              currentGate(gateState.decision)?.description
              || t('auth.gate.inviteCode.subtitle')
            }
          />
          <div className="pt-auth-gate-row">
            <TextField
              autoFocus
              aria-label={t('auth.gate.inviteCode.placeholder')}
              placeholder={
                parseGateFields(currentGate(gateState.decision))[0]?.placeholder
                  || parseGateFields(currentGate(gateState.decision))[0]?.label
                  || t('auth.gate.inviteCode.placeholder')
              }
              value={inviteCode}
              leading={<Icon iconId="lock" size={16} />}
              onValueChange={setInviteCode}
              onEnter={handleInviteSubmit}
            />
            <Button
              actionId="auth.gate.submit"
              emphasis="primary"
              trailing={<Icon iconId="arrow-right" size={16} />}
              availability={
                !inviteCode.trim() || gateState.loading
                  ? {
                      kind: 'disabled',
                      reason: gateState.loading
                        ? t('auth.login.waiting')
                        : t('auth.gate.inviteCode.placeholder'),
                    }
                  : undefined
              }
              execution={gateState.loading ? 'pending' : 'idle'}
              onActivate={() => void handleInviteSubmit()}
            >
              {t('auth.gate.inviteCode.submit')}
            </Button>
          </div>
          {gateState.error && <p className="pt-auth-inline-error">{gateState.error}</p>}
          <Button
            actionId="auth.gate.back"
            emphasis="quiet"
            density="compact"
            leading={<Icon iconId="arrow-left" size={14} />}
            onActivate={gateState.onCancel}
          >
            {t('auth.gate.inviteCode.back')}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleEmailSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {emailError && (
              <Alert tone="danger" data-login-error title={emailError} />
            )}
            <TextField
              data-login-email
              type="email"
              required
              aria-label={t('auth.login.email.placeholder')}
              placeholder={t('auth.login.email.placeholder')}
              value={email}
              leading={<Icon iconId="mail" size={16} />}
              onValueChange={setEmail}
            />
            <TextField
              data-login-password
              required
              autoFocus={reauthFocusPassword}
              type={showPassword ? 'text' : 'password'}
              aria-label={t('auth.login.password.placeholder')}
              placeholder={t('auth.login.password.placeholder')}
              value={password}
              leading={<Icon iconId="lock" size={16} />}
              trailing={
                <IconButton
                  actionId="auth.password.reveal"
                  iconId={showPassword ? 'eye-off' : 'eye'}
                  label={showPassword
                    ? t('auth.login.password.hide', { defaultValue: 'Hide password' })
                    : t('auth.login.password.show', { defaultValue: 'Show password' })}
                  emphasis="quiet"
                  density="compact"
                  onActivate={() => setShowPassword((value) => !value)}
                />
              }
              onValueChange={setPassword}
              onEnter={() => void handleEmailSubmit()}
            />
            <Button
              actionId="auth.login.submit"
              fullWidth
              emphasis="primary"
              className="pt-auth-submit"
              data-login-submit
              execution={loading ? 'pending' : 'idle'}
              availability={loading ? { kind: 'disabled', reason: t('auth.login.waiting') } : undefined}
              onActivate={() => void handleEmailSubmit()}
            >
              {t('auth.login.submit', { defaultValue: 'Sign in' })}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
});
