import { Flexbox } from 'react-layout-kit';
import { theme, Tooltip } from 'antd';
import { Download, FileText, Image, Music, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatComposerAttachment } from '../../store/chat';

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
 * Non-image files show as compact cards; images are rendered by the
 * existing image gallery in UserMessage.
 */
export function MessageAttachments({ attachments, marginBottom = false }: MessageAttachmentsProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const nonImageAttachments = attachments.filter((item) => !item.mime_type.startsWith('image/'));
  if (nonImageAttachments.length === 0) return null;

  return (
    <Flexbox gap={6} style={{ marginBottom: marginBottom ? 8 : 0 }}>
      {nonImageAttachments.map((item) => {
        const Icon = iconForMime(item.mime_type);
        const downloadUrl = item.url || item.previewUrl;
        return (
          <Flexbox
            key={item.cid}
            horizontal
            align="center"
            gap={8}
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 8,
              padding: '8px 10px',
              background: token.colorFillQuaternary,
              minWidth: 180,
              maxWidth: 280,
              cursor: downloadUrl ? 'pointer' : 'default',
            }}
            onClick={() => {
              if (downloadUrl) window.open(downloadUrl, '_blank');
            }}
          >
            <Icon size={18} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
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
      })}
    </Flexbox>
  );
}
