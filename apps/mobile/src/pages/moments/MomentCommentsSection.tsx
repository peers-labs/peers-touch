import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Typography, message } from 'antd';
import { ArrowLeft, MessageCircle, Send, X } from 'lucide-react';

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
import { MomentFeedItem } from './MomentFeedItem';
import {
  MomentsFeedLoading,
  MomentsPolicyViolation,
  MomentsUnavailable,
} from './MomentsFeedStates';

export { readAuthoritativeMomentDetail } from '../../features/social/momentsFeedStore';
export type { MomentDetailReadback } from '../../features/social/momentsFeedStore';

const { Text, Paragraph } = Typography;
const INITIAL_COMMENT_COUNT = 10;

export type CommentView =
  | { readonly route: 'PUBLIC'; readonly comment: Comment }
  | { readonly route: 'PRIVATE'; readonly comment: PrivateCommentProjection };

interface MomentCommentsSectionProps {
  readonly postId: string;
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
  post,
  mode = 'inline',
  intents,
  onReact,
  onOpenAuthor,
  reactionMutation,
  onClose,
}: MomentCommentsSectionProps) {
  const { t } = useMobileI18n();
  const { facade, projection } = useSocialExperience();
  const viewerActorPtid = projection?.scope.actorPtid ?? '';
  const privateRoute = Boolean(
    post?.audience && !isPublicSocialAudience(post.audience),
  );
  const publicDetail = useMomentDetail(
    privateRoute ? null : (facade?.feed ?? null),
    postId,
  );
  const privateThread =
    projection?.runtime.privateSocial?.commentThreadsByPostId[postId];
  const comments = useMemo<CommentView[]>(
    () =>
      privateRoute
        ? (privateThread?.comments ?? []).map((comment) => ({
            route: 'PRIVATE' as const,
            comment,
          }))
        : publicDetail.comments.map((comment) => ({
            route: 'PUBLIC' as const,
            comment,
          })),
    [privateRoute, privateThread?.comments, publicDetail.comments],
  );
  const loading = privateRoute
    ? (privateThread?.loading ?? false)
    : publicDetail.loading;
  const initialized = privateRoute
    ? (privateThread?.initialized ?? false)
    : publicDetail.detail.kind !== 'loading';
  const hasMore = privateRoute
    ? (privateThread?.hasMore ?? true)
    : publicDetail.hasMore;
  const errorMessage = privateRoute
    ? (privateThread?.errorMessage ?? '')
    : publicDetail.errorMessage;
  const detailPost = privateRoute
    ? post
    : publicDetail.detail.kind === 'available'
      ? publicDetail.detail.post
      : undefined;
  const threadAuthorFallback = postAuthorIdentityFallback(detailPost ?? post);

  const [commentText, setCommentText] = useState('');
  const [replyTarget, setReplyTarget] = useState<CommentReplyTarget | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sendError, setSendError] = useState(false);

  useEffect(() => {
    setExpanded(false);
    setReplyTarget(null);
    setCommentText('');
    setSendError(false);
  }, [postId]);

  useEffect(() => {
    if (!privateRoute || privateThread?.initialized || privateThread?.loading)
      return;
    void intents
      .readPrivateComments(postId, '', INITIAL_COMMENT_COUNT)
      .catch(() => undefined);
  }, [
    intents,
    postId,
    privateRoute,
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
      const accepted = privateRoute
        ? Boolean(
            (
              await intents.submitPrivateComment({
                draftId: crypto.randomUUID(),
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
        setReplyTarget(null);
      } else {
        setSendError(true);
      }
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }, [commentText, sending, replyTarget, privateRoute, intents, postId]);

  const handleLoadMore = useCallback(() => {
    if (privateRoute) {
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
  }, [intents, postId, privateRoute, privateThread?.nextCursor, publicDetail]);

  const handleDelete = useCallback(
    async (commentId: string) => {
      if (privateRoute) return;
      if (await deleteMomentCommentAndReload(intents, postId, commentId)) {
        message.success(t('mobile.moments.comment.deleted'));
      }
    },
    [intents, postId, privateRoute, t],
  );

  const visibleComments = expanded
    ? comments
    : comments.slice(0, INITIAL_COMMENT_COUNT);
  const replyAuthorName = replyTarget?.authorName ?? '';
  const canRenderThread = privateRoute
    ? Boolean(post)
    : publicDetail.detail.kind === 'available';

  return (
    <section
      className={`moments-comments-section moments-comments-section--${mode}`}
      data-acceptance-id="social-moment-thread"
      data-product-surface="moments.detail-comments"
      data-post-id={postId}
      aria-label={t('mobile.moments.comment.title')}
    >
      {mode === 'detail' && (
        <div className="moments-comments-header">
          <Button
            type="text"
            icon={<ArrowLeft size={18} />}
            onClick={onClose}
            aria-label={t('mobile.moments.detail.back')}
          />
          <Text strong>{t('mobile.moments.detail.title')}</Text>
          <div className="moments-comments-header-spacer" />
        </div>
      )}

      <div className="moments-comments-list">
        {!privateRoute && publicDetail.detail.kind === 'loading' && (
          <MomentsFeedLoading productSurface="moments.detail-loading" />
        )}
        {!privateRoute && publicDetail.detail.kind === 'unavailable' && (
          <MomentsUnavailable
            reason={publicDetail.detail.reason}
            onRetry={() => void retryMomentDetailRuntime(intents)}
            productSurface="moments.detail-unavailable"
          />
        )}
        {!privateRoute &&
          (publicDetail.detail.kind === 'hidden' ||
            publicDetail.detail.kind === 'blocked') && (
            <MomentsPolicyViolation
              blocked={publicDetail.detail.kind === 'blocked'}
              productSurface="moments.detail-hidden"
            />
          )}
        {!privateRoute &&
          publicDetail.detail.kind === 'deleted' &&
          !publicDetail.detail.post && (
            <div
              className="moments-comments-empty"
              data-product-surface="moments.detail-deleted"
              role="status"
            >
              <Text type="secondary">{t('mobile.moments.detail.deleted')}</Text>
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
              commentCount={comments.length}
            />
            <div className="moments-detail-comments-title">
              <Text strong>{t('mobile.moments.comment.title')}</Text>
            </div>
          </>
        )}

        {canRenderThread && loading && comments.length === 0 && (
          <div
            className="moments-comments-empty"
            data-product-surface="moments.comments-loading"
          >
            <Text type="secondary">{t('mobile.moments.comment.loading')}</Text>
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
              <MessageCircle size={28} />
              <Text type="secondary">{t('mobile.moments.comment.empty')}</Text>
            </div>
          )}
        {canRenderThread && errorMessage && (
          <div
            className="moments-comments-error"
            data-product-surface="moments.comments-error"
          >
            <Text type="danger">{t('mobile.moments.comment.error')}</Text>
            <Button
              size="small"
              onClick={() => {
                if (privateRoute) {
                  void intents
                    .readPrivateComments(postId, '', INITIAL_COMMENT_COUNT)
                    .catch(() => undefined);
                } else {
                  void retryMomentDetailRuntime(intents);
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
              >
                <CommentItem
                  comment={comment}
                  threadAuthorFallback={threadAuthorFallback}
                  onReply={(target, authorName) =>
                    setReplyTarget({ comment: target, authorName })
                  }
                  onDelete={
                    comment.route === 'PUBLIC'
                    && commentViewAuthorPtid(comment) === viewerActorPtid
                      ? handleDelete
                      : undefined
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
              type="text"
              size="small"
              className="moments-comments-expand"
              onClick={() => {
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
              type="text"
              size="small"
              className="moments-comments-expand"
              onClick={() => setExpanded(false)}
            >
              {t('mobile.moments.comment.collapse')}
            </Button>
          )}
        {canRenderThread && expanded && hasMore && !loading && (
          <div className="moments-comments-load-more">
            <Button type="text" size="small" onClick={handleLoadMore}>
              {t('mobile.moments.comment.loadMore')}
            </Button>
          </div>
        )}

        {canRenderThread && loading && comments.length > 0 && (
          <div
            className="moments-comments-loading-more"
            data-product-surface="moments.comments-loading-more"
          >
            <Text type="secondary">{t('mobile.moments.feed.loadingMore')}</Text>
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
                size="small"
                icon={<Send size={14} />}
                onClick={() => void handleSendComment()}
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
                    <X size={14} />
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
                <Send size={16} />
              </button>
            </>
          ) : (
            <>
              <div
                className="moments-comment-input-field"
                data-replying={Boolean(replyTarget)}
              >
                <Input
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
                  onPressEnter={() => void handleSendComment()}
                  disabled={sending}
                />
                {replyTarget ? (
                  <button
                    type="button"
                    className="moments-comment-reply-clear"
                    onClick={() => setReplyTarget(null)}
                    aria-label={t('mobile.moments.reply.cancel')}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
              <Button
                type="primary"
                icon={<Send size={14} />}
                data-acceptance-id="social-comment-send"
                onClick={() => void handleSendComment()}
                disabled={!commentText.trim() || sending}
                loading={sending}
                size="small"
                aria-label={t('mobile.moments.comment.send')}
              />
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
        <Text type="secondary">{t('mobile.moments.comment.deleted')}</Text>
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
        <Text strong className="moments-comment-item__author">
          {authorIdentity.displayName}
        </Text>
        {commentViewReplyTo(comment) && (
          <Text type="secondary" className="moments-comment-item__reply-badge">
            {t('moments.comment.reply')}
          </Text>
        )}
        <Paragraph className="moments-comment-item__content">
          {comment.route === 'PUBLIC'
            ? comment.comment.content
            : comment.comment.text}
        </Paragraph>
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
