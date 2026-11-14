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
 * - MomentFeedItem: prototype-aligned feed article with reactions
 * - MomentCommentsSection: comment panel with reply support
 * - MomentsFeedStates: empty/loading/error/unavailable/policy states
 *
 * Mutations dispatch through the generation-scoped Social intent port.
 *
 * W6B: Refactored from monolithic page to pure-renderer pattern
 * with runtime-owned projection, cursor pagination, draft recovery,
 * reaction/comment/reply flows, and bounded feed.
 *
 * Visual ownership is split across the Moments module; this file only
 * binds runtime projections and intents to the Home/Explore surface.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Icon, IconButton } from '@peers-touch/ui';

import { useMobileI18n } from '../app/mobileI18n';
import {
  useMobileNavigationStore,
  type MobileDetailRoute,
  type MobileMomentsPaneId,
  type MobileMomentsFeedScope,
} from '../app/navigation';
import { useMomentsSurfaceFixture } from '../acceptance/momentsSurfaceFixture';
import { BoundedList } from '../components/BoundedList';
import { MobileNotice } from '../components/MobileNotice';
import { MobileNavigationHost } from '../components/MobileNavigationHost';
import { useAuthStore } from '../features/auth/authStore';
import { useSocialExperience } from '../features/social/useSocialExperience';
import { resolveMomentPolicyState } from '../features/social/momentsFeedStore';
import { isPublicSocialAudience } from '../features/social/socialAudience';
import type { SocialIntentPort } from '../features/social/socialIntents';
import {
  TimelinePageOutcome,
  TimelineSort,
  type Post,
} from '../gen/proto/domain/social/post_pb';
import type { PrivateMomentReadProjection } from '../services/mobileCommands';

import { ExploreSortSheet } from './moments/ExploreSortSheet';
import { MomentComposer } from './moments/MomentComposer';
import { MomentFeedItem } from './moments/MomentFeedItem';
import { MomentCommentsSection } from './moments/MomentCommentsSection';
import { MomentInlineComments } from './moments/MomentInlineComments';
import { MomentsAcceptanceSurface } from './moments/MomentsAcceptanceSurface';
import {
  MomentMediaOverlay,
  type MomentMediaSelection,
} from './moments/MomentMediaOverlay';
import { PrivateMomentRecoveryState } from './moments/PrivateMomentRecoveryState';
import {
  MomentsFeedEmpty,
  MomentsFeedError,
  MomentsFeedLoading,
  MomentsPolicyViolation,
  MomentsUnavailable,
} from './moments/MomentsFeedStates';
import { MomentsHeader } from './moments/MomentsHeader';
import { SocialCirclesContent } from './moments/SocialCirclesContent';
import './moments/Moments.css';

const MOMENTS_FEED_WINDOW_SIZE = 100;

function momentPostKey(post: Post): string {
  return post.id;
}

type BlockingPrivateMomentProjection = PrivateMomentReadProjection & {
  readonly state:
    'RECOVERY_REQUIRED' | 'INTEGRITY_FAILURE' | 'DELETED_OR_REVOKED';
};

function isBlockingPrivateMoment(
  projection: PrivateMomentReadProjection,
): projection is BlockingPrivateMomentProjection {
  return (
    projection.state === 'RECOVERY_REQUIRED' ||
    projection.state === 'INTEGRITY_FAILURE' ||
    projection.state === 'DELETED_OR_REVOKED'
  );
}

function withValue(
  values: ReadonlySet<string>,
  value: string,
): ReadonlySet<string> {
  return new Set([...values, value]);
}

function withoutValue(
  values: ReadonlySet<string>,
  value: string,
): ReadonlySet<string> {
  const next = new Set(values);
  next.delete(value);
  return next;
}

function nativeErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return '';
  return typeof error.code === 'string' ? error.code : '';
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

