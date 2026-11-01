import { useCallback } from 'react';
import { Button } from 'antd';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MomentCard } from '../../components/moments/MomentCard';
import { SocialEmptyState } from '../../components/moments/surfaces/SocialEmptyState';
import {
  SocialThreadSurface,
} from '../../components/moments/surfaces';
import { useActiveMomentsSlice } from '../../components/moments/useActiveMomentsStore';

export interface MomentDetailViewProps {
  postId: string;
  commentId?: string;
  viewerActorPtid?: string;
  onBack: () => void;
  onAuthorClick: (actorPtid: string) => void;
}

// Detail surface: the post card owns its inline comment thread
// (MomentCommentsSection); this view only provides the thread frame,
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
      {!post && (
        <SocialEmptyState
          kind="empty"
          title={t('moments.placeholder.empty')}
          description={t('moments.placeholder.detailEmpty')}
        />
      )}
      {post && (
        <SocialThreadSurface>
          {/* Back belongs to the thread card header, not a detached row. */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Button
              type="text"
              icon={<ChevronLeft size={16} />}
              onClick={onBack}
              style={{ paddingInline: 4 }}
            >
              {t('moments.action.back')}
            </Button>
          </div>

          <MomentCard
            post={post}
            reactions={reactions}
            explanation={explanation}
            viewerActorPtid={viewerActorPtid}
            embedded
            defaultCommentsOpen
            targetCommentId={commentId}
            onAuthorClick={onAuthorClick}
            onReact={reactToPost}
            onUnreact={unreactToPost}
            onDelete={handleDeletePost}
          />
        </SocialThreadSurface>
      )}
    </div>
  );
}
