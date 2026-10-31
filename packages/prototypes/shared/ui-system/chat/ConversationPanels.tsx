/**
 * Increment 11 — conversation frame: header with call/search/info entries,
 * a right-side conversation detail sheet, in-conversation message search,
 * and a thread panel with live replies. Calls open the shared call overlay
 * (increment 14 extends it with incoming and group calls).
 */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { Avatar, AvatarGroup, Button, Dialog, Empty, IconButton, Switch, Tag, TextArea } from '@peers-touch/ui';
import { artwork } from '../moments/moments-data';
import type { ChatMessage, Conversation, ThreadReply } from './chat-data';

/* ── Header ───────────────────────────────────────────── */

export function ConversationHeader({ conversation, pinned, muted,
  onAudio, onVideo, onSearch, onInfo }: {
  conversation: Conversation;
  pinned: boolean;
  muted: boolean;
  onAudio: () => void;
  onVideo: () => void;
  onSearch: () => void;
  onInfo: () => void;
}) {
  return (
    <header className="sk-chat-head" data-conversation-open="true">
      <div className="sk-chat-head-id">
        {conversation.kind === 'group'
          ? <AvatarGroup className="sk-head-avatars" aria-label={conversation.name}>
              {(conversation.members ?? []).slice(0, 3).map(m => (
                <Avatar key={m.name} name={m.name} background={m.tone} size={34}
                  style={{ borderRadius: 10 }} />
              ))}
            </AvatarGroup>
          : <Avatar name={conversation.name} background={conversation.tone} size={34}
              style={{ borderRadius: 10 }} />}
        <div className="sk-chat-head-name">
          <strong>{conversation.name}</strong>
          <span>
            {conversation.kind === 'group'
              ? `${conversation.members?.length ?? 0} 位成员`
              : (muted ? '已免打扰' : '在线')}
          </span>
        </div>
      </div>
      <div className="sk-chat-head-actions">
        <IconButton iconId="phone" iconSize={16} label="语音通话" actionId="chat.call-audio"
          emphasis="quiet" onActivate={onAudio} />
        <IconButton iconId="video" iconSize={16} label="视频通话" actionId="chat.call-video"
          emphasis="quiet" onActivate={onVideo} />
        <IconButton iconId="search" iconSize={16} label="搜索聊天记录" actionId="chat.search-messages"
          emphasis="quiet" onActivate={onSearch} />
        <IconButton iconId="info" iconSize={16} label="会话详情" actionId="chat.open-info"
          emphasis={pinned || muted ? 'primary' : 'quiet'} onActivate={onInfo} />
      </div>
    </header>
  );
}

/* ── Detail sheet ─────────────────────────────────────── */

const SHARED_MEDIA = ['mint', 'olive'];