interface MomentsPageProps {
  readonly activePostId: string | null;
  readonly activeCommentId?: string | null;
  readonly activeReadSource?: 'device' | 'station' | null;
  readonly onOpenProfile: (actorPtid: string, federationId: string) => void;
  readonly onOpenSearch: () => void;
  readonly onOpenCircle: (route: Extract<MobileDetailRoute, { routeId: 'detail:social-circle' }>) => void;
  readonly onPaneChange: (pane: MobileMomentsPaneId, scope?: MobileMomentsFeedScope) => void;
  readonly onOpenNotifications: () => void;
  readonly onOpenGlobalSearch: () => void;
  readonly onImmersiveVisibilityChange: (visible: boolean) => void;
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
  activeCommentId,
  activeReadSource,
  onOpenProfile,
  onOpenSearch,
  onImmersiveVisibilityChange,
  onBack,
  onOpenCircle,
  onPaneChange,
  onOpenNotifications,
  onOpenGlobalSearch,
}: MomentsPageProps) {
  const fixture = useMomentsSurfaceFixture();
  if (fixture.surfaceId) {
    return (
      <MomentsAcceptanceSurface
        key={`${fixture.surfaceId}:${fixture.revision}`}
        surfaceId={fixture.surfaceId}
      />
    );
  }
  return (
    <MomentsPageInner
      activePostId={activePostId}
      activeCommentId={activeCommentId}
      activeReadSource={activeReadSource}
      onOpenProfile={onOpenProfile}
      onOpenSearch={onOpenSearch}
      onImmersiveVisibilityChange={onImmersiveVisibilityChange}
      onBack={onBack}
      onOpenCircle={onOpenCircle}
      onPaneChange={onPaneChange}
      onOpenNotifications={onOpenNotifications}
      onOpenGlobalSearch={onOpenGlobalSearch}
    />
  );
}

