import type { DesktopIMConversationProjection } from '../../store/socialProjection';
import type { ChatActorIdentityProjection } from '../../store/friendshipProjection';
import type { PresentedError } from '../../services/errorPresenter';

interface FriendIdentitySelection {
  peerPtid: string;
  federationId: string;
  federationName: string;
  displayName: string;
  avatar?: string;
  username: string;
  federatedHandle: string;
  homeStationDomain: string;
  homeStationPeerId: string;
}

export type ContactSelection =
  | FriendIdentitySelection & {
      kind: 'friend';
      conversationId?: string;
    }
  | {
      kind: 'group';
      conversationId: string;
      displayName: string;
      avatar?: string;
      memberCount: number;
    };

export type FriendContactSelection = Extract<ContactSelection, { kind: 'friend' }>;

export type DirectConversationOpenIntent =
  | FriendIdentitySelection & {
      phase: 'creating';
    }
  | FriendIdentitySelection & {
      phase: 'failed';
      error: PresentedError;
    };

export function beginDirectConversationOpen(
  contact: FriendContactSelection,
): DirectConversationOpenIntent {
  return {
    phase: 'creating',
    peerPtid: contact.peerPtid,
    federationId: contact.federationId,
    federationName: contact.federationName,
    displayName: contact.displayName,
    avatar: contact.avatar,
    username: contact.username,
    federatedHandle: contact.federatedHandle,
    homeStationDomain: contact.homeStationDomain,
    homeStationPeerId: contact.homeStationPeerId,
  };
}

export function failDirectConversationOpen(
  intent: DirectConversationOpenIntent,
  error: PresentedError,
): DirectConversationOpenIntent {
  return {
    ...intent,
    phase: 'failed',
    error,
  };
}

export function findContactConversation(
  selection: ContactSelection,
  conversations: DesktopIMConversationProjection[],
): DesktopIMConversationProjection | undefined {
  if (selection.conversationId) {
    return conversations.find(
      (conversation) => (
        conversation.kind === selection.kind
        && conversation.id === selection.conversationId
      ),
    );
  }

  if (selection.kind !== 'friend') return undefined;

  return conversations.find(
    (conversation) => (
      conversation.kind === 'friend'
      && conversation.peerPtid === selection.peerPtid
    ),
  );
}

export function friendContactSelection(
  identity: ChatActorIdentityProjection,
  conversations: DesktopIMConversationProjection[],
): ContactSelection {
  const conversation = conversations.find(
    (item) => item.kind === 'friend' && item.peerPtid === identity.actorPtid,
  );
  return {
    kind: 'friend',
    ...(conversation ? { conversationId: conversation.id } : {}),
    peerPtid: identity.actorPtid,
    federationId: identity.federationId,
    federationName: identity.federationName,
    displayName: identity.displayName,
    avatar: identity.avatarUrl,
    username: identity.username,
    federatedHandle: identity.federatedHandle,
    homeStationDomain: identity.homeStationDomain,
    homeStationPeerId: identity.homeStationPeerId,
  };
}
