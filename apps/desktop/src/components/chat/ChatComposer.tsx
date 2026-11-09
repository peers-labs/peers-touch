import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button as PtButton,
  Icon,
  IconButton,
  Popover as PtPopover,
  TextArea,
  Tooltip as PtTooltip,
} from '@peers-touch/ui';
import {
  AlertCircle,
  File as FileIcon,
  FolderOpen,
  Image,
  Loader2,
  Maximize2,
  Minimize2,
  Mic,
  RotateCcw,
  Scissors,
  Smile,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  canSubmitChatComposerDraft,
  chatMediaKindFromMimeFilename,
  chatMessageTypeForAttachments,
  formatChatAttachmentSize,
  resolveChatComposerCapabilities,
  shouldSendComposerEnter,
  type ChatComposerCapabilities,
} from '@peers-touch/client-chat-core';

import { log } from '../../utils/logger';
import { imServiceV1 } from '../../services/im-service';
import { RustCommandException } from '../../services/desktop_api';
import type { MessagingLocalAttachmentIntent } from '../../services/im-service-contract';
import {
  useChatAttachmentDrafts,
  type ChatDraftAttachment,
} from './composer/useChatAttachmentDrafts';
import { didQueueExpectedChatAttachments } from './composer/sendOutcome';
import { useChatScreenshotCapture } from './composer/useChatScreenshotCapture';
import { useChatVoiceRecorder } from './composer/useChatVoiceRecorder';
import { useActiveChatSettingsSlice } from './useActiveSocialChatStore';
import { useSocialChatStore } from '../../store/socialChat';
import { formatChatScreenshotShortcut } from '../../utils/chatScreenshotShortcut';
import { formatMediaDurationSeconds } from '../../utils/mediaDisplay';
import {
  markTextInputIntent,
  markTextInputVisible,
  scheduleAfterPaint,
} from '../../kernel/frontendRuntimeProfiler';
import {
  DESKTOP_CHAT_COMPOSER_CAPABILITIES_MAIN,
  desktopChatLayoutForSurface,
  desktopChatVisualCssVars,
  type DesktopChatVisualSurface,
} from './chatPresentationPolicy';
import { notifyError } from '../../ui/feedback';

export type { ChatComposerCapabilities } from '@peers-touch/client-chat-core';

const EMOJI_RECENT_STORAGE_KEY = 'peers-touch:chat:composer:recent-emojis';

const DEFAULT_EMOJI_GROUPS = [
  ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '😭', '😡'],
  ['👍', '👎', '👏', '🙏', '💪', '🤝', '👌', '✌️', '🤟', '👋'],
  ['❤️', '💔', '💕', '💯', '✨', '🔥', '🎉', '🌹', '⭐', '💤'],
  ['😅', '😇', '🙂', '🙃', '😉', '😌', '😋', '🤔', '🤫', '😴'],
] as const;

export interface ChatComposerDraft {
  text: string;
  attachments: MessagingLocalAttachmentIntent[];
  messageType?: number;
}

interface ChatComposerProps {
  activeConversationId: string;
  capabilities?: ChatComposerCapabilities;
  disabled?: boolean;
  editing: boolean;
  surfaceBackground?: string;
  /**
   * Seed text for a fresh composer mount. The component owns its text
   * state afterwards; conversation/edit switches must remount it via
   * React `key` so typing never re-renders the message list.
   */
  initialValue?: string;
  /**
   * Lazy seed for a fresh non-editing mount (e.g. a per-conversation draft
   * read from a non-reactive store). Called once in the state initializer so
   * the parent never reads mutable draft storage during render.
   */
  initialDraft?: () => string;
  /** Live, mount-stable text sink (draft persistence + typing pulses). */
  onDraftChange?: (value: string) => void;
  onBlurInput: () => void;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  /** Return false to keep the draft text after a failed send. */
  onSend: (draft: ChatComposerDraft) => Promise<boolean | void>;
  placeholder?: string;
  replyPreview?: string;
  replyPreviewKey?: string | null;
  visualSurface?: DesktopChatVisualSurface;
  editPreview?: string;
  sending: boolean;
}

interface RecordedVoiceDraft {
  file: File;
  durationSeconds: number;
  previewUrl: string;
}

