import type { ChatComposerDraft } from './chatDraftEnvelope';
import type { messagingRecoverAttachmentComposer } from '../../services/mobileCommands';

export function recoveredComposerDraft(
  saved: ChatComposerDraft | null,
  native: Awaited<ReturnType<typeof messagingRecoverAttachmentComposer>>,
): ChatComposerDraft {
  const adopted = native.adoptedMessage;
  const sourceIds = native.stages.map(stage => stage.stageId);
  if (adopted) return {
    text: adopted.plaintext,
    replyToMessageId: adopted.replyToMessageId,
    threadRootMessageId: adopted.threadRootMessageId,
    pendingMessageId: adopted.messageId,
    encryptedAttachmentRefs: adopted.attachmentIds,
    stagedAttachmentIds: sourceIds,
  };
  return {
    ...(saved ?? { text: '', replyToMessageId: '', encryptedAttachmentRefs: [] }),
    stagedAttachmentIds: sourceIds,
  };
}
