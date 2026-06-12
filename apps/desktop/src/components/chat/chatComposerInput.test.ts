import { describe, expect, it } from 'vitest';

import {
  CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN,
  CHAT_COMPOSER_CAPABILITIES_DESKTOP_THREAD,
  CHAT_COMPOSER_CAPABILITIES_MOBILE_MAIN,
  applyChatDecryptedContentToList,
  applyChatMessageMutationToList,
  applyChatMessageReceiptToList,
  applyChatNotificationsRead,
  applyChatPresenceToMap,
  applyChatTypingStateToMap,
  applyAllChatNotificationsRead,
  bumpChatUnreadCounter,
  buildChatConversationSurfaceItems,
  buildChatMessageSurfaceItems,
  buildChatThreadSurface,
  buildSocialHostEvent,
  canSubmitChatComposerDraft,
  chatUnreadForParticipant,
  chatE2eeProjectionCanSend,
  chatE2eeProjectionError,
  chatMediaKindForAttachment,
  chatMediaKindFromMimeFilename,
  chatMessageRowMaxWidth,
  chatOutboxReadyToDrain,
  chatThreadReplyTargetUlid,
  chatMessageTypeForAttachments,
  chatMessageTypeForMime,
  chatVisualCssVars,
  chatVisualLayoutForSurface,
  countChatThreadReplies,
  clearChatUnreadForParticipant,
  clearChatUnreadCounter,
  clearChatE2eeProjectionStatus,
  deleteChatNotifications,
  enqueueChatOutboxItem,
  failChatOutboxItem,
  filterUnreadChatNotifications,
  filterChatMessagesAfterClearedAt,
  formatChatAttachmentSize,
  completeChatOutboxItem,
  markChatOutboxSending,
  mergeChatMessages,
  mergeChatNotifications,
  mergeUniqueChatMessages,
  normalizeChatAttachmentVisibility,
  projectChatNotificationUnreadCount,
  pruneChatTypingPeers,
  resolveChatComposerCapabilities,
  resolveChatMessageReceiptStatus,
  seedChatPresenceFromParticipants,
  setChatE2eeProjectionStatus,
  shouldSendComposerEnter,
  sumChatUnreadCounters,
  socialHostEventReconcileReason,
  socialHostEventTargetsNotifications,
  type ChatMessageLike,
  visibleChatConversationUnread,
} from '@peers-touch/client-chat-core';

