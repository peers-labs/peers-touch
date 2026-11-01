import { useEffect, useMemo, useRef } from 'react';
import { selectMomentComments } from '../../store/moments';
import {
  selectPrivateCommentDraft,
  selectPrivateCommentThread,
} from '../../store/privateComments';
import {
  useActiveMomentsSlice,
  useActivePrivateCommentsSlice,
} from './useActiveMomentsStore';
import { CommentList, type MomentCommentItem } from './CommentList';
import type { SocialTextMention } from './mentions/socialMentionModel';

// MomentCommentsSection — the full comment thread for one post, inline in the
// MomentCard and on the detail surface. Public comments go through the social
// BFF store; private comments go through the Secure Content store. The
// component is mounted lazily (expanded cards only), and its first mount
// triggers the initial page load.
export interface MomentCommentsSectionProps {
  postId: string;
  isPrivate: boolean;
  viewerActorPtid?: string;
  /** Deep-linked comment that should be focused once loaded. */
  targetCommentId?: string;
}

export function MomentCommentsSection({
  postId,
  isPrivate,
  viewerActorPtid,
  targetCommentId,
}: MomentCommentsSectionProps) {
  const {
    comments,
    commentsHasMore,
    commentsLoading,
    loadComments,
    createComment,
    deleteComment,
  } = useActiveMomentsSlice((s) => ({
    comments: selectMomentComments(s, postId),
    commentsHasMore: s.commentsHasMore[postId],
    commentsLoading: s.commentsLoading[postId],
    loadComments: s.loadComments,
    createComment: s.createComment,
    deleteComment: s.deleteComment,
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

  const initialLoadedRef = useRef(false);
  useEffect(() => {
    if (initialLoadedRef.current) return;
    initialLoadedRef.current = true;
    const pending = isPrivate
      ? loadPrivateComments(postId)
      : loadComments(postId);
    pending.catch(() => {});
    // Lazy first load runs exactly once per (lazy) mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const privateParentUnavailable = privateThread.state === 'COMMENT_PARENT_UNAVAILABLE';
  const privateComposerState = privateParentUnavailable
    ? privateThread.state
    : privateDraft?.state;
  const privateComposerErrorCode = privateParentUnavailable
    ? privateThread.errorCode
    : privateDraft?.errorCode;

  useEffect(() => {
    if (!targetCommentId) return;
    const frame = requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(
        `[data-moments-comment="${targetCommentId}"]`,
      );
      node?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [targetCommentId, visibleComments.length]);

  const handleSubmit = async (
    content: string,
    replyToCommentId?: string,
    mentions?: SocialTextMention[],
  ) => {
    if (isPrivate) {
      await submitPrivateComment(postId, content, replyToCommentId, mentions ?? []);
      return;
    }
    await createComment(postId, content, replyToCommentId, mentions ?? []);
  };

  return (
    <CommentList
      postId={postId}
      targetCommentId={targetCommentId}
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
      onRetry={isPrivate ? () => retryPrivateComment(postId) : undefined}
      onDelete={isPrivate ? undefined : async (commentId: string) => {
        await deleteComment(postId, commentId);
      }}
    />
  );
}
