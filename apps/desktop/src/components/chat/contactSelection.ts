import type { DesktopIMConversationProjection } from '../../store/socialProjection';
import type { PresentedError } from '../../services/errorPresenter';

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

export type FriendContactSelection = Extract<ContactSelection, { kind: 'friend' }>;

export type DirectConversationOpenIntent =
  | {
      phase: 'creating';
      peerPtid: string;
      displayName: string;
      avatar?: string;
    }
  | {
      phase: 'failed';
      peerPtid: string;
      displayName: string;
      avatar?: string;
      error: PresentedError;
    };

export function beginDirectConversationOpen(
  contact: FriendContactSelection,
): DirectConversationOpenIntent {
  return {
    phase: 'creating',
    peerPtid: contact.peerPtid,
    displayName: contact.displayName,
    avatar: contact.avatar,
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
