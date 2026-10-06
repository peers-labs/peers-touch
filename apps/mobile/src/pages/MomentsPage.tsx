/**
 * MomentsPage.tsx — Pure renderer for the Moments feed
 *
 * Consumes the moments projection (via MomentsFeedStore) and renders
 * the feed, composer, comments, and state indicators. This page does
 * NOT perform mount-time fetches; data flows from the runtime-owned
 * projection and the feed store's cursor-based pagination.
 *
 * Architecture:
 * - MomentComposer: draft save/restore via DraftRestorationPort
 * - MomentFeedItem: individual post card with reactions
 * - MomentCommentsSection: comment panel with reply support
 * - MomentsFeedStates: empty/loading/error/unavailable/policy states
 *
 * Mutations dispatch through the generation-scoped Social intent port.
 *
 * W6B: Refactored from monolithic page to pure-renderer pattern
 * with runtime-owned projection, cursor pagination, draft recovery,
 * reaction/comment/reply flows, and bounded feed.
 *
 * W6B-sync: Visual hierarchy aligned with prototype MomentsPage.
 * Header uses ImagePlus toggle; feed uses Card-based layout.
 */

import { useCallback, useState } from 'react';
import { Button, Typography } from 'antd';
import { ArrowLeft, ImagePlus, RefreshCw, Search } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import { BoundedList } from '../components/BoundedList';
import { MobileNotice } from '../components/MobileNotice';
import { useAuthStore } from '../features/auth/authStore';
import { useSocialExperience } from '../features/social/useSocialExperience';
import {
  resolveMomentPolicyState,
} from '../features/social/momentsFeedStore';
import { isPublicSocialAudience } from '../features/social/socialAudience';
import type { SocialIntentPort } from '../features/social/socialIntents';
import {
  TimelinePageOutcome,
  TimelineSort,
  type Post,
} from '../gen/proto/domain/social/post_pb';

import { MomentComposer } from './moments/MomentComposer';
import { MomentFeedItem } from './moments/MomentFeedItem';
import { MomentCommentsSection } from './moments/MomentCommentsSection';
import {
  MomentMediaOverlay,
  type MomentMediaSelection,
} from './moments/MomentMediaOverlay';
import {
  MomentsFeedEmpty,
  MomentsFeedError,
  MomentsFeedLoading,
  MomentsPolicyViolation,
  MomentsUnavailable,
} from './moments/MomentsFeedStates';

const { Text } = Typography;
const MOMENTS_FEED_WINDOW_SIZE = 100;
type MomentsFeedScope = 'home' | 'explore';

