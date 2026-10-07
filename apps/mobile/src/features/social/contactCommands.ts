import { useSocialStore } from '../social/socialStore';
import { wakeActiveMessagingSession } from '../../runtimes/messagingRuntime';

const FRIEND_REQUEST_STATUS_ACCEPTED = 2;

// ---------------------------------------------------------------------------
// Command dispatchers
// ---------------------------------------------------------------------------

export async function dispatchSendFriendRequest(
  receiverPtid: string,
  receiverHomeStationPeerId: string,
  federationId: string,
  message: string,
) {
  return useSocialStore.getState().sendFriendRequest(
    receiverPtid,
    receiverHomeStationPeerId,
    federationId,
    message,
  );
}

export async function dispatchOpenContactChat(
  peerPtid: string,
  federationId: string,
): Promise<string> {
  const conversationId = await useSocialStore.getState()
    .openDirectConversation(peerPtid, federationId);
  await wakeActiveMessagingSession();
  if (!useSocialStore.getState().sessions.some(
    (session) => session.ulid === conversationId,
  )) {
    throw new Error('mobile.contacts.conversationPreparing');
  }
  return conversationId;
}

export async function dispatchAcceptFriendRequest(requestId: string): Promise<void> {
  await useSocialStore.getState().acceptFriendRequest(requestId);
  await wakeActiveMessagingSession();
}

export async function dispatchRejectFriendRequest(requestId: string): Promise<void> {
  await useSocialStore.getState().rejectFriendRequest(requestId);
}

export async function dispatchCreateGroup(input: {
  name: string;
  description: string;
  initialMemberPtids: string[];
}) {
  const social = useSocialStore.getState();
  const federationIds = new Set(input.initialMemberPtids.map((memberPtid) => {
    const relationship = social.friendRequests.find((request) =>
      request.status === FRIEND_REQUEST_STATUS_ACCEPTED
      && request.federationId.trim()
      && (
        (request.senderPtid === social.currentUserPtid && request.receiverPtid === memberPtid)
        || (request.receiverPtid === social.currentUserPtid && request.senderPtid === memberPtid)
      )
    );
    if (!relationship) throw new Error('mobile.group.federationScopeRequired');
    return relationship.federationId;
  }));
  if (federationIds.size !== 1) {
    throw new Error('mobile.group.federationScopeRequired');
  }
  const result = await social.createGroup({
    conversationId: globalThis.crypto.randomUUID(),
    name: input.name,
    description: input.description,
    memberPtids: input.initialMemberPtids,
    federationId: [...federationIds][0],
  });
  await wakeActiveMessagingSession();
  const description = input.description.trim();
  const current = useSocialStore.getState();
  const projection = current.messagingConversations.find(
    (conversation) => conversation.conversationId === result.conversationId,
  );
  if (description && projection && projection.description !== description) {
    await current.updateGroupConversation(result.conversationId, {
      description,
    });
    await wakeActiveMessagingSession();
  }
  return result;
}
