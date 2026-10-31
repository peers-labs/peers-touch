/**
 * Increment 13 — rich composer. Replaces the inline textarea/send block with
 * the full social composer anatomy: emoji panel with recent emojis, local
 * attachment drafts (pick/paste/drop), image-only screenshot picker (the
 * desktop shell captures the screen; the browser shell selects an image
 * file), real MediaRecorder voice notes, and input expand/collapse.
 */
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import {
  FolderOpen, Maximize2, Mic, Minimize2, Scissors, Smile, Square, Trash2, X,
} from 'lucide-react';
import { Alert, IconButton, Popover, TextArea } from '@peers-touch/ui';
import type { MessageAttachment } from './chat-data';
import { AttachmentDraftStrip, useAttachmentDrafts } from './ComposerAttachments';
import { formatVoiceDuration, useVoiceRecorder, VoicePlayer, type RecordedVoice } from './VoiceNote';
import { useT } from '../prefs';

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
  editId?: string;
};

export function ChatComposer({ groupMembers, replyTarget, editTarget, placeholder, onCancelReply, onCancelEdit, onSend }: {
  groupMembers?: { name: string }[];
  replyTarget?: { who: string; text: string } | null;
  editTarget?: { id: string; text: string } | null;
  placeholder: string;
  onCancelReply?: () => void;
  onCancelEdit?: () => void;
  onSend: (payload: ComposerPayload) => void;
}) {
  const { t } = useT();
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

  // Seed the textarea when entering edit mode (parent owns the target).
  useEffect(() => {
    if (editTarget) {
      setDraft(editTarget.text);
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        const el = textareaRef.current;
        if (el) el.setSelectionRange(el.value.length, el.value.length);
      });
    }
  }, [editTarget]);

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
  const sendEnabled = editTarget
    ? draft.trim().length > 0 && draft.trim() !== editTarget.text
    : canSendText && !textBusy && !recorder.recording && !recordedVoice;

  const submitText = () => {
    if (!sendEnabled) return;
    if (editTarget) {
      onSend({ text: draft.trim(), attachments: [], voice: null, editId: editTarget.id });
      setDraft('');
      return;
    }
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
          <span>{t('composer.emojiRecent')}</span>
          <div className="sk-emoji-grid">
            {recentEmojis.map(emoji => (
              <button key={`r-${emoji}`} type="button" className="sk-emoji-cell"
                aria-label={t('composer.emojiInsert', { emoji })} onClick={() => insertEmoji(emoji)}>{emoji}</button>
            ))}
          </div>
        </div>
      )}
      <div className="sk-emoji-group">
        <span>{t('composer.emojiAll')}</span>
        <div className="sk-emoji-grid">
          {EMOJI_GROUPS.flat().map(emoji => (
            <button key={emoji} type="button" className="sk-emoji-cell"
              aria-label={t('composer.emojiInsert', { emoji })} onClick={() => insertEmoji(emoji)}>{emoji}</button>
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
      {editTarget ? (
        <div className="sk-reply-bar sk-edit-bar" data-edit-banner>
          <div>
            <span>{t('composer.editBanner')}</span>
            <p>{editTarget.text}</p>
          </div>
          <button type="button" className="sk-reply-cancel" aria-label={t('composer.cancelEdit')}
            onClick={() => { setDraft(''); onCancelEdit?.(); }}><X size={14} /></button>
        </div>
      ) : replyTarget && (
        <div className="sk-reply-bar" data-reply-bar>
          <div>
            <span>{t('composer.replyBanner', { who: replyTarget.who })}</span>
            <p>{replyTarget.text}</p>
          </div>
          <button type="button" className="sk-reply-cancel" aria-label={t('composer.cancelReply')}
            onClick={onCancelReply}><X size={14} /></button>
        </div>
      )}

      {recorder.recording && (
        <div className="sk-voice-recording" data-voice-recording
          data-voice-seconds={recorder.recordingSeconds}>
          <span className="sk-voice-dot" />
          <span>{t('composer.recording', { time: formatVoiceDuration(recorder.recordingSeconds) })}</span>
          <span className="sk-voice-rec-actions">
            <button type="button" className="sk-voice-rec-cancel" data-voice-cancel
              onClick={recorder.cancel}><X size={13} />{t('composer.recCancel')}</button>
            <button type="button" className="sk-voice-rec-finish" data-voice-finish
              onClick={recorder.finish}><Square size={11} />{t('composer.recFinish')}</button>
          </span>
        </div>
      )}

      {recordedVoice && !recorder.recording && (
        <div className="sk-voice-draft" data-voice-draft="preview"
          data-voice-duration-ms={recordedVoice.durationSeconds * 1000}>
          <VoicePlayer url={recordedVoice.url} durationSeconds={recordedVoice.durationSeconds}
            variant="preview" />
          <button type="button" className="sk-voice-discard" aria-label={t('composer.discardVoice')}
            data-voice-discard onClick={() => {
              if (recordedVoice.url.startsWith('blob:')) URL.revokeObjectURL(recordedVoice.url);
              setRecordedVoice(null);
            }}><Trash2 size={14} /></button>
          <button type="button" className="sk-voice-send" data-voice-send
            onClick={submitVoice}>{t('composer.sendShort')}</button>
        </div>
      )}

      <AttachmentDraftStrip drafts={drafts} onRemove={removeDraft} onRetry={retryDraft} />

      {voiceError && (
        <Alert tone="danger" title={t('composer.voiceErrorTitle')}
          description={voiceError === 'denied' ? t('composer.voiceDenied') : t('composer.voiceUnsupported')} />
      )}
      {failed && <Alert tone="danger" title={t('composer.attachFailedTitle')} description={t('composer.attachFailedBody')} />}

      <div className="sk-composer" data-composer-mode={editTarget ? 'editing' : 'compose'}>
        <div className="sk-composer-tools">
          <Popover placement="top" content={emojiPanel}>
            <button type="button" className="sk-composer-tool" aria-label={t('composer.emoji')}
              data-composer-tool="emoji" disabled={!!recordedVoice || !!editTarget}><Smile size={18} /></button>
          </Popover>
          <button type="button" className="sk-composer-tool" aria-label={t('composer.attachFile')}
            data-composer-tool="file"
            disabled={recorder.recording || !!recordedVoice || !!editTarget}
            onClick={() => fileInputRef.current?.click()}><FolderOpen size={18} /></button>
          <button type="button" className="sk-composer-tool" aria-label={t('composer.screenshot')}
            title={t('composer.screenshotTitle')}
            data-composer-tool="screenshot"
            disabled={recorder.recording || !!recordedVoice || !!editTarget}
            onClick={() => shotInputRef.current?.click()}><Scissors size={18} /></button>
          <button type="button" className={`sk-composer-tool${recorder.recording ? ' is-recording' : ''}`}
            aria-label={recorder.recording ? t('composer.voiceStop') : t('composer.voice')}
            data-composer-tool="voice" aria-pressed={recorder.recording}
            disabled={!!recordedVoice || !!editTarget}
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
            className="sk-composer-input" value={draft} aria-label={t('composer.inputAria')}
            data-composer-value={draft}
            onValueChange={setDraft}
            onEnter={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              event.preventDefault();
              submitText();
            }}
            onPaste={onPaste}
            disabled={recorder.recording || !!recordedVoice}
            placeholder={editTarget ? t('composer.editPlaceholder') : placeholder} />
        </div>

        {!editTarget && (
          <button type="button" className="sk-composer-tool sk-composer-expand"
            aria-label={expanded ? t('composer.collapse') : t('composer.expand')} aria-pressed={expanded}
            data-composer-expand onClick={() => setExpanded(value => !value)}>
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}
        <IconButton iconId="send" iconSize={16} label={editTarget ? t('composer.saveEdit') : t('composer.sendLabel')}
          actionId="sk.send-message"
          emphasis="primary"
          data-edit-send={editTarget ? 'true' : undefined}
          availability={sendEnabled
            ? { kind: 'enabled' }
            : { kind: 'disabled',
                reason: editTarget ? t('composer.reasonUnchanged')
                  : uploading ? t('composer.reasonUploading') : failed ? t('composer.reasonFailed') : t('composer.reasonEmpty') } }
          onActivate={submitText} />
      </div>

      {dragging && <div className="sk-composer-drop-hint" data-drop-hint>{t('composer.dropHint')}</div>}
    </div>
  );
}
