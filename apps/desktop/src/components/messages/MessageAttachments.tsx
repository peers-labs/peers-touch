import { useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { theme, Tooltip } from 'antd';
import { Download, FileText, Image, Music, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatComposerAttachment } from '../../store/chat';
import { useOssAttachmentUrl } from '../shared/oss/useOssAttachmentUrl';

interface MessageAttachmentsProps {
  attachments: ChatComposerAttachment[];
  /** Whether to show a bottom margin (e.g. when content follows). */
  marginBottom?: boolean;
}

/** Returns the icon for a MIME type. */
function iconForMime(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.startsWith('video/')) return Video;
  if (mimeType.startsWith('audio/')) return Music;
  return FileText;
}

/** Formats byte size to human-readable string. */
function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

/**
 * Renders file attachments on a message (user or assistant).
 * Files resolve their canonical OSS reference on demand. Images render an
 * inline preview; other files retain the compact file-card treatment.
 */
export function MessageAttachments({ attachments, marginBottom = false }: MessageAttachmentsProps) {
  if (attachments.length === 0) return null;

  return (
    <Flexbox horizontal gap={8} wrap="wrap" style={{ marginBottom: marginBottom ? 8 : 0 }}>
      {attachments.map((item) => (
        <MessageAttachmentItem key={item.cid} item={item} />
      ))}
    </Flexbox>
  );
}

function MessageAttachmentItem({ item }: { item: ChatComposerAttachment }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const resolvedUrl = useOssAttachmentUrl(item.cid);
  const downloadUrl = resolvedUrl || item.url || item.previewUrl;
  const Icon = iconForMime(item.mime_type);
  const isImage = item.mime_type.startsWith('image/');
  useEffect(() => () => {
    if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
  }, [item.previewUrl]);
  const openAttachment = () => {
    if (downloadUrl) window.open(downloadUrl, '_blank');
  };

  return (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      data-pt-agent-message-attachment={item.attachment?.attachment_id ?? item.cid}
      role={downloadUrl ? 'button' : undefined}
      tabIndex={downloadUrl ? 0 : undefined}
      aria-label={downloadUrl ? t('chat.input.attachmentDownload') : undefined}
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 8,
        padding: '8px 10px',
        background: token.colorFillQuaternary,
        minWidth: 180,
        maxWidth: 280,
        cursor: downloadUrl ? 'pointer' : 'default',
      }}
      onClick={openAttachment}
      onKeyDown={(event) => {
        if (downloadUrl && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          openAttachment();
        }
      }}
    >
      {isImage && downloadUrl ? (
        <img
          src={downloadUrl}
          alt={item.filename || t('chat.input.attachmentFallbackName')}
          style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <Icon size={18} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
      )}
      <Flexbox style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            fontSize: 13,
            color: token.colorText,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.filename || t('chat.input.attachmentFallbackName')}
        </span>
        <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
          {formatSize(item.size)}
        </span>
      </Flexbox>
      {downloadUrl && (
        <Tooltip title={t('chat.input.attachmentDownload')}>
          <Download size={14} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
        </Tooltip>
      )}
    </Flexbox>
  );
}
