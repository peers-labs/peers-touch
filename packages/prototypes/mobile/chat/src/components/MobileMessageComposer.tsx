import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { Camera, FileText, Image as ImageIcon, Paperclip, Send, Smile, X } from 'lucide-react';
import { FULL_EMOJI_GRID } from '../types';
import { useDismissableLayer } from './useDismissableLayer';

export interface MobileComposerAttachment {
  kind: 'image' | 'file';
  name: string;
  size: string;
  previewUrl?: string;
}

export function MobileMessageComposer({
  value, onChange, onSend, placeholder, state, allowAttachments = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (attachment?: MobileComposerAttachment) => void;
  placeholder: string;
  state?: string;
  allowAttachments?: boolean;
}) {
  const [panel, setPanel] = useState<'emoji' | 'attachment' | null>(null);
  const [attachment, setAttachment] = useState<MobileComposerAttachment | null>(null);
  const inputRef = useRef<TextAreaRef>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ownedPreviewRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const closePanel = useCallback(() => setPanel(null), []);

  useDismissableLayer({
    open: panel !== null,
    containerRef: panelRef,
    insideRefs: [attachmentButtonRef, emojiButtonRef],
    onDismiss: closePanel,
    dismissOnWindowBlur: true,
  });

  useEffect(() => {
    if (allowAttachments) return;
    setPanel((current) => current === 'attachment' ? null : current);
    if (ownedPreviewRef.current) URL.revokeObjectURL(ownedPreviewRef.current);
    ownedPreviewRef.current = null;
    setAttachment(null);
  }, [allowAttachments]);

  useEffect(() => {
    return () => {
      if (ownedPreviewRef.current) URL.revokeObjectURL(ownedPreviewRef.current);
    };
  }, []);

  const clearAttachment = () => {
    if (ownedPreviewRef.current) URL.revokeObjectURL(ownedPreviewRef.current);
    ownedPreviewRef.current = null;
    setAttachment(null);
  };

  const selectAttachment = (file: File | undefined, kind: MobileComposerAttachment['kind']) => {
    if (!file) return;
    clearAttachment();
    const previewUrl = kind === 'image' ? URL.createObjectURL(file) : undefined;
    ownedPreviewRef.current = previewUrl ?? null;
    setAttachment({
      kind,
      name: file.name,
      size: file.size < 1024 * 1024
        ? `${Math.max(1, Math.round(file.size / 1024))} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      previewUrl,
    });
    setPanel(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const insertEmoji = (emoji: string) => {
    const textarea = inputRef.current?.resizableTextArea?.textArea;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + emoji + value.slice(end));
    setPanel(null);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const submit = () => {
    if (!value.trim() && !attachment) return;
    onSend(attachment ?? undefined);
    ownedPreviewRef.current = null;
    setAttachment(null);
    setPanel(null);
  };

  return (
    <div className="mp-composer" data-thread-state={state}>
      <div className="mp-composer-dock" ref={dockRef}>
        {panel === 'emoji' && (
          <div ref={panelRef} className="mp-composer-emoji" role="dialog" aria-label="Emoji picker">
            {FULL_EMOJI_GRID.map((emoji, index) => (
              <button key={`${emoji}-${index}`} type="button" className="mp-composer-emoji-btn"
                aria-label={`Insert ${emoji}`} onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertEmoji(emoji)}>{emoji}</button>
            ))}
          </div>
        )}
        {panel === 'attachment' && (
          <div ref={panelRef} className="mp-composer-attachment-panel" role="dialog" aria-label="Attachment options">
            <button type="button" onClick={() => imageInputRef.current?.click()}>
              <ImageIcon size={20} /><span>Photo</span>
            </button>
            <button type="button" onClick={() => cameraInputRef.current?.click()}>
              <Camera size={20} /><span>Camera</span>
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              <FileText size={20} /><span>File</span>
            </button>
          </div>
        )}
        {attachment && (
          <div className="mp-composer-attachment-preview" data-composer-attachment={attachment.kind}>
            {attachment.kind === 'image' && attachment.previewUrl
              ? <img src={attachment.previewUrl} alt="" />
              : <FileText size={18} />}
            <span>
              <strong>{attachment.name}</strong>
              <small>{attachment.size}</small>
            </span>
            <button type="button" aria-label="Remove attachment" onClick={clearAttachment}><X size={16} /></button>
          </div>
        )}
        {allowAttachments && (
          <button ref={attachmentButtonRef} type="button" className="mp-composer-tool"
            aria-label="Attach" aria-pressed={panel === 'attachment'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPanel((current) => current === 'attachment' ? null : 'attachment')}>
            <Paperclip size={21} />
          </button>
        )}
        <input ref={imageInputRef} hidden type="file" accept="image/*" data-composer-attachment-input="image"
          onChange={(event) => {
            selectAttachment(event.target.files?.[0], 'image');
            event.target.value = '';
          }} />
        <input ref={cameraInputRef} hidden type="file" accept="image/*" capture="environment"
          data-composer-attachment-input="camera" onChange={(event) => {
            selectAttachment(event.target.files?.[0], 'image');
            event.target.value = '';
          }} />
        <input ref={fileInputRef} hidden type="file" data-composer-attachment-input="file"
          onChange={(event) => {
            selectAttachment(event.target.files?.[0], 'file');
            event.target.value = '';
          }} />
        <button ref={emojiButtonRef} type="button" className="mp-composer-tool"
          aria-label="Emoji" aria-pressed={panel === 'emoji'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setPanel((current) => current === 'emoji' ? null : 'emoji')}>
          <Smile size={22} />
        </button>
        <Input.TextArea ref={inputRef} className="mp-composer-input" aria-label="Message"
          value={value} placeholder={placeholder} autoSize={{ minRows: 1, maxRows: 4 }}
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onPressEnter={(event) => {
            if (!event.shiftKey && !composingRef.current
              && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault();
              submit();
            }
          }} />
        <button type="button" className={`mp-composer-send ${value.trim() || attachment ? 'active' : ''}`}
          aria-label="Send" disabled={!value.trim() && !attachment} onClick={submit}><Send size={18} /></button>
      </div>
    </div>
  );
}
