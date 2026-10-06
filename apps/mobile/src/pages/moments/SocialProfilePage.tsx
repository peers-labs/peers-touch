import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Modal, Spin, Tag, Typography } from 'antd';
import { ArrowLeft, Ban, MessageCircle, RotateCcw, UserMinus, UserPlus } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import type { MobileChatDetailRoute } from '../../app/navigation';
import { MobileAvatar } from '../../components/MobileAvatar';
import { MobileNotice } from '../../components/MobileNotice';
import { dispatchBlockUser, dispatchUnblockUser } from '../../features/chat/chatCommands';
import { dispatchOpenContactChat } from '../../features/social/contactCommands';
import { projectAcceptedContacts } from '../../features/social/socialProjection';
import {
  dispatchFollowUser,
  dispatchUnfollowUser,
} from '../../features/social/socialProfileCommands';
import {
  formatSocialError,
  useSocialStore,
} from '../../features/social/socialStore';
import {
  requestSocialFriendshipStatus,
  requestSocialPeerProfile,
} from '../../features/social/socialRuntime';
import { useSocialExperience } from '../../features/social/useSocialExperience';
import { MomentFeedItem } from './MomentFeedItem';

const { Text } = Typography;

interface SocialProfilePageProps {
  readonly actorPtid: string;
  readonly federationId: string;
  readonly onBack: () => void;
  readonly onOpenChat: (route: MobileChatDetailRoute) => void;
  readonly onOpenMoment: (postId: string) => void;
}

