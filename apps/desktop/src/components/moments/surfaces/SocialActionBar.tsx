import { ReactNode } from 'react';
import { Button, Popover, Tooltip, theme } from 'antd';
import {
  Heart,
  MessageCircle,
  MoreHorizontal,
  Smile,
  ThumbsUp,
  PartyPopper,
  Eye,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ReactionKind, type ReactionSummary } from '../../../gen/proto/domain/social/post_pb';

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
//   - The picker is a Popover with 4–5 small icon buttons.

export interface SocialActionBarProps {
  reactions?: ReactionSummary[];
  commentCount?: number | string;
  loading?: boolean;
  onReact?: (kind: ReactionKind) => void;
  onUnreact?: (kind?: ReactionKind) => void;
  onOpenComments?: () => void;
  extra?: ReactNode;
  compact?: boolean;
}

interface KindMeta {
  Icon: typeof Heart;
  label: string;
}

function kindMeta(kind: ReactionKind): KindMeta {
  switch (kind) {
    case ReactionKind.REACTION_LIKE:
      return { Icon: ThumbsUp, label: 'moments.reaction.like' };
    case ReactionKind.REACTION_LOVE:
      return { Icon: Heart, label: 'moments.reaction.love' };
    case ReactionKind.REACTION_LAUGH:
      return { Icon: Smile, label: 'moments.reaction.laugh' };
    case ReactionKind.REACTION_WOW:
      return { Icon: Eye, label: 'moments.reaction.wow' };
    case ReactionKind.REACTION_CELEBRATE:
      return { Icon: PartyPopper, label: 'moments.reaction.celebrate' };
    default:
      return { Icon: ThumbsUp, label: 'moments.reaction.like' };
  }
}

const PICKER_KINDS: ReactionKind[] = [
  ReactionKind.REACTION_LIKE,
  ReactionKind.REACTION_LOVE,
  ReactionKind.REACTION_LAUGH,
  ReactionKind.REACTION_WOW,
  ReactionKind.REACTION_CELEBRATE,
];

function viewerReactedKind(reactions: ReactionSummary[]): ReactionKind | undefined {
  return reactions.find((r) => r.reactedByViewer)?.kind;
}

export function SocialActionBar({
  reactions = [],
  commentCount = 0,
  loading,
  onReact,
  onUnreact,
  onOpenComments,
  extra,
  compact,
}: SocialActionBarProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('moments');

  const existing = reactions.filter((r) => Number(r.count ?? 0n) > 0);
  const reactedKind = viewerReactedKind(reactions);
  const iconSize = compact ? 13 : 14;

  const picker = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {PICKER_KINDS.map((kind) => {
        const meta = kindMeta(kind);
        const active = reactedKind === kind;
        return (
          <Tooltip key={kind} title={t(meta.label)}>
            <Button
              type={active ? 'primary' : 'text'}
              size="small"
              shape="circle"
              icon={<meta.Icon size={iconSize} color={active ? '#fff' : token.colorTextSecondary} />}
              disabled={loading}
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
      const meta = kindMeta(reactedKind);
      return (
        <Tooltip title={t(meta.label)}>
          <Button
            type="text"
            size="small"
            icon={<meta.Icon size={iconSize} color={token.colorPrimary} />}
            onClick={() => onUnreact?.(reactedKind)}
            disabled={loading}
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
      const meta = kindMeta(top.kind);
      return (
        <Tooltip title={t(meta.label)}>
          <Button
            type="text"
            size="small"
            icon={<meta.Icon size={iconSize} color={token.colorTextSecondary} />}
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
          disabled={loading}
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
            disabled={loading}
            style={{ width: 28, height: 28 }}
          />
        </Popover>
      )}
      {!existing.length && null /* picker already embedded above */}
      <Button
        type="text"
        size="small"
        icon={<MessageCircle size={iconSize} color={token.colorTextSecondary} />}
        onClick={onOpenComments}
        disabled={loading}
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
