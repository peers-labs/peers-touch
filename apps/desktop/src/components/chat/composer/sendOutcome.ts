import type { MessagingSendOutcomeRecord } from '../../../services/im-service-contract';

export function didQueueExpectedChatAttachments(
  previousRevision: number,
  expectedAttachmentCount: number,
  record: MessagingSendOutcomeRecord | undefined,
): boolean {
  if (!record || record.revision <= previousRevision) return false;

  // MP-D33: both a prepared command (`pending`) and a deferred `draft` are
  // durable admissions — staged attachment rows are already engine-owned,
  // including deferred uploads resumed by the lifecycle worker. Releasing
  // the composer draft here is what prevents the incident's duplicate
  // attachment card. Terminal `attachment_failed` is not releasable.
  const { outcome } = record;
  const admitted = outcome.state === 'pending'
    ? Boolean(outcome.commandId)
    : outcome.state === 'draft';
  return admitted
    && outcome.attachmentCount === expectedAttachmentCount
    && outcome.attachmentCount === outcome.attachmentIds.length;
}
