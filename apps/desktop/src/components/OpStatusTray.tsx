import { useEffect, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { Square } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../store/chat';
import { ActivityGlyph } from './chat/ActivityGlyph';

const PHRASE_KEYS = [
  'chat.tray.phrase.thinking',
  'chat.tray.phrase.connecting',
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

export function OpStatusTray() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingStartedAt = useChatStore((s) => s.streamingStartedAt);
  const stopStreaming = useChatStore((s) => s.stopStreaming);

  const [now, setNow] = useState(() => Date.now());
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    if (!isStreaming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const phraseTimer = window.setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % PHRASE_KEYS.length);
    }, 4000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(phraseTimer);
    };
  }, [isStreaming]);

  const elapsed = useMemo(() => {
    if (!streamingStartedAt) return '00:00';
    return formatElapsed(Math.max(0, now - streamingStartedAt));
  }, [now, streamingStartedAt]);

  if (!isStreaming) return null;

  return (
    <Flexbox
      horizontal
      align="center"
      gap={10}
      style={{
        width: '100%',
        minHeight: 40,
        padding: '6px 12px',
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        boxSizing: 'border-box',
      }}
    >
      <ActivityGlyph color={token.colorPrimary} size={18} />
      <span
        key={phraseIndex}
        style={{
          fontSize: 13,
          color: token.colorTextSecondary,
          fontWeight: 500,
          animation: 'ptTrayPhrase 0.4s ease',
        }}
      >
        {t(PHRASE_KEYS[phraseIndex])}
      </span>
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
      <div style={{ flex: 1 }} />
      <ActionIcon
        icon={Square}
        onClick={stopStreaming}
        title={t('chat.input.stop')}
        size={{ blockSize: 28, size: 13 }}
        style={{
          borderRadius: 8,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          color: token.colorTextSecondary,
        }}
      />
      <style>{`
        @keyframes ptTrayPhrase {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Flexbox>
  );
}
