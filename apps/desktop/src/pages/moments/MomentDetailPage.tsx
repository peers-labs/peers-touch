import { useCallback } from 'react';
import { Button } from '@peers-touch/ui';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MomentCard } from '../../components/moments/MomentCard';
import { SocialEmptyState } from '../../components/moments/surfaces/SocialEmptyState';
import { useActiveMomentsSlice } from '../../components/moments/useActiveMomentsStore';
import { momentResourceKey } from '../../store/momentsTimeline';

export interface MomentDetailViewProps {
  postId: string;
  commentId?: string;
  viewerActorPtid?: string;
  onBack: () => void;
  onAuthorClick: (actorPtid: string) => void;
}

// Detail surface: the post card owns its inline comment thread
// (MomentCommentsSection); this view only provides
// navigation, and post-level actions.
export function MomentDetailView({
  postId,
  commentId,
  viewerActorPtid,
  onBack,
  onAuthorClick,
}: MomentDetailViewProps) {
  const { t } = useTranslation('moments');

  const {
    post,
    reactions,
    explanation,
    reactToPost,
    unreactToPost,
    deletePost,
  } = useActiveMomentsSlice((s) => ({
    post: s.postsById[postId],
    reactions: s.reactions[postId],
    explanation: s.feedExplanations[postId],
    reactToPost: s.reactToPost,
    unreactToPost: s.unreactToPost,
    deletePost: s.deletePost,
  }));

  const handleDeletePost = useCallback(async (id: string) => {
    await deletePost(id);
    onBack();
  }, [deletePost, onBack]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Button
          actionId="moments.detail.back"
          emphasis="quiet"
          leading={<ChevronLeft size={16} />}
          onActivate={onBack}
        >
          {t('moments.action.back')}
        </Button>
      </div>
      {!post && (
        <SocialEmptyState
          kind="empty"
          title={t('moments.placeholder.empty')}
          description={t('moments.placeholder.detailEmpty')}
        />
      )}
      {post && (
        <MomentCard
          key={momentResourceKey(post)}
          post={post}
          reactions={reactions}
          explanation={explanation}
          viewerActorPtid={viewerActorPtid}
          defaultCommentsOpen
          targetCommentId={commentId}
          onAuthorClick={onAuthorClick}
          onReact={reactToPost}
          onUnreact={unreactToPost}
          onDelete={handleDeletePost}
        />
      )}
    </div>
  );
}
