import {
  useEffect,
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
import { Button, toast } from '@lobehub/ui';
import { Popover, Progress, theme, Tooltip, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
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
  Send,
  Smile,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN,
  canSubmitChatComposerDraft,
  chatMediaKindFromMimeFilename,
  chatMessageTypeForAttachments,
  chatVisualCssVars,
  chatVisualLayoutForSurface,
  formatChatAttachmentSize,
  resolveChatComposerCapabilities,
  shouldSendComposerEnter,
  type ChatComposerCapabilities,
  type ChatVisualSurface,
} from '@peers-touch/client-chat-core';

import { log } from '../../utils/logger';
import { api, type ChatAttachmentInput } from '../../services/desktop_api';
import {
  useChatAttachmentDrafts,
  type ChatDraftAttachment,
} from './composer/useChatAttachmentDrafts';
import { useChatScreenshotCapture } from './composer/useChatScreenshotCapture';
import { useChatVoiceRecorder } from './composer/useChatVoiceRecorder';
import { useActiveChatSettingsSlice } from './useActiveSocialChatStore';
import { formatChatScreenshotShortcut } from '../../utils/chatScreenshotShortcut';
import { formatMediaDurationSeconds } from '../../utils/mediaDisplay';
import { uploadChatAttachmentFile } from '../../services/chatAttachments';
import {
  markTextInputIntent,
  markTextInputVisible,
  scheduleAfterPaint,
} from '../../kernel/frontendRuntimeProfiler';

export type { ChatComposerCapabilities } from '@peers-touch/client-chat-core';

const { Text } = Typography;

const EMOJI_RECENT_STORAGE_KEY = 'peers-touch:chat:composer:recent-emojis';

const DEFAULT_EMOJI_GROUPS = [
  ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '😭', '😡'],
  ['👍', '👎', '👏', '🙏', '💪', '🤝', '👌', '✌️', '🤟', '👋'],
  ['❤️', '💔', '💕', '💯', '✨', '🔥', '🎉', '🌹', '⭐', '💤'],
  ['😅', '😇', '🙂', '🙃', '😉', '😌', '😋', '🤔', '🤫', '😴'],
] as const;

export interface ChatComposerDraft {
  text: string;
  attachments: ChatAttachmentInput[];
  messageType?: number;
}

