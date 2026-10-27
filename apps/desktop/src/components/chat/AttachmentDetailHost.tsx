import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Modal } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { theme, Tooltip } from 'antd';
import {
  Download,
  ExternalLink,
  Eye,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
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
  const { token } = theme.useToken();
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
            label={t('chat.attachment.cancelDownload')}
            onClick={() => void messagingAttachmentAccess.cancel(id)}
          >
            <XCircle size={17} />
          </HeaderIcon>
        ) : null}
        {failed || projection?.retryable || cancelled ? (
          <HeaderIcon
            action="retry"
            label={t('chat.attachment.retry')}
            disabled={busy !== null}
            onClick={() => void messagingAttachmentAccess.retry(id)}
          >
            <RefreshCw size={17} />
          </HeaderIcon>
        ) : null}
        {canPreview ? (
          <HeaderIcon
            action="preview"
            label={t('chat.attachment.systemPreview')}
            disabled={busy !== null}
            onClick={() => void run(AttachmentFileAction.PREVIEW)}
          >
            <Eye size={17} />
          </HeaderIcon>
        ) : null}
        <HeaderIcon
          action="open-external"
          label={t('chat.attachment.openExternal')}
          disabled={!ready || busy !== null}
          onClick={() => void run(AttachmentFileAction.OPEN_EXTERNAL)}
        >
          <ExternalLink size={17} />
        </HeaderIcon>
        <HeaderIcon
          action="save-copy"
          label={t('chat.attachment.saveCopy')}
          primary
          disabled={!ready || busy !== null}
          onClick={() => void run(AttachmentFileAction.SAVE_COPY)}
        >
          {busy === AttachmentFileAction.SAVE_COPY
            ? <LoaderCircle size={17} className="chat-file-spin" />
            : <Download size={17} />}
        </HeaderIcon>
      </div>
    </div>
  );

  return (
    <Modal
      open
      title={header}
      className="chat-file-modal"
      width={1040}
      centered
      styles={{
        body: { maxHeight: 'none', overflow: 'hidden', padding: '0 16px 16px' },
        header: { justifyContent: 'flex-start', padding: '10px 12px 8px' },
      }}
      footer={null}
      destroyOnHidden
      onCancel={messagingAttachmentAccess.close}
    >
      <div className="chat-file-detail" data-chat-file-detail={id}
        style={{
          '--chat-preview-text': token.colorText,
          '--chat-preview-secondary': token.colorTextSecondary,
          '--chat-preview-border': token.colorBorderSecondary,
          '--chat-preview-surface': token.colorBgContainer,
          '--chat-preview-canvas': token.colorFillQuaternary,
          '--chat-preview-hover': token.colorFillTertiary,
          '--chat-preview-accent': token.colorPrimary,
        } as CSSProperties}
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
    </Modal>
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
  label, onClick, disabled, primary, action, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  action?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip title={label}>
      <button
        type="button"
        className={`chat-file-header-icon${primary ? ' chat-file-header-icon-primary' : ''}`}
        aria-label={label}
        title={label}
        disabled={disabled}
        data-chat-file-action={action}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
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
