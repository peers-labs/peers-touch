import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { MessageSquare, Square } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../store/chat';
import { eventBus, EVENT } from '../kernel/events';
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

export function GlobalOperationTray() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const operations = useChatStore((s) => s.operations);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const stopOperation = useChatStore((s) => s.stopOperation);
  const selectSession = useChatStore((s) => s.selectSession);

  const [now, setNow] = useState(() => Date.now());
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [hovered, setHovered] = useState(false);

  const running = useMemo(() => Object.values(operations), [operations]);

  useEffect(() => {
    if (running.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const phraseTimer = window.setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % PHRASE_KEYS.length);
    }, 4000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(phraseTimer);
    };
  }, [running.length]);

  if (running.length === 0) return null;

  const op = running[running.length - 1];
  const elapsed = formatElapsed(Math.max(0, now - op.startedAt));
  const isCurrent = op.sessionKey === currentSessionKey;

  if (isCurrent) return null;

  const jumpToSession = () => {
    void selectSession(op.sessionKey).then(() => {
      eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'chat' });
    });
  };

  const handleStop = (e: MouseEvent) => {
    e.stopPropagation();
    stopOperation(op.sessionKey);
  };

  return (
    <Flexbox
      horizontal
      align="center"
      gap={10}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={jumpToSession}
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 1000,
        minWidth: 240,
        maxWidth: 320,
        padding: '10px 12px',
        borderRadius: 14,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgElevated,
        boxShadow: hovered ? token.boxShadow : token.boxShadowSecondary,
        cursor: 'pointer',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 0.18s ease, box-shadow 0.18s ease',
      }}
    >
      <ActivityGlyph color={token.colorPrimary} size={20} />
      <Flexbox style={{ minWidth: 0, flex: 1 }}>
        <span
          key={phraseIndex}
          style={{
            fontSize: 13,
            color: token.colorText,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            animation: 'ptGlobalTrayPhrase 0.4s ease',
          }}
        >
          {t(PHRASE_KEYS[phraseIndex])}
        </span>
        <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
          {elapsed} · {t('chat.tray.runningInBackground')}
        </span>
      </Flexbox>
      <Flexbox horizontal align="center" gap={4} style={{ flexShrink: 0 }}>
        <ActionIcon
          icon={MessageSquare}
          title={t('chat.tray.open')}
          size={{ blockSize: 28, size: 14 }}
          style={{ borderRadius: 8, color: token.colorTextSecondary }}
        />
        <ActionIcon
          icon={Square}
          title={t('chat.input.stop')}
          size={{ blockSize: 28, size: 13 }}
          onClick={handleStop}
          style={{
            borderRadius: 8,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            color: token.colorTextSecondary,
          }}
        />
      </Flexbox>
      <style>{`
        @keyframes ptGlobalTrayPhrase {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Flexbox>
  );
}
