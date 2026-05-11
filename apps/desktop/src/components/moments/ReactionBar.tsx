import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Popover, Space, Tooltip, theme } from 'antd';
import { Heart, Smile, ThumbsUp, PartyPopper, Eye } from 'lucide-react';
import {
  ReactionKind,
  type ReactionSummary,
} from '../../gen/proto/domain/social/post_pb';

// ReactionBar — the compact summary + picker for a single post.
//
// Layout (left-to-right):
//   [👍 12] [❤️ 3] [😂 1]   < — Summary chips, hidden when count=0.
//   [+ React]                — popover with the full kind picker.
//
// Why a popover (not always-visible chips):
//   - Five ReactionKinds inflated as buttons would dominate the
//     post card on mobile-narrow widths. The popover collapses the
//     picker into one tap surface and only opens when the user
//     intends to react.
//   - Click on an existing summary chip toggles that reaction —
//     the most common path (like / un-like) is a single click on
//     the leading chip.

interface ReactionBarProps {
  reactions: ReactionSummary[];
  loading?: boolean;
  /** Fires when the viewer adds a reaction of the given kind. */
  onReact: (kind: ReactionKind) => void;
  /**
   * Fires when the viewer removes a reaction. Pass `kind` to remove
   * just that one; omit ↔ "remove all my reactions on this post".
   */
  onUnreact: (kind?: ReactionKind) => void;
}

interface KindMeta {
  Icon: typeof Heart;
  i18nKey: string;
  /** Used by the picker — colour the icon when the viewer has reacted. */
  hue: string;
}

function kindMeta(kind: ReactionKind, token: ReturnType<typeof theme.useToken>['token']): KindMeta {
  switch (kind) {
    case ReactionKind.REACTION_LIKE:
      return { Icon: ThumbsUp, i18nKey: 'moments.reaction.like', hue: token.colorPrimary };
    case ReactionKind.REACTION_LOVE:
      return { Icon: Heart, i18nKey: 'moments.reaction.love', hue: '#e85b81' };
    case ReactionKind.REACTION_LAUGH:
      return { Icon: Smile, i18nKey: 'moments.reaction.laugh', hue: '#f5a623' };
    case ReactionKind.REACTION_WOW:
      return { Icon: Eye, i18nKey: 'moments.reaction.wow', hue: '#5ac8fa' };
    case ReactionKind.REACTION_CELEBRATE:
      return { Icon: PartyPopper, i18nKey: 'moments.reaction.celebrate', hue: '#a36ee5' };
    default:
      return { Icon: ThumbsUp, i18nKey: 'moments.reaction.like', hue: token.colorPrimary };
  }
}

const PICKABLE_KINDS: ReactionKind[] = [
  ReactionKind.REACTION_LIKE,
  ReactionKind.REACTION_LOVE,
  ReactionKind.REACTION_LAUGH,
  ReactionKind.REACTION_WOW,
  ReactionKind.REACTION_CELEBRATE,
];

export function ReactionBar({ reactions, loading, onReact, onUnreact }: ReactionBarProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();

  const summary = useMemo(() => {
    // Only render summary chips for kinds with non-zero count, and
    // sort descending so the most-popular reaction is leftmost.
    return [...(reactions ?? [])]
      .filter((r) => Number(r.count ?? 0n) > 0)
      .sort((a, b) => Number(b.count ?? 0n) - Number(a.count ?? 0n));
  }, [reactions]);

  const picker = (
    <Space size={6}>
      {PICKABLE_KINDS.map((k) => {
        const meta = kindMeta(k, token);
        const reacted = (reactions ?? []).find((r) => r.kind === k)?.reactedByViewer;
        return (
          <Tooltip key={k} title={t(meta.i18nKey)}>
            <Button
              size="small"
              type={reacted ? 'primary' : 'text'}
              icon={<meta.Icon size={16} color={reacted ? '#fff' : meta.hue} />}
              onClick={() => (reacted ? onUnreact(k) : onReact(k))}
              disabled={loading}
            />
          </Tooltip>
        );
      })}
    </Space>
  );

  return (
    <Space size={2} wrap>
      {summary.map((r) => {
        const meta = kindMeta(r.kind, token);
        return (
          <Tooltip key={r.kind} title={t(meta.i18nKey)}>
            <Button
              size="small"
              type="text"
              icon={
                <meta.Icon
                  size={14}
                  color={meta.hue}
                />
              }
              onClick={() => (r.reactedByViewer ? onUnreact(r.kind) : onReact(r.kind))}
              disabled={loading}
              style={{
                paddingInline: 6,
                color: r.reactedByViewer ? token.colorPrimary : token.colorTextSecondary,
                background: 'transparent',
              }}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {String(r.count ?? 0n)}
              </span>
            </Button>
          </Tooltip>
        );
      })}
      <Popover
        content={picker}
        trigger="click"
        placement="topLeft"
        // Hide the popover arrow — the trigger button provides
        // enough visual anchoring and the arrow clashes with the
        // adjacent chips.
        arrow={false}
      >
        <Button
          size="small"
          type="text"
          disabled={loading}
          icon={<ThumbsUp size={14} />}
          style={{ color: token.colorTextSecondary, paddingInline: 6 }}
        >
          {summary.length === 0 ? t('moments.reaction.add') : null}
        </Button>
      </Popover>
    </Space>
  );
}
