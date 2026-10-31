/**
 * Increment 12 — per-message action anatomy: hover action bar with quick
 * reaction picker, reply, thread, forward, copy and delete-with-confirm.
 * Link-preview cards and @mention highlighting render in the bubble.
 */
import { useState } from 'react';
import { MessageCircle, Reply, Smile, Copy, Forward, Trash2 } from 'lucide-react';
import { Button, Dialog, Empty, Popover, Tag } from '@peers-touch/ui';
import type { ChatMessage, Conversation } from './chat-data';

const REACTION_KINDS = ['like', 'love', 'laugh', 'wow'] as const;
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮'];

/* ── Reaction pill + picker ───────────────────────────── */

function ReactionControl({ onReact }: { onReact: (kind: string) => void }) {
  return (
    <Popover placement="top"
      content={
        <div className="sk-react-pop" data-message-react>
          {QUICK_EMOJIS.map((emoji, index) => (
            <button key={emoji} type="button" className="sk-react-emoji"
              data-react-kind={REACTION_KINDS[index]}
              aria-label={`回应 ${emoji}`} onClick={() => onReact(REACTION_KINDS[index])}>
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
      {entries.map(([kind, who]) => (
        <span key={kind} className="sk-msg-reaction is-liked"
          data-reaction={kind} data-mine={(who ?? []).includes('me') ? '1' : '0'}>
          {QUICK_EMOJIS[REACTION_KINDS.indexOf(kind as typeof REACTION_KINDS[number])] ?? '👍'} {who?.length}
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

/* ── Delete confirm ───────────────────────────────────── */

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

/* ── Action bar (hover) ───────────────────────────────── */

export function MessageActionBar({ onReact, onReply, onThread, onCopy, onForwardOpen, onDeleteOpen, canDelete, copied }: {
  onReact: (kind: string) => void;
  onReply: () => void;
  onThread: () => void;
  onCopy: () => void;
  onForwardOpen: () => void;
  onDeleteOpen: () => void;
  canDelete: boolean;
  copied: boolean;
}) {
  const [, force] = useState(0);
  return (
    <div className="sk-msg-actions-bar" data-message-actions>
      <ReactionControl onReact={onReact} />
      <button type="button" className="sk-msg-action" data-action="reply" aria-label="回复"
        onClick={onReply}><Reply size={14} /></button>
      <button type="button" className="sk-msg-action" data-action="thread" aria-label="查看话题"
        onClick={onThread}><MessageCircle size={14} /></button>
      <button type="button" className="sk-msg-action" data-action="copy"
        aria-label={copied ? '已复制' : '复制'} data-copied={copied ? '1' : '0'}
        onClick={() => { onCopy(); force(v => v + 1); }}><Copy size={14} /></button>
      <button type="button" className="sk-msg-action" data-action="forward" aria-label="转发"
        onClick={onForwardOpen}><Forward size={14} /></button>
      {canDelete && (
        <button type="button" className="sk-msg-action is-danger" data-action="delete" aria-label="删除"
          onClick={onDeleteOpen}><Trash2 size={14} /></button>
      )}
    </div>
  );
}
