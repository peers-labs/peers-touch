import { useTranslation } from 'react-i18next';
import { useMomentsStore } from '../../store/moments';
import { MomentCard } from '../../components/moments/MomentCard';
import { MomentComposer } from '../../components/moments/MomentComposer';
import { MomentListState } from '../../components/moments/MomentListState';
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
  const feed = useMomentsStore((s) => s.feeds.home);
  const postsById = useMomentsStore((s) => s.postsById);
  const comments = useMomentsStore((s) => s.comments);
  const reactions = useMomentsStore((s) => s.reactions);
  const feedExplanations = useMomentsStore((s) => s.feedExplanations);
  const loadFeed = useMomentsStore((s) => s.loadFeed);
  const reactToPost = useMomentsStore((s) => s.reactToPost);
  const unreactToPost = useMomentsStore((s) => s.unreactToPost);

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
