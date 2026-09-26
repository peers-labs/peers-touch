import { useSocialStore } from '../social/socialStore';
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
import type { ChatActionState } from './chatActionState';
import { projectMessagingMessage } from './messageProjection';

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
  _kind: ChatConversationKind,
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
    messages: rows.map((message) => projectMessagingMessage(conversationId, message)),
    nextCursor,
  };
}

export async function dispatchLoadConversationHistory(
  _kind: ChatConversationKind,
  conversationId: string,
): Promise<void> {
  await useSocialStore.getState().loadMessages(conversationId);
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
    admissionDomain: kind === 'group' ? 'group' : 'social',
    sourceConversationId,
    sourceMessageId,
    destinationConversationId,
  });
}

export async function dispatchHideMessageForMe(
  _kind: ChatConversationKind,
  conversationId: string,
  messageId: string,
): Promise<MessagingPendingCommandResult> {
  return useSocialStore.getState().hideMessageForActor(conversationId, messageId);
}

export async function dispatchModerateMessage(
  conversationId: string,
  messageId: string,
  reasonCode: string,
): Promise<MessagingPendingCommandResult> {
  return useSocialStore.getState().moderateMessage(
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
// Shared message metadata commands
// ---------------------------------------------------------------------------

export async function dispatchMessageReaction(
  _kind: ChatConversationKind,
  conversationId: string,
  messageId: string,
  reaction: string,
  remove: boolean,
  threadRootMessageId?: string,
): Promise<MessagingPendingCommandResult> {
  return useSocialStore.getState().setMessageReaction(
    conversationId,
    messageId,
    reaction,
    remove,
    threadRootMessageId,
  );
}

export async function dispatchMessagePin(
  _kind: ChatConversationKind,
  conversationId: string,
  messageId: string,
  remove: boolean,
  threadRootMessageId?: string,
): Promise<MessagingPendingCommandResult> {
  return useSocialStore.getState().setMessagePinned(
    conversationId,
    messageId,
    remove,
    threadRootMessageId,
  );
}

// ---------------------------------------------------------------------------
// Group conversation commands
// ---------------------------------------------------------------------------

export async function dispatchGroupUpdate(
  conversationId: string,
  input: { name?: string; description?: string },
): Promise<void> {
  await useSocialStore.getState().updateGroupConversation(conversationId, input);
}

export async function dispatchGroupInviteMember(
  conversationId: string,
  targetPtid: string,
): Promise<void> {
  await useSocialStore.getState().addGroupMember(conversationId, targetPtid);
}

export async function dispatchGroupRemoveMember(
  conversationId: string,
  targetPtid: string,
): Promise<void> {
  await useSocialStore.getState().removeGroupMember(conversationId, targetPtid);
}

export async function dispatchGroupUpdateMember(
  conversationId: string,
  targetPtid: string,
  input: { role?: 'member' | 'admin'; muted?: boolean },
): Promise<void> {
  await useSocialStore.getState().updateGroupMemberAuthority(
    conversationId,
    targetPtid,
    input,
  );
}

export async function dispatchGroupTransferOwnership(
  conversationId: string,
  nextOwnerPtid: string,
): Promise<void> {
  await useSocialStore.getState().transferGroupOwnership(
    conversationId,
    nextOwnerPtid,
  );
}

export async function dispatchGroupLeave(conversationId: string): Promise<void> {
  await useSocialStore.getState().leaveGroup(conversationId);
}

export async function dispatchGroupDissolve(conversationId: string): Promise<void> {
  await useSocialStore.getState().dissolveGroup(conversationId);
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
