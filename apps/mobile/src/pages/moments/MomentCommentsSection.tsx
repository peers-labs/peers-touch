/**
 * MomentCommentsSection.tsx — Comments panel for a moment post
 *
 * Renders a cursor-paginated comment list with reply support.
 * Comment creation and reply dispatch through InteractionAdmission
 * for ledger tracking, then call the gateway for server-side commit.
 *
 * W6B: Initial implementation with comment, reply, and delete flows.
 */

import { useCallback, useState } from 'react';
import { Button, Input, Typography, message } from 'antd';
import { ArrowLeft, MessageCircle, Send, X } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { MobileAvatar } from '../../components/MobileAvatar';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';
import type { MomentsGateway } from '../../services/gateways/momentsGateway';
import { getInteractionAdmission } from '../../runtimes/commandRuntime';
import { useMomentsComments } from '../../features/social/useMomentsFeed';

const { Text, Paragraph } = Typography;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MomentCommentsSectionProps {
  readonly postId: string;
  readonly gateway: MomentsGateway;
  readonly onClose: () => void;
}

export function MomentCommentsSection({
  postId,
  gateway,
  onClose,
}: MomentCommentsSectionProps) {
  const { t } = useMobileI18n();
  const {
    comments,
    loading,
    hasMore,
    errorMessage,
    loadComments,
    loadMore,
  } = useMomentsComments(gateway, postId);

  const [commentText, setCommentText] = useState('');
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);

  const handleSendComment = useCallback(async () => {
    const trimmed = commentText.trim();
    if (!trimmed || sending) return;

    setSending(true);

    // Record in command ledger for tracking
    try {
      const admission = getInteractionAdmission();
      await admission.admit({
        commandType: replyTarget ? 'comment_reply' : 'comment_create',
        category: 'moments',
        orderingKey: `post:${postId}`,
        payloadJson: JSON.stringify({
          postId,
          content: trimmed,
          replyToCommentId: replyTarget?.id,
        }),
      });
    } catch {
      // Ledger recording is best-effort; proceed with gateway call
    }

    const result = await gateway.createComment(
      postId,
      trimmed,
      replyTarget?.id,
    );

    setSending(false);

    if (result.ok) {
      setCommentText('');
      setReplyTarget(null);
      // Reload comments to get server-confirmed state
      loadComments();
    } else {
      message.error(t('mobile.moments.comment.sendError'));
    }
  }, [commentText, sending, postId, replyTarget, gateway, loadComments, t]);

  const handleReply = useCallback((comment: Comment) => {
    setReplyTarget(comment);
  }, []);

  const handleCancelReply = useCallback(() => {
    setReplyTarget(null);
  }, []);

  const handleDelete = useCallback(async (commentId: string) => {
    const result = await gateway.deleteComment(commentId);
    if (result.ok) {
      message.success(t('mobile.moments.comment.deleted'));
      loadComments();
    }
  }, [gateway, loadComments, t]);

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
        <Text strong>{t('mobile.moments.comment.title')}</Text>
        <div style={{ width: 32 }} /> {/* Spacer for centering */}
      </div>

      {/* Comment list */}
      <div className="moments-comments-list">
        {loading && comments.length === 0 && (
          <div className="moments-comments-empty">
            <Text type="secondary">{t('mobile.moments.comment.loading')}</Text>
          </div>
        )}

        {!loading && comments.length === 0 && !errorMessage && (
          <div className="moments-comments-empty">
            <MessageCircle size={32} />
            <Text type="secondary">{t('mobile.moments.comment.empty')}</Text>
            <Text type="secondary">{t('mobile.moments.comment.emptyHint')}</Text>
          </div>
        )}

        {errorMessage && (
          <div className="moments-comments-error">
            <Text type="danger">{t('mobile.moments.comment.error')}</Text>
            <Button size="small" onClick={loadComments}>
              {t('mobile.moments.feed.retry')}
            </Button>
          </div>
        )}

        {comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            onReply={handleReply}
            onDelete={handleDelete}
          />
        ))}

        {hasMore && !loading && (
          <div className="moments-comments-load-more">
            <Button type="text" size="small" onClick={loadMore}>
              {t('mobile.moments.comment.loadMore')}
            </Button>
          </div>
        )}

        {loading && comments.length > 0 && (
          <div className="moments-comments-loading-more">
            <Text type="secondary">{t('mobile.moments.feed.loadingMore')}</Text>
          </div>
        )}
      </div>

      {/* Reply indicator */}
      {replyTarget && (
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
      <div className="moments-comments-input">
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
      </div>
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
