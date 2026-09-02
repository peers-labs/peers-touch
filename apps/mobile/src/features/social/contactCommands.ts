/**
 * contactCommands.ts — Typed command dispatchers for the Contacts page.
 *
 * All contact interactions route through InteractionAdmission so that
 * pending / failed / unknown state is tracked in the ledger.
 */

import { getInteractionAdmission } from '../../runtimes/commandRuntime';
import { useSocialStore } from '../social/socialStore';
import { useGroupStore } from '../group/groupStore';

// ---------------------------------------------------------------------------
// Command type constants
// ---------------------------------------------------------------------------

const CMD_SEND_FRIEND_REQUEST = 'social.send-friend-request';
const CMD_ACCEPT_FRIEND_REQUEST = 'social.accept-friend-request';
const CMD_REJECT_FRIEND_REQUEST = 'social.reject-friend-request';
const CMD_CREATE_GROUP = 'group.create';

// ---------------------------------------------------------------------------
// Command dispatchers
// ---------------------------------------------------------------------------

export async function dispatchSendFriendRequest(
  receiverPtid: string,
  message: string,
): Promise<void> {
  const commandId = await getInteractionAdmission().admit({
    commandType: CMD_SEND_FRIEND_REQUEST,
    category: 'social',
    orderingKey: `friend-request:${receiverPtid}`,
    payloadJson: JSON.stringify({ receiverPtid }),
  });

  try {
    await useSocialStore.getState().sendFriendRequest(receiverPtid, message);
    await getInteractionAdmission().markCommitted(commandId);
  } catch (error) {
    await getInteractionAdmission().markFailed(commandId, error instanceof Error ? error.message : 'request_failed');
    throw error;
  }
}

export async function dispatchAcceptFriendRequest(requestId: string): Promise<void> {
  const commandId = await getInteractionAdmission().admit({
    commandType: CMD_ACCEPT_FRIEND_REQUEST,
    category: 'social',
    orderingKey: `friend-request:${requestId}`,
    payloadJson: JSON.stringify({ requestId }),
  });

  try {
    await useSocialStore.getState().acceptFriendRequest(requestId);
    await getInteractionAdmission().markCommitted(commandId);
  } catch (error) {
    await getInteractionAdmission().markFailed(commandId, error instanceof Error ? error.message : 'accept_failed');
    throw error;
  }
}

export async function dispatchRejectFriendRequest(requestId: string): Promise<void> {
  const commandId = await getInteractionAdmission().admit({
    commandType: CMD_REJECT_FRIEND_REQUEST,
    category: 'social',
    orderingKey: `friend-request:${requestId}`,
    payloadJson: JSON.stringify({ requestId }),
  });

  try {
    await useSocialStore.getState().rejectFriendRequest(requestId);
    await getInteractionAdmission().markCommitted(commandId);
  } catch (error) {
    await getInteractionAdmission().markFailed(commandId, error instanceof Error ? error.message : 'reject_failed');
    throw error;
  }
}

export async function dispatchCreateGroup(input: {
  name: string;
  description: string;
  initialMemberPtids: string[];
}): Promise<string | null> {
  const commandId = await getInteractionAdmission().admit({
    commandType: CMD_CREATE_GROUP,
    category: 'chat',
    orderingKey: `group:create:${Date.now()}`,
    payloadJson: JSON.stringify({ name: input.name }),
  });

  try {
    const groupUlid = await useGroupStore.getState().createGroup(input);
    if (groupUlid) {
      await getInteractionAdmission().markCommitted(commandId);
    } else {
      await getInteractionAdmission().markFailed(commandId, 'create_returned_null');
    }
    return groupUlid;
  } catch (error) {
    await getInteractionAdmission().markFailed(commandId, error instanceof Error ? error.message : 'create_failed');
    throw error;
  }
}
