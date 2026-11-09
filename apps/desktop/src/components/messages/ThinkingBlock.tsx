import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
export function ThinkingIndicator({ runState, startedAt }: ThinkingIndicatorProps) {
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

  return (
    <div
      className="sc-thinking-indicator"
      data-reconnecting={isReconnecting ? 'true' : undefined}
    >
      <span className="sc-thinking-indicator__dot" style={{ animationDelay: '0s' }} />
      <span className="sc-thinking-indicator__dot" style={{ animationDelay: '0.2s' }} />
      <span className="sc-thinking-indicator__dot" style={{ animationDelay: '0.4s' }} />
      <span className="sc-thinking-indicator__phrase">{phrase}</span>
      {elapsed && (
        <span className="sc-thinking-indicator__elapsed">{elapsed}</span>
      )}
    </div>
  );
}
