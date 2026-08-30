import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { ChevronLeft } from 'lucide-react';
import { MomentCard } from '../../components/moments/MomentCard';
import { MomentListState } from '../../components/moments/MomentListState';
import { UserProfileHeader } from '../../components/moments/UserProfileHeader';
import { useActiveMomentsSlice, useActiveRelationshipsSlice } from '../../components/moments/useActiveMomentsStore';
import type { ReactionKind } from '../../gen/proto/domain/social/post_pb';

// MomentsUserView — actor profile + their authored posts.
//
// Author info hydration:
//   - The simplest available source for the actor's display
//     metadata is whatever post in `postsById` carries
//     `author_ptid === actorPtid`. We pick the first match — the wire
//     `PostAuthor` shape is the same regardless of which post
//     surfaces it.
//   - `momentsRuntime` owns the author feed + relationship projection
//     refresh before this pushed view is shown.

interface MomentsUserViewProps {
  actorPtid: string;
  viewerActorPtid?: string;
  onBack: () => void;
  onOpenPost: (postId: string) => void;
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
    reactions,
    feedExplanations,
    loadUserFeed,
    reactToPost,
    unreactToPost,
  } = useActiveMomentsSlice((s) => ({
    feed: s.userFeeds[actorPtid],
    postsById: s.postsById,
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

  const posts = (feed?.postIds ?? []).map((id) => postsById[id]).filter(Boolean);
  const author = posts.find((p) => p.author?.id === actorPtid)?.author;

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
        actor={author ?? null}
        viewerActorPtid={viewerActorPtid}
        followerCount={followers?.total}
        followingCount={following?.total}
        postCount={posts.length}
        loading={!author && (!feed || feed.loading)}
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
