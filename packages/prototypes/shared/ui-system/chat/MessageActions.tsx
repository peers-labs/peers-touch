/**
 * Message action anatomy (increments 12 + 16). The hover toolbar follows the
 * desktop product contract: four quick actions (react / reply / forward /
 * more) and an overflow menu carrying the long tail (thread / pin / copy /
 * edit / recall / delete). Edit and recall exist only inside the 4m30s
 * mutation window; instead of silently disappearing they render disabled
 * with an explanatory reason.
 */
import {
  Check, CheckCheck, Copy, CornerUpLeft, Forward, Loader2, MessageCircle,
  MoreHorizontal, Pencil, Pin, RotateCcw, Smile, Trash2, Undo2,
} from 'lucide-react';
import { Button, Dialog, Empty, Menu, Popover, Tag } from '@peers-touch/ui';
import type { ChatMessage, Conversation, DeliveryStatus } from './chat-data';

// 24 reactions, same order as the desktop prototype.
export const REACTION_EMOJIS = [
  '👍', '❤️', '😂', '😮', '😢', '🙏', '👏', '🎉',
  '🔥', '💯', '🤔', '👀', '🙌', '✨', '✅', '💪',
  '🤝', '🥳', '😍', '😊', '😅', '🤯', '😎', '💡',
] as const;

const MUTATION_WINDOW_MS = 4 * 60_000 + 30_000;
const WINDOW_REASON = '仅发送后 4 分 30 秒内可用';

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
  if (message.from !== 'me' || !message.status) return null;
  const status = message.status;
  if (status === 'failed') {
    return onRetry ? (
      <button type="button" className="sk-msg-retry" data-msg-retry
        aria-label="发送失败，点击重试" title="发送失败，点击重试"
        onClick={event => { event.stopPropagation(); onRetry(); }}>
        <RotateCcw size={11} /> 失败，点击重试
      </button>
    ) : <span className="sk-msg-status is-failed"><RotateCcw size={11} /> 失败</span>;
  }
  const map: Record<Exclude<DeliveryStatus, 'failed'>, { node: React.ReactNode; label: string }> = {
    sending: { node: <Loader2 size={11} className="sk-spin" />, label: '发送中' },
    sent: { node: <Check size={11} />, label: '已发送' },
    delivered: { node: <CheckCheck size={11} />, label: '已送达' },
    read: { node: <CheckCheck size={11} />, label: '已读' },
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
  return (
    <Popover placement="top"
      content={
        <div className="sk-react-pop" data-message-react>
          {REACTION_EMOJIS.map(emoji => (
            <button key={emoji} type="button" className="sk-react-emoji"
              data-react-emoji={emoji}
              aria-label={`回应 ${emoji}`} onClick={() => onReact(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      }>
      <button type="button" className="sk-msg-action" data-action="react" aria-label="回应"><Smile size={14} /></button>
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

export function ForwardDialog({ open, message, conversations, onClose, onForward }: {
  open: boolean;
  message: ChatMessage | null;
  conversations: Conversation[];
  onClose: () => void;
  onForward: (conversationId: string, conversationName: string) => void;
}) {
  return (
    <Dialog open={open} onDismiss={onClose} title="转发给…" width={420} closeLabel="关闭"
      description={message ? `“${message.text.slice(0, 40)}”` : ''}
      footer={<Button actionId="forward.cancel" emphasis="quiet" label="取消" onActivate={onClose} />}>
      <div className="sk-forward-list" data-forward-dialog>
        {conversations.length === 0 && <Empty description="没有可转发的会话" />}
        {conversations.map(c => (
          <button key={c.id} type="button" className="sk-forward-row"
            data-forward-to={c.id}
            onClick={() => onForward(c.id, c.name)}>
            <Forward size={13} />
            <strong>{c.name}</strong>
            <Tag tone="neutral">{c.kind === 'group' ? '群' : '单聊'}</Tag>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/* ── Delete confirm ──────────────────────────────────── */

export function DeleteConfirm({ open, onCancel, onConfirm }: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onDismiss={onCancel} title="删除这条消息？" width={380} closeLabel="取消"
      description="删除后仅在你的本地视图移除（本地示例）。"
      footer={
        <>
          <Button actionId="msg.delete-cancel" emphasis="quiet" label="取消" onActivate={onCancel} />
          <Button actionId="msg.delete-confirm" emphasis="primary" tone="danger" label="删除"
            onActivate={onConfirm} />
        </>
      }>
      <span data-delete-confirm />
    </Dialog>
  );
}

/* ── Action bar: 4 quick actions + overflow menu ─────── */

export type MessageActionTarget = 'thread' | 'pin' | 'copy' | 'edit' | 'recall' | 'delete';

export function MessageActionBar({ message, canDelete, copied, onReact, onReply, onThread,
  onCopy, onForwardOpen, onMenuAction }: {
  message: ChatMessage;
  canDelete: boolean;
  copied: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onThread: () => void;
  onCopy: () => void;
  onForwardOpen: () => void;
  onMenuAction: (action: MessageActionTarget) => void;
}) {
  const inWindow = withinMutationWindow(message);
  const hasText = !!message.text.trim();
  const disabledReason = (kind: 'edit' | 'recall') =>
    (message.from !== 'me' ? '仅可对自己发送的消息操作'
      : !inWindow ? WINDOW_REASON
        : kind === 'edit' && !hasText ? '仅可编辑文字消息' : null);

  const editReason = disabledReason('edit');
  const recallReason = disabledReason('recall');

  return (
    <div className="sk-msg-actions-bar" data-message-actions>
      <ReactionControl onReact={onReact} />
      <button type="button" className="sk-msg-action" data-action="reply" aria-label="回复"
        onClick={onReply}><CornerUpLeft size={14} /></button>
      <button type="button" className="sk-msg-action" data-action="forward" aria-label="转发"
        onClick={onForwardOpen}><Forward size={14} /></button>
      <Menu
        placement="top"
        onAction={id => onMenuAction(id as MessageActionTarget)}
        actions={[
          { id: 'thread', label: '在话题中回复', leading: <MessageCircle size={14} /> },
          { id: 'pin', label: message.pinned ? '取消置顶' : '置顶消息', leading: <Pin size={14} /> },
          { id: 'copy', label: '复制文本', leading: <Copy size={14} />,
            availability: hasText ? undefined : { kind: 'disabled', reason: '该消息没有文本' } },
          { id: 'edit', label: '编辑', leading: <Pencil size={14} />,
            availability: editReason ? { kind: 'disabled', reason: editReason } : undefined },
          { id: 'recall', label: '撤回', leading: <Undo2 size={14} />,
            availability: recallReason ? { kind: 'disabled', reason: recallReason } : undefined },
          ...(canDelete ? [
            { id: 'sep-delete', kind: 'separator' as const, label: '' },
            { id: 'delete', label: '删除', leading: <Trash2 size={14} /> },
          ] : []),
        ]}
      >
        <button type="button" className="sk-msg-action" data-action="more"
          aria-label="更多消息操作" aria-haspopup="menu">
          <MoreHorizontal size={14} />
        </button>
      </Menu>
      {copied && <span className="sk-copy-flash" data-copied-flash>已复制</span>}
    </div>
  );
}
