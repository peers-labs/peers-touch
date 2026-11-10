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
import { Button } from '@peers-touch/ui';
import { Check, Globe, MessageCircle, UserPlus, Clock } from 'lucide-react';

import { useSessionStore } from '../../store/session';
import { useSocialChatStore } from '../../store/socialChat';
import { useFederationStore } from '../../store/federation';
import { singleFederationId } from '../../store/friendshipProjection';
import { EVENT, eventBus } from '../../kernel/events';
import { notifyError, notifySuccess, notifyWarning } from '../../ui/feedback';
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
  // Subscribe to the stable getter reference, never its result:
  // getIMConversations() rebuilds the projection array on every call, so
  // invoking it inside a selector makes useSyncExternalStore see a new
  // snapshot each render and loop until "Maximum update depth exceeded"
  // (this component mounts only when the self profile popover opens).
  const getIMConversations = useSocialChatStore((state) => state.getIMConversations);
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
        actionId="profile.manage-account"
        fullWidth
        emphasis="secondary"
        density="compact"
        leading={<Globe size={15} />}
        data-chat-profile-manage
        onActivate={() => {
          close();
          window.location.hash = '#/settings';
          eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'settings', id: 'account' });
        }}
        label={t('layout.user.manageAccount')}
      />
    );
  }

  if (kind === 'requested') {
    const requestedLabel = t('chat.social.profile.requested');
    return (
      <Button
        actionId="profile.requested"
        fullWidth
        emphasis="secondary"
        leading={<Clock size={14} />}
        availability={{ kind: 'disabled', reason: requestedLabel }}
        data-chat-profile-requested
        label={requestedLabel}
      />
    );
  }

  if (kind === 'incoming-request' && friendRequest) {
    return (
      <Button
        actionId="profile.accept-request"
        fullWidth
        emphasis="primary"
        leading={<Check size={14} />}
        execution={busy === 'accept' ? 'pending' : 'idle'}
        data-chat-profile-accept
        onActivate={async () => {
          setBusy('accept');
          try {
            await acceptFriendRequest(friendRequest);
            notifySuccess(t('chat.social.contacts.accept'));
            close();
          } catch {
            notifyError(t('chat.social.findPeople.addFailed'));
          } finally {
            setBusy(null);
          }
        }}
        label={t('chat.social.contacts.accept')}
      />
    );
  }

  if (kind === 'friend') {
    return (
      <Button
        actionId="profile.send-message"
        fullWidth
        emphasis="primary"
        leading={<MessageCircle size={14} />}
        data-chat-contact-message
        onActivate={() => {
          if (onMessage) {
            onMessage();
          } else {
            const existing = getIMConversations().find(
              (conversation) => conversation.kind === 'friend'
                && conversation.peerPtid === actorPtid,
            );
            if (existing) selectSession(existing.id);
          }
          close();
        }}
        label={t('chat.social.contacts.sendMessage')}
      />
    );
  }

  const addFriend = async () => {
    const homeStationPeerId = peerProfile?.home_station_peer_id?.trim()
      || (friendRequest?.senderPtid === actorPtid
        ? friendRequest.senderHomeStationPeerId
        : friendRequest?.receiverHomeStationPeerId)
      || '';
    const existingConversation = getIMConversations().find(
      (conversation) => conversation.kind === 'friend' && conversation.peerPtid === actorPtid,
    );
    const federationId = friendRequest?.federationId
      || existingConversation?.federationId
      || singleFederationId(federations);
    if (!homeStationPeerId || !federationId) {
      notifyWarning(t('chat.social.profile.addIdentityUnavailable'));
      return;
    }
    setBusy('add');
    try {
      await sendFriendRequest(actorPtid, homeStationPeerId, federationId, '');
      notifySuccess(t('chat.social.findPeople.requestSent'));
      close();
    } catch (error) {
      notifyError(
        (error as { message?: string })?.message
          || t('chat.social.findPeople.addFailed'),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Button
      actionId="profile.add-friend"
      fullWidth
      emphasis="primary"
      leading={<UserPlus size={14} />}
      execution={busy === 'add' ? 'pending' : 'idle'}
      data-chat-profile-add-friend
      onActivate={() => void addFriend()}
      label={t('chat.social.profile.addFriend')}
    />
  );
}
