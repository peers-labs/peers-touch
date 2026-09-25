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
 * Mutations remain online-only through MomentsGateway until their generated
 * command/result contracts are eligible for W4 durable admission.
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
import { ArrowLeft, ImagePlus, RefreshCw } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import { BoundedList } from '../components/BoundedList';
import { MobileNotice } from '../components/MobileNotice';
import { useAuthStore } from '../features/auth/authStore';
import {
  useMomentsFeed,
  useMomentsProjectionState,
} from '../features/social/useMomentsFeed';
import {
  resolveMomentPolicyState,
  type MomentsFeedStoreController,
} from '../features/social/momentsFeedStore';
import {
  readActiveMomentsRuntime,
  type ActiveMomentsRuntime,
} from '../runtimes/socialProjectionRuntime';
import {
  TimelinePageOutcome,
  type Post,
} from '../gen/proto/domain/social/post_pb';
import type { MomentsGateway } from '../services/gateways/momentsGateway';

import { MomentComposer } from './moments/MomentComposer';
import { MomentFeedItem } from './moments/MomentFeedItem';
import { MomentCommentsSection } from './moments/MomentCommentsSection';
import {
  MomentsFeedEmpty,
  MomentsFeedError,
  MomentsFeedLoading,
  MomentsPolicyViolation,
  MomentsUnavailable,
} from './moments/MomentsFeedStates';

const { Text } = Typography;
const MOMENTS_FEED_WINDOW_SIZE = 100;

function momentPostKey(post: Post): string {
  return post.id;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface MomentsPageProps {
  readonly activePostId: string | null;
  readonly onOpenMoment: (postId: string) => void;
  readonly onBack: () => void;
}

export async function submitInlineCommentToGateway(
  gateway: Pick<MomentsGateway, 'createComment'>,
  postId: string,
  content: string,
  refreshAuthoritativePost: Pick<MomentsFeedStoreController, 'refreshPost'>,
): Promise<boolean> {
  const result = await gateway.createComment(postId, content);
  if (!result.ok) return false;
  return refreshAuthoritativePost.refreshPost(postId);
}

export async function retryMomentsRuntime(
  runtime: Pick<ActiveMomentsRuntime, 'retry'>,
): Promise<boolean> {
  try {
    return await runtime.retry();
  } catch {
    return false;
  }
}

export function MomentsPage({
  activePostId,
  onOpenMoment,
  onBack,
}: MomentsPageProps) {
  const { t } = useMobileI18n();
  const authSession = useAuthStore((state) => state.session);
  const momentsRuntime = readActiveMomentsRuntime(authSession);
  const gateway = momentsRuntime?.gateway ?? null;
  const projection = momentsRuntime?.projection ?? null;

  // Feed state from the store
  const feed = useMomentsFeed(momentsRuntime?.feed ?? null);
  const runtimeFeedState = momentsRuntime?.feed.state();
  const isPolicyFilteredEmpty =
    feed.pageOutcome === TimelinePageOutcome.FILTERED_EMPTY;

  // Local UI state
  const [noticeError, setNoticeError] = useState('');
  const [showNewPost, setShowNewPost] = useState(false);

  // -- Projection availability check --
  const projectionState = useMomentsProjectionState(projection);
  const isUnavailable = !projectionState?.availability.available;
  const unavailableReason = projectionState && !projectionState.availability.available
    ? projectionState.availability.reason
    : t('mobile.moments.unavailable.description');

  // -- Handlers --

  const handlePublished = useCallback(
    (post: Post) => {
      feed.prependPost(post);
      setShowNewPost(false);
    },
    [feed],
  );

  const handleReact = useCallback(
    async (postId: string, reactionKind: number) => {
      if (!gateway || !momentsRuntime) return;
      const transaction = momentsRuntime.feed.beginReaction(postId, reactionKind);
      if (!transaction) return;

      const result = transaction.operation === 'unreact'
        ? await gateway.unreactToPost(postId, reactionKind)
        : await gateway.reactToPost(postId, reactionKind);

      if (result.ok) {
        momentsRuntime.feed.commitReaction(transaction, result.data.reactions);
      } else {
        momentsRuntime.feed.rollbackReaction(transaction, result.error.message);
        setNoticeError(t('mobile.moments.reaction.error'));
      }
    },
    [gateway, momentsRuntime, t],
  );

  const handleOpenComments = useCallback((postId: string) => {
    onOpenMoment(postId);
  }, [onOpenMoment]);

  const handleOpenDetail = useCallback((postId: string) => {
    onOpenMoment(postId);
  }, [onOpenMoment]);

  const handleSubmitInlineComment = useCallback(
    async (postId: string, content: string): Promise<boolean> => {
      if (!gateway || !momentsRuntime) return false;

      if (await submitInlineCommentToGateway(
        gateway,
        postId,
        content,
        momentsRuntime.feed,
      )) {
        return true;
      }

      setNoticeError(t('mobile.moments.comment.sendError'));
      return false;
    },
    [gateway, momentsRuntime, t],
  );

  const handleRetry = useCallback(() => {
    if (!momentsRuntime) return;
    void retryMomentsRuntime(momentsRuntime);
  }, [momentsRuntime]);

  // -- Render --

  // If comments panel is open, show it full-screen
  if (activePostId) {
    const activePost = feed.posts.find((post) => post.id === activePostId);
    return (
      <div className="page-container moments-page mobile-detail-page">
        {gateway && !isUnavailable ? (
          <MomentCommentsSection
            postId={activePostId}
            post={activePost}
            gateway={gateway}
            onReact={(postId, kind) => void handleReact(postId, kind)}
            reactionMutation={runtimeFeedState?.reactionMutations.get(activePostId)}
            policyState={resolveMomentPolicyState(
              runtimeFeedState?.feedExplanations.get(activePostId),
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

      {noticeError ? (
        <MobileNotice onClose={() => setNoticeError('')}>{noticeError}</MobileNotice>
      ) : null}

      {/* Unavailable state: projection failure */}
      {isUnavailable && (
        <MomentsUnavailable reason={unavailableReason} onRetry={handleRetry} />
      )}

      {/* Composer: toggled by the header ImagePlus button */}
      {showNewPost && !isUnavailable && authSession && gateway && (
        <MomentComposer
          session={authSession}
          gateway={gateway}
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
            surfaceKey="moments:feed"
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
                        onOpenDetail={handleOpenDetail}
                        onSubmitComment={handleSubmitInlineComment}
                        reactionMutation={runtimeFeedState?.reactionMutations.get(post.id)}
                        policyState={resolveMomentPolicyState(
                          runtimeFeedState?.feedExplanations.get(post.id),
                        )}
                      />
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
    </div>
  );
}
