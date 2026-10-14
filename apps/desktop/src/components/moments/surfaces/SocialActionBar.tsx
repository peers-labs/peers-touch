import { ReactNode } from 'react';
import { Button, Popover, Tooltip, theme } from 'antd';
import {
  MessageCircle,
  MoreHorizontal,
  ThumbsUp,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ReactionKind, type ReactionSummary } from '../../../gen/proto/domain/social/post_pb';
import type { PrivateReactionState } from '../../../services/privateMomentsNative';
import {
  REACTION_PRESENTATIONS,
  reactionPresentation,
} from '../reactionCatalog';

// SocialActionBar — a compact action row for a single post.
//
// Rationale (from UI Identity):
//   - Reaction and comment actions must share the same visual
//     language. The old "popover button for reactions + separate
//     icon button for comments" looked assembled.
//   - Loading / disabled state must be local to the action group,
//     never a page-level blocker.
//
// Slots:
//   - reaction summaries (icon + count + click-to-toggle)
//   - reaction picker (icons only, no text noise)
//   - comment count + click-to-open
//   - "more" menu for future actions (delete, etc.)
//
// Visual contract:
//   - Row height ~ 28px; icon buttons ~ 26px.
//   - Summaries use the theme primary tone when the viewer reacted;
//     otherwise tertiary color — never full-fledged cards.
//   - The picker is a compact Popover containing the canonical emoji catalog.

export interface SocialActionBarProps {
  reactions?: ReactionSummary[];
  commentCount?: number | string;
  loading?: boolean;
  onReact?: (kind: ReactionKind) => void;
  onUnreact?: (kind?: ReactionKind) => void;
  reactionState?: PrivateReactionState;
  onRetryReaction?: () => void;
  onOpenComments?: () => void;
  extra?: ReactNode;
  compact?: boolean;
}

function viewerReactedKind(reactions: ReactionSummary[]): ReactionKind | undefined {
  return reactions.find((r) => r.reactedByViewer)?.kind;
}

export function SocialActionBar({
  reactions = [],
  commentCount = 0,
  loading,
  onReact,
  onUnreact,
  reactionState,
  onRetryReaction,
  onOpenComments,
  extra,
  compact,
}: SocialActionBarProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('moments');

  const existing = reactions.filter((r) => Number(r.count ?? 0n) > 0);
  const reactedKind = viewerReactedKind(reactions);
  const iconSize = compact ? 13 : 14;
  const commandPending = reactionState === 'REACTION_PENDING'
    || reactionState === 'REACTION_RETRYING';
  const reactionDisabled = loading || commandPending;

  const picker = (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, maxWidth: 240 }}>
      {REACTION_PRESENTATIONS.map((meta) => {
        const kind = meta.kind;
        const active = reactedKind === kind;
        return (
          <Tooltip key={kind} title={t(meta.label)}>
            <Button
              type={active ? 'primary' : 'text'}
              size="small"
              shape="circle"
              icon={<span aria-hidden>{meta.emoji}</span>}
              disabled={reactionDisabled}
              onClick={() => (active ? onUnreact?.(kind) : onReact?.(kind))}
              style={{ width: 28, height: 28 }}
            />
          </Tooltip>
        );
      })}
    </div>
  );

  const reactionSummary = (() => {
    if (reactedKind) {
      const meta = reactionPresentation(reactedKind);
      return (
        <Tooltip title={t(meta.label)}>
          <Button
            type="text"
            size="small"
            icon={<span aria-hidden>{meta.emoji}</span>}
            onClick={() => onUnreact?.(reactedKind)}
            disabled={reactionDisabled}
            style={{
              color: token.colorPrimary,
              background: token.colorPrimaryBg,
              borderRadius: 999,
              paddingInline: 8,
              height: 28,
            }}
          >
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
              {String(
                existing.reduce((acc, r) => acc + Number(r.count ?? 0n), 0),
              )}
            </span>
          </Button>
        </Tooltip>
      );
    }
    if (existing.length > 0) {
      const top = existing.sort((a, b) => Number(b.count ?? 0n) - Number(a.count ?? 0n))[0];
      const meta = reactionPresentation(top.kind);
      return (
        <Tooltip title={t(meta.label)}>
          <Button
            type="text"
            size="small"
            icon={<span aria-hidden>{meta.emoji}</span>}
            onClick={() => onReact?.(top.kind)}
            disabled={loading}
            style={{
              color: token.colorTextSecondary,
              background: token.colorFillQuaternary,
              borderRadius: 999,
              paddingInline: 8,
              height: 28,
            }}
          >
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
              {String(existing.reduce((acc, r) => acc + Number(r.count ?? 0n), 0))}
            </span>
          </Button>
        </Tooltip>
      );
    }
    return (
      <Popover content={picker} trigger="click" placement="topLeft" arrow={false}>
        <Button
          type="text"
          size="small"
          icon={<ThumbsUp size={iconSize} />}
          disabled={reactionDisabled}
          style={{
            color: token.colorTextSecondary,
            background: token.colorFillQuaternary,
            borderRadius: 999,
            paddingInline: 8,
            height: 28,
          }}
        >
          {t('moments.reaction.add')}
        </Button>
      </Popover>
    );
  })();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        marginTop: 10,
      }}
    >
      {reactionSummary}
      {existing.length > 0 && reactedKind === undefined && (
        <Popover content={picker} trigger="click" placement="topLeft" arrow={false}>
          <Button
            type="text"
            size="small"
            shape="circle"
            icon={<MoreHorizontal size={iconSize} color={token.colorTextSecondary} />}
            disabled={reactionDisabled}
            style={{ width: 28, height: 28 }}
          />
        </Popover>
      )}
      {!existing.length && null /* picker already embedded above */}
      {reactionState && reactionState !== 'REACTION_COMMITTED' && (
        <span
          role="status"
          style={{
            color: reactionState === 'REACTION_REJECTED'
              ? token.colorError
              : token.colorTextSecondary,
            fontSize: 12,
          }}
        >
          {t(`moments.reaction.status.${reactionState}`)}
          {commandPending && onRetryReaction && (
            <Button
              type="link"
              size="small"
              disabled={loading}
              onClick={onRetryReaction}
              style={{ height: 24, paddingInline: 6, fontSize: 12 }}
            >
              {t('moments.reaction.retry')}
            </Button>
          )}
        </span>
      )}
      <Button
        type="text"
        size="small"
        icon={<MessageCircle size={iconSize} color={token.colorTextSecondary} />}
        onClick={onOpenComments}
        style={{
          color: token.colorTextSecondary,
          borderRadius: 999,
          background: token.colorFillQuaternary,
          paddingInline: 8,
          height: 28,
        }}
      >
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
          {String(commentCount)}
        </span>
      </Button>
      {extra}
    </div>
  );
}