describe('chat composer enter handling', () => {
  it('sends on plain enter', () => {
    expect(shouldSendComposerEnter({ key: 'Enter', shiftKey: false })).toBe(true);
  });

  it('does not send while IME composition is active', () => {
    expect(shouldSendComposerEnter({ key: 'Enter', shiftKey: false, nativeIsComposing: true })).toBe(false);
    expect(shouldSendComposerEnter({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    expect(shouldSendComposerEnter({ key: 'Enter', shiftKey: false, keyCode: 229 })).toBe(false);
    expect(shouldSendComposerEnter({
      key: 'Enter',
      shiftKey: false,
      lastCompositionEndAt: 1000,
      now: 1050,
    })).toBe(false);
  });

  it('keeps shift enter as a newline', () => {
    expect(shouldSendComposerEnter({ key: 'Enter', shiftKey: true })).toBe(false);
  });
});

describe('chat composer media type mapping', () => {
  it('maps common attachment mime types to existing chat message types', () => {
    expect(chatMessageTypeForMime('image/png')).toBe(2);
    expect(chatMessageTypeForMime('audio/webm')).toBe(4);
    expect(chatMessageTypeForMime('video/mp4')).toBe(5);
    expect(chatMessageTypeForMime('application/pdf')).toBe(3);
  });
});

describe('chat media contract helpers', () => {
  it('classifies attachments by mime type or filename fallback', () => {
    expect(chatMediaKindFromMimeFilename('image/png', 'photo.bin')).toBe('image');
    expect(chatMediaKindFromMimeFilename('', 'clip.mp4')).toBe('video');
    expect(chatMediaKindFromMimeFilename('', 'voice.wav')).toBe('audio');
    expect(chatMediaKindFromMimeFilename('application/pdf', 'paper.pdf')).toBe('file');
    expect(chatMediaKindForAttachment({ mime_type: '', filename: 'fallback.webp' })).toBe('image');
  });

  it('maps attachment kind to existing message type and display metadata', () => {
    expect(chatMessageTypeForAttachments([{ mime_type: '', filename: 'fallback.webp' }])).toBe(2);
    expect(chatMessageTypeForAttachments([{ mimeType: 'video/mp4', filename: 'clip.bin' }])).toBe(5);
    expect(chatMessageTypeForAttachments([])).toBeUndefined();
    expect(formatChatAttachmentSize(1536)).toBe('1.5 KB');
    expect(formatChatAttachmentSize(0)).toBe('');
    expect(normalizeChatAttachmentVisibility('chat')).toBe('chat');
    expect(normalizeChatAttachmentVisibility('invalid')).toBeUndefined();
  });
});

describe('chat composer capability profiles', () => {
  it('keeps desktop main fully enabled and thread screenshot-free', () => {
    expect(resolveChatComposerCapabilities(CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN)).toEqual({
      emoji: true,
      file: true,
      screenshot: true,
      voice: true,
    });
    expect(resolveChatComposerCapabilities(CHAT_COMPOSER_CAPABILITIES_DESKTOP_THREAD)).toEqual({
      emoji: true,
      file: true,
      screenshot: false,
      voice: true,
    });
    expect(resolveChatComposerCapabilities(
      CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN,
      { screenshot: false, voice: undefined },
    )).toEqual({
      emoji: true,
      file: true,
      screenshot: false,
      voice: true,
    });
  });

  it('enables mobile emoji and file tools after the media E2EE contract lands', () => {
    expect(resolveChatComposerCapabilities(CHAT_COMPOSER_CAPABILITIES_MOBILE_MAIN)).toEqual({
      emoji: true,
      file: true,
      screenshot: false,
      voice: false,
    });
    expect(canSubmitChatComposerDraft({
      text: '',
      attachmentCount: 1,
      capabilities: CHAT_COMPOSER_CAPABILITIES_MOBILE_MAIN,
    })).toBe(true);
    expect(canSubmitChatComposerDraft({
      text: 'hello',
      capabilities: CHAT_COMPOSER_CAPABILITIES_MOBILE_MAIN,
    })).toBe(true);
  });
});

describe('chat visual layout contract', () => {
  it('keeps Desktop main and thread message geometry under one shared contract', () => {
    const main = chatVisualLayoutForSurface('desktop-main');
    const thread = chatVisualLayoutForSurface('desktop-thread');

    expect(main.avatarSize).toBe(36);
    expect(main.avatarGap).toBe(8);
    expect(main.peerBubbleRadius).toBe('16px 16px 16px 6px');
    expect(main.ownBubbleRadius).toBe('16px 16px 6px 16px');
    expect(main.hoverActionBridgeHeight).toBeGreaterThanOrEqual(18);
    expect(main.hoverActionBridgeInsetX).toBeGreaterThanOrEqual(160);
    expect(chatMessageRowMaxWidth(main, { own: false, groupPeer: true })).toBe('min(82%, 800px)');

    expect(thread.avatarSize).toBe(30);
    expect(thread.composerHasAttachmentTools).toBe(true);
    expect(chatMessageRowMaxWidth(thread, { own: true })).toBe('min(92%, 320px)');
  });

  it('keeps Mobile composer text-only and aligned with message-avatar geometry', () => {
    const mobile = chatVisualLayoutForSurface('mobile-main');
    const cssVars = chatVisualCssVars(mobile);

    expect(mobile.avatarSize).toBe(38);
    expect(mobile.avatarGap).toBe(7);
    expect(mobile.composerHasAttachmentTools).toBe(false);
    expect(mobile.composerShellRadius).toBe(12);
    expect(cssVars['--chat-message-avatar-size']).toBe('38px');
    expect(cssVars['--chat-message-bubble-radius-own']).toBe('17px 17px 5px 17px');
    expect(cssVars['--chat-composer-tool-button-size']).toBe('40px');
  });
});

describe('social host event helpers', () => {
  it('normalizes mobile and desktop host event payloads into one contract', () => {
    expect(buildSocialHostEvent('mobile:push', {
      notification_id: 'n1',
      session_ulid: 's1',
      target: 'notification',
    })).toEqual({
      kind: 'push',
      target: 'notification',
      sessionUlid: 's1',
      notificationId: 'n1',
      url: undefined,
      reason: undefined,
    });
    expect(buildSocialHostEvent('desktop:tray-open', { reason: 'tray' }).kind).toBe('app-resume');
    expect(buildSocialHostEvent('desktop:notification-tap', { notificationId: 'n2' }).kind).toBe('notification-tap');
  });

  it('keeps host events as runtime refresh hints', () => {
    const event = buildSocialHostEvent('mobile:notification-tap', {
      notificationId: 'n1',
      reason: 'tap',
    });

    expect(socialHostEventTargetsNotifications(event)).toBe(true);
    expect(socialHostEventReconcileReason(event)).toBe('host:notification-tap:tap');
    expect(socialHostEventTargetsNotifications({ kind: 'app-resume', reason: 'focus' })).toBe(false);
  });
});

describe('chat surface projection helpers', () => {
  const base = Date.UTC(2026, 0, 1, 10, 0, 0);
  const messages = [
    { ulid: 'root', senderDid: 'a', content: 'root', sentAtMs: base },
    { ulid: 'reply-1', senderDid: 'b', content: 'reply', replyToUlid: 'root', sentAtMs: base + 60_000 },
    { ulid: 'late', senderDid: 'a', content: 'late', sentAtMs: base + 12 * 60_000 },
    { ulid: 'tomorrow', senderDid: 'b', content: 'next day', sentAtMs: base + 24 * 60 * 60_000 },
  ];

  it('projects date separators and timeline gaps from message timestamps', () => {
    const surface = buildChatMessageSurfaceItems({
      messages,
      resolveTimestampMs: (message) => message.sentAtMs,
    });

    expect(surface.map((item) => item.showDateSeparator)).toEqual([true, false, false, true]);
    expect(surface.map((item) => item.timelineGap)).toEqual([false, false, true, false]);
  });

  it('filters cleared messages using the same timestamp resolver', () => {
    expect(filterChatMessagesAfterClearedAt(
      messages,
      base + 10 * 60_000,
      (message) => message.sentAtMs,
    ).map((message) => message.ulid)).toEqual(['late', 'tomorrow']);
  });

  it('counts loaded thread replies by shared thread root semantics', () => {
    expect(countChatThreadReplies(messages, 'root')).toBe(1);
  });
});

describe('chat conversation surface helpers', () => {
  const conversations = [
    { id: 'older', title: 'Alice notes', unread: 3, updatedAt: 1000, preference: { sticky: false } },
    { id: 'muted', title: 'Muted project', unread: 9, updatedAt: 3000, preference: { muted: true } },
    { id: 'sticky', title: 'Pinned group', unread: 2, updatedAt: 2000, preference: { sticky: true } },
  ];

  it('sorts sticky conversations first and suppresses muted unread counts', () => {
    const surface = buildChatConversationSurfaceItems({
      conversations,
      resolvePreference: (conversation) => conversation.preference,
      resolveSearchText: (conversation) => conversation.title,
      resolveUnread: (conversation) => conversation.unread,
      resolveUpdatedAt: (conversation) => conversation.updatedAt,
    });

    expect(surface.map((item) => item.conversation.id)).toEqual(['sticky', 'muted', 'older']);
    expect(surface.map((item) => item.visibleUnread)).toEqual([2, 0, 3]);
  });

  it('filters by normalized conversation search text', () => {
    const surface = buildChatConversationSurfaceItems({
      conversations,
      query: 'PINNED',
      resolvePreference: (conversation) => conversation.preference,
      resolveSearchText: (conversation) => conversation.title,
      resolveUnread: (conversation) => conversation.unread,
      resolveUpdatedAt: (conversation) => conversation.updatedAt,
    });

    expect(surface.map((item) => item.conversation.id)).toEqual(['sticky']);
  });

  it('hides unread when alerts are muted or disabled', () => {
    expect(visibleChatConversationUnread(4, { muted: true })).toBe(0);
    expect(visibleChatConversationUnread(4, { alertEnabled: false })).toBe(0);
    expect(visibleChatConversationUnread(4, { alertEnabled: true })).toBe(4);
  });
});

describe('chat thread surface helpers', () => {
  const currentMessages: ChatMessageLike[] = [
    { ulid: 'root', senderDid: 'a', content: 'root' },
    { ulid: 'inline-reply', senderDid: 'b', content: 'inline reply', replyToUlid: 'root' },
    { ulid: 'other', senderDid: 'c', content: 'other' },
  ];

  it('uses loaded thread replies when available', () => {
    const surface = buildChatThreadSurface({
      rootUlid: 'root',
      currentMessages,
      loadedThreadMessages: [
        { ulid: 'root', senderDid: 'a', content: 'loaded root' },
        { ulid: 'loaded-reply', senderDid: 'b', content: 'loaded reply', threadRootUlid: 'root' },
      ],
    });

    expect(surface.rootMessage?.content).toBe('loaded root');
    expect(surface.replies.map((message) => message.ulid)).toEqual(['loaded-reply']);
    expect(surface.displayMessages.map((message) => message.ulid)).toEqual(['root', 'loaded-reply']);
  });

  it('falls back to timeline replies before the thread is loaded', () => {
    const surface = buildChatThreadSurface({
      rootUlid: 'root',
      currentMessages,
      loadedThreadMessages: [],
    });

    expect(surface.rootMessage?.ulid).toBe('root');
    expect(surface.replies.map((message) => message.ulid)).toEqual(['inline-reply']);
  });

  it('uses the selected reply target before falling back to the root', () => {
    const root = { ulid: 'root', senderDid: 'a', content: 'root' };
    const target = { ulid: 'reply', senderDid: 'b', content: 'reply' };

    expect(chatThreadReplyTargetUlid(root, target)).toBe('reply');
    expect(chatThreadReplyTargetUlid(root, null)).toBe('root');
    expect(chatThreadReplyTargetUlid(null, null)).toBe('');
  });
});

describe('chat reducer helpers', () => {
  const messages = [
    { ulid: 'older', content: 'old', status: 1, sentAtMs: 1000 },
    { ulid: 'newer', content: 'new', status: 1, sentAtMs: 3000 },
  ];

  it('merges messages by ulid and keeps timestamp ordering host-free', () => {
    const merged = mergeChatMessages(
      messages,
      { ulid: 'older', content: 'patched', status: 2, sentAtMs: 1000 },
      {
        resolveTimestampMs: (message) => message.sentAtMs,
        mergeExisting: (current, incoming) => ({ ...current, ...incoming }),
      },
    );

    expect(merged.map((message) => message.ulid)).toEqual(['older', 'newer']);
    expect(merged[0].content).toBe('patched');
    expect(mergeUniqueChatMessages(merged, [
      { ulid: 'older', content: 'duplicate', status: 1, sentAtMs: 1000 },
      { ulid: 'thread-reply', content: 'reply', status: 1, sentAtMs: 4000 },
    ]).map((message) => message.ulid)).toEqual(['older', 'newer', 'thread-reply']);
  });

  it('applies message receipt status monotonically', () => {
    const delivered = resolveChatMessageReceiptStatus('DELIVERED', { delivered: 3, read: 4 });
    const next = applyChatMessageReceiptToList(messages, 'older', delivered);
    expect(next?.[0].status).toBe(3);
    expect(applyChatMessageReceiptToList(next ?? [], 'older', 2)).toBeNull();
  });

  it('applies delete, recall, edit, and decrypted content as idempotent list reducers', () => {
    const recalled = applyChatMessageMutationToList(messages, 'older', { kind: 'RECALL' });
    expect(recalled?.[0]).toMatchObject({ ulid: 'older', content: '', recalled: true });
    expect(applyChatMessageMutationToList(recalled ?? [], 'older', { kind: 'RECALL' })).toBeNull();

    const edited = applyChatMessageMutationToList(messages, 'older', {
      kind: 'EDIT',
      newContent: 'edited',
      mutatedTsUnixMs: 2000,
    }, {
      createEditedAt: (unixMs) => ({ unixMs }),
    });
    expect(edited?.[0]).toMatchObject({ content: 'edited', editedAt: { unixMs: 2000 } });

    const deleted = applyChatMessageMutationToList(messages, 'older', { kind: 'DELETE' });
    expect(deleted?.map((message) => message.ulid)).toEqual(['newer']);

    const decrypted = applyChatDecryptedContentToList(messages, 'older', 'plain');
    expect(decrypted?.[0].content).toBe('plain');
    expect(applyChatDecryptedContentToList(decrypted ?? [], 'older', 'plain')).toBeNull();
  });

  it('updates and prunes typing peers through the shared ephemeral map reducer', () => {
    const next = applyChatTypingStateToMap({}, 's1', 'peer-a', true, 1000);
    expect(next).toEqual({ s1: { 'peer-a': { typing: true, lastUpdate: 1000 } } });
    expect(applyChatTypingStateToMap({}, 's1', 'peer-a', false, 1000)).toBeNull();
    expect(pruneChatTypingPeers(next ?? {}, 1500)).toEqual({});
  });
});

describe('chat E2EE and offline queue domain helpers', () => {
  it('projects E2EE readiness and error state without platform coupling', () => {
    const ready = setChatE2eeProjectionStatus({}, 'group-1', 'ready', { now: 1000 });

    expect(chatE2eeProjectionCanSend(ready, 'group-1')).toBe(true);
    expect(chatE2eeProjectionCanSend(ready, 'missing')).toBe(false);

    const failed = setChatE2eeProjectionStatus(ready, 'group-1', 'error', {
      now: 2000,
      error: 'missing-key-bundle',
    });
    expect(chatE2eeProjectionCanSend(failed, 'group-1')).toBe(false);
    expect(chatE2eeProjectionError(failed, 'group-1')).toBe('missing-key-bundle');
    expect(clearChatE2eeProjectionStatus(failed, 'group-1')).toEqual({});
  });

  it('keeps offline outbox retry state as a pure drainable queue', () => {
    const queued = enqueueChatOutboxItem([], {
      localId: 'local-1',
      scope: 'group',
      conversationId: 'group-1',
      operation: 'send-message',
      payload: { text: 'hello' },
    }, 1000);

    expect(chatOutboxReadyToDrain(queued, 1000).map((item) => item.localId)).toEqual(['local-1']);

    const sending = markChatOutboxSending(queued, 'local-1', 1100);
    expect(sending[0]).toMatchObject({ status: 'sending', attempts: 1, updatedAt: 1100 });
    expect(chatOutboxReadyToDrain(sending, 1200)).toEqual([]);

    const failed = failChatOutboxItem(sending, 'local-1', {
      now: 1200,
      retryDelayMs: 3000,
      error: 'network-offline',
    });
    expect(chatOutboxReadyToDrain(failed, 4199)).toEqual([]);
    expect(chatOutboxReadyToDrain(failed, 4200).map((item) => item.error)).toEqual(['network-offline']);
    expect(completeChatOutboxItem(failed, 'local-1')).toEqual([]);
  });
});

describe('chat presence and notification reducer helpers', () => {
  const notifications = [
    { id: 'older', status: 1, category: 10, createdAtMs: 1000 },
    { id: 'newer', status: 1, category: 20, createdAtMs: 3000 },
  ];

  it('seeds and applies presence without host state coupling', () => {
    const presence = seedChatPresenceFromParticipants(
      [
        { a: 'alice', aOnline: true, b: 'bob', bOnline: false },
        { a: 'alice', aOnline: false, b: 'chris', bOnline: true },
      ],
      (item) => [
        { actorId: item.a, online: item.aOnline },
        { actorId: item.b, online: item.bOnline },
      ],
    );

    expect(presence).toEqual({ alice: true, bob: false, chris: true });
    expect(applyChatPresenceToMap(presence, 'bob', true)).toEqual({ alice: true, bob: true, chris: true });
    expect(applyChatPresenceToMap(presence, 'bob', false)).toBeNull();
  });

  it('merges, counts, marks, and deletes notifications through shared list reducers', () => {
    const merged = mergeChatNotifications(
      notifications,
      [{ id: 'older', status: 2, category: 10, createdAtMs: 1000 }],
      { resolveCreatedAt: (notification) => notification.createdAtMs },
    );
    expect(merged.map((notification) => notification.id)).toEqual(['newer', 'older']);
    expect(merged[1].status).toBe(2);

    expect(filterUnreadChatNotifications(merged, 1).map((notification) => notification.id)).toEqual(['newer']);
    expect(projectChatNotificationUnreadCount({ notifications: merged, unreadStatus: 1, unreadTotal: 0 })).toBe(1);
    expect(projectChatNotificationUnreadCount({ notifications: merged, unreadStatus: 1, unreadTotal: 7 })).toBe(7);

    const readOne = applyChatNotificationsRead(merged, ['newer'], 2, 'now');
    expect(readOne[0]).toMatchObject({ id: 'newer', status: 2, readAt: 'now' });

    const readCategory = applyAllChatNotificationsRead(notifications, 2, 'later', 10);
    expect(readCategory.map((notification) => notification.status)).toEqual([2, 1]);

    expect(deleteChatNotifications(notifications, ['older']).map((notification) => notification.id)).toEqual(['newer']);
  });

  it('keeps unread badge counters as shared pure reducers', () => {
    const bumped = bumpChatUnreadCounter({}, 's1');
    expect(bumpChatUnreadCounter(bumped ?? {}, 's1')).toEqual({ s1: 2 });
    expect(sumChatUnreadCounters({ s1: 2, s2: 3 })).toBe(5);
    expect(clearChatUnreadCounter({ s1: 2, s2: 3 }, 's1')).toEqual({ s2: 3 });
    expect(clearChatUnreadCounter({ s1: 2 }, 'missing')).toBeNull();

    const sessions = [{
      ulid: 's1',
      participantADid: 'alice',
      participantBDid: 'bob',
      unreadCountA: 4,
      unreadCountB: 2,
    }];
    expect(chatUnreadForParticipant(sessions[0], 'alice')).toBe(4);
    expect(chatUnreadForParticipant(sessions[0], 'missing')).toBe(4);
    expect(clearChatUnreadForParticipant(sessions, 's1', 'bob')[0].unreadCountB).toBe(0);
  });
});
