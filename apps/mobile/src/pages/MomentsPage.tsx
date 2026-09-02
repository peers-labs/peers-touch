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
 * All interactions dispatch through InteractionAdmission (reactions,
 * comments) or the MomentsGateway (feed pagination, publish).
 *
 * W6B: Refactored from monolithic page to pure-renderer pattern
 * with runtime-owned projection, cursor pagination, draft recovery,
 * reaction/comment/reply flows, and bounded feed.
 */

import { useCallback, useMemo, useState } from 'react';
import { Button, Typography } from 'antd';
import { RefreshCw } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import { MobileNotice } from '../components/MobileNotice';
import { useAuthStore } from '../features/auth/authStore';
import { useMomentsFeed } from '../features/social/useMomentsFeed';
import { getInteractionAdmission } from '../runtimes/commandRuntime';
import { createMomentsGateway, type MomentsGateway } from '../services/gateways/momentsGateway';
import {
  createMomentsProjection,
  type MomentsProjectionController,
} from '../runtimes/momentsProjectionDescriptor';
import { createSocialEventIngress } from '../runtimes/socialEventIngress';
import type { Post } from '../gen/proto/domain/social/post_pb';
import type { MobileAuthSession } from '../features/auth/authSession';

import { MomentComposer } from './moments/MomentComposer';
import { MomentFeedItem } from './moments/MomentFeedItem';
import { MomentCommentsSection } from './moments/MomentCommentsSection';
import {
  MomentsFeedEmpty,
  MomentsFeedError,
  MomentsFeedLoading,
  MomentsUnavailable,
} from './moments/MomentsFeedStates';

const { Text } = Typography;

// ---------------------------------------------------------------------------
// Lazy-initialized runtime singletons scoped to authenticated session
// ---------------------------------------------------------------------------

let cachedGateway: MomentsGateway | null = null;
let cachedProjection: MomentsProjectionController | null = null;
let cachedSessionToken = '';

function getSessionGateway(session: MobileAuthSession): MomentsGateway {
  if (cachedGateway && cachedSessionToken === session.accessToken) {
    return cachedGateway;
  }
  cachedSessionToken = session.accessToken;
  cachedGateway = createMomentsGateway(session);
  return cachedGateway;
}

function getSessionProjection(): MomentsProjectionController {
  if (cachedProjection) return cachedProjection;
  const ingress = createSocialEventIngress({
    onEvent: () => {
      // Events routed through projection ingestEvent below
    },
  });
  cachedProjection = createMomentsProjection(ingress);
  return cachedProjection;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function MomentsPage() {
  const { t } = useMobileI18n();
  const authSession = useAuthStore((state) => state.session);

  // Memoize gateway and projection based on session
  const gateway = useMemo(
    () => (authSession ? getSessionGateway(authSession) : null),
    [authSession],
  );
  const projection = useMemo(() => getSessionProjection(), []);

  // Feed state from the store
  const feed = useMomentsFeed(gateway, projection);

  // Local UI state
  const [noticeError, setNoticeError] = useState('');
  const [activeCommentsPostId, setActiveCommentsPostId] = useState<string | null>(null);

  // -- Projection availability check --
  const projectionState = projection.state();
  const isUnavailable = !projectionState.availability.available;
  const unavailableReason = !projectionState.availability.available
    ? projectionState.availability.reason
    : '';

  // -- Handlers --

  const handlePublished = useCallback(
    (post: Post) => {
      feed.prependPost(post);
    },
    [feed],
  );

  const handleReact = useCallback(
    async (postId: string, reactionKind: number) => {
      if (!gateway) return;

      // Record in command ledger
      try {
        const admission = getInteractionAdmission();
        await admission.admit({
          commandType: 'reaction_toggle',
          category: 'moments',
          orderingKey: `post:${postId}`,
          payloadJson: JSON.stringify({ postId, reactionKind }),
        });
      } catch {
        // Ledger recording is best-effort
      }

      // Check current state to toggle
      const post = feed.posts.find((p) => p.id === postId);
      const currentReaction = post?.reactions.find((r) => r.kind === reactionKind);
      const isCurrentlyReacted = currentReaction?.reactedByViewer ?? false;

      const result = isCurrentlyReacted
        ? await gateway.unreactToPost(postId, reactionKind)
        : await gateway.reactToPost(postId, reactionKind);

      if (result.ok) {
        feed.updateReaction(postId, result.data.reactions);
      } else {
        setNoticeError(t('mobile.moments.reaction.error'));
      }
    },
    [gateway, feed, t],
  );

  const handleOpenComments = useCallback((postId: string) => {
    setActiveCommentsPostId(postId);
  }, []);

  const handleCloseComments = useCallback(() => {
    setActiveCommentsPostId(null);
  }, []);

  const handleOpenDetail = useCallback((postId: string) => {
    // For now, open comments as detail view
    setActiveCommentsPostId(postId);
  }, []);

  const handleRetry = useCallback(() => {
    projection.markAvailable();
    feed.loadFeed();
  }, [projection, feed]);

  // -- Render --

  // If comments panel is open, show it full-screen
  if (activeCommentsPostId && gateway) {
    return (
      <div className="page-container moments-page">
        <MomentCommentsSection
          postId={activeCommentsPostId}
          gateway={gateway}
          onClose={handleCloseComments}
        />
      </div>
    );
  }

  return (
    <div className="page-container moments-page">
      <div className="page-header">
        <div className="header-title">{t('mobile.moments.title')}</div>
        {feed.loadState !== 'refreshing' && (
          <Button
            type="text"
            icon={<RefreshCw size={16} />}
            onClick={feed.refresh}
            aria-label={t('mobile.moments.feed.refresh')}
          />
        )}
        {feed.loadState === 'refreshing' && (
          <Text type="secondary">{t('mobile.moments.feed.refreshing')}</Text>
        )}
      </div>

      {noticeError ? (
        <MobileNotice onClose={() => setNoticeError('')}>{noticeError}</MobileNotice>
      ) : null}

      {/* Unavailable state: projection failure */}
      {isUnavailable && (
        <MomentsUnavailable reason={unavailableReason} onRetry={handleRetry} />
      )}

      {/* Composer: only when authenticated and available */}
      {!isUnavailable && authSession && gateway && (
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
        <MomentsFeedError message={feed.errorMessage} onRetry={feed.loadFeed} />
      )}

      {!isUnavailable && feed.loadState === 'idle' && feed.posts.length === 0 && (
        <MomentsFeedEmpty />
      )}

      {/* Feed list */}
      {!isUnavailable && feed.posts.length > 0 && (
        <div className="moments-feed-list" role="feed" aria-label={t('mobile.moments.title')}>
          {feed.posts.map((post) => (
            <MomentFeedItem
              key={post.id}
              post={post}
              onReact={(postId, kind) => void handleReact(postId, kind)}
              onOpenComments={handleOpenComments}
              onOpenDetail={handleOpenDetail}
            />
          ))}

          {/* Load more trigger */}
          {feed.hasMore && feed.loadState === 'idle' && (
            <div className="moments-feed-load-more">
              <Button type="text" onClick={feed.loadMore}>
                {t('mobile.moments.feed.loadMore')}
              </Button>
            </div>
          )}

          {feed.loadState === 'loading-more' && (
            <div className="moments-feed-loading-more">
              <Text type="secondary">{t('mobile.moments.feed.loadingMore')}</Text>
            </div>
          )}

          {!feed.hasMore && (
            <div className="moments-feed-end">
              <Text type="secondary">{t('mobile.moments.feed.noMore')}</Text>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
