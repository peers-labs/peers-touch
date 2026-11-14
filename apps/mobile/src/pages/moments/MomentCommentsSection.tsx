import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, IconButton } from '@peers-touch/ui';

import { notifySuccess } from '../../app/feedback/mobileFeedback';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import { MobileNotice } from '../../components/MobileNotice';
import {
  type MomentPolicyState,
  type ReactionMutationState,
} from '../../features/social/momentsFeedStore';
import { isPublicSocialAudience } from '../../features/social/socialAudience';
import { useMomentDetail } from '../../features/social/useMomentsFeed';
import { useSocialExperience } from '../../features/social/useSocialExperience';
import type { SocialIntentPort } from '../../features/social/socialIntents';
import {
  useSocialActorIdentity,
  type SocialActorIdentityFallback,
} from '../../features/social/useSocialActorIdentity';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import type { Post } from '../../gen/proto/domain/social/post_pb';
import type { PrivateCommentProjection } from '../../services/mobileCommands';
import type { MomentReadSource } from '../../services/gateways/momentsGateway';
import { MomentFeedItem } from './MomentFeedItem';
import {
  MomentsFeedLoading,
  MomentsPolicyViolation,
  MomentsUnavailable,
} from './MomentsFeedStates';

export { readAuthoritativeMomentDetail } from '../../features/social/momentsFeedStore';
export type { MomentDetailReadback } from '../../features/social/momentsFeedStore';

const INITIAL_COMMENT_COUNT = 10;

export type CommentView =
  | { readonly route: 'PUBLIC'; readonly comment: Comment }
  | { readonly route: 'PRIVATE'; readonly comment: PrivateCommentProjection };

interface MomentCommentsSectionProps {
  readonly postId: string;
  readonly sourceId?: MomentReadSource;
  readonly commentId?: string;
  readonly post?: Post;
  readonly mode?: 'inline' | 'detail';
  readonly intents: Pick<
    SocialIntentPort,
    | 'comment'
    | 'deleteComment'
    | 'retry'
    | 'submitPrivateComment'
    | 'readPrivateComments'
  >;
  readonly onReact: (postId: string, reactionKind: number) => void;
  readonly onOpenAuthor?: (actorPtid: string, federationId: string) => void;
  readonly reactionMutation?: ReactionMutationState;
  readonly policyState?: MomentPolicyState;
  readonly reactionPickerOpen?: boolean;
  readonly onReactionPickerOpenChange?: (open: boolean) => void;
  readonly onClose?: () => void;
}

interface CommentReplyTarget {
  readonly authorName: string;
  readonly comment: CommentView;
}

export async function retryMomentDetailRuntime(
  intents: Pick<SocialIntentPort, 'retry'> | null,
): Promise<boolean> {
  if (!intents) return false;
  try {
    return await intents.retry();
  } catch {
    return false;
  }
}

export function resolvePrivateCommentDraftId(
  currentDraftId: string | null,
  createDraftId: () => string = () => crypto.randomUUID(),
): string {
  return currentDraftId ?? createDraftId();
}

export function shouldExpandCommentsAfterSubmission(
  expanded: boolean,
  currentCommentCount: number,
): boolean {
  return expanded || currentCommentCount >= INITIAL_COMMENT_COUNT;
}

export async function createMomentCommentAndReload(
  intents: Pick<SocialIntentPort, 'comment'>,
  postId: string,
  content: string,
  replyToCommentId: string | undefined,
): Promise<boolean> {
  return intents.comment(postId, content, replyToCommentId);
}

export async function deleteMomentCommentAndReload(
  intents: Pick<SocialIntentPort, 'deleteComment'>,
  postId: string,
  commentId: string,
): Promise<boolean> {
  return intents.deleteComment(postId, commentId);
}

