import React, { memo, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Alert, Button, Input, Tooltip, Typography, theme } from 'antd';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Github,
  Loader2,
  Lock,
  Mail,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { UserSquareAvatar } from '../../../components/common/UserSquareAvatar';
import { BRANDING } from '../../../branding';
import {
  currentGate,
  parseGateFields,
  type AccessDecision,
} from '../../../services/accessGate';
import { LOGIN_FORM_LAYOUT } from '../constants';
import type {
  AuthState,
  SessionUser,
  LoginTab,
  OAuth2ProviderSummary,
} from '../types';

const { Text } = Typography;

// Google icon SVG inline component
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

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
  onBack: () => void;
  onEmailLogin: (email: string, password: string) => Promise<void>;
  onOAuthLogin: (provider: OAuth2ProviderSummary) => void;
  onOAuthCancel: () => void;
  onTabChange: (tab: LoginTab) => void;
  gateState?: GateState | null;
  backContent?: React.ReactNode;
  title?: string;
}

export const LoginFormView = memo(function LoginFormView({
  embedded,
  tab,
  expiredAccount,
  reauthReason,
  hasBackButton,
  oauth2Providers,
  oauthActionProviderId,
  oauthActionState,
  oauthActionError,
  onBack,
  onEmailLogin,
  onOAuthLogin,
  onOAuthCancel,
  onTabChange,
  gateState,
  backContent,
  title: titleOverride,
}: LoginFormViewProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('auth');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const oauthActionRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const oauthButtonRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const oauthCancelRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const previousOAuthProviderRef = React.useRef<string | null>(null);

  // Keep internal email in sync when expiredAccount changes
  React.useEffect(() => {
    if (expiredAccount?.email) {
      setEmail(expiredAccount.email);
    }
  }, [expiredAccount]);

  React.useEffect(() => {
    const previousProviderId = previousOAuthProviderRef.current;
    previousOAuthProviderRef.current = oauthActionProviderId ?? null;
    const frame = window.requestAnimationFrame(() => {
      if (!oauthActionProviderId) {
        if (previousProviderId) oauthButtonRefs.current[previousProviderId]?.focus();
        return;
      }
      if (['opening', 'waiting', 'error'].includes(oauthActionState)) {
        oauthCancelRefs.current[oauthActionProviderId]?.focus();
        return;
      }
      oauthActionRefs.current[oauthActionProviderId]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [oauthActionProviderId, oauthActionState]);

  const handleEmailSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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

  const handleCancelGate = useCallback(() => {
    setInviteCode('');
    gateState?.onCancel();
  }, [gateState]);

  const oauthFlowLocked = !!oauthActionProviderId
    && ['opening', 'waiting', 'initializing', 'success'].includes(oauthActionState);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 0',
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 8,
    border: 'none',
    cursor: oauthFlowLocked ? 'default' : 'pointer',
    opacity: oauthFlowLocked ? 0.62 : 1,
    transition: 'all 0.2s ease',
    background: active ? token.colorBgContainer : 'transparent',
    color: active ? token.colorText : token.colorTextSecondary,
    boxShadow: active ? token.boxShadowTertiary : 'none',
  });

  const oauthButtonStyle: React.CSSProperties = {
    width: '100%',
    height: 44,
    borderRadius: 12,
    display: 'grid',
    gridTemplateColumns: '24px minmax(0, 1fr) 24px',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
    fontSize: 14,
    fontWeight: 500,
  };

  const oauth2AccountProviders = useMemo(
    () => oauth2Providers.filter(p => p.id === 'github' || p.id === 'google'),
    [oauth2Providers],
  );

  return (
    <>
      {hasBackButton && (
        <button
          onClick={onBack}
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
          {backContent}
        </button>
      )}

      {!embedded && (
        <img
          src={BRANDING.logos.desktop}
          alt={BRANDING.appName}
          style={{
            width: LOGIN_FORM_LAYOUT.logoSize,
            height: LOGIN_FORM_LAYOUT.logoSize,
            borderRadius: LOGIN_FORM_LAYOUT.logoRadius,
            marginBottom: LOGIN_FORM_LAYOUT.logoBottom,
          }}
        />
      )}

      <h2 style={{ fontSize: 22, fontWeight: 700, color: token.colorText, margin: '0 0 4px' }}>
        {titleOverride
          ? titleOverride
          : expiredAccount
            ? t('auth.login.welcomeBackTitle', { defaultValue: 'Welcome back' })
            : t('auth.login.title')}
      </h2>
      <Text
        type="secondary"
        style={{
          fontSize: 13,
          marginBottom: expiredAccount
            ? LOGIN_FORM_LAYOUT.reauthSubtitleBottom
            : LOGIN_FORM_LAYOUT.subtitleBottom,
          textAlign: 'center',
        }}
      >
        {expiredAccount
          ? reauthReason === 'revoked'
            ? t('auth.login.expiredSubtitle', {
                defaultValue: 'Sign in again to continue where you left off.',
              })
            : t('auth.login.continueSubtitle', {
                defaultValue: 'Sign in to continue.',
              })
          : t('auth.login.subtitle')}
      </Text>

      {expiredAccount && (() => {
        const isRevoked = reauthReason === 'revoked';
        const accentColor = isRevoked ? token.colorWarningText : token.colorPrimary;
        const accentBg = isRevoked ? token.colorWarningBg : token.colorPrimaryBg;
        const borderColor = isRevoked ? token.colorWarningBorder : token.colorPrimaryBorder;
        const IconComp = isRevoked ? AlertTriangle : Lock;
        return (
          <div
            style={{
              width: '100%',
              marginBottom: LOGIN_FORM_LAYOUT.reauthAlertBottom,
              borderRadius: 10,
              border: `1px solid ${borderColor}`,
              background: accentBg,
              padding: '10px 12px',
            }}
          >
            <Flexbox horizontal gap={8} align="center">
              <IconComp size={16} style={{ color: accentColor, flexShrink: 0 }} />
              <Text strong style={{ fontSize: 13, color: accentColor, lineHeight: 1 }}>
                {isRevoked
                  ? t('auth.login.expiredAlertTitle', { defaultValue: 'Session expired' })
                  : t('auth.login.continueAlertTitle', { defaultValue: 'Sign in required' })}
              </Text>
            </Flexbox>
            <Flexbox horizontal gap={8} align="center" style={{ marginTop: 8, paddingLeft: 24 }}>
              <UserSquareAvatar
                remoteUrl={expiredAccount.avatar}
                name={expiredAccount.name}
                size={28}
                radius={6}
              />
              <Flexbox gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ fontSize: 13, lineHeight: 1.2 }}>{expiredAccount.name}</Text>
                {expiredAccount.email && (
                  <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {expiredAccount.email}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
          </div>
        );
      })()}

      <div
        style={{
          width: '100%',
          background: token.colorFillQuaternary,
          padding: 4,
          borderRadius: 10,
          display: 'flex',
          marginBottom: LOGIN_FORM_LAYOUT.tabBottom,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <button
          data-login-tab="quick"
          disabled={oauthFlowLocked}
          onClick={() => onTabChange('quick')}
          style={tabStyle(tab === 'quick')}
        >
          {t('auth.login.tab.quick')}
        </button>
        <button
          data-login-tab="email"
          disabled={oauthFlowLocked}
          onClick={() => onTabChange('email')}
          style={tabStyle(tab === 'email')}
        >
          {t('auth.login.tab.email')}
        </button>
      </div>

      <div style={{ width: '100%' }}>
        {tab === 'quick' ? (
          <Flexbox gap={10}>
            {oauth2AccountProviders.map(provider => {
              const active = oauthActionProviderId === provider.id;
              const actionState = active ? oauthActionState : 'idle';
              const anotherProviderActive = !!oauthActionProviderId && !active;
              const actionPending = ['opening', 'waiting', 'initializing', 'success'].includes(actionState);
              const cancellable = active && ['opening', 'waiting', 'error'].includes(actionState);
              const isExpiredProvider =
                expiredAccount?.provider?.toLowerCase() === provider.id.toLowerCase();
              const highlight = active || isExpiredProvider;
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
              const icon = actionState === 'opening'
                || actionState === 'waiting'
                || actionState === 'initializing'
                ? <Loader2 className="spin" size={18} />
                : actionState === 'success'
                  ? <Check size={18} />
                  : actionState === 'error'
                    ? <RotateCcw size={18} />
                    : provider.id === 'github'
                      ? <Github size={18} />
                      : <GoogleIcon />;
              return (
                <div
                  aria-live={active ? 'polite' : undefined}
                  className="login-oauth-action"
                  data-pt-login-oauth-action={provider.id}
                  key={provider.id}
                  ref={(element) => { oauthActionRefs.current[provider.id] = element; }}
                  role={active ? 'status' : undefined}
                  tabIndex={active ? -1 : undefined}
                >
                  <Button
                    aria-label={actionState === 'error' && oauthActionError
                      ? `${label}. ${oauthActionError}`
                      : label}
                    className="login-oauth-action__button"
                    data-pt-login-oauth-provider={provider.id}
                    data-pt-login-oauth-state={actionState}
                    disabled={anotherProviderActive || actionPending}
                    onClick={() => onOAuthLogin(provider)}
                    ref={(element) => { oauthButtonRefs.current[provider.id] = element; }}
                    style={{
                      ...oauthButtonStyle,
                      ...(highlight
                        ? {
                            borderColor: actionState === 'error'
                              ? token.colorError
                              : actionState === 'success'
                                ? token.colorSuccess
                                : provider.color || token.colorPrimary,
                            color: actionState === 'error'
                              ? token.colorError
                              : actionState === 'success'
                                ? token.colorSuccess
                                : provider.color || token.colorPrimary,
                          }
                        : {}),
                    }}
                    title={actionState === 'error' ? oauthActionError : undefined}
                  >
                    <span className="login-oauth-action__icon">{icon}</span>
                    <span className="login-oauth-action__label">{label}</span>
                    <span aria-hidden="true" />
                  </Button>
                  {cancellable && (
                    <Tooltip title={t('auth.login.cancelAction')}>
                      <Button
                        aria-label={t('auth.login.cancelAction')}
                        className="login-oauth-action__cancel"
                        data-pt-login-oauth-cancel={provider.id}
                        icon={<X size={15} />}
                        onClick={onOAuthCancel}
                        ref={(element) => { oauthCancelRefs.current[provider.id] = element; }}
                        size="small"
                        type="text"
                      />
                    </Tooltip>
                  )}
                </div>
              );
            })}
            {oauth2AccountProviders.length === 0 && (
              <>
                <Button
                  data-pt-login-oauth-provider="github"
                  style={{ ...oauthButtonStyle, display: 'flex', justifyContent: 'center' }}
                  icon={<Github size={18} />}
                  disabled
                >
                  {t('auth.login.continueWith', { provider: 'GitHub' })}
                </Button>
                <Button
                  data-pt-login-oauth-provider="google"
                  style={{ ...oauthButtonStyle, display: 'flex', justifyContent: 'center' }}
                  icon={<GoogleIcon />}
                  disabled
                >
                  {t('auth.login.continueWith', { provider: 'Google' })}
                </Button>
              </>
            )}
          </Flexbox>
        ) : gateState ? (
          <Flexbox gap={10}>
            <Alert
              type="info"
              showIcon
              icon={<ShieldCheck size={18} style={{ color: token.colorInfoText }} />}
              style={{ width: '100%', borderRadius: 12, padding: '10px 12px' }}
              message={
                <Text strong style={{ fontSize: 13, color: token.colorInfoText }}>
                  {currentGate(gateState.decision)?.title || t('auth.gate.inviteCode.title')}
                </Text>
              }
              description={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {currentGate(gateState.decision)?.description || t('auth.gate.inviteCode.subtitle')}
                </Text>
              }
            />
            <Flexbox horizontal gap={8} align="center">
              <Input
                size="large"
                autoFocus
                prefix={<Lock size={16} style={{ color: token.colorTextQuaternary }} />}
                placeholder={
                  parseGateFields(currentGate(gateState.decision))[0]?.placeholder
                    || parseGateFields(currentGate(gateState.decision))[0]?.label
                    || t('auth.gate.inviteCode.placeholder')
                }
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                onPressEnter={handleInviteSubmit}
                style={{ borderRadius: 12, height: 44, flex: 1 }}
              />
              <Button
                type="primary"
                loading={gateState.loading}
                disabled={!inviteCode.trim() || gateState.loading}
                onClick={handleInviteSubmit}
                style={{
                  height: 44,
                  borderRadius: 12,
                  fontWeight: 500,
                  padding: '0 16px',
                  flexShrink: 0,
                }}
                icon={!gateState.loading ? <ArrowRight size={16} /> : undefined}
                iconPosition="end"
              >
                {t('auth.gate.inviteCode.submit')}
              </Button>
            </Flexbox>
            {gateState.error && (
              <Text type="danger" style={{ fontSize: 12 }}>{gateState.error}</Text>
            )}
            <Button
              type="text"
              size="small"
              icon={<ArrowLeft size={14} />}
              onClick={handleCancelGate}
              style={{ alignSelf: 'flex-start' }}
            >
              {t('auth.gate.inviteCode.back')}
            </Button>
          </Flexbox>
        ) : (
          <form onSubmit={handleEmailSubmit}>
            <Flexbox gap={10}>
              <Input
                data-login-email
                size="large"
                prefix={<Mail size={16} style={{ color: token.colorTextQuaternary }} />}
                placeholder={t('auth.login.email.placeholder')}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ borderRadius: 12, height: 44 }}
                required
              />
              <Flexbox horizontal gap={8} align="center">
                <Input
                  data-login-password
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
                  placeholder={t('auth.login.password.placeholder')}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{ borderRadius: 12, height: 44, flex: 1 }}
                  required
                />
                <Button
                  data-login-submit
                  type="primary"
                  htmlType="submit"
                  disabled={loading}
                  style={{
                    height: 44,
                    width: 44,
                    borderRadius: 12,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  icon={loading
                    ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                    : <Check size={18} />}
                />
              </Flexbox>
            </Flexbox>
          </form>
        )}
      </div>
    </>
  );
});
