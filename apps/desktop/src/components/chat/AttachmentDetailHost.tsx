import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog, IconButton, Tooltip as PtTooltip } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
import {
  chatAttachmentFileType,
  chatFilePreviewKind,
  formatChatAttachmentSize,
  mountChatAttachmentPreview,
  setChatFilePreviewUnavailable,
} from '@peers-touch/client-chat-core';
import {
  AttachmentAccessState,
  AttachmentFileAction,
  AttachmentFileActionState,
} from '../../gen/proto/domain/chat/attachment_pb';
import { messagingAttachmentAccess } from '../../messaging/attachmentAccess';
import { useAttachmentAccess } from './useAttachmentAccess';
import './attachmentDetail.css';

export function AttachmentDetailHost() {
  const id = useSyncExternalStore(
    messagingAttachmentAccess.subscribeSelection,
    messagingAttachmentAccess.selectedId,
  );
  useEffect(() => () => messagingAttachmentAccess.close(), []);
  return id ? <AttachmentDetail key={id} id={id} /> : null;
}

function AttachmentDetail({ id }: { id: string }) {
  const { t } = useTranslation('chat');
  const { projection, error, src } = useAttachmentAccess({ cid: id });
  const [busy, setBusy] = useState<AttachmentFileAction | null>(null);
  const [feedback, setFeedback] = useState('');
  const metadata = messagingAttachmentAccess.selectedMetadata();
  const filename = projection?.filename || metadata?.filename || t('chat.attachment.unnamed');
  const mimeType = projection?.mimeType || metadata?.mimeType;
  const size = projection?.plaintextSize ?? metadata?.size;
  const state = projection?.state;
  const ready = state === AttachmentAccessState.READY && Boolean(src);
  const pending = state === AttachmentAccessState.DOWNLOADING || state === AttachmentAccessState.VERIFYING;
  const kind = chatFilePreviewKind({
    filename, mimeType, size,
  });
  const fileType = chatAttachmentFileType({ filename, mimeType }) || t('chat.attachment.file');
  const failed = error || state === AttachmentAccessState.FAILED;
  const cancelled = state === AttachmentAccessState.CANCELLED;

  const run = async (intent: AttachmentFileAction) => {
    setBusy(intent);
    setFeedback('');
    try {
      const result = await messagingAttachmentAccess.perform(id, intent);
      if (result) {
        setFeedback(result.state === AttachmentFileActionState.COMPLETED ? 'completed'
          : result.state === AttachmentFileActionState.CANCELLED ? 'actionCancelled'
            : result.state === AttachmentFileActionState.UNAVAILABLE ? 'actionUnavailable' : 'actionFailed');
      }
    } catch {
      setFeedback('actionFailed');
    } finally {
      setBusy(null);
    }
  };

  const canPreview = ready && ['office', 'pdf', 'image'].includes(kind);
  const header = (
    <div className="chat-file-header">
      <div className="chat-file-heading">
        <span className="chat-file-title" title={filename}>{filename}</span>
        <span className="chat-file-subtitle">
          {fileType}{typeof size === 'number' && Number.isFinite(size) ? ` · ${formatChatAttachmentSize(size)}` : ''}
        </span>
      </div>
      <div className="chat-file-header-actions">
        {pending ? (
          <span className="chat-file-progress-status">
            <LoaderCircle size={15} className="chat-file-spin" aria-hidden="true" />
            <DownloadProgress projection={projection} />
          </span>
        ) : null}
        <span className="chat-file-state" data-chat-file-state={
          error || state === AttachmentAccessState.FAILED ? 'failed'
            : state === AttachmentAccessState.CANCELLED ? 'cancelled'
              : state === AttachmentAccessState.VERIFYING ? 'verifying'
                : pending ? 'downloading' : ready ? 'ready' : 'preparing'
        }>
          {t(`chat.attachment.${
            error || state === AttachmentAccessState.FAILED ? 'failed'
              : cancelled ? 'cancelled'
                : state === AttachmentAccessState.VERIFYING ? 'verifying'
                  : pending ? 'downloading' : ready ? 'ready' : 'preparing'
          }`)}
        </span>
        {pending ? (
          <HeaderIcon
            action="cancel"
            iconId="error"
            label={t('chat.attachment.cancelDownload')}
            onClick={() => void messagingAttachmentAccess.cancel(id)}
          />
        ) : null}
        {failed || projection?.retryable || cancelled ? (
          <HeaderIcon
            action="retry"
            iconId="refresh-cw"
            label={t('chat.attachment.retry')}
            disabled={busy !== null}
            onClick={() => void messagingAttachmentAccess.retry(id)}
          />
        ) : null}
        {canPreview ? (
          <HeaderIcon
            action="preview"
            iconId="eye"
            label={t('chat.attachment.systemPreview')}
            disabled={busy !== null}
            onClick={() => void run(AttachmentFileAction.PREVIEW)}
          />
        ) : null}
        <HeaderIcon
          action="open-external"
          iconId="external-link"
          label={t('chat.attachment.openExternal')}
          disabled={!ready || busy !== null}
          onClick={() => void run(AttachmentFileAction.OPEN_EXTERNAL)}
        />
        <HeaderIcon
          action="save-copy"
          iconId="download"
          label={t('chat.attachment.saveCopy')}
          primary
          disabled={!ready || busy !== null}
          pending={busy === AttachmentFileAction.SAVE_COPY}
          onClick={() => void run(AttachmentFileAction.SAVE_COPY)}
        />
      </div>
    </div>
  );

  return (
    <Dialog
      open
      title={header}
      className="chat-file-modal"
      width={1040}
      footer={null}
      onDismiss={messagingAttachmentAccess.close}
    >
      <div className="chat-file-detail" data-chat-file-detail={id}
        data-chat-file-name={filename} data-chat-file-type={mimeType || ''}
        data-chat-file-size={String(size ?? '')}>
        {projection?.errorCode ? <div className="chat-file-error" role="alert">{t(`chat.attachment.transferError.${projection.errorCode}`)}</div> : null}
        {pending ? <FileTransferProgress projection={projection} /> : null}
        <div className="chat-file-preview">
          {ready && src ? (
            <AttachmentPreview url={src} kind={kind} size={Number(size ?? 0)} filename={filename} />
          ) : <span className="chat-file-placeholder"><LoaderCircle size={18} className="chat-file-spin" aria-hidden="true" />{t(`chat.attachment.${error ? 'failed' : 'preparing'}`)}</span>}
        </div>
        {feedback ? <div className="chat-file-feedback" role="status" data-chat-file-action-result={feedback}>{t(`chat.attachment.${feedback}`)}</div> : null}
      </div>
    </Dialog>
  );
}

