/**
 * chatCommands.ts — Typed command dispatchers for chat interactions.
 *
 * Pages dispatch commands through these functions instead of calling
 * store actions directly. Each command creates a CommandEnvelope and
 * submits it through InteractionAdmission (W4 ledger), then calls the
 * store action. The ledger tracks pending/failed/unknown outcomes that
 * pages can render.
 */

import { getInteractionAdmission, type CommandEnvelope } from '../../runtimes/commandRuntime';
import { useSocialStore } from '../social/socialStore';
import { useGroupStore } from '../group/groupStore';
import type { ChatAttachmentInput, UpdateFriendConversationSettingsInput } from '../social/socialApiTypes';
import type { ChatActionState } from './chatActionState';
import { chatActionKey, defaultChatActionState, saveChatActionStates } from './chatActionState';
import type { MobileAuthSession } from '../auth/authSession';

// ---------------------------------------------------------------------------
// Command type constants
// ---------------------------------------------------------------------------

const CMD_SEND_MESSAGE = 'chat.send-message';
const CMD_EDIT_MESSAGE = 'chat.edit-message';
const CMD_RECALL_MESSAGE = 'chat.recall-message';
const CMD_DELETE_MESSAGE = 'chat.delete-message';
const CMD_SEND_TYPING = 'chat.send-typing';
const CMD_UPDATE_SETTINGS = 'chat.update-settings';
const CMD_BLOCK_USER = 'social.block-user';
const CMD_UNBLOCK_USER = 'social.unblock-user';
const CMD_GROUP_SEND = 'group.send-message';
const CMD_GROUP_EDIT = 'group.edit-message';
const CMD_GROUP_RECALL = 'group.recall-message';
const CMD_GROUP_DELETE = 'group.delete-message';
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
  attachments: ChatAttachmentInput[],
  messageType: number,
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_SEND_MESSAGE,
    category: 'chat',
    orderingKey: `friend:${sessionUlid}`,
    payloadJson: JSON.stringify({ sessionUlid, content, messageType }),
  });

  try {
    await useSocialStore.getState().sendMessage(sessionUlid, content, attachments, messageType);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'send_failed');
    throw error;
  }
}

export async function dispatchEditMessage(
  sessionUlid: string,
  messageUlid: string,
  newContent: string,
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_EDIT_MESSAGE,
    category: 'chat',
    orderingKey: `friend:${sessionUlid}`,
    payloadJson: JSON.stringify({ sessionUlid, messageUlid }),
  });

  try {
    await useSocialStore.getState().editMessage(sessionUlid, messageUlid, newContent);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'edit_failed');
    throw error;
  }
}

export async function dispatchRecallMessage(
  sessionUlid: string,
  messageUlid: string,
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_RECALL_MESSAGE,
    category: 'chat',
    orderingKey: `friend:${sessionUlid}`,
    payloadJson: JSON.stringify({ sessionUlid, messageUlid }),
  });

  try {
    await useSocialStore.getState().recallMessage(sessionUlid, messageUlid);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'recall_failed');
    throw error;
  }
}

export async function dispatchDeleteMessage(
  sessionUlid: string,
  messageUlid: string,
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_DELETE_MESSAGE,
    category: 'chat',
    orderingKey: `friend:${sessionUlid}`,
    payloadJson: JSON.stringify({ sessionUlid, messageUlid }),
  });

  try {
    await useSocialStore.getState().deleteMessage(sessionUlid, messageUlid);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'delete_failed');
    throw error;
  }
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
  attachments: ChatAttachmentInput[],
  messageType: number,
): Promise<boolean> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_SEND,
    category: 'chat',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid, messageType }),
  });

  try {
    const result = await useGroupStore.getState().sendEncryptedMessage(groupUlid, plaintext, attachments, messageType);
    if (result) {
      await markCommitted(commandId);
    } else {
      await markFailed(commandId, 'encryption_not_ready');
    }
    return result;
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'send_failed');
    throw error;
  }
}

export async function dispatchGroupEditMessage(
  groupUlid: string,
  messageUlid: string,
  plaintext: string,
): Promise<boolean> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_EDIT,
    category: 'chat',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid, messageUlid }),
  });

  try {
    const result = await useGroupStore.getState().editEncryptedMessage(groupUlid, messageUlid, plaintext);
    if (result) {
      await markCommitted(commandId);
    } else {
      await markFailed(commandId, 'encryption_not_ready');
    }
    return result;
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'edit_failed');
    throw error;
  }
}

export async function dispatchGroupRecallMessage(
  groupUlid: string,
  messageUlid: string,
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_RECALL,
    category: 'chat',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid, messageUlid }),
  });

  try {
    await useGroupStore.getState().recallMessage(groupUlid, messageUlid);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'recall_failed');
    throw error;
  }
}

export async function dispatchGroupDeleteMessage(
  groupUlid: string,
  messageUlid: string,
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_DELETE,
    category: 'chat',
    orderingKey: `group:${groupUlid}`,
    payloadJson: JSON.stringify({ groupUlid, messageUlid }),
  });

  try {
    await useGroupStore.getState().deleteMessage(groupUlid, messageUlid);
    await markCommitted(commandId);
  } catch (error) {
    await markFailed(commandId, error instanceof Error ? error.message : 'delete_failed');
    throw error;
  }
}

export async function dispatchGroupUpdate(
  groupUlid: string,
  input: { name?: string; description?: string; muted?: boolean },
): Promise<void> {
  const commandId = await admitCommand({
    commandType: CMD_GROUP_UPDATE,
    category: 'chat',
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
    category: 'chat',
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
    category: 'chat',
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
    category: 'chat',
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
    category: 'chat',
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
    category: 'chat',
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
    category: 'chat',
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
