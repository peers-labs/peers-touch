import { useTranslation } from 'react-i18next';
import { Button, Card, Empty, Spin, Typography, message, theme } from 'antd';
import { ChevronLeft } from 'lucide-react';
import { useMomentsStore } from '../../store/moments';
import { MomentCard } from '../../components/moments/MomentCard';
import { CommentList } from '../../components/moments/CommentList';
import type { ReactionKind } from '../../gen/proto/domain/social/post_pb';

const { Text } = Typography;

// MomentDetailView — single post + comment thread.
//
// Detail projection is refreshed by `momentsRuntime` before this view
// is shown. This component only renders store state and forwards user
// actions such as comment pagination or submission.

interface MomentDetailViewProps {
  postId: string;
  viewerActorId?: string;
  onBack: () => void;
  onAuthorClick: (actorId: string) => void;
}

export function MomentDetailView({
  postId,
  viewerActorId,
  onBack,
  onAuthorClick,
}: MomentDetailViewProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const post = useMomentsStore((s) => s.postsById[postId]);
  const reactions = useMomentsStore((s) => s.reactions[postId]);
  const comments = useMomentsStore((s) => s.comments[postId] ?? []);
  const commentsHasMore = useMomentsStore((s) => !!s.commentsHasMore[postId]);
  const commentsLoading = useMomentsStore((s) => !!s.commentsLoading[postId]);
  const loadComments = useMomentsStore((s) => s.loadComments);
  const createComment = useMomentsStore((s) => s.createComment);
  const deleteComment = useMomentsStore((s) => s.deleteComment);
  const reactToPost = useMomentsStore((s) => s.reactToPost);
  const unreactToPost = useMomentsStore((s) => s.unreactToPost);

  const handleReact = async (id: string, k: ReactionKind) => {
    await reactToPost(id, k);
  };
  const handleUnreact = async (id: string, k?: ReactionKind) => {
    await unreactToPost(id, k);
  };

  return (
    <div>
      <Button
        type="text"
        icon={<ChevronLeft size={16} />}
        onClick={onBack}
        style={{ marginBottom: 12 }}
      >
        {t('moments.action.back', { defaultValue: 'Back' })}
      </Button>

      {!post && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spin />
        </div>
      )}

      {post && (
        <>
          <MomentCard
            post={post}
            reactions={reactions}
            onAuthorClick={onAuthorClick}
            onReact={handleReact}
            onUnreact={handleUnreact}
          />
          <Card
            size="small"
            bordered
            style={{
              marginTop: 10,
              borderColor: token.colorBorderSecondary,
              boxShadow: 'none',
            }}
            bodyStyle={{ padding: 14 }}
          >
            <CommentList
              postId={postId}
              comments={comments}
              loading={commentsLoading}
              hasMore={commentsHasMore}
              viewerActorId={viewerActorId}
              onLoadMore={() => loadComments(postId).catch(() => {})}
              onSubmit={async (content, replyToCommentId) => {
                try {
                  await createComment(postId, content, replyToCommentId);
                } catch (err) {
                  message.error(String(err));
                  throw err;
                }
              }}
              onDelete={async (cid) => {
                await deleteComment(postId, cid);
              }}
            />
          </Card>
        </>
      )}

      {!post && !commentsLoading && (
        <Empty description={<Text>{t('moments.placeholder.detailEmpty')}</Text>} />
      )}
    </div>
  );
}
