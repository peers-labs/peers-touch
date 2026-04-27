// Render a single chat message attachment.
//
// Image attachments resolve through the OSS resolver — we never
// render a hard-coded `/api/files/...` URL because the federated
// `oss://{host}/{key}` cid carries the source-of-truth station and
// the local file cache is the preferred backing store.
//
// Non-image attachments render as a clickable file pill that opens
// the resolved URL in the system browser.

import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography, Tooltip } from 'antd';
import { Paperclip } from 'lucide-react';
import { useAttachmentUrl } from './useAttachmentUrl';
import type { FriendMessageAttachment } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMessageAttachment } from '../../gen/proto/domain/chat/group_chat_pb';

const { Text } = Typography;

type Attachment = FriendMessageAttachment | GroupMessageAttachment;

export type ChatAttachmentVisibilityHint = 'public' | 'chat' | 'private';

interface Props {
  attachment: Attachment;
  isOwn: boolean;
  /** Sender-side or resolved OSS scope; public attachments show no extra hint. */
  visibilityHint?: ChatAttachmentVisibilityHint;
}

export function AttachmentItem({ attachment, isOwn, visibilityHint }: Props) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const src = useAttachmentUrl(attachment.cid);
  const isImage = attachment.mimeType?.startsWith('image/');
  const hintTitle =
    visibilityHint === 'chat'
      ? t('chat.social.messageArea.attachmentVisibleChat')
      : visibilityHint === 'private'
        ? t('chat.social.messageArea.attachmentVisiblePrivate')
        : null;
  const hintShort =
    visibilityHint === 'chat'
      ? t('chat.social.messageArea.attachmentScopeChat')
      : visibilityHint === 'private'
        ? t('chat.social.messageArea.attachmentScopePrivate')
        : null;
  const showHint = Boolean(hintTitle && hintShort);

  if (isImage) {
    if (!src) {
      return (
        <Flexbox gap={2}>
          <Flexbox
            align="center"
            justify="center"
            style={{
              width: 200,
              height: 120,
              borderRadius: 6,
              background: token.colorFillTertiary,
            }}
          >
            <Text type="secondary" style={{ fontSize: 11 }}>
              {attachment.filename || 'image'}
            </Text>
          </Flexbox>
          {showHint && (
            <Tooltip title={hintTitle}>
              <Text
                className="cursor-default"
                style={{ fontSize: 10, color: isOwn ? 'rgba(255,255,255,0.65)' : token.colorTextQuaternary }}
              >
                {hintShort}
              </Text>
            </Tooltip>
          )}
        </Flexbox>
      );
    }
    return (
      <Flexbox gap={2}>
        <img
          src={src}
          alt={attachment.filename}
          style={{ maxWidth: 200, maxHeight: 200, borderRadius: 6, cursor: 'pointer' }}
          onClick={() => window.open(src, '_blank')}
          onError={(ev) => {
            (ev.target as HTMLImageElement).style.display = 'none';
          }}
        />
        {showHint && (
          <Tooltip title={hintTitle}>
            <Text
              className="cursor-default"
              style={{ fontSize: 10, color: isOwn ? 'rgba(255,255,255,0.65)' : token.colorTextQuaternary }}
            >
              {hintShort}
            </Text>
          </Tooltip>
        )}
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={2} style={{ maxWidth: '100%' }}>
      <Flexbox
        horizontal
        align="center"
        gap={8}
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          background: isOwn ? 'rgba(255,255,255,0.15)' : token.colorFillTertiary,
          cursor: src ? 'pointer' : 'default',
          opacity: src ? 1 : 0.6,
        }}
        onClick={() => {
          if (src) window.open(src, '_blank');
        }}
      >
        <Paperclip size={14} />
        <Flexbox style={{ minWidth: 0 }}>
          <Text ellipsis style={{ fontSize: 12, color: isOwn ? '#fff' : token.colorText }}>
            {attachment.filename}
          </Text>
          <Text style={{ fontSize: 10, color: isOwn ? 'rgba(255,255,255,0.6)' : token.colorTextQuaternary }}>
            {(Number(attachment.size) / 1024).toFixed(1)} KB
          </Text>
        </Flexbox>
      </Flexbox>
      {showHint && (
        <Tooltip title={hintTitle}>
          <Text
            className="cursor-default"
            style={{ fontSize: 10, color: isOwn ? 'rgba(255,255,255,0.65)' : token.colorTextQuaternary }}
          >
            {hintShort}
          </Text>
        </Tooltip>
      )}
    </Flexbox>
  );
}
