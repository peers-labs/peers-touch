import {
  useEffect,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  Check,
  CheckCheck,
  Clock,
  Image as ImageIcon,
  Paperclip,
  Mic,
} from 'lucide-react';

import {
  chatImageObjectUrlCache,
  chatMediaKindForAttachment,
  recordChatImageGeometry,
  reserveChatImageBox,
} from '@peers-touch/client-chat-core';
import { Button, Icon, IconButton, Text } from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import type { MobileChatAttachmentDraft } from '../../features/chat/chatAttachmentDraftState';
import type { ChatMessageCommandOutcome } from '../../features/chat/messageCommandState';
import type { MessageDeliveryDisplayState } from '../../features/chat/messageProjection';

export function MessageDeliveryStatus({
  state,
  canRetry,
  onRetry,
}: {
  readonly state: MessageDeliveryDisplayState;
  readonly canRetry: boolean;
  readonly onRetry: () => void;
}) {
  const { t } = useMobileI18n();
  if (state === 'failed') {
    return (
      <span className="message-delivery-status failed" data-message-delivery="failed">
        <span>{t(canRetry ? 'mobile.chat.commandFailed' : 'mobile.chat.commandFailedNoRetry')}</span>
        {canRetry ? (
          <Button actionId="chat.message.retry" emphasis="quiet" density="comfortable"
            leading={<Icon iconId="rotate-ccw" size={12} />} onActivate={onRetry}>
            {t('mobile.chat.retryCommand')}
          </Button>
        ) : null}
      </span>
    );
  }
  if (state === 'retrying' || state === 'sending') {
    return (
      <span className="message-delivery-status pending" data-message-delivery={state}>
        <Clock size={12} />
        <span>{t(state === 'retrying' ? 'mobile.chat.commandRetrying' : 'mobile.chat.commandPending')}</span>
      </span>
    );
  }
  if (state === 'read') {
    return (
      <CheckCheck
        aria-label={t('mobile.chat.statusRead')}
        size={13}
        className="message-status-icon read"
        data-message-delivery="read"
      />
    );
  }
  if (state === 'delivered') {
    return (
      <CheckCheck
        aria-label={t('mobile.chat.statusDelivered')}
        size={13}
        className="message-status-icon"
        data-message-delivery="delivered"
      />
    );
  }
  return (
    <Check
      aria-label={t('mobile.chat.statusSent')}
      size={13}
      className="message-status-icon"
      data-message-delivery="sent"
    />
  );
}

export function MessageCommandStatus({
  outcome,
}: {
  readonly outcome: ChatMessageCommandOutcome;
}) {
  const { t } = useMobileI18n();
  const key = outcome.state === 'failed'
    ? 'mobile.chat.commandFailedNoRetry'
    : outcome.state === 'uncertain'
      ? 'mobile.chat.commandUnknown'
      : 'mobile.chat.commandPending';
  return (
    <span
      className={`message-delivery-status ${outcome.state}`}
      data-message-command-kind={outcome.kind}
      data-message-command-state={outcome.state}
    >
      {outcome.state === 'pending' ? <Clock size={12} /> : null}
      <span>{t(key)}</span>
    </span>
  );
}

export function MessageAvatar({
  src,
  fallback,
}: {
  readonly src: string;
  readonly fallback: string;
}) {
  return (
    <MobileAvatar className="message-avatar" src={src}>
      {(fallback || '?').slice(0, 1).toUpperCase()}
    </MobileAvatar>
  );
}

