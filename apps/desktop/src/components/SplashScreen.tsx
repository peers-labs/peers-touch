import { useEffect, useState, useMemo } from 'react';

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

export function SplashScreen({ onFinished }: { onFinished: () => void }) {
  const [phase, setPhase] = useState<'scatter' | 'converge' | 'reveal' | 'done'>('scatter');

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

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('converge'), 100);
    const t2 = setTimeout(() => setPhase('reveal'), 1200);
    const t3 = setTimeout(() => setPhase('done'), 2200);
    const t4 = setTimeout(onFinished, 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [onFinished]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafafa',
        zIndex: 9999,
        overflow: 'hidden',
        opacity: phase === 'done' ? 0 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <div style={{ position: 'relative', width: 200, height: 60 }}>
        {peers.map(p => {
          const isConverged = phase === 'converge' || phase === 'reveal' || phase === 'done';
          return (
            <span
              key={p.id}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
          );
        })}

        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) scale(${
              phase === 'reveal' || phase === 'done' ? 1 : 0.3
            })`,
            opacity: phase === 'reveal' || phase === 'done' ? 1 : 0,
            transition: 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontWeight: 800,
              fontSize: 48,
              letterSpacing: '-1px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 40%, #f093fb 70%, #4facfe 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Peers
          </span>
        </div>
      </div>
    </div>
  );
}
