/**
 * Increment 13/18 — attachments rendered inside message bubbles plus the
 * local detail host.
 *
 * Images open an overlay with a real blob save. Generic files open a detail
 * dialog that mirrors the desktop AttachmentDetailHost transfer lifecycle:
 *   remote → downloading (progress, cancel) → cancelled (retry) → ready
 * Ready document files (pdf/docx/xlsx/txt/md) get a local-only preview with
 * page navigation, zoom and worksheet switching; system-open actions stay
 * honestly disabled in the browser shell. Every transfer targets a local
 * object URL — there is no ciphertext fetch in the prototype.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Download, ExternalLink, File as FileIcon, FileText, RotateCcw, X,
} from 'lucide-react';
import { Button, Dialog } from '@peers-touch/ui';
import type { MessageAttachment } from './chat-data';
import { formatAttachmentSize } from './ComposerAttachments';

type TransferState = 'remote' | 'downloading' | 'cancelled' | 'ready';

const DOCUMENT_RE = /\.(docx|xlsx?|pptx?|pdf|txt|md)$/i;
const WORKBOOK_RE = /\.xlsx?$/i;
const PAGE_RE = /\.(pdf|docx)$/i;
const TICK_MS = 250;

function saveLocally(attachment: MessageAttachment) {
  if (!attachment.previewUrl) return;
  const anchor = document.createElement('a');
  anchor.href = attachment.previewUrl;
  anchor.download = attachment.name;
  anchor.click();
}

function ImageDialog({ attachment, onClose }: {
  attachment: MessageAttachment;
  onClose: () => void;
}) {
  return (
    <Dialog open onDismiss={onClose} title={attachment.name} width={560} closeLabel="关闭"
      description={formatAttachmentSize(attachment.size)}
      footer={
        <>
          <Button emphasis="quiet" label="关闭" actionId="attach.image-close" onActivate={onClose} />
          <Button emphasis="primary" label="保存到本地" leading={<Download size={15} />}
            actionId="attach.image-save" onActivate={() => saveLocally(attachment)} />
        </>
      }>
      <div className="sk-attach-image-host" data-attach-overlay>
        {attachment.previewUrl
          ? <img className="sk-attach-image-img" src={attachment.previewUrl} alt={attachment.name} />
          : <div className="sk-attach-overlay-missing"><FileIcon size={28} /></div>}
      </div>
    </Dialog>
  );
}

function FileChip({ attachment, onOpen }: {
  attachment: MessageAttachment;
  onOpen: (attachment: MessageAttachment) => void;
}) {
  return (
    <button type="button" className="sk-file-chip" data-attach-file={attachment.id}
      onClick={() => onOpen(attachment)}>
      <span className="sk-file-chip-icon"><FileText size={16} /></span>
      <span className="sk-file-chip-meta">
        <strong title={attachment.name}>{attachment.name}</strong>
        <span>{formatAttachmentSize(attachment.size)}</span>
      </span>
      <ExternalLink size={14} className="sk-file-chip-open" />
    </button>
  );
}

/* ── File detail with transfer lifecycle ─────────────── */

