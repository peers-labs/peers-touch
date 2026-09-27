/**
 * MomentCommentsSection.tsx — Comments panel for a moment post
 *
 * Renders a cursor-paginated comment list with reply support.
 * Comment creation and reply remain online-only until their generated
 * command/result contracts are eligible for W4 durable admission.
 *
 * W6B: Initial implementation with comment, reply, and delete flows.
 */

import { useCallback, useState } from 'react';
import { Button, Input, Typography, message } from 'antd';
import { ArrowLeft, MessageCircle, Send, X } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { BoundedList } from '../../components/BoundedList';
import { MobileAvatar } from '../../components/MobileAvatar';
import { useAuthStore } from '../../features/auth/authStore';
import {
  type MomentPolicyState,
  type ReactionMutationState,
} from '../../features/social/momentsFeedStore';
import { useMomentDetail } from '../../features/social/useMomentsFeed';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import type { Post } from '../../gen/proto/domain/social/post_pb';
import {
  readActiveMomentsRuntime,
  type ActiveMomentsRuntime,
} from '../../runtimes/socialProjectionRuntime';
import type { MomentsGateway } from '../../services/gateways/momentsGateway';
import { MomentFeedItem } from './MomentFeedItem';
import {
  MomentsFeedLoading,
  MomentsPolicyViolation,
  MomentsUnavailable,
} from './MomentsFeedStates';

export { readAuthoritativeMomentDetail } from '../../features/social/momentsFeedStore';
export type { MomentDetailReadback } from '../../features/social/momentsFeedStore';

const { Text, Paragraph } = Typography;
const MOMENT_COMMENTS_WINDOW_SIZE = 100;

function momentCommentKey(comment: Comment): string {
  return comment.id;
}

