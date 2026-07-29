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
  viewerActorId?: string;
  onOpenPost: (postId: string) => void;
  onAuthorClick: (actorId: string) => void;
  onComposerPublished?: (postId: string) => void;
  composerOpen?: boolean;
  onCloseComposer?: () => void;
}

export function MomentsFeedView({
  viewerActorId: _viewerActorId,
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
  } = useActiveMomentsSlice((s) => ({
    feed: s.feeds.home,
    postsById: s.postsById,
    comments: s.comments,
    reactions: s.reactions,
    feedExplanations: s.feedExplanations,
    loadFeed: s.loadFeed,
    reactToPost: s.reactToPost,
    unreactToPost: s.unreactToPost,
  }));

  const posts = feed.postIds.map((id) => postsById[id]).filter(Boolean);

  const handleReact = async (postId: string, kind: ReactionKind) => {
    await reactToPost(postId, kind);
  };
  const handleUnreact = async (postId: string, kind?: ReactionKind) => {
    await unreactToPost(postId, kind);
  };

  const showInitialState = feed.loading || posts.length === 0;

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

      {showInitialState && (
        <SocialEmptyState
          kind={feed.loading ? 'loading' : 'empty'}
          title={feed.loading ? undefined : t('moments.placeholder.empty')}
          description={feed.loading ? undefined : t('moments.placeholder.feedEmpty')}
        />
      )}

      {posts.map((p) => (
        <MomentCard
          key={p.id}
          post={p}
          reactions={reactions[p.id]}
          explanation={feedExplanations[p.id]}
          commentPreview={comments[p.id]}
          viewerActorId={_viewerActorId}
          surface="home"
          onOpen={onOpenPost}
          onOpenComments={onOpenPost}
          onAuthorClick={onAuthorClick}
          onReact={handleReact}
          onUnreact={handleUnreact}
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
