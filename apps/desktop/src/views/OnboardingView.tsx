import { useState, useEffect, useRef, useMemo } from 'react';
import { theme } from 'antd';
import { GlobalLayout } from '../components/GlobalLayout';
import { LoginPage } from '../pages/LoginPage';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';
import { StationPicker } from '../components/common/StationPicker';
import type { AppLifecycle } from '../types/navigation';

// ── Phase & Timing ──

type Phase = 'splash' | 'transition' | 'login';

// Calm, legible boot rhythm. The convergence must fully finish before the
// wordmark reveals: converge delay + max stagger + travel duration.
const CONVERGE_DELAY_MS = 600;
const PARTICLE_TRAVEL_MS = 1400;
const PARTICLE_STAGGER_MAX_MS = 500;
const REVEAL_DELAY_MS = CONVERGE_DELAY_MS + PARTICLE_STAGGER_MAX_MS + PARTICLE_TRAVEL_MS;
const SPLASH_DURATION = 4300;
const TRANSITION_DURATION = 600;

// easeOutQuint — particles glide in and decelerate to rest without the
// springy overshoot that made the previous boot feel frantic.
const PARTICLE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const WORDMARK_REVEAL_MS = 900;

// ── Peers colored particle config ──

const PEER_COLORS = [
  '#667eea', '#764ba2', '#f093fb', '#f5576c',
  '#4facfe', '#00f2fe', '#43e97b', '#fa709a',
  '#a18cd1', '#fbc2eb', '#fda085', '#f6d365',
];

interface FlyingPeer {
  id: number;
  color: string;
  startX: number;
  startY: number;
  delay: number;
  size: number;
  rotation: number;
}

const PEERS_FONT = "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const PEERS_GRADIENT_STYLE: React.CSSProperties = {
  fontFamily: PEERS_FONT,
  fontWeight: 800,
  letterSpacing: '-1px',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 40%, #f093fb 70%, #4facfe 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  whiteSpace: 'nowrap',
};

// ── Component ──

interface OnboardingViewProps {
  lifecycle: AppLifecycle;
}

