/**
 * Message action anatomy. The hover toolbar carries four quick actions
 * (react / reply / forward / more); the overflow menu holds the long tail in
 * Feishu-style command groups:
 *   peer  — thread / copy, multiselect / report, hide-for-me
 *   own   — thread / pin, copy, multiselect / edit, recall / hide-for-me
 *
 * Edit and recall are real protocol commands (EditMessageIntent /
 * RetractMessageIntent) bound to the 4m30s mutation window; instead of
 * silently disappearing they render disabled with an explanatory reason.
 * Hide-for-me maps to HideMessageForActorIntent (local removal at any time),
 * report to ModerateMessageIntent (peer messages, reason-coded).
 */
import { useState } from 'react';
import {
  Check, CheckCheck, Copy, CornerUpLeft, EyeOff, Flag, Forward, ListChecks, Loader2,
  MessageCircle, MoreHorizontal, Pencil, Pin, RotateCcw, Smile, Undo2,
} from 'lucide-react';
import { Button, Dialog, Empty, Menu, Popover, Tag, type MenuEntry } from '@peers-touch/ui';
import type { ChatMessage, Conversation, DeliveryStatus } from './chat-data';
import { usePrefs, useT } from '../prefs';

// 24 reactions, same order as the desktop prototype.
export const REACTION_EMOJIS = [
  '👍', '❤️', '😂', '😮', '😢', '🙏', '👏', '🎉',
  '🔥', '💯', '🤔', '👀', '🙌', '✨', '✅', '💪',
  '🤝', '🥳', '😍', '😊', '😅', '🤯', '😎', '💡',
] as const;

const MUTATION_WINDOW_MS = 4 * 60_000 + 30_000;

export function withinMutationWindow(message: ChatMessage, now = Date.now()): boolean {
  return message.from === 'me' && !!message.ts && now - message.ts <= MUTATION_WINDOW_MS;
}

const EMOJI_ONLY_RE = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\s]+$/u;
export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 24 && EMOJI_ONLY_RE.test(t);
}

/* ── Delivery meta ────────────────────────────────────── */

export function DeliveryMeta({ message, onRetry }: {
  message: ChatMessage;
  onRetry?: () => void;
}) {
  const { t } = useT();
  if (message.from !== 'me' || !message.status) return null;
  const status = message.status;
  if (status === 'failed') {
    return onRetry ? (
      <button type="button" className="sk-msg-retry" data-msg-retry
        aria-label={t('status.failedAria')} title={t('status.failedAria')}
        onClick={event => { event.stopPropagation(); onRetry(); }}>
        <RotateCcw size={11} /> {t('status.failedRetry')}
      </button>
    ) : <span className="sk-msg-status is-failed"><RotateCcw size={11} /> {t('status.failed')}</span>;
  }
  const map: Record<Exclude<DeliveryStatus, 'failed'>, { node: React.ReactNode; label: string }> = {
    sending: { node: <Loader2 size={11} className="sk-spin" />, label: t('status.sending') },
    sent: { node: <Check size={11} />, label: t('status.sent') },
    delivered: { node: <CheckCheck size={11} />, label: t('status.delivered') },
    read: { node: <CheckCheck size={11} />, label: t('status.read') },
  };
  const item = map[status as Exclude<DeliveryStatus, 'failed'>];
  return (
    <span className={`sk-msg-status is-${status}`} data-msg-status={status} aria-label={item.label}>
      {item.node} {item.label}
    </span>
  );
}

/* ── Reaction pill + picker ───────────────────────────── */

