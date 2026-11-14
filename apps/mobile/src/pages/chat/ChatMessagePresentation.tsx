import {
  Check,
  CheckCheck,
  Clock,
  Paperclip,
  Mic,
} from 'lucide-react';

import { chatMediaKindForAttachment } from '@peers-touch/client-chat-core';
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
  if (kind === 'image' && sourceUrl) {
    return (
      <button
        type="button"
        className="mobile-attachment-image"
        data-attachment-id={attachmentId}
        onClick={onOpen}
      >
        <img src={sourceUrl} alt={filename} />
        <span className="mobile-attachment-info">
          <span>{filename}</span><small>{stateLabel}</small>
        </span>
      </button>
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