function FileDetailDialog({ file, onClose }: {
  file: MessageAttachment;
  onClose: () => void;
}) {
  const [state, setState] = useState<TransferState>('remote');
  const [progress, setProgress] = useState(0);
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState('Report');
  const [zoom, setZoom] = useState('width');
  const [feedback, setFeedback] = useState('');
  const timerRef = useRef<number | null>(null);

  const isDocument = DOCUMENT_RE.test(file.name);
  const isWorkbook = WORKBOOK_RE.test(file.name);
  const hasZoom = PAGE_RE.test(file.name);
  const totalPages = 2;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startDownload = () => {
    setFeedback('');
    setState('downloading');
    setProgress(0);
    clearTimer();
    timerRef.current = window.setInterval(() => {
      setProgress(current => {
        const next = Math.min(100, current + 20);
        if (next === 100) {
          clearTimer();
          window.setTimeout(() => setState('ready'), 120);
        }
        return next;
      });
    }, TICK_MS);
  };

  // Auto-start the transfer when the dialog opens (desktop parity: select()
  // kicks downloading off for remote files).
  useEffect(() => {
    startDownload();
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const cancelDownload = () => {
    clearTimer();
    setState('cancelled');
  };

  const statusLabel = {
    remote: '准备下载…',
    downloading: '下载中…',
    cancelled: '下载已取消',
    ready: '已下载',
  }[state];

  const unavailable = () => {
    setFeedback('没有可用于打开此文件的应用（浏览器原型）');
    window.setTimeout(() => setFeedback(''), 2200);
  };

  return (
    <Dialog open onDismiss={onClose} title={file.name} width={760} closeLabel="关闭"
      description={`${file.mime || '未知类型'} · ${formatAttachmentSize(file.size)} · ${statusLabel}`}
      footer={
        <div className="sk-file-detail-footer">
          {state === 'downloading' && (
            <Button emphasis="quiet" label="取消下载" leading={<X size={14} />}
              actionId="attach.download-cancel" onActivate={cancelDownload} />
          )}
          {state === 'cancelled' && (
            <Button emphasis="quiet" label="重新下载" leading={<RotateCcw size={14} />}
              actionId="attach.download-retry" onActivate={startDownload} />
          )}
          <Button emphasis="quiet" label="系统预览" actionId="attach.system-preview"
            availability={state === 'ready' ? undefined : { kind: 'disabled', reason: '下载完成后可用' }}
            onActivate={unavailable} />
          <Button emphasis="quiet" label="用其他应用打开" actionId="attach.open-with"
            availability={state === 'ready' ? undefined : { kind: 'disabled', reason: '下载完成后可用' }}
            onActivate={unavailable} />
          <Button emphasis="primary" label="保存副本" leading={<Download size={14} />}
            actionId="attach.save-copy"
            availability={state === 'ready' ? undefined : { kind: 'disabled', reason: '下载完成后可用' }}
            onActivate={() => saveLocally(file)} />
        </div>
      }>
      <div className="sk-file-detail" data-attach-detail={file.id} data-transfer-state={state}>
        {state === 'downloading' && (
          <div className="sk-file-progress" data-downloading>
            <progress value={progress} max={100} aria-label="下载进度" />
            <span>{progress}%</span>
          </div>
        )}

        {state === 'ready' && isDocument ? (
          <div className="sk-doc-preview" data-document-preview data-workbook={isWorkbook ? 'true' : 'false'}>
            <div className="sk-doc-toolbar">
              {isWorkbook && (
                <label className="sk-doc-field">
                  工作表
                  <select aria-label="工作表" value={sheet} data-doc-sheet
                    onChange={event => { setSheet(event.target.value); setPage(1); }}>
                    <option>Report</option>
                    <option>Summary</option>
                  </select>
                </label>
              )}
              {hasZoom && (
                <label className="sk-doc-field">
                  缩放
                  <select aria-label="缩放" value={zoom} data-doc-zoom
                    onChange={event => setZoom(event.target.value)}>
                    <option value="width">适合宽度</option>
                    <option value="page">适合整页</option>
                    <option value="actual">实际大小</option>
                  </select>
                </label>
              )}
            </div>
            <div className="sk-doc-pager">
              <Button emphasis="quiet" density="compact" label="上一页" actionId="attach.doc-prev"
                availability={page === 1 ? { kind: 'disabled', reason: '已是第一页' } : undefined}
                onActivate={() => setPage(value => Math.max(1, value - 1))} />
              <span role="status" data-doc-page>第 {page} / {totalPages} 页</span>
              <Button emphasis="quiet" density="compact" label="下一页" actionId="attach.doc-next"
                availability={page === totalPages ? { kind: 'disabled', reason: '已是最后一页' } : undefined}
                onActivate={() => setPage(value => Math.min(totalPages, value + 1))} />
            </div>
            <div className={`sk-doc-canvas sk-doc-zoom-${zoom}`} data-doc-canvas>
              {isWorkbook ? (
                <table aria-label={sheet}>
                  <caption>{sheet} · 单元格 {page === 1 ? 'A1:B2' : 'A101:B102'}</caption>
                  <thead><tr><th />{['A', 'B'].map(col => <th key={col} scope="col">{col}</th>)}</tr></thead>
                  <tbody>
                    {(page === 1
                      ? [['101', 'Design review', 'Ready'], ['102', 'Release review', 'Scheduled']]
                      : [['201', 'Risk review', 'Closed'], ['202', 'Retro notes', 'Draft']]
                    ).map(([row, a, b]) => (
                      <tr key={row}><th scope="row">{row}</th><td>{a}</td><td>{b}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <>
                  <h3>{file.name}</h3>
                  {page === 1 ? (
                    <>
                      <p>设计评审 · 第 1 页</p>
                      <p>本地原型仅演示文档详情的分页/缩放交互，不解析真实文件内容。</p>
                    </>
                  ) : (
                    <>
                      <p>设计评审 · 第 2 页</p>
                      <p>密文下载与系统应用打开随桌面壳接线（UNPROVEN）。</p>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="sk-file-empty" data-preview-unavailable={state === 'ready' ? 'true' : undefined}>
            <FileIcon size={26} />
            <p>
              {state === 'ready'
                ? '该文件类型没有可内嵌的预览；保存副本后可用系统应用打开。'
                : state === 'cancelled' ? '下载已取消，可重新下载。' : '准备文件…'}
            </p>
          </div>
        )}

        {feedback && <span className="sk-file-feedback" role="status" data-feedback>{feedback}</span>}
      </div>
    </Dialog>
  );
}

export function MessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  const [image, setImage] = useState<MessageAttachment | null>(null);
  const [file, setFile] = useState<MessageAttachment | null>(null);
  const images = attachments.filter(item => item.kind === 'image');
  const files = attachments.filter(item => item.kind === 'file');

  return (
    <div className="sk-msg-attachments" data-attachment-count={attachments.length}>
      {images.length > 0 && (
        <div className="sk-msg-images" data-image-count={images.length}>
          {images.map(attachment => (
            <button key={attachment.id} type="button" className="sk-msg-image"
              data-attach-image={attachment.id} onClick={() => setImage(attachment)}>
              {attachment.previewUrl
                ? <img src={attachment.previewUrl} alt={attachment.name} />
                : <FileIcon size={22} />}
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="sk-msg-files">
          {files.map(attachment => (
            <FileChip key={attachment.id} attachment={attachment} onOpen={setFile} />
          ))}
        </div>
      )}

      {image && <ImageDialog attachment={image} onClose={() => setImage(null)} />}
      {file && <FileDetailDialog file={file} onClose={() => setFile(null)} />}
    </div>
  );
}
