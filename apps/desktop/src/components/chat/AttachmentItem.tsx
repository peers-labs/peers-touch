// Render a single chat message attachment.
//
// Image attachments resolve through the OSS resolver — we never
// render a hard-coded `/api/files/...` URL because the federated
// `oss://{host}/{key}` cid carries the source-of-truth station and
// the local file cache is the preferred backing store.
//
// Image attachments render as inline thumbnails with an in-app preview.
// Non-image attachments stay as compact cards that open the resolved URL
// in the system browser.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Image, theme, Typography, Tooltip } from 'antd';
import { ExternalLink, FileImage, Globe, Lock, MessageSquare, Paperclip } from 'lucide-react';
import { openMediaExternal, useMediaProjection } from '../../services/mediaRuntime';
import type { FriendMessageAttachment } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMessageAttachment } from '../../gen/proto/domain/chat/group_chat_pb';
import { log } from '../../utils/logger';

const { Text } = Typography;

type Attachment = FriendMessageAttachment | GroupMessageAttachment;

export type ChatAttachmentVisibilityHint = 'public' | 'chat' | 'private';

const IMAGE_FILENAME_PATTERN = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;

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

function isImageAttachment(attachment: Attachment): boolean {
  const mimeType = attachment.mimeType?.toLowerCase() ?? '';
  const filename = attachment.filename ?? '';
  return mimeType.startsWith('image/') || IMAGE_FILENAME_PATTERN.test(filename);
}

function imageThumbnailCid(attachment: Attachment): string {
  const candidate = (attachment as Attachment & { thumbnail_cid?: string }).thumbnailCid
    || (attachment as Attachment & { thumbnail_cid?: string }).thumbnail_cid
    || '';
  return candidate.trim() || attachment.cid;
}

