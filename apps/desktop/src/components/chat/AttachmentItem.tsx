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
import { Globe, Lock, MessageSquare, Paperclip } from 'lucide-react';
import { useAttachmentUrl } from './useAttachmentUrl';
import type { FriendMessageAttachment } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMessageAttachment } from '../../gen/proto/domain/chat/group_chat_pb';

const { Text } = Typography;

type Attachment = FriendMessageAttachment | GroupMessageAttachment;

export type ChatAttachmentVisibilityHint = 'public' | 'chat' | 'private';

interface Props {
  attachment: Attachment;
  isOwn: boolean;
  /**
   * Wire-derived OSS scope for the attachment ("public" / "chat" /
   * "private"). Sender-authoritative — populated at upload time by
   * `chat_upload_attachment` and travels with the message via the
   * proto's new `visibility` field. When undefined (empty wire
   * value, legacy senders), the badge is suppressed entirely.
   */
  visibilityHint?: ChatAttachmentVisibilityHint;
}

interface VisibilityChip {
  icon: typeof Globe;
  label: string;
  tooltip: string;
  /** Tag color in the bubble background tone (own vs received). */
  bg: string;
  fg: string;
}

function visibilityChip(
  hint: ChatAttachmentVisibilityHint | undefined,
  t: ReturnType<typeof useTranslation>['t'],
  isOwn: boolean,
  token: ReturnType<typeof theme.useToken>['token'],
): VisibilityChip | null {
  if (!hint) return null;
  // Tone the chip down for own messages (which already sit on a
  // colored bubble) and lift it slightly for received messages so
  // it remains legible against the muted bubble background.
  const ownBg = 'rgba(255,255,255,0.18)';
  const ownFg = 'rgba(255,255,255,0.92)';
  switch (hint) {
    case 'public':
      return {
        icon: Globe,
        label: t('chat.social.messageArea.attachmentScopePublic', 'Public'),
        tooltip: t(
          'chat.social.messageArea.attachmentVisiblePublic',
          'Anyone with the link can fetch this file.',
        ),
        bg: isOwn ? ownBg : token.colorInfoBg,
        fg: isOwn ? ownFg : token.colorInfoText,
      };
    case 'chat':
      return {
        icon: MessageSquare,
        label: t('chat.social.messageArea.attachmentScopeChat'),
        tooltip: t('chat.social.messageArea.attachmentVisibleChat'),
        bg: isOwn ? ownBg : token.colorPrimaryBg,
        fg: isOwn ? ownFg : token.colorPrimaryText,
      };
    case 'private':
      return {
        icon: Lock,
        label: t('chat.social.messageArea.attachmentScopePrivate'),
        tooltip: t('chat.social.messageArea.attachmentVisiblePrivate'),
        bg: isOwn ? ownBg : token.colorFillSecondary,
        fg: isOwn ? ownFg : token.colorTextSecondary,
      };
  }
}

function VisibilityBadge({ chip }: { chip: VisibilityChip }) {
  const Icon = chip.icon;
  return (
    <Tooltip title={chip.tooltip}>
      <Flexbox
        horizontal
        align="center"
        gap={4}
        style={{
          alignSelf: 'flex-start',
          padding: '1px 6px',
          borderRadius: 10,
          background: chip.bg,
          color: chip.fg,
          fontSize: 10,
          lineHeight: 1.4,
          cursor: 'default',
          userSelect: 'none',
        }}
      >
        <Icon size={10} />
        <span>{chip.label}</span>
      </Flexbox>
    </Tooltip>
  );
}

export function AttachmentItem({ attachment, isOwn, visibilityHint }: Props) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const src = useAttachmentUrl(attachment.cid);
  const isImage = attachment.mimeType?.startsWith('image/');
  const chip = visibilityChip(visibilityHint, t, isOwn, token);
  const showHint = chip !== null;

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
          {showHint && chip && <VisibilityBadge chip={chip} />}
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
        {showHint && chip && <VisibilityBadge chip={chip} />}
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
      {showHint && chip && <VisibilityBadge chip={chip} />}
    </Flexbox>
  );
}
