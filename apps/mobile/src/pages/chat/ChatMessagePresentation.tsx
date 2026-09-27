import type { ReactNode } from 'react';
import { Typography } from 'antd';
import {
  Check,
  CheckCheck,
  Clock,
  Mic,
  Paperclip,
  RotateCcw,
  X,
} from 'lucide-react';

import { chatMediaKindForAttachment } from '@peers-touch/client-chat-core';

import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import type { MobileChatAttachmentDraft } from '../../features/chat/chatAttachmentDraftState';
import type { ChatMessageCommandOutcome } from '../../features/chat/messageCommandState';
import type { MessageDeliveryDisplayState } from '../../features/chat/messagingProjectionAdapters';

const { Text } = Typography;

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
          <button type="button" className="message-retry-button" onClick={onRetry}>
            <RotateCcw size={12} />
            <span>{t('mobile.chat.retryCommand')}</span>
          </button>
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

export function ComposerToolButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button className="composer-tool-option" type="button" onClick={onClick} disabled={disabled}>
      <span className="composer-tool-option-icon">{icon}</span>
      <span>{label}</span>
    </button>
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
  return (
    <div className="attachment-draft-chip">
      {kind === 'image' ? (
        <img src={draft.previewUrl} alt={draft.filename} />
      ) : kind === 'audio' ? (
        <audio src={draft.previewUrl} controls preload="metadata" />
      ) : (
        <Paperclip size={15} />
      )}
      <span>{draft.filename}</span>
      {draft.status === 'failed' ? (
        <button type="button" onClick={onRetry} aria-label={t('common.action.retry')} disabled={disabled}>
          <RotateCcw size={12} />
        </button>
      ) : null}
      <button type="button" onClick={onRemove} aria-label={t('common.action.delete')} disabled={disabled}>
        <X size={12} />
      </button>
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
      <button type="button" onClick={onRemove} aria-label={t('common.action.delete')} disabled={disabled}>
        <X size={12} />
      </button>
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
      </button>
    );
  }
  if (kind === 'audio' && sourceUrl) {
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
