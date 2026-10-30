import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'antd';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { selectMomentComments } from '../../store/moments';
import {
  selectPrivateCommentDraft,
  selectPrivateCommentThread,
} from '../../store/privateComments';
import { CommentList, type MomentCommentItem } from '../../components/moments/CommentList';
import { MomentCard } from '../../components/moments/MomentCard';
import { SocialEmptyState } from '../../components/moments/surfaces/SocialEmptyState';
import {
  SocialThreadDivider,
  SocialThreadSection,
  SocialThreadSurface,
} from '../../components/moments/surfaces';
import {
  useActiveMomentsSlice,
  useActivePrivateCommentsSlice,
} from '../../components/moments/useActiveMomentsStore';
import { isPrivateMomentPost } from '../../runtimes/momentsRuntime';
import type { SocialTextMention } from '../../components/moments/mentions/socialMentionModel';

export interface MomentDetailViewProps {
  postId: string;
  commentId?: string;
  viewerActorPtid?: string;
  onBack: () => void;
  onAuthorClick: (actorPtid: string) => void;
}

// CommentList identity is exactly (thread identity, viewer identity):
// native draft identity and renderer generation are draft data and
// must not remount the editor or interrupt IME composition.
export function MomentDetailView({
  postId,
  commentId,
  viewerActorPtid,
  onBack,
  onAuthorClick,
}: MomentDetailViewProps) {
  const { t } = useTranslation('moments');
  const rootRef = useRef<HTMLDivElement | null>(null);

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
    commentsHasMore: s.commentsHasMore[postId],
    commentsLoading: s.commentsLoading[postId],
    loadComments: s.loadComments,
    createComment: s.createComment,
    deleteComment: s.deleteComment,
    reactToPost: s.reactToPost,
    unreactToPost: s.unreactToPost,
  }));
  const {
    privateThread,
    privateDraft,
    submitPrivateComment,
    privateScope,
    loadPrivateComments,
    retryPrivateComment,
  } = useActivePrivateCommentsSlice((s) => ({
    privateThread: selectPrivateCommentThread(s, postId),
    privateDraft: selectPrivateCommentDraft(s, postId),
    submitPrivateComment: s.submitComment,
    privateScope: s.scope,
    loadPrivateComments: s.loadComments,
    retryPrivateComment: s.retryComment,
  }));

  const [commentsOpen, setCommentsOpen] = useState(true);
  const commentsRegionId = `moments-comments-region-${postId}`;

  const isPrivate = isPrivateMomentPost(post);
  const privateParentUnavailable = privateThread.state === 'COMMENT_PARENT_UNAVAILABLE';

  const privateComments: MomentCommentItem[] = useMemo(() => (
    privateThread.comments.map((comment) => ({
      id: comment.commentId,
      postId: comment.postId,
      authorPtid: comment.authorPtid,
      replyToCommentId: comment.replyToCommentId,
      content: comment.text,
      author: {
        username: comment.authorAcct ?? '',
        displayName: comment.authorAcct ?? '',
        avatarUrl: '',
      },
    }))
  ), [privateThread.comments]);

  const visibleComments = isPrivate ? privateComments : comments;
  const visibleCommentsLoading = isPrivate ? privateThread.loading : commentsLoading;
  const visibleCommentsHasMore = isPrivate ? privateThread.hasMore : commentsHasMore;
  const privateComposerState = privateParentUnavailable
    ? privateThread.state
    : privateDraft?.state;
  const privateComposerErrorCode = privateParentUnavailable
    ? privateThread.errorCode
    : privateDraft?.errorCode;

  useEffect(() => {
    if (!commentId) return;
    const frame = requestAnimationFrame(() => {
      const node = rootRef.current;
      if (!node) return;
      Array.from(node.querySelectorAll<HTMLElement>('[data-moments-comment]'))
        .find((row) => row.dataset.momentsComment === commentId)
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [commentId, visibleComments.length]);

  const openComments = useCallback(() => {
    setCommentsOpen(true);
    requestAnimationFrame(() => {
      document.getElementById(commentsRegionId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  }, [commentsRegionId]);

  const handleSubmit = useCallback(async (
    content: string,
    replyToCommentId?: string,
    mentions?: SocialTextMention[],
  ) => {
    if (isPrivate) {
      await submitPrivateComment(postId, content, replyToCommentId, mentions ?? []);
      return;
    }
    await createComment(postId, content, replyToCommentId, mentions ?? []);
  }, [createComment, isPrivate, postId, submitPrivateComment]);

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
            onAuthorClick={onAuthorClick}
            onOpenComments={openComments}
            onReact={reactToPost}
            onUnreact={unreactToPost}
          />
          <SocialThreadDivider
            label={commentsOpen ? t('moments.comment.hide') : t('moments.comment.viewAll')}
            expanded={commentsOpen}
            controls={commentsRegionId}
            onToggle={() => setCommentsOpen((open) => !open)}
          />
          {commentsOpen && (
            <div id={commentsRegionId} data-moments-comments-region={postId}>
              <SocialThreadSection>
                <CommentList
                  postId={postId}
                  targetCommentId={commentId}
                  comments={visibleComments}
                  loading={visibleCommentsLoading}
                  hasMore={visibleCommentsHasMore}
                  composerState={isPrivate ? privateComposerState : undefined}
                  composerErrorCode={isPrivate ? privateComposerErrorCode : undefined}
                  composerRetryAfterSeconds={privateDraft?.retryAfterSeconds}
                  composerPublicationState={privateDraft?.publicationState}
                  composerDraftText={isPrivate ? privateDraft?.text : undefined}
                  viewerActorPtid={viewerActorPtid ?? privateScope.actorPtid ?? undefined}
                  failureVariant={isPrivate ? 'private' : 'public'}
                  onLoadMore={() => {
                    const pending = isPrivate
                      ? loadPrivateComments(postId)
                      : loadComments(postId);
                    pending.catch(() => {});
                  }}
                  onSubmit={handleSubmit}
                  onRetry={isPrivate
                    ? () => retryPrivateComment(postId)
                    : undefined}
                  onDelete={isPrivate
                    ? undefined
                    : async (cid: string) => {
                      await deleteComment(postId, cid);
                    }}
                />
              </SocialThreadSection>
            </div>
          )}
        </SocialThreadSurface>
      )}
    </div>
  );
}
