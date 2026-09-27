import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import { ChevronLeft } from 'lucide-react';
import { selectMomentComments } from '../../store/moments';
import {
  selectPrivateCommentDraft,
  selectPrivateCommentThread,
} from '../../store/privateComments';
import { MomentCard } from '../../components/moments/MomentCard';
import { CommentList } from '../../components/moments/CommentList';
import {
  useActiveMomentsSlice,
  useActivePrivateCommentsSlice,
} from '../../components/moments/useActiveMomentsStore';
import { isPrivateMomentPost } from '../../runtimes/momentsRuntime';
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
  const {
    privateThread,
    privateDraft,
    privateScope,
    loadPrivateComments,
    submitPrivateComment,
    retryPrivateComment,
  } = useActivePrivateCommentsSlice((s) => ({
    privateThread: selectPrivateCommentThread(s, postId),
    privateDraft: selectPrivateCommentDraft(s, postId),
    privateScope: s.scope,
    loadPrivateComments: s.loadComments,
    submitPrivateComment: s.submitComment,
    retryPrivateComment: s.retryComment,
  }));
  const privateComments = useMemo(() => (
    privateThread.comments.map((comment) => ({
      id: comment.commentId,
      postId: comment.postId,
      authorPtid: comment.authorPtid,
      content: comment.text,
      replyToCommentId: comment.replyToCommentId,
      author: {
        username: comment.authorAcct ?? '',
        displayName: comment.authorAcct ?? '',
        avatarUrl: '',
      },
    }))
  ), [privateThread.comments]);
  const isPrivate = isPrivateMomentPost(post);
  const visibleComments = isPrivate ? privateComments : comments;
  const visibleCommentsLoading = isPrivate ? privateThread.loading : commentsLoading;
  const visibleCommentsHasMore = isPrivate ? privateThread.hasMore : commentsHasMore;
  const privateParentUnavailable = privateThread.state === 'COMMENT_PARENT_UNAVAILABLE';
  const privateComposerState = privateParentUnavailable
    ? privateThread.state
    : privateDraft?.state ?? privateThread.state;
  const privateComposerErrorCode = privateParentUnavailable
    ? privateThread.errorCode
    : privateDraft?.errorCode ?? privateThread.errorCode;

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
                key={[
                  postId,
                  viewerActorPtid ?? 'anonymous',
                  privateScope.rendererGeneration,
                  privateDraft?.draftId ?? 'public',
                  privateDraft?.draftRevision ?? 0,
                ].join(':')}
                postId={postId}
                comments={visibleComments}
                loading={visibleCommentsLoading}
                hasMore={visibleCommentsHasMore}
                composerState={isPrivate ? privateComposerState : undefined}
                composerErrorCode={
                  isPrivate ? privateComposerErrorCode : undefined
                }
                composerRetryAfterSeconds={
                  isPrivate ? privateDraft?.retryAfterSeconds : undefined
                }
                composerRetryNotBeforeUnixMs={
                  isPrivate ? privateDraft?.retryNotBeforeUnixMs : undefined
                }
                composerPublicationState={
                  isPrivate ? privateDraft?.publicationState : undefined
                }
                composerDraftText={isPrivate ? privateDraft?.text : undefined}
                viewerActorPtid={viewerActorPtid}
                onLoadMore={() => {
                  const pending = isPrivate
                    ? loadPrivateComments(postId)
                    : loadComments(postId);
                  pending.catch(() => {});
                }}
                onSubmit={async (content, replyToCommentId) => {
                  if (isPrivate) {
                    await submitPrivateComment(postId, content, replyToCommentId);
                    return;
                  }
                  await createComment(postId, content, replyToCommentId);
                }}
                onRetry={isPrivate
                  ? () => retryPrivateComment(postId)
                  : undefined}
                onDelete={isPrivate
                  ? undefined
                  : async (cid) => {
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
