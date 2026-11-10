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
  Bookmark, Check, CheckCheck, Copy, CornerUpLeft, EyeOff, Flag, Forward, ListChecks, Loader2,
  MessageCircle, MoreHorizontal, Pencil, Pin, RotateCcw, Smile, Undo2,
} from 'lucide-react';
import { Button, Dialog, Empty, Menu, Popover, Tag, type MenuEntry } from '@peers-touch/ui';
import type { ChatMessage, Conversation, DeliveryStatus } from './chat-data';
import { usePrefs, useT, type Translate } from '../prefs';
import {
  QUICK_REACTION_KINDS, REACTION_CATALOG, emojiForKind, messageActionGroups, orderedKinds,
  type MessageActionId, type ReactionKind, type ResolvedAction,
} from '../../chat-domain';

const MUTATION_WINDOW_MS = 4 * 60_000 + 30_000;

const ACTION_ICONS: Partial<Record<MessageActionId, React.ReactNode>> = {
  thread: <MessageCircle size={14} />,
  pin: <Pin size={14} />,
  copy: <Copy size={14} />,
  multiselect: <ListChecks size={14} />,
  'mark-later': <Bookmark size={14} />,
  edit: <Pencil size={14} />,
  recall: <Undo2 size={14} />,
  report: <Flag size={14} />,
  hide: <EyeOff size={14} />,
};

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

function ReactionControl({ onReact }: { onReact: (kind: ReactionKind) => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const kinds = expanded ? REACTION_CATALOG.map(meta => meta.kind) : QUICK_REACTION_KINDS;
  return (
    <Popover placement="top" open={open} onOpenChange={setOpen}
      content={
        <div className="sk-react-pop" data-message-react data-expanded={expanded ? 'true' : 'false'}>
          {kinds.map(kind => (
            <button key={kind} type="button" className="sk-react-emoji"
              data-react-kind={kind}
              aria-label={t('action.reactEmoji', { emoji: emojiForKind(kind) })}
              onClick={() => onReact(kind)}>
              {emojiForKind(kind)}
            </button>
          ))}
          <button type="button" className="sk-react-all" data-react-all
            aria-label={expanded ? t('composer.emojiRecent') : t('composer.emojiAll')}
            onClick={() => setExpanded(value => !value)}>
            {expanded ? <Smile size={15} /> : '···'}
          </button>
        </div>
      }>
      <button type="button" className="sk-msg-action" data-action="react" aria-label={t('action.react')}><Smile size={14} /></button>
    </Popover>
  );
}

export function MessageReactions({ message, onToggle }: {
  message: ChatMessage;
  onToggle?: (kind: ReactionKind) => void;
}) {
  const state = message.reactions;
  const kinds = state ? orderedKinds(state) : [];
  if (!kinds.length) return null;
  return (
    <div className="sk-msg-reactions">
      {kinds.map(kind => {
        const selected = state?.viewer.includes(kind) ?? false;
        return (
          <button key={kind} type="button"
            className="sk-msg-reaction"
            data-reaction={emojiForKind(kind)} data-reaction-kind={kind}
            data-mine={selected ? '1' : '0'} aria-pressed={selected}
            onClick={onToggle ? () => onToggle(kind) : undefined}>
            {emojiForKind(kind)} {state?.counts[kind] ?? 0}
          </button>
        );
      })}
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
              : { kind: 'disabled', reason: t('report.submitDisabled') }}
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

export type MessageActionTarget = MessageActionId;

type TKey = Parameters<Translate>[0];

function toMenuEntry(t: Translate, message: ChatMessage, action: ResolvedAction): MenuEntry {
  const label = action.id === 'pin' && message.pinned
    ? t('session.unpin')
    : t(action.labelKey as TKey);
  return {
    id: action.id,
    label,
    leading: ACTION_ICONS[action.id],
    tone: action.danger ? ('danger' as const) : undefined,
    availability: action.enabled
      ? undefined
      : {
          kind: 'disabled' as const,
          reason: action.disabledReasonKey ? t(action.disabledReasonKey as TKey) : '',
        },
  };
}

export function MessageActionBar({ message, copied, onReact, onReply, onThread,
  onCopy, onForwardOpen, onMenuAction }: {
  message: ChatMessage;
  copied: boolean;
  onReact: (kind: ReactionKind) => void;
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

  // Both desktop and mobile derive their groups from the shared catalog so
  // ownership/order cannot fork. Desktop surfaces have no moderator role.
  const groups = messageActionGroups({
    mine: message.from === 'me',
    canModerate: false,
    hasText: !!message.text.trim(),
    inMutationWindow: withinMutationWindow(message),
  });
  const actions: MenuEntry[] = [];
  groups.forEach((entry, groupIndex) => {
    if (groupIndex > 0) actions.push({ id: `sep-${groupIndex}`, kind: 'separator' as const, label: '' });
    entry.actions.forEach(action => actions.push(toMenuEntry(t, message, action)));
  });

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