function FileTransferProgress({ projection }: { projection: ReturnType<typeof useAttachmentAccess>['projection'] }) {
  const total = Number(projection?.transferTotalBytes ?? 0);
  const transferred = Number(projection?.transferredBytes ?? 0);
  return (
    <div className="chat-file-transfer">
      <progress value={transferred} max={total} aria-label="download" />
    </div>
  );
}

function DownloadProgress({ projection }: { projection: ReturnType<typeof useAttachmentAccess>['projection'] }) {
  const total = Number(projection?.transferTotalBytes ?? 0);
  const transferred = Number(projection?.transferredBytes ?? 0);
  if (total <= 0) return null;
  return (
    <span className="chat-file-progress-numbers" title={`${formatChatAttachmentSize(transferred)} / ${formatChatAttachmentSize(total)}`}>
      {Math.round((transferred / total) * 100)}%
    </span>
  );
}

function HeaderIcon({
  label, onClick, disabled, primary, action, iconId, pending,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  action?: string;
  iconId: Parameters<typeof IconButton>[0]['iconId'];
  pending?: boolean;
}) {
  return (
    <PtTooltip label={label}>
      <IconButton
        actionId={`chat-file-${action ?? 'action'}`}
        iconId={iconId}
        iconSize={17}
        className={`chat-file-header-icon${primary ? ' chat-file-header-icon-primary' : ''}`}
        label={label}
        emphasis={primary ? 'primary' : 'quiet'}
        execution={pending ? 'pending' : 'idle'}
        availability={disabled ? { kind: 'disabled', reason: label } : undefined}
        onActivate={onClick}
        data-chat-file-action={action}
      />
    </PtTooltip>
  );
}

function AttachmentPreview({ url, kind, size, filename }: {
  url: string; kind: ReturnType<typeof chatFilePreviewKind>; size: number; filename: string;
}) {
  const { t } = useTranslation('chat');
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    const element = container.current;
    if (element) {
      void mountChatAttachmentPreview(element, url, kind, size, filename, {
        preparing: t('chat.attachment.preparing'),
        unavailable: t('chat.attachment.previewUnavailable'),
        previousPage: t('chat.attachment.previousPage'),
        nextPage: t('chat.attachment.nextPage'),
        page: (page, total) => t('chat.attachment.page', { page, total }),
        sheet: t('chat.attachment.sheet'),
        previousColumns: t('chat.attachment.previousColumns'),
        nextColumns: t('chat.attachment.nextColumns'),
        columns: (page, total) => t('chat.attachment.columns', { page, total }),
        resourceUnavailable: t('chat.attachment.resourceUnavailable'),
        zoom: t('chat.attachment.zoom'),
        fitPage: t('chat.attachment.fitPage'),
        fitWidth: t('chat.attachment.fitWidth'),
        actualSize: t('chat.attachment.actualSize'),
        cellRange: (range) => t('chat.attachment.cellRange', { range }),
      }, abort.signal).catch(() => {
        if (!abort.signal.aborted) setChatFilePreviewUnavailable(element, t('chat.attachment.previewUnavailable'));
      });
    }
    return () => abort.abort();
  }, [url, size, kind, filename, t]);
  return <div className="chat-file-preview-resource" ref={container} />;
}
