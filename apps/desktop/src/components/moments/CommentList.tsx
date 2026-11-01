import {
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Input, Space, Spin, Typography, message, theme } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { SendHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PrivateCommentPublicationState, PrivateCommentState } from '../../services/privateCommentsNative';
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
import { MomentCommentAuthorName } from './MomentCommentAuthorName';

const { Text } = Typography;
const { TextArea } = Input;

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
}

type ComposerAction = 'submit' | 'retry' | 'reconcile';

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
}: CommentListProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('moments');
  const textareaRef = useRef<TextAreaRef | null>(null);
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
  const [replyTarget, setReplyTarget] = useState<MomentCommentItem | null>(null);

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
      replyToCommentId: replyTarget?.id,
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
      const target = textareaRef.current?.resizableTextArea?.textArea;
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
      await onSubmit(trimmed, replyTarget?.id, normalized);
      setText('');
      setMentions([]);
      setReplyTarget(null);
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
    setReplyTarget(null);
  } else if (!committedPending && pendingClearApplied) {
    setPendingClearApplied(false);
  }

  const composerAction: ComposerAction = useMemo(() => {
    if (!onRetry) return 'submit';
    if (committedPending) return 'reconcile';
    if (composerState === 'COMMENT_FAILED' || composerState === 'COMMENT_RATE_LIMITED') {
      return 'retry';
    }
    return 'submit';
  }, [committedPending, composerState, onRetry]);

  const composerDisabled = parentUnavailable
    || nativePending
    || committedPending
    || (retryDeadlinePending && withinRetryDeadline);
  const retrySeconds = composerRetryAfterSeconds ?? 0;

  return (
    <div
      data-moments-comment-thread={postId}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {comments.length === 0 && !loading && (
        <div style={{ padding: '8px 0' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('moments.comment.empty')}
          </Text>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
          <Spin size="small" />
        </div>
      )}

      {comments.map((c) => (
        <MomentCommentRow
          key={c.id}
          comment={c}
          highlighted={c.id === targetCommentId}
          canModerate={!!viewerActorPtid && c.authorPtid === viewerActorPtid}
          onReply={(target) => {
            setReplyTarget(target);
            textareaRef.current?.focus();
          }}
          onDelete={onDelete}
        />
      ))}

      {hasMore && !loading && (
        <Button block type="text" size="small" onClick={onLoadMore}>
          {t('moments.action.loadMore')}
        </Button>
      )}

      {replyTarget && (
        <Space size={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('moments.comment.replyingTo')}
          </Text>
          <MomentCommentAuthorName actorPtid={replyTarget.authorPtid} />
          <Button
            size="small"
            type="link"
            style={{ padding: 0, fontSize: 12 }}
            onClick={() => setReplyTarget(null)}
          >
            {t('moments.action.cancel')}
          </Button>
        </Space>
      )}

      {/* Composer boundary: textarea, mention popover, status, and
          submit all live inside one container so Post reads as part
          of the input, never a detached row. */}
      <div
        style={{
          position: 'relative',
          border: `1px solid ${submitError ? token.colorErrorBorder : token.colorBorderSecondary}`,
          borderRadius: token.borderRadius,
          padding: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: token.colorBgContainer,
        }}
      >
        <SocialMentionPopover
          open={mentionPopoverOpen}
          candidates={mentionCandidates}
          activeIndex={activeMentionIndex}
          onHover={setActiveMentionIndex}
          onPick={pickMention}
        />
        <TextArea
          ref={textareaRef}
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
          autoSize={{ minRows: 1, maxRows: 4 }}
          placeholder={t('moments.comment.placeholder')}
          style={{ borderRadius: token.borderRadius, border: 'none', padding: 0 }}
        />

        {submitError && (
          <Text type="danger" style={{ fontSize: 12 }}>
            {publicSubmitError
              ? t('moments.comment.publicSubmitFailed')
              : t('moments.private.state.PUBLISH_FAILED.description')}
          </Text>
        )}
        {!submitError && composerErrorCode && !committedPending && (
          <Text type="danger" style={{ fontSize: 12 }}>
            {parentUnavailable
              ? t('moments.private.state.NOT_FOUND_OR_NOT_AUTHORIZED.description')
              : t('moments.private.state.PUBLISH_FAILED.description')}
          </Text>
        )}
        {committedPending && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('moments.comment.readbackPending')}
          </Text>
        )}
        {retryDeadlinePending && withinRetryDeadline && (
          <Text type="danger" style={{ fontSize: 12 }}>
            {t('moments.comment.retryIn', { count: retrySeconds })}
          </Text>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {composerAction !== 'submit' && onRetry ? (
            <Button
              type="primary"
              size="small"
              loading={submitting || nativePending}
              onClick={() => void onRetry()}
            >
              {t('moments.comment.confirmResult')}
            </Button>
          ) : (
            <Button
              type="primary"
              size="small"
              disabled={composerDisabled || !text.trim()}
              loading={submitting || nativePending}
              onClick={() => void submit()}
              icon={<SendHorizontal size={12} />}
            >
              {t('moments.comment.publish')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MomentCommentRow({
  comment,
  highlighted,
  canModerate,
  onReply,
  onDelete,
}: {
  comment: MomentCommentItem;
  highlighted: boolean;
  canModerate: boolean;
  onReply: (comment: MomentCommentItem) => void;
  onDelete?: (commentId: string) => Promise<void>;
}) {
  const { t } = useTranslation('moments');
  const [deleting, setDeleting] = useState(false);
  return (
    <div
      data-moments-comment={comment.id}
      tabIndex={highlighted ? 0 : -1}
      style={{
        padding: '8px 0',
        borderBottom: '1px solid rgba(0,0,0,0.04)',
        outline: highlighted ? '2px solid #1677ff' : 'none',
      }}
    >
      <Space size={8} style={{ marginBottom: 2 }}>
        <MomentCommentAuthorName actorPtid={comment.authorPtid} />
        {/* Reply is always available, including on private detail
            threads; only Delete is gated by ownership. */}
        <Button
          size="small"
          type="link"
          style={{ padding: 0, fontSize: 12 }}
          data-moments-comment-reply={comment.id}
          onClick={() => onReply(comment)}
        >
          {t('moments.comment.reply')}
        </Button>
        {canModerate && onDelete && (
          <Button
            size="small"
            type="link"
            danger
            style={{ padding: 0, fontSize: 12 }}
            loading={deleting}
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await onDelete(comment.id);
              } catch {
                setDeleting(false);
                message.error(t('moments.comment.deleteFailed'));
              }
            }}
          >
            {t('moments.comment.delete')}
          </Button>
        )}
      </Space>
      <Text>{comment.content}</Text>
    </div>
  );
}
