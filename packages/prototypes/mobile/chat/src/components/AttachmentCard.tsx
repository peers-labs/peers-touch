import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '@peers-touch/ui';
import copy from '../../../../../locales/en/chat.json';
import { AttachmentPreview } from './AttachmentPreview';

export function AttachmentCard({ file }: { file: { name: string; size: string } }) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'remote' | 'downloading' | 'cancelled' | 'ready'>('remote');
  const [feedback, setFeedback] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (status !== 'downloading') return;
    const timer = window.setInterval(() => setProgress((value) => Math.min(100, value + 20)), 400);
    return () => window.clearInterval(timer);
  }, [status]);
  useEffect(() => { if (progress === 100) setStatus('ready'); }, [progress]);
  const label = status === 'remote' ? 'remote' : status;
  return <>
    <button ref={trigger} type="button" className="mp-message-file" onClick={() => {
      setOpen(true);
      setFeedback('');
      if (status === 'remote') setStatus('downloading');
    }}>
      <span className="mp-file-icon"><Icon iconId="file" size={22} /></span>
      <span className="mp-file-info">
        <strong className="mp-file-name">{file.name}</strong>
        <span className="mp-file-size">{file.size}</span>
      </span>
    </button>
    {open ? (
      <div className="mp-file-detail-overlay" role="dialog" aria-modal="true" aria-label={file.name}
        data-chat-file-detail={file.name}>
        <header className="mp-file-detail-header">
          <Button actionId="file-detail.close" emphasis="quiet" leading={<Icon iconId="close" size={16} />}
            onActivate={() => setOpen(false)}>Close</Button>
          <strong>{file.name}</strong>
          <span />
        </header>
        <div className="mp-file-detail-body">
          <span className="mp-file-detail-meta">{file.size} · {copy[`chat.attachment.${label}`]}</span>
          {status === 'downloading' ? <progress value={progress} max={100} aria-label={copy['chat.attachment.downloading']} style={{ width: '100%' }} /> : null}
          <div className="mp-file-detail-preview">
            {status === 'ready' ? <AttachmentPreview key={file.name} filename={file.name} />
              : copy[status === 'cancelled' ? 'chat.attachment.cancelled' : 'chat.attachment.preparing']}
          </div>
          <div className="mp-file-detail-actions">
            {status === 'downloading' ? <Button actionId="file-detail.cancel" onActivate={() => setStatus('cancelled')}>{copy['chat.attachment.cancelDownload']}</Button> : null}
            {status === 'cancelled' ? <Button actionId="file-detail.retry" onActivate={() => setStatus('downloading')}>{copy['chat.attachment.retry']}</Button> : null}
            <Button actionId="file-detail.system-preview"
              availability={status !== 'ready' ? { kind: 'disabled', reason: copy['chat.attachment.preparing'] } : undefined}
              onActivate={() => setFeedback(copy['chat.attachment.actionUnavailable'])}>{copy['chat.attachment.systemPreview']}</Button>
            <Button actionId="file-detail.open-external"
              availability={status !== 'ready' ? { kind: 'disabled', reason: copy['chat.attachment.preparing'] } : undefined}
              onActivate={() => setFeedback(copy['chat.attachment.actionUnavailable'])}>{copy['chat.attachment.openExternal']}</Button>
            <Button actionId="file-detail.save" emphasis="primary"
              availability={status !== 'ready' ? { kind: 'disabled', reason: copy['chat.attachment.preparing'] } : undefined}
              onActivate={() => setFeedback(copy['chat.attachment.actionCancelled'])}>{copy['chat.attachment.saveCopy']}</Button>
          </div>
          {feedback ? <span role="status">{feedback}</span> : null}
        </div>
      </div>
    ) : null}
  </>;
}
