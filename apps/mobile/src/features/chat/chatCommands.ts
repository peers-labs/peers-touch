/**
 * chatCommands.ts — Typed command dispatchers for chat interactions.
 *
 * Pages dispatch commands through these functions instead of calling
 * store actions directly. Messaging commands delegate to the native
 * Messaging Engine, which owns durable command/outbox state. Social block
 * writes remain online-only until their generated command/result owner lands.
 */

import { useSocialStore } from '../social/socialStore';
import { useGroupStore } from '../group/groupStore';
import type { UpdateFriendConversationSettingsInput } from '../social/socialApiTypes';
import type {
  MessagingAttachmentStageProjection,
  MessagingPendingCommandResult,
  MessagingSubmitCommandResult,
} from '../../services/mobileCommands';
import {
  messagingForwardMessage,
  messagingSearchMessages,
} from '../../services/mobileCommands';
import type { MobileAuthSession } from '../auth/authSession';
import { friendMessageFromMessaging, groupMessageFromMessaging } from './messagingProjectionAdapters';
import type { ChatActionState } from './chatActionState';

export type ChatConversationKind = 'friend' | 'group';

export interface ChatMessageSendContext {
  replyToMessageId?: string;
  threadRootMessageId?: string;
}

export interface ChatSearchCursor {
  readonly beforeTimestampUnixMs: number;
  readonly beforeMessageId: string;
}

export async function dispatchSearchMessages(
  session: MobileAuthSession,
  kind: ChatConversationKind,
  conversationId: string,
  query: string,
  cursor?: ChatSearchCursor,
) {
  const current = () => useSocialStore.getState().authSession === session;
  if (!current()) throw new Error('mobile.social.notAuthenticated');
  const rows = await messagingSearchMessages({
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorRef.ptid,
    conversationId,
    query,
    limit: 100,
    ...cursor,
  });
  if (!current()) throw new Error('mobile.social.notAuthenticated');
  const last = rows.at(-1);
  const nextCursor = rows.length === 100 && last ? {
    beforeTimestampUnixMs: last.timestampUnixMs,
    beforeMessageId: last.messageId,
  } : null;
  if (nextCursor && cursor
    && (nextCursor.beforeTimestampUnixMs > cursor.beforeTimestampUnixMs
      || (nextCursor.beforeTimestampUnixMs === cursor.beforeTimestampUnixMs
        && nextCursor.beforeMessageId >= cursor.beforeMessageId))) {
    throw new Error('mobile.chat.searchFailed');
  }
  return {
    messages: rows.map((row) => kind === 'group'
      ? groupMessageFromMessaging(conversationId, row)
      : friendMessageFromMessaging(conversationId, row)),
    nextCursor,
  };
}

export async function dispatchLoadConversationHistory(
  kind: ChatConversationKind,
  conversationId: string,
): Promise<void> {
  if (kind === 'group') await useGroupStore.getState().loadMessages(conversationId);
  else await useSocialStore.getState().loadMessages(conversationId);
}

// ---------------------------------------------------------------------------
// Friend chat commands
// ---------------------------------------------------------------------------

export async function dispatchSendMessage(
  sessionUlid: string,
  content: string,
  attachments: MessagingAttachmentStageProjection[],
  context?: ChatMessageSendContext,
): Promise<MessagingSubmitCommandResult | null> {
  return useSocialStore.getState().sendMessage(
    sessionUlid,
    content,
    attachments,
    context,
  );
}

export async function dispatchEditMessage(
  sessionUlid: string,
  messageUlid: string,
  newContent: string,
): Promise<MessagingPendingCommandResult> {
  return useSocialStore.getState().editMessage(
    sessionUlid,
    messageUlid,
    newContent,
  );
}

export async function dispatchRecallMessage(
  sessionUlid: string,
  messageUlid: string,
): Promise<MessagingPendingCommandResult> {
  return useSocialStore.getState().recallMessage(sessionUlid, messageUlid);
}

export async function dispatchForwardMessage(
  session: MobileAuthSession,
  kind: ChatConversationKind,
  sourceConversationId: string,
  sourceMessageId: string,
  destinationConversationId: string,
): Promise<MessagingSubmitCommandResult> {
  return messagingForwardMessage({
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorRef.ptid,
    deviceId: session.deviceId,
    lifecycleGeneration: session.lifecycleGeneration,
    admissionDomain: kind === 'group' ? 'group' : 'social',
    sourceConversationId,
    sourceMessageId,
    destinationConversationId,
  });
}

export async function dispatchHideMessageForMe(
  kind: ChatConversationKind,
  conversationId: string,
  messageId: string,
): Promise<MessagingPendingCommandResult> {
  return kind === 'group'
    ? useGroupStore.getState().hideMessageForActor(conversationId, messageId)
    : useSocialStore.getState().hideMessageForActor(conversationId, messageId);
}

export async function dispatchModerateMessage(
  conversationId: string,
  messageId: string,
  reasonCode: string,
): Promise<MessagingPendingCommandResult> {
  return useGroupStore.getState().moderateMessage(
    conversationId,
    messageId,
    reasonCode,
  );
}

