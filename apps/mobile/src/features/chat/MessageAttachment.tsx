import { useCallback, useSyncExternalStore } from 'react';
import {
  chatAttachmentAccessId,
  CHAT_INLINE_IMAGE_LIMIT,
  chatMediaKindForAttachment,
  formatChatAttachmentSize,
} from '@peers-touch/client-chat-core';
import { useMobileI18n } from '../../app/mobileI18n';
import { AttachmentAccessState } from '../../gen/proto/domain/chat/attachment_pb';
import { mobileAttachmentAccess } from '../../runtimes/attachmentAccess';
import { MessageAttachmentPresentation } from '../../pages/chat/ChatMessagePresentation';
import type { SocialMessageAttachment } from '../social/socialTypes';

export function useMobileAttachmentAccess(id: string, eager = false) {
  const subscribe = useCallback(
    (notify: () => void) => mobileAttachmentAccess.observe(id, notify, eager), [id, eager],
  );
  return useSyncExternalStore(subscribe, () => mobileAttachmentAccess.snapshot(id));
}

export function MobileMessageAttachmentItem({ attachment }: { attachment: SocialMessageAttachment }) {
  const { t } = useMobileI18n();
  const id = chatAttachmentAccessId(attachment);
  const kind = chatMediaKindForAttachment(attachment);
  const duration = attachment.voiceNote?.durationMs ?? 0;
  const voice = duration > 0 && kind === 'audio';
  const { projection, error } = useMobileAttachmentAccess(id, kind === 'image' || voice);
  const state = projection?.state;
  const filename = projection?.filename || attachment.filename || t('chat.attachment.unnamed');
  const stateKey = error || state === AttachmentAccessState.FAILED ? 'failed'
    : state === AttachmentAccessState.CANCELLED ? 'cancelled'
      : state === AttachmentAccessState.VERIFYING ? 'verifying'
        : state === AttachmentAccessState.DOWNLOADING ? 'downloading'
          : state === AttachmentAccessState.READY ? 'ready' : 'remote';
  return (
    <MessageAttachmentPresentation
      attachmentId={id}
      kind={kind}
      filename={filename}
      stateLabel={`${formatChatAttachmentSize(projection?.plaintextSize ?? attachment.size)} · ${t(`chat.attachment.${stateKey}`)}`}
      sourceUrl={state === AttachmentAccessState.READY
        && (kind !== 'image' || Number(projection?.plaintextSize ?? attachment.size) <= CHAT_INLINE_IMAGE_LIMIT)
        ? projection?.assetUrl ?? '' : ''}
      voiceDurationLabel={voice ? `${Math.floor(duration / 60_000)}:${String(Math.round(duration / 1000) % 60).padStart(2, '0')}` : undefined}
      disabled={!id}
      onOpen={() => mobileAttachmentAccess.open(id, attachment)}
    />
  );
}
