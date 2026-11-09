import { useEffect } from 'react';
import { Tooltip } from '@peers-touch/ui';
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
    <div className={`sc-msg-attachments${marginBottom ? ' has-margin' : ''}`}>
      {attachments.map((item) => (
        <MessageAttachmentItem key={item.cid} item={item} />
      ))}
    </div>
  );
}

function MessageAttachmentItem({ item }: { item: ChatComposerAttachment }) {
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

  const card = (
    <div
      className={`sc-msg-attachment${downloadUrl ? ' is-clickable' : ''}`}
      data-pt-agent-message-attachment={item.attachment?.attachment_id ?? item.cid}
      role={downloadUrl ? 'button' : undefined}
      tabIndex={downloadUrl ? 0 : undefined}
      aria-label={downloadUrl ? t('chat.input.attachmentDownload') : undefined}
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
          className="sc-msg-attachment__thumb"
          src={downloadUrl}
          alt={item.filename || t('chat.input.attachmentFallbackName')}
        />
      ) : (
        <Icon size={18} className="sc-msg-attachment__type-icon" />
      )}
      <div className="sc-msg-attachment__body">
        <span className="sc-msg-attachment__name">
          {item.filename || t('chat.input.attachmentFallbackName')}
        </span>
        <span className="sc-msg-attachment__size">{formatSize(item.size)}</span>
      </div>
      {downloadUrl && (
        <Download size={14} className="sc-msg-attachment__download" />
      )}
    </div>
  );

  if (!downloadUrl) return card;
  return (
    <Tooltip label={t('chat.input.attachmentDownload')}>
      {card}
    </Tooltip>
  );
}