export async function dispatchBlockUser(targetPtid: string): Promise<void> {
  await useSocialStore.getState().blockUser(targetPtid);
}

export async function dispatchUnblockUser(targetPtid: string): Promise<void> {
  await useSocialStore.getState().unblockUser(targetPtid);
}

// ---------------------------------------------------------------------------
// Group chat commands
// ---------------------------------------------------------------------------

export async function dispatchGroupSendMessage(
  groupUlid: string,
  plaintext: string,
  attachments: MessagingAttachmentStageProjection[],
  context?: ChatMessageSendContext,
): Promise<MessagingSubmitCommandResult> {
  return useGroupStore.getState().sendMessage(
    groupUlid,
    plaintext,
    attachments,
    context,
  );
}

export async function dispatchGroupEditMessage(
  groupUlid: string,
  messageUlid: string,
  plaintext: string,
): Promise<MessagingPendingCommandResult> {
  return useGroupStore.getState().editMessage(
    groupUlid,
    messageUlid,
    plaintext,
  );
}

export async function dispatchGroupRecallMessage(
  groupUlid: string,
  messageUlid: string,
): Promise<MessagingPendingCommandResult> {
  return useGroupStore.getState().recallMessage(groupUlid, messageUlid);
}

// ---------------------------------------------------------------------------
// Shared friend/group message metadata commands
// ---------------------------------------------------------------------------

export async function dispatchMessageReaction(
  kind: ChatConversationKind,
  conversationId: string,
  messageId: string,
  reaction: string,
  remove: boolean,
  threadRootMessageId?: string,
): Promise<MessagingPendingCommandResult> {
  if (kind === 'group') {
    return useGroupStore.getState().setMessageReaction(
      conversationId,
      messageId,
      reaction,
      remove,
      threadRootMessageId,
    );
  }
  return useSocialStore.getState().setMessageReaction(
    conversationId,
    messageId,
    reaction,
    remove,
    threadRootMessageId,
  );
}

export async function dispatchMessagePin(
  kind: ChatConversationKind,
  conversationId: string,
  messageId: string,
  remove: boolean,
  threadRootMessageId?: string,
): Promise<MessagingPendingCommandResult> {
  if (kind === 'group') {
    return useGroupStore.getState().setMessagePinned(
      conversationId,
      messageId,
      remove,
      threadRootMessageId,
    );
  }
  return useSocialStore.getState().setMessagePinned(
    conversationId,
    messageId,
    remove,
    threadRootMessageId,
  );
}

export async function dispatchGroupUpdate(
  groupUlid: string,
  input: { name?: string; description?: string; muted?: boolean },
): Promise<void> {
  await useGroupStore.getState().updateGroup(groupUlid, input);
}

export async function dispatchGroupInviteMembers(
  groupUlid: string,
  inviteePtids: string[],
): Promise<void> {
  await useGroupStore.getState().inviteMembers(groupUlid, inviteePtids);
}

export async function dispatchGroupLeave(groupUlid: string): Promise<void> {
  await useGroupStore.getState().leaveGroup(groupUlid);
}

export async function dispatchGroupRemoveMember(
  groupUlid: string,
  actorPtid: string,
): Promise<void> {
  await useGroupStore.getState().removeMember(groupUlid, actorPtid);
}

export async function dispatchGroupUpdateMember(
  groupUlid: string,
  actorPtid: string,
  input: { role?: number; muted?: boolean },
): Promise<void> {
  await useGroupStore.getState().updateMember(groupUlid, actorPtid, input);
}

export async function dispatchGroupTransferOwnership(
  groupUlid: string,
  nextOwnerPtid: string,
): Promise<void> {
  await useGroupStore.getState().transferOwnership(groupUlid, nextOwnerPtid);
}

export async function dispatchGroupDissolve(groupUlid: string): Promise<void> {
  await useGroupStore.getState().dissolveGroup(groupUlid);
}

// ---------------------------------------------------------------------------
// Settings command helpers
// ---------------------------------------------------------------------------

export function friendPatchFromActionPatch(patch: Partial<ChatActionState>): UpdateFriendConversationSettingsInput {
  return {
    ...(patch.muted !== undefined ? { isMuted: patch.muted } : {}),
    ...(patch.sticky !== undefined ? { isPinned: patch.sticky } : {}),
    ...(patch.alertEnabled !== undefined ? { alertEnabled: patch.alertEnabled } : {}),
    ...(patch.background !== undefined ? { background: patch.background } : {}),
  };
}

export function groupPatchFromActionPatch(patch: Partial<ChatActionState>) {
  return {
    ...(patch.muted !== undefined ? { isMuted: patch.muted } : {}),
    ...(patch.sticky !== undefined ? { isPinned: patch.sticky } : {}),
    ...(patch.alertEnabled !== undefined ? { alertEnabled: patch.alertEnabled } : {}),
    ...(patch.background !== undefined ? { background: patch.background } : {}),
  };
}
