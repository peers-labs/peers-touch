import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Typography, message } from 'antd';
import { ArrowLeft, MessageCircle, Send, X } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import {
  type MomentPolicyState,
  type ReactionMutationState,
} from '../../features/social/momentsFeedStore';
import { isPublicSocialAudience } from '../../features/social/socialAudience';
import { useMomentDetail } from '../../features/social/useMomentsFeed';
import { useSocialExperience } from '../../features/social/useSocialExperience';
import type { SocialIntentPort } from '../../features/social/socialIntents';
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

type CommentView =
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
  const privateRoute = Boolean(post?.audience && !isPublicSocialAudience(post.audience));
  const publicDetail = useMomentDetail(
    privateRoute ? null : facade?.feed ?? null,
    postId,
  );
  const privateThread = projection?.runtime.privateSocial
    ?.commentThreadsByPostId[postId];
  const comments = useMemo<CommentView[]>(() => (
    privateRoute
      ? (privateThread?.comments ?? []).map((comment) => ({
          route: 'PRIVATE' as const,
          comment,
        }))
      : publicDetail.comments.map((comment) => ({
          route: 'PUBLIC' as const,
          comment,
        }))
  ), [privateRoute, privateThread?.comments, publicDetail.comments]);
  const loading = privateRoute
    ? privateThread?.loading ?? false
    : publicDetail.loading;
  const initialized = privateRoute
    ? privateThread?.initialized ?? false
    : publicDetail.detail.kind !== 'loading';
  const hasMore = privateRoute
    ? privateThread?.hasMore ?? true
    : publicDetail.hasMore;
  const errorMessage = privateRoute
    ? privateThread?.errorMessage ?? ''
    : publicDetail.errorMessage;
  const detailPost = privateRoute
    ? post
    : publicDetail.detail.kind === 'available'
      ? publicDetail.detail.post
      : undefined;

  const [commentText, setCommentText] = useState('');
  const [replyTarget, setReplyTarget] = useState<CommentView | null>(null);
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
    setReplyTarget(null);
    setCommentText('');
  }, [postId]);

  useEffect(() => {
    if (!privateRoute || privateThread?.initialized || privateThread?.loading) return;
    void intents.readPrivateComments(postId, '', INITIAL_COMMENT_COUNT)
      .catch(() => undefined);
  }, [
    intents,
    postId,
    privateRoute,
    privateThread?.initialized,
    privateThread?.loading,
  ]);

  const handleSendComment = useCallback(async () => {
    const trimmed = commentText.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const replyToCommentId = replyTarget
        ? commentViewId(replyTarget)
        : undefined;
      const accepted = privateRoute
        ? Boolean((await intents.submitPrivateComment({
            draftId: crypto.randomUUID(),
            draftRevision: 1,
            postId,
            replyToCommentId,
            text: trimmed,
          })).comment)
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
        message.error(t('mobile.moments.comment.sendError'));
      }
    } catch {
      message.error(t('mobile.moments.comment.sendError'));
    } finally {
      setSending(false);
    }
  }, [commentText, sending, replyTarget, privateRoute, intents, postId, t]);

  const handleLoadMore = useCallback(() => {
    if (privateRoute) {
      void intents.readPrivateComments(
        postId,
        privateThread?.nextCursor ?? '',
        INITIAL_COMMENT_COUNT,
      ).catch(() => undefined);
      return;
    }
    publicDetail.loadMore();
  }, [
    intents,
    postId,
    privateRoute,
    privateThread?.nextCursor,
    publicDetail,
  ]);

  const handleDelete = useCallback(async (commentId: string) => {
    if (privateRoute) return;
    if (await deleteMomentCommentAndReload(intents, postId, commentId)) {
      message.success(t('mobile.moments.comment.deleted'));
    }
  }, [intents, postId, privateRoute, t]);

  const visibleComments = expanded
    ? comments
    : comments.slice(0, INITIAL_COMMENT_COUNT);
  const replyAuthorName = replyTarget ? commentViewAuthor(replyTarget) : '';
  const canRenderThread = privateRoute
    ? Boolean(post)
    : publicDetail.detail.kind === 'available';

  return (
    <section
      className={`moments-comments-section moments-comments-section--${mode}`}
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
          <MomentsFeedLoading />
        )}
        {!privateRoute && publicDetail.detail.kind === 'unavailable' && (
          <MomentsUnavailable
            reason={publicDetail.detail.reason}
            onRetry={() => void retryMomentDetailRuntime(intents)}
          />
        )}
        {!privateRoute && (
          publicDetail.detail.kind === 'hidden'
          || publicDetail.detail.kind === 'blocked'
        ) && (
          <MomentsPolicyViolation blocked={publicDetail.detail.kind === 'blocked'} />
        )}
        {!privateRoute && publicDetail.detail.kind === 'deleted' && !publicDetail.detail.post && (
          <div className="moments-comments-empty" role="status">
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
            />
            <div className="moments-detail-comments-title">
              <Text strong>{t('mobile.moments.comment.title')}</Text>
            </div>
          </>
        )}

        {canRenderThread && loading && comments.length === 0 && (
          <div className="moments-comments-empty">
            <Text type="secondary">{t('mobile.moments.comment.loading')}</Text>
          </div>
        )}
        {canRenderThread && initialized && !loading && comments.length === 0 && !errorMessage && (
          <div className="moments-comments-empty">
            <MessageCircle size={28} />
            <Text type="secondary">{t('mobile.moments.comment.empty')}</Text>
          </div>
        )}
        {canRenderThread && errorMessage && (
          <div className="moments-comments-error">
            <Text type="danger">{t('mobile.moments.comment.error')}</Text>
            <Button
              size="small"
              onClick={() => {
                if (privateRoute) {
                  void intents.readPrivateComments(postId, '', INITIAL_COMMENT_COUNT)
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
                  onReply={setReplyTarget}
                  onDelete={comment.route === 'PUBLIC' ? handleDelete : undefined}
                />
              </div>
            ))}
          </div>
        )}

        {canRenderThread && !expanded && (
          comments.length > INITIAL_COMMENT_COUNT || hasMore
        ) && (
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
        {canRenderThread && expanded && comments.length > INITIAL_COMMENT_COUNT && (
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
      </div>

      {canRenderThread && replyTarget && (
        <div className="moments-comments-reply-indicator">
          <Text type="secondary">
            {t('mobile.moments.reply.placeholder', { name: replyAuthorName })}
          </Text>
          <button
            type="button"
            onClick={() => setReplyTarget(null)}
            aria-label={t('mobile.moments.reply.cancel')}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {canRenderThread && (
        <div className="moments-comments-input">
          <Input
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            placeholder={replyTarget
              ? t('mobile.moments.reply.placeholder', { name: replyAuthorName })
              : t('mobile.moments.comment.placeholder')}
            onPressEnter={() => void handleSendComment()}
            disabled={sending}
          />
          <Button
            type="primary"
            icon={<Send size={14} />}
            onClick={() => void handleSendComment()}
            disabled={!commentText.trim() || sending}
            loading={sending}
            size="small"
            aria-label={t('mobile.moments.comment.send')}
          />
        </div>
      )}
    </section>
  );
}

interface CommentItemProps {
  readonly comment: CommentView;
  readonly onReply: (comment: CommentView) => void;
  readonly onDelete?: (commentId: string) => void;
}

function CommentItem({ comment, onReply, onDelete }: CommentItemProps) {
  const { t } = useMobileI18n();
  const publicComment = comment.route === 'PUBLIC' ? comment.comment : null;
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
        src={publicComment?.author?.avatarUrl}
        size={28}
      />
      <div className="moments-comment-item__body">
        <Text strong className="moments-comment-item__author">
          {commentViewAuthor(comment)}
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
          <button type="button" onClick={() => onReply(comment)}>
            {t('moments.comment.reply')}
          </button>
          {onDelete && (
            <button type="button" onClick={() => onDelete(commentViewId(comment))}>
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

function commentViewAuthor(comment: CommentView): string {
  return comment.route === 'PUBLIC'
    ? comment.comment.author?.displayName
      || comment.comment.author?.username
      || ''
    : comment.comment.authorPtid;
}