export function AttachmentDraftChip({
  draft,
  disabled,
  onRetry,
  onRemove,
}: {
  readonly draft: MobileChatAttachmentDraft;
  readonly disabled: boolean;
  readonly onRetry: () => void;
  readonly onRemove: () => void;
}) {
  const { t } = useMobileI18n();
  const kind = chatMediaKindForAttachment(draft);
  const label = draft.voiceNote
    ? t('mobile.chat.voicePreview', { seconds: Math.ceil(draft.voiceNote.durationMs / 1000) })
    : draft.filename;
  const audioReady = kind === 'audio' && (draft.status === 'ready' || draft.status === 'submitted');
  return (
    <div className="attachment-draft-chip" data-attachment-draft-id={draft.id}
      data-attachment-draft-state={draft.status} data-attachment-filename={draft.filename}
      data-voice-draft={draft.voiceNote ? 'preview' : undefined}
      data-product-surface={draft.voiceNote && draft.status === 'ready' ? 'chat.voice-preview' : undefined}>
      <div className="attachment-draft-summary">
        {kind === 'image' ? <img src={draft.previewUrl} alt={draft.filename} /> : <Paperclip size={15} />}
        <span className="attachment-draft-label">{label}</span>
      </div>
      <div className="attachment-draft-actions">
      {draft.status === 'failed' ? (
        <IconButton actionId={`chat.attachment.retry.${draft.id}`} iconId="rotate-ccw"
          label={t('common.action.retry')} emphasis="quiet" density="comfortable"
          availability={disabled ? { kind: 'disabled', reason: t('mobile.chat.waitForAttachments') } : undefined}
          onActivate={onRetry} />
      ) : null}
      <IconButton actionId={`chat.attachment.remove.${draft.id}`} iconId="close"
        label={t('common.action.delete')} emphasis="quiet" density="comfortable"
        availability={disabled ? { kind: 'disabled', reason: t('mobile.chat.waitForAttachments') } : undefined}
        onActivate={onRemove} />
      </div>
      {audioReady ? <audio className="attachment-draft-audio" src={draft.previewUrl}
        controls preload="metadata" aria-label={label} /> : null}
    </div>
  );
}

