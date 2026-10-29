import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeToken } from './shared';

const STREAMING_PHRASE_KEYS = [
  'chat.tray.phrase.connecting',
  'chat.tray.phrase.thinking',
  'chat.tray.phrase.crunching',
  'chat.tray.phrase.drafting',
  'chat.tray.phrase.polishing',
] as const;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface ThinkingIndicatorProps {
  token: ThemeToken;
  // Operation run state of the owning turn. The running indicator is the only
  // progress surface for the current turn: no detached composer-adjacent tray
  // exists, so stage phrase and elapsed time live inside the assistant row.
  runState?: string;
  startedAt?: number | null;
}

/**
 * In-turn running indicator (pulsing dots, stage phrase, elapsed timer) shown
 * while the assistant owns an active turn, including after partial output.
 */
export function ThinkingIndicator({ token, runState, startedAt }: ThinkingIndicatorProps) {
  const { t } = useTranslation('chat');
  const [now, setNow] = useState(() => Date.now());
  const [phraseIndex, setPhraseIndex] = useState(0);

  const isReconnecting = runState === 'reconciling'
    || runState === 'connection_lost'
    || runState === 'reconnecting'
    || runState === 'replaying'
    || runState === 'recovery_failed';

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const phraseTimer = isReconnecting
      ? undefined
      : window.setInterval(() => setPhraseIndex((prev) => prev + 1), 4000);
    return () => {
      window.clearInterval(timer);
      if (phraseTimer) window.clearInterval(phraseTimer);
    };
  }, [isReconnecting]);

  const phrase = isReconnecting
    ? t('chat.tray.reconciling')
    : t(STREAMING_PHRASE_KEYS[phraseIndex % STREAMING_PHRASE_KEYS.length]);
  const elapsed = useMemo(() => {
    if (!startedAt) return null;
    return formatElapsed(Math.max(0, now - startedAt));
  }, [now, startedAt]);

  const dotStyle = (delay: string): CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: isReconnecting ? token.colorWarning : token.colorPrimary,
    opacity: 0.6,
    animation: 'ptPulse 1.2s ease-in-out infinite',
    animationDelay: delay,
  });

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        color: token.colorTextSecondary,
        fontSize: 13,
      }}
    >
      <span style={dotStyle('0s')} />
      <span style={dotStyle('0.2s')} />
      <span style={dotStyle('0.4s')} />
      <span style={{ fontWeight: 500 }}>{phrase}</span>
      {elapsed && (
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            color: token.colorTextTertiary,
            marginLeft: 2,
          }}
        >
          {elapsed}
        </span>
      )}
      <style>{`@keyframes ptPulse { 0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); } 40% { opacity: 0.9; transform: scale(1); } }`}</style>
    </div>
  );
}
