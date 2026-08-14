import { useEffect, useRef, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';

import { useChatStore } from '../../../store/chat';
import { MessageBubble } from '../../MessageBubble';

interface ThreadViewProps {
  sessionKey: string;
  sourceMessageId: string;
}

export function ThreadView({ sourceMessageId }: ThreadViewProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const messages = useChatStore((s) => s.messages);
  const scrollRef = useRef<HTMLDivElement>(null);

  const threadMessages = useMemo(() => {
    const sourceIndex = messages.findIndex((m) => m.id === sourceMessageId);
    if (sourceIndex === -1) return messages;
    return messages.slice(sourceIndex);
  }, [messages, sourceMessageId]);

  const sourceMessage = threadMessages[0];
  const sourcePreview = sourceMessage?.content
    ? sourceMessage.content.slice(0, 80) + (sourceMessage.content.length > 80 ? '...' : '')
    : '';

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadMessages.length]);

  return (
    <Flexbox style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Flexbox
        horizontal
        align="center"
        gap={8}
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <MessageSquare size={16} color={token.colorPrimary} />
        <Flexbox style={{ flex: 1, minWidth: 0 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {t('chat.thread.title')}
          </Typography.Text>
          {sourcePreview && (
            <Typography.Text
              type="secondary"
              ellipsis
              style={{ fontSize: 11 }}
            >
              {sourcePreview}
            </Typography.Text>
          )}
        </Flexbox>
      </Flexbox>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {threadMessages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    </Flexbox>
  );
}
