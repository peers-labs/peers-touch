/**
 * Increment 13 — attachments rendered inside message bubbles plus the local
 * detail host. Images open an overlay lightbox with a real blob download;
 * generic files open a detail dialog with metadata and a save action. There
 * is no remote attachment source in the prototype, so every action targets a
 * local object URL rather than pretending to fetch ciphertext.
 */
import { useState } from 'react';
import { Download, ExternalLink, File as FileIcon } from 'lucide-react';
import { Button, Dialog } from '@peers-touch/ui';
import type { MessageAttachment } from './chat-data';
import { formatAttachmentSize } from './ComposerAttachments';

function downloadFor(attachment: MessageAttachment): string {
  return attachment.previewUrl ?? '#';
}

function saveLocally(attachment: MessageAttachment) {
  const anchor = document.createElement('a');
  anchor.href = downloadFor(attachment);
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
      <span className="sk-file-chip-icon"><FileIcon size={16} /></span>
      <span className="sk-file-chip-meta">
        <strong title={attachment.name}>{attachment.name}</strong>
        <span>{formatAttachmentSize(attachment.size)}</span>
      </span>
      <ExternalLink size={14} className="sk-file-chip-open" />
    </button>
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
      <Dialog open={!!file} onDismiss={() => setFile(null)} title={file?.name ?? '文件详情'}
        width={420} closeLabel="关闭"
        description={file ? `${file.mime || '未知类型'} · ${formatAttachmentSize(file.size)}` : ''}
        footer={
          <>
            <Button emphasis="quiet" label="关闭" actionId="attach.file-close"
              onActivate={() => setFile(null)} />
            <Button emphasis="primary" label="保存到本地" leading={<Download size={15} />}
              actionId="attach.file-save"
              onActivate={() => file && saveLocally(file)} />
          </>
        }>
        <div className="sk-file-detail" data-attach-detail={file?.id ?? ''}>
          <FileIcon size={26} />
          <p>浏览器原型内仅支持保存本地副本；系统级打开与密文下载随桌面壳接线。</p>
        </div>
      </Dialog>
    </div>
  );
}
