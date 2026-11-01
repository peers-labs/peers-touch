import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MomentCard } from '../../components/moments/MomentCard';
import { MomentComposer } from '../../components/moments/MomentComposer';
import { MomentListState } from '../../components/moments/MomentListState';
import { useActiveMomentsSlice } from '../../components/moments/useActiveMomentsStore';
import {
  SocialComposer,
  SocialEmptyState,
  SocialScopeHint,
} from '../../components/moments/surfaces';
import type { ReactionKind } from '../../gen/proto/domain/social/post_pb';

// MomentsFeedView — the HOME timeline (followed actors + own posts).
//
// Pagination: an explicit "Load more" button is preferred over
// infinite scroll so the user can stop reading without their feed
// silently loading 100 more rows in the background. Refresh fires
// from a header button (no pull-to-refresh on desktop).

interface MomentsFeedViewProps {
  viewerActorPtid?: string;
  onOpenPost: (postId: string) => void;
  onAuthorClick: (actorPtid: string) => void;
  onComposerPublished?: (postId: string) => void;
  composerOpen?: boolean;
  onCloseComposer?: () => void;
}

export function MomentsFeedView({
  viewerActorPtid: _viewerActorPtid,
  onOpenPost,
  onAuthorClick,
  onComposerPublished,
  composerOpen = false,
  onCloseComposer,
}: MomentsFeedViewProps) {
  const { t } = useTranslation('moments');
  const {
    feed,
    postsById,
    comments,
    reactions,
    feedExplanations,
    loadFeed,
    reactToPost,
    unreactToPost,
    deletePost,
  } = useActiveMomentsSlice((s) => ({
    feed: s.feeds.home,
    postsById: s.postsById,
    comments: s.comments,
    reactions: s.reactions,
    feedExplanations: s.feedExplanations,
    loadFeed: s.loadFeed,
    reactToPost: s.reactToPost,
    unreactToPost: s.unreactToPost,
    deletePost: s.deletePost,
  }));

  const posts = feed.postIds.map((id) => postsById[id]).filter(Boolean);

  const handleReact = useCallback((postId: string, kind: ReactionKind) =>
    reactToPost(postId, kind), [reactToPost]);
  const handleUnreact = useCallback((postId: string, kind?: ReactionKind) =>
    unreactToPost(postId, kind), [unreactToPost]);
  const handleDelete = useCallback((postId: string) =>
    deletePost(postId), [deletePost]);

  // Background refresh never replaces existing cards with a
  // page-level loading surface; the local list footer (MomentListState)
  // carries the spinner. The loading state is only full-page when
  // there is no data yet.
  const showInitialEmpty = posts.length === 0 && !feed.loading;
  const showInitialLoading = posts.length === 0 && feed.loading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <SocialScopeHint>{t('moments.feedContext.homeDescription')}</SocialScopeHint>

      {composerOpen && (
        <SocialComposer
          title={t('moments.compose.title')}
          hint={t('moments.compose.privacyHint')}
          onClose={onCloseComposer}
          closeLabel={t('moments.compose.close')}
        >
          <MomentComposer onPublished={onComposerPublished} />
        </SocialComposer>
      )}

      {showInitialLoading && <SocialEmptyState kind="loading" />}
      {showInitialEmpty && (
        <SocialEmptyState
          kind="empty"
          title={t('moments.placeholder.empty')}
          description={t('moments.placeholder.feedEmpty')}
        />
      )}

      {posts.map((p) => (
        <MomentCard
          key={p.id}
          post={p}
          reactions={reactions[p.id]}
          explanation={feedExplanations[p.id]}
          commentPreview={comments[p.id]}
          viewerActorPtid={_viewerActorPtid}
          surface="home"
          onOpen={onOpenPost}
          onAuthorClick={onAuthorClick}
          onReact={handleReact}
          onUnreact={handleUnreact}
          onDelete={handleDelete}
        />
      ))}

      {posts.length > 0 && (
        <MomentListState
          loading={feed.loading}
          empty={false}
          emptyText={t('moments.placeholder.feedEmpty')}
          loadMoreText={t('moments.action.loadMore')}
          hasMore={feed.hasMore}
          onLoadMore={() => loadFeed('home').catch(() => {})}
        />
      )}
    </div>
  );
}
