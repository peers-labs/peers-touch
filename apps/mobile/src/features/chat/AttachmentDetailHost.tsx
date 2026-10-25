import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Modal } from '@lobehub/ui';
import {
  chatFilePreviewKind,
  formatChatAttachmentSize,
  mountChatAttachmentPreview,
  setChatFilePreviewUnavailable,
} from '@peers-touch/client-chat-core';
import { useMobileI18n } from '../../app/mobileI18n';
import {
  AttachmentAccessState,
  AttachmentFileAction,
  AttachmentFileActionState,
} from '../../gen/proto/domain/chat/attachment_pb';
import { mobileAttachmentAccess } from '../../runtimes/attachmentAccess';
import { useMobileAttachmentAccess } from './MessageAttachment';
import './attachmentDetail.css';

export function AttachmentDetailHost() {
  const id = useSyncExternalStore(mobileAttachmentAccess.subscribeSelection, mobileAttachmentAccess.selectedId);
  useEffect(() => () => mobileAttachmentAccess.close(), []);
  return id ? <AttachmentDetail key={id} id={id} /> : null;
}

function AttachmentDetail({ id }: { id: string }) {
  const { t } = useMobileI18n();
  const { projection, error } = useMobileAttachmentAccess(id);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const metadata = mobileAttachmentAccess.selectedMetadata();
  const filename = projection?.filename || metadata?.filename || t('chat.attachment.unnamed');
  const mimeType = projection?.mimeType || metadata?.mimeType;
  const size = projection?.plaintextSize ?? metadata?.size;
  const state = projection?.state;
  const ready = state === AttachmentAccessState.READY && Boolean(projection?.assetUrl);
  const pending = state === AttachmentAccessState.DOWNLOADING || state === AttachmentAccessState.VERIFYING;
  const kind = chatFilePreviewKind({ filename, mimeType, size });
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
      const result = await mobileAttachmentAccess.perform(id, intent);
      if (result) setFeedback(result.state === AttachmentFileActionState.COMPLETED ? 'completed'
        : result.state === AttachmentFileActionState.CANCELLED ? 'actionCancelled'
          : result.state === AttachmentFileActionState.UNAVAILABLE ? 'actionUnavailable' : 'actionFailed');
    } catch {
      setFeedback('actionFailed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open className="mobile-chat-file-modal" title={filename} width="100%"
      footer={null} destroyOnHidden onCancel={mobileAttachmentAccess.close}>
      <div className="mobile-chat-file-detail" data-chat-file-detail={id}
        data-chat-file-name={filename} data-chat-file-type={mimeType || ''}
        data-chat-file-size={String(size ?? '')}>
        <div className="mobile-chat-file-metadata">
          <span>{mimeType || t('chat.attachment.file')}</span>
          <span>{formatChatAttachmentSize(size)}</span>
          <span role="status" data-chat-file-state={stateKey}>{t(`chat.attachment.${stateKey}`)}</span>
        </div>
        {projection?.errorCode ? <div role="alert">{t(`chat.attachment.transferError.${projection.errorCode}`)}</div> : null}
        {pending && total > 0 ? (
          <div className="mobile-chat-file-transfer">
            <progress value={transferred} max={total} aria-label={t('chat.attachment.downloading')} />
            <span>{formatChatAttachmentSize(transferred)} / {formatChatAttachmentSize(total)}</span>
          </div>
        ) : null}
        <div className="mobile-chat-file-preview">
          {ready && projection ? <AttachmentPreview url={projection.assetUrl} kind={kind}
            size={Number(projection.plaintextSize)} filename={filename} /> : <span>{t(`chat.attachment.${stateKey}`)}</span>}
        </div>
        <div className="mobile-chat-file-actions">
          {pending ? <Button data-chat-file-action="cancel" onClick={() => void mobileAttachmentAccess.cancel(id)}>{t('chat.attachment.cancelDownload')}</Button> : null}
          {error || projection?.retryable || state === AttachmentAccessState.CANCELLED ? <Button data-chat-file-action="retry" onClick={() => void mobileAttachmentAccess.retry(id)}>{t('chat.attachment.retry')}</Button> : null}
          {ready && ['office', 'pdf', 'image'].includes(kind) ? <Button data-chat-file-action="preview" disabled={busy} onClick={() => void action(AttachmentFileAction.PREVIEW)}>{t('chat.attachment.preview')}</Button> : null}
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
  const { t } = useMobileI18n();
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
      }, abort.signal).catch(() => {
        if (!abort.signal.aborted) setChatFilePreviewUnavailable(element, t('chat.attachment.previewUnavailable'));
      });
    }
    return () => abort.abort();
  }, [url, size, kind, filename, t]);
  return <div className="chat-file-preview-resource" ref={container} />;
}