function ReactionControl({ onReact }: { onReact: (emoji: string) => void }) {
  const { t } = useT();
  return (
    <Popover placement="top"
      content={
        <div className="sk-react-pop" data-message-react>
          {REACTION_EMOJIS.map(emoji => (
            <button key={emoji} type="button" className="sk-react-emoji"
              data-react-emoji={emoji}
              aria-label={t('action.reactEmoji', { emoji })} onClick={() => onReact(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      }>
      <button type="button" className="sk-msg-action" data-action="react" aria-label={t('action.react')}><Smile size={14} /></button>
    </Popover>
  );
}

export function MessageReactions({ message }: { message: ChatMessage }) {
  const entries = Object.entries(message.reactions ?? {}).filter(([, who]) => (who ?? []).length > 0);
  if (!entries.length) return null;
  return (
    <div className="sk-msg-reactions">
      {entries.map(([emoji, who]) => (
        <span key={emoji} className="sk-msg-reaction"
          data-reaction={emoji} data-mine={(who ?? []).includes('me') ? '1' : '0'}>
          {emoji} {who?.length}
        </span>
      ))}
    </div>
  );
}

/* ── Forward dialog ───────────────────────────────────── */

export function ForwardDialog({ open, messages, conversations, onClose, onForward }: {
  open: boolean;
  messages: ChatMessage[];
  conversations: Conversation[];
  onClose: () => void;
  onForward: (conversationId: string, conversationName: string) => void;
}) {
  const { t } = useT();
  const first = messages[0];
  const description = messages.length > 1
    ? t('select.count', { n: messages.length })
    : first
      ? `“${first.text.slice(0, 40)}”`
      : '';
  return (
    <Dialog open={open} onDismiss={onClose} title={t('forward.title')} width={420} closeLabel={t('common.close')}
      description={description}
      footer={<Button actionId="forward.cancel" emphasis="quiet" label={t('common.cancel')} onActivate={onClose} />}>
      <div className="sk-forward-list" data-forward-dialog>
        {conversations.length === 0 && <Empty description={t('forward.empty')} />}
        {conversations.map(c => (
          <button key={c.id} type="button" className="sk-forward-row"
            data-forward-to={c.id}
            onClick={() => onForward(c.id, c.name)}>
            <Forward size={13} />
            <strong>{c.name}</strong>
            <Tag tone="neutral">{c.kind === 'group' ? t('kind.group') : t('kind.direct')}</Tag>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/* ── Hide-for-me confirm (HideMessageForActorIntent) ─── */

export function HideConfirm({ open, count, onCancel, onConfirm }: {
  open: boolean;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useT();
  const bulk = count > 1;
  return (
    <Dialog open={open} onDismiss={onCancel}
      title={bulk ? t('msg.bulkHideTitle', { n: count }) : t('msg.hideTitle')}
      width={380} closeLabel={t('common.cancel')}
      description={bulk ? t('msg.bulkHideBody') : t('msg.hideBody')}
      footer={
        <>
          <Button actionId="msg.hide-cancel" emphasis="quiet" label={t('common.cancel')} onActivate={onCancel} />
          <Button actionId="msg.hide-confirm" emphasis="primary" tone="danger" label={t('action.hideForMe')}
            onActivate={onConfirm} />
        </>
      }>
      <span data-hide-confirm={bulk ? 'bulk' : 'one'} />
    </Dialog>
  );
}

/* ── Report dialog (ModerateMessageIntent, reason-coded) ─ */

const REPORT_REASON_KEYS = ['spam', 'abuse', 'misinfo', 'other'] as const;

export function ReportDialog({ open, onCancel, onSubmit }: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (reasonCode: string) => void;
}) {
  const { t } = useT();
  const [reason, setReason] = useState<(typeof REPORT_REASON_KEYS)[number] | null>(null);
  return (
    <Dialog open={open} onDismiss={onCancel} title={t('report.title')} width={400}
      closeLabel={t('common.cancel')} description={t('report.body')}
      footer={
        <>
          <Button actionId="report.cancel" emphasis="quiet" label={t('common.cancel')} onActivate={onCancel} />
          <Button actionId="report.submit" emphasis="primary" label={t('report.submit')}
            availability={reason
              ? { kind: 'enabled' }
              : { kind: 'disabled', reason: t('report.body') }}
            onActivate={() => reason && onSubmit(reason)} />
        </>
      }>
      <div className="sk-report-reasons" data-report-dialog>
        {REPORT_REASON_KEYS.map(code => (
          <button key={code} type="button" className="sk-report-reason"
            aria-pressed={reason === code} data-report-reason={code}
            data-selected={reason === code ? 'true' : 'false'}
            onClick={() => setReason(code)}>
            {t(`report.reason.${code}`)}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/* ── Action bar: 4 quick actions + overflow menu ─────── */

export type MessageActionTarget =
  | 'thread' | 'pin' | 'copy' | 'multiselect' | 'edit' | 'recall' | 'report' | 'hide';

export function MessageActionBar({ message, copied, onReact, onReply, onThread,
  onCopy, onForwardOpen, onMenuAction }: {
  message: ChatMessage;
  copied: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onThread: () => void;
  onCopy: () => void;
  onForwardOpen: () => void;
  onMenuAction: (action: MessageActionTarget) => void;
}) {
  const { t } = useT();
  const { messageLayout } = usePrefs();
  // Which bubble edge the bar hugs (the CSS owns the pixel placement):
  // own messages sit right in "sides" and move left with the unified-left
  // preference, taking the bar to their right edge.
  const nearEdge: 'left' | 'right' =
    message.from === 'me' && messageLayout !== 'left' ? 'left' : 'right';
  const own = message.from === 'me';
  const inWindow = withinMutationWindow(message);
  const hasText = !!message.text.trim();
  const disabledReason = (kind: 'edit' | 'recall') =>
    (!inWindow ? t('action.windowReason')
      : kind === 'edit' && !hasText ? t('action.textOnly') : null);

  const editReason = disabledReason('edit');
  const recallReason = disabledReason('recall');

  const actions: MenuEntry[] = own
    ? [
        { id: 'thread', label: t('action.thread'), leading: <MessageCircle size={14} /> },
        { id: 'sep-actions', kind: 'separator' as const, label: '' },
        { id: 'pin', label: message.pinned ? t('session.unpin') : t('action.pinMsg'), leading: <Pin size={14} /> },
        { id: 'copy', label: t('action.copyText'), leading: <Copy size={14} />,
          availability: hasText ? undefined : { kind: 'disabled', reason: t('action.noText') } },
        { id: 'multiselect', label: t('action.multiselect'), leading: <ListChecks size={14} /> },
        { id: 'sep-mutate', kind: 'separator' as const, label: '' },
        { id: 'edit', label: t('action.edit'), leading: <Pencil size={14} />,
          availability: editReason ? { kind: 'disabled', reason: editReason } : undefined },
        { id: 'recall', label: t('action.recall'), leading: <Undo2 size={14} />,
          availability: recallReason ? { kind: 'disabled', reason: recallReason } : undefined },
        { id: 'sep-hide', kind: 'separator' as const, label: '' },
        { id: 'hide', label: t('action.hideForMe'), tone: 'danger' as const, leading: <EyeOff size={14} /> },
      ]
    : [
        { id: 'thread', label: t('action.thread'), leading: <MessageCircle size={14} /> },
        { id: 'sep-actions', kind: 'separator' as const, label: '' },
        { id: 'copy', label: t('action.copyText'), leading: <Copy size={14} />,
          availability: hasText ? undefined : { kind: 'disabled', reason: t('action.noText') } },
        { id: 'multiselect', label: t('action.multiselect'), leading: <ListChecks size={14} /> },
        { id: 'sep-govern', kind: 'separator' as const, label: '' },
        { id: 'report', label: t('action.report'), leading: <Flag size={14} /> },
        { id: 'hide', label: t('action.hideForMe'), tone: 'danger' as const, leading: <EyeOff size={14} /> },
      ];

  return (
    <div className="sk-msg-actions-bar" data-message-actions data-bar-side={nearEdge}>
      <ReactionControl onReact={onReact} />
      <button type="button" className="sk-msg-action" data-action="reply" aria-label={t('action.reply')}
        onClick={onReply}><CornerUpLeft size={14} /></button>
      <button type="button" className="sk-msg-action" data-action="forward" aria-label={t('action.forward')}
        onClick={onForwardOpen}><Forward size={14} /></button>
      <Menu
        placement="top"
        onAction={id => onMenuAction(id as MessageActionTarget)}
        actions={actions}
      >
        <button type="button" className="sk-msg-action" data-action="more"
          aria-label={t('action.more')} aria-haspopup="menu">
          <MoreHorizontal size={14} />
        </button>
      </Menu>
      {copied && <span className="sk-copy-flash" data-copied-flash>{t('action.copiedFlash')}</span>}
    </div>
  );
}
