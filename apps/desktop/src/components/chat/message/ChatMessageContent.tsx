import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography } from 'antd';
import { Lock, RotateCcw } from 'lucide-react';

import { AttachmentItem } from '../AttachmentItem';
import {
  isEncryptedPlaceholder,
  isRecalledMessage,
  normalizeAttachmentVisibility,
  type ChatMessage,
} from './chatMessageModel';
import { extractUrls, LinkPreviewCard } from './LinkPreviewCard';

const { Text } = Typography;

interface ChatMessageContentProps {
  message: ChatMessage;
  isOwn: boolean;
  replyBlock?: ReactNode;
  attachmentGap?: number;
}

export function ChatMessageContent({
  message,
  isOwn,
  replyBlock,
  attachmentGap = 6,
}: ChatMessageContentProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const isRecalled = isRecalledMessage(message);
  const encryptedPlaceholder = isEncryptedPlaceholder(message);
  const attachments = message.attachments || [];
  const urls = !isRecalled && !encryptedPlaceholder ? extractUrls(message.content) : [];

  return (
    <>
      {replyBlock}
      {isRecalled ? (
        <Flexbox horizontal align="center" gap={4}>
          <RotateCcw size={12} style={{ color: token.colorTextQuaternary }} />
          <Text type="secondary" style={{ fontStyle: 'italic', fontSize: 13 }}>
            {isOwn
              ? t('chat.social.messageArea.recalledByYou')
              : t('chat.social.messageArea.recalledByPeer')}
          </Text>
        </Flexbox>
      ) : encryptedPlaceholder ? (
        <Flexbox horizontal align="center" gap={4}>
          <Lock size={12} style={{ color: token.colorTextQuaternary }} />
          <Text type="secondary" style={{ fontStyle: 'italic', fontSize: 13 }}>
            {t('chat.social.encryption.encryptedMessage')}
          </Text>
        </Flexbox>
      ) : (
        message.content
      )}
      {urls.length > 0 && (
        <Flexbox gap={4}>
          {urls.slice(0, 3).map((url) => (
            <LinkPreviewCard key={url} url={url} isOwn={isOwn} />
          ))}
        </Flexbox>
      )}
      {!isRecalled && attachments.length > 0 && (
        <Flexbox
          align={isOwn ? 'flex-end' : 'flex-start'}
          gap={attachmentGap}
          style={{ marginTop: message.content ? 8 : 0 }}
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
        </Flexbox>
      )}
    </>
  );
}
