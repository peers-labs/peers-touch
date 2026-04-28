import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Empty, Spin, Typography } from 'antd';
import { ChevronLeft } from 'lucide-react';
import { useMomentsStore } from '../../store/moments';
import { useRelationshipsStore } from '../../store/relationships';
import { MomentCard } from '../../components/moments/MomentCard';
import { UserProfileHeader } from '../../components/moments/UserProfileHeader';
import type { ReactionKind } from '../../gen/proto/domain/social/post_pb';

const { Text } = Typography;

// MomentsUserView — actor profile + their authored posts.
//
// Author info hydration:
//   - The simplest available source for the actor's display
//     metadata is whatever post in `postsById` carries
//     `author_id === actorId`. We pick the first match — the wire
//     `PostAuthor` shape is the same regardless of which post
//     surfaces it.
//   - When NO post is available yet (cold visit from a follower
//     list), we render a skeleton header until the user-feed
//     fetch completes and surfaces an author.

interface MomentsUserViewProps {
  actorId: string;
  viewerActorId?: string;
  onBack: () => void;
  onOpenPost: (postId: string) => void;
}

export function MomentsUserView({
  actorId,
  viewerActorId,
  onBack,
  onOpenPost,
}: MomentsUserViewProps) {
  const { t } = useTranslation('moments');
  const feed = useMomentsStore((s) => s.userFeeds[actorId]);
  const postsById = useMomentsStore((s) => s.postsById);
  const reactions = useMomentsStore((s) => s.reactions);
  const loadUserFeed = useMomentsStore((s) => s.loadUserFeed);
  const reactToPost = useMomentsStore((s) => s.reactToPost);
  const unreactToPost = useMomentsStore((s) => s.unreactToPost);

  const followers = useRelationshipsStore((s) => s.followersByActor[actorId]);
  const following = useRelationshipsStore((s) => s.followingByActor[actorId]);
  const loadFollowers = useRelationshipsStore((s) => s.loadFollowers);
  const loadFollowing = useRelationshipsStore((s) => s.loadFollowing);

  useEffect(() => {
    loadUserFeed(actorId, true).catch(() => {});
    loadFollowers(actorId, true).catch(() => {});
    loadFollowing(actorId, true).catch(() => {});
  }, [actorId, loadUserFeed, loadFollowers, loadFollowing]);

  const posts = (feed?.postIds ?? []).map((id) => postsById[id]).filter(Boolean);
  const author = posts.find((p) => p.author?.id === actorId)?.author;

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
        {t('moments.action.back', { defaultValue: 'Back' })}
      </Button>

      <UserProfileHeader
        actor={author ?? null}
        viewerActorId={viewerActorId}
        followerCount={followers?.total}
        followingCount={following?.total}
        postCount={posts.length}
        loading={!author && (!feed || feed.loading)}
      />

      <div style={{ marginTop: 16 }}>
        {feed?.loading && posts.length === 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin />
          </div>
        )}

        {!feed?.loading && posts.length === 0 && (
          <Empty description={<Text>{t('moments.placeholder.userEmpty')}</Text>} />
        )}

        {posts.map((p) => (
          <MomentCard
            key={p.id}
            post={p}
            reactions={reactions[p.id]}
            onOpen={onOpenPost}
            onOpenComments={onOpenPost}
            onReact={handleReact}
            onUnreact={handleUnreact}
          />
        ))}

        {feed?.hasMore && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <Button
              onClick={() => loadUserFeed(actorId).catch(() => {})}
              loading={feed?.loading}
            >
              {t('moments.action.loadMore')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Legacy module-registry alias retained for transition. See MomentsApp.
export { MomentsApp as MomentsUserPage } from './MomentsApp';
