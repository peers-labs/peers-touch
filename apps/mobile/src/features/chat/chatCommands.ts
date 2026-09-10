/**
 * chatCommands.ts — Typed command dispatchers for chat interactions.
 *
 * Pages dispatch commands through these functions instead of calling
 * store actions directly. Messaging commands delegate to the native
 * Messaging Engine, which owns durable command/outbox state. Non-messaging
 * social administration continues to use InteractionAdmission.
 */

import { getInteractionAdmission, type CommandEnvelope } from '../../runtimes/commandRuntime';
import { useSocialStore } from '../social/socialStore';
import { useGroupStore } from '../group/groupStore';
import type { UpdateFriendConversationSettingsInput } from '../social/socialApiTypes';
import type {
  MessagingAttachmentStageProjection,
  MessagingSubmitCommandResult,
} from '../../services/mobileCommands';
import type { ChatActionState } from './chatActionState';
import { chatActionKey, defaultChatActionState, saveChatActionStates } from './chatActionState';
import type { MobileAuthSession } from '../auth/authSession';

// ---------------------------------------------------------------------------
// Command type constants
// ---------------------------------------------------------------------------

const CMD_BLOCK_USER = 'social.block-user';
const CMD_UNBLOCK_USER = 'social.unblock-user';
const CMD_GROUP_UPDATE = 'group.update';
const CMD_GROUP_INVITE = 'group.invite';
const CMD_GROUP_LEAVE = 'group.leave';
const CMD_GROUP_REMOVE_MEMBER = 'group.remove-member';
const CMD_GROUP_UPDATE_MEMBER = 'group.update-member';
const CMD_GROUP_TRANSFER = 'group.transfer-ownership';
const CMD_GROUP_DISSOLVE = 'group.dissolve';

// ---------------------------------------------------------------------------
// Command admission helper
// ---------------------------------------------------------------------------

async function admitCommand(envelope: CommandEnvelope): Promise<string> {
  const admission = getInteractionAdmission();
  return admission.admit(envelope);
}

async function markCommitted(commandId: string): Promise<void> {
  const admission = getInteractionAdmission();
  await admission.markCommitted(commandId);
}

async function markFailed(commandId: string, reason: string): Promise<void> {
  const admission = getInteractionAdmission();
  await admission.markFailed(commandId, reason);
}

// ---------------------------------------------------------------------------
// Friend chat commands
// ---------------------------------------------------------------------------

export async function dispatchSendMessage(
  sessionUlid: string,
  content: string,
  attachments: MessagingAttachmentStageProjection[],
): Promise<MessagingSubmitCommandResult | null> {
  return useSocialStore.getState().sendMessage(sessionUlid, content, attachments);
}

export async function dispatchEditMessage(
  sessionUlid: string,
  messageUlid: string,
  newContent: string,
): Promise<void> {
  await useSocialStore.getState().editMessage(sessionUlid, messageUlid, newContent);
}

export async function dispatchRecallMessage(
  sessionUlid: string,
  messageUlid: string,
): Promise<void> {
  await useSocialStore.getState().recallMessage(sessionUlid, messageUlid);
}

export async function dispatchBlockUser(targetPtid: string): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_BLOCK_USER,
    category: 'social',
    orderingKey: `block:${targetPtid}`,
    payloadJson: JSON.stringify({ targetPtid }),
  });

  try {
    await useSocialStore.getState().blockUser(targetPtid);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'block_failed');
    throw error;
  }
}

export async function dispatchUnblockUser(targetPtid: string): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_UNBLOCK_USER,
    category: 'social',
    orderingKey: `block:${targetPtid}`,
    payloadJson: JSON.stringify({ targetPtid }),
  });

  try {
    await useSocialStore.getState().unblockUser(targetPtid);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'unblock_failed');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Group chat commands
// ---------------------------------------------------------------------------

export async function dispatchGroupSendMessage(
  groupUlid: string,
  plaintext: string,
  attachments: MessagingAttachmentStageProjection[],
): Promise<MessagingSubmitCommandResult> {
  return useGroupStore.getState().sendMessage(groupUlid, plaintext, attachments);
}

export async function dispatchGroupEditMessage(
  groupUlid: string,
  messageUlid: string,
  plaintext: string,
): Promise<void> {
  await useGroupStore.getState().editMessage(groupUlid, messageUlid, plaintext);
}

export async function dispatchGroupRecallMessage(
  groupUlid: string,
  messageUlid: string,
): Promise<void> {
  await useGroupStore.getState().recallMessage(groupUlid, messageUlid);
}

export async function dispatchGroupUpdate(
  groupUlid: string,
  input: { name?: string; description?: string; muted?: boolean },
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_UPDATE,
    category: 'social',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid, ...input }),
  });

  try {
    await useGroupStore.getState().updateGroup(groupUlid, input);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'update_failed');
    throw error;
  }
}

export async function dispatchGroupInviteMembers(
  groupUlid: string,
  inviteePtids: string[],
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_INVITE,
    category: 'social',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid, inviteePtids }),
  });

  try {
    await useGroupStore.getState().inviteMembers(groupUlid, inviteePtids);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'invite_failed');
    throw error;
  }
}

export async function dispatchGroupLeave(groupUlid: string): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_LEAVE,
    category: 'social',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid }),
  });

  try {
    await useGroupStore.getState().leaveGroup(groupUlid);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'leave_failed');
    throw error;
  }
}

export async function dispatchGroupRemoveMember(
  groupUlid: string,
  actorPtid: string,
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_REMOVE_MEMBER,
    category: 'social',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid, actorPtid }),
  });

  try {
    await useGroupStore.getState().removeMember(groupUlid, actorPtid);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'remove_failed');
    throw error;
  }
}

export async function dispatchGroupUpdateMember(
  groupUlid: string,
  actorPtid: string,
  input: { role?: number; muted?: boolean },
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_UPDATE_MEMBER,
    category: 'social',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid, actorPtid, ...input }),
  });

  try {
    await useGroupStore.getState().updateMember(groupUlid, actorPtid, input);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'update_member_failed');
    throw error;
  }
}

export async function dispatchGroupTransferOwnership(
  groupUlid: string,
  nextOwnerPtid: string,
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_TRANSFER,
    category: 'social',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid, nextOwnerPtid }),
  });

  try {
    await useGroupStore.getState().transferOwnership(groupUlid, nextOwnerPtid);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'transfer_failed');
    throw error;
  }
}

export async function dispatchGroupDissolve(groupUlid: string): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_DISSOLVE,
    category: 'social',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid }),
  });

  try {
    await useGroupStore.getState().dissolveGroup(groupUlid);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'dissolve_failed');
    throw error;
  }
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
    ...(patch.clearedAt !== undefined ? { clearedAt: patch.clearedAt } : {}),
  };
}

export function groupPatchFromActionPatch(patch: Partial<ChatActionState>) {
  return {
    ...(patch.muted !== undefined ? { isMuted: patch.muted } : {}),
    ...(patch.sticky !== undefined ? { isPinned: patch.sticky } : {}),
    ...(patch.alertEnabled !== undefined ? { alertEnabled: patch.alertEnabled } : {}),
    ...(patch.background !== undefined ? { background: patch.background } : {}),
    ...(patch.clearedAt !== undefined ? { clearedAt: patch.clearedAt } : {}),
  };
}
