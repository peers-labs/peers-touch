import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  Select,
  Spin,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import { Flexbox } from 'react-layout-kit';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Github,
  KeyRound,
  LockKeyhole,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react';
import { AuthUtilityBarPrototype } from './AuthUtilityBarPrototype';
import { ANTD_PRIMARY_BUTTON_STYLE, T } from './theme';

type OAuthPhase = 'idle' | 'opening' | 'waiting' | 'initializing' | 'success' | 'error';
type LoginTab = 'quick' | 'email';
export type AccessGatePrototypeKind =
  | 'none'
  | 'invite'
  | 'terms'
  | 'custom'
  | 'blocked'
  | 'maintenance'
  | 'unknown';

export interface OAuthProviderProjection {
  id: string;
  name: string;
  color: string;
  icon: string;
  enabled: boolean;
}

const { Text } = Typography;
const CARD_WIDTH = 400;
const CARD_HEIGHT = 456;
const ACTION_HEIGHT = 44;

function GoogleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function providerIcon(provider: OAuthProviderProjection) {
  if (provider.icon === 'github' || provider.id === 'github') return <Github size={18} />;
  if (provider.icon === 'google' || provider.id === 'google') return <GoogleIcon />;
  return <KeyRound size={18} />;
}

function queryState(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('state') ?? '';
}

function initialPhase(): OAuthPhase {
  const phase = queryState().replace('auth-oauth-', '');
  return ['opening', 'waiting', 'initializing', 'success', 'error'].includes(phase)
    ? phase as OAuthPhase
    : 'idle';
}

function initialGateKind(): AccessGatePrototypeKind {
  const gate = queryState().replace('auth-gate-', '');
  return ['invite', 'terms', 'custom', 'blocked', 'maintenance', 'unknown'].includes(gate)
    ? gate as AccessGatePrototypeKind
    : 'none';
}

function initialLoginTab(): LoginTab {
  return queryState() === 'auth-login-email' ? 'email' : 'quick';
}

function nextGateAfterLogin(): AccessGatePrototypeKind {
  if (typeof window === 'undefined') return 'none';
  const gate = new URLSearchParams(window.location.search).get('gateAfter') ?? '';
  return ['invite', 'terms', 'custom', 'blocked', 'maintenance', 'unknown'].includes(gate)
    ? gate as AccessGatePrototypeKind
    : 'none';
}

function gatePresentation(kind: AccessGatePrototypeKind) {
  return {
    invite: {
      icon: ShieldCheck,
      title: 'Invite required',
      description: 'This Station is invite-only. Enter your invite code to continue.',
    },
    terms: {
      icon: ShieldCheck,
      title: 'Review Station terms',
      description: 'The Station requires an explicit acknowledgement before access is granted.',
    },
    custom: {
      icon: ShieldCheck,
      title: 'Complete access details',
      description: 'This form is authored by the Station access policy.',
    },
    blocked: {
      icon: ShieldAlert,
      title: 'Access blocked',
      description: 'This Station is not accepting access for this account.',
    },
    maintenance: {
      icon: Wrench,
      title: 'Station unavailable',
      description: 'This Station is temporarily unavailable for maintenance.',
    },
    unknown: {
      icon: AlertTriangle,
      title: 'Unsupported access step',
      description: 'Peers cannot safely render the access step requested by this Station.',
    },
    none: {
      icon: LockKeyhole,
      title: 'Welcome',
      description: 'Sign in to your account to continue',
    },
  }[kind];
}

