import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Input, Space, Spin, Typography, message, theme } from 'antd';
import { Trash2 } from 'lucide-react';
import type { Comment } from '../../gen/proto/domain/social/comment_pb';

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

interface CommentListProps {
  postId: string;
  comments: Comment[];
  loading?: boolean;
  hasMore?: boolean;
  /** id of the viewer used to gate the delete button. */
  viewerActorId?: string;
  onLoadMore: () => void;
  onSubmit: (content: string, replyToCommentId?: string) => Promise<void>;
  onDelete?: (commentId: string) => Promise<void>;
}

export function CommentList({
  postId: _postId,
  comments,
  loading,
  hasMore,
  viewerActorId,
  onLoadMore,
  onSubmit,
  onDelete,
}: CommentListProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Comment | null>(null);

  // Reset the composer if the active post changes underfoot.
  useEffect(() => {
    setText('');
    setReplyTarget(null);
  }, [_postId]);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, replyTarget?.id);
      setText('');
      setReplyTarget(null);
    } catch (err) {
      message.error(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {comments.length === 0 && !loading && (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('moments.comment.empty')}
        </Text>
      )}

      {comments.map((c) => {
        const isMine = !!viewerActorId && c.authorId === viewerActorId;
        return (
          <div key={c.id} style={{ display: 'flex', gap: 10 }}>
            <Avatar size={28} src={c.author?.avatarUrl || undefined}>
              {(c.author?.displayName || c.author?.username || '?').slice(0, 1)}
            </Avatar>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Space size={6} align="baseline">
                <Text strong style={{ fontSize: 13 }}>
                  {c.author?.displayName || c.author?.username || t('moments.author.unknown')}
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
                    onClick={async () => {
                      try {
                        await onDelete(c.id);
                      } catch (err) {
                        message.error(String(err));
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
        <Button block type="link" onClick={onLoadMore}>
          {t('moments.action.loadMore')}
        </Button>
      )}

      <div
        style={{
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          paddingTop: 12,
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
        <TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('moments.comment.placeholder')}
          autoSize={{ minRows: 1, maxRows: 4 }}
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
            loading={submitting}
            disabled={!text.trim()}
          >
            {t('moments.comment.publish')}
          </Button>
        </div>
      </div>
    </div>
  );
}
