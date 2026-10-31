import { useCallback, useMemo, useState } from 'react';
import { Button, Popover, Tooltip, theme } from 'antd';
import { MessageCircle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ReactionKind,
  type ReactionSummary,
} from '../../../gen/proto/domain/social/post_pb';
import {
  REACTION_PRESENTATIONS,
  reactionPresentation,
} from '../reactionCatalog';
import type { PrivateReactionState } from '../../../services/privateMomentsNative';

// SocialActionBar — multi-kind reaction row for a single post.
//
// Contract (r3.1 S05):
//   - the viewer can hold several kinds at once; every non-zero kind
//     renders its own chip with the authoritative per-kind count;
//   - the picker stays resident (never one-kind-then-hidden);
//   - pending state is per-kind and keyed by a client operation id, so
//     a double click on one kind only disables that kind and never the
//     whole row;
//   - failures collapse back to the authoritative server summary.

export interface SocialActionBarProps {
  reactions?: ReactionSummary[];
  commentCount?: number | string;
  /** Private Secure-Content ledger state; disables catalog while pending. */
  reactionState?: PrivateReactionState;
  onReact?: (kind: ReactionKind, operationId: string) => void | Promise<void>;
  onUnreact?: (kind: ReactionKind | undefined, operationId: string) => void | Promise<void>;
  /** Optional retry for the private reaction ledger. */
  onRetryReaction?: () => void | Promise<void>;
  /** When absent (embedded detail), the comment affordance is hidden. */
  onOpenComments?: () => void;
}

function makeOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `reaction-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function SocialActionBar({
  reactions = [],
  commentCount = 0,
  reactionState,
  onReact,
  onUnreact,
  onRetryReaction,
  onOpenComments,
}: SocialActionBarProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('moments');
  const [pendingKinds, setPendingKinds] = useState<ReadonlySet<ReactionKind>>(
    () => new Set(),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const viewerKinds = useMemo(
    () => new Set(
      reactions.filter((r) => r.reactedByViewer).map((r) => r.kind),
    ),
    [reactions],
  );

  const privateCommandPending = reactionState === 'REACTION_PENDING'
    || reactionState === 'REACTION_RETRYING';

  const chips = useMemo(() => {
    const active = reactions
      .filter((r) => Number(r.count ?? 0n) > 0)
      .map((r) => ({
        kind: r.kind,
        count: Number(r.count ?? 0n),
        reacted: r.reactedByViewer,
      }))
      .sort((left, right) => {
        if (left.reacted !== right.reacted) return left.reacted ? -1 : 1;
        return right.count - left.count;
      });
    return active;
  }, [reactions]);

  const setKindPending = useCallback((kind: ReactionKind, pending: boolean) => {
    setPendingKinds((previous) => {
      const next = new Set(previous);
      if (pending) next.add(kind);
      else next.delete(kind);
      return next;
    });
  }, []);

  const toggleKind = useCallback(async (kind: ReactionKind) => {
    if (pendingKinds.has(kind) || privateCommandPending) return;
    const operationId = makeOperationId();
    const reacted = viewerKinds.has(kind);
    setKindPending(kind, true);
    try {
      if (reacted) {
        await onUnreact?.(kind, operationId);
      } else {
        await onReact?.(kind, operationId);
      }
    } finally {
      // The store's post-wide summary is authoritative; clear pending
      // regardless of outcome so failure collapses back to it.
      setKindPending(kind, false);
    }
  }, [
    onReact,
    onUnreact,
    pendingKinds,
    privateCommandPending,
    setKindPending,
    viewerKinds,
  ]);

  const picker = (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        maxWidth: 280,
        padding: 4,
      }}
    >
      {REACTION_PRESENTATIONS.map((meta) => {
        const active = viewerKinds.has(meta.kind);
        const kindPending = pendingKinds.has(meta.kind);
        const disabled = kindPending
          || privateCommandPending
          || (!onReact && !onUnreact);
        return (
          <Tooltip key={meta.kind} title={t(meta.label)}>
            <Button
              type="text"
              shape="circle"
              size="small"
              aria-pressed={active}
              data-acceptance-id={`social-reaction-pick-${meta.kind}`}
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                void toggleKind(meta.kind);
              }}
              style={{
                width: 30,
                height: 30,
                padding: 0,
                fontSize: 16,
                background: active ? token.colorPrimaryBg : undefined,
                outline: active ? `1px solid ${token.colorPrimaryBorder}` : undefined,
              }}
            >
              {kindPending ? (
                <span
                  aria-label={t('moments.reaction.pending')}
                  style={{ fontSize: 12 }}
                >
                  ⏳
                </span>
              ) : (
                <span aria-hidden>{meta.emoji}</span>
              )}
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 10,
        flexWrap: 'wrap',
      }}
    >
      <Popover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        trigger="click"
        placement="topLeft"
        arrow={false}
        content={picker}
      >
        <Button
          type="text"
          size="small"
          data-acceptance-id="social-reaction-trigger"
          disabled={!onReact && !onUnreact}
          icon={<Plus size={14} />}
          style={{ paddingInline: 8, height: 28 }}
          onClick={(event) => event.stopPropagation()}
        >
          {t('moments.reaction.add')}
        </Button>
      </Popover>

      {chips.map((chip) => {
        const meta = reactionPresentation(chip.kind);
        const kindPending = pendingKinds.has(chip.kind);
        return (
          <Tooltip key={chip.kind} title={t(meta.label)}>
            <Button
              type={chip.reacted ? 'primary' : 'text'}
              size="small"
              shape="round"
              data-acceptance-id={`social-reaction-chip-${chip.kind}`}
              data-reaction-kind={chip.kind}
              aria-pressed={chip.reacted}
              loading={kindPending}
              onClick={(event) => {
                event.stopPropagation();
                void toggleKind(chip.kind);
              }}
              style={{
                paddingInline: 10,
                height: 28,
                borderRadius: 999,
                color: chip.reacted ? undefined : token.colorTextSecondary,
                background: chip.reacted ? token.colorPrimaryBg : token.colorFillQuaternary,
              }}
            >
              <span aria-hidden style={{ marginRight: 4 }}>{meta.emoji}</span>
              {chip.count}
            </Button>
          </Tooltip>
        );
      })}

      {reactionState && reactionState !== 'REACTION_COMMITTED' && (
        <span role="status" style={{ color: token.colorTextSecondary, fontSize: 12 }}>
          {t(`moments.reaction.status.${reactionState}`)}
          {reactionState === 'REACTION_REJECTED' && onRetryReaction && (
            <Button
              type="link"
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                void onRetryReaction();
              }}
            >
              {t('moments.reaction.retry')}
            </Button>
          )}
        </span>
      )}

      {onOpenComments && (
        <Button
          type="text"
          size="small"
          data-acceptance-id="social-open-comments"
          icon={<MessageCircle size={14} color={token.colorTextSecondary} />}
          onClick={(event) => {
            event.stopPropagation();
            onOpenComments();
          }}
          style={{
            marginLeft: 'auto',
            color: token.colorTextSecondary,
            paddingInline: 8,
            height: 28,
          }}
        >
          <span>{String(commentCount)}</span>
        </Button>
      )}
    </div>
  );
}
