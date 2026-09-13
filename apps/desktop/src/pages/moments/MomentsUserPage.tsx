import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { ChevronLeft } from 'lucide-react';
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
  } = useActiveMomentsSlice((s) => ({
    feed: s.userFeeds[actorPtid],
    postsById: s.postsById,
    authorsById: s.authorsById,
    reactions: s.reactions,
    feedExplanations: s.feedExplanations,
    loadUserFeed: s.loadUserFeed,
    reactToPost: s.reactToPost,
    unreactToPost: s.unreactToPost,
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

  const handleReact = async (id: string, k: ReactionKind) => {
    await reactToPost(id, k);
  };
  const handleUnreact = async (id: string, k?: ReactionKind) => {
    await unreactToPost(id, k);
  };

  return (
    <div>
      <Button
        type="text"
        icon={<ChevronLeft size={16} />}
        onClick={onBack}
        style={{ marginBottom: 12 }}
      >
        {t('moments.action.back')}
      </Button>

      <UserProfileHeader
        actor={author ?? fallbackAuthor}
        viewerActorPtid={viewerActorPtid}
        followerCount={followers?.total}
        followingCount={following?.total}
        postCount={feed?.loading ? undefined : posts.length}
        loading={!author && profileLoading}
        refreshing={!!author && profileLoading}
      />

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
            onOpenComments={onOpenPost}
            onReact={handleReact}
            onUnreact={handleUnreact}
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
