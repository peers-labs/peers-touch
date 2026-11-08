import { useEffect, useMemo, useRef } from 'react';
import { selectMomentComments } from '../../store/moments';
import {
  selectPrivateCommentDraft,
  selectPrivateCommentThread,
} from '../../store/privateComments';
import {
  useActiveMomentsSlice,
  useActivePrivateCommentsSlice,
    useActivePrivateMomentsSlice,
} from './useActiveMomentsStore';
import { ReactionKind } from '../../gen/proto/domain/social/post_pb';
import { CommentList, type MomentCommentItem } from './CommentList';
import type { SocialTextMention } from './mentions/socialMentionModel';
import { acquireMomentComments } from '../../runtimes/momentsRuntime';
import { useIsPageActive } from '../../kernel/PageActivityContext';
import { useSessionStore } from '../../store/session';
import { commentDraftKey } from '../../store/socialCommentDrafts';

// MomentCommentsSection — the full comment thread for one post, inline in the
// MomentCard and on the detail surface. Public comments go through the social
// BFF store; private comments go through the Secure Content store. The
// Painted threads bind their lifetime to the original Runtime. The component
// only renders, focuses a target and dispatches user pagination/write actions.
export interface MomentCommentsSectionProps {
  postId: string;
  isPrivate: boolean;
  viewerActorPtid?: string;
  /** Deep-linked comment that should be focused once loaded. */
  targetCommentId?: string;
  onAuthorClick?: (actorPtid: string) => void;
}

export function MomentCommentsSection({
  postId,
  isPrivate,
  viewerActorPtid,
  targetCommentId,
  onAuthorClick,
}: MomentCommentsSectionProps) {
  const active = useIsPageActive();
  const rootRef = useRef<HTMLDivElement>(null);
  const sessionActor = useSessionStore(state => state.currentUser?.actorPtid);
  const sessionEpoch = useSessionStore(state => state.sessionEpoch);
  const {
    comments,
    commentsHasMore,
    commentsLoading,
    loadComments,
    createComment,
    deleteComment,
    setCommentLike,
    commentReactionCommands,
  } = useActiveMomentsSlice((s) => ({
    comments: selectMomentComments(s, postId),
    commentsHasMore: s.commentsHasMore[postId],
    commentsLoading: s.commentsLoading[postId],
    loadComments: s.loadComments,
    createComment: s.createComment,
    deleteComment: s.deleteComment,
    setCommentLike: s.setCommentLike,
    commentReactionCommands: s.commentReactionCommands,
  }));
  const {
    privateThread,
    privateDraft,
    submitPrivateComment,
    privateScope,
    loadPrivateComments,
    retryPrivateComment,
    setPrivateCommentLike,
  } = useActivePrivateCommentsSlice((s) => ({
    privateThread: selectPrivateCommentThread(s, postId),
    privateDraft: selectPrivateCommentDraft(s, postId),
    submitPrivateComment: s.submitComment,
    privateScope: s.scope,
    loadPrivateComments: s.loadComments,
    retryPrivateComment: s.retryComment,
    setPrivateCommentLike: s.setCommentLike,
  }));
  const privateReactionCommands = useActivePrivateMomentsSlice(state => state.reactionCommands);

  useEffect(() => {
    if (!active || !rootRef.current) return;
    let release: (() => void) | undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) release ??= acquireMomentComments(postId);
      else { release?.(); release = undefined; }
    });
    observer.observe(rootRef.current);
    return () => { observer.disconnect(); release?.(); };
  }, [active, postId]);

  const privateComments: MomentCommentItem[] = useMemo(() => (
    privateThread.comments.map((comment) => ({
      id: comment.commentId,
      postId: comment.postId,
      authorPtid: comment.authorPtid,
      replyToCommentId: comment.replyToCommentId,
      content: comment.text,
      likesCount: comment.reactions.find(summary => summary.kind === ReactionKind.REACTION_LIKE)?.count ?? 0n,
      isLiked: comment.isLiked,
      createdAtMillis: comment.createdAtMillis,
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
    <div ref={rootRef} data-moment-thread-interest={postId}><CommentList
      key={commentDraftKey(viewerActorPtid ?? sessionActor, sessionEpoch, postId)}
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
      onAuthorClick={onAuthorClick}
      onRetry={isPrivate ? () => retryPrivateComment(postId) : undefined}
      onLike={(commentId, liked) => isPrivate
        ? setPrivateCommentLike(postId, commentId, liked)
        : setCommentLike(postId, commentId, liked)}
      reactionCommands={isPrivate ? Object.fromEntries(
        Object.values(privateReactionCommands).filter(command => command.postId === postId && command.commentId)
          .map(command => [command.commentId, {
            pending: command.state === 'REACTION_PENDING' || command.state === 'REACTION_RETRYING',
            error: command.errorCode,
            retry: command.commandId && command.state !== 'REACTION_REJECTED'
              ? () => setPrivateCommentLike(postId, command.commentId, command.operation === 'REACT')
              : undefined,
          }]),
      ) : commentReactionCommands}
      onDelete={isPrivate ? undefined : async (commentId: string) => {
        await deleteComment(postId, commentId);
      }}
    /></div>
  );
}
