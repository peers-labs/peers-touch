import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Spin, theme, Tooltip, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import {
  Check,
  Github,
  LockKeyhole,
  RotateCcw,
  X,
} from 'lucide-react';

type OAuthPhase = 'idle' | 'opening' | 'waiting' | 'initializing' | 'success' | 'error';
type ProviderId = 'github' | 'google';

const { Text } = Typography;
const CARD_WIDTH = 400;
const CARD_MIN_HEIGHT = 356;
const ACTION_HEIGHT = 44;

const providers: Array<{ id: ProviderId; name: string; color: string }> = [
  { id: 'github', name: 'GitHub', color: '#24292f' },
  { id: 'google', name: 'Google', color: '#4285f4' },
];

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

function initialPhase(): OAuthPhase {
  if (typeof window === 'undefined') return 'idle';
  const value = new URLSearchParams(window.location.search).get('state') ?? '';
  const phase = value.replace('auth-oauth-', '');
  return ['opening', 'waiting', 'initializing', 'success', 'error'].includes(phase)
    ? phase as OAuthPhase
    : 'idle';
}

export function OAuthLoginPrototype({ onComplete }: { onComplete: () => void }) {
  const { token } = theme.useToken();
  const initial = useMemo(initialPhase, []);
  const [providerId, setProviderId] = useState<ProviderId | null>(
    initial === 'idle' ? null : 'github',
  );
  const [phase, setPhase] = useState<OAuthPhase>(initial);
  const [narrow, setNarrow] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches
  ));
  const timersRef = useRef<number[]>([]);
  const actionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const buttonRefs = useRef<Record<string, HTMLElement | null>>({});
  const cancelRefs = useRef<Record<string, HTMLElement | null>>({});
  const previousProviderRef = useRef<ProviderId | null>(null);

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
      if (['opening', 'waiting', 'error'].includes(phase)) {
        cancelRefs.current[providerId]?.focus();
        return;
      }
      actionRefs.current[providerId]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase, providerId]);

  const start = (nextProviderId: ProviderId) => {
    clearTimers();
    setProviderId(nextProviderId);
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

  return (
    <main
      data-pt-prototype-auth
      style={{
        alignItems: 'center',
        background: 'linear-gradient(150deg, #fbfcff, #f5f7fd 60%, #eef1fb)',
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
      <div
        aria-hidden="true"
        style={{
          backgroundImage: `radial-gradient(${token.colorPrimaryBorder} 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
          inset: 0,
          maskImage: 'linear-gradient(90deg, #000 0%, rgba(0,0,0,.7) 62%, transparent 84%)',
          opacity: 0.32,
          pointerEvents: 'none',
          position: 'absolute',
        }}
      />
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
          maxWidth: '100%',
          minHeight: CARD_MIN_HEIGHT,
          padding: '36px 32px',
          position: 'relative',
          width: CARD_WIDTH,
          zIndex: 1,
        }}
      >
        <Flexbox
          align="center"
          justify="center"
          style={{
            background: token.colorPrimaryBg,
            border: `1px solid ${token.colorPrimaryBorder}`,
            borderRadius: 18,
            color: token.colorPrimary,
            height: 72,
            marginBottom: 14,
            width: 72,
          }}
        >
          <LockKeyhole size={30} strokeWidth={1.8} />
        </Flexbox>
        <h2 style={{ color: token.colorText, fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>
          Welcome
        </h2>
        <Text type="secondary" style={{ fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
          Sign in to your account to continue
        </Text>
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
          <Button style={{ background: token.colorBgContainer, flex: 1, height: 32 }} type="text">
            Quick Login
          </Button>
          <Button disabled={phase !== 'idle' && phase !== 'error'} style={{ flex: 1, height: 32 }} type="text">
            Email Login
          </Button>
        </Flexbox>
        <Flexbox gap={10} style={{ width: '100%' }}>
          {providers.map(provider => {
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
                  : provider.id === 'github'
                    ? <Github size={18} />
                    : <GoogleIcon />;

            return (
              <div
                aria-live={active ? 'polite' : undefined}
                data-pt-prototype-oauth-action={provider.id}
                key={provider.id}
                ref={(element) => { actionRefs.current[provider.id] = element; }}
                role={active ? 'status' : undefined}
                tabIndex={active ? -1 : undefined}
                style={{
                  flex: `0 0 ${ACTION_HEIGHT}px`,
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
                  onClick={() => start(provider.id)}
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
                {cancellable && (
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
                )}
              </div>
            );
          })}
        </Flexbox>
      </Flexbox>
    </main>
  );
}
