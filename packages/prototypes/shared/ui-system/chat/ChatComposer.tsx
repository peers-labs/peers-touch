/**
 * Increment 13 — rich composer. Replaces the inline textarea/send block with
 * the full social composer anatomy: emoji panel with recent emojis, local
 * attachment drafts (pick/paste/drop), image-only screenshot picker (the
 * desktop shell captures the screen; the browser shell selects an image
 * file), real MediaRecorder voice notes, and input expand/collapse.
 */
import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import {
  FolderOpen, Maximize2, Mic, Minimize2, Scissors, Smile, Square, Trash2, X,
} from 'lucide-react';
import { Alert, IconButton, Popover, TextArea } from '@peers-touch/ui';
import type { MessageAttachment } from './chat-data';
import { AttachmentDraftStrip, useAttachmentDrafts } from './ComposerAttachments';
import { formatVoiceDuration, useVoiceRecorder, VoicePlayer, type RecordedVoice } from './VoiceNote';

const EMOJI_RECENT_KEY = 'peers-touch:prototype:recent-emojis';
const EMOJI_GROUPS = [
  ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '😭', '😡'],
  ['👍', '👎', '👏', '🙏', '💪', '🤝', '👌', '✌️', '🤟', '👋'],
  ['❤️', '💔', '💕', '💯', '✨', '🔥', '🎉', '🌹', '⭐', '💤'],
  ['😅', '😇', '🙂', '🙃', '😉', '😌', '😋', '🤔', '🤫', '😴'],
];

