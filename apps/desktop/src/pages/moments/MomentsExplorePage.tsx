import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from 'antd';
import { useMomentsStore } from '../../store/moments';
import { MomentCard } from '../../components/moments/MomentCard';
import { MomentListState } from '../../components/moments/MomentListState';
import type { ReactionKind } from '../../gen/proto/domain/social/post_pb';
import type { TimelineSort } from '../../services/social_api';

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
  const comments = useMomentsStore((s) => s.comments);
  const reactions = useMomentsStore((s) => s.reactions);
  const loadFeed = useMomentsStore((s) => s.loadFeed);
  const reactToPost = useMomentsStore((s) => s.reactToPost);
  const unreactToPost = useMomentsStore((s) => s.unreactToPost);

  const [sort, setSort] = useState<TimelineSort>(feed.sort ?? 'recent');

  const posts = feed.postIds.map((id) => postsById[id]).filter(Boolean);

  const handleSortChange = (nextSort: TimelineSort) => {
    setSort(nextSort);
    loadFeed('explore', { refresh: true, sort: nextSort }).catch(() => {});
  };

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
          onChange={(v) => handleSortChange(v as TimelineSort)}
          options={[
            { value: 'recent', label: t('moments.tab.recent') },
            { value: 'hot', label: t('moments.tab.hot') },
          ]}
          size="small"
        />
      </div>

      <MomentListState
        loading={feed.loading}
        empty={posts.length === 0}
        emptyText={t('moments.placeholder.exploreEmpty')}
      />

      {posts.map((p) => (
        <MomentCard
          key={p.id}
          post={p}
          reactions={reactions[p.id]}
          commentPreview={comments[p.id]}
          onOpen={onOpenPost}
          onOpenComments={onOpenPost}
          onAuthorClick={onAuthorClick}
          onReact={handleReact}
          onUnreact={handleUnreact}
        />
      ))}

      <MomentListState
        loading={feed.loading}
        empty={false}
        emptyText={t('moments.placeholder.exploreEmpty')}
        loadMoreText={t('moments.action.loadMore')}
        hasMore={feed.hasMore}
        onLoadMore={() => loadFeed('explore', { sort }).catch(() => {})}
      />
    </div>
  );
}
