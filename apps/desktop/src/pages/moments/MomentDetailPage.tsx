import { useTranslation } from 'react-i18next';
import { Button, message } from 'antd';
import { ChevronLeft } from 'lucide-react';
import { selectMomentComments, useMomentsStore } from '../../store/moments';
import { MomentCard } from '../../components/moments/MomentCard';
import { CommentList } from '../../components/moments/CommentList';
import {
  SocialEmptyState,
  SocialThreadDivider,
  SocialThreadSection,
  SocialThreadSurface,
} from '../../components/moments/surfaces';
import type { ReactionKind } from '../../gen/proto/domain/social/post_pb';

// MomentDetailView — single post + comment thread.
//
// UI Identity contract:
//   - Detail post, comments, and reply composer must read as one
//     thread surface instead of three stacked cards.
//   - Loading / empty state must be explicit; a missing projection is
//     not rendered as a broken blank card.

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
  const explanation = useMomentsStore((s) => s.feedExplanations[postId]);
  const comments = useMomentsStore((s) => selectMomentComments(s, postId));
  const commentsHasMore = useMomentsStore((s) => !!s.commentsHasMore[postId]);
  const commentsLoading = useMomentsStore((s) => !!s.commentsLoading[postId]);
  const loadComments = useMomentsStore((s) => s.loadComments);
  const createComment = useMomentsStore((s) => s.createComment);
  const deleteComment = useMomentsStore((s) => s.deleteComment);
  const reactToPost = useMomentsStore((s) => s.reactToPost);
  const unreactToPost = useMomentsStore((s) => s.unreactToPost);

  const handleReact = async (id: string, kind: ReactionKind) => {
    await reactToPost(id, kind);
  };

  const handleUnreact = async (id: string, kind?: ReactionKind) => {
    await unreactToPost(id, kind);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Button
        type="text"
        icon={<ChevronLeft size={16} />}
        onClick={onBack}
        style={{ alignSelf: 'flex-start', paddingInline: 0 }}
      >
        {t('moments.action.back')}
      </Button>

      {!post && commentsLoading && <SocialEmptyState kind="loading" />}

      {!post && !commentsLoading && (
        <SocialEmptyState
          kind="empty"
          title={t('moments.placeholder.empty')}
          description={t('moments.placeholder.detailEmpty')}
        />
      )}

      {post && (
        <SocialThreadSurface>
          <MomentCard
            post={post}
            reactions={reactions}
            explanation={explanation}
            viewerActorId={viewerActorId}
            embedded
            onAuthorClick={onAuthorClick}
            onReact={handleReact}
            onUnreact={handleUnreact}
          />
          <SocialThreadDivider label={t('moments.comment.viewAll')} />
          <SocialThreadSection>
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
          </SocialThreadSection>
        </SocialThreadSurface>
      )}
    </div>
  );
}
