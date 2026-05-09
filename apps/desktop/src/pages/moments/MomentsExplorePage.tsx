import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Empty, Segmented, Spin, Typography } from 'antd';
import { useMomentsStore } from '../../store/moments';
import { MomentCard } from '../../components/moments/MomentCard';
import type { ReactionKind } from '../../gen/proto/domain/social/post_pb';
import type { TimelineSort } from '../../services/social_api';

const { Text } = Typography;

// MomentsExploreView — the PUBLIC timeline.
//
// Sort toggle (Recent / Hot):
//   - The sort knob lives here (not in the store) because it's
//     intrinsically per-mount UI state. The store records the
//     CURRENT sort so refreshing the tab keeps your selection,
//     but the segmented button's controlled state stays local.
//   - Hot ranking is a P2-C6 deliverable (server-side SQL score).
//     Until then the toggle still works — the BFF forwards `sort=hot`
//     and the server falls back to recent if it doesn't recognise it.

interface MomentsExploreViewProps {
  viewerActorId?: string;
  onOpenPost: (postId: string) => void;
  onAuthorClick: (actorId: string) => void;
}

export function MomentsExploreView({ viewerActorId: _viewerActorId, onOpenPost, onAuthorClick }: MomentsExploreViewProps) {
  const { t } = useTranslation('moments');
  const feed = useMomentsStore((s) => s.feeds.explore);
  const postsById = useMomentsStore((s) => s.postsById);
  const reactions = useMomentsStore((s) => s.reactions);
  const loadFeed = useMomentsStore((s) => s.loadFeed);
  const reactToPost = useMomentsStore((s) => s.reactToPost);
  const unreactToPost = useMomentsStore((s) => s.unreactToPost);

  const [sort, setSort] = useState<TimelineSort>(feed.sort ?? 'recent');

  useEffect(() => {
    loadFeed('explore', { refresh: true, sort }).catch(() => {});
  }, [sort, loadFeed]);

  const posts = feed.postIds.map((id) => postsById[id]).filter(Boolean);

  const handleReact = async (postId: string, kind: ReactionKind) => {
    await reactToPost(postId, kind);
  };
  const handleUnreact = async (postId: string, kind?: ReactionKind) => {
    await unreactToPost(postId, kind);
  };

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Segmented
          value={sort}
          onChange={(v) => setSort(v as TimelineSort)}
          options={[
            { value: 'recent', label: t('moments.tab.recent') },
            { value: 'hot', label: t('moments.tab.hot') },
          ]}
          size="small"
        />
      </div>

      {feed.loading && posts.length === 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin />
        </div>
      )}

      {!feed.loading && posts.length === 0 && (
        <Empty description={<Text>{t('moments.placeholder.exploreEmpty')}</Text>} />
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
          <Button onClick={() => loadFeed('explore', { sort }).catch(() => {})} loading={feed.loading}>
            {t('moments.action.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