export function OAuthLoginPrototype({
  onComplete,
  providers,
}: {
  onComplete: () => void;
  providers: readonly OAuthProviderProjection[];
}) {
  const { token } = theme.useToken();
  const availableProviders = useMemo(
    () => providers.filter(provider => provider.enabled),
    [providers],
  );
  const initial = useMemo(initialPhase, []);
  const initialGate = useMemo(initialGateKind, []);
  const [providerId, setProviderId] = useState<string | null>(
    initial === 'idle' ? null : availableProviders[0]?.id ?? null,
  );
  const [phase, setPhase] = useState<OAuthPhase>(initial);
  const [tab, setTab] = useState<LoginTab>(initialLoginTab);
  const [gateKind, setGateKind] = useState<AccessGatePrototypeKind>(initialGate);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [customRole, setCustomRole] = useState<string>();
  const [customReason, setCustomReason] = useState('');
  const [gateSubmitting, setGateSubmitting] = useState(false);
  const [narrow, setNarrow] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches
  ));
  const timersRef = useRef<number[]>([]);
  const actionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const buttonRefs = useRef<Record<string, HTMLElement | null>>({});
  const cancelRefs = useRef<Record<string, HTMLElement | null>>({});
  const previousProviderRef = useRef<string | null>(null);

  const clearTimers = () => {
    timersRef.current.forEach(timer => window.clearTimeout(timer));
    timersRef.current = [];
  };

  useEffect(() => clearTimers, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const previousProviderId = previousProviderRef.current;
    previousProviderRef.current = providerId;
    const frame = window.requestAnimationFrame(() => {
      if (!providerId) {
        if (previousProviderId) buttonRefs.current[previousProviderId]?.focus();
        return;
      }
      if (['opening', 'waiting'].includes(phase)) {
        cancelRefs.current[providerId]?.focus();
        return;
      }
      if (phase === 'error') {
        buttonRefs.current[providerId]?.focus();
        return;
      }
      actionRefs.current[providerId]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase, providerId]);

  const start = (provider: OAuthProviderProjection) => {
    clearTimers();
    setProviderId(provider.id);
    setPhase('opening');
    timersRef.current = [
      window.setTimeout(() => setPhase('waiting'), 500),
      window.setTimeout(() => setPhase('initializing'), 1_700),
      window.setTimeout(() => setPhase('success'), 2_600),
      window.setTimeout(onComplete, 3_250),
    ];
  };

  const cancel = () => {
    clearTimers();
    setProviderId(null);
    setPhase('idle');
  };

  const completeEmailLogin = () => {
    if (!email.trim() || !password) return;
    setEmailLoading(true);
    const gate = nextGateAfterLogin();
    timersRef.current.push(window.setTimeout(() => {
      setEmailLoading(false);
      if (gate !== 'none') {
        setGateKind(gate);
      } else {
        onComplete();
      }
    }, 650));
  };

  const completeGate = () => {
    setGateSubmitting(true);
    timersRef.current.push(window.setTimeout(onComplete, 650));
  };

  const resetGate = () => {
    setGateKind('none');
    setGateSubmitting(false);
    setInviteCode('');
    setTermsAccepted(false);
    setCustomRole(undefined);
    setCustomReason('');
  };

  const presentation = gatePresentation(gateKind);
  const GateIcon = presentation.icon;
  const gateBlocked = ['blocked', 'maintenance', 'unknown'].includes(gateKind);
  const gateReady = gateKind === 'invite'
    ? inviteCode.trim().length > 0
    : gateKind === 'terms'
      ? termsAccepted
      : gateKind === 'custom'
        ? Boolean(customRole && customReason.trim())
        : false;
  const emailReady = Boolean(email.trim() && password);

  const renderGate = () => {
    const alertType = gateKind === 'unknown'
      ? 'error'
      : gateBlocked
        ? 'warning'
        : 'info';
    return (
      <Flexbox
        aria-live="polite"
        data-pt-prototype-access-gate={gateKind}
        gap={12}
        style={{ minHeight: 176, width: '100%' }}
      >
        <Alert
          description={presentation.description}
          message={presentation.title}
          showIcon
          type={alertType}
        />
        {gateKind === 'invite' ? (
          <Input
            aria-label="Invite code"
            onChange={event => setInviteCode(event.target.value)}
            placeholder="Invite code"
            size="large"
            value={inviteCode}
          />
        ) : null}
        {gateKind === 'terms' ? (
          <Checkbox
            checked={termsAccepted}
            onChange={event => setTermsAccepted(event.target.checked)}
          >
            I accept the Station terms
          </Checkbox>
        ) : null}
        {gateKind === 'custom' ? (
          <>
            <Select
              aria-label="Access role"
              onChange={setCustomRole}
              options={[
                { label: 'Member', value: 'member' },
                { label: 'Guest', value: 'guest' },
              ]}
              placeholder="Choose access role"
              size="large"
              value={customRole}
            />
            <Input
              aria-label="Reason for joining"
              onChange={event => setCustomReason(event.target.value)}
              placeholder="Reason for joining"
              size="large"
              value={customReason}
            />
          </>
        ) : null}
        {!gateBlocked ? (
          <Button
            data-pt-prototype-access-gate-submit
            disabled={!gateReady}
            icon={<ArrowRight size={16} />}
            iconPosition="end"
            loading={gateSubmitting}
            onClick={completeGate}
            size="large"
            style={gateReady ? ANTD_PRIMARY_BUTTON_STYLE : undefined}
            type="primary"
          >
            Continue
          </Button>
        ) : null}
        <Button
          data-pt-prototype-access-gate-back
          icon={<ArrowLeft size={14} />}
          onClick={resetGate}
          size="small"
          style={{ alignSelf: 'flex-start' }}
          type="text"
        >
          Back
        </Button>
      </Flexbox>
    );
  };

  return (
    <main
      data-pt-prototype-auth
      style={{
        alignItems: 'center',
        background: token.colorBgLayout,
        display: 'flex',
        height: '100%',
        justifyContent: narrow ? 'center' : 'flex-end',
        minHeight: 0,
        overflow: 'hidden',
        padding: 'clamp(28px, 6vw, 96px)',
        position: 'relative',
        width: '100%',
      }}
    >
      <Flexbox
        align="center"
        data-pt-prototype-login-card
        gap={0}
        justify="center"
        style={{
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 24,
          boxShadow: token.boxShadow,
          boxSizing: 'border-box',
          flex: `0 0 ${CARD_WIDTH}px`,
          height: CARD_HEIGHT,
          maxHeight: 'calc(100vh - 96px)',
          maxWidth: '100%',
          overflowY: 'auto',
          padding: '32px',
          position: 'relative',
          width: CARD_WIDTH,
          zIndex: 1,
        }}
      >
        <Flexbox
          align="center"
          justify="center"
          style={{
            background: T.primaryWash,
            border: `1px solid ${T.primaryDisabled}`,
            borderRadius: 18,
            color: T.primary,
            height: 64,
            marginBottom: 12,
            width: 64,
          }}
        >
          <GateIcon size={28} strokeWidth={1.8} />
        </Flexbox>
        <h2 style={{ color: token.colorText, fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>
          {gateKind === 'none' ? 'Welcome' : 'Station access'}
        </h2>
        <Text type="secondary" style={{ fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
          {gateKind === 'none'
            ? 'Sign in to your account to continue'
            : 'Complete the Station requirement to continue.'}
        </Text>
        {gateKind !== 'none' ? renderGate() : (
          <>
            <Flexbox
              horizontal
              style={{
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 10,
                marginBottom: 16,
                padding: 4,
                width: '100%',
              }}
            >
              <Button
                data-pt-prototype-login-tab="quick"
                disabled={phase !== 'idle' && phase !== 'error'}
                onClick={() => setTab('quick')}
                style={{
                  background: tab === 'quick' ? token.colorBgContainer : 'transparent',
                  flex: 1,
                  height: 32,
                }}
                type="text"
              >
                Quick Login
              </Button>
              <Button
                data-pt-prototype-login-tab="email"
                disabled={phase !== 'idle' && phase !== 'error'}
                onClick={() => setTab('email')}
                style={{
                  background: tab === 'email' ? token.colorBgContainer : 'transparent',
                  flex: 1,
                  height: 32,
                }}
                type="text"
              >
                Email Login
              </Button>
            </Flexbox>
            <div style={{ minHeight: 98, width: '100%' }}>
              {tab === 'quick' ? (
                availableProviders.length > 0 ? (
                  <Flexbox gap={10} style={{ width: '100%' }}>
                    {availableProviders.map(provider => {
                      const active = providerId === provider.id;
                      const providerPhase = active ? phase : 'idle';
                      const pending = ['opening', 'waiting', 'initializing', 'success'].includes(providerPhase);
                      const cancellable = active && ['opening', 'waiting', 'error'].includes(providerPhase);
                      const label = providerPhase === 'opening'
                        ? `Opening ${provider.name}...`
                        : providerPhase === 'waiting'
                          ? 'Waiting for authorization...'
                          : providerPhase === 'initializing'
                            ? 'Preparing your account...'
                            : providerPhase === 'success'
                              ? 'Login successful'
                              : providerPhase === 'error'
                                ? `Login failed. Retry ${provider.name}`
                                : `Continue with ${provider.name}`;
                      const icon = ['opening', 'waiting', 'initializing'].includes(providerPhase)
                        ? <Spin size="small" />
                        : providerPhase === 'success'
                          ? <Check size={18} />
                          : providerPhase === 'error'
                            ? <RotateCcw size={18} />
                            : providerIcon(provider);

                      return (
                        <div
                          aria-live={active ? 'polite' : undefined}
                          data-pt-prototype-oauth-action={provider.id}
                          key={provider.id}
                          ref={(element) => { actionRefs.current[provider.id] = element; }}
                          role={active ? 'status' : undefined}
                          tabIndex={active ? -1 : undefined}
                          style={{
                            height: ACTION_HEIGHT,
                            position: 'relative',
                            width: '100%',
                          }}
                        >
                          <Button
                            aria-label={label}
                            data-pt-prototype-oauth-provider={provider.id}
                            data-pt-prototype-oauth-state={providerPhase}
                            disabled={(!!providerId && !active) || pending}
                            onClick={() => start(provider)}
                            ref={(element) => { buttonRefs.current[provider.id] = element; }}
                            style={{
                              alignItems: 'center',
                              borderColor: active
                                ? providerPhase === 'error'
                                  ? token.colorError
                                  : providerPhase === 'success'
                                    ? token.colorSuccess
                                    : provider.color
                                : undefined,
                              borderRadius: 12,
                              color: active
                                ? providerPhase === 'error'
                                  ? token.colorError
                                  : providerPhase === 'success'
                                    ? token.colorSuccess
                                    : provider.color
                                : undefined,
                              display: 'grid',
                              fontSize: 14,
                              fontWeight: 500,
                              gap: 8,
                              gridTemplateColumns: '24px minmax(0, 1fr) 24px',
                              height: ACTION_HEIGHT,
                              inset: 0,
                              padding: '0 12px',
                              position: 'absolute',
                              width: '100%',
                            }}
                          >
                            <span style={{ alignItems: 'center', display: 'inline-flex', height: 24, justifyContent: 'center', width: 24 }}>
                              {icon}
                            </span>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {label}
                            </span>
                            <span aria-hidden="true" />
                          </Button>
                          {cancellable ? (
                            <Tooltip title="Cancel">
                              <Button
                                aria-label="Cancel"
                                data-pt-prototype-oauth-cancel={provider.id}
                                icon={<X size={15} />}
                                onClick={cancel}
                                ref={(element) => { cancelRefs.current[provider.id] = element; }}
                                size="small"
                                style={{
                                  borderRadius: 8,
                                  height: 32,
                                  minWidth: 32,
                                  padding: 0,
                                  position: 'absolute',
                                  right: 6,
                                  top: 6,
                                  width: 32,
                                  zIndex: 1,
                                }}
                                type="text"
                              />
                            </Tooltip>
                          ) : null}
                        </div>
                      );
                    })}
                  </Flexbox>
                ) : (
                  <Empty
                    data-pt-prototype-oauth-empty
                    description="No OAuth providers available for this Station"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    styles={{ image: { height: 36 } }}
                  />
                )
              ) : (
                <form
                  data-pt-prototype-email-login
                  onSubmit={event => {
                    event.preventDefault();
                    completeEmailLogin();
                  }}
                >
                  <Flexbox gap={10}>
                    <Input
                      aria-label="Email address"
                      autoComplete="email"
                      onChange={event => setEmail(event.target.value)}
                      placeholder="Email address"
                      size="large"
                      type="email"
                      value={email}
                    />
                    <Input.Password
                      aria-label="Password"
                      autoComplete="current-password"
                      onChange={event => setPassword(event.target.value)}
                      placeholder="Password"
                      size="large"
                      value={password}
                    />
                    <Button
                      data-pt-prototype-email-submit
                      disabled={!emailReady}
                      htmlType="submit"
                      loading={emailLoading}
                      size="large"
                      style={emailReady ? ANTD_PRIMARY_BUTTON_STYLE : undefined}
                      type="primary"
                    >
                      Sign In
                    </Button>
                  </Flexbox>
                </form>
              )}
            </div>
          </>
        )}
      </Flexbox>
      <AuthUtilityBarPrototype />
    </main>
  );
}
