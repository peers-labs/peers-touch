import { useRef, useState } from 'react';
import { Button, MomentReactionBar } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';
import { ReactionKind, type ReactionSummary } from '../../../gen/proto/domain/social/post_pb';
import { REACTION_PRESENTATIONS } from '../reactionCatalog';
import type { PrivateReactionStatusProjection, PrivateReactionRecoveryProjection } from '../../../store/privateMoments';

export interface SocialActionBarProps {
  postId: string; reactions?: ReactionSummary[]; commentCount?: number; commentsOpen: boolean;
  reactionCommands?: readonly (PrivateReactionStatusProjection & { recovery?: PrivateReactionRecoveryProjection })[];
  onReact?: (kind: ReactionKind, operationId: string) => void | Promise<void>;
  onUnreact?: (kind: ReactionKind | undefined, operationId: string) => void | Promise<void>;
  onRetryReaction?: (kind: ReactionKind, commandId: string) => void | Promise<void>; onOpenComments: () => void;
}
/** Per-kind command execution adapter; the authoritative summary is never shadowed in UI. */
export function SocialActionBar({ postId, reactions = [], commentCount = 0, commentsOpen,
  reactionCommands = [], onReact, onUnreact, onRetryReaction, onOpenComments }: SocialActionBarProps) {
  const { t } = useTranslation('moments');
  const pendingRef = useRef(new Set<ReactionKind>());
  const [pending, setPending] = useState<ReadonlySet<ReactionKind>>(new Set());
  const commands = reactionCommands.filter(command =>
    command.postId === postId && !command.commentId && command.operation !== 'VOTE_POLL');
  const isPrivatePending = (kind: ReactionKind) => commands.some(command =>
    command.kind === kind && (command.state === 'REACTION_PENDING' || command.state === 'REACTION_RETRYING'));
  const toggle = async (kind: ReactionKind) => {
    const selected = Boolean(reactions.find(item => item.kind === kind)?.reactedByViewer);
    const command = selected ? onUnreact : onReact;
    if (!command || pendingRef.current.has(kind) || isPrivatePending(kind)) return;
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
        execution: pending.has(meta.kind) || isPrivatePending(meta.kind) ? 'pending' as const : 'idle' as const,
        availability: (selected ? onUnreact : onReact) ? undefined
          : { kind: 'disabled' as const, reason: t('moments.reaction.retryUnavailable') },
      };
    })}
    copy={{ picker: t('moments.reaction.add'), add: t('moments.reaction.add'),
      comments: count => t('moments.identity.commentCount', { count }), selected: t('moments.identity.unreactHint') }}
    onToggleReaction={kind => void toggle(Number(kind) as ReactionKind)}
    onToggleComments={onOpenComments}
    status={commands.filter(command => command.state !== 'REACTION_COMMITTED').map(command => {
      const meta = REACTION_PRESENTATIONS.find(item => item.kind === command.kind);
      return <span role="status" key={command.kind}>
        {meta && `${meta.emoji} ${t(meta.label)} · `}{t(`moments.reaction.status.${command.state}`)}
        {command.recovery?.eligible && command.recovery.commandId && onRetryReaction && <Button
          actionId={`moment.reaction.retry.${postId}.${command.kind}`} emphasis="quiet" density="compact"
          label={t('moments.reaction.retry')}
          availability={command.recovery.ready ? undefined
            : { kind: 'disabled', reason: t('moments.reaction.pending') }}
          onActivate={() => void onRetryReaction(command.kind, command.recovery!.commandId!)} />}
      </span>;
    })} />;
}
