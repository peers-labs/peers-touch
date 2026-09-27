import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { Input, Space, Spin, Typography, message, theme } from 'antd';
import { Trash2 } from 'lucide-react';
import type {
  PrivateCommentPublicationState,
  PrivateCommentState,
} from '../../services/privateCommentsNative';
import { useIsPageActive } from '../../kernel/PageActivityContext';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { resolvePrivateCommentComposerAction } from './privateCommentComposerState';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

// CommentList — paginated thread for a single post.
//
// The component owns:
//   - The composer text + submit handling (kept here, not in store,
//     because it's intrinsically per-mount UI state).
//   - The "Load more" button which calls back into the store.
//
// Reply nesting: the proto allows `reply_to_comment_id` so we
// could render a tree, but the UX choice for P2 is FLAT with a
// "Replying to @username" inline indicator (matches Twitter /
// Mastodon — easier to scan a long thread than nested branches).
//
// Pagination: cursor + has_more come from the store; the component
// just renders the "Load more" button when applicable.

export interface MomentCommentItem {
  id: string;
  postId: string;
  authorPtid: string;
  content: string;
  replyToCommentId: string;
  author?: {
    username: string;
    displayName: string;
    avatarUrl: string;
  };
}

interface CommentListProps {
  postId: string;
  comments: MomentCommentItem[];
  loading?: boolean;
  hasMore?: boolean;
  composerState?: PrivateCommentState;
  composerErrorCode?: string;
  composerRetryAfterSeconds?: number;
  composerRetryNotBeforeUnixMs?: number;
  composerPublicationState?: PrivateCommentPublicationState;
  composerDraftText?: string;
  /** id of the viewer used to gate the delete button. */
  viewerActorPtid?: string;
  onLoadMore: () => void;
  onSubmit: (content: string, replyToCommentId?: string) => Promise<void>;
  onRetry?: () => Promise<void>;
  onDelete?: (commentId: string) => Promise<void>;
}

