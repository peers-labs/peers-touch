// Render a single chat message attachment.
//
// Messaging Runtime owns scoped access and downloads. Selecting a file opens
// the shared detail surface; recorded voice notes retain inline playback.

import {
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip as PtTooltip } from '@peers-touch/ui';
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

type ChipTone = 'info' | 'primary' | 'neutral';

interface VisibilityChip {
  icon: typeof Globe;
  label: string;
  tooltip: string;
  tone: ChipTone;
}

function visibilityChip(
  hint: ChatAttachmentVisibilityHint | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): VisibilityChip | null {
  if (!hint) return null;
  switch (hint) {
    case 'public':
      return {
        icon: Globe,
        label: t('chat.social.messageArea.attachmentScopePublic'),
        tooltip: t('chat.social.messageArea.attachmentVisiblePublic'),
        tone: 'info',
      };
    case 'chat':
      return {
        icon: MessageSquare,
        label: t('chat.social.messageArea.attachmentScopeChat'),
        tooltip: t('chat.social.messageArea.attachmentVisibleChat'),
        tone: 'primary',
      };
    case 'private':
      return {
        icon: Lock,
        label: t('chat.social.messageArea.attachmentScopePrivate'),
        tooltip: t('chat.social.messageArea.attachmentVisiblePrivate'),
        tone: 'neutral',
      };
  }
}