export function ChatMessageSelectionToolbar({
  count, busy, onForward, onHide, onCancel,
}: {
  readonly count: number;
  readonly busy: boolean;
  readonly onForward: () => void;
  readonly onHide: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useMobileI18n();
  const unavailable = busy || count === 0
    ? { kind: 'disabled' as const, reason: t(busy ? 'mobile.chat.commandPending' : 'mobile.chat.selectBeforeAction') }
    : undefined;
  return (
    <div className="message-selection-toolbar" data-product-surface="chat.message-selection">
      <Text>{t('mobile.chat.selectionCount', { count })}</Text>
      <Button actionId="chat.selection.forward" emphasis="quiet" density="comfortable"
        availability={unavailable} onActivate={onForward}>{t('mobile.chat.forward')}</Button>
      <Button actionId="chat.selection.hide" emphasis="quiet" tone="danger" density="comfortable"
        availability={unavailable} onActivate={onHide}>{t('mobile.chat.deleteForMe')}</Button>
      <Button actionId="chat.selection.cancel" emphasis="quiet" density="comfortable"
        availability={busy ? { kind: 'disabled', reason: t('mobile.chat.commandPending') } : undefined}
        onActivate={onCancel}>{t('common.action.cancel')}</Button>
    </div>
  );
}

export function EncryptedAttachmentReferenceChip({
  disabled,
  onRemove,
}: {
  readonly disabled: boolean;
  readonly onRemove: () => void;
}) {
  const { t } = useMobileI18n();
  return (
    <div className="attachment-draft-chip">
      <Paperclip size={15} />
      <span>{t('mobile.chat.attachmentUnnamed')}</span>
      <IconButton actionId="chat.attachment.reference.remove" iconId="close"
        label={t('common.action.delete')} emphasis="quiet" density="comfortable"
        availability={disabled ? { kind: 'disabled', reason: t('mobile.chat.waitForAttachments') } : undefined}
        onActivate={onRemove} />
    </div>
  );
}

// Caps mirror .mobile-attachment-image (max-width: min(220px, 100%)) and its
// img max-height in styles.css, so the reserved box matches the decoded image.
const MOBILE_IMAGE_CONSTRAINTS = { maxWidth: 220, maxHeight: 260 };
// Before the first decode the wire carries no dimensions; hold a stable tile
// instead of collapsing to zero height while the grant URL resolves.
const MOBILE_IMAGE_FALLBACK = { width: 160, height: 96 };

function MobileImageAttachment({
  attachmentId,
  filename,
  sourceUrl,
  onOpen,
}: {
  readonly attachmentId: string;
  readonly filename: string;
  readonly sourceUrl: string;
  readonly onOpen: () => void;
}) {
  const [box, setBox] = useState(() =>
    reserveChatImageBox(attachmentId, MOBILE_IMAGE_CONSTRAINTS, MOBILE_IMAGE_FALLBACK),
  );
  // A stable in-WebView object URL survives grant/asset-URL churn, so
  // re-opening a conversation re-displays the image instantly without
  // re-fetching or re-decoding. Null until the first successful prime.
  const [objectUrl, setObjectUrl] = useState<string | null>(
    () => chatImageObjectUrlCache.get(attachmentId),
  );
  const [loaded, setLoaded] = useState(() => chatImageObjectUrlCache.has(attachmentId));

  // Geometry is keyed to the attachment, not the ephemeral grant URL, so it
  // must not reset when sourceUrl changes.
  useEffect(() => {
    setBox(reserveChatImageBox(attachmentId, MOBILE_IMAGE_CONSTRAINTS, MOBILE_IMAGE_FALLBACK));
  }, [attachmentId]);

  // Resolve a stable object URL: serve the cache immediately on re-open,
  // otherwise prime it from the freshly granted asset URL in the background.
  useEffect(() => {
    const cached = chatImageObjectUrlCache.get(attachmentId);
    if (cached) {
      setObjectUrl(cached);
      setLoaded(true);
      return;
    }
    setObjectUrl(null);
    if (!sourceUrl) return;
    let active = true;
    void chatImageObjectUrlCache.prime(attachmentId, sourceUrl).then((url) => {
      if (active && url) {
        setObjectUrl(url);
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [attachmentId, sourceUrl]);

  const displayUrl = objectUrl ?? sourceUrl;

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      recordChatImageGeometry(attachmentId, image.naturalWidth, image.naturalHeight);
      setBox(reserveChatImageBox(attachmentId, MOBILE_IMAGE_CONSTRAINTS, MOBILE_IMAGE_FALLBACK));
    }
    setLoaded(true);
  };

  return (
    <button
      type="button"
      className="mobile-attachment-image"
      data-attachment-id={attachmentId}
      style={{ width: box.width, height: box.height }}
      aria-label={filename}
      onClick={onOpen}
    >
      {displayUrl ? (
        <img
          src={displayUrl}
          alt={filename}
          className={loaded ? 'is-loaded' : ''}
          onLoad={handleLoad}
        />
      ) : (
        <span className="mobile-attachment-image__placeholder">
          <ImageIcon size={24} />
        </span>
      )}
    </button>
  );
}

export function MessageAttachmentPresentation({
  attachmentId,
  kind,
  filename,
  stateLabel,
  sourceUrl,
  voiceDurationLabel,
  disabled,
  onOpen,
}: {
  readonly attachmentId: string;
  readonly kind: ReturnType<typeof chatMediaKindForAttachment>;
  readonly filename: string;
  readonly stateLabel: string;
  readonly sourceUrl: string;
  readonly voiceDurationLabel?: string;
  readonly disabled: boolean;
  readonly onOpen: () => void;
}) {
  // Images always render as an image tile (with a reserved placeholder while
  // the grant URL resolves), never as a filename file card — so a cold start
  // or conversation switch does not swap the picture for a paperclip row.
  if (kind === 'image') {
    return (
      <MobileImageAttachment
        attachmentId={attachmentId}
        filename={filename}
        sourceUrl={sourceUrl}
        onOpen={onOpen}
      />
    );
  }
  if (kind === 'audio' && sourceUrl && voiceDurationLabel) {
    return (
      <div className="mobile-attachment-audio" data-attachment-id={attachmentId}>
        <span className="mobile-attachment-audio-heading">
          <Mic size={15} />
          <span>{voiceDurationLabel || filename}</span>
        </span>
        <audio src={sourceUrl} controls preload="metadata" />
      </div>
    );
  }
  return (
    <button
      type="button"
      className="mobile-attachment-card"
      data-attachment-id={attachmentId}
      onClick={onOpen}
      disabled={disabled}
    >
      <Paperclip size={16} />
      <span className="mobile-attachment-info">
        <span>{filename}</span>
        <small>{stateLabel}</small>
      </span>
    </button>
  );
}
