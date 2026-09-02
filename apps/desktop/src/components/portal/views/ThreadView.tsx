import { useEffect, useRef, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';

import { useChatStore } from '../../../store/chat';
import { MessageBubble } from '../../MessageBubble';
import { api, type AgentMessage } from '../../../services/desktop_api';
import { log } from '../../../utils/logger';
import type { ChatMessage } from '../../../store/chat';

interface ThreadViewProps {
  sessionKey: string;
  sourceMessageId: string;
}

// Maps a Station-durable AgentMessage into the local ChatMessage render shape.
function toChatMessage(m: AgentMessage): ChatMessage {
  return {
    id: m.message_id,
    role: m.role as ChatMessage['role'],
    content: m.content,
    timestamp: new Date(m.created_at).getTime(),
    model: m.model_name,
  };
}

export function ThreadView({ sessionKey, sourceMessageId }: ThreadViewProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const messages = useChatStore((s) => s.messages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [threadMessages, setThreadMessages] = useState<ChatMessage[] | null>(null);

  // Resolve the durable Station Thread for this source message: reuse an
  // existing thread forked from it, else create one. Then load its messages.
  useEffect(() => {
    let cancelled = false;
    const conversationId = sessionKey;
    if (!conversationId || !sourceMessageId) return;
    (async () => {
      try {
        const threads = await api.listAgentThreads(conversationId);
        let thread = threads.find((th) => th.source_message_id === sourceMessageId);
        if (!thread) {
          thread = await api.createAgentThread({
            conversation_id: conversationId,
            source_message_id: sourceMessageId,
          });
        }
        const durable = await api.listAgentThreadMessages({ thread_id: thread.thread_id });
        if (!cancelled) setThreadMessages(durable.map(toChatMessage));
      } catch (error) {
        // Durable thread unavailable (e.g. draft conversation not yet persisted).
        // Fall back to the local slice projection below.
        log.warn('chat', 'thread durable load failed, using local projection', { error });
        if (!cancelled) setThreadMessages(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionKey, sourceMessageId]);

  // Local slice projection — used until/unless durable thread messages load.
  const localSlice = useMemo(() => {
    const sourceIndex = messages.findIndex((m) => m.id === sourceMessageId);
    if (sourceIndex === -1) return messages;
    return messages.slice(sourceIndex);
  }, [messages, sourceMessageId]);

  const rendered = threadMessages ?? localSlice;
  const sourceMessage = rendered[0];
  const sourcePreview = sourceMessage?.content
    ? sourceMessage.content.slice(0, 80) + (sourceMessage.content.length > 80 ? '...' : '')
    : '';

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rendered.length]);

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
        {rendered.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    </Flexbox>
  );
}
