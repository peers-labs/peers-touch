import {
  useMemo,
  useRef,
  useState,
} from 'react';
import { useScopedFeedback } from '../../hooks/useAppFeedback';
import { Button, Dialog, IconButton, MomentCommentComposer, MomentCommentRow as PeerCommentRow, Spin, TextArea } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';
import type { PrivateCommentPublicationState, PrivateCommentState } from '../../services/privateCommentsNative';
import { publicFeedErrorKey } from '../../services/publicFeedNative';
import { useSessionStore } from '../../store/session';
import {
  commentDraftKey,
  useSocialCommentDraftsStore,
} from '../../store/socialCommentDrafts';
import {
  commitMention,
  findMentionTrigger,
  normalizeMentions,
  type MentionTrigger,
  type SocialMentionCandidate,
  type SocialTextMention,
} from './mentions/socialMentionModel';
import { useSocialMentionCandidates } from './mentions/useSocialMentionCandidates';
import { SocialMentionPopover } from './mentions/SocialMentionPopover';
import { resolvePrivateCommentComposerAction } from './privateCommentComposerState';
import { MomentCommentAuthorName } from './MomentCommentAuthorName';
import { MomentAuthorTrigger } from './MomentAuthorTrigger';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { useActorIdentity } from '../common/useActorIdentity';

// CommentList — thread for a single post.
//
// Editor state (text + committed @-mentions) lives in the
// actor/session/post-scoped social comment draft store, not the
// component key: projection refreshes and native draft revisions must
// never remount the textarea or interrupt IME composition.
//
// Keyboard contract:
//   - IME composition Enter selects the IME candidate, never submits;
//   - Enter with the mention popover open selects the highlighted actor;
//   - plain Enter submits text+mentions+reply;
//   - Shift+Enter inserts a newline.

export interface MomentCommentItem {
  id: string;
  postId: string;
  authorPtid: string;
  replyToCommentId: string;
  content: string;
  likesCount?: bigint | number;
  isLiked?: boolean;
  createdAt?: { seconds: bigint };
  createdAtMillis?: number;
  author?: {
    username: string;
    displayName: string;
    avatarUrl: string;
  };
}

interface CommentListProps {
  postId: string;
  targetCommentId?: string;
  comments: MomentCommentItem[];
  loading?: boolean;
  hasMore?: boolean;
  composerState?: PrivateCommentState;
  composerErrorCode?: string;
  composerRetryAfterSeconds?: number;
  composerPublicationState?: PrivateCommentPublicationState;
  composerDraftText?: string;
  viewerActorPtid?: string;
  /** 'public' selects the public failure copy; the default private
   * copy is kept for the Secure Content path. */
  failureVariant?: 'public' | 'private';
  onLoadMore: () => void;
  onSubmit: (
    content: string,
    replyToCommentId?: string,
    mentions?: SocialTextMention[],
  ) => Promise<void>;
  onRetry?: () => Promise<void>;
  onDelete?: (commentId: string) => Promise<void>;
  onLike?: (commentId: string, liked: boolean) => Promise<void>;
  reactionCommands?: Record<string, { pending: boolean; error?: string; retry?: () => Promise<void> }>;
  onAuthorClick?: (actorPtid: string) => void;
}

type ComposerAction = 'submit' | 'retry' | 'reconcile';

function rootComment(comment: MomentCommentItem, byId: ReadonlyMap<string, MomentCommentItem>): MomentCommentItem {
  let current = comment;
  const seen = new Set([comment.id]);
  while (current.replyToCommentId) {
    const parent = byId.get(current.replyToCommentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id); current = parent;
  }
  return current;
}

