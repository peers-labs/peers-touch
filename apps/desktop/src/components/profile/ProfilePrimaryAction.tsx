/**
 * ProfilePrimaryAction — declarative primary action for PublicProfileCard.
 *
 * This is the only component that interprets relationship state. The card
 * renders whatever node it receives; this owner derives friendship truth
 * (mutual follow / accepted request / pending requests) and the production
 * store actions:
 *
 *   self            → Manage Account
 *   friend          → Message
 *   outgoing wait   → Requested (disabled)
 *   incoming wait   → Accept
 *   stranger        → Add friend
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { message } from 'antd';
import { Check, Globe, MessageCircle, UserPlus, Clock } from 'lucide-react';

import { useSessionStore } from '../../store/session';
import { useSocialChatStore } from '../../store/socialChat';
import { useFederationStore } from '../../store/federation';
import { singleFederationId } from '../../store/friendshipProjection';
import { EVENT, eventBus } from '../../kernel/events';
import { findFriendRequest } from './profileRelationship';
import { useProfileRelationship } from './useProfileRelationship';

interface ProfilePrimaryActionProps {
  actorPtid: string;
  /**
   * Overrides the default Message behaviour (contact detail owns the
   * create-or-open conversation route). Without it, the action selects the
   * existing Direct conversation for a friend.
   */
  onMessage?: () => void;
  /** Invoked after a successful action so a popover host can close. */
  onAction?: () => void;
}

export function ProfilePrimaryAction({ actorPtid, onMessage, onAction }: ProfilePrimaryActionProps) {
  const { t } = useTranslation(['chat', 'layout']);
  const kind = useProfileRelationship(actorPtid);

  const peerProfile = useSocialChatStore((state) => state.peerProfiles[actorPtid]);
  const federations = useFederationStore((state) => state.federations);
  const friendRequests = useSocialChatStore((state) => state.friendRequests);
  const currentUserPtid = useSessionStore((state) => state.currentUser?.actorPtid ?? null);
  const sendFriendRequest = useSocialChatStore((state) => state.sendFriendRequest);
  const acceptFriendRequest = useSocialChatStore((state) => state.acceptFriendRequest);
  const selectSession = useSocialChatStore((state) => state.selectSession);

  const [busy, setBusy] = useState<'add' | 'accept' | null>(null);

  if (!kind) return null;

  const friendRequest = findFriendRequest(friendRequests, currentUserPtid, actorPtid);
  const close = () => onAction?.();

  if (kind === 'self') {
    return (
      <Button
        block
        icon={<Globe size={14} />}
        data-chat-profile-manage
        onClick={() => {
          close();
          window.location.hash = '#/settings';
          eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'settings', id: 'account' });
        }}
      >
        {t('layout.user.manageAccount')}
      </Button>
    );
  }

  if (kind === 'requested') {
    return (
      <Button block disabled icon={<Clock size={14} />} data-chat-profile-requested>
        {t('chat.social.profile.requested')}
      </Button>
    );
  }

  if (kind === 'incoming-request' && friendRequest) {
    return (
      <Button
        block
        type="primary"
        icon={<Check size={14} />}
        loading={busy === 'accept'}
        data-chat-profile-accept
        onClick={async () => {
          setBusy('accept');
          try {
            await acceptFriendRequest(friendRequest);
            message.success(t('chat.social.contacts.accept'));
            close();
          } catch {
            message.error(t('chat.social.findPeople.addFailed'));
          } finally {
            setBusy(null);
          }
        }}
      >
        {t('chat.social.contacts.accept')}
      </Button>
    );
  }

  if (kind === 'friend') {
    return (
      <Button
        block
        type="primary"
        icon={<MessageCircle size={14} />}
        data-chat-contact-message
        onClick={() => {
          if (onMessage) {
            onMessage();
          } else {
            // Read the derived projection imperatively at click time. Selecting
            // getIMConversations() reactively would subscribe to a fresh array
            // (and fresh projection objects) on every store notification,
            // causing an unbounded re-render loop (React error #185).
            const existing = useSocialChatStore.getState()
              .getIMConversations()
              .find(
                (conversation) => conversation.kind === 'friend'
                  && conversation.peerPtid === actorPtid,
              );
            if (existing) selectSession(existing.id);
          }
          close();
        }}
      >
        {t('chat.social.contacts.sendMessage')}
      </Button>
    );
  }

  const addFriend = async () => {
    const currentConversations = useSocialChatStore.getState().getIMConversations();
    const homeStationPeerId = peerProfile?.home_station_peer_id?.trim()
      || (friendRequest?.senderPtid === actorPtid
        ? friendRequest.senderHomeStationPeerId
        : friendRequest?.receiverHomeStationPeerId)
      || '';
    const existingConversation = currentConversations.find(
      (conversation) => conversation.kind === 'friend' && conversation.peerPtid === actorPtid,
    );
    const federationId = friendRequest?.federationId
      || existingConversation?.federationId
      || singleFederationId(federations);
    if (!homeStationPeerId || !federationId) {
      message.warning(t('chat.social.profile.addIdentityUnavailable'));
      return;
    }
    setBusy('add');
    try {
      await sendFriendRequest(actorPtid, homeStationPeerId, federationId, '');
      message.success(t('chat.social.findPeople.requestSent'));
      close();
    } catch (error) {
      message.error(
        (error as { message?: string })?.message
          || t('chat.social.findPeople.addFailed'),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Button
      block
      type="primary"
      icon={<UserPlus size={14} />}
      loading={busy === 'add'}
      data-chat-profile-add-friend
      onClick={() => void addFriend()}
    >
      {t('chat.social.profile.addFriend')}
    </Button>
  );
}