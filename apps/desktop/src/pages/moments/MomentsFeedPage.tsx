import { useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Empty, FeedSortFloat, Spin } from '@peers-touch/ui';
import { MomentCard } from '../../components/moments/MomentCard';
import { useActiveMomentsSlice, useActiveRelationshipsSlice } from '../../components/moments/useActiveMomentsStore';
import { momentSearchText, selectMomentsTimeline } from '../../store/momentsTimeline';

interface MomentsFeedViewProps {
  viewerActorPtid?: string;
  onOpenPost: (postId: string) => void;
  onAuthorClick: (actorPtid: string) => void;
  query: string;
  scrollRef: RefObject<HTMLDivElement | null>;
}

/** One reading stream; HOME and public retain their original owners and cursors. */
export function MomentsFeedView({ viewerActorPtid, onOpenPost, onAuthorClick, query, scrollRef }: MomentsFeedViewProps) {
  const { t } = useTranslation('moments');
  const { home, publicFeed, postsById, reactions, explanations, sort, setSort, loadFeed,
    reactToPost, unreactToPost, deletePost } = useActiveMomentsSlice(state => ({
    home: state.feeds.home, publicFeed: state.feeds.explore, postsById: state.postsById,
    reactions: state.reactions, explanations: state.feedExplanations,
    sort: state.timelineSort, setSort: state.setTimelineSort, loadFeed: state.loadFeed,
    reactToPost: state.reactToPost, unreactToPost: state.unreactToPost, deletePost: state.deletePost,
  }));
  const [error, setError] = useState(false);
  const { blockedActors, blockedActorsLoadedAt, blockedActorsError } = useActiveRelationshipsSlice(state => ({
    blockedActors: state.blockedActors, blockedActorsLoadedAt: state.blockedActorsLoadedAt,
    blockedActorsError: state.blockedActorsError,
  }));
  const q = query.trim().toLocaleLowerCase();
  const posts = useMemo(() => {
    const timeline = selectMomentsTimeline(home.postIds, publicFeed.postIds, postsById, sort, reactions);
    return timeline.filter(post => !blockedActors[post.authorPtid] && (!q || momentSearchText(post).includes(q)));
  }, [home.postIds, publicFeed.postIds, postsById, reactions, blockedActors, sort, q]);
  const loading = home.loading || publicFeed.loading;
  const more = home.hasMore || publicFeed.hasMore;
  const loadMore = async () => {
    setError(false);
    const results = await Promise.allSettled([
      ...(home.hasMore ? [loadFeed('home')] : []),
      ...(publicFeed.hasMore ? [loadFeed('explore', { sort: 'recent' })] : []),
    ]);
    setError(results.some(result => result.status === 'rejected'));
  };
  if (!blockedActorsLoadedAt) return blockedActorsError
    ? <Alert variant="inline" tone="warning" description={t('moments.empty.degraded.description')} />
    : <Spin label={t('moments.follow.loading')} />;
  return <>
    {!q && <FeedSortFloat value={sort} onChange={setSort} scrollRef={scrollRef}
      copy={{ label: t('moments.sort.label'), recent: t('moments.tab.recent'),
        hot: t('moments.tab.hot'), top: t('moments.action.backToTop') }} />}
    {posts.length === 0 && (loading ? <Spin label={t('moments.follow.loading')} />
      : <Empty description={q ? t('moments.search.noMatch', { query }) : t('moments.placeholder.feedEmpty')} />)}
    {posts.map(post => <MomentCard key={post.id} post={post}
      reactions={reactions[post.id]} explanation={explanations[post.id]} viewerActorPtid={viewerActorPtid}
      surface={home.postIds.includes(post.id) ? 'home' : 'federated'}
      onOpen={onOpenPost} onAuthorClick={onAuthorClick} onReact={reactToPost}
      onUnreact={unreactToPost} onDelete={deletePost} />)}
    {error && <Alert variant="inline" tone="warning" description={t('moments.empty.degraded.description')} />}
    {!q && posts.length > 0 && (more ? <Button actionId="moments.load-more" emphasis="quiet" fullWidth
      label={t('moments.action.loadMore')} execution={loading ? 'pending' : 'idle'}
      onActivate={() => void loadMore()} /> : <span className="moments-feed-end">{t('moments.placeholder.feedEnd')}</span>)}
  </>;
}
