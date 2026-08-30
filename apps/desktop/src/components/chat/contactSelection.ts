import type { DesktopIMConversationProjection } from '../../store/socialProjection';

export type ContactSelection =
  | {
      kind: 'friend';
      conversationId?: string;
      peerPtid: string;
      displayName: string;
      avatar?: string;
    }
  | {
      kind: 'group';
      conversationId: string;
      displayName: string;
      avatar?: string;
      memberCount: number;
    };

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
  peerPtid: string,
  displayName: string,
  avatar: string | undefined,
  conversations: DesktopIMConversationProjection[],
): ContactSelection {
  const conversation = conversations.find(
    (item) => item.kind === 'friend' && item.peerPtid === peerPtid,
  );
  return {
    kind: 'friend',
    ...(conversation ? { conversationId: conversation.id } : {}),
    peerPtid,
    displayName,
    avatar,
  };
}
