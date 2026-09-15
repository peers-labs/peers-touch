import { ActionIcon } from '@lobehub/ui';
import { theme } from 'antd';
import { Clock3, X } from 'lucide-react';
import { Flexbox } from 'react-layout-kit';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../store/chat';

export function TurnQueueTray() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const queue = useChatStore((state) => state.turnQueues[state.currentSessionKey]);
  const cancelQueuedTurn = useChatStore((state) => state.cancelQueuedTurn);
  const entries = queue?.entries ?? [];

  if (entries.length === 0) return null;

  return (
    <Flexbox
      data-pt-agent-turn-queue
      aria-label={t('chat.queue.title', { count: entries.length })}
      gap={6}
      tabIndex={-1}
      style={{
        width: '100%',
        maxHeight: 132,
        overflowY: 'auto',
        marginBottom: 8,
        padding: '8px 10px',
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 8,
        background: token.colorFillQuaternary,
        boxSizing: 'border-box',
      }}
    >
      <Flexbox horizontal align="center" gap={6}>
        <Clock3 aria-hidden size={14} color={token.colorTextSecondary} />
        <span style={{ color: token.colorTextSecondary, fontSize: 12, fontWeight: 600 }}>
          {t('chat.queue.title', { count: entries.length })}
        </span>
      </Flexbox>
      {entries.map((entry) => (
        <Flexbox
          key={entry.queue_entry_id}
          data-pt-agent-queue-entry={entry.queue_entry_id}
          horizontal
          align="center"
          gap={8}
          style={{ minHeight: 28 }}
        >
          <span
            data-pt-agent-queue-position={entry.queue_position}
            style={{
              minWidth: 22,
              color: token.colorTextTertiary,
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {t('chat.queue.position', { position: entry.queue_position })}
          </span>
          <span
            style={{
              minWidth: 0,
              flex: 1,
              overflow: 'hidden',
              color: token.colorText,
              fontSize: 12,
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {entry.user_input}
          </span>
          <ActionIcon
            icon={X}
            size={{ blockSize: 24, size: 13 }}
            title={t('chat.queue.cancel')}
            onClick={() => {
              void cancelQueuedTurn(currentSessionKey, entry.queue_entry_id);
            }}
          />
        </Flexbox>
      ))}
    </Flexbox>
  );
}