function loadRecentEmojis(): string[] {
  try {
    const raw = window.localStorage.getItem(EMOJI_RECENT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecentEmojis(emojis: string[]): void {
  try {
    window.localStorage.setItem(EMOJI_RECENT_STORAGE_KEY, JSON.stringify(emojis.slice(0, 24)));
  } catch {
    // Best-effort UI preference.
  }
}

function fileIconForMime(mimeType: string) {
  const kind = chatMediaKindFromMimeFilename(mimeType);
  if (kind === 'image') return Image;
  if (kind === 'video') return Video;
  return FileIcon;
}

export function ChatComposer({
  activeConversationId,
  capabilities,
  disabled = false,
  editing,
  surfaceBackground,
  initialValue,
  initialDraft,
  onDraftChange,
  onBlurInput,
  onCancelEdit,
  onCancelReply,
  onSend,
  placeholder,
  replyPreview,
  replyPreviewKey,
  visualSurface = 'desktop-main',
  editPreview,
  sending,
}: ChatComposerProps) {
  const { t } = useTranslation('chat');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);
  // Text state lives inside the composer so each keystroke re-renders only
  // this subtree. The parent remounts the composer (React key) when the
  // conversation or edit target changes and reads drafts through
  // onDraftChange / onSend, never through a controlled value prop.
  const [value, setValue] = useState<string>(() => (
    editing ? (initialValue ?? '') : (initialDraft?.() ?? initialValue ?? '')
  ));
  const onDraftChangeRef = useRef(onDraftChange);
  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);
  const commitValue = useCallback((next: string) => {
    setValue(next);
    onDraftChangeRef.current?.(next);
  }, []);
  const [dragging, setDragging] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [voiceSending, setVoiceSending] = useState(false);
  const [recordedVoice, setRecordedVoice] = useState<RecordedVoiceDraft | null>(null);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => loadRecentEmojis());
  const screenshotShortcut = useActiveChatSettingsSlice((state) => state.chatScreenshotShortcut);
  const latestSendOutcome = useSocialChatStore(
    (state) => state.sendOutcomes[activeConversationId],
  );
  const activeCapabilities = resolveChatComposerCapabilities(
    DESKTOP_CHAT_COMPOSER_CAPABILITIES_MAIN,
    capabilities,
  );
  const visualLayout = desktopChatLayoutForSurface(visualSurface);
  const handleTextInputObserved = (event: FormEvent<HTMLTextAreaElement>) => {
    const nextValue = event.currentTarget.value;
    const target = `chat-composer:${activeConversationId || 'none'}`;
    const interactionId = markTextInputIntent(target, {
      conversationId: activeConversationId,
      pageId: 'chat',
      valueLength: nextValue.length,
    });
    if (!interactionId) return;

    scheduleAfterPaint(() => {
      if (textareaRef.current?.value !== nextValue) return;
      markTextInputVisible(target, interactionId, {
        conversationId: activeConversationId,
        pageId: 'chat',
        valueLength: nextValue.length,
      });
    });
  };
  const {
    drafts,
    readyAttachments,
    uploading,
    failed,
    addFiles,
    appendPickedAttachment,
    appendReadyAttachment,
    clearDrafts,
    removeDraft,
    retryDraft,
  } = useChatAttachmentDrafts({
    conversationId: activeConversationId,
    disabled,
    editing,
    fallbackName: t('chat.social.composer.attachmentFallbackName'),
    onUploadFailed: () => notifyError(t('chat.social.composer.uploadFailed')),
  });
  const discardRecordedVoice = useCallback(() => {
    setRecordedVoice(null);
  }, []);

  const sendRecordedVoice = async (draft: RecordedVoiceDraft) => {
    if (disabled || editing || sending || voiceSending) return;
    setVoiceSending(true);
    let stagedPath: string | undefined;
    try {
      stagedPath = await imServiceV1.messaging.stageAttachmentSource(
        draft.file.name,
        new Uint8Array(await draft.file.arrayBuffer()),
      );
      const attachment: MessagingLocalAttachmentIntent = {
        filePath: stagedPath,
        filename: draft.file.name,
        mimeType: draft.file.type || 'audio/webm',
        contentKind: 'voice_note',
        durationMs: Math.max(1, Math.round(draft.durationSeconds * 1000)),
      };
      await onSend({
        text: '',
        attachments: [attachment],
        messageType: chatMessageTypeForAttachments([attachment]),
      });
      setRecordedVoice((current) => current?.previewUrl === draft.previewUrl ? null : current);
    } catch (error) {
      if (stagedPath) {
        await imServiceV1.messaging.discardAttachmentSource(stagedPath).catch((discardError) => {
          log.warn('chat', 'discard failed voice attachment source', discardError);
        });
      }
      log.error('chat', 'voice message send failed', error);
      notifyError(t('chat.social.composer.voiceSendFailed'));
    } finally {
      setVoiceSending(false);
    }
  };

  const {
    recording,
    recordingSeconds,
    startRecording,
    stopRecording,
  } = useChatVoiceRecorder({
    disabled: disabled || sending || voiceSending,
    editing,
    onRecorded: (file, durationSeconds) => {
      setRecordedVoice({
        file,
        durationSeconds,
        previewUrl: URL.createObjectURL(file),
      });
    },
    onDenied: () => notifyError(t('chat.social.composer.voiceDenied')),
    onUnsupported: () => notifyError(t('chat.social.composer.voiceUnsupported')),
  });
  const { captureScreenshot, capturing } = useChatScreenshotCapture({
    conversationId: activeConversationId,
    disabled,
    editing,
    enabled: activeCapabilities.screenshot,
    onCaptured: appendReadyAttachment,
    onFailed: (reason) => notifyError(
      reason === 'capture_permission_or_display_failed'
        ? t('chat.social.composer.screenshotPermissionFailed')
        : t('chat.social.composer.screenshotFailed'),
    ),
  });

  const canSend = !disabled
    && !sending
    && !voiceSending
    && !recordedVoice
    && !uploading
    && !failed
    && canSubmitChatComposerDraft({
      text: value,
      attachmentCount: readyAttachments.length,
      capabilities: activeCapabilities,
    });
  const composerShellBorder = dragging ? '1px solid var(--pt-borderStrong)' : '1px solid transparent';

  useEffect(() => {
    setEmojiOpen(false);
    setInputExpanded(false);
    setRecordedVoice(null);
  }, [activeConversationId]);

  useEffect(() => () => {
    if (recordedVoice) URL.revokeObjectURL(recordedVoice.previewUrl);
  }, [recordedVoice]);

  const handlePickAttachment = async () => {
    if (disabled || editing || recording || voiceSending) return;
    try {
      appendPickedAttachment(await imServiceV1.messaging.pickAttachmentSource());
    } catch (error) {
      if (error instanceof RustCommandException && error.code === 'INVALID_ARGUMENT') return;
      log.error('chat', 'native attachment picker failed', error);
      notifyError(t('chat.social.composer.uploadFailed'));
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of Array.from(event.clipboardData?.items ?? [])) {
      if (!item.type.startsWith('image/') && !item.type.startsWith('video/')) continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!disabled && !editing) setDragging(true);
  };

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const nextValue = value.slice(0, start) + emoji + value.slice(end);
    commitValue(nextValue);
    const nextRecent = [emoji, ...recentEmojis.filter((item) => item !== emoji)].slice(0, 24);
    setRecentEmojis(nextRecent);
    saveRecentEmojis(nextRecent);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
    setEmojiOpen(false);
  };

  const emojiPanel = (
    <div className="sc-emoji-panel">
      {recentEmojis.length > 0 && (
        <div className="sc-emoji-panel__group">
          <span className="sc-emoji-panel__label">{t('chat.social.composer.emojiRecent')}</span>
          <div className="sc-emoji-panel__grid">
            {recentEmojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="sc-emoji-panel__item"
                aria-label={t('chat.social.composer.emojiInsert')}
                onClick={() => insertEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="sc-emoji-panel__group">
        <span className="sc-emoji-panel__label">{t('chat.social.composer.emojiAll')}</span>
        <div className="sc-emoji-panel__grid">
          {DEFAULT_EMOJI_GROUPS.flat().map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="sc-emoji-panel__item"
              aria-label={t('chat.social.composer.emojiInsert')}
              onClick={() => insertEmoji(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
      <div className="sc-emoji-panel__footer">
        <Smile size={18} />
        <span>{t('chat.social.composer.emoji')}</span>
      </div>
    </div>
  );

  const submit = async () => {
    if (!canSend) return;
    const messageType = chatMessageTypeForAttachments(readyAttachments);
    const previousOutcomeRevision = useSocialChatStore.getState()
      .sendOutcomes[activeConversationId]?.revision ?? 0;
    // The parent owns send/edit side effects and decides whether the
    // draft text survives (it returns false on failure).
    const sent = await onSend({
      text: value.trim(),
      attachments: readyAttachments,
      messageType,
    });
    if (sent === false) return;
    commitValue('');
    if (
      readyAttachments.length === 0
      || didQueueExpectedChatAttachments(
        previousOutcomeRevision,
        readyAttachments.length,
        useSocialChatStore.getState().sendOutcomes[activeConversationId],
      )
    ) {
      clearDrafts(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent;
    if (!shouldSendComposerEnter({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: composingRef.current,
      nativeIsComposing: native.isComposing,
      keyCode: native.keyCode,
      lastCompositionEndAt: lastCompositionEndRef.current,
    })) {
      return;
    }
    event.preventDefault();
    submit().catch((error) => {
      log.error('chat', 'composer send failed', error);
    });
  };

  const renderDraftIcon = (item: ChatDraftAttachment) => {
    // Prototype .sk-draft-thumb stages icons at 20px inside the 44px tile.
    if (item.status === 'uploading') return <Loader2 size={20} className="chat-composer-spin" />;
    if (item.status === 'failed') return <AlertCircle size={20} />;
    const Icon = fileIconForMime(item.mimeType);
    return <Icon size={20} />;
  };

  const renderDraftLabels = (item: ChatDraftAttachment) => {
    const kind = chatMediaKindFromMimeFilename(item.mimeType, item.name);
    const durationLabel = formatMediaDurationSeconds(item.durationSeconds);
    const sizeLabel = formatChatAttachmentSize(item.size);
    if (kind === 'image') {
      return {
        primary: t('chat.social.messageArea.attachmentTypeImage'),
        secondary: sizeLabel,
      };
    }
    if (kind === 'audio') {
      return {
        primary: t('chat.social.messageArea.attachmentTypeAudio'),
        secondary: durationLabel || sizeLabel,
      };
    }
    return {
      primary: item.name,
      secondary: sizeLabel,
    };
  };

  const handleToggleInputExpanded = () => {
    setInputExpanded((expanded) => !expanded);
  };

  const banner = useMemo(() => {
    if (editing) {
      return {
        label: t('chat.social.composer.editing'),
        text: editPreview || value,
        action: onCancelEdit,
      };
    }
    if (replyPreview) {
      return {
        label: t('chat.social.messageArea.replyingTo'),
        text: replyPreview,
        action: onCancelReply,
      };
    }
    return null;
  }, [editPreview, editing, onCancelEdit, onCancelReply, replyPreview, replyPreviewKey, t, value]);
  const inputMinHeight = inputExpanded
    ? visualLayout.composerInputExpandedMinHeight
    : visualLayout.composerInputMinHeight;
  const inputMaxHeight = inputExpanded ? visualLayout.composerInputExpandedMaxHeight : 180;

  // North-star composer auto-grow (prototype sk-composer parity): the native
  // rows=1 box never grows on its own, so clamp its explicit height between the
  // CSS min/max contract from scrollHeight. Collapsed starts at one line and
  // grows with content; expand switches to the policy's large surface.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    const computed = window.getComputedStyle(element);
    const minHeight = Number.parseFloat(computed.minHeight) || 0;
    const maxHeight = Number.parseFloat(computed.maxHeight) || Number.POSITIVE_INFINITY;
    element.style.height = 'auto';
    const nextHeight = Math.min(Math.max(element.scrollHeight, minHeight), maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > maxHeight + 1 ? 'auto' : 'hidden';
  }, [value, inputExpanded, editing]);

  const toolUnavailable = (reason: string) => ({ kind: 'disabled' as const, reason });

  return (
    <div
      className={`sc-composer${visualSurface === 'desktop-thread' ? ' sc-composer--thread' : ''}`}
      data-chat-composer={activeConversationId}
      data-chat-send-outcome-revision={latestSendOutcome?.revision ?? 0}
      data-chat-send-outcome-state={latestSendOutcome?.outcome.state || ''}
      data-chat-send-outcome-message-id={latestSendOutcome?.outcome.messageId || ''}
      data-chat-send-outcome-attachment-count={latestSendOutcome?.outcome.attachmentCount ?? 0}
      data-chat-send-outcome-attachment-ids={latestSendOutcome?.outcome.attachmentIds.join(',') || ''}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        ...(desktopChatVisualCssVars(visualLayout) as CSSProperties),
        // The thread-surface footer padding/border is owned by
        // .sc-composer--thread (prototype .sk-thread-composer grammar).
        ...(visualSurface === 'desktop-thread'
          ? null
          : { padding: visualLayout.composerOuterPadding }),
        background: surfaceBackground ?? 'var(--pt-canvas)',
      }}
    >
      {dragging && (
        <div className="sc-composer__drop" data-chat-composer-drop>
          {t('chat.social.composer.dropHint')}
        </div>
      )}

      {banner && (
        <div className="sc-composer__banner">
          <div className="sc-composer__banner-body">
            <div className="sc-composer__banner-label">{banner.label}</div>
            <div className="sc-composer__banner-text">{banner.text}</div>
          </div>
          <PtButton
            actionId="composer-cancel-banner"
            className="sc-composer__banner-cancel"
            emphasis="quiet"
            density="compact"
            leading={<X size={14} />}
            aria-label={t('chat.social.messageArea.cancel')}
            onActivate={banner.action}
          />
        </div>
      )}

      {recording && (
        <div
          className="sc-composer__recording"
          data-chat-voice-recording
          data-chat-voice-recording-seconds={recordingSeconds}
        >
          <span className="sc-composer__recording-label">
            <span className="sc-composer__recording-dot" />
            {t('chat.social.composer.recording', { seconds: recordingSeconds })}
          </span>
          <span className="sc-composer__recording-actions">
            <PtButton
              actionId="voice-record-cancel"
              density="compact"
              leading={<X size={13} />}
              data-chat-voice-cancel
              onActivate={() => stopRecording(true)}
            >
              {t('chat.social.composer.cancelRecord')}
            </PtButton>
            <PtButton
              actionId="voice-record-finish"
              density="compact"
              emphasis="primary"
              leading={<Square size={13} />}
              data-chat-voice-finish
              onActivate={() => stopRecording(false)}
            >
              {t('chat.social.composer.finishRecord')}
            </PtButton>
          </span>
        </div>
      )}

      {recordedVoice && !recording && (
        <div
          className="sc-composer__voice-draft"
          data-chat-voice-draft="preview"
          data-chat-voice-duration-ms={Math.round(recordedVoice.durationSeconds * 1000)}
        >
          <audio
            controls
            data-chat-voice-preview
            preload="metadata"
            src={recordedVoice.previewUrl}
          />
          <span className="sc-composer__voice-duration">
            {formatMediaDurationSeconds(recordedVoice.durationSeconds)}
          </span>
          <PtTooltip label={t('chat.social.composer.discardVoice')}>
            <PtButton
              actionId="voice-discard"
              className="sc-composer__voice-discard"
              emphasis="quiet"
              density="compact"
              leading={<Trash2 size={14} />}
              aria-label={t('chat.social.composer.discardVoice')}
              data-chat-voice-discard
              onActivate={discardRecordedVoice}
              availability={voiceSending ? toolUnavailable(t('chat.social.composer.uploading')) : undefined}
            />
          </PtTooltip>
          <PtButton
            actionId="voice-send"
            className="sc-composer__voice-send"
            density="compact"
            emphasis="primary"
            leading={voiceSending
              ? <Loader2 size={14} className="chat-composer-spin" />
              : <Icon iconId="send" size={14} />}
            data-chat-voice-send
            onActivate={() => {
              void sendRecordedVoice(recordedVoice);
            }}
            availability={voiceSending ? toolUnavailable(t('chat.social.composer.uploading')) : undefined}
          >
            {t('chat.social.composer.sendVoice')}
          </PtButton>
        </div>
      )}

      {drafts.length > 0 && (
        <div className="sc-composer__drafts" data-chat-attachment-drafts={drafts.length}>
          {drafts.map((item) => {
            const labels = renderDraftLabels(item);
            return (
              <div
                key={item.id}
                className={`sc-composer__draft${item.status === 'failed' ? ' is-failed' : ''}`}
                data-chat-attachment-draft={item.id}
                data-chat-attachment-attempt={item.attempt}
                data-chat-attachment-status={item.status}
                data-chat-attachment-preview={item.previewUrl || ''}
              >
                <div className="sc-composer__draft-preview">
                  {item.previewUrl && item.mimeType.startsWith('image/') ? (
                    <img src={item.previewUrl} alt="" />
                  ) : item.previewUrl && item.mimeType.startsWith('video/') ? (
                    <video src={item.previewUrl} muted />
                  ) : (
                    renderDraftIcon(item)
                  )}
                  {item.status === 'uploading' && (
                    <span
                      className="sc-composer__draft-progress"
                      role="progressbar"
                      aria-label={t('chat.social.composer.uploading')}
                      data-chat-attachment-uploading
                    >
                      <span className="sc-composer__draft-progress-bar" />
                    </span>
                  )}
                </div>
                <div className="sc-composer__draft-meta">
                  <strong className="sc-composer__draft-primary">{labels.primary}</strong>
                  {labels.secondary && (
                    <span className="sc-composer__draft-secondary">{labels.secondary}</span>
                  )}
                </div>
                <div className="sc-composer__draft-actions">
                  {item.status === 'failed' && (
                    <PtTooltip label={t('chat.social.composer.retryUpload')}>
                      <PtButton
                        actionId={`composer-retry-upload-${item.id}`}
                        className="sc-composer__draft-action"
                        emphasis="quiet"
                        density="compact"
                        leading={<RotateCcw size={13} />}
                        aria-label={t('chat.social.composer.retryUpload')}
                        onActivate={() => retryDraft(item.id)}
                      />
                    </PtTooltip>
                  )}
                  <PtTooltip label={t('chat.social.composer.removeAttachment')}>
                    <PtButton
                      actionId={`composer-remove-attachment-${item.id}`}
                      className="sc-composer__draft-action"
                      emphasis="quiet"
                      density="compact"
                      leading={<Trash2 size={13} />}
                      aria-label={t('chat.social.composer.removeAttachment')}
                      onActivate={() => removeDraft(item.id)}
                    />
                  </PtTooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div
        className="sc-composer__shell"
        data-dragging={dragging || undefined}
        style={{
          border: composerShellBorder,
          borderRadius: visualLayout.composerShellRadius,
          boxShadow: visualLayout.composerShellShadow,
        }}
      >
        <div className="sc-composer__row">
          <span className="sc-composer__tools">
            {activeCapabilities.emoji && (
              <PtPopover
                open={emojiOpen}
                onOpenChange={setEmojiOpen}
                placement="top"
                content={emojiPanel}
                label={t('chat.social.composer.emoji')}
              >
                <PtTooltip label={t('chat.social.composer.emoji')}>
                  <PtButton
                    actionId="composer-emoji"
                    className="sc-composer__tool"
                    emphasis="quiet"
                    density="compact"
                    leading={<Smile size={18} />}
                    aria-label={t('chat.social.composer.emoji')}
                    availability={recordedVoice ? toolUnavailable(t('chat.social.composer.voice')) : undefined}
                  />
                </PtTooltip>
              </PtPopover>
            )}
            {activeCapabilities.file && (
              <PtTooltip label={t('chat.social.composer.file')}>
                <PtButton
                  actionId="composer-attach-file"
                  className="sc-composer__tool"
                  data-chat-attachment-picker
                  emphasis="quiet"
                  density="compact"
                  leading={<FolderOpen size={18} />}
                  aria-label={t('chat.social.composer.file')}
                  onActivate={() => {
                    void handlePickAttachment();
                  }}
                  availability={
                    disabled || editing || recording || voiceSending || Boolean(recordedVoice)
                      ? toolUnavailable(t('chat.social.composer.sendDisabled'))
                      : undefined
                  }
                />
              </PtTooltip>
            )}
            {activeCapabilities.screenshot && (
              <PtTooltip label={t('chat.social.composer.screenshot', { shortcut: formatChatScreenshotShortcut(screenshotShortcut) })}>
                <PtButton
                  actionId="composer-screenshot"
                  className="sc-composer__tool"
                  emphasis="quiet"
                  density="compact"
                  leading={capturing ? <Loader2 size={18} className="chat-composer-spin" /> : <Scissors size={18} />}
                  aria-label={t('chat.social.composer.screenshot', { shortcut: formatChatScreenshotShortcut(screenshotShortcut) })}
                  data-chat-screenshot-capture
                  onActivate={captureScreenshot}
                  availability={
                    disabled || editing || recording || capturing || voiceSending || Boolean(recordedVoice)
                      ? toolUnavailable(t('chat.social.composer.sendDisabled'))
                      : undefined
                  }
                />
              </PtTooltip>
            )}
            {activeCapabilities.voice && (
              <PtTooltip label={recording ? t('chat.social.composer.recordingTooltip') : t('chat.social.composer.voice')}>
                <PtButton
                  actionId="composer-voice"
                  className={`sc-composer__tool${recording ? ' is-recording' : ''}`}
                  emphasis="quiet"
                  density="compact"
                  leading={voiceSending ? <Loader2 size={18} className="chat-composer-spin" /> : <Mic size={18} />}
                  aria-label={t('chat.social.composer.voice')}
                  data-chat-voice-record
                  onActivate={recording ? () => stopRecording(false) : startRecording}
                  availability={
                    disabled || editing || voiceSending || Boolean(recordedVoice)
                      ? toolUnavailable(t('chat.social.composer.sendDisabled'))
                      : undefined
                  }
                />
              </PtTooltip>
            )}
          </span>

          <div className="sc-composer__input-wrap">
            <TextArea
              ref={textareaRef}
              framing="embedded"
              className="sc-composer__input"
              data-pt-text-input="chat-composer"
              value={value}
              disabled={disabled || sending || recording || voiceSending || Boolean(recordedVoice)}
              rows={1}
              onInput={handleTextInputObserved}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => commitValue(event.target.value)}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
                lastCompositionEndRef.current = Date.now();
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={onBlurInput}
              placeholder={placeholder ?? t('chat.social.messageArea.placeholder')}
              style={{
                // Consumed by the embedded frame + native textarea CSS so the
                // auto-grow effect (which writes height on the native element)
                // keeps the same min/max contract as the former raw textarea.
                // Auto-grow is instant, matching the prototype composer.
                '--sc-composer-input-min-height': `${inputMinHeight}px`,
                '--sc-composer-input-max-height': `${inputMaxHeight}px`,
              } as CSSProperties}
            />
          </div>

          <span className="sc-composer__send-group">
            <PtTooltip label={inputExpanded ? t('chat.social.composer.collapseInput') : t('chat.social.composer.expandInput')}>
              <PtButton
                actionId="composer-expand"
                className="sc-composer__tool"
                emphasis="quiet"
                density="compact"
                leading={inputExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                aria-label={inputExpanded ? t('chat.social.composer.collapseInput') : t('chat.social.composer.expandInput')}
                aria-pressed={inputExpanded}
                onActivate={handleToggleInputExpanded}
                availability={disabled ? toolUnavailable(t('chat.social.composer.sendDisabled')) : undefined}
              />
            </PtTooltip>
            <IconButton
              actionId="chat-send-message"
              className="sc-composer__send"
              data-chat-send
              iconId="send"
              iconSize={16}
              emphasis="primary"
              label={t('chat.composer.send')}
              availability={canSend
                ? { kind: 'enabled' }
                : { kind: 'disabled', reason: t('chat.social.composer.sendDisabled') }}
              onActivate={() => {
                submit().catch((error) => {
                  log.error('chat', 'composer send failed', error);
                });
              }}
            />
            {(uploading || voiceSending) && (
              <span className="sc-composer__uploading">
                {t('chat.social.composer.uploading')}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
