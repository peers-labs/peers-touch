import { describe, expect, it } from 'vitest';

import {
  canRetryOptimistic,
  collectPreviewUrls,
  createOptimisticMessage,
  isOptimisticInFlight,
  optimisticConversationKey,
  patchOptimisticMessage,
  reconcileOptimisticMessages,
  retryOptimisticMessage,
  type LocalAttachmentDraft,
} from './optimisticOutbound';
import type { MessagingLocalAttachmentIntent } from '../services/im-service-contract';

function draft(overrides: Partial<LocalAttachmentDraft> = {}): LocalAttachmentDraft {
  return {
    localId: 'a1',
    previewUrl: 'blob:local/a1',
    ownsPreviewUrl: true,
    filename: 'photo.png',
    mimeType: 'image/png',
    size: 1024,
    isImage: true,
    ...overrides,
  };
}

describe('optimistic outbound core', () => {
  it('keys conversations by kind and ulid', () => {
    expect(optimisticConversationKey('friend', 'c1')).toBe('friend:c1');
    expect(optimisticConversationKey('group', 'g9')).toBe('group:g9');
  });

  it('renders immediately in staging when it carries attachments', () => {
    const message = createOptimisticMessage({
      localId: 'm1',
      sendIntentId: 'intent-1',
      conversationUlid: 'c1',
      kind: 'friend',
      text: '',
      drafts: [draft()],
      nowMs: 1000,
    });
    expect(message.status).toBe('staging');
    expect(message.attachments[0].status).toBe('staging');
    expect(message.attachments[0].previewUrl).toBe('blob:local/a1');
    expect(message.createdAtMs).toBe(1000);
  });

  it('starts a text-only message directly in sending', () => {
    const message = createOptimisticMessage({
      localId: 'm2',
      sendIntentId: 'intent-2',
      conversationUlid: 'c1',
      kind: 'friend',
      text: 'hi',
      drafts: [],
    });
    expect(message.status).toBe('sending');
    expect(message.attachments).toHaveLength(0);
  });

  it('patches status immutably without mutating the original', () => {
    const message = createOptimisticMessage({
      localId: 'm3', sendIntentId: 'i', conversationUlid: 'c', kind: 'friend',
      text: '', drafts: [draft()],
    });
    const next = patchOptimisticMessage(message, {
      status: 'sending', reconciledMessageId: 'ulid-1',
    });
    expect(message.status).toBe('staging');
    expect(next.status).toBe('sending');
    expect(next.reconciledMessageId).toBe('ulid-1');
  });

  it('reconciles only rows whose admitted messageId is now visible', () => {
    const rows = [
      { localId: 'm1', sendIntentId: 'i1', conversationUlid: 'c', kind: 'friend' as const,
        text: '', createdAtMs: 1, status: 'sent' as const, reconciledMessageId: 'ulid-1',
        attachments: [] },
      { localId: 'm2', sendIntentId: 'i2', conversationUlid: 'c', kind: 'friend' as const,
        text: '', createdAtMs: 2, status: 'sending' as const, reconciledMessageId: 'ulid-2',
        attachments: [] },
    ];
    const { keep, reconciled } = reconcileOptimisticMessages(
      rows,
      new Set(['ulid-1']),
    );
    expect(keep.map((row) => row.localId)).toEqual(['m2']);
    expect(reconciled.map((row) => row.localId)).toEqual(['m1']);
  });

  it('keeps a row with no admitted id even after a refresh', () => {
    const rows = [{
      localId: 'm1', sendIntentId: 'i1', conversationUlid: 'c', kind: 'friend' as const,
      text: '', createdAtMs: 1, status: 'sending' as const, attachments: [],
    }];
    const { keep, reconciled } = reconcileOptimisticMessages(rows, new Set(['other']));
    expect(keep).toHaveLength(1);
    expect(reconciled).toHaveLength(0);
  });

  const intent: MessagingLocalAttachmentIntent = {
    filePath: '/tmp/a.png',
    filename: 'photo.png',
    mimeType: 'image/png',
    contentKind: 'file',
    durationMs: 0,
    size: 1024,
  };

  it('retries a failed text-only message without staged intents', () => {
    const failed = patchOptimisticMessage(
      createOptimisticMessage({
        localId: 't1', sendIntentId: 'old', conversationUlid: 'c', kind: 'friend',
        text: 'hi', drafts: [],
      }),
      { status: 'failed', errorCode: 'network' },
    );
    expect(canRetryOptimistic(failed)).toBe(true);
    const retried = retryOptimisticMessage(failed, 'fresh-intent');
    expect(retried.status).toBe('sending');
    expect(retried.sendIntentId).toBe('fresh-intent');
    expect(retried.errorCode).toBeUndefined();
    expect(retried.localId).toBe('t1');
  });

  it('retries a failed attachment message only once all intents are staged', () => {
    const base = createOptimisticMessage({
      localId: 'm', sendIntentId: 'old', conversationUlid: 'c', kind: 'friend',
      text: '', drafts: [draft(), draft({ localId: 'a2' })],
    });
    const failedNoIntents = patchOptimisticMessage(base, { status: 'failed' });
    expect(canRetryOptimistic(failedNoIntents)).toBe(false);
    const failedPartial = patchOptimisticMessage(base, {
      status: 'failed', stagedIntents: [intent],
    });
    expect(canRetryOptimistic(failedPartial)).toBe(false);
    const failedReady = patchOptimisticMessage(base, {
      status: 'failed', stagedIntents: [intent, { ...intent, filename: 'b.png' }],
    });
    expect(canRetryOptimistic(failedReady)).toBe(true);
    const retried = retryOptimisticMessage(failedReady, 'fresh-2');
    expect(retried.stagedIntents).toHaveLength(2);
    expect(retried.reconciledMessageId).toBeUndefined();
    expect(retried.sendIntentId).toBe('fresh-2');
  });

  it('never offers retry for a row that is not failed', () => {
    const sending = createOptimisticMessage({
      localId: 's', sendIntentId: 'i', conversationUlid: 'c', kind: 'friend',
      text: '', drafts: [draft()],
    });
    expect(canRetryOptimistic(sending)).toBe(false);
  });

  it('classifies in-flight states and collects only owned blob urls', () => {
    const staging = createOptimisticMessage({
      localId: 'm', sendIntentId: 'i', conversationUlid: 'c', kind: 'friend',
      text: '', drafts: [draft(), draft({ localId: 'a2', previewUrl: 'http://asset/x' })],
    });
    expect(isOptimisticInFlight(staging)).toBe(true);
    expect(collectPreviewUrls([staging])).toEqual(['blob:local/a1']);
    const done = patchOptimisticMessage(staging, { status: 'sent' });
    expect(isOptimisticInFlight(done)).toBe(false);
  });
});
