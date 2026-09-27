import { useSocialStore } from '../social/socialStore';

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
  return useSocialStore.getState().openDirectConversation(peerPtid, federationId);
}

export async function dispatchAcceptFriendRequest(requestId: string): Promise<void> {
  await useSocialStore.getState().acceptFriendRequest(requestId);
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
  return social.createGroup({
    conversationId: globalThis.crypto.randomUUID(),
    name: input.name,
    description: input.description,
    memberPtids: input.initialMemberPtids,
    federationId: [...federationIds][0],
  });
}
