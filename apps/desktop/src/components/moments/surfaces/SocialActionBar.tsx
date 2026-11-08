import { useRef, useState } from 'react';
import { Button, MomentReactionBar } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';
import { ReactionKind, type ReactionSummary } from '../../../gen/proto/domain/social/post_pb';
import { REACTION_PRESENTATIONS } from '../reactionCatalog';
import type { PrivateReactionState } from '../../../services/privateMomentsNative';

export interface SocialActionBarProps {
  postId: string; reactions?: ReactionSummary[]; commentCount?: number; commentsOpen: boolean;
  reactionState?: PrivateReactionState;
  onReact?: (kind: ReactionKind, operationId: string) => void | Promise<void>;
  onUnreact?: (kind: ReactionKind | undefined, operationId: string) => void | Promise<void>;
  onRetryReaction?: () => void | Promise<void>; onOpenComments: () => void;
}
/** Per-kind command execution adapter; the authoritative summary is never shadowed in UI. */
export function SocialActionBar({ postId, reactions = [], commentCount = 0, commentsOpen,
  reactionState, onReact, onUnreact, onRetryReaction, onOpenComments }: SocialActionBarProps) {
  const { t } = useTranslation('moments');
  const pendingRef = useRef(new Set<ReactionKind>());
  const [pending, setPending] = useState<ReadonlySet<ReactionKind>>(new Set());
  const privatePending = reactionState === 'REACTION_PENDING' || reactionState === 'REACTION_RETRYING';
  const toggle = async (kind: ReactionKind) => {
    const selected = Boolean(reactions.find(item => item.kind === kind)?.reactedByViewer);
    const command = selected ? onUnreact : onReact;
    if (!command || pendingRef.current.has(kind) || privatePending) return;
    pendingRef.current.add(kind);
    setPending(new Set(pendingRef.current));
    try { await command(kind, crypto.randomUUID()); }
    finally { pendingRef.current.delete(kind); setPending(new Set(pendingRef.current)); }
  };
  return <MomentReactionBar postId={postId} commentsOpen={commentsOpen} commentCount={commentCount}
    reactions={REACTION_PRESENTATIONS.map(meta => {
      const summary = reactions.find(item => item.kind === meta.kind);
      const selected = summary?.reactedByViewer ?? false;
      return {
        kind: String(meta.kind), emoji: meta.emoji, label: t(meta.label),
        count: Number(summary?.count ?? 0n), selected,
        execution: pending.has(meta.kind) || privatePending ? 'pending' as const : 'idle' as const,
        availability: (selected ? onUnreact : onReact) ? undefined
          : { kind: 'disabled' as const, reason: t('moments.reaction.retryUnavailable') },
      };
    })}
    copy={{ picker: t('moments.reaction.add'), add: t('moments.reaction.add'),
      comments: count => t('moments.identity.commentCount', { count }), selected: t('moments.identity.unreactHint') }}
    onToggleReaction={kind => void toggle(Number(kind) as ReactionKind)}
    onToggleComments={onOpenComments}
    status={reactionState && reactionState !== 'REACTION_COMMITTED' ? <span role="status">
      {t(`moments.reaction.status.${reactionState}`)}
      {reactionState === 'REACTION_REJECTED' && onRetryReaction && <Button
        actionId={`moment.reaction.retry.${postId}`} emphasis="quiet" density="compact"
        label={t('moments.reaction.retry')} onActivate={() => void onRetryReaction()} />}
    </span> : undefined} />;
}
