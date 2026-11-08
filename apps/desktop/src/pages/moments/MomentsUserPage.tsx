import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { Button, StatGrid } from '@peers-touch/ui';
import { MomentCard } from '../../components/moments/MomentCard';
import { MomentListState } from '../../components/moments/MomentListState';
import { UserProfileHeader } from '../../components/moments/UserProfileHeader';
import {
  useActiveDiscoverySlice,
  useActiveMomentsSlice,
  useActiveRelationshipsSlice,
} from '../../components/moments/useActiveMomentsStore';
import type { DiscoveryUser } from '../../store/discovery';
import type { PostAuthor, ReactionKind } from '../../gen/proto/domain/social/post_pb';

// MomentsUserView — actor profile + their authored posts.
//
// Author identity and authored posts load independently. Search/profile
// identity is shown immediately when available; an empty or slow post
// feed must never turn the whole user page into a skeleton.

interface MomentsUserViewProps {
  actorPtid: string;
  viewerActorPtid?: string;
  onBack: () => void;
  onOpenPost: (postId: string) => void;
  onAuthorClick: (actorPtid: string) => void;
}

function discoveryUserAsAuthor(user: DiscoveryUser): PostAuthor {
  return {
    $typeName: 'peers_touch.model.social.v1.PostAuthor',
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatar ?? '',
    homeStationDomain: user.homeStationDomain ?? '',
    isFollowing: false,
  } as PostAuthor;
}

export function MomentsUserView({
  actorPtid,
  viewerActorPtid,
  onBack,
  onOpenPost,
  onAuthorClick,
}: MomentsUserViewProps) {
  const { t } = useTranslation('moments');
  const {
    feed,
    postsById,
    authorsById,
    reactions,
    feedExplanations,
    loadUserFeed,
    reactToPost,
    unreactToPost,
    deletePost,
    myStats,
  } = useActiveMomentsSlice((s) => ({
    feed: s.userFeeds[actorPtid],
    postsById: s.postsById,
    authorsById: s.authorsById,
    reactions: s.reactions,
    feedExplanations: s.feedExplanations,
    loadUserFeed: s.loadUserFeed,
    reactToPost: s.reactToPost,
    unreactToPost: s.unreactToPost,
    deletePost: s.deletePost,
    myStats: s.myStats,
  }));

  const { followers, following } = useActiveRelationshipsSlice((s) => ({
    followers: s.followersByActor[actorPtid],
    following: s.followingByActor[actorPtid],
  }));
  const { discoveryUser, profileLoading } = useActiveDiscoverySlice((s) => ({
    discoveryUser: s.usersById[actorPtid],
    profileLoading: !!s.profileLoadingById[actorPtid],
  }));

  const posts = (feed?.postIds ?? []).map((id) => postsById[id]).filter(Boolean);
  const author =
    authorsById[actorPtid]
    ?? (discoveryUser ? discoveryUserAsAuthor(discoveryUser) : undefined);
  const fallbackAuthor = {
    $typeName: 'peers_touch.model.social.v1.PostAuthor',
    id: actorPtid,
    username: '',
    displayName: t('moments.author.unknown'),
    avatarUrl: '',
    homeStationDomain: '',
    isFollowing: false,
  } as PostAuthor;

  const handleReact = useCallback((id: string, k: ReactionKind) =>
    reactToPost(id, k), [reactToPost]);
  const handleUnreact = useCallback((id: string, k?: ReactionKind) =>
    unreactToPost(id, k), [unreactToPost]);
  const handleDelete = useCallback((id: string) =>
    deletePost(id), [deletePost]);

  return (
    <div>
      <Button
        actionId="moments.profile.back"
        emphasis="quiet"
        leading={<ChevronLeft size={16} />}
        onActivate={onBack}
        style={{ marginBottom: 12 }}
      >
        {t('moments.action.back')}
      </Button>

      <UserProfileHeader
        actor={author ?? fallbackAuthor}
        viewerActorPtid={viewerActorPtid}
        followerCount={followers?.total}
        followingCount={following?.total}
        postCount={actorPtid === viewerActorPtid && myStats ? Number(myStats.postsCount) : discoveryUser?.postCount}
        bio={discoveryUser?.bio}
        loading={!author && profileLoading}
        refreshing={!!author && profileLoading}
      />
      {actorPtid === viewerActorPtid && <StatGrid statistics={[
        { id: 'posts', label: t('moments.stats.posts'), value: myStats ? Number(myStats.postsCount) : undefined },
        { id: 'comments', label: t('moments.stats.commentsGiven'), value: myStats ? Number(myStats.commentsCount) : undefined },
        { id: 'reactionsGiven', label: t('moments.stats.reactionsGiven'), value: myStats ? Number(myStats.reactionsGivenCount) : undefined },
        { id: 'commentsReceived', label: t('moments.stats.commentsReceived'), value: myStats ? Number(myStats.commentsReceivedCount) : undefined },
        { id: 'reactionsReceived', label: t('moments.stats.reactionsReceived'), value: myStats ? Number(myStats.reactionsReceivedCount) : undefined },
        { id: 'following', label: t('moments.stats.following'), value: myStats ? Number(myStats.followingCount) : undefined },
        { id: 'followers', label: t('moments.stats.followers'), value: myStats ? Number(myStats.followersCount) : undefined },
        { id: 'circles', label: t('moments.stats.circles'), value: myStats ? Number(myStats.circlesCount) : undefined },
      ]} />}

      <div style={{ marginTop: 16 }}>
        <MomentListState
          loading={feed?.loading}
          empty={posts.length === 0}
          emptyText={t('moments.placeholder.userEmpty')}
        />

        {posts.map((p) => (
          <MomentCard
            key={p.id}
            post={p}
            reactions={reactions[p.id]}
            explanation={feedExplanations[p.id]}
            viewerActorPtid={viewerActorPtid}
            surface="profile"
            onOpen={onOpenPost}
            onAuthorClick={onAuthorClick}
            onReact={handleReact}
            onUnreact={handleUnreact}
            onDelete={handleDelete}
          />
        ))}

        <MomentListState
          loading={feed?.loading}
          empty={false}
          emptyText={t('moments.placeholder.userEmpty')}
          loadMoreText={t('moments.action.loadMore')}
          hasMore={feed?.hasMore}
          onLoadMore={() => loadUserFeed(actorPtid).catch(() => {})}
        />
      </div>
    </div>
  );
}
