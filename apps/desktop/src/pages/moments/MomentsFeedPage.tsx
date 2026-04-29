import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Empty, Spin, Typography } from 'antd';
import { useMomentsStore } from '../../store/moments';
import { MomentCard } from '../../components/moments/MomentCard';
import type { ReactionKind } from '../../gen/proto/domain/social/post_pb';

const { Text } = Typography;

// MomentsFeedView — the HOME timeline (followed actors + own posts).
//
// Pagination: an explicit "Load more" button is preferred over
// infinite scroll so the user can stop reading without their feed
// silently loading 100 more rows in the background. Refresh fires
// from a header button (no pull-to-refresh on desktop).

interface MomentsFeedViewProps {
  viewerActorId?: string;
  onOpenPost: (postId: string) => void;
  onAuthorClick: (actorId: string) => void;
}

export function MomentsFeedView({ viewerActorId: _viewerActorId, onOpenPost, onAuthorClick }: MomentsFeedViewProps) {
  const { t } = useTranslation('moments');
  const feed = useMomentsStore((s) => s.feeds.home);
  const postsById = useMomentsStore((s) => s.postsById);
  const reactions = useMomentsStore((s) => s.reactions);
  const loadFeed = useMomentsStore((s) => s.loadFeed);
  const reactToPost = useMomentsStore((s) => s.reactToPost);
  const unreactToPost = useMomentsStore((s) => s.unreactToPost);

  useEffect(() => {
    // First-mount fetch: refresh=true so we don't pick up a stale
    // cursor from a prior session (the store survives across page
    // navigations within the app shell).
    if (!feed.loadedAt) {
      loadFeed('home', { refresh: true }).catch(() => {});
    }
  }, [feed.loadedAt, loadFeed]);

  const posts = feed.postIds.map((id) => postsById[id]).filter(Boolean);

  const handleReact = async (postId: string, kind: ReactionKind) => {
    await reactToPost(postId, kind);
  };
  const handleUnreact = async (postId: string, kind?: ReactionKind) => {
    await unreactToPost(postId, kind);
  };

  return (
    <div>
      {feed.loading && posts.length === 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin />
        </div>
      )}

      {!feed.loading && posts.length === 0 && (
        <Empty
          description={
            <div>
              <Text>{t('moments.placeholder.feedEmpty')}</Text>
            </div>
          }
        />
      )}

      {posts.map((p) => (
        <MomentCard
          key={p.id}
          post={p}
          reactions={reactions[p.id]}
          onOpen={onOpenPost}
          onOpenComments={onOpenPost}
          onAuthorClick={onAuthorClick}
          onReact={handleReact}
          onUnreact={handleUnreact}
        />
      ))}

      {feed.hasMore && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button
            onClick={() => loadFeed('home').catch(() => {})}
            loading={feed.loading}
          >
            {t('moments.action.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