function VisibilityBadge({ chip, isOwn }: { chip: VisibilityChip; isOwn: boolean }) {
  const Glyph = chip.icon;
  return (
    <PtTooltip label={chip.tooltip}>
      <span
        className={`sc-attachment-chip sc-attachment-chip--${chip.tone}${isOwn ? ' is-own' : ''}`}
      >
        <Glyph size={10} />
        <span>{chip.label}</span>
      </span>
    </PtTooltip>
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
  actionVisible: boolean;
  kind: 'image' | 'video' | 'audio' | 'file';
  isOwn: boolean;
  openTitle: string;
  primaryLabel?: string;
  sizeLabel: string;
  src: string | null;
  typeLabel: string;
}

function AttachmentDetails({
  actionVisible,
  kind,
  isOwn,
  openTitle,
  primaryLabel,
  sizeLabel,
  src,
  typeLabel,
}: AttachmentDetailsProps) {
  const TypeIcon = kind === 'image'
    ? FileImage
    : kind === 'video'
      ? FileVideo
      : kind === 'audio'
        ? FileAudio
        : Paperclip;

  return (
    <span className={`sc-attachment-details${isOwn ? ' is-own' : ''}`}>
      <span className="sc-attachment-details__glyph">
        <TypeIcon size={16} />
      </span>
      <span className="sc-attachment-details__body">
        <span className="sc-attachment-details__line">
          <span className="sc-attachment-details__type">{typeLabel}</span>
          {sizeLabel && (
            <span className="sc-attachment-details__size">{sizeLabel}</span>
          )}
        </span>
        {primaryLabel && (
          <span className="sc-attachment-details__name">{primaryLabel}</span>
        )}
      </span>
      {src && (
        <span
          className="sc-attachment-details__open"
          data-chat-attachment-open
          data-action-visible={actionVisible ? 'true' : 'false'}
          title={openTitle}
          aria-hidden
        >
          <ExternalLink size={13} />
        </span>
      )}
    </span>
  );
}

export function AttachmentItem({ attachment, isOwn, visibilityHint }: Props) {
  const { t } = useTranslation('chat');
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
  const chip = visibilityChip(visibilityHint, t);
  const showHint = chip !== null;
  const filename = attachment.filename?.trim() || t('chat.social.messageArea.attachmentUnnamed');
  const typeLabel = attachmentTypeLabel(attachmentKind, attachment, t);
  const sizeLabel = formatChatAttachmentSize(attachment.size);
  const persistedAudioDurationSeconds = chatAttachmentDurationMs(attachment) / 1000;
  const audioDuration = audioDurationSeconds || persistedAudioDurationSeconds;
  const audioDurationLabel = formatMediaDurationSeconds(audioDuration);
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

  if (isImage) {
    return (
      <div
        className="sc-attachment sc-attachment--image"
        data-messaging-attachment-id={attachmentId || undefined}
        data-messaging-attachment-kind={attachmentKind}
        data-messaging-attachment-open-state={openState}
        data-messaging-attachment-state={availabilityState}
      >
        <button
          type="button"
          className={`sc-attachment__image${hovered ? ' is-hovered' : ''}`}
          disabled={!canOpen}
          onClick={openAttachment}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {canPreviewImage && src ? (
            <img
              src={`${src}?representation=preview`}
              alt={filename}
              loading="lazy"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <span className={`sc-attachment__image-fallback${isOwn ? ' is-own' : ''}`}>
              <FileImage size={22} />
            </span>
          )}
        </button>
        {transferStateLabel && <span className="sc-attachment__state">{transferStateLabel}</span>}
        {showHint && chip && <VisibilityBadge chip={chip} isOwn={isOwn} />}
      </div>
    );
  }

  if (src && isVideo) {
    return (
      <div
        className="sc-attachment sc-attachment--video"
        data-messaging-attachment-id={attachmentId || undefined}
        data-messaging-attachment-kind={attachmentKind}
        data-messaging-attachment-open-state={openState}
        data-messaging-attachment-state={availabilityState}
      >
        <div className={`sc-attachment__video${hovered ? ' is-hovered' : ''}${isOwn ? ' is-own' : ''}`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <video src={src} controls preload="metadata" />
          <button
            type="button"
            className="sc-attachment__video-details"
            onClick={openAttachment}
            title={openTitle}
          >
            <AttachmentDetails
              actionVisible={hovered}
              kind={attachmentKind}
              isOwn={isOwn}
              openTitle={openTitle}
              primaryLabel={filename}
              sizeLabel={sizeLabel}
              src={src}
              typeLabel={typeLabel}
            />
          </button>
        </div>
        {transferStateLabel && <span className="sc-attachment__state">{transferStateLabel}</span>}
        {showHint && chip && <VisibilityBadge chip={chip} isOwn={isOwn} />}
      </div>
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

    return (
      <div
        className="sc-attachment sc-attachment--voice"
        data-messaging-attachment-id={attachmentId || undefined}
        data-messaging-attachment-kind={attachmentKind}
        data-messaging-attachment-open-state={openState}
        data-messaging-attachment-state={availabilityState}
        data-chat-voice-note="true"
        data-chat-voice-duration-ms={chatAttachmentDurationMs(attachment) || undefined}
        data-chat-voice-position-ms={Math.round(audioPositionSeconds * 1000)}
        data-chat-voice-playback-state={audioPlaybackState}
        data-chat-voice-terminal={audioFailed ? 'true' : 'false'}
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
        <div
          className={`sc-voice${isOwn ? ' is-own' : ''}${hovered ? ' is-hovered' : ''}${src && !audioFailed ? '' : ' is-pending'}`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <PtTooltip label={audioPlaying
            ? t('chat.social.messageArea.voicePause')
            : t('chat.social.messageArea.voicePlay')}>
            <button
              type="button"
              className="sc-voice__toggle"
              disabled={!src || audioFailed}
              aria-label={audioPlaying
                ? t('chat.social.messageArea.voicePause')
                : t('chat.social.messageArea.voicePlay')}
              data-chat-voice-toggle
              data-chat-voice-playing={audioPlaying ? 'true' : 'false'}
              onClick={toggleAudioPlayback}
            >
              {audioPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
          </PtTooltip>
          <input
            className="sc-voice__seek"
            type="range"
            min={0}
            max={Math.max(audioDuration, 1)}
            step={0.1}
            value={Math.min(audioPositionSeconds, Math.max(audioDuration, 1))}
            disabled={!src || audioFailed}
            aria-label={t('chat.social.messageArea.voiceSeek')}
            data-chat-voice-seek
            onChange={(event) => seekAudio(Number(event.currentTarget.value))}
          />
          <span className="sc-voice__time">
            {formatMediaDurationSeconds(audioPositionSeconds) || '0:00'}
            {' / '}
            {audioDurationLabel || t('chat.social.messageArea.voiceDurationUnknown')}
          </span>
          {audioFailed && (
            <button
              type="button"
              className="sc-voice__retry"
              aria-label={t('chat.social.messageArea.voiceRetry')}
              data-chat-voice-retry
              onClick={retryAudio}
            >
              <RotateCcw size={12} />
              {t('chat.social.messageArea.voiceRetry')}
            </button>
          )}
        </div>
        {transferStateLabel && <span className="sc-attachment__state">{transferStateLabel}</span>}
        {showHint && chip && <VisibilityBadge chip={chip} isOwn={isOwn} />}
      </div>
    );
  }

  return (
    <div
      className="sc-attachment sc-attachment--file"
      data-messaging-attachment-id={attachmentId || undefined}
      data-messaging-attachment-kind={attachmentKind}
      data-messaging-attachment-open-state={openState}
      data-messaging-attachment-state={availabilityState}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className={`sc-attachment__file${hovered ? ' is-hovered' : ''}${isOwn ? ' is-own' : ''}${src ? '' : ' is-pending'}`}
        disabled={!canOpen}
        onClick={openAttachment}
        title={openTitle}
      >
        <AttachmentDetails
          actionVisible={hovered}
          kind={attachmentKind}
          isOwn={isOwn}
          openTitle={openTitle}
          primaryLabel={filename}
          sizeLabel={sizeLabel}
          src={src}
          typeLabel={typeLabel}
        />
      </button>
      {transferStateLabel && <span className="sc-attachment__state">{transferStateLabel}</span>}
      {showHint && chip && <VisibilityBadge chip={chip} isOwn={isOwn} />}
    </div>
  );
}
