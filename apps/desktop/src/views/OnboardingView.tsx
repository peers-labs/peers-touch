import { useState, useEffect, useRef, useMemo } from 'react';
import { theme } from 'antd';
import { GlobalLayout } from '../components/GlobalLayout';
import { LoginPage } from '../pages/LoginPage';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';
import type { AppLifecycle } from '../types/navigation';

// ── Phase & Timing ──

type Phase = 'splash' | 'transition' | 'login';

const SPLASH_DURATION = 2800;
const TRANSITION_DURATION = 600;

// ── Peers colored particle config (reused from SplashScreen) ──

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
        delay: Math.random() * 0.3,
        size: 14 + Math.random() * 10,
        rotation: (Math.random() - 0.5) * 60,
      };
    });
  }, []);

  // ── Splash animation timeline ──
  useEffect(() => {
    const t1 = setTimeout(() => setSplashStep('converge'), 100);
    const t2 = setTimeout(() => setSplashStep('reveal'), 1200);
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
                  transition: `all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) ${p.delay}s`,
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
                transform: `translate(-50%, -50%) scale(${isRevealed ? 1 : 0.3})`,
                opacity: isRevealed ? 1 : 0,
                transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
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
            restoredUser={lifecycle.restoredUser}
            knownAccounts={lifecycle.knownAccounts}
          />
        </div>

        {/* Language switcher — bottom right, above everything */}
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            zIndex: 100,
            opacity: isTransition ? 0 : 1,
            transition: `opacity ${TRANSITION_DURATION}ms ease`,
          }}
        >
          <LanguageSwitcher />
        </div>
      </div>
    </GlobalLayout>
  );
}