export async function retryMomentDetailRuntime(
  runtime: Pick<ActiveMomentsRuntime, 'retry'> | null,
): Promise<boolean> {
  if (!runtime) return false;
  try {
    return await runtime.retry();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MomentCommentsSectionProps {
  readonly postId: string;
  /** Feed snapshot retained only for caller compatibility; detail never renders from it. */
  readonly post?: Post;
  readonly gateway: MomentsGateway;
  readonly onReact: (postId: string, reactionKind: number) => void;
  readonly reactionMutation?: ReactionMutationState;
  readonly policyState?: MomentPolicyState;
  readonly onClose: () => void;
}

export async function createMomentCommentAndReload(
  gateway: Pick<MomentsGateway, 'createComment'>,
  postId: string,
  content: string,
  replyToCommentId: string | undefined,
  reloadMoment: () => Promise<boolean>,
): Promise<boolean> {
  const result = await gateway.createComment(postId, content, replyToCommentId);
  if (!result.ok) return false;
  return reloadMoment();
}

export async function deleteMomentCommentAndReload(
  gateway: Pick<MomentsGateway, 'deleteComment'>,
  commentId: string,
  reloadMoment: () => Promise<boolean>,
): Promise<boolean> {
  const result = await gateway.deleteComment(commentId);
  if (!result.ok) return false;
  return reloadMoment();
}

export function MomentCommentsSection({
  postId,
  gateway,
  onReact,
  reactionMutation,
  onClose,
}: MomentCommentsSectionProps) {
  const { t } = useMobileI18n();
  const authSession = useAuthStore((state) => state.session);
  const momentsRuntime = readActiveMomentsRuntime(authSession);
  const {
    detail,
    comments,
    loading,
    hasMore,
    errorMessage,
    loadMore,
    reloadMoment,
  } = useMomentDetail(
    momentsRuntime?.feed ?? null,
    postId,
  );
  const detailPost = detail.kind === 'available' ? detail.post : undefined;

  const [commentText, setCommentText] = useState('');
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);

  const handleSendComment = useCallback(async () => {
    const trimmed = commentText.trim();
    if (!trimmed || sending) return;

    setSending(true);

    const accepted = await createMomentCommentAndReload(
      gateway,
      postId,
      trimmed,
      replyTarget?.id,
      reloadMoment,
    );

    setSending(false);

    if (accepted) {
      setCommentText('');
      setReplyTarget(null);
    } else {
      message.error(t('mobile.moments.comment.sendError'));
    }
  }, [commentText, sending, postId, replyTarget, gateway, reloadMoment, t]);

  const handleReply = useCallback((comment: Comment) => {
    setReplyTarget(comment);
  }, []);

  const handleCancelReply = useCallback(() => {
    setReplyTarget(null);
  }, []);

  const handleDelete = useCallback(async (commentId: string) => {
    if (await deleteMomentCommentAndReload(gateway, commentId, reloadMoment)) {
      message.success(t('mobile.moments.comment.deleted'));
    }
  }, [gateway, reloadMoment, t]);

  // -- Render --

  const replyAuthorName = replyTarget?.author?.displayName
    || replyTarget?.author?.username
    || '';

  return (
    <div className="moments-comments-section">
      {/* Header */}
      <div className="moments-comments-header">
        <Button
          type="text"
          icon={<ArrowLeft size={18} />}
          onClick={onClose}
          aria-label={t('mobile.moments.detail.back')}
        />
        <Text strong>{t('mobile.moments.detail.title')}</Text>
        <div style={{ width: 32 }} /> {/* Spacer for centering */}
      </div>

      {/* Selected post and its comment thread share one continuous detail rail. */}
      <div className="moments-comments-list">
        {detail.kind === 'loading' && <MomentsFeedLoading />}

        {detail.kind === 'unavailable' && (
          <MomentsUnavailable
            reason={detail.reason}
            onRetry={() => void retryMomentDetailRuntime(momentsRuntime)}
          />
        )}

        {(detail.kind === 'hidden' || detail.kind === 'blocked') && (
          <MomentsPolicyViolation blocked={detail.kind === 'blocked'} />
        )}

        {detail.kind === 'deleted' && detail.post && (
          <MomentFeedItem
            post={detail.post}
            onReact={onReact}
            onOpenComments={() => undefined}
            onOpenDetail={() => undefined}
            reactionMutation={reactionMutation}
            showInlineComment={false}
          />
        )}

        {detail.kind === 'deleted' && !detail.post && (
          <div className="moments-comments-empty" role="status">
            <Text type="secondary">{t('mobile.moments.detail.deleted')}</Text>
          </div>
        )}

        {detailPost && (
          <>
            <MomentFeedItem
              post={detailPost}
              onReact={onReact}
              onOpenComments={() => undefined}
              onOpenDetail={() => undefined}
              reactionMutation={reactionMutation}
              showInlineComment={false}
            />
            <div className="moments-detail-comments-title">
              <Text strong>{t('mobile.moments.comment.title')}</Text>
            </div>
          </>
        )}

        {detailPost && loading && comments.length === 0 && (
          <div className="moments-comments-empty">
            <Text type="secondary">{t('mobile.moments.comment.loading')}</Text>
          </div>
        )}

        {detailPost && !loading && comments.length === 0 && !errorMessage && (
          <div className="moments-comments-empty">
            <MessageCircle size={32} />
            <Text type="secondary">{t('mobile.moments.comment.empty')}</Text>
            <Text type="secondary">{t('mobile.moments.comment.emptyHint')}</Text>
          </div>
        )}

        {detailPost && errorMessage && (
          <div className="moments-comments-error">
            <Text type="danger">{t('mobile.moments.comment.error')}</Text>
            <Button
              size="small"
              onClick={() => void retryMomentDetailRuntime(momentsRuntime)}
            >
              {t('mobile.moments.feed.retry')}
            </Button>
          </div>
        )}

        {detailPost && comments.length > 0 && (
          <BoundedList
            surfaceKey={`moments:comments:${postId}`}
            items={comments}
            itemKey={momentCommentKey}
            size={MOMENT_COMMENTS_WINDOW_SIZE}
          >
            {(windowedComments) => windowedComments.map((comment) => (
              <div key={comment.id} data-scroll-anchor-id={comment.id}>
                <CommentItem
                  comment={comment}
                  onReply={handleReply}
                  onDelete={handleDelete}
                />
              </div>
            ))}
          </BoundedList>
        )}

        {detailPost && hasMore && !loading && (
          <div className="moments-comments-load-more">
            <Button type="text" size="small" onClick={loadMore}>
              {t('mobile.moments.comment.loadMore')}
            </Button>
          </div>
        )}

        {detailPost && loading && comments.length > 0 && (
          <div className="moments-comments-loading-more">
            <Text type="secondary">{t('mobile.moments.feed.loadingMore')}</Text>
          </div>
        )}
      </div>

      {/* Reply indicator */}
      {detailPost && replyTarget && (
        <div className="moments-comments-reply-indicator">
          <Text type="secondary">
            {t('mobile.moments.reply.placeholder', { name: replyAuthorName })}
          </Text>
          <button
            type="button"
            onClick={handleCancelReply}
            aria-label={t('mobile.moments.reply.cancel')}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input */}
      {detailPost && <div className="moments-comments-input">
        <Input
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder={
            replyTarget
              ? t('mobile.moments.reply.placeholder', { name: replyAuthorName })
              : t('mobile.moments.comment.placeholder')
          }
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
        >
          {replyTarget
            ? t('mobile.moments.reply.send')
            : t('mobile.moments.comment.send')
          }
        </Button>
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single comment item
// ---------------------------------------------------------------------------

interface CommentItemProps {
  readonly comment: Comment;
  readonly onReply: (comment: Comment) => void;
  readonly onDelete: (commentId: string) => void;
}

function CommentItem({ comment, onReply, onDelete }: CommentItemProps) {
  const { t } = useMobileI18n();

  const authorName = comment.author?.displayName
    || comment.author?.username
    || t('mobile.moments.time.justNow');

  if (comment.isDeleted) {
    return (
      <div className="moments-comment-item moments-comment-item--deleted">
        <Text type="secondary">{t('mobile.moments.comment.deleted')}</Text>
      </div>
    );
  }

  return (
    <div className="moments-comment-item">
      <MobileAvatar
        src={comment.author?.avatarUrl}
        size={28}
      />
      <div className="moments-comment-item__body">
        <Text strong className="moments-comment-item__author">{authorName}</Text>
        {comment.replyToCommentId && (
          <Text type="secondary" className="moments-comment-item__reply-badge">
            {t('moments.comment.reply')}
          </Text>
        )}
        <Paragraph className="moments-comment-item__content">{comment.content}</Paragraph>
        <div className="moments-comment-item__actions">
          <button type="button" onClick={() => onReply(comment)}>
            {t('moments.comment.reply')}
          </button>
          <button type="button" onClick={() => onDelete(comment.id)}>
            {t('moments.comment.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
