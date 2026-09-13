import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, message } from 'antd';
import { ChevronLeft } from 'lucide-react';
import { selectMomentComments } from '../../store/moments';
import { MomentCard } from '../../components/moments/MomentCard';
import { CommentList } from '../../components/moments/CommentList';
import { useActiveMomentsSlice } from '../../components/moments/useActiveMomentsStore';
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
  viewerActorPtid?: string;
  onBack: () => void;
  onAuthorClick: (actorPtid: string) => void;
}

export function MomentDetailView({
  postId,
  viewerActorPtid,
  onBack,
  onAuthorClick,
}: MomentDetailViewProps) {
  const { t } = useTranslation('moments');
  const commentsRegionId = useId();
  const [commentsOpen, setCommentsOpen] = useState(true);
  const {
    post,
    reactions,
    explanation,
    comments,
    commentsHasMore,
    commentsLoading,
    loadComments,
    createComment,
    deleteComment,
    reactToPost,
    unreactToPost,
  } = useActiveMomentsSlice((s) => ({
    post: s.postsById[postId],
    reactions: s.reactions[postId],
    explanation: s.feedExplanations[postId],
    comments: selectMomentComments(s, postId),
    commentsHasMore: !!s.commentsHasMore[postId],
    commentsLoading: !!s.commentsLoading[postId],
    loadComments: s.loadComments,
    createComment: s.createComment,
    deleteComment: s.deleteComment,
    reactToPost: s.reactToPost,
    unreactToPost: s.unreactToPost,
  }));

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
            viewerActorPtid={viewerActorPtid}
            embedded
            onAuthorClick={onAuthorClick}
            onReact={handleReact}
            onUnreact={handleUnreact}
          />
          <SocialThreadDivider
            label={t(
              commentsOpen
                ? 'moments.comment.hide'
                : 'moments.comment.viewAll',
            )}
            expanded={commentsOpen}
            controls={commentsRegionId}
            onToggle={() => setCommentsOpen((open) => !open)}
          />
          <div
            id={commentsRegionId}
            data-moments-comments-region
            hidden={!commentsOpen}
          >
            <SocialThreadSection>
              <CommentList
                postId={postId}
                comments={comments}
                loading={commentsLoading}
                hasMore={commentsHasMore}
                viewerActorPtid={viewerActorPtid}
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
          </div>
        </SocialThreadSurface>
      )}
    </div>
  );
}