function loadRecentEmojis(): string[] {
  try {
    const raw = window.localStorage.getItem(EMOJI_RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export type ComposerPayload = {
  text: string;
  attachments: MessageAttachment[];
  voice: RecordedVoice | null;
  replyTo?: { who: string; text: string };
};

export function ChatComposer({ groupMembers, replyTarget, placeholder, onCancelReply, onSend }: {
  groupMembers?: { name: string }[];
  replyTarget?: { who: string; text: string } | null;
  placeholder: string;
  onCancelReply?: () => void;
  onSend: (payload: ComposerPayload) => void;
}) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [voiceError, setVoiceError] = useState<'denied' | 'unsupported' | null>(null);
  const [recordedVoice, setRecordedVoice] = useState<RecordedVoice | null>(null);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(loadRecentEmojis);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shotInputRef = useRef<HTMLInputElement>(null);

  const { drafts, ready, uploading, failed, addFiles, removeDraft, retryDraft, clearDrafts } =
    useAttachmentDrafts();

  const recorder = useVoiceRecorder(
    voice => {
      setRecordedVoice(voice);
      setVoiceError(null);
    },
    reason => setVoiceError(reason),
  );

  const mentionTail = (() => {
    const at = draft.lastIndexOf('@');
    if (at < 0) return null;
    const tail = draft.slice(at + 1);
    if (tail.includes(' ')) return null;
    return tail;
  })();
  const mentionCandidates = mentionTail !== null && (groupMembers?.length ?? 0) > 0
    ? groupMembers!.filter(member => member.name.includes(mentionTail)).slice(0, 5)
    : [];

  const insertMention = (name: string) => {
    const at = draft.lastIndexOf('@');
    setDraft(`${draft.slice(0, at)}@${name} `);
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(`${draft.slice(0, start)}${emoji}${draft.slice(end)}`);
    const nextRecent = [emoji, ...recentEmojis.filter(item => item !== emoji)].slice(0, 24);
    setRecentEmojis(nextRecent);
    try {
      window.localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify(nextRecent));
    } catch {
      // best-effort UI preference
    }
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const resetComposer = () => {
    setDraft('');
    clearDrafts();
    setRecordedVoice(null);
  };

  const canSendText = draft.trim().length > 0 || ready.length > 0;
  const textBusy = uploading || failed;
  const sendEnabled = canSendText && !textBusy && !recorder.recording && !recordedVoice;

  const submitText = () => {
    if (!sendEnabled) return;
    onSend({
      text: draft.trim(),
      attachments: ready.map(({ id, kind, name, mime, size, previewUrl }) => ({
        id, kind, name, mime, size, previewUrl,
      })),
      voice: null,
    });
    resetComposer();
  };

  const submitVoice = () => {
    if (!recordedVoice) return;
    // The bubble keeps playing the same blob, so the URL is intentionally
    // NOT revoked here; only the discard path reclaims it.
    onSend({ text: '', attachments: [], voice: recordedVoice });
    resetComposer();
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const emojiPanel = (
    <div className="sk-emoji-panel" data-emoji-panel>
      {recentEmojis.length > 0 && (
        <div className="sk-emoji-group" data-emoji-recent>
          <span>最近使用</span>
          <div className="sk-emoji-grid">
            {recentEmojis.map(emoji => (
              <button key={`r-${emoji}`} type="button" className="sk-emoji-cell"
                aria-label={`插入 ${emoji}`} onClick={() => insertEmoji(emoji)}>{emoji}</button>
            ))}
          </div>
        </div>
      )}
      <div className="sk-emoji-group">
        <span>全部表情</span>
        <div className="sk-emoji-grid">
          {EMOJI_GROUPS.flat().map(emoji => (
            <button key={emoji} type="button" className="sk-emoji-cell"
              aria-label={`插入 ${emoji}`} onClick={() => insertEmoji(emoji)}>{emoji}</button>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className={`sk-composer-zone${dragging ? ' is-dragging' : ''}`}
      onDragOver={event => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}>
      {replyTarget && (
        <div className="sk-reply-bar" data-reply-bar>
          <div>
            <span>回复 {replyTarget.who}</span>
            <p>{replyTarget.text}</p>
          </div>
          <button type="button" className="sk-reply-cancel" aria-label="取消回复"
            onClick={onCancelReply}><X size={14} /></button>
        </div>
      )}

      {recorder.recording && (
        <div className="sk-voice-recording" data-voice-recording
          data-voice-seconds={recorder.recordingSeconds}>
          <span className="sk-voice-dot" />
          <span>录制中 {formatVoiceDuration(recorder.recordingSeconds)}</span>
          <span className="sk-voice-rec-actions">
            <button type="button" className="sk-voice-rec-cancel" data-voice-cancel
              onClick={recorder.cancel}><X size={13} />取消</button>
            <button type="button" className="sk-voice-rec-finish" data-voice-finish
              onClick={recorder.finish}><Square size={11} />完成</button>
          </span>
        </div>
      )}

      {recordedVoice && !recorder.recording && (
        <div className="sk-voice-draft" data-voice-draft="preview"
          data-voice-duration-ms={recordedVoice.durationSeconds * 1000}>
          <VoicePlayer url={recordedVoice.url} durationSeconds={recordedVoice.durationSeconds}
            variant="preview" />
          <button type="button" className="sk-voice-discard" aria-label="放弃语音"
            data-voice-discard onClick={() => {
              if (recordedVoice.url.startsWith('blob:')) URL.revokeObjectURL(recordedVoice.url);
              setRecordedVoice(null);
            }}><Trash2 size={14} /></button>
          <button type="button" className="sk-voice-send" data-voice-send
            onClick={submitVoice}>发送</button>
        </div>
      )}

      <AttachmentDraftStrip drafts={drafts} onRemove={removeDraft} onRetry={retryDraft} />

      {voiceError && (
        <Alert tone="danger" title="无法录音"
          description={voiceError === 'denied' ? '麦克风权限被拒绝，请在系统设置中允许。' : '当前环境不支持录音。'} />
      )}
      {failed && <Alert tone="danger" title="附件上传失败" description="请重试或移除失败的附件（本地示例）。" />}

      <div className="sk-composer">
        <div className="sk-composer-tools">
          <Popover placement="top" content={emojiPanel}>
            <button type="button" className="sk-composer-tool" aria-label="表情"
              data-composer-tool="emoji" disabled={!!recordedVoice}><Smile size={18} /></button>
          </Popover>
          <button type="button" className="sk-composer-tool" aria-label="添加文件附件"
            data-composer-tool="file"
            disabled={recorder.recording || !!recordedVoice}
            onClick={() => fileInputRef.current?.click()}><FolderOpen size={18} /></button>
          <button type="button" className="sk-composer-tool" aria-label="截图（浏览器原型选择图片文件）"
            title="桌面壳为屏幕捕获；浏览器原型选择图片文件"
            data-composer-tool="screenshot"
            disabled={recorder.recording || !!recordedVoice}
            onClick={() => shotInputRef.current?.click()}><Scissors size={18} /></button>
          <button type="button" className={`sk-composer-tool${recorder.recording ? ' is-recording' : ''}`}
            aria-label={recorder.recording ? '结束录音' : '语音消息'}
            data-composer-tool="voice" aria-pressed={recorder.recording}
            disabled={!!recordedVoice}
            onClick={() => {
              setVoiceError(null);
              if (recorder.recording) recorder.finish();
              else void recorder.start();
            }}><Mic size={18} /></button>
          <input ref={fileInputRef} type="file" multiple hidden data-file-kind="file"
            onChange={event => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }} />
          <input ref={shotInputRef} type="file" accept="image/*" hidden data-file-kind="screenshot"
            onChange={event => {
              addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }} />
        </div>

        <div className="sk-composer-input-wrap">
          {mentionCandidates.length > 0 && (
            <div className="sk-mention-pop" data-mention-pop>
              {mentionCandidates.map(member => (
                <button key={member.name} type="button" className="sk-mention-row"
                  data-mention-name={member.name} onClick={() => insertMention(member.name)}>
                  @{member.name}
                </button>
              ))}
            </div>
          )}
          <TextArea ref={textareaRef} framing="embedded" minimumRows={1}
            maximumRows={expanded ? 10 : 4}
            className="sk-composer-input" value={draft} aria-label="输入消息"
            data-composer-value={draft}
            onValueChange={setDraft}
            onEnter={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              event.preventDefault();
              submitText();
            }}
            onPaste={onPaste}
            disabled={recorder.recording || !!recordedVoice}
            placeholder={placeholder} />
        </div>

        <button type="button" className="sk-composer-tool sk-composer-expand"
          aria-label={expanded ? '收起输入框' : '展开输入框'} aria-pressed={expanded}
          data-composer-expand onClick={() => setExpanded(value => !value)}>
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <IconButton iconId="send" iconSize={16} label="发送消息" actionId="sk.send-message"
          emphasis="primary"
          availability={sendEnabled
            ? { kind: 'enabled' }
            : { kind: 'disabled', reason: uploading ? '附件上传中' : failed ? '存在失败附件' : '请输入消息或添加附件' }}
          onActivate={submitText} />
      </div>

      {dragging && <div className="sk-composer-drop-hint" data-drop-hint>松开以添加附件</div>}
    </div>
  );
}
