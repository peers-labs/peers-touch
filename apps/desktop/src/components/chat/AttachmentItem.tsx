// Render a single chat message attachment.
//
// Attachment bytes resolve through the Messaging Engine. The renderer
// receives only a verified local cache path and never handles keys,
// nonces, hashes, transfer checkpoints, or ciphertext URLs.
//
// Non-image attachments render as compact cards that open the
// resolved URL in the system browser. Image attachments render as
// images first; filename metadata is intentionally hidden.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
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
  Volume2,
} from 'lucide-react';
import {
  type ChatAttachmentLike,
  chatMediaKindForAttachment,
  formatChatAttachmentSize,
} from '@peers-touch/client-chat-core';
import { messagingCommands } from '../../messaging/runtime';
import { formatMediaDurationSeconds } from '../../utils/mediaDisplay';
import { log } from '../../utils/logger';

const { Text } = Typography;

type Attachment = ChatAttachmentLike;
export type MessagingAttachmentOpenState = 'idle' | 'pending' | 'ready' | 'error';

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

export function useMessagingAttachmentUrl(
  attachment: Attachment,
  eager: boolean,
): {
  src: string | null;
  openState: MessagingAttachmentOpenState;
  resolve: () => Promise<string | null>;
} {
  const attachmentId = messagingAttachmentId(attachment);
  const [src, setSrc] = useState<string | null>(null);
  const [openState, setOpenState] = useState<MessagingAttachmentOpenState>('idle');
  const resolve = useCallback(async () => {
    if (!attachmentId) return null;
    setOpenState('pending');
    try {
      const localPath = await messagingCommands.openAttachment(attachmentId);
      const next = convertFileSrc(localPath);
      setSrc(next);
      setOpenState('ready');
      return next;
    } catch (error) {
      setOpenState('error');
      log.warn('chat', 'open Engine attachment failed', { attachmentId, error });
      return null;
    }
  }, [attachmentId]);

  useEffect(() => {
    setSrc(null);
    setOpenState('idle');
    if (eager) void resolve();
  }, [eager, resolve]);

  return { src, openState, resolve };
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

  const mimeType = attachment.mimeType?.trim();
  if (mimeType) {
    const [, subtype] = mimeType.split('/');
    if (subtype) return subtype.split(/[+;]/)[0].replace(/[-_.]+/g, ' ').toUpperCase();
  }

  const filename = attachment.filename ?? '';
  const extension = filename.includes('.') ? filename.split('.').pop() : '';
  return extension
    ? extension.toUpperCase()
    : t('chat.social.messageArea.attachmentTypeFile');
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
  const [audioDuration, setAudioDuration] = useState('');
  const attachmentKind = chatMediaKindForAttachment(attachment);
  const attachmentId = messagingAttachmentId(attachment);
  const availabilityState = messagingAttachmentState(attachment);
  const isImage = attachmentKind === 'image';
  const isVideo = attachmentKind === 'video';
  const isAudio = attachmentKind === 'audio';
  const { src, openState, resolve } = useMessagingAttachmentUrl(
    attachment,
    isImage || isVideo || isAudio,
  );
  const canOpen = Boolean(attachmentId) && openState !== 'pending';
  const chip = visibilityChip(visibilityHint, t, isOwn, token);
  const showHint = chip !== null;
  const filename = attachment.filename?.trim() || t('chat.social.messageArea.attachmentUnnamed');
  const typeLabel = attachmentTypeLabel(attachmentKind, attachment, t);
  const sizeLabel = formatChatAttachmentSize(attachment.size);
  const audioDurationLabel = audioDuration || formatMediaDurationSeconds(Number(
    (attachment as Attachment & {
      durationSeconds?: number;
      voiceNote?: { durationMs?: number };
    }).voiceNote?.durationMs
      ? (attachment as Attachment & { voiceNote: { durationMs: number } }).voiceNote.durationMs / 1000
      : (attachment as Attachment & { durationSeconds?: number }).durationSeconds ?? 0,
  ));
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
    setAudioDuration('');
    setAudioPlaying(false);
  }, [attachment.cid, src]);

  const openAttachment = async () => {
    if (openState === 'pending') return;
    const resolved = src ?? await resolve();
    if (resolved) window.open(resolved, '_blank');
  };

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
        style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start', maxWidth: '100%' }}
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
              src={src}
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
        {sizeLabel && (
          <Text style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start', fontSize: 10, color: token.colorTextQuaternary }}>
            {sizeLabel}
          </Text>
        )}
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

  if (isAudio) {
    const toggleAudioPlayback = () => {
      const audio = audioRef.current;
      if (!audio || !src) return;
      if (audio.paused) {
        audio.play().catch(() => {
          setAudioPlaying(false);
        });
      } else {
        audio.pause();
      }
    };
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
        style={{ alignSelf: isOwn ? 'flex-end' : 'flex-start', maxWidth: '100%' }}
      >
        {src && (
          <audio
            ref={audioRef}
            src={src}
            preload="metadata"
            onLoadedMetadata={(event) => {
              setAudioDuration(formatMediaDurationSeconds(event.currentTarget.duration));
            }}
            onPlay={() => setAudioPlaying(true)}
            onPause={() => setAudioPlaying(false)}
            onEnded={() => setAudioPlaying(false)}
          />
        )}
        <button
          type="button"
          disabled={!src}
          aria-label={audioPlaying
            ? t('chat.social.messageArea.voicePause')
            : t('chat.social.messageArea.voicePlay')}
          onClick={toggleAudioPlayback}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            appearance: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            minWidth: 128,
            width: 'min(210px, 100%)',
            maxWidth: '100%',
            padding: '10px 14px',
            border: 0,
            borderRadius: isOwn ? '10px 4px 10px 10px' : '4px 10px 10px 10px',
            background: voiceBubbleBackground,
            boxShadow: hovered ? token.boxShadowTertiary : 'none',
            color: voiceTextColor,
            cursor: src ? 'pointer' : 'default',
            opacity: src ? 1 : 0.72,
            transition: 'background 120ms ease, box-shadow 120ms ease',
          }}
        >
          <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
            {audioPlaying ? <Pause size={18} /> : <Play size={18} />}
            <Text style={{ color: voiceTextColor, fontSize: 18, fontWeight: 700, lineHeight: 1 }}>
              {audioDurationLabel || t('chat.social.messageArea.voiceDurationUnknown')}
            </Text>
          </Flexbox>
          <Volume2 size={22} color={voiceSecondaryColor} />
        </button>
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
      style={{ maxWidth: '100%' }}
    >
      <Flexbox
        horizontal
        align="center"
        role={canOpen ? 'button' : undefined}
        tabIndex={canOpen ? 0 : undefined}
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
        onClick={openAttachment}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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