export function CommentList({
  postId,
  targetCommentId,
  comments,
  loading,
  hasMore,
  composerState,
  composerErrorCode,
  composerRetryAfterSeconds,
  composerPublicationState,
  composerDraftText,
  viewerActorPtid,
  failureVariant = 'private',
  onLoadMore,
  onSubmit,
  onRetry,
  onDelete,
  onLike,
  reactionCommands,
  onAuthorClick,
}: CommentListProps) {
  const { t } = useTranslation('moments');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const submitInFlight = useRef(false);

  const authenticatedPtid = useSessionStore((s) => (
    s.authenticated ? s.currentUser?.actorPtid : undefined
  ));
  const sessionEpoch = useSessionStore((s) => s.sessionEpoch);
  const draftKey = useMemo(
    () => commentDraftKey(viewerActorPtid ?? authenticatedPtid, sessionEpoch, postId),
    [viewerActorPtid, authenticatedPtid, sessionEpoch, postId],
  );
  const storedDraft = useSocialCommentDraftsStore((s) => s.drafts[draftKey]);
  const setStoredDraft = useSocialCommentDraftsStore((s) => s.setDraft);
  const clearStoredDraft = useSocialCommentDraftsStore((s) => s.clearDraft);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [publicSubmitError, setPublicSubmitError] = useState(false);
  const [replyTargetId, setReplyTargetId] = useState(storedDraft?.replyToCommentId ?? '');
  const commentsById = useMemo(() => new Map(comments.map(comment => [comment.id, comment])), [comments]);
  const replyTarget = commentsById.get(replyTargetId);
  const replyRootId = replyTarget ? rootComment(replyTarget, commentsById).id : replyTargetId || undefined;
  const threads = useMemo(() => {
    const replies = new Map<string, MomentCommentItem[]>();
    const roots: MomentCommentItem[] = [];
    const time = (comment: MomentCommentItem) => comment.createdAtMillis ?? Number(comment.createdAt?.seconds ?? 0n) * 1000;
    for (const comment of comments) {
      const parent = rootComment(comment, commentsById);
      if (parent.id !== comment.id) {
        const list = replies.get(parent.id) ?? [];
        list.push(comment); replies.set(parent.id, list);
      } else roots.push(comment);
    }
    const recent = (a: MomentCommentItem, b: MomentCommentItem) => time(b) - time(a) || b.id.localeCompare(a.id);
    return roots.sort(recent).map(comment => ({ comment, replies: (replies.get(comment.id) ?? []).sort(recent) }));
  }, [comments, commentsById]);

  const [text, setText] = useState(() => storedDraft?.text ?? composerDraftText ?? '');
  const [mentions, setMentions] = useState<SocialTextMention[]>(
    () => storedDraft?.mentions ?? [],
  );
  const [composing, setComposing] = useState(false);
  const [caret, setCaret] = useState(0);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  const threadActorPtids = useMemo(
    () => comments.map((c) => c.authorPtid).filter(Boolean),
    [comments],
  );
  const allCandidates = useSocialMentionCandidates(threadActorPtids, viewerActorPtid);

  const trigger: MentionTrigger | null = useMemo(
    () => findMentionTrigger(text, caret),
    [text, caret],
  );
  const mentionCandidates = useMemo(() => {
    if (!trigger) return [];
    const query = trigger.query.trim().toLowerCase();
    return allCandidates
      .filter((candidate) => {
        if (!query) return true;
        return (
          candidate.displayName.toLowerCase().includes(query)
          || candidate.username?.toLowerCase().includes(query)
          || candidate.actorPtid.toLowerCase().includes(query)
        );
      })
      .slice(0, 8);
  }, [allCandidates, trigger]);
  const mentionPopoverOpen = Boolean(trigger) && mentionCandidates.length > 0;

  // Reset keyboard highlight when the trigger token changes, again
  // using the render-phase derived-state pattern.
  const triggerKey = trigger ? `${trigger.start}:${trigger.query}` : null;
  const [lastTriggerKey, setLastTriggerKey] = useState<string | null>(null);
  if (triggerKey !== lastTriggerKey) {
    setLastTriggerKey(triggerKey);
    setActiveMentionIndex(0);
  }

  const committedPending = composerPublicationState === 'COMMITTED_PENDING_READBACK';
  const nativePending = composerState === 'COMMENT_ENCRYPTING'
    || composerState === 'COMMENT_SUBMITTING';
  const parentUnavailable = composerState === 'COMMENT_PARENT_UNAVAILABLE';
  const retryDeadlinePending = composerState === 'COMMENT_RATE_LIMITED'
    || committedPending;
  const withinRetryDeadline = (composerRetryAfterSeconds ?? 0) > 0;

  const persistDraft = (nextText: string, nextMentions: SocialTextMention[]) => {
    setStoredDraft(draftKey, {
      text: nextText,
      mentions: nextMentions,
      replyToCommentId: replyRootId,
    });
  };

  const updateText = (next: string, selectionCaret?: number) => {
    const rebased = normalizeMentions(next, mentions);
    setText(next);
    setMentions(rebased);
    persistDraft(next, rebased);
    if (selectionCaret !== undefined) setCaret(selectionCaret);
  };

  const focusCaretAfterCommit = (nextCaret: number) => {
    // Focus + selection after React commits the new text. A
    // microtask runs after the commit paint boundary without
    // scheduling a component state update from an effect.
    queueMicrotask(() => {
      const target = textareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const pickMention = (candidate: SocialMentionCandidate) => {
    if (!trigger) return;
    const result = commitMention(text, trigger, {
      actorPtid: candidate.actorPtid,
      displayName: candidate.displayName.replace(/^@+/, ''),
    });
    const nextMentions = normalizeMentions(result.text, [
      ...mentions.filter((m) => m.actorPtid !== result.mention.actorPtid),
      result.mention,
    ]);
    setMentions(nextMentions);
    setText(result.text);
    setCaret(result.caret);
    persistDraft(result.text, nextMentions);
    focusCaretAfterCommit(result.caret);
  };

  const submit = async () => {
    // Defensive recheck against the freshest disabled conditions:
    // keyboard/click events can race a deadline transition or a
    // parent-unavailable projection arriving between render and the
    // event handler.
    if (composerDisabled) return;
    const trimmed = text.trim();
    if (!trimmed || submitInFlight.current) return;
    const normalized = normalizeMentions(text, mentions);
    submitInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setPublicSubmitError(false);
    try {
      await onSubmit(trimmed, replyRootId, normalized);
      setText('');
      setMentions([]);
      setReplyTargetId('');
      clearStoredDraft(draftKey);
    } catch (err) {
      setPublicSubmitError(failureVariant === 'public');
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // While the IME is composing, Enter / arrows belong to the IME
    // candidate window and must never submit or navigate mentions.
    if (composing || event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (mentionPopoverOpen) {
        event.preventDefault();
        setActiveMentionIndex((current) => {
          if (mentionCandidates.length === 0) return current;
          return event.key === 'ArrowDown'
            ? (current + 1) % mentionCandidates.length
            : (current - 1 + mentionCandidates.length) % mentionCandidates.length;
        });
      }
      return;
    }
    if (event.key === 'Escape' && mentionPopoverOpen) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      if (mentionPopoverOpen) {
        event.preventDefault();
        const candidate = mentionCandidates[activeMentionIndex];
        if (candidate) pickMention(candidate);
        return;
      }
      if (event.shiftKey) return; // newline
      event.preventDefault();
      void submit();
    }
  };

  // The native private flow clears its editor on committed-pending.
  // Applied via React's render-phase derived-state pattern so the
  // clear never schedules an extra cascading render.
  const [pendingClearApplied, setPendingClearApplied] = useState(false);
  if (committedPending && !pendingClearApplied) {
    setPendingClearApplied(true);
    setText('');
    setMentions([]);
    setReplyTargetId('');
  } else if (!committedPending && pendingClearApplied) {
    setPendingClearApplied(false);
  }

  const composerAction: ComposerAction = useMemo(() => {
    if (!onRetry) return 'submit';
    return resolvePrivateCommentComposerAction({
      state: composerState,
      publicationState: composerPublicationState,
      retryDeadlinePending: withinRetryDeadline,
      text,
      draftText: composerDraftText,
    });
  }, [composerDraftText, composerPublicationState, composerState, onRetry, text, withinRetryDeadline]);

  const composerDisabled = parentUnavailable
    || nativePending
    || committedPending
    || (retryDeadlinePending && withinRetryDeadline);
  const retrySeconds = composerRetryAfterSeconds ?? 0;

  const row = (comment: MomentCommentItem, depth = 0, replies?: React.ReactNode) => (
    <MomentCommentRow key={comment.id} comment={comment} depth={depth} replies={replies}
      highlighted={comment.id === targetCommentId}
      canModerate={!!viewerActorPtid && comment.authorPtid === viewerActorPtid}
      onAuthorClick={onAuthorClick}
      onLike={onLike} reactionCommand={reactionCommands?.[comment.id]}
      onReply={target => {
        const rootId = rootComment(target, commentsById).id;
        setReplyTargetId(target.id);
        setStoredDraft(draftKey, { text, mentions, replyToCommentId: rootId });
        textareaRef.current?.focus();
      }}
      onDelete={onDelete} />
  );
  const status = <>
    {submitError && <span>{publicSubmitError ? t(publicFeedErrorKey(submitError))
      : t('moments.private.state.PUBLISH_FAILED.description')}</span>}
    {!submitError && composerErrorCode && !committedPending && <span>{t(parentUnavailable
      ? 'moments.private.state.NOT_FOUND_OR_NOT_AUTHORIZED.description'
      : 'moments.private.state.PUBLISH_FAILED.description')}</span>}
    {committedPending && <span>{t('moments.comment.readbackPending')}</span>}
    {retryDeadlinePending && withinRetryDeadline && <span>{t('moments.comment.retryIn', { count: retrySeconds })}</span>}
  </>;
  return <div data-moments-comment-thread={postId} className="sk-comment-list">
      {comments.length === 0 && !loading && <span className="sk-comment-status">{t('moments.comment.empty')}</span>}
      {loading && <Spin label={t('moments.follow.loading')} />}
      <ul className="sk-comment-list">
        {threads.map(thread => row(thread.comment, 0,
          thread.replies.length > 0 ? thread.replies.map(reply => row(reply, 1)) : undefined))}
      </ul>
      {hasMore && !loading && <Button actionId={`comments.more.${postId}`} emphasis="quiet"
        className="sk-comment-pager" label={t('moments.action.loadMore')} onActivate={onLoadMore} />}
      {replyTarget && <div className="sk-comment-meta">
        <span>{t('moments.comment.replyingTo')}</span><MomentCommentAuthorName actorPtid={replyTarget.authorPtid} />
        <Button actionId={`comments.reply.cancel.${postId}`} emphasis="quiet" density="compact"
          className="sk-comment-action" label={t('moments.action.cancel')} onActivate={() => {
            setReplyTargetId(''); setStoredDraft(draftKey, { text, mentions });
          }} />
      </div>}
      <MomentCommentComposer invalid={Boolean(submitError || composerErrorCode)}
        status={submitError || composerErrorCode || committedPending || withinRetryDeadline ? status : undefined}>
        <SocialMentionPopover
          open={mentionPopoverOpen}
          candidates={mentionCandidates}
          activeIndex={activeMentionIndex}
          onHover={setActiveMentionIndex}
          onPick={pickMention}
        />
        <TextArea
          ref={textareaRef}
          data-acceptance-id="social-comment-input"
          value={text}
          onChange={(event) => updateText(
            event.target.value,
            event.target.selectionStart,
          )}
          onKeyDown={handleKeyDown}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setComposing(false);
            setCaret(event.currentTarget.selectionStart ?? text.length);
          }}
          onFocus={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          disabled={composerDisabled}
          minimumRows={1} maximumRows={4} aria-label={t('moments.comment.placeholder')}
          placeholder={t('moments.comment.placeholder')}
        />
          {composerAction !== 'submit' && onRetry ? (
            <Button actionId={`comments.retry.${postId}`} emphasis="primary" density="compact"
              execution={submitting || nativePending ? 'pending' : 'idle'}
              availability={withinRetryDeadline ? { kind: 'disabled', reason: t('moments.comment.retryIn', { count: retrySeconds }) } : undefined}
              label={t('moments.comment.confirmResult')}
              onActivate={() => void onRetry().catch(() => setSubmitError(t('moments.private.state.PUBLISH_FAILED.description')))} />
          ) : (
            <IconButton actionId={`comments.send.${postId}`} iconId="send"
              emphasis="primary" density="compact" label={t('moments.comment.publish')}
              data-acceptance-id="social-comment-send"
              availability={composerDisabled || !text.trim() ? { kind: 'disabled', reason: t('moments.comment.placeholder') } : undefined}
              execution={submitting || nativePending ? 'pending' : 'idle'} onActivate={() => void submit()} />
          )}
      </MomentCommentComposer>
    </div>;
}

function MomentCommentRow({
  comment,
  highlighted,
  canModerate,
  onReply,
  onDelete,
  onLike,
  reactionCommand,
  onAuthorClick,
  depth,
  replies,
}: {
  comment: MomentCommentItem;
  highlighted: boolean;
  canModerate: boolean;
  onReply: (comment: MomentCommentItem) => void;
  onDelete?: (commentId: string) => Promise<void>;
  onLike?: (commentId: string, liked: boolean) => Promise<void>;
  reactionCommand?: { pending: boolean; error?: string; retry?: () => Promise<void> };
  onAuthorClick?: (actorPtid: string) => void;
  depth: number;
  replies?: React.ReactNode;
}) {
  const { t } = useTranslation('moments');
  const identity = useActorIdentity(comment.authorPtid, { requireCanonicalProfile: true });
  const name = identity.displayName || t('moments.author.unknown');
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const feedback = useScopedFeedback();
  const date = comment.createdAtMillis ?? (comment.createdAt ? Number(comment.createdAt.seconds) * 1000 : undefined);
  const remove = async () => {
    if (!onDelete || deleting) return;
    setDeleting(true);
    try { await onDelete(comment.id); setConfirmOpen(false); }
    catch { feedback.error(t('moments.comment.deleteFailed')); }
    finally { setDeleting(false); }
  };
  return <PeerCommentRow commentId={comment.id} content={comment.content} own={canModerate}
    reaction={onLike ? { count: comment.likesCount ?? 0n, liked: comment.isLiked ?? false,
      label: BigInt(comment.likesCount ?? 0) > 0n
        ? t('moments.comment.likeCount', { value: String(comment.likesCount) }) : t('moments.reaction.like'),
      pending: reactionCommand?.pending,
      error: reactionCommand?.error ? t(publicFeedErrorKey(reactionCommand.error)) : undefined,
      onActivate: () => { void onLike(comment.id, !comment.isLiked).catch(() => {}); },
      retry: reactionCommand?.retry ? {
        label: t('moments.comment.confirmResult'),
        onActivate: () => { void reactionCommand.retry?.().catch(() => {}); },
      } : undefined,
    } : undefined}
    highlighted={highlighted} depth={depth} replies={replies}
    time={date === undefined ? undefined : <time dateTime={new Date(date).toISOString()}>{new Date(date).toLocaleString()}</time>}
    avatar={<MomentAuthorTrigger actorPtid={comment.authorPtid} onOpenProfile={onAuthorClick}>
      <Button actionId={`comment.avatar.${comment.id}`} emphasis="quiet" density="compact"
        className="sk-comment-avatar" aria-label={t('moments.identity.cardLabel', { name })}>
        <UserSquareAvatar actorPtid={comment.authorPtid} remoteUrl={identity.avatarUrl || undefined}
          name={name} size={depth ? 24 : 30} radius={depth ? 7 : 9} />
      </Button>
    </MomentAuthorTrigger>}
    author={<MomentAuthorTrigger actorPtid={comment.authorPtid} onOpenProfile={onAuthorClick}>
      <button type="button" className="sk-comment-author" aria-label={t('moments.identity.cardLabel', { name })}>{name}</button>
    </MomentAuthorTrigger>}
    actions={<>
      <Button actionId={`comment.reply.${comment.id}`} emphasis="quiet" density="compact"
        className="sk-comment-action" data-moments-comment-reply={comment.id}
        label={t('moments.comment.reply')} onActivate={() => onReply(comment)} />
      {canModerate && onDelete && <Button actionId={`comment.delete.${comment.id}`} emphasis="quiet" density="compact"
        tone="danger" className="sk-comment-action is-danger" data-comment-delete
        label={t('moments.comment.delete')} execution={deleting ? 'pending' : 'idle'}
        onActivate={() => setConfirmOpen(true)} />}
      <Dialog open={confirmOpen} onDismiss={() => { if (!deleting) setConfirmOpen(false); }}
        title={t('moments.comment.delete')} closeLabel={t('moments.action.cancel')}
        description={t('moments.comment.deleteConfirm')}
        footer={<>
          <Button actionId={`comment.delete.cancel.${comment.id}`} emphasis="quiet" label={t('moments.action.cancel')}
            onActivate={() => setConfirmOpen(false)} />
          <Button actionId={`comment.delete.confirm.${comment.id}`} emphasis="primary" tone="danger"
            label={t('moments.comment.delete')} execution={deleting ? 'pending' : 'idle'} onActivate={() => void remove()} />
        </>} />
    </>} />;
}