export function MomentCommentsSection({
  postId,
  sourceId,
  commentId,
  post,
  mode = 'inline',
  intents,
  onReact,
  onOpenAuthor,
  reactionMutation,
  reactionPickerOpen = false,
  onReactionPickerOpenChange = () => undefined,
  onClose,
}: MomentCommentsSectionProps) {
  const { t } = useMobileI18n();
  const { facade, projection } = useSocialExperience();
  const privateRoute = sourceId === 'device.social' || (!sourceId && Boolean(
    post?.audience && !isPublicSocialAudience(post.audience),
  ));
  const usePrivateThread = privateRoute && !sourceId;
  const publicDetail = useMomentDetail(
    usePrivateThread ? null : (facade?.feed ?? null),
    postId,
    { sourceId, anchorCommentId: commentId },
  );
  const privateThread =
    projection?.runtime.privateSocial?.commentThreadsByPostId[postId];
  const comments = useMemo<CommentView[]>(
    () =>
      usePrivateThread
        ? (privateThread?.comments ?? []).map((comment) => ({
            route: 'PRIVATE' as const,
            comment,
          }))
        : publicDetail.comments.map((comment) => ({
            route: 'PUBLIC' as const,
            comment,
          })),
    [usePrivateThread, privateThread?.comments, publicDetail.comments],
  );
  const loading = usePrivateThread
    ? (privateThread?.loading ?? false)
    : publicDetail.loading;
  const initialized = usePrivateThread
    ? (privateThread?.initialized ?? false)
    : publicDetail.detail.kind !== 'loading';
  const hasMore = usePrivateThread
    ? (privateThread?.hasMore ?? true)
    : publicDetail.hasMore;
  const errorMessage = usePrivateThread
    ? (privateThread?.errorMessage ?? '')
    : publicDetail.errorMessage;
  const detailPost = usePrivateThread
    ? post
    : publicDetail.detail.kind === 'available'
      ? publicDetail.detail.post
      : undefined;
  const threadAuthorFallback = postAuthorIdentityFallback(detailPost ?? post);

  const [commentText, setCommentText] = useState('');
  const [replyTarget, setReplyTarget] = useState<CommentReplyTarget | null>(
    null,
  );
  const [commentDraftId, setCommentDraftId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(Boolean(commentId));
  const [sendError, setSendError] = useState(false);
  const commentAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpanded(Boolean(commentId));
    setReplyTarget(null);
    setCommentText('');
    setCommentDraftId(null);
    setSendError(false);
  }, [postId, sourceId, commentId]);

  useEffect(() => {
    if (!usePrivateThread || privateThread?.initialized || privateThread?.loading)
      return;
    void intents
      .readPrivateComments(postId, '', INITIAL_COMMENT_COUNT)
      .catch(() => undefined);
  }, [
    intents,
    postId,
    usePrivateThread,
    privateThread?.initialized,
    privateThread?.loading,
  ]);

  useEffect(() => {
    if (!replyTarget || !initialized || loading) return;
    if (!commentsContainReplyTarget(comments, replyTarget.comment)) {
      setReplyTarget(null);
    }
  }, [comments, initialized, loading, replyTarget]);

  const handleSendComment = useCallback(async () => {
    const trimmed = commentText.trim();
    if (!trimmed || sending) return;
    setSendError(false);
    setSending(true);
    try {
      const replyToCommentId = replyTarget
        ? commentViewId(replyTarget.comment)
        : undefined;
      const draftId = privateRoute
        ? resolvePrivateCommentDraftId(commentDraftId)
        : null;
      if (privateRoute && !commentDraftId) setCommentDraftId(draftId);
      const accepted = privateRoute
        ? Boolean(
            (
              await intents.submitPrivateComment({
                draftId: draftId!,
                draftRevision: 1,
                postId,
                replyToCommentId,
                text: trimmed,
              })
            ).comment,
          )
        : await createMomentCommentAndReload(
            intents,
            postId,
            trimmed,
            replyToCommentId,
          );
      if (accepted) {
        setCommentText('');
        setCommentDraftId(null);
        setReplyTarget(null);
        setExpanded((current) =>
          shouldExpandCommentsAfterSubmission(current, comments.length),
        );
      } else {
        setSendError(true);
      }
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }, [
    commentDraftId,
    commentText,
    sending,
    replyTarget,
    privateRoute,
    intents,
    postId,
    comments.length,
  ]);

  const handleLoadMore = useCallback(() => {
    if (usePrivateThread) {
      void intents
        .readPrivateComments(
          postId,
          privateThread?.nextCursor ?? '',
          INITIAL_COMMENT_COUNT,
        )
        .catch(() => undefined);
      return;
    }
    publicDetail.loadMore();
  }, [intents, postId, usePrivateThread, privateThread?.nextCursor, publicDetail]);

  const handleDelete = useCallback(
    async (commentId: string) => {
      if (privateRoute) return;
      if (await deleteMomentCommentAndReload(intents, postId, commentId)) {
        notifySuccess(t('mobile.moments.comment.deleted'));
      }
    },
    [intents, postId, privateRoute, t],
  );

  const visibleComments = expanded
    ? comments
    : comments.slice(0, INITIAL_COMMENT_COUNT);
  const replyAuthorName = replyTarget?.authorName ?? '';
  const canRenderThread = usePrivateThread
    ? Boolean(post)
    : publicDetail.detail.kind === 'available';
  const anchorVisible = Boolean(commentId && visibleComments.some(
    (comment) => commentViewId(comment) === commentId,
  ));
  useEffect(() => {
    if (!anchorVisible || loading || !canRenderThread) return;
    const frame = requestAnimationFrame(() => {
      const target = commentAnchorRef.current;
      target?.scrollIntoView({ block: 'center', behavior: 'auto' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorVisible, loading, canRenderThread, postId, sourceId, commentId]);

  return (
    <section
      className={`moments-comments-section moments-comments-section--${mode}`}
      data-acceptance-id="social-moment-thread"
      data-product-surface="moments.detail-comments"
      data-post-id={postId}
      data-source-id={sourceId}
      data-anchor-comment-id={commentId}
      aria-label={t('mobile.moments.comment.title')}
    >
      {mode === 'detail' && (
        <div className="moments-comments-header">
          <span className="moments-comments-header-back">
            <IconButton
              actionId="moment-comments-back"
              iconId="arrow-left"
              iconSize={18}
              label={t('mobile.moments.detail.back')}
              emphasis="quiet"
              onActivate={onClose}
            />
          </span>
          <strong className="moments-comments-header-title">
            {t('mobile.moments.detail.title')}
          </strong>
          <div className="moments-comments-header-spacer" />
        </div>
      )}

      <div className="moments-comments-list">
        {!usePrivateThread && publicDetail.detail.kind === 'loading' && (
          <MomentsFeedLoading productSurface="moments.detail-loading" />
        )}
        {!usePrivateThread && publicDetail.detail.kind === 'unavailable' && (
          <MomentsUnavailable
            reason={publicDetail.detail.reason}
            onRetry={() => void publicDetail.reloadMoment()}
            productSurface="moments.detail-unavailable"
          />
        )}
        {!usePrivateThread &&
          (publicDetail.detail.kind === 'hidden' ||
            publicDetail.detail.kind === 'blocked') && (
            <MomentsPolicyViolation
              blocked={publicDetail.detail.kind === 'blocked'}
              productSurface="moments.detail-hidden"
            />
          )}
        {!usePrivateThread &&
          publicDetail.detail.kind === 'deleted' &&
          !publicDetail.detail.post && (
            <div
              className="moments-comments-empty"
              data-product-surface="moments.detail-deleted"
              role="status"
            >
              <span className="moments-comments-muted">
                {t('mobile.moments.detail.deleted')}
              </span>
            </div>
          )}

        {mode === 'detail' && detailPost && (
          <>
            <MomentFeedItem
              post={detailPost}
              onReact={onReact}
              onOpenComments={() => undefined}
              onOpenAuthor={onOpenAuthor}
              reactionMutation={reactionMutation}
              reactionPickerOpen={reactionPickerOpen}
              onReactionPickerOpenChange={onReactionPickerOpenChange}
            />
            <div className="moments-detail-comments-title">
              <strong className="moments-comments-title">
                {t('mobile.moments.comment.title')}
              </strong>
            </div>
          </>
        )}

        {canRenderThread && loading && comments.length === 0 && (
          <div
            className="moments-comments-empty"
            data-product-surface="moments.comments-loading"
          >
            <span className="moments-comments-muted">
              {t('mobile.moments.comment.loading')}
            </span>
          </div>
        )}
        {canRenderThread &&
          mode === 'detail' &&
          initialized &&
          !loading &&
          comments.length === 0 &&
          !errorMessage && (
            <div
              className="moments-comments-empty"
              data-product-surface="moments.comments-empty"
            >
              <Icon iconId="message-circle" size={28} />
              <span className="moments-comments-muted">
                {t('mobile.moments.comment.empty')}
              </span>
            </div>
          )}
        {canRenderThread && errorMessage && (
          <div
            className="moments-comments-error"
            data-product-surface="moments.comments-error"
          >
            <span className="moments-comments-error-copy">
              {t('mobile.moments.comment.error')}
            </span>
            <Button
              actionId="moment-comments-error-retry"
              emphasis="quiet"
              density="compact"
              onActivate={() => {
                if (usePrivateThread) {
                  void intents
                    .readPrivateComments(postId, '', INITIAL_COMMENT_COUNT)
                    .catch(() => undefined);
                } else {
                  void publicDetail.reloadMoment();
                }
              }}
            >
              {t('mobile.moments.feed.retry')}
            </Button>
          </div>
        )}

        {canRenderThread && visibleComments.length > 0 && (
          <div
            className="moments-comments-items"
            data-comment-total={comments.length}
            data-comment-visible={visibleComments.length}
          >
            {visibleComments.map((comment) => (
              <div
                key={commentViewId(comment)}
                data-scroll-anchor-id={commentViewId(comment)}
                data-search-highlighted={commentViewId(comment) === commentId || undefined}
                ref={commentViewId(comment) === commentId ? commentAnchorRef : undefined}
                tabIndex={commentViewId(comment) === commentId ? -1 : undefined}
                style={commentViewId(comment) === commentId ? {
                  outline: '2px solid var(--pt-focus)',
                } : undefined}
              >
                <CommentItem
                  comment={comment}
                  threadAuthorFallback={threadAuthorFallback}
                  onReply={(target, authorName) =>
                    setReplyTarget({ comment: target, authorName })
                  }
                  onDelete={
                    !privateRoute && comment.route === 'PUBLIC' ? handleDelete : undefined
                  }
                />
              </div>
            ))}
          </div>
        )}

        {canRenderThread &&
          !expanded &&
          (comments.length > INITIAL_COMMENT_COUNT || hasMore) && (
            <Button
              actionId="moment-comments-expand"
              emphasis="quiet"
              density="compact"
              className="moments-comments-expand"
              onActivate={() => {
                setExpanded(true);
                if (comments.length <= INITIAL_COMMENT_COUNT && hasMore) {
                  handleLoadMore();
                }
              }}
            >
              {comments.length > INITIAL_COMMENT_COUNT
                ? t('mobile.moments.comment.showMore', {
                    count: comments.length - INITIAL_COMMENT_COUNT,
                  })
                : t('mobile.moments.comment.loadMore')}
            </Button>
          )}
        {canRenderThread &&
          expanded &&
          comments.length > INITIAL_COMMENT_COUNT && (
            <Button
              actionId="moment-comments-collapse"
              emphasis="quiet"
              density="compact"
              className="moments-comments-expand"
              onActivate={() => setExpanded(false)}
            >
              {t('mobile.moments.comment.collapse')}
            </Button>
          )}
        {canRenderThread && expanded && hasMore && !loading && (
          <div className="moments-comments-load-more">
            <Button
              actionId="moment-comments-load-more"
              emphasis="quiet"
              density="compact"
              onActivate={handleLoadMore}
            >
              {t('mobile.moments.comment.loadMore')}
            </Button>
          </div>
        )}

        {canRenderThread && loading && comments.length > 0 && (
          <div
            className="moments-comments-loading-more"
            data-product-surface="moments.comments-loading-more"
          >
            <span className="moments-comments-muted">
              {t('mobile.moments.feed.loadingMore')}
            </span>
          </div>
        )}
      </div>

      {canRenderThread && (
        <div
          className="moments-comments-input"
          data-product-surface={
            sending
              ? 'moments.comments-pending'
              : sendError
                ? 'moments.comments-failed'
                : undefined
          }
        >
          {sendError ? (
            <MobileNotice onClose={() => setSendError(false)}>
              {t('mobile.moments.comment.sendError')}
              <Button
                actionId="social-comment-retry"
                emphasis="secondary"
                density="compact"
                data-acceptance-id="social-comment-retry"
                leading={<Icon iconId="send" size={14} />}
                onActivate={() => void handleSendComment()}
              >
                {t('common.action.retry')}
              </Button>
            </MobileNotice>
          ) : null}
          {mode === 'inline' ? (
            <>
              <div
                className="moments-comment-input-field"
                data-replying={Boolean(replyTarget)}
              >
                <input
                  value={commentText}
                  data-acceptance-id="social-comment-input"
                  aria-label={t('mobile.moments.comment.title')}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder={
                    replyTarget
                      ? t('mobile.moments.reply.placeholder', {
                          name: replyAuthorName,
                        })
                      : t('mobile.moments.comment.placeholder')
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleSendComment();
                  }}
                  disabled={sending}
                />
                {replyTarget ? (
                  <button
                    type="button"
                    className="moments-comment-reply-clear"
                    onClick={() => setReplyTarget(null)}
                    aria-label={t('mobile.moments.reply.cancel')}
                  >
                    <Icon iconId="close" size={14} />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                data-acceptance-id="social-comment-send"
                onClick={() => void handleSendComment()}
                disabled={!commentText.trim() || sending}
                aria-label={t('mobile.moments.comment.send')}
              >
                <Icon iconId="send" size={16} />
              </button>
            </>
          ) : (
            <>
              <div
                className="moments-comment-input-field"
                data-replying={Boolean(replyTarget)}
              >
                <input
                  value={commentText}
                  data-acceptance-id="social-comment-input"
                  aria-label={t('mobile.moments.comment.title')}
                  onChange={(event) => setCommentText(event.target.value)}
                  placeholder={
                    replyTarget
                      ? t('mobile.moments.reply.placeholder', {
                          name: replyAuthorName,
                        })
                      : t('mobile.moments.comment.placeholder')
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleSendComment();
                  }}
                  disabled={sending}
                />
                {replyTarget ? (
                  <button
                    type="button"
                    className="moments-comment-reply-clear"
                    onClick={() => setReplyTarget(null)}
                    aria-label={t('mobile.moments.reply.cancel')}
                  >
                    <Icon iconId="close" size={14} />
                  </button>
                ) : null}
              </div>
              <Button
                actionId="social-comment-send"
                emphasis="primary"
                density="compact"
                fullWidth
                className="moments-comment-send"
                leading={<Icon iconId="send" size={14} />}
                data-acceptance-id="social-comment-send"
                availability={
                  !commentText.trim() || sending
                    ? {
                        kind: 'disabled',
                        reason: t('mobile.moments.comment.sendDisabled'),
                      }
                    : undefined
                }
                execution={sending ? 'pending' : 'idle'}
                onActivate={() => void handleSendComment()}
                aria-label={t('mobile.moments.comment.send')}
              >
                {t('mobile.moments.comment.send')}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

interface CommentItemProps {
  readonly comment: CommentView;
  readonly threadAuthorFallback: SocialActorIdentityFallback | null;
  readonly onReply: (comment: CommentView, authorName: string) => void;
  readonly onDelete?: (commentId: string) => void;
}

function CommentItem({
  comment,
  threadAuthorFallback,
  onReply,
  onDelete,
}: CommentItemProps) {
  const { t } = useMobileI18n();
  const publicComment = comment.route === 'PUBLIC' ? comment.comment : null;
  const authorIdentity = useSocialActorIdentity(
    commentIdentityFallback(comment, threadAuthorFallback),
  );
  const deleted = publicComment?.isDeleted ?? false;
  if (deleted) {
    return (
      <div className="moments-comment-item moments-comment-item--deleted">
        <span className="moments-comments-muted">
          {t('mobile.moments.comment.deleted')}
        </span>
      </div>
    );
  }
  return (
    <div className="moments-comment-item">
      <MobileAvatar
        identityKey={authorIdentity.actorPtid}
        src={authorIdentity.avatar}
        name={authorIdentity.displayName}
        size={28}
      />
      <div className="moments-comment-item__body">
        <strong className="moments-comment-item__author">
          {authorIdentity.displayName}
        </strong>
        {commentViewReplyTo(comment) && (
          <span className="moments-comment-item__reply-badge">
            {t('moments.comment.reply')}
          </span>
        )}
        <p className="moments-comment-item__content">
          {comment.route === 'PUBLIC'
            ? comment.comment.content
            : comment.comment.text}
        </p>
        <div className="moments-comment-item__actions">
          <button
            type="button"
            onClick={() => onReply(comment, authorIdentity.displayName)}
          >
            {t('moments.comment.reply')}
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(commentViewId(comment))}
            >
              {t('moments.comment.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function commentViewId(comment: CommentView): string {
  return comment.route === 'PUBLIC'
    ? comment.comment.id
    : comment.comment.commentId;
}

function commentViewReplyTo(comment: CommentView): string {
  return comment.route === 'PUBLIC'
    ? comment.comment.replyToCommentId
    : comment.comment.replyToCommentId;
}

function commentViewAuthorPtid(comment: CommentView): string {
  return comment.route === 'PUBLIC'
    ? (comment.comment.authorPtid ?? '')
    : (comment.comment.authorPtid ?? '');
}

function postAuthorIdentityFallback(
  post: Post | undefined,
): SocialActorIdentityFallback | null {
  if (!post) return null;
  const actorPtid = post.authorPtid || post.author?.id || '';
  if (!actorPtid) return null;
  return {
    actorPtid,
    avatar: post.author?.avatarUrl,
    displayName: post.author?.displayName,
    username: post.author?.username,
  };
}

export function commentIdentityFallback(
  comment: CommentView,
  threadAuthorFallback: SocialActorIdentityFallback | null,
): SocialActorIdentityFallback {
  const actorPtid = commentViewAuthorPtid(comment);
  if (threadAuthorFallback && threadAuthorFallback.actorPtid === actorPtid) {
    return threadAuthorFallback;
  }
  if (comment.route === 'PRIVATE') {
    return { actorPtid };
  }
  return {
    actorPtid,
    avatar: comment.comment.author?.avatarUrl,
    displayName: comment.comment.author?.displayName,
    username: comment.comment.author?.username,
  };
}

export function commentsContainReplyTarget(
  comments: readonly CommentView[],
  target: CommentView,
): boolean {
  const targetId = commentViewId(target);
  return comments.some((comment) => commentViewId(comment) === targetId);
}
