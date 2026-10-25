import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Typography } from 'antd';
import { File } from 'lucide-react';
import copy from '../../../../../locales/en/chat.json';

export function AttachmentCard({ file }: { file: { name: string; size: string } }) {
  const [detailState, setDetailState] = useState<'closed' | 'open' | 'closing'>('closed');
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
      setDetailState('open');
      setFeedback('');
      if (status === 'remote') setStatus('downloading');
    }}>
      <span className="mp-file-icon"><File size={22} /></span>
      <span className="mp-file-info">
        <Typography.Text strong className="mp-file-name">{file.name}</Typography.Text>
        <Typography.Text type="secondary" className="mp-file-size">{file.size}</Typography.Text>
      </span>
    </button>
    {detailState !== 'closed' ? <Modal open={detailState === 'open'} title={file.name} footer={null} width="100%" destroyOnHidden
      getContainer={() => trigger.current?.closest('.mp-device') as HTMLElement ?? document.body}
      style={{ top: 0, margin: 0, paddingBottom: 0, maxWidth: '100%' }}
      onCancel={() => setDetailState('closing')}
      afterClose={() => setDetailState('closed')} styles={{
        root: { position: 'absolute', inset: 0 },
        mask: { position: 'absolute' },
        wrapper: { position: 'absolute', paddingTop: 44 },
        body: { minHeight: '65dvh', paddingBottom: 'env(safe-area-inset-bottom)' },
      }}>
      <div data-chat-file-detail={file.name} style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        <span>{file.size} · {copy[`chat.attachment.${label}`]}</span>
        {status === 'downloading' ? <progress value={progress} max={100} aria-label={copy['chat.attachment.downloading']} style={{ width: '100%' }} /> : null}
        <div style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
          {copy[status === 'ready' ? 'chat.attachment.previewUnavailable' : status === 'cancelled' ? 'chat.attachment.cancelled' : 'chat.attachment.preparing']}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {status === 'downloading' ? <Button style={{ minHeight: 44 }} onClick={() => setStatus('cancelled')}>{copy['chat.attachment.cancelDownload']}</Button> : null}
          {status === 'cancelled' ? <Button style={{ minHeight: 44 }} onClick={() => setStatus('downloading')}>{copy['chat.attachment.retry']}</Button> : null}
          <Button style={{ minHeight: 44 }} disabled={status !== 'ready'} onClick={() => setFeedback(copy['chat.attachment.actionUnavailable'])}>{copy['chat.attachment.preview']}</Button>
          <Button style={{ minHeight: 44 }} disabled={status !== 'ready'} onClick={() => setFeedback(copy['chat.attachment.actionUnavailable'])}>{copy['chat.attachment.openExternal']}</Button>
          <Button style={{ minHeight: 44 }} type="primary" disabled={status !== 'ready'} onClick={() => setFeedback(copy['chat.attachment.actionCancelled'])}>{copy['chat.attachment.saveCopy']}</Button>
        </div>
        {feedback ? <span role="status">{feedback}</span> : null}
      </div>
    </Modal> : null}
  </>;
}