export function CommentList({
  postId,
  comments,
  loading,
  hasMore,
  composerState,
  composerErrorCode,
  composerRetryAfterSeconds,
  composerRetryNotBeforeUnixMs,
  composerPublicationState,
  composerDraftText,
  viewerActorPtid,
  onLoadMore,
  onSubmit,
  onRetry,
  onDelete,
}: CommentListProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const pageActive = useIsPageActive();
  const [text, setText] = useState(composerDraftText ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<MomentCommentItem | null>(null);
  const [nowUnixMs, setNowUnixMs] = useState(() => Date.now());
  const submitInFlightRef = useRef(false);
  const retryDeadlineTracked = composerState === 'COMMENT_RATE_LIMITED'
    || composerPublicationState === 'COMMITTED_PENDING_READBACK';

  useEffect(() => {
    if (composerPublicationState === 'COMMITTED_PENDING_READBACK') {
      setText('');
      setReplyTarget(null);
    }
  }, [composerPublicationState]);

  useEffect(() => {
    if (
      !pageActive
      || !retryDeadlineTracked
    ) {
      return;
    }
    setNowUnixMs(Date.now());
    if (
      !composerRetryNotBeforeUnixMs
      || composerRetryNotBeforeUnixMs <= Date.now()
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      const now = Date.now();
      setNowUnixMs(now);
      if (now >= composerRetryNotBeforeUnixMs) {
        window.clearInterval(timer);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [composerRetryNotBeforeUnixMs, pageActive, retryDeadlineTracked]);

  const retrySecondsRemaining = composerRetryNotBeforeUnixMs
    ? Math.max(0, Math.ceil((composerRetryNotBeforeUnixMs - nowUnixMs) / 1_000))
    : undefined;
  const retryDeadlinePending = composerState === 'COMMENT_RATE_LIMITED'
    ? !composerRetryNotBeforeUnixMs || (retrySecondsRemaining ?? 0) > 0
    : composerPublicationState === 'COMMITTED_PENDING_READBACK'
      && !!composerRetryNotBeforeUnixMs
      && (retrySecondsRemaining ?? 0) > 0;
  const composerAction = resolvePrivateCommentComposerAction({
    state: composerState,
    publicationState: composerPublicationState,
    retryDeadlinePending,
    text,
    draftText: composerDraftText,
  });
  const committedPendingReadback = composerAction === 'reconcile';
  const recoveryAction = composerAction !== 'submit' && !!onRetry;
  const parentUnavailable = composerState === 'COMMENT_PARENT_UNAVAILABLE';
  const nativePending = composerState === 'COMMENT_ENCRYPTING'
    || composerState === 'COMMENT_SUBMITTING';

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (
      submitInFlightRef.current
      || submitting
      || nativePending
      || (!trimmed && !committedPendingReadback)
      || parentUnavailable
      || retryDeadlinePending
      || (committedPendingReadback && !onRetry)
    ) {
      return;
    }
    submitInFlightRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (recoveryAction && onRetry) {
        await onRetry();
      } else {
        await onSubmit(trimmed, replyTarget?.id);
      }
      setText('');
      setReplyTarget(null);
    } catch (err) {
      setSubmitError(String(err));
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div
      data-moments-comment-thread={postId}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {comments.length === 0 && !loading && (
        <div style={{ padding: '8px 0' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('moments.comment.empty')}
          </Text>
        </div>
      )}

      {comments.map((c) => {
        const isMine = !!viewerActorPtid && c.authorPtid === viewerActorPtid;
        const authorName = c.author?.displayName || c.author?.username || t('moments.author.unknown');
        return (
          <div key={c.id} style={{ display: 'flex', gap: 10, padding: '2px 0' }}>
            <UserSquareAvatar
              remoteUrl={c.author?.avatarUrl || undefined}
              name={authorName}
              size={26}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Space size={6} align="baseline">
                <Text strong style={{ fontSize: 13 }}>
                  {authorName}
                </Text>
                {c.replyToCommentId && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('moments.comment.replyingTo')}
                  </Text>
                )}
              </Space>
              <Paragraph
                style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}
              >
                {c.content}
              </Paragraph>
              <Space size={8} style={{ marginTop: 2 }}>
                <Button
                  size="small"
                  type="link"
                  style={{ padding: 0, fontSize: 12 }}
                  disabled={!!deletingCommentId}
                  onClick={() => setReplyTarget(c)}
                >
                  {t('moments.comment.reply')}
                </Button>
                {isMine && onDelete && (
                  <Button
                    size="small"
                    type="link"
                    danger
                    style={{ padding: 0, fontSize: 12 }}
                    icon={<Trash2 size={11} />}
                    loading={deletingCommentId === c.id}
                    disabled={!!deletingCommentId}
                    onClick={async () => {
                      if (deletingCommentId) return;
                      setDeletingCommentId(c.id);
                      try {
                        await onDelete(c.id);
                      } catch (err) {
                        message.error(String(err));
                      } finally {
                        setDeletingCommentId(null);
                      }
                    }}
                  >
                    {t('moments.comment.delete')}
                  </Button>
                )}
              </Space>
            </div>
          </div>
        );
      })}

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
          <Spin size="small" />
        </div>
      )}

      {hasMore && !loading && (
        <Button block type="text" size="small" onClick={onLoadMore}>
          {t('moments.action.loadMore')}
        </Button>
      )}

      <div
        data-moments-comment-composer-state={composerState}
        data-moments-comment-error-code={composerErrorCode}
        data-moments-comment-retry-after-seconds={composerRetryAfterSeconds}
        data-moments-comment-retry-not-before-unix-ms={composerRetryNotBeforeUnixMs}
        data-moments-comment-publication-state={composerPublicationState}
        style={{
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          paddingTop: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {replyTarget && (
          <Space size={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('moments.comment.replyingTo')}{' '}
              <Text strong style={{ fontSize: 12 }}>
                {replyTarget.author?.displayName ||
                  replyTarget.author?.username ||
                  t('moments.author.unknown')}
              </Text>
            </Text>
            <Button
              size="small"
              type="link"
              style={{ padding: 0, fontSize: 12 }}
              onClick={() => setReplyTarget(null)}
            >
              {t('moments.action.cancel')}
            </Button>
          </Space>
        )}
        {(submitError || composerErrorCode)
          && composerState !== 'COMMENT_POSTED'
          && !committedPendingReadback && (
          <Text type="danger" style={{ fontSize: 12 }}>
            {parentUnavailable
              ? t('moments.private.state.NOT_FOUND_OR_NOT_AUTHORIZED.description')
              : t('moments.private.state.PUBLISH_FAILED.description')}
          </Text>
        )}
        {committedPendingReadback && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('moments.comment.readbackPending')}
          </Text>
        )}
        {retryDeadlineTracked && composerRetryNotBeforeUnixMs && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('moments.comment.retryIn', { count: retrySecondsRemaining ?? 0 })}
          </Text>
        )}
        {composerState === 'COMMENT_RATE_LIMITED' && !composerRetryNotBeforeUnixMs && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('moments.comment.rateLimited')}
          </Text>
        )}
        <TextArea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSubmitError(null);
          }}
          placeholder={t('moments.comment.placeholder')}
          disabled={parentUnavailable || committedPendingReadback}
          autoSize={{ minRows: 1, maxRows: 4 }}
          style={{ borderRadius: token.borderRadius }}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            size="small"
            onClick={handleSubmit}
            loading={submitting || nativePending}
            disabled={
              submitting
              || nativePending
              || parentUnavailable
              || retryDeadlinePending
              || (committedPendingReadback ? !onRetry : !text.trim())
            }
          >
            {composerAction === 'reconcile'
              ? t('moments.comment.confirmResult')
              : composerAction === 'retry'
                ? t('moments.private.action.retry')
                : t('moments.comment.publish')}
          </Button>
        </div>
      </div>
    </div>
  );
}
