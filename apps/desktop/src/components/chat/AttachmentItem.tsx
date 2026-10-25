// Render a single chat message attachment.
//
// Messaging Runtime owns scoped access and downloads. Selecting a file opens
// the shared detail surface; recorded voice notes retain inline playback.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography, Tooltip } from 'antd';
import {
  ExternalLink,
  FileAudio,
  FileImage,
  FileVideo,
  Globe,
  Lock,
  MessageSquare,
  Paperclip,
  Pause,
  Play,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import {
  type ChatAttachmentLike,
  chatAttachmentDurationMs,
  chatMediaKindForAttachment,
  chatAttachmentFileType,
  formatChatAttachmentSize,
  isChatVoiceNoteAttachment,
} from '@peers-touch/client-chat-core';
import { formatMediaDurationSeconds } from '../../utils/mediaDisplay';
import { useAttachmentAccess } from './useAttachmentAccess';
import { messagingAttachmentAccess } from '../../messaging/attachmentAccess';

const { Text } = Typography;

type Attachment = ChatAttachmentLike;

function messagingAttachmentId(attachment: Attachment): string {
  const explicit = (attachment as Attachment & { attachmentId?: string }).attachmentId?.trim();
  if (explicit) return explicit;
  return attachment.cid?.startsWith('messaging:') ? attachment.cid.slice('messaging:'.length) : '';
}

function messagingAttachmentState(
  attachment: Attachment,
): 'uploading' | 'remote' | 'local' | 'failed' | 'unknown' {
  const state = (attachment as Attachment & { availabilityState?: string }).availabilityState;
  return state === 'uploading' || state === 'remote' || state === 'local' || state === 'failed'
    ? state
    : 'unknown';
}

export type ChatAttachmentVisibilityHint = 'public' | 'chat' | 'private';

interface Props {
  attachment: Attachment;
  isOwn: boolean;
  /**
   * Wire-derived OSS scope for the attachment ("public" / "chat" /
   * "private"). Sender-authoritative — populated at upload time by
   * `chat_upload_attachment` and travels with the message via the
   * proto's new `visibility` field. When undefined (empty wire
   * value, legacy senders), the badge is suppressed entirely.
   */
  visibilityHint?: ChatAttachmentVisibilityHint;
}

interface VisibilityChip {
  icon: typeof Globe;
  label: string;
  tooltip: string;
  /** Tag color in the bubble background tone (own vs received). */
  bg: string;
  fg: string;
}

function visibilityChip(
  hint: ChatAttachmentVisibilityHint | undefined,
  t: ReturnType<typeof useTranslation>['t'],
  isOwn: boolean,
  token: ReturnType<typeof theme.useToken>['token'],
): VisibilityChip | null {
  if (!hint) return null;
  // Tone the chip down for own messages (which already sit on a
  // colored bubble) and lift it slightly for received messages so
  // it remains legible against the muted bubble background.
  const ownBg = 'rgba(255,255,255,0.18)';
  const ownFg = 'rgba(255,255,255,0.92)';
  switch (hint) {
    case 'public':
      return {
        icon: Globe,
        label: t('chat.social.messageArea.attachmentScopePublic'),
        tooltip: t('chat.social.messageArea.attachmentVisiblePublic'),
        bg: isOwn ? ownBg : token.colorInfoBg,
        fg: isOwn ? ownFg : token.colorInfoText,
      };
    case 'chat':
      return {
        icon: MessageSquare,
        label: t('chat.social.messageArea.attachmentScopeChat'),
        tooltip: t('chat.social.messageArea.attachmentVisibleChat'),
        bg: isOwn ? ownBg : token.colorPrimaryBg,
        fg: isOwn ? ownFg : token.colorPrimaryText,
      };
    case 'private':
      return {
        icon: Lock,
        label: t('chat.social.messageArea.attachmentScopePrivate'),
        tooltip: t('chat.social.messageArea.attachmentVisiblePrivate'),
        bg: isOwn ? ownBg : token.colorFillSecondary,
        fg: isOwn ? ownFg : token.colorTextSecondary,
      };
  }
}

function VisibilityBadge({ chip }: { chip: VisibilityChip }) {
  const Icon = chip.icon;
  return (
    <Tooltip title={chip.tooltip}>
      <Flexbox
        horizontal
        align="center"
        gap={4}
        style={{
          alignSelf: 'flex-start',
          padding: '1px 6px',
          borderRadius: 10,
          background: chip.bg,
          color: chip.fg,
          fontSize: 10,
          lineHeight: 1.4,
          cursor: 'default',
          userSelect: 'none',
        }}
      >
        <Icon size={10} />
        <span>{chip.label}</span>
      </Flexbox>
    </Tooltip>
  );
}

function attachmentTypeLabel(
  kind: 'image' | 'video' | 'audio' | 'file',
  attachment: Attachment,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (kind === 'image') return t('chat.social.messageArea.attachmentTypeImage');
  if (kind === 'video') return t('chat.social.messageArea.attachmentTypeVideo');
  if (kind === 'audio') return t('chat.social.messageArea.attachmentTypeAudio');

  return chatAttachmentFileType(attachment) || t('chat.social.messageArea.attachmentTypeFile');
}

interface AttachmentDetailsProps {
  actionLabel: string;
  actionVisible: boolean;
  kind: 'image' | 'video' | 'audio' | 'file';
  isOwn: boolean;
  onOpen: () => void;
  openTitle: string;
  primaryLabel?: string;
  sizeLabel: string;
  src: string | null;
  token: ReturnType<typeof theme.useToken>['token'];
  typeLabel: string;
}

function AttachmentDetails({
  actionLabel,
  actionVisible,
  kind,
  isOwn,
  onOpen,
  openTitle,
  primaryLabel,
  sizeLabel,
  src,
  token,
  typeLabel,
}: AttachmentDetailsProps) {
  const TypeIcon = kind === 'image'
    ? FileImage
    : kind === 'video'
      ? FileVideo
      : kind === 'audio'
        ? FileAudio
        : Paperclip;
  const textColor = isOwn ? '#fff' : token.colorText;
  const secondaryColor = isOwn ? 'rgba(255,255,255,0.72)' : token.colorTextSecondary;

  return (
    <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0, width: '100%' }}>
      <Flexbox
        align="center"
        justify="center"
        style={{
          width: 30,
          height: 30,
          flex: '0 0 30px',
          borderRadius: 8,
          background: isOwn ? 'rgba(255,255,255,0.16)' : token.colorFillSecondary,
          color: textColor,
        }}
      >
        <TypeIcon size={15} />
      </Flexbox>
      <Flexbox gap={1} style={{ flex: 1, minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
          <Text style={{ flex: '0 0 auto', fontSize: 10, fontWeight: 600, color: secondaryColor }}>
            {typeLabel}
          </Text>
          {sizeLabel && (
            <Text ellipsis style={{ minWidth: 0, fontSize: 10, color: secondaryColor }}>
              {sizeLabel}
            </Text>
          )}
        </Flexbox>
        {primaryLabel && (
          <Text ellipsis style={{ fontSize: 12, fontWeight: 500, color: textColor }}>
            {primaryLabel}
          </Text>
        )}
      </Flexbox>
      {src && (
        <Tooltip title={openTitle}>
          <button
            type="button"
            data-chat-attachment-open
            aria-label={openTitle}
            onClick={(ev) => {
              ev.stopPropagation();
              onOpen();
            }}
            style={{
              appearance: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 7px',
              border: `1px solid ${isOwn ? 'rgba(255,255,255,0.24)' : token.colorBorderSecondary}`,
              borderRadius: 999,
              background: isOwn ? 'rgba(255,255,255,0.14)' : token.colorBgContainer,
              color: textColor,
              cursor: 'pointer',
              fontSize: 10,
              lineHeight: 1,
              opacity: actionVisible ? 1 : 0.72,
              transition: 'opacity 120ms ease, background 120ms ease',
              whiteSpace: 'nowrap',
            }}
          >
            <ExternalLink size={11} />
            <span>{actionLabel}</span>
          </button>
        </Tooltip>
      )}
    </Flexbox>
  );
}

export function AttachmentItem({ attachment, isOwn, visibilityHint }: Props) {
  const { t } = useTranslation('chat');
  const { token } = theme.useToken();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioDurationSeconds, setAudioDurationSeconds] = useState(0);
  const [audioPositionSeconds, setAudioPositionSeconds] = useState(0);
  const [audioEnded, setAudioEnded] = useState(false);
  const [audioTerminal, setAudioTerminal] = useState(false);
  const attachmentKind = chatMediaKindForAttachment(attachment);
  const attachmentId = messagingAttachmentId(attachment);
  const availabilityState = messagingAttachmentState(attachment);
  const isImage = attachmentKind === 'image';
  const isVideo = attachmentKind === 'video';
  const isAudio = attachmentKind === 'audio';
  const isVoiceNote = isChatVoiceNoteAttachment(attachment);
  const { src, openState, open: openAttachment } = useAttachmentAccess(
    attachment,
    isImage || isVoiceNote,
  );
  const canOpen = Boolean(attachmentId);
  const chip = visibilityChip(visibilityHint, t, isOwn, token);
  const showHint = chip !== null;
  const filename = attachment.filename?.trim() || t('chat.social.messageArea.attachmentUnnamed');
  const typeLabel = attachmentTypeLabel(attachmentKind, attachment, t);
  const sizeLabel = formatChatAttachmentSize(attachment.size);
  const persistedAudioDurationSeconds = chatAttachmentDurationMs(attachment) / 1000;
  const audioDuration = audioDurationSeconds || persistedAudioDurationSeconds;
  const audioDurationLabel = formatMediaDurationSeconds(audioDuration);
  const actionLabel = t('chat.social.messageArea.attachmentOpen');
  const openTitle = t('chat.social.messageArea.attachmentOpenOrDownload');
  const transferStateLabel = openState === 'pending'
    ? t('chat.social.messageArea.attachmentStateDownloading')
    : openState === 'error'
      ? t('chat.social.messageArea.attachmentDownloadFailed')
      : availabilityState === 'uploading'
        ? t('chat.social.messageArea.attachmentStateUploading')
        : availabilityState === 'failed'
          ? t('chat.social.messageArea.attachmentStateFailed')
          : '';
  const canPreviewImage = Boolean(isImage && src && !previewFailed);
  const cardBackground = isOwn
    ? hovered
      ? 'rgba(255,255,255,0.22)'
      : 'rgba(255,255,255,0.15)'
    : hovered
      ? token.colorFillSecondary
      : token.colorFillTertiary;
  const cardBorder = isOwn ? 'rgba(255,255,255,0.22)' : token.colorBorderSecondary;

  useEffect(() => {
    setPreviewFailed(false);
  }, [attachment.cid, src]);

  useEffect(() => {
    setAudioDurationSeconds(0);
    setAudioPositionSeconds(0);
    setAudioPlaying(false);
    setAudioEnded(false);
    setAudioTerminal(false);
  }, [attachment.cid, src]);

  const handleKeyDown = (ev: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!canOpen) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      void openAttachment();
    }
  };

  if (isImage) {
    return (
      <Flexbox
        gap={3}
        data-messaging-attachment-id={attachmentId || undefined}
        data-messaging-attachment-kind={attachmentKind}
        data-messaging-attachment-open-state={openState}
        data-messaging-attachment-state={availabilityState}
        style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start', width: 'fit-content', maxWidth: 'min(240px, 100%)' }}
      >
        <Flexbox
          role={canOpen ? 'button' : undefined}
          tabIndex={canOpen ? 0 : undefined}
          onClick={openAttachment}
          onKeyDown={handleKeyDown}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            maxWidth: 'min(240px, 100%)',
            overflow: 'hidden',
            border: '0',
            borderRadius: 6,
            background: 'transparent',
            boxShadow: hovered ? token.boxShadowTertiary : 'none',
            cursor: canOpen ? 'pointer' : 'default',
            transition: 'background 120ms ease, box-shadow 120ms ease',
          }}
        >
          {canPreviewImage && src ? (
            <img
              src={`${src}?representation=preview`}
              alt={filename}
              loading="lazy"
              style={{
                display: 'block',
                width: 'auto',
                maxWidth: '100%',
                maxHeight: 260,
                objectFit: 'contain',
                background: 'transparent',
              }}
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <Flexbox
              align="center"
              justify="center"
              style={{
                width: 160,
                height: 96,
                borderRadius: 8,
                background: isOwn ? 'rgba(255,255,255,0.15)' : token.colorFillTertiary,
                color: isOwn ? '#fff' : token.colorTextSecondary,
              }}
            >
              <FileImage size={22} />
            </Flexbox>
          )}
        </Flexbox>
        <Flexbox gap={2} style={{ padding: '2px 6px', borderRadius: 4, background: token.colorBgContainer }}>
          <Text ellipsis style={{ maxWidth: 228, fontSize: 12, color: token.colorText }}>
            {filename}
          </Text>
          {sizeLabel && (
            <Text style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start', fontSize: 10, color: token.colorTextSecondary }}>
              {sizeLabel}
            </Text>
          )}
        </Flexbox>
        {transferStateLabel && <Text type="secondary" style={{ fontSize: 10 }}>{transferStateLabel}</Text>}
        {showHint && chip && <VisibilityBadge chip={chip} />}
      </Flexbox>
    );
  }

  if (src && isVideo) {
    return (
      <Flexbox
        gap={3}
        data-messaging-attachment-id={attachmentId || undefined}
        data-messaging-attachment-kind={attachmentKind}
        data-messaging-attachment-open-state={openState}
        data-messaging-attachment-state={availabilityState}
        style={{ maxWidth: '100%' }}
      >
        <Flexbox
          gap={6}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            width: 'min(320px, 100%)',
            maxWidth: '100%',
            overflow: 'hidden',
            border: `1px solid ${cardBorder}`,
            borderRadius: 8,
            background: cardBackground,
            boxShadow: hovered ? token.boxShadowTertiary : 'none',
            transition: 'background 120ms ease, box-shadow 120ms ease',
          }}
        >
          <video
            src={src}
            controls
            preload="metadata"
            style={{
              display: 'block',
              width: '100%',
              maxHeight: 220,
              background: token.colorBgSpotlight,
            }}
          />
          <Flexbox style={{ padding: '0 8px 8px' }}>
            <AttachmentDetails
              actionLabel={actionLabel}
              actionVisible={hovered}
              kind={attachmentKind}
              isOwn={isOwn}
              onOpen={openAttachment}
              openTitle={openTitle}
              primaryLabel={filename}
              sizeLabel={sizeLabel}
              src={src}
              token={token}
              typeLabel={typeLabel}
            />
          </Flexbox>
        </Flexbox>
        {transferStateLabel && <Text type="secondary" style={{ fontSize: 10 }}>{transferStateLabel}</Text>}
        {showHint && chip && <VisibilityBadge chip={chip} />}
      </Flexbox>
    );
  }

  if (isAudio && isVoiceNote) {
    const toggleAudioPlayback = () => {
      const audio = audioRef.current;
      if (!audio || !src || audioTerminal) return;
      if (audio.paused) {
        if (audioEnded) {
          audio.currentTime = 0;
          setAudioPositionSeconds(0);
          setAudioEnded(false);
        }
        audio.play().catch(() => {
          setAudioPlaying(false);
          setAudioTerminal(true);
        });
      } else {
        audio.pause();
      }
    };
    const seekAudio = (nextPosition: number) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(nextPosition)) return;
      audio.currentTime = Math.min(Math.max(nextPosition, 0), audioDuration || 0);
      setAudioPositionSeconds(audio.currentTime);
      setAudioEnded(false);
      setAudioTerminal(false);
    };
    const retryAudio = () => {
      setAudioTerminal(false);
      setAudioEnded(false);
      setAudioPositionSeconds(0);
      void messagingAttachmentAccess.retry(attachmentId);
    };
    const audioFailed = audioTerminal || openState === 'error' || availabilityState === 'failed';
    const audioPlaybackState = audioFailed
      ? 'failed'
      : openState === 'pending' || !src
        ? 'loading'
        : audioPlaying
          ? 'playing'
          : audioEnded
            ? 'ended'
            : audioPositionSeconds > 0
              ? 'paused'
              : 'ready';
    const voiceBubbleBackground = isOwn
      ? hovered
        ? '#8DEA90'
        : '#95EC97'
      : hovered
        ? token.colorFillSecondary
        : token.colorBgContainer;
    const voiceTextColor = isOwn ? '#111827' : token.colorText;
    const voiceSecondaryColor = isOwn ? 'rgba(17,24,39,0.72)' : token.colorTextSecondary;

    return (
      <Flexbox
        gap={3}
        data-messaging-attachment-id={attachmentId || undefined}
        data-messaging-attachment-kind={attachmentKind}
        data-messaging-attachment-open-state={openState}
        data-messaging-attachment-state={availabilityState}
        data-chat-voice-note={isVoiceNote ? 'true' : undefined}
        data-chat-voice-duration-ms={chatAttachmentDurationMs(attachment) || undefined}
        data-chat-voice-position-ms={Math.round(audioPositionSeconds * 1000)}
        data-chat-voice-playback-state={audioPlaybackState}
        data-chat-voice-terminal={audioFailed ? 'true' : 'false'}
        style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start', maxWidth: '100%' }}
      >
        {src && (
          <audio
            ref={audioRef}
            src={src}
            preload="metadata"
            onLoadedMetadata={(event) => {
              const duration = event.currentTarget.duration;
              if (Number.isFinite(duration) && duration > 0) {
                setAudioDurationSeconds(duration);
              }
              setAudioEnded(false);
            }}
            onPlay={() => {
              setAudioPlaying(true);
              setAudioEnded(false);
            }}
            onPause={() => setAudioPlaying(false)}
            onTimeUpdate={(event) => {
              setAudioPositionSeconds(event.currentTarget.currentTime);
              if (
                !event.currentTarget.ended
                && event.currentTarget.currentTime < event.currentTarget.duration
              ) {
                setAudioEnded(false);
              }
            }}
            onEnded={(event) => {
              setAudioPlaying(false);
              setAudioPositionSeconds(event.currentTarget.duration || audioDuration);
              setAudioEnded(true);
            }}
            onError={() => {
              setAudioPlaying(false);
              setAudioEnded(false);
              setAudioTerminal(true);
            }}
          />
        )}
        <Flexbox
          gap={8}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            minWidth: 180,
            width: 'min(260px, 100%)',
            maxWidth: '100%',
            padding: '10px 14px',
            border: 0,
            borderRadius: isOwn ? '10px 4px 10px 10px' : '4px 10px 10px 10px',
            background: voiceBubbleBackground,
            boxShadow: hovered ? token.boxShadowTertiary : 'none',
            color: voiceTextColor,
            opacity: src && !audioFailed ? 1 : 0.72,
            transition: 'background 120ms ease, box-shadow 120ms ease',
          }}
        >
          <Flexbox horizontal align="center" gap={8}>
            <Tooltip title={audioPlaying
              ? t('chat.social.messageArea.voicePause')
              : t('chat.social.messageArea.voicePlay')}>
              <button
                type="button"
                disabled={!src || audioFailed}
                aria-label={audioPlaying
                  ? t('chat.social.messageArea.voicePause')
                  : t('chat.social.messageArea.voicePlay')}
                data-chat-voice-toggle
                data-chat-voice-playing={audioPlaying ? 'true' : 'false'}
                onClick={toggleAudioPlayback}
                style={{
                  width: 28,
                  height: 28,
                  border: 0,
                  borderRadius: '50%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isOwn ? 'rgba(255,255,255,0.5)' : token.colorFillSecondary,
                  color: voiceTextColor,
                  cursor: src && !audioFailed ? 'pointer' : 'default',
                }}
              >
                {audioPlaying ? <Pause size={16} /> : <Play size={16} />}
              </button>
            </Tooltip>
            <input
              type="range"
              min={0}
              max={Math.max(audioDuration, 1)}
              step={0.1}
              value={Math.min(audioPositionSeconds, Math.max(audioDuration, 1))}
              disabled={!src || audioFailed}
              aria-label={t('chat.social.messageArea.voiceSeek')}
              data-chat-voice-seek
              onChange={(event) => seekAudio(Number(event.currentTarget.value))}
              style={{ flex: 1, minWidth: 72, accentColor: voiceTextColor }}
            />
            <Text style={{ color: voiceSecondaryColor, fontSize: 11, whiteSpace: 'nowrap' }}>
              {formatMediaDurationSeconds(audioPositionSeconds) || '0:00'}
              {' / '}
              {audioDurationLabel || t('chat.social.messageArea.voiceDurationUnknown')}
            </Text>
            <Volume2 size={18} color={voiceSecondaryColor} />
          </Flexbox>
          {audioFailed && (
            <button
              type="button"
              aria-label={t('chat.social.messageArea.voiceRetry')}
              data-chat-voice-retry
              onClick={retryAudio}
              style={{
                alignSelf: 'flex-start',
                border: 0,
                background: 'transparent',
                color: voiceTextColor,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: 0,
                fontSize: 11,
              }}
            >
              <RotateCcw size={12} />
              {t('chat.social.messageArea.voiceRetry')}
            </button>
          )}
        </Flexbox>
        {transferStateLabel && <Text type="secondary" style={{ fontSize: 10 }}>{transferStateLabel}</Text>}
        {showHint && chip && <VisibilityBadge chip={chip} />}
      </Flexbox>
    );
  }

  return (
    <Flexbox
      gap={3}
      data-messaging-attachment-id={attachmentId || undefined}
      data-messaging-attachment-kind={attachmentKind}
      data-messaging-attachment-open-state={openState}
      data-messaging-attachment-state={availabilityState}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={openAttachment}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        maxWidth: '100%',
        cursor: canOpen ? 'pointer' : 'default',
      }}
    >
      <Flexbox
        horizontal
        align="center"
        style={{
          width: 'min(260px, 100%)',
          maxWidth: '100%',
          padding: '8px 9px',
          border: `1px solid ${cardBorder}`,
          borderRadius: 8,
          background: cardBackground,
          boxShadow: hovered ? token.boxShadowTertiary : 'none',
          cursor: canOpen ? 'pointer' : 'default',
          opacity: src ? 1 : 0.72,
          transition: 'background 120ms ease, box-shadow 120ms ease',
        }}
      >
        <AttachmentDetails
          actionLabel={actionLabel}
          actionVisible={hovered}
          kind={attachmentKind}
          isOwn={isOwn}
          onOpen={openAttachment}
          openTitle={openTitle}
          primaryLabel={filename}
          sizeLabel={sizeLabel}
          src={src}
          token={token}
          typeLabel={typeLabel}
        />
      </Flexbox>
      {transferStateLabel && <Text type="secondary" style={{ fontSize: 10 }}>{transferStateLabel}</Text>}
      {showHint && chip && <VisibilityBadge chip={chip} />}
    </Flexbox>
  );
}