export function SocialProfilePage({
  actorPtid,
  federationId,
  onBack,
  onOpenChat,
  onOpenMoment,
}: SocialProfilePageProps) {
  const { t } = useMobileI18n();
  const { facade } = useSocialExperience();
  const currentUserPtid = useSocialStore((state) => state.currentUserPtid);
  const currentUserProfile = useSocialStore((state) => state.currentUserProfile);
  const peerProfiles = useSocialStore((state) => state.peerProfiles);
  const peerProfileLoading = useSocialStore((state) => state.peerProfileLoading);
  const peerProfileErrors = useSocialStore((state) => state.peerProfileErrors);
  const friendshipStatus = useSocialStore((state) => state.friendshipStatus);
  const friendRequests = useSocialStore((state) => state.friendRequests);
  const peerOnline = useSocialStore((state) => state.peerOnline);
  const selectSession = useSocialStore((state) => state.selectSession);
  const authoredFeed = useSocialStore((state) => state.authoredFeeds[actorPtid]);
  const loadAuthoredPosts = useSocialStore((state) => state.loadAuthoredPosts);

  const [action, setAction] = useState('');
  const [actionError, setActionError] = useState('');
  const profile = actorPtid === currentUserPtid
    ? currentUserProfile
    : peerProfiles[actorPtid];
  const profileLoading = actorPtid === currentUserPtid
    ? false
    : Boolean(peerProfileLoading[actorPtid]);
  const profileError = peerProfileErrors[actorPtid];
  const relationship = friendshipStatus[actorPtid];
  const isSelf = actorPtid === currentUserPtid;
  const contacts = useMemo(
    () => projectAcceptedContacts(friendRequests, currentUserPtid, peerOnline),
    [currentUserPtid, friendRequests, peerOnline],
  );
  const contact = contacts.find((item) => item.peerPtid === actorPtid);
  const directFederationId = contact?.federationIds.includes(federationId)
    ? federationId
    : contact?.federationIds.length === 1 ? contact.federationIds[0] : '';

  useEffect(() => {
    void requestSocialPeerProfile(actorPtid);
    if (!isSelf) {
      void requestSocialFriendshipStatus(actorPtid).catch(() => undefined);
    }
    void loadAuthoredPosts(actorPtid);
  }, [actorPtid, isSelf, loadAuthoredPosts]);

  const invalidateProfileAndFeeds = useCallback(async () => {
    await Promise.allSettled([
      requestSocialPeerProfile(actorPtid, true),
      loadAuthoredPosts(actorPtid),
      facade?.feeds.home.refresh() ?? Promise.resolve(),
      facade?.feeds.explore.refresh() ?? Promise.resolve(),
    ]);
  }, [actorPtid, facade, loadAuthoredPosts]);

  const runRelationshipAction = async (
    name: string,
    command: () => Promise<void>,
  ) => {
    if (action) return;
    setAction(name);
    setActionError('');
    try {
      await command();
      await invalidateProfileAndFeeds();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'mobile.social.relationshipActionFailed');
    } finally {
      setAction('');
    }
  };

  const openDirect = async () => {
    if (!directFederationId || action) return;
    setAction('message');
    setActionError('');
    try {
      const sessionUlid = await dispatchOpenContactChat(actorPtid, directFederationId);
      await selectSession(sessionUlid);
      onOpenChat({ routeId: 'detail:chat-conversation', sessionUlid });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'mobile.contacts.openChatFailed');
    } finally {
      setAction('');
    }
  };

  const confirmBlock = () => {
    Modal.confirm({
      title: t('mobile.contacts.blockConfirmTitle'),
      content: t('mobile.contacts.blockConfirmBody'),
      okText: t('mobile.contacts.block'),
      cancelText: t('common.action.cancel'),
      okButtonProps: { danger: true },
      onOk: () => runRelationshipAction('block', () => dispatchBlockUser(actorPtid)),
    });
  };

  return (
    <div className="page-container mobile-detail-page">
      <header className="page-header">
        <button
          type="button"
          className="header-action"
          aria-label={t('common.action.back')}
          onClick={onBack}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="header-title compact">
          {profile?.displayName || t('mobile.social.profile.title')}
        </h1>
      </header>

      <div className="mobile-detail-body" data-profile-actor-ptid={actorPtid}>
        <div className="contact-profile-card">
          <Spin spinning={profileLoading}>
            <MobileAvatar src={profile?.avatar} size={72}>
              {(profile?.displayName || actorPtid).slice(0, 1)}
            </MobileAvatar>
          </Spin>
          <div className="contact-profile-copy">
            <Text strong className="contact-profile-name">
              {profile?.displayName || actorPtid}
            </Text>
            {profile?.federatedHandle || profile?.acct ? (
              <Text type="secondary">{profile.federatedHandle || profile.acct}</Text>
            ) : null}
            <Text type="secondary" copyable>{actorPtid}</Text>
            {profile?.note ? <Text className="contact-profile-note">{profile.note}</Text> : null}
          </div>

          {profile ? (
            <div className="contact-profile-stats">
              <ProfileStat label={t('mobile.contacts.profilePosts')} value={profile.statusesCount} />
              <ProfileStat label={t('mobile.contacts.profileFollowing')} value={profile.followingCount} />
              <ProfileStat label={t('mobile.contacts.profileFollowers')} value={profile.followersCount} />
            </div>
          ) : null}

          {profileError ? (
            <MobileNotice tone="error">{formatSocialError(profileError)}</MobileNotice>
          ) : null}
          {relationship?.blocked ? (
            <Tag color="error">{t('mobile.contacts.blocked')}</Tag>
          ) : null}
          {actionError ? (
            <MobileNotice tone="error">
              {t(actionError.startsWith('mobile.') ? actionError : 'mobile.social.relationshipActionFailed')}
            </MobileNotice>
          ) : null}

          {!isSelf ? (
            <>
              <Button
                block
                type={relationship?.following ? 'default' : 'primary'}
                icon={relationship?.following ? <UserMinus size={15} /> : <UserPlus size={15} />}
                loading={action === 'follow'}
                disabled={Boolean(action) || relationship?.blocked}
                onClick={() => void runRelationshipAction(
                  'follow',
                  relationship?.following
                    ? () => dispatchUnfollowUser(actorPtid)
                    : () => dispatchFollowUser(actorPtid),
                )}
              >
                {t(relationship?.following
                  ? 'mobile.social.profile.unfollow'
                  : 'mobile.social.profile.follow')}
              </Button>
              {directFederationId ? (
                <Button
                  block
                  icon={<MessageCircle size={15} />}
                  loading={action === 'message'}
                  disabled={Boolean(action) || relationship?.blocked}
                  onClick={() => void openDirect()}
                >
                  {t('mobile.contacts.openChat')}
                </Button>
              ) : null}
              {relationship?.blocked ? (
                <Button
                  block
                  icon={<RotateCcw size={15} />}
                  loading={action === 'unblock'}
                  disabled={Boolean(action)}
                  onClick={() => void runRelationshipAction(
                    'unblock',
                    () => dispatchUnblockUser(actorPtid),
                  )}
                >
                  {t('mobile.contacts.unblock')}
                </Button>
              ) : (
                <Button
                  block
                  danger
                  icon={<Ban size={15} />}
                  disabled={Boolean(action)}
                  onClick={confirmBlock}
                >
                  {t('mobile.contacts.block')}
                </Button>
              )}
            </>
          ) : null}
        </div>

        <section aria-label={t('mobile.social.profile.authoredPosts')}>
          <Text strong>{t('mobile.social.profile.authoredPosts')}</Text>
          {(authoredFeed?.posts ?? []).map((post) => (
            <div key={post.id} data-scroll-anchor-id={post.id}>
              <MomentFeedItem
                post={post}
                onReact={(postId, kind) => void facade?.intents.react(postId, kind)}
                onOpenComments={onOpenMoment}
                onOpenDetail={onOpenMoment}
                onSubmitComment={facade
                  ? (postId, content) => facade.intents.comment(postId, content)
                  : undefined}
              />
            </div>
          ))}
          {authoredFeed?.loading ? <Spin /> : null}
          {authoredFeed?.error ? (
            <MobileNotice tone="error">{formatSocialError(authoredFeed.error)}</MobileNotice>
          ) : null}
          {!authoredFeed?.loading && (authoredFeed?.posts.length ?? 0) === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('mobile.social.profile.noPosts')}
            />
          ) : null}
          {authoredFeed?.hasMore && !authoredFeed.loading ? (
            <Button
              type="text"
              block
              onClick={() => void loadAuthoredPosts(
                actorPtid,
                authoredFeed.nextCursor,
              )}
            >
              {t('mobile.moments.feed.loadMore')}
            </Button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="contact-profile-stat">
      <Text strong>{value}</Text>
      <Text type="secondary">{label}</Text>
    </div>
  );
}