interface ChatComposerProps {
  activeConversationId: string;
  capabilities?: ChatComposerCapabilities;
  disabled?: boolean;
  editing: boolean;
  surfaceBackground?: string;
  value: string;
  onChange: (value: string) => void;
  onBlurInput: () => void;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onSend: (draft: ChatComposerDraft) => Promise<void>;
  placeholder?: string;
  replyPreview?: string;
  replyPreviewKey?: string | null;
  visualSurface?: Extract<ChatVisualSurface, 'desktop-main' | 'desktop-thread'>;
  editPreview?: string;
  sending: boolean;
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
  value,
  onChange,
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
  const { token } = theme.useToken();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [voiceSending, setVoiceSending] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => loadRecentEmojis());
  const screenshotShortcut = useActiveChatSettingsSlice((state) => state.chatScreenshotShortcut);
  const activeCapabilities = resolveChatComposerCapabilities(
    CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN,
    capabilities,
  );
  const visualLayout = chatVisualLayoutForSurface(visualSurface);
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
    addPath,
    appendReadyAttachment,
    clearDrafts,
    removeDraft,
    retryDraft,
  } = useChatAttachmentDrafts({
    conversationId: activeConversationId,
    disabled,
    editing,
    fallbackName: t('chat.social.composer.attachmentFallbackName'),
    onUploadFailed: () => toast.error(t('chat.social.composer.uploadFailed')),
  });
  const sendRecordedVoice = async (file: File) => {
    if (disabled || editing || sending || voiceSending) return;
    setVoiceSending(true);
    try {
      const attachment = await uploadChatAttachmentFile({ conversationId: activeConversationId }, file);
      await onSend({
        text: '',
        attachments: [attachment],
        messageType: chatMessageTypeForAttachments([attachment]),
      });
    } catch (error) {
      log.error('chat', 'voice message send failed', error);
      toast.error(t('chat.social.composer.voiceSendFailed'));
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
    onRecorded: (file) => {
      sendRecordedVoice(file).catch((error) => {
        log.error('chat', 'voice message send task failed', error);
      });
    },
    onDenied: () => toast.error(t('chat.social.composer.voiceDenied')),
    onUnsupported: () => toast.error(t('chat.social.composer.voiceUnsupported')),
  });
  const { captureScreenshot, capturing } = useChatScreenshotCapture({
    conversationId: activeConversationId,
    disabled,
    editing,
    enabled: activeCapabilities.screenshot,
    onCaptured: appendReadyAttachment,
    onFailed: (reason) => toast.error(
      reason === 'capture_permission_or_display_failed'
        ? t('chat.social.composer.screenshotPermissionFailed')
        : t('chat.social.composer.screenshotFailed'),
    ),
  });

  const canSend = !disabled
    && !sending
    && !voiceSending
    && !uploading
    && !failed
    && canSubmitChatComposerDraft({
      text: value,
      attachmentCount: readyAttachments.length,
      capabilities: activeCapabilities,
    });
  const composerShellBorder = dragging ? `1px solid ${token.colorPrimaryBorder}` : '1px solid transparent';
  const toolButtonStyle: CSSProperties = {
    width: visualLayout.composerToolButtonSize,
    height: visualLayout.composerToolButtonSize,
    borderRadius: 8,
    color: token.colorTextSecondary,
  };

  useEffect(() => {
    setEmojiOpen(false);
    setInputExpanded(false);
  }, [activeConversationId]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    addFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePickAttachment = async () => {
    if (disabled || editing || recording) return;
    try {
      const filePath = await api.ossPickAttachmentChat();
      addPath(filePath);
    } catch (error) {
      log.warn('chat', 'composer native attachment picker cancelled or failed', error);
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
    onChange(nextValue);
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
    <Flexbox gap={12} style={{ width: 420, maxWidth: '70vw', padding: 14 }}>
      {recentEmojis.length > 0 && (
        <Flexbox gap={8}>
          <Text style={{ fontSize: 13, color: token.colorTextSecondary }}>
            {t('chat.social.composer.emojiRecent')}
          </Text>
          <Flexbox horizontal wrap="wrap" gap={6}>
            {recentEmojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={t('chat.social.composer.emojiInsert')}
                onClick={() => insertEmoji(emoji)}
                style={{
                  width: 32,
                  height: 32,
                  border: 0,
                  borderRadius: 6,
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 21,
                }}
              >
                {emoji}
              </button>
            ))}
          </Flexbox>
        </Flexbox>
      )}
      <Flexbox gap={8}>
        <Text style={{ fontSize: 13, color: token.colorTextSecondary }}>
          {t('chat.social.composer.emojiAll')}
        </Text>
        <Flexbox horizontal wrap="wrap" gap={6}>
          {DEFAULT_EMOJI_GROUPS.flat().map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={t('chat.social.composer.emojiInsert')}
              onClick={() => insertEmoji(emoji)}
              style={{
                width: 32,
                height: 32,
                border: 0,
                borderRadius: 6,
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 21,
              }}
            >
              {emoji}
            </button>
          ))}
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal align="center" justify="space-between" style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 8 }}>
        <Smile size={18} />
        <Text style={{ fontSize: 12, color: token.colorTextQuaternary }}>
          {t('chat.social.composer.emoji')}
        </Text>
      </Flexbox>
    </Flexbox>
  );

  const submit = async () => {
    if (!canSend) return;
    const messageType = chatMessageTypeForAttachments(readyAttachments);
    await onSend({
      text: value.trim(),
      attachments: readyAttachments,
      messageType,
    });
    clearDrafts();
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
    if (item.status === 'uploading') return <Loader2 size={15} className="chat-composer-spin" />;
    if (item.status === 'failed') return <AlertCircle size={15} />;
    const Icon = fileIconForMime(item.mimeType);
    return <Icon size={15} />;
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

  return (
    <Flexbox
      gap={8}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        ...(chatVisualCssVars(visualLayout) as CSSProperties),
        padding: visualLayout.composerOuterPadding,
        background: surfaceBackground ?? token.colorBgLayout,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <style>
        {'.chat-composer-spin{animation:chat-composer-spin 1s linear infinite}@keyframes chat-composer-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'}
      </style>
      {dragging && (
        <Flexbox
          align="center"
          justify="center"
          style={{
            position: 'absolute',
            inset: 8,
            zIndex: 4,
            border: `1px dashed ${token.colorPrimary}`,
            borderRadius: 8,
            background: token.colorPrimaryBg,
            color: token.colorPrimary,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {t('chat.social.composer.dropHint')}
        </Flexbox>
      )}

      {banner && (
        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          style={{
            padding: '7px 10px',
            borderRadius: 8,
            background: token.colorBgContainer,
            borderLeft: `3px solid ${token.colorPrimary}`,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
          }}
        >
          <Flexbox style={{ minWidth: 0, flex: 1 }}>
            <Text style={{ fontSize: 11, color: token.colorPrimary, fontWeight: 600 }}>
              {banner.label}
            </Text>
            <Text ellipsis type="secondary" style={{ fontSize: 12 }}>
              {banner.text}
            </Text>
          </Flexbox>
          <Button
            type="text"
            size="small"
            icon={<X size={13} />}
            aria-label={t('chat.social.messageArea.cancel')}
            onClick={banner.action}
          />
        </Flexbox>
      )}

      <Flexbox
        gap={0}
        style={{
          background: token.colorBgContainer,
          border: composerShellBorder,
          borderRadius: visualLayout.composerShellRadius,
          overflow: 'hidden',
          boxShadow: visualLayout.composerShellShadow,
        }}
      >
        {drafts.length > 0 && (
          <Flexbox horizontal gap={8} style={{ padding: '8px 10px 0', overflowX: 'auto' }}>
            {drafts.map((item) => {
              const labels = renderDraftLabels(item);
              return (
              <Flexbox
                key={item.id}
                gap={6}
                style={{
                  width: 126,
                  flex: '0 0 126px',
                  border: `1px solid ${item.status === 'failed' ? token.colorErrorBorder : token.colorBorderSecondary}`,
                  borderRadius: 8,
                  padding: 6,
                  background: item.status === 'failed' ? token.colorErrorBg : token.colorFillQuaternary,
                }}
              >
                <Flexbox
                  align="center"
                  justify="center"
                  style={{
                    height: 66,
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: token.colorFillSecondary,
                    color: item.status === 'failed' ? token.colorError : token.colorTextSecondary,
                  }}
                >
                  {item.previewUrl && item.mimeType.startsWith('image/') ? (
                    <img src={item.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : item.previewUrl && item.mimeType.startsWith('video/') ? (
                    <video src={item.previewUrl} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    renderDraftIcon(item)
                  )}
                </Flexbox>
                <Flexbox horizontal align="center" justify="space-between" gap={4}>
                  <Flexbox style={{ minWidth: 0, flex: 1 }}>
                    <Text ellipsis style={{ fontSize: 11 }}>{labels.primary}</Text>
                    {labels.secondary && (
                      <Text type="secondary" style={{ fontSize: 10 }}>{labels.secondary}</Text>
                    )}
                  </Flexbox>
                  {item.status === 'failed' && (
                    <Tooltip title={t('chat.social.composer.retryUpload')}>
                      <Button type="text" size="small" icon={<RotateCcw size={13} />} onClick={() => retryDraft(item.id)} />
                    </Tooltip>
                  )}
                  <Tooltip title={t('chat.social.composer.removeAttachment')}>
                    <Button type="text" size="small" icon={<Trash2 size={13} />} onClick={() => removeDraft(item.id)} />
                  </Tooltip>
                </Flexbox>
                {item.status === 'uploading' && <Progress percent={55} showInfo={false} size="small" status="active" />}
              </Flexbox>
              );
            })}
          </Flexbox>
        )}

        {recording && (
          <Flexbox horizontal align="center" justify="space-between" style={{ padding: '8px 10px 0' }}>
            <Flexbox horizontal align="center" gap={8}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: token.colorError }} />
              <Text style={{ color: token.colorError, fontSize: 13 }}>
                {t('chat.social.composer.recording', { seconds: recordingSeconds })}
              </Text>
            </Flexbox>
            <Flexbox horizontal gap={6}>
              <Button size="small" icon={<X size={13} />} onClick={() => stopRecording(true)}>
                {t('chat.social.composer.cancelRecord')}
              </Button>
              <Button size="small" type="primary" icon={<Square size={13} />} onClick={() => stopRecording(false)}>
                {t('chat.social.composer.finishRecord')}
              </Button>
            </Flexbox>
          </Flexbox>
        )}

        <textarea
          ref={textareaRef}
          data-pt-text-input="chat-composer"
          value={value}
          disabled={disabled || sending || recording || voiceSending}
          rows={3}
          onInput={handleTextInputObserved}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
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
            width: '100%',
            minHeight: inputMinHeight,
            maxHeight: inputMaxHeight,
            resize: 'none',
            border: 0,
            outline: 'none',
            boxShadow: 'none',
            padding: '12px 14px 6px',
            background: 'transparent',
            color: token.colorText,
            caretColor: token.colorPrimary,
            font: 'inherit',
            lineHeight: 1.55,
            overflowY: 'auto',
            transition: 'min-height 0.18s ease, max-height 0.18s ease',
          }}
        />

        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          style={{
            height: 38,
            padding: '0 8px 6px',
            background: token.colorBgContainer,
          }}
        >
          <Flexbox horizontal align="center" gap={2}>
            {activeCapabilities.emoji && (
              <Popover
                open={emojiOpen}
                onOpenChange={setEmojiOpen}
                trigger="click"
                placement="topLeft"
                content={emojiPanel}
                styles={{ content: { padding: 0 } }}
              >
                <Tooltip title={t('chat.social.composer.emoji')}>
                  <Button
                    type="text"
                    icon={<Smile size={20} />}
                    aria-label={t('chat.social.composer.emoji')}
                    style={toolButtonStyle}
                  />
                </Tooltip>
              </Popover>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*,application/pdf,.zip,.txt,.md"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            {activeCapabilities.file && (
              <Tooltip title={t('chat.social.composer.file')}>
                <Button
                  type="text"
                  icon={<FolderOpen size={20} />}
                  aria-label={t('chat.social.composer.file')}
                  onClick={handlePickAttachment}
                  disabled={disabled || editing || recording || voiceSending}
                  style={toolButtonStyle}
                />
              </Tooltip>
            )}
            {activeCapabilities.screenshot && (
              <Tooltip title={t('chat.social.composer.screenshot', { shortcut: formatChatScreenshotShortcut(screenshotShortcut) })}>
                <Button
                  type="text"
                  icon={capturing ? <Loader2 size={20} className="chat-composer-spin" /> : <Scissors size={20} />}
                  aria-label={t('chat.social.composer.screenshot', { shortcut: formatChatScreenshotShortcut(screenshotShortcut) })}
                  onClick={captureScreenshot}
                  disabled={disabled || editing || recording || capturing || voiceSending}
                  style={toolButtonStyle}
                />
              </Tooltip>
            )}
            {activeCapabilities.voice && (
              <Tooltip title={recording ? t('chat.social.composer.recordingTooltip') : t('chat.social.composer.voice')}>
                <Button
                  type="text"
                  icon={voiceSending ? <Loader2 size={20} className="chat-composer-spin" /> : <Mic size={20} />}
                  aria-label={t('chat.social.composer.voice')}
                  onClick={recording ? () => stopRecording(false) : startRecording}
                  disabled={disabled || editing || voiceSending}
                  style={{ ...toolButtonStyle, color: recording ? token.colorError : token.colorTextSecondary }}
                />
              </Tooltip>
            )}
          </Flexbox>

          <Flexbox horizontal align="center" gap={8}>
            <Tooltip title={inputExpanded ? t('chat.social.composer.collapseInput') : t('chat.social.composer.expandInput')}>
              <Button
                type="text"
                icon={inputExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                aria-label={inputExpanded ? t('chat.social.composer.collapseInput') : t('chat.social.composer.expandInput')}
                aria-pressed={inputExpanded}
                onClick={handleToggleInputExpanded}
                disabled={disabled}
                style={toolButtonStyle}
              />
            </Tooltip>
            <Tooltip title={canSend ? t('chat.composer.send') : t('chat.social.composer.sendDisabled')}>
              <button
                type="button"
                aria-label={t('chat.composer.send')}
                onClick={() => {
                  submit().catch((error) => {
                    log.error('chat', 'composer send failed', error);
                  });
                }}
                disabled={!canSend}
                style={{
                  ...toolButtonStyle,
                  border: 0,
                  background: canSend ? token.colorPrimary : token.colorFillSecondary,
                  color: canSend ? token.colorTextLightSolid : token.colorTextQuaternary,
                  cursor: canSend ? 'pointer' : 'not-allowed',
                }}
              >
                <Send size={18} />
              </button>
            </Tooltip>
            {(uploading || voiceSending) && (
              <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>
                {t('chat.social.composer.uploading')}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