export function DetailSheet({ conversation, onClose, onTogglePin, onToggleMute }: {
  conversation: Conversation;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleMute: () => void;
}) {
  return (
    <aside className="sk-side-sheet" aria-label="会话详情" data-detail-panel="true">
      <div className="sk-side-head">
        <strong>会话详情</strong>
        <IconButton iconId="close" iconSize={15} label="关闭" actionId="chat.info-close"
          emphasis="quiet" density="compact" onActivate={onClose} />
      </div>

      <div className="sk-side-body">
        <section className="sk-side-section">
          {conversation.kind === 'group' ? (
            <>
              <span className="sk-side-title">成员 · {conversation.members?.length ?? 0}</span>
              <div className="sk-member-list">
                {(conversation.members ?? []).map(member => (
                  <div className="sk-member-row" key={member.name}>
                    <Avatar name={member.name} background={member.tone} size={30}
                      style={{ borderRadius: 9 }} />
                    <span>{member.name}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <Avatar name={conversation.name} background={conversation.tone} size={56}
                style={{ borderRadius: 16 }} />
              <strong>{conversation.name}</strong>
              <Tag tone="neutral">单聊</Tag>
            </>
          )}
        </section>

        <section className="sk-side-section sk-side-switches">
          <Switch checked={!!conversation.muted} label="消息免打扰"
            onCheckedChange={onToggleMute} />
          <Switch checked={!!conversation.pinned} label="置顶会话"
            onCheckedChange={onTogglePin} />
        </section>

        <section className="sk-side-section">
          <span className="sk-side-title">共享媒体</span>
          <div className="sk-side-media">
            {SHARED_MEDIA.map((key, index) => (
              <button key={key} type="button" className="sk-side-thumb"
                aria-label={`共享图片 ${index + 1}`} data-shared-media={key}>
                <img src={artwork(key, '7fa692', '🌿')} alt={`共享图片 ${index + 1}`} />
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}

/* ── Message search dialog ────────────────────────────── */

export function MessageSearchDialog({ open, messages, conversationName, onClose, onLocate }: {
  open: boolean;
  messages: ChatMessage[];
  conversationName: string;
  onClose: () => void;
  onLocate: (message: ChatMessage) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => messages
    .filter(m => m.kind !== 'service')
    .filter(m => m.text.toLowerCase().includes(query.trim().toLowerCase())), [messages, query]);

  return (
    <Dialog open={open} onDismiss={onClose} title={`搜索「${conversationName}」聊天记录`}
      width={460} closeLabel="关闭"
      footer={<Button actionId="search-messages.close" emphasis="quiet" label="关闭" onActivate={onClose} />}>
      <div className="sk-msg-search" data-message-search>
        <input className="sk-msg-search-input" type="search" aria-label="搜索消息"
          placeholder="输入关键词" value={query} onChange={e => setQuery(e.target.value)}
          data-search-value={query} />
        <div className="sk-msg-search-list">
          {query.trim() && results.length === 0 && <Empty description="没有匹配的消息" />}
          {(!query.trim() ? messages.filter(m => m.kind !== 'service').slice(-5) : results).map(m => (
            <button key={m.id} type="button" className="sk-msg-search-row"
              data-message-id={m.id}
              onClick={() => { onLocate(m); onClose(); }}>
              <strong>{m.from === 'me' ? '我' : (m.senderName ?? conversationName)}</strong>
              <span>{m.text}</span>
              <time>{m.at}</time>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/* ── Thread sheet ─────────────────────────────────────── */

export function ThreadSheet({ root, initialReplies, onClose, onReply }: {
  root: ChatMessage;
  initialReplies: ThreadReply[];
  onClose: () => void;
  onReply: (text: string) => void;
}) {
  const [replies, setReplies] = useState<ThreadReply[]>(initialReplies);
  const [draft, setDraft] = useState('');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const reply: ThreadReply = {
      id: `local-${Date.now()}`, from: 'me',
      at: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), text,
    };
    setReplies(list => [...list, reply]);
    setDraft('');
    onReply(text);
  };
  const onEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    send();
  };

  return (
    <aside className="sk-side-sheet sk-thread-sheet" aria-label="话题" data-thread-panel="true">
      <div className="sk-side-head">
        <strong>话题 · {replies.length} 条回复</strong>
        <IconButton iconId="close" iconSize={15} label="关闭话题" actionId="thread.close"
          emphasis="quiet" density="compact" onActivate={onClose} />
      </div>
      <div className="sk-side-body">
        <div className="sk-thread-root">
          <strong>{root.from === 'me' ? '我' : (root.senderName ?? '周禾')}</strong>
          <p>{root.text}</p>
        </div>
        <div className="sk-thread-list">
          {replies.map(reply => (
            <div key={reply.id} className={`sk-thread-reply is-${reply.from}`}>
              {reply.from === 'peer' && <span className="sk-thread-who">{reply.senderName}</span>}
              <p>{reply.text}</p>
              <time>{reply.at}</time>
            </div>
          ))}
        </div>
      </div>
      <div className="sk-thread-composer">
        <TextArea framing="embedded" minimumRows={1} maximumRows={3} aria-label="回复话题"
          className="sk-thread-input" value={draft} onValueChange={setDraft}
          onEnter={onEnter} placeholder="回复话题…" data-thread-draft={draft} />
        <IconButton iconId="send" iconSize={15} label="发送回复" actionId="thread.send"
          emphasis="primary"
          availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入回复' }}
          onActivate={send} />
      </div>
    </aside>
  );
}
