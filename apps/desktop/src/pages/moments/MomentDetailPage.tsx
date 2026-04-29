import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Empty, Spin, Typography, message } from 'antd';
import { ChevronLeft } from 'lucide-react';
import { useMomentsStore } from '../../store/moments';
import { MomentCard } from '../../components/moments/MomentCard';
import { CommentList } from '../../components/moments/CommentList';
import type { ReactionKind } from '../../gen/proto/domain/social/post_pb';

const { Text } = Typography;

// MomentDetailView — single post + comment thread.
//
// Loads on mount even if the post is already in `postsById` from
// the feed: detail view shows the FULL reaction list and the comment
// thread, both of which the timeline payload doesn't carry. The
// store dedupes the post by id so the second load is cheap.

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
  const post = useMomentsStore((s) => s.postsById[postId]);
  const reactions = useMomentsStore((s) => s.reactions[postId]);
  const comments = useMomentsStore((s) => s.comments[postId] ?? []);
  const commentsHasMore = useMomentsStore((s) => !!s.commentsHasMore[postId]);
  const commentsLoading = useMomentsStore((s) => !!s.commentsLoading[postId]);
  const loadPost = useMomentsStore((s) => s.loadPost);
  const loadComments = useMomentsStore((s) => s.loadComments);
  const createComment = useMomentsStore((s) => s.createComment);
  const deleteComment = useMomentsStore((s) => s.deleteComment);
  const reactToPost = useMomentsStore((s) => s.reactToPost);
  const unreactToPost = useMomentsStore((s) => s.unreactToPost);

  useEffect(() => {
    loadPost(postId).catch(() => {});
    loadComments(postId, true).catch(() => {});
  }, [postId, loadPost, loadComments]);

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
          <div style={{ marginTop: 16 }}>
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
          </div>
        </>
      )}

      {!post && !commentsLoading && (
        <Empty description={<Text>{t('moments.placeholder.detailEmpty')}</Text>} />
      )}
    </div>
  );
}

