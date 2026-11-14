import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, RotateCcw } from 'lucide-react';

import { AttachmentItem } from '../AttachmentItem';
import {
  isBareEmojiOnlyMessage,
  isEncryptedPlaceholder,
  isRecalledMessage,
  normalizeAttachmentVisibility,
  type ChatMessage,
} from './chatMessageModel';
import { extractUrls, LinkPreviewCard } from './LinkPreviewCard';
import { ServiceMessageCard } from './ServiceMessageCard';
import type { ServiceEventAggregation } from './serviceEventAggregation';
import { ChatMentionText } from './ChatMentionText';
import { useSocialChatStore } from '../../../store/socialChat';

interface ChatMessageContentProps {
  message: ChatMessage;
  isOwn: boolean;
  replyBlock?: ReactNode;
  /** Compact thread surface keeps its tighter attachment rhythm. */
  thread?: boolean;
  serviceAggregation?: ServiceEventAggregation;
  onToggleServiceAggregation?: (key: string) => void;
}

export function ChatMessageContent({
  message,
  isOwn,
  replyBlock,
  thread = false,
  serviceAggregation,
  onToggleServiceAggregation,
}: ChatMessageContentProps) {
  const { t } = useTranslation('chat');
  const currentUserPtid = useSocialChatStore((state) => state.currentUserPtid);
  const isRecalled = isRecalledMessage(message);
  const encryptedPlaceholder = isEncryptedPlaceholder(message);
  const serviceMessage = message.serviceMessage;
  const attachments = message.attachments || [];
  const hasTextContent = message.content.trim().length > 0;
  const urls =
    !isRecalled && !encryptedPlaceholder && !serviceMessage ? extractUrls(message.content) : [];

  return (
    <>
      {replyBlock}
      {isRecalled ? (
        <span className="sc-recalled-tombstone" data-recalled>
          <RotateCcw size={11} className="sc-recalled-tombstone__glyph" />
          {isOwn
            ? t('chat.social.messageArea.recalledByYou')
            : t('chat.social.messageArea.recalledByPeer')}
        </span>
      ) : encryptedPlaceholder ? (
        <span className="sc-msg-content-inline">
          <Lock size={12} className="sc-msg-placeholder__glyph" />
          <span className="sc-msg-placeholder">
            {t('chat.social.encryption.encryptedMessage')}
          </span>
        </span>
      ) : serviceMessage ? (
        <ServiceMessageCard
          service={serviceMessage}
          aggregation={serviceAggregation}
          onToggleAggregation={onToggleServiceAggregation}
        />
      ) : (
        <span
          data-message-text={message.ulid}
          className={isBareEmojiOnlyMessage(message) ? 'sc-emoji-only-bubble' : undefined}
          data-emoji-only={isBareEmojiOnlyMessage(message) || undefined}
        >
          <ChatMentionText
            text={message.content}
            mentions={message.mentions}
            mentionAll={message.mentionAll}
            // Only incoming mail can target the reader; own @all is a sent chip, not @me.
            highlightAll={!isOwn}
            currentUserPtid={currentUserPtid}
          />
        </span>
      )}
      {urls.length > 0 && (
        <span className="sc-msg-link-stack">
          {urls.slice(0, 3).map((url) => (
            <LinkPreviewCard key={url} url={url} />
          ))}
        </span>
      )}
      {!isRecalled && attachments.length > 0 && (
        <span
          className={`sc-msg-attachments${thread ? ' sc-msg-attachments--thread' : ''}${hasTextContent ? '' : ' sc-msg-attachments--media-only'}`}
        >
          {attachments.map((attachment, index) => (
            <AttachmentItem
              key={`${attachment.cid || attachment.filename}-${index}`}
              attachment={attachment}
              isOwn={isOwn}
              visibilityHint={
                normalizeAttachmentVisibility(attachment.visibility)
                ?? (isOwn ? 'chat' : undefined)
              }
            />
          ))}
        </span>
      )}
    </>
  );
}
