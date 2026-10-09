import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@lobehub/ui';
import { Popover, Space, Tooltip, theme } from 'antd';
import { ThumbsUp } from 'lucide-react';
import {
  ReactionKind,
  type ReactionSummary,
} from '../../gen/proto/domain/social/post_pb';
import {
  REACTION_PRESENTATIONS,
  reactionPresentation,
} from './reactionCatalog';

// ReactionBar — the compact summary + picker for a single post.
//
// Layout (left-to-right):
//   [👍 12] [❤️ 3] [😂 1]   < — Summary chips, hidden when count=0.
//   [+ React]                — popover with the full kind picker.
//
// Why a popover (not always-visible chips):
//   - The full ReactionKind catalog as always-visible buttons would dominate the
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
    <Space size={8} wrap>
      {REACTION_PRESENTATIONS.map((meta) => {
        const k = meta.kind;
        const reacted = (reactions ?? []).find((r) => r.kind === k)?.reactedByViewer;
        return (
          <Tooltip key={k} title={t(meta.label)}>
            <Button
              size="small"
              type={reacted ? 'primary' : 'text'}
              icon={<span aria-hidden>{meta.emoji}</span>}
              onClick={() => (reacted ? onUnreact(k) : onReact(k))}
              disabled={loading}
              shape="circle"
            />
          </Tooltip>
        );
      })}
    </Space>
  );

  return (
    <Space size={4} wrap>
      {summary.map((r) => {
        const meta = reactionPresentation(r.kind);
        return (
          <Tooltip key={r.kind} title={t(meta.label)}>
            <Button
              size="small"
              type="text"
              icon={<span aria-hidden>{meta.emoji}</span>}
              onClick={() => (r.reactedByViewer ? onUnreact(r.kind) : onReact(r.kind))}
              disabled={loading}
              style={{
                paddingInline: 8,
                borderRadius: 999,
                color: r.reactedByViewer ? token.colorPrimary : token.colorTextSecondary,
                background: r.reactedByViewer ? token.colorPrimaryBg : token.colorFillQuaternary,
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
          style={{
            color: token.colorTextSecondary,
            paddingInline: 10,
            borderRadius: 999,
            background: summary.length === 0 ? token.colorFillQuaternary : 'transparent',
          }}
        >
          {summary.length === 0 ? t('moments.reaction.add') : null}
        </Button>
      </Popover>
    </Space>
  );
}
