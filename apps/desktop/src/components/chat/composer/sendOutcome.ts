import type { MessagingSendOutcomeRecord } from '../../../services/im-service-contract';

export function didQueueExpectedChatAttachments(
  previousRevision: number,
  expectedAttachmentCount: number,
  record: MessagingSendOutcomeRecord | undefined,
): boolean {
  if (!record || record.revision <= previousRevision) return false;

  const { outcome } = record;
  return outcome.state === 'pending'
    && Boolean(outcome.commandId)
    && outcome.attachmentCount === expectedAttachmentCount
    && outcome.attachmentCount === outcome.attachmentIds.length;
}