function momentPostKey(post: Post): string {
  return post.id;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface MomentsPageProps {
  readonly activePostId: string | null;
  readonly onOpenProfile: (actorPtid: string, federationId: string) => void;
  readonly onOpenSearch: () => void;
  readonly onBack: () => void;
}

export async function submitInlineCommentIntent(
  intents: Pick<SocialIntentPort, 'comment'>,
  postId: string,
  content: string,
): Promise<boolean> {
  return intents.comment(postId, content);
}

export async function retryMomentsRuntime(
  intents: Pick<SocialIntentPort, 'retry'>,
): Promise<boolean> {
  try {
    return await intents.retry();
  } catch {
    return false;
  }
}

export function MomentsPage({
  activePostId,
  onOpenProfile,
  onOpenSearch,
  onBack,
}: MomentsPageProps) {
  const { t } = useMobileI18n();
  const authSession = useAuthStore((state) => state.session);
  const { facade, projection } = useSocialExperience();
  const [feedScope, setFeedScope] = useState<MomentsFeedScope>('home');

  // Feed state from the store
  const feedController = facade?.feeds?.[feedScope] ?? facade?.feed ?? null;
  const projectedFeedState = projection?.[feedScope] ?? projection?.home;
  const feed = {
    posts: projectedFeedState?.posts ?? [],
    loadState: projectedFeedState?.loadState ?? 'idle',
    hasMore: projectedFeedState?.hasMore ?? true,
    pageOutcome: projectedFeedState?.pageOutcome ?? TimelinePageOutcome.UNSPECIFIED,
    errorMessage: projectedFeedState?.errorMessage ?? '',
    failure: projectedFeedState?.failure ?? null,
    loadMore: () => void feedController?.loadMore(),
    refresh: () => void feedController?.refresh(),
    retryFailure: () => {
      const failure = projectedFeedState?.failure;
      if (!feedController || !failure) return;
      if (failure.kind === 'load-more') {
        void feedController.loadMore();
      } else if (failure.kind === 'refresh') {
        void feedController.refresh();
      } else {
        void feedController.loadFeed();
      }
    },
  };
  const runtimeFeedState = projectedFeedState;
  const isPolicyFilteredEmpty =
    feed.pageOutcome === TimelinePageOutcome.FILTERED_EMPTY;

  // Local UI state
  const [noticeError, setNoticeError] = useState('');
  const [showNewPost, setShowNewPost] = useState(false);
  const [selectedThreadPostId, setSelectedThreadPostId] = useState<string | null>(null);
  const [mediaSelection, setMediaSelection] = useState<MomentMediaSelection | null>(null);

  // -- Projection availability check --
  const availability = projection?.runtime.availability;
  const isUnavailable = !availability?.available;
  const unavailableReason = availability && !availability.available
    ? availability.reason
    : t('mobile.moments.unavailable.description');

  // -- Handlers --

  const handlePublished = useCallback(
    () => {
      setShowNewPost(false);
    },
    [],
  );

  const handleReact = useCallback(
    async (postId: string, reactionKind: number) => {
      if (!facade) return;
      if (!await facade.intents.react(postId, reactionKind)) {
        setNoticeError(t('mobile.moments.reaction.error'));
      }
    },
    [facade, t],
  );

  const handleOpenComments = useCallback((postId: string) => {
    setSelectedThreadPostId((current) => current === postId ? null : postId);
  }, []);

  const handleRetry = useCallback(() => {
    if (!facade) return;
    void retryMomentsRuntime(facade.intents);
  }, [facade]);

  const handleExploreSort = useCallback((sort: TimelineSort) => {
    if (!facade) return;
    void facade.feeds.explore.setSort(sort);
  }, [facade]);

  const handleOpenMedia = useCallback((
    postId: string,
    attachmentId: string,
    kind: 'image' | 'video',
    trigger: HTMLButtonElement,
  ) => {
    const post = feed.posts.find((candidate) => candidate.id === postId);
    if (!post) return;
    if (post.audience && !isPublicSocialAudience(post.audience)) {
      const readProjection = projection?.runtime.privateSocial?.postsById[postId];
      const media = readProjection?.content && 'media' in readProjection.content
        ? readProjection.content.media.find((item) => (
            item.attachmentId === attachmentId || item.objectId === attachmentId
          ))
        : undefined;
      if (!media) {
        setNoticeError(t('mobile.moments.media.previewFailed'));
        return;
      }
      setMediaSelection({
        route: 'PRIVATE',
        kind,
        postId,
        objectId: media.objectId,
        returnFocus: trigger,
      });
      return;
    }

    const attachment = post.content.case === 'imagePost'
      ? post.content.value.images.find((item) => item.id === attachmentId)
      : post.content.case === 'videoPost'
        ? post.content.value.video
        : undefined;
    if (!attachment) return;
    setMediaSelection({
      route: 'PUBLIC',
      kind,
      attachment,
      returnFocus: trigger,
    });
  }, [feed.posts, projection?.runtime.privateSocial?.postsById, t]);

  // -- Render --

  const routeDetailPostId = activePostId ?? undefined;
  if (routeDetailPostId !== undefined) {
    const activePost = feed.posts.find((post) => post.id === routeDetailPostId);
    return (
      <div className="page-container moments-page moments-route-detail">
        {facade && !isUnavailable ? (
          <MomentCommentsSection
            postId={routeDetailPostId}
            post={activePost}
            mode="detail"
            intents={facade.intents}
            onReact={(postId, kind) => void handleReact(postId, kind)}
            onOpenAuthor={onOpenProfile}
            reactionMutation={runtimeFeedState?.reactionMutations.get(routeDetailPostId)}
            policyState={resolveMomentPolicyState(
              runtimeFeedState?.feedExplanations.get(routeDetailPostId),
            )}
            onClose={onBack}
          />
        ) : (
          <>
            <header className="page-header">
              <button
                type="button"
                className="header-action"
                aria-label={t('common.action.back')}
                onClick={onBack}
              >
                <ArrowLeft size={20} />
              </button>
              <h1 className="header-title compact">{t('mobile.moments.detail.title')}</h1>
            </header>
            <MomentsUnavailable
              reason={t('mobile.social.notAuthenticated')}
              onRetry={handleRetry}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="page-container moments-page">
      {/* Header: title + ImagePlus new-post toggle (prototype) */}
      <header className="page-header">
        <h1 className="header-title">{t('mobile.moments.title')}</h1>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.social.search.title')}
          onClick={onOpenSearch}
        >
          <Search size={20} />
        </button>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.moments.feed.refresh')}
          aria-busy={feed.loadState === 'refreshing'}
          disabled={isUnavailable || feed.loadState === 'refreshing'}
          onClick={feed.refresh}
        >
          <RefreshCw size={20} />
        </button>
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.moments.newPost')}
          onClick={() => setShowNewPost(!showNewPost)}
        >
          <ImagePlus size={20} />
        </button>
      </header>

      <div className="moments-scope-bar">
        <div
          className="moments-scope-segment"
          role="tablist"
          aria-label={t('mobile.moments.scope.label')}
        >
          {(['home', 'explore'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              role="tab"
              aria-selected={feedScope === scope}
              className="moments-scope-control"
              data-active={feedScope === scope}
              onClick={() => setFeedScope(scope)}
            >
              {t(`mobile.moments.scope.${scope}`)}
            </button>
          ))}
        </div>
        {feedScope === 'explore' && facade ? (
          <div
            className="moments-sort-segment"
            role="group"
            aria-label={t('mobile.moments.sort.label')}
          >
            {([
              [TimelineSort.RECENT, 'recent'],
              [TimelineSort.HOT, 'hot'],
            ] as const).map(([sort, label]) => (
              <button
                key={label}
                type="button"
                className="moments-sort-control"
                data-active={facade.feeds.explore.sort() === sort}
                onClick={() => handleExploreSort(sort)}
              >
                {t(`mobile.moments.sort.${label}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {noticeError ? (
        <MobileNotice onClose={() => setNoticeError('')}>{noticeError}</MobileNotice>
      ) : null}

      {/* Unavailable state: projection failure */}
      {isUnavailable && (
        <MomentsUnavailable reason={unavailableReason} onRetry={handleRetry} />
      )}

      {/* Composer: toggled by the header ImagePlus button */}
      {showNewPost && !isUnavailable && authSession && facade && (
        <MomentComposer
          session={authSession}
          intents={facade.intents}
          onPublished={handlePublished}
        />
      )}

      {/* Feed states */}
      {!isUnavailable && feed.loadState === 'loading' && feed.posts.length === 0 && (
        <MomentsFeedLoading />
      )}

      {!isUnavailable && feed.loadState === 'error' && feed.posts.length === 0 && (
        <MomentsFeedError message={feed.errorMessage} onRetry={feed.retryFailure} />
      )}

      {!isUnavailable
        && feed.loadState === 'idle'
        && feed.posts.length === 0
        && !isPolicyFilteredEmpty && (
        <MomentsFeedEmpty />
      )}

      {!isUnavailable
        && feed.loadState === 'idle'
        && feed.posts.length === 0
        && isPolicyFilteredEmpty && (
        <MomentsPolicyViolation />
      )}

      {!isUnavailable && feed.posts.length > 0 && feed.loadState === 'refreshing' && (
        <div className="moments-feed-loading-more" role="status">
          <Text type="secondary">{t('mobile.moments.feed.loading')}</Text>
        </div>
      )}

      {!isUnavailable && feed.posts.length > 0 && feed.failure && (
        <div
          className="moments-state moments-state--error"
          data-feed-failure={feed.failure.kind}
          role="alert"
        >
          <Text type="secondary">{feed.failure.message}</Text>
          <Button onClick={feed.retryFailure}>
            {t('mobile.moments.feed.retry')}
          </Button>
        </div>
      )}

      {/* Feed list — prototype card layout */}
      {!isUnavailable && feed.posts.length > 0 && (
        <div role="feed" aria-label={t('mobile.moments.title')}>
          <BoundedList
            surfaceKey={`moments:feed:${feedScope}`}
            items={feed.posts}
            itemKey={momentPostKey}
            size={MOMENTS_FEED_WINDOW_SIZE}
          >
            {(windowedPosts) => {
              const windowTail = windowedPosts[windowedPosts.length - 1]?.id;
              const retainedTail = feed.posts[feed.posts.length - 1]?.id;
              const isRetainedTailWindow = windowTail === retainedTail;

              return (
                <div className="moments-feed">
                  {windowedPosts.map((post) => (
                    <div key={post.id} data-scroll-anchor-id={post.id}>
                      <MomentFeedItem
                        post={post}
                        onReact={(postId, kind) => void handleReact(postId, kind)}
                        onOpenComments={handleOpenComments}
                        onOpenAuthor={onOpenProfile}
                        onOpenMedia={handleOpenMedia}
                        reactionMutation={runtimeFeedState?.reactionMutations.get(post.id)}
                        policyState={resolveMomentPolicyState(
                          runtimeFeedState?.feedExplanations.get(post.id),
                        )}
                      />
                      {selectedThreadPostId === post.id && facade && (
                        <MomentCommentsSection
                          postId={post.id}
                          post={post}
                          mode="inline"
                          intents={facade.intents}
                          onReact={(postId, kind) => void handleReact(postId, kind)}
                          onOpenAuthor={onOpenProfile}
                          reactionMutation={runtimeFeedState?.reactionMutations.get(post.id)}
                          policyState={resolveMomentPolicyState(
                            runtimeFeedState?.feedExplanations.get(post.id),
                          )}
                        />
                      )}
                    </div>
                  ))}

                  {isRetainedTailWindow && feed.hasMore && feed.loadState === 'idle' && (
                    <div className="moments-feed-load-more">
                      <Button type="text" onClick={feed.loadMore}>
                        {t('mobile.moments.feed.loadMore')}
                      </Button>
                    </div>
                  )}

                  {isRetainedTailWindow && feed.loadState === 'loading-more' && (
                    <div className="moments-feed-loading-more">
                      <Text type="secondary">{t('mobile.moments.feed.loadingMore')}</Text>
                    </div>
                  )}

                  {isRetainedTailWindow && !feed.hasMore && (
                    <div className="moments-feed-end">
                      <Text type="secondary">{t('mobile.moments.feed.noMore')}</Text>
                    </div>
                  )}
                </div>
              );
            }}
          </BoundedList>
        </div>
      )}
      {mediaSelection && facade && (
        <MomentMediaOverlay
          selection={mediaSelection}
          intents={facade.intents}
          onClose={() => setMediaSelection(null)}
        />
      )}
    </div>
  );
}
