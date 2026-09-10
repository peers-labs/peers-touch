import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { FileText, Image, Video, Music, X, RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { Progress, theme, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';

import type { AgentAttachmentDraft } from './useAgentAttachmentDrafts';

interface AttachmentStageProps {
  drafts: AgentAttachmentDraft[];
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
}

/** Returns the appropriate icon component for a given MIME type. */
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
 * Renders staged file attachment previews above the textarea.
 * Each draft shows a type icon, filename, size, progress (if uploading),
 * status indicator, and a remove button.
 */
export function AttachmentStage({ drafts, onRemove, onRetry }: AttachmentStageProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation(['chat', 'agent']);

  if (drafts.length === 0) return null;

  return (
    <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
      {drafts.map((draft) => {
        const Icon = iconForMime(draft.mimeType);
        const isUploadFailed = draft.status === 'failed';
        const isRejected = draft.status === 'rejected';
        const isFailed = isUploadFailed || isRejected;
        const isUploading = draft.status === 'uploading';
        const attachmentId = draft.attachment?.attachment_id ?? draft.id;

        return (
          <Flexbox
            key={draft.id}
            data-pt-agent-composer-attachment={attachmentId}
            data-pt-agent-composer-attachment-object-ref={draft.attachment?.object_ref}
            data-pt-agent-composer-attachment-status={draft.status}
            horizontal
            align="center"
            gap={6}
            style={{
              maxWidth: 260,
              padding: '5px 8px 5px 10px',
              borderRadius: 8,
              background: isFailed ? token.colorErrorBg : token.colorFillQuaternary,
              border: isFailed ? `1px solid ${token.colorErrorBorder}` : '1px solid transparent',
              opacity: isUploading ? 0.85 : 1,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Type icon or preview thumbnail */}
            {draft.previewUrl ? (
              <img
                src={draft.previewUrl}
                alt={draft.name}
                style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <span style={{ color: isFailed ? token.colorError : token.colorTextSecondary, flexShrink: 0 }}>
                {isFailed ? <AlertCircle size={16} /> : isUploading ? <Loader2 size={16} className="agent-upload-spin" /> : <Icon size={16} />}
              </span>
            )}

            {/* Name + size */}
            <Flexbox style={{ minWidth: 0, flex: 1 }}>
              <span
                style={{
                  fontSize: 12,
                  color: isFailed ? token.colorError : token.colorText,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {draft.name}
              </span>
              <span style={{ fontSize: 10, color: token.colorTextTertiary }}>
                {isUploading
                  ? t('chat.input.attachmentUploading')
                  : isRejected
                    ? t(
                        draft.error || 'agent.errors.attachmentRejected',
                        { ns: 'agent' },
                      )
                    : isUploadFailed
                    ? t('chat.input.attachmentUploadFailed')
                    : formatSize(draft.size)}
              </span>
            </Flexbox>

            {/* Retry button for failed uploads */}
            {isUploadFailed && onRetry && (
              <Tooltip title={t('chat.input.attachmentRetry')}>
                <ActionIcon
                  icon={RotateCcw}
                  size="small"
                  onClick={() => onRetry(draft.id)}
                />
              </Tooltip>
            )}

            {/* Remove button */}
            <ActionIcon
              data-pt-agent-composer-attachment-remove={attachmentId}
              icon={X}
              size="small"
              aria-label={t('chat.input.attachmentRemove')}
              title={t('chat.input.attachmentRemove')}
              onClick={() => onRemove(draft.id)}
            />

            {/* Upload progress bar */}
            {isUploading && (
              <Progress
                percent={draft.progress}
                showInfo={false}
                size="small"
                status="active"
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  margin: 0,
                  lineHeight: 0,
                }}
                strokeColor={token.colorPrimary}
              />
            )}
          </Flexbox>
        );
      })}
      <style>
        {'.agent-upload-spin{animation:agent-upload-spin 1s linear infinite}@keyframes agent-upload-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'}
      </style>
    </Flexbox>
  );
}
