import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Button, Modal } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { theme } from 'antd';
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
  const [busy, setBusy] = useState(false);
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
  const total = Number(projection?.transferTotalBytes ?? 0);
  const transferred = Number(projection?.transferredBytes ?? 0);
  const stateKey = error || state === AttachmentAccessState.FAILED ? 'failed'
    : state === AttachmentAccessState.CANCELLED ? 'cancelled'
      : state === AttachmentAccessState.VERIFYING ? 'verifying'
        : pending ? 'downloading' : ready ? 'ready' : 'preparing';
  const action = async (intent: AttachmentFileAction) => {
    setBusy(true);
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
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={<span className="chat-file-title" title={filename}>{filename}</span>}
      className="chat-file-modal"
      width={1040}
      centered
      styles={{
        body: { maxHeight: 'none', overflow: 'hidden', padding: '0 16px 16px' },
        header: { justifyContent: 'flex-start' },
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
        <div className="chat-file-metadata">
          <span title={mimeType}>{fileType}</span>
          <span>{formatChatAttachmentSize(size)}</span>
          <span role="status" data-chat-file-state={stateKey}>{t(`chat.attachment.${stateKey}`)}</span>
        </div>
        {projection?.errorCode ? <div role="alert">{t(`chat.attachment.transferError.${projection.errorCode}`)}</div> : null}
        {pending && total > 0 ? (
          <div className="chat-file-transfer">
            <progress value={transferred} max={total} aria-label={t('chat.attachment.downloading')} />
            <span>{formatChatAttachmentSize(transferred)} / {formatChatAttachmentSize(total)}</span>
          </div>
        ) : null}
        <div className="chat-file-preview">
          {ready && src ? (
            <AttachmentPreview url={src} kind={kind} size={Number(size ?? 0)} filename={filename} />
          ) : <span>{t(`chat.attachment.${stateKey}`)}</span>}
        </div>
        <div className="chat-file-actions">
          {pending ? <Button data-chat-file-action="cancel" onClick={() => void messagingAttachmentAccess.cancel(id)}>{t('chat.attachment.cancelDownload')}</Button> : null}
          {error || projection?.retryable || state === AttachmentAccessState.CANCELLED ? (
            <Button data-chat-file-action="retry" onClick={() => void messagingAttachmentAccess.retry(id)}>{t('chat.attachment.retry')}</Button>
          ) : null}
          {ready && ['office', 'pdf', 'image'].includes(kind) ? (
            <Button data-chat-file-action="preview" disabled={busy} onClick={() => void action(AttachmentFileAction.PREVIEW)}>{t('chat.attachment.systemPreview')}</Button>
          ) : null}
          <Button data-chat-file-action="open-external" disabled={!ready || busy} onClick={() => void action(AttachmentFileAction.OPEN_EXTERNAL)}>{t('chat.attachment.openExternal')}</Button>
          <Button data-chat-file-action="save-copy" type="primary" disabled={!ready || busy} onClick={() => void action(AttachmentFileAction.SAVE_COPY)}>{t('chat.attachment.saveCopy')}</Button>
        </div>
        {feedback ? <div role="status" data-chat-file-action-result={feedback}>{t(`chat.attachment.${feedback}`)}</div> : null}
      </div>
    </Modal>
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