function MomentsPageInner({
  activePostId,
  activeCommentId,
  activeReadSource,
  onOpenProfile,
  onOpenSearch,
  onImmersiveVisibilityChange,
  onBack,
  onOpenCircle,
  onPaneChange,
  onOpenNotifications,
  onOpenGlobalSearch,
}: MomentsPageProps) {
  const { t } = useMobileI18n();
  const authSession = useAuthStore((state) => state.session);
  const { facade, projection } = useSocialExperience();
  const pane = useMobileNavigationStore(state => state.momentsPane);
  const feedScope = useMobileNavigationStore(state => state.momentsFeedScope);
  const searchOpen = useMobileNavigationStore(state => state.momentsSearchOpen);
  const query = useMobileNavigationStore(state => state.momentsQueries[pane]);
  const setSearchOpen = useMobileNavigationStore(state => state.setMomentsSearchOpen);
  const setQuery = useMobileNavigationStore(state => state.setMomentsQuery);

  // Feed state from the store
  const feedController = facade?.feeds?.[feedScope] ?? facade?.feed ?? null;
  const projectedFeedState = projection?.[feedScope] ?? projection?.home;
  const feed = {
    posts: projectedFeedState?.posts ?? [],
    loadState: projectedFeedState?.loadState ?? 'idle',
    hasMore: projectedFeedState?.hasMore ?? true,
    pageOutcome:
      projectedFeedState?.pageOutcome ?? TimelinePageOutcome.UNSPECIFIED,
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
  const searchedPosts = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return feed.posts;
    return feed.posts.filter(post => {
      const content = post.content;
      const publicText = content.case === 'repostPost' ? content.value.comment
        : content.value && 'text' in content.value ? content.value.text : '';
      const privatePost = projection?.runtime.privateSocial?.postsById[post.id];
      const privateContent = privatePost?.state === 'CONTENT_READY' ? privatePost.content : undefined;
      const privateText = privateContent && 'text' in privateContent ? privateContent.text
        : privateContent && 'comment' in privateContent ? privateContent.comment : '';
      return [post.author?.displayName, publicText, privateText].join(' ').toLocaleLowerCase().includes(q);
    });
  }, [feed.posts, projection?.runtime.privateSocial?.postsById, query]);
  const isPolicyFilteredEmpty =
    feed.pageOutcome === TimelinePageOutcome.FILTERED_EMPTY;

  // Local UI state
  const [noticeError, setNoticeError] = useState('');
  const [showNewPost, setShowNewPost] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [selectedThreadPostId, setSelectedThreadPostId] = useState<
    string | null
  >(null);
  const [reactionPickerPostId, setReactionPickerPostId] = useState<
    string | null
  >(null);
  const [mediaSelection, setMediaSelection] =
    useState<MomentMediaSelection | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [dismissedPrivateStates, setDismissedPrivateStates] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [privateActionKey, setPrivateActionKey] = useState<string | null>(null);
  const [privateActionErrors, setPrivateActionErrors] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const privateStateScopeKey = [
    projection?.scope?.stationPeerId ?? '',
    projection?.scope?.actorPtid ?? '',
    projection?.scope?.lifecycleGeneration ?? '',
  ].join('\u0000');
  const privateStateKey = useCallback(
    (postId: string) => `${privateStateScopeKey}\u0000${postId}`,
    [privateStateScopeKey],
  );
  const blockingPrivateStates = useMemo(
    () =>
      Object.values(projection?.runtime.privateSocial?.postsById ?? {}).filter(
        isBlockingPrivateMoment,
      ),
    [projection?.runtime.privateSocial?.postsById],
  );
  const blockingPrivateByPostId = useMemo(
    () =>
      new Map(
        blockingPrivateStates
          .filter(
            (privateProjection) =>
              !dismissedPrivateStates.has(
                privateStateKey(privateProjection.postId),
              ),
          )
          .map((privateProjection) => [
            privateProjection.postId,
            privateProjection,
          ]),
      ),
    [blockingPrivateStates, dismissedPrivateStates, privateStateKey],
  );
  const orphanBlockingPrivateStates = useMemo(() => {
    const visiblePostIds = new Set(feed.posts.map((post) => post.id));
    return [...blockingPrivateByPostId.values()].filter(
      (privateProjection) =>
        privateProjection.state !== 'DELETED_OR_REVOKED' &&
        !visiblePostIds.has(privateProjection.postId),
    );
  }, [blockingPrivateByPostId, feed.posts]);
  useEffect(() => {
    setReactionPickerPostId((current) => {
      if (!current || !feed.posts.some((post) => post.id === current)) {
        return null;
      }
      return !blockingPrivateByPostId.has(current) &&
        resolveMomentPolicyState(
          runtimeFeedState?.feedExplanations.get(current),
        ) === 'visible'
        ? current
        : null;
    });
  }, [
    blockingPrivateByPostId,
    feed.posts,
    runtimeFeedState?.feedExplanations,
  ]);
  useEffect(() => {
    setReactionPickerPostId(null);
  }, [privateStateScopeKey]);
  useEffect(() => {
    if (!mediaSelection) return;
    const postId = mediaSelection.postId;
    if (
      blockingPrivateByPostId.get(postId)?.state === 'DELETED_OR_REVOKED' ||
      !feed.posts.some((post) => post.id === postId)
    ) {
      setMediaSelection(null);
    }
  }, [blockingPrivateByPostId, feed.posts, mediaSelection]);

  // -- Projection availability check --
  const availability = projection?.runtime.availability;
  const isUnavailable = !availability?.available;
  const unavailableReason =
    availability && !availability.available
      ? availability.reason
      : t('mobile.moments.unavailable.description');

  // -- Handlers --

  const handlePublished = useCallback(() => {
    setShowNewPost(false);
  }, []);

  const handleReact = useCallback(
    async (postId: string, reactionKind: number) => {
      if (!facade) return;
      if (!(await facade.intents.react(postId, reactionKind))) {
        setNoticeError(t('mobile.moments.reaction.error'));
      }
    },
    [facade, t],
  );

  const handleReactionPickerOpenChange = useCallback(
    (postId: string, open: boolean) => {
      setReactionPickerPostId((current) =>
        open ? postId : current === postId ? null : current,
      );
    },
    [],
  );

  const handleOpenComments = useCallback((postId: string) => {
    setReactionPickerPostId(null);
    setSelectedThreadPostId((current) => (current === postId ? null : postId));
  }, []);

  const handleDeleteMoment = useCallback(
    async (postId: string) => {
      if (!facade || deletingPostId) return;
      setDeletingPostId(postId);
      try {
        if (!(await facade.intents.deleteMoment(postId))) {
          throw new Error('mobile.moments.delete.error');
        }
        setSelectedThreadPostId((current) =>
          current === postId ? null : current,
        );
        setReactionPickerPostId((current) =>
          current === postId ? null : current,
        );
        setMediaSelection((current) =>
          current?.postId === postId ? null : current,
        );
      } catch {
        setNoticeError(t('mobile.moments.delete.error'));
      } finally {
        setDeletingPostId(null);
      }
    },
    [deletingPostId, facade, t],
  );

  const handleRetry = useCallback(() => {
    if (!facade) return;
    void retryMomentsRuntime(facade.intents);
  }, [facade]);

  const handleExploreSort = useCallback(
    (sort: TimelineSort) => {
      if (!facade) return;
      void facade.feeds[feedScope].setSort(sort);
    },
    [facade, feedScope],
  );

  const handlePrivateRecovery = useCallback(
    async (postId: string) => {
      if (!facade || privateActionKey) return;
      const actionKey = privateStateKey(postId);
      setPrivateActionKey(actionKey);
      setPrivateActionErrors((current) => withoutValue(current, actionKey));
      try {
        await facade.intents.recoverPrivate(postId);
      } catch (error) {
        if (nativeErrorCode(error) !== 'MOBILE_SECURE_INPUT_CANCELLED') {
          setPrivateActionErrors((current) => withValue(current, actionKey));
        }
      } finally {
        setPrivateActionKey(null);
      }
    },
    [facade, privateActionKey, privateStateKey],
  );

  const handlePrivateVerificationRetry = useCallback(
    async (postId: string) => {
      if (!facade || privateActionKey) return;
      const actionKey = privateStateKey(postId);
      setPrivateActionKey(actionKey);
      setPrivateActionErrors((current) => withoutValue(current, actionKey));
      try {
        await facade.intents.readPrivate(postId);
      } catch {
        setPrivateActionErrors((current) => withValue(current, actionKey));
      } finally {
        setPrivateActionKey(null);
      }
    },
    [facade, privateActionKey, privateStateKey],
  );

  const handleOpenMedia = useCallback(
    (
      postId: string,
      attachmentId: string,
      kind: 'image' | 'video',
      trigger: HTMLButtonElement,
    ) => {
      const post = feed.posts.find((candidate) => candidate.id === postId);
      if (!post) return;
      setReactionPickerPostId(null);
      if (post.audience && !isPublicSocialAudience(post.audience)) {
        const readProjection =
          projection?.runtime.privateSocial?.postsById[postId];
        const media =
          readProjection?.content && 'media' in readProjection.content
            ? readProjection.content.media.find(
                (item) =>
                  item.attachmentId === attachmentId ||
                  item.objectId === attachmentId,
              )
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

      const attachment =
        post.content.case === 'imagePost'
          ? post.content.value.images.find((item) => item.id === attachmentId)
          : post.content.case === 'videoPost'
            ? post.content.value.video
            : undefined;
      if (!attachment) return;
      setMediaSelection({
        route: 'PUBLIC',
        kind,
        postId,
        attachment,
        returnFocus: trigger,
      });
    },
    [feed.posts, projection?.runtime.privateSocial?.postsById, t],
  );

  const renderPrivateBlockingState = (
    privateProjection: BlockingPrivateMomentProjection,
    onBackAction = () => {
      setDismissedPrivateStates((current) =>
        withValue(current, privateStateKey(privateProjection.postId)),
      );
    },
  ) => (
    <PrivateMomentRecoveryState
      projection={privateProjection}
      busy={privateActionKey === privateStateKey(privateProjection.postId)}
      error={privateActionErrors.has(privateStateKey(privateProjection.postId))}
      onBack={onBackAction}
      onRecover={() => void handlePrivateRecovery(privateProjection.postId)}
      onRetryVerification={() =>
        void handlePrivateVerificationRetry(privateProjection.postId)
      }
    />
  );

  // -- Render --

  const renderHeader = (openCreate: () => void) => (
    <MomentsHeader
      pane={pane}
      searchOpen={searchOpen}
      query={query}
      onPaneChange={onPaneChange}
      onSearchOpenChange={setSearchOpen}
      onQueryChange={value => setQuery(pane, value)}
      onAdd={openCreate}
      onOpenSearch={onOpenSearch}
      onOpenGlobalSearch={onOpenGlobalSearch}
      onOpenExplore={() => onPaneChange('feed', feedScope === 'explore' ? 'home' : 'explore')}
      onOpenNotifications={onOpenNotifications}
    />
  );

  const routeDetailPostId = activePostId ?? undefined;
  if (routeDetailPostId !== undefined) {
    const activePost = feed.posts.find((post) => post.id === routeDetailPostId);
    const privateBlockingState = activeReadSource === 'station' ? undefined : blockingPrivateStates.find(
      (privateProjection) => privateProjection.postId === routeDetailPostId,
    );
    const canReadDetail = Boolean(facade && (activeReadSource || !isUnavailable));
    return (
      <div
        className="page-container moments-page moments-route-detail"
        data-product-surface="moments.detail-comments"
      >
        {canReadDetail && privateBlockingState ? (
          renderPrivateBlockingState(privateBlockingState, onBack)
        ) : facade && canReadDetail ? (
          <MomentCommentsSection
            postId={routeDetailPostId}
            commentId={activeCommentId ?? undefined}
            sourceId={activeReadSource === 'device' ? 'device.social'
              : activeReadSource === 'station' ? 'station.social.public' : undefined}
            post={activePost}
            mode="detail"
            intents={facade.intents}
            onReact={(postId, kind) => void handleReact(postId, kind)}
            onOpenAuthor={onOpenProfile}
            reactionMutation={runtimeFeedState?.reactionMutations.get(
              routeDetailPostId,
            )}
            reactionPickerOpen={
              reactionPickerPostId === routeDetailPostId
            }
            onReactionPickerOpenChange={(open) =>
              handleReactionPickerOpenChange(routeDetailPostId, open)
            }
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
                <Icon iconId="arrow-left" size={20} />
              </button>
              <h1 className="header-title compact">
                {t('mobile.moments.detail.title')}
              </h1>
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

  const feedContent = (
    <div
      className="page-container moments-page"
      data-acceptance-id="social-moments-page"
      data-feed-scope={feedScope}
      data-product-surface="moments.feed"
    >
      {renderHeader(() => {
          setReactionPickerPostId(null);
          setShowNewPost(true);
      })}
      <div className="mobile-moments-feed-tools">
        <Button actionId="moments.feed.refresh" emphasis="quiet" density="comfortable"
          leading={<Icon iconId="refresh-cw" size={16} />} onActivate={feed.refresh}>
          {t('mobile.moments.feed.refresh')}
        </Button>
        <Button actionId="moments.feed.sort" emphasis="quiet" density="comfortable"
          leading={<Icon iconId="sliders-horizontal" size={16} />}
          onActivate={() => { setReactionPickerPostId(null); setShowSort(true); }}>
          {t(feedScope === 'explore' ? 'mobile.moments.scope.explore' : 'mobile.moments.panes.feed')}
          {' · '}{t(facade?.feeds?.[feedScope].sort() === TimelineSort.HOT
            ? 'mobile.moments.sort.hot' : 'mobile.moments.sort.recent')}
        </Button>
        <IconButton actionId="moments.feed.top" density="comfortable" emphasis="quiet"
          iconId="arrow-up" label={t('mobile.moments.feed.backToTop')}
          onActivate={(event) => event.currentTarget.closest('.page-container')?.scrollTo({ top: 0, behavior: 'auto' })} />
      </div>

      {noticeError ? (
        <MobileNotice onClose={() => setNoticeError('')}>
          {noticeError}
        </MobileNotice>
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
          onClose={() => setShowNewPost(false)}
        />
      )}

      {/* Feed states */}
      {!isUnavailable &&
        feed.loadState === 'loading' &&
        feed.posts.length === 0 && <MomentsFeedLoading />}

      {!isUnavailable &&
        feed.loadState === 'error' &&
        feed.posts.length === 0 && (
          <MomentsFeedError
            message={feed.errorMessage}
            onRetry={feed.retryFailure}
          />
        )}

      {!isUnavailable &&
        feed.loadState === 'idle' &&
        feed.posts.length === 0 &&
        orphanBlockingPrivateStates.length === 0 &&
        !isPolicyFilteredEmpty && <MomentsFeedEmpty />}

      {!isUnavailable &&
        feed.loadState === 'idle' &&
        feed.posts.length === 0 &&
        orphanBlockingPrivateStates.length === 0 &&
        isPolicyFilteredEmpty && <MomentsPolicyViolation />}

      {!isUnavailable && feed.posts.length > 0 && feed.failure && (
        <div
          className="moments-state moments-state--error"
          data-feed-failure={feed.failure.kind}
          role="alert"
        >
          <span className="moments-feed-state-copy">
            {feed.failure.message}
          </span>
          <Button
            actionId="moments-feed-retry-failure"
            emphasis="secondary"
            onActivate={feed.retryFailure}
          >
            {t('mobile.moments.feed.retry')}
          </Button>
        </div>
      )}

      {!isUnavailable &&
        feedScope === 'home' &&
        orphanBlockingPrivateStates.map((privateProjection) => (
          <div
            key={privateProjection.postId}
            data-scroll-anchor-id={privateProjection.postId}
          >
            {renderPrivateBlockingState(privateProjection)}
          </div>
        ))}

      {/* Feed list — prototype card layout */}
      {!isUnavailable && query.trim() && !searchedPosts.length && feed.posts.length ? (
        <Empty description={t('mobile.moments.searchEmpty', { query: query.trim() })} />
      ) : null}
      {!isUnavailable && feed.posts.length > 0 && (
        <div role="feed" aria-label={t('mobile.moments.title')}>
          <BoundedList
            surfaceKey={`moments:feed:${feedScope}:${query}`}
            items={searchedPosts}
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
                      <div
                        key={post.id}
                        className="moments-feed-entry"
                        data-scroll-anchor-id={post.id}
                      >
                        {feedScope === 'home' &&
                        blockingPrivateByPostId.has(post.id) ? (
                          renderPrivateBlockingState(
                            blockingPrivateByPostId.get(post.id)!,
                          )
                        ) : (
                          <MomentFeedItem
                            post={post}
                            onReact={(postId, kind) =>
                              void handleReact(postId, kind)
                            }
                            onOpenComments={handleOpenComments}
                            onDelete={
                              post.authorPtid === authSession?.actorRef.ptid
                                ? handleDeleteMoment
                                : undefined
                            }
                            deleteBusy={deletingPostId === post.id}
                            onOpenAuthor={onOpenProfile}
                            onOpenMedia={handleOpenMedia}
                            reactionMutation={runtimeFeedState?.reactionMutations.get(
                              post.id,
                            )}
                            reactionPickerOpen={
                              reactionPickerPostId === post.id
                            }
                            onReactionPickerOpenChange={(open) =>
                              handleReactionPickerOpenChange(post.id, open)
                            }
                            explanation={runtimeFeedState?.feedExplanations.get(
                              post.id,
                            )}
                            policyState={resolveMomentPolicyState(
                              runtimeFeedState?.feedExplanations.get(post.id),
                            )}
                          >
                            {selectedThreadPostId === post.id && facade && (
                              <MomentInlineComments
                                postId={post.id}
                                post={post}
                                intents={facade.intents}
                                onReact={(postId, kind) =>
                                  void handleReact(postId, kind)
                                }
                                onOpenAuthor={onOpenProfile}
                                reactionMutation={runtimeFeedState?.reactionMutations.get(
                                  post.id,
                                )}
                                policyState={resolveMomentPolicyState(
                                  runtimeFeedState?.feedExplanations.get(post.id),
                                )}
                              />
                            )}
                          </MomentFeedItem>
                        )}
                    </div>
                  ))}

                  {isRetainedTailWindow &&
                    feed.hasMore &&
                    feed.loadState === 'idle' && (
                      <div className="moments-feed-load-more">
                        <Button
                          actionId="moments-feed-load-more"
                          emphasis="quiet"
                          onActivate={feed.loadMore}
                        >
                          {t('mobile.moments.feed.loadMore')}
                        </Button>
                      </div>
                    )}

                  {isRetainedTailWindow &&
                    feed.loadState === 'loading-more' && (
                      <div className="moments-feed-loading-more">
                        <span className="moments-feed-state-copy">
                          {t('mobile.moments.feed.loadingMore')}
                        </span>
                      </div>
                    )}

                  {isRetainedTailWindow && !feed.hasMore && (
                    <div className="moments-feed-end">
                      <span className="moments-feed-state-copy">
                        {t('mobile.moments.feed.noMore')}
                      </span>
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
      {showSort && facade?.feeds?.[feedScope] && (
        <ExploreSortSheet
          value={facade.feeds[feedScope].sort()}
          onChange={handleExploreSort}
          onClose={() => setShowSort(false)}
        />
      )}
    </div>
  );
  return <MobileNavigationHost primary={{
    key: pane === 'circles' ? 'tab:moments:circles' : `tab:moments:feed:${feedScope}`,
    content: pane === 'circles' ? <SocialCirclesContent
      query={query} header={renderHeader} onOpenCircle={onOpenCircle}
    /> : feedContent,
  }} />;
}