function formatAttachmentSize(size: Attachment['size']): string {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentTypeLabel(
  attachment: Attachment,
  isImage: boolean,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (isImage) return t('chat.social.messageArea.attachmentTypeImage', 'Image');

  const mimeType = attachment.mimeType?.trim();
  if (mimeType) {
    const [, subtype] = mimeType.split('/');
    if (subtype) return subtype.split(/[+;]/)[0].replace(/[-_.]+/g, ' ').toUpperCase();
  }

  const filename = attachment.filename ?? '';
  const extension = filename.includes('.') ? filename.split('.').pop() : '';
  return extension
    ? extension.toUpperCase()
    : t('chat.social.messageArea.attachmentTypeFile', 'File');
}

interface AttachmentDetailsProps {
  actionLabel: string;
  actionVisible: boolean;
  filename: string;
  isImage: boolean;
  isOwn: boolean;
  onOpen: () => void;
  openTitle: string;
  sizeLabel: string;
  src: string | null;
  token: ReturnType<typeof theme.useToken>['token'];
  typeLabel: string;
}

function AttachmentDetails({
  actionLabel,
  actionVisible,
  filename,
  isImage,
  isOwn,
  onOpen,
  openTitle,
  sizeLabel,
  src,
  token,
  typeLabel,
}: AttachmentDetailsProps) {
  const TypeIcon = isImage ? FileImage : Paperclip;
  const textColor = isOwn ? '#fff' : token.colorText;
  const secondaryColor = isOwn ? 'rgba(255,255,255,0.72)' : token.colorTextSecondary;

  return (
    <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0, width: '100%' }}>
      <Flexbox
        align="center"
        justify="center"
        style={{
          width: 30,
          height: 30,
          flex: '0 0 30px',
          borderRadius: 8,
          background: isOwn ? 'rgba(255,255,255,0.16)' : token.colorFillSecondary,
          color: textColor,
        }}
      >
        <TypeIcon size={15} />
      </Flexbox>
      <Flexbox gap={1} style={{ flex: 1, minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
          <Text style={{ flex: '0 0 auto', fontSize: 10, fontWeight: 600, color: secondaryColor }}>
            {typeLabel}
          </Text>
          {sizeLabel && (
            <Text ellipsis style={{ minWidth: 0, fontSize: 10, color: secondaryColor }}>
              {sizeLabel}
            </Text>
          )}
        </Flexbox>
        <Text ellipsis style={{ fontSize: 12, fontWeight: 500, color: textColor }}>
          {filename}
        </Text>
      </Flexbox>
      {src && (
        <Tooltip title={openTitle}>
          <button
            type="button"
            aria-label={openTitle}
            onClick={(ev) => {
              ev.stopPropagation();
              onOpen();
            }}
            style={{
              appearance: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 7px',
              border: `1px solid ${isOwn ? 'rgba(255,255,255,0.24)' : token.colorBorderSecondary}`,
              borderRadius: 999,
              background: isOwn ? 'rgba(255,255,255,0.14)' : token.colorBgContainer,
              color: textColor,
              cursor: 'pointer',
              fontSize: 10,
              lineHeight: 1,
              opacity: actionVisible ? 1 : 0.72,
              transition: 'opacity 120ms ease, background 120ms ease',
              whiteSpace: 'nowrap',
            }}
          >
            <ExternalLink size={11} />
            <span>{actionLabel}</span>
          </button>
        </Tooltip>
      )}
    </Flexbox>
  );
}

export function AttachmentItem({ attachment, isOwn, visibilityHint }: Props) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const [hovered, setHovered] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const isImage = isImageAttachment(attachment);
  const media = useMediaProjection(attachment.cid
    ? {
        cid: attachment.cid,
        thumbnailCid: isImage ? imageThumbnailCid(attachment) : undefined,
        mimeType: attachment.mimeType,
      }
    : null);
  const fullSrc = media?.localOriginalSrc ?? null;
  const thumbnailSrc = media?.localThumbnailSrc ?? fullSrc;
  const chip = visibilityChip(visibilityHint, t, isOwn, token);
  const showHint = chip !== null;
  const filename = attachment.filename?.trim() || t('chat.social.messageArea.attachmentUnnamed', 'Attachment');
  const typeLabel = attachmentTypeLabel(attachment, isImage, t);
  const sizeLabel = formatAttachmentSize(attachment.size);
  const actionLabel = t('chat.social.messageArea.attachmentOpen', 'Open');
  const openTitle = t('chat.social.messageArea.attachmentOpenOrDownload', 'Open or download attachment');
  const imageReady = Boolean(isImage && thumbnailSrc && !previewFailed);
  const imageFailed = Boolean(isImage && (previewFailed || media?.state === 'failed'));
  const cardBackground = isOwn
    ? hovered
      ? 'rgba(255,255,255,0.22)'
      : 'rgba(255,255,255,0.15)'
    : hovered
      ? token.colorFillSecondary
      : token.colorFillTertiary;
  const cardBorder = isOwn ? 'rgba(255,255,255,0.22)' : token.colorBorderSecondary;

  useEffect(() => {
    setPreviewFailed(false);
  }, [attachment.cid, thumbnailSrc]);

  const openAttachment = () => {
    if (!attachment.cid) return;
    void openMediaExternal(attachment.cid).catch((error) => {
      log.warn('chat', 'open attachment failed', error);
    });
  };

  const handleKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (!attachment.cid) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      openAttachment();
    }
  };

  if (isImage) {
    const statusText = imageFailed
      ? t('chat.social.messageArea.imageUnavailable', 'Image unavailable')
      : t('chat.social.messageArea.imageResolving', 'Loading image...');

    return (
      <Flexbox gap={3} style={{ maxWidth: '100%' }}>
        <Flexbox
          role={attachment.cid ? 'button' : undefined}
          tabIndex={attachment.cid ? 0 : undefined}
          onClick={imageReady ? undefined : openAttachment}
          onKeyDown={handleKeyDown}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            maxWidth: 'min(260px, 100%)',
            overflow: 'hidden',
            border: `1px solid ${cardBorder}`,
            borderRadius: 12,
            background: cardBackground,
            boxShadow: hovered ? token.boxShadowTertiary : 'none',
            cursor: attachment.cid ? 'pointer' : 'default',
            transition: 'background 120ms ease, box-shadow 120ms ease',
          }}
        >
          {imageReady ? (
            <Image
              src={thumbnailSrc ?? ''}
              alt={filename}
              preview={fullSrc ? { src: fullSrc, mask: false } : false}
              wrapperStyle={{
                display: 'block',
                maxWidth: 'min(260px, 100%)',
                lineHeight: 0,
              }}
              style={{
                display: 'block',
                maxWidth: 'min(260px, 100%)',
                maxHeight: 260,
                objectFit: 'contain',
                background: token.colorFillSecondary,
              }}
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <Flexbox
              align="center"
              justify="center"
              gap={8}
              style={{
                width: 220,
                minHeight: 140,
                padding: 16,
                color: isOwn ? 'rgba(255,255,255,0.82)' : token.colorTextSecondary,
                background: isOwn ? 'rgba(255,255,255,0.08)' : token.colorFillSecondary,
              }}
            >
              <FileImage size={24} />
              <Text style={{ color: 'inherit', fontSize: 12, fontWeight: 500 }}>
                {statusText}
              </Text>
              <Text ellipsis style={{ maxWidth: 180, color: 'inherit', fontSize: 11, opacity: 0.72 }}>
                {filename}
              </Text>
            </Flexbox>
          )}
        </Flexbox>
        {showHint && chip && <VisibilityBadge chip={chip} />}
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={3} style={{ maxWidth: '100%' }}>
      <Flexbox
        horizontal
        align="center"
        role={fullSrc ? 'button' : undefined}
        tabIndex={fullSrc ? 0 : undefined}
        style={{
          width: 'min(260px, 100%)',
          maxWidth: '100%',
          padding: '8px 9px',
          border: `1px solid ${cardBorder}`,
          borderRadius: 10,
          background: cardBackground,
          boxShadow: hovered ? token.boxShadowTertiary : 'none',
          cursor: fullSrc ? 'pointer' : 'default',
          opacity: fullSrc ? 1 : 0.72,
          transition: 'background 120ms ease, box-shadow 120ms ease',
        }}
        onClick={openAttachment}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <AttachmentDetails
          actionLabel={actionLabel}
          actionVisible={hovered}
          filename={filename}
          isImage={isImage}
          isOwn={isOwn}
          onOpen={openAttachment}
          openTitle={openTitle}
          sizeLabel={sizeLabel}
          src={fullSrc}
          token={token}
          typeLabel={typeLabel}
        />
      </Flexbox>
      {showHint && chip && <VisibilityBadge chip={chip} />}
    </Flexbox>
  );
}