export function OnboardingView({ lifecycle }: OnboardingViewProps) {
  const { token } = theme.useToken();
  // Skip splash if data is already loaded (e.g., fallback from warm resume failure).
  const [phase, setPhase] = useState<Phase>(() => lifecycle.dataReady ? 'login' : 'splash');
  const [splashStep, setSplashStep] = useState<'scatter' | 'converge' | 'reveal'>('scatter');

  const splashTimerDone = useRef(false);
  const dataWasDone = useRef(false);

  const peers = useMemo<FlyingPeer[]>(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 12 + (Math.random() - 0.5) * 0.5;
      const dist = 400 + Math.random() * 300;
      return {
        id: i,
        color: PEER_COLORS[i % PEER_COLORS.length],
        startX: Math.cos(angle) * dist,
        startY: Math.sin(angle) * dist,
        delay: (Math.random() * PARTICLE_STAGGER_MAX_MS) / 1000,
        size: 14 + Math.random() * 10,
        rotation: (Math.random() - 0.5) * 24,
      };
    });
  }, []);

  // ── Splash animation timeline ──
  useEffect(() => {
    const t1 = setTimeout(() => setSplashStep('converge'), CONVERGE_DELAY_MS);
    const t2 = setTimeout(() => setSplashStep('reveal'), REVEAL_DELAY_MS);
    const t3 = setTimeout(() => {
      splashTimerDone.current = true;
      if (dataWasDone.current) setPhase('transition');
    }, SPLASH_DURATION);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // ── Data ready gate ──
  useEffect(() => {
    if (lifecycle.dataReady) {
      dataWasDone.current = true;
      if (splashTimerDone.current) setPhase('transition');
    }
  }, [lifecycle.dataReady]);

  // ── Transition → login ──
  useEffect(() => {
    if (phase === 'transition') {
      const t = setTimeout(() => setPhase('login'), TRANSITION_DURATION);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const isConverged = splashStep === 'converge' || splashStep === 'reveal';
  const isRevealed = splashStep === 'reveal';
  const isSplash = phase === 'splash';

  // ── Splash full-screen overlay ──
  if (isSplash) {
    return (
      <GlobalLayout sideNav={null}>
        <div
          style={{
            width: '100%',
            height: '100%',
            background: token.colorBgLayout,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Flying Peer particles */}
          <div style={{ position: 'relative', width: 200, height: 60 }}>
            {peers.map(p => (
              <span
                key={p.id}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  fontFamily: PEERS_FONT,
                  fontWeight: 800,
                  fontSize: p.size,
                  color: p.color,
                  transform: isConverged
                    ? 'translate(-50%, -50%) rotate(0deg) scale(0)'
                    : `translate(calc(-50% + ${p.startX}px), calc(-50% + ${p.startY}px)) rotate(${p.rotation}deg)`,
                  opacity: isConverged ? 0 : 0.9,
                  transition: `all ${PARTICLE_TRAVEL_MS}ms ${PARTICLE_EASE} ${p.delay}s`,
                  pointerEvents: 'none',
                  userSelect: 'none',
                  letterSpacing: '-0.5px',
                }}
              >
                Peer
              </span>
            ))}

            {/* Gradient "Peers" reveal */}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: `translate(-50%, -50%) scale(${isRevealed ? 1 : 0.8})`,
                opacity: isRevealed ? 1 : 0,
                transition: `all ${WORDMARK_REVEAL_MS}ms ${PARTICLE_EASE}`,
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ ...PEERS_GRADIENT_STYLE, fontSize: 48 }}>
                Peers
              </span>
            </div>
          </div>
        </div>
      </GlobalLayout>
    );
  }

  // ── Login phase: gradient "Peers" on left + full LoginPage on right ──
  //
  // Layout strategy:
  //   - Full-screen container with relative positioning
  //   - LoginPage renders at full width/height (it has its own centering logic),
  //     but we nudge it rightward via padding-left so the card shifts right
  //   - Gradient "Peers" text is absolutely positioned to the left of the card
  //
  // This way LoginPage's internal layout (card + side panel + arrow) is untouched.

  const peersTextOffset = 260;

  const isTransition = phase === 'transition';

  return (
    <GlobalLayout sideNav={null}>
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          background: token.colorBgLayout,
        }}
      >
        {/* Gradient "Peers" text — absolutely positioned left of center */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `calc(50% - ${peersTextOffset}px)`,
            transform: 'translate(-100%, -50%)',
            opacity: isTransition ? 0 : 1,
            transition: `opacity ${TRANSITION_DURATION}ms ease`,
            pointerEvents: 'none',
          }}
        >
          <span style={{ ...PEERS_GRADIENT_STYLE, fontSize: 40 }}>
            Peers
          </span>
        </div>

        {/* LoginPage — full area, card naturally centers itself */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: isTransition ? 0 : 1,
            transition: `opacity ${TRANSITION_DURATION}ms ease`,
          }}
        >
          <LoginPage
            onComplete={lifecycle.completeLogin}
            onLoginWithOAuthBridge={lifecycle.loginWithOAuthBridge}
            onSwitchAccount={lifecycle.switchAccount}
            onUnlockWithPin={lifecycle.unlockWithPin}
            restoredUser={lifecycle.restoredUser}
            knownAccounts={lifecycle.knownAccounts}
          />
        </div>

        {/* Language switcher & Station picker — bottom left, above everything */}
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            zIndex: 100,
            opacity: isTransition ? 0 : 1,
            transition: `opacity ${TRANSITION_DURATION}ms ease`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <StationPicker />
          <LanguageSwitcher />
        </div>
      </div>
    </GlobalLayout>
  );
}
