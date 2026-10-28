import { useCallback, useSyncExternalStore } from 'react';
import { chatAttachmentAccessId, type ChatAttachmentLike } from '@peers-touch/client-chat-core';
import { messagingAttachmentAccess } from '../../messaging/attachmentAccess';
import { AttachmentAccessState } from '../../gen/proto/domain/chat/attachment_pb';

export function useAttachmentAccess(attachment: ChatAttachmentLike, eager = false) {
  const id = chatAttachmentAccessId(attachment);
  const subscribe = useCallback(
    (notify: () => void) => messagingAttachmentAccess.observe(id, notify, eager),
    [id, eager],
  );
  const snapshot = useSyncExternalStore(subscribe, () => messagingAttachmentAccess.snapshot(id));
  const state = snapshot.projection?.state;
  return {
    ...snapshot,
    id,
    src: state === AttachmentAccessState.READY ? snapshot.projection?.assetUrl ?? null : null,
    openState: snapshot.error || state === AttachmentAccessState.FAILED
      ? 'error' as const
      : state === AttachmentAccessState.DOWNLOADING || state === AttachmentAccessState.VERIFYING
        ? 'pending' as const
        : state === AttachmentAccessState.READY ? 'ready' as const : 'idle' as const,
    open: () => messagingAttachmentAccess.open(id, attachment),
  };
}
