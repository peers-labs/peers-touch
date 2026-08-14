import { useState, useCallback, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Tag, toast } from '@lobehub/ui';
import { theme } from 'antd';
import { Wrench, Copy, Check, Trash2 } from 'lucide-react';
import type { ChatMessage, MessageArtifact } from '../store/chat';
import { useChatStore } from '../store/chat';
import { LazyMarkdown as Markdown } from './LazyMarkdown';
import MessageCard, { type CardData } from './MessageCard';
import { AgentIconTile } from './agent/AgentIconTile';
import { parseDeepLink } from '../utils/deeplink';
import { EVENT, eventBus } from '../kernel/events';
import { useTranslation } from 'react-i18next';
import { AssistantMessage } from './messages/AssistantMessage';
import { UserMessage } from './messages/UserMessage';
import { MiniButton, timeAgo, fullTime } from './messages/shared';
import { usePortalStore } from '../store/portal';

interface Props {
  message: ChatMessage;
  userAvatar?: { url?: string; name: string };
  onOpenArtifact?: (artifact: MessageArtifact) => void;
}

/**
 * Top-level message renderer — dispatches to role-specific components.
 * Handles card messages and tool messages inline; delegates user/assistant
 * messages to their dedicated sub-components.
 */
export function MessageBubble({ message, userAvatar, onOpenArtifact }: Props) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  // Card-type messages: schema-driven rendering
  const cardData = useMemo<CardData | null>(() => {
    if (message.contentType !== 'card') return null;
    try {
      return JSON.parse(message.content) as CardData;
    } catch {
      return null;
    }
  }, [message.content, message.contentType]);

  const handleDeepLinkNav = useCallback((uri: string) => {
    const parsed = parseDeepLink(uri);
    if (!parsed) return;
    eventBus.publish(EVENT.NAVIGATION_REQUESTED, parsed);
  }, []);

  const handleCopyCard = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      toast.success(t('chat.message.toast.copied'));
      setTimeout(() => setCopied(false), 2000);
    });
  }, [message.content, t]);

  const handleDeleteCard = useCallback(() => {
    useChatStore.getState().deleteMessage(message.id);
  }, [message.id]);

  // --- Card message ---
  if (cardData) {
    return (
      <Flexbox
        align="flex-start"
        gap={8}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ position: 'relative', paddingBlock: 8, paddingInlineEnd: 36 }}
      >
        <Flexbox direction="horizontal" align="center" gap={8}>
          <AgentIconTile size={32} />
          <span
            style={{
              fontSize: 12,
              color: token.colorTextQuaternary,
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.2s',
            }}
            title={fullTime(message.timestamp)}
          >
            {timeAgo(message.timestamp, t)}
          </span>
        </Flexbox>

        <Flexbox gap={8} style={{ maxWidth: '100%', overflow: 'hidden', width: '100%' }}>
          <MessageCard card={cardData} onNavigate={handleDeepLinkNav} />

          {/* Card action bar: Copy + Delete only */}
          <div
            style={{
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              alignSelf: 'flex-start',
              background: hovered ? token.colorBgElevated : 'transparent',
              borderRadius: 8,
              boxShadow: hovered ? token.boxShadowTertiary : 'none',
              padding: '2px 4px',
              height: 28,
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? 'auto' : 'none',
              transition: 'opacity 0.2s',
            }}
          >
            <MiniButton icon={copied ? <Check size={14} /> : <Copy size={14} />} title={t('chat.message.action.copy')} onClick={handleCopyCard} />
            <MiniButton icon={<Trash2 size={14} />} title={t('chat.message.action.delete')} onClick={handleDeleteCard} />
          </div>
        </Flexbox>
      </Flexbox>
    );
  }

  // --- Tool message ---
  if (message.role === 'tool') {
    return (
      <Flexbox style={{ padding: '4px 0' }}>
        <Flexbox
          style={{
            borderRadius: 8,
            padding: '8px 12px',
            background: token.colorFillQuaternary,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {message.toolName && (
            <Flexbox horizontal align="center" gap={6} style={{ marginBottom: 6 }}>
              <Wrench size={13} style={{ color: token.colorTextSecondary }} />
              <Tag bordered={false} color="processing" style={{ margin: 0, fontSize: 12 }}>
                {message.toolName}
              </Tag>
            </Flexbox>
          )}
          <Markdown variant="chat">{message.content}</Markdown>
        </Flexbox>
      </Flexbox>
    );
  }

  // --- User message ---
  if (message.role === 'user') {
    return <UserMessage message={message} userAvatar={userAvatar} />;
  }

  // --- Assistant message (default) ---
  return <AssistantMessage message={message} onOpenArtifact={onOpenArtifact || usePortalStore.getState().openArtifact} />;
}
