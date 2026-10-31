/**
 * Increment 11 — conversation frame: header with call/search/info entries,
 * a right-side conversation detail sheet, in-conversation message search,
 * and a thread panel with live replies. Calls open the shared call overlay
 * (increment 14 extends it with incoming and group calls).
 */
import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  ChevronLeft, ChevronRight, Crown, Eraser, File as FileIcon, Image as ImageIcon,
  Phone, Search, ShieldCheck, Smartphone, Trash2, Video,
} from 'lucide-react';
import {
  Avatar, Button, Dialog, Empty, IconButton, Switch, TextArea,
} from '@peers-touch/ui';
import type { CallKind } from './CallOverlay';
import type { ChatMessage, Conversation, ThreadReply } from './chat-data';

/* ── Header — desktop ChatArea parity: name only, no avatar
   (the avatar already lives beside each peer bubble); the back chevron is
   rendered but CSS-hidden above the phone breakpoint (persistent two-pane). */

export function ConversationHeader({ conversation, pinned, muted,
  onBack, onAudio, onVideo, onSearch, onInfo }: {
  conversation: Conversation;
  pinned: boolean;
  muted: boolean;
  onBack: () => void;
  onAudio: () => void;
  onVideo: () => void;
  onSearch: () => void;
  onInfo: () => void;
}) {
  const subtitle = conversation.kind === 'group'
    ? `${conversation.members?.length ?? 0} 位成员`
    : muted
      ? '免打扰'
      : conversation.online === false ? '离线' : '在线';
  return (
    <header className="sk-chat-head" data-conversation-open="true">
      <button type="button" className="sk-chat-back" aria-label="返回会话列表"
        data-action-id="chat.back-to-list" onClick={onBack}><ChevronLeft size={18} /></button>
      <div className="sk-chat-head-id">
        <div className="sk-chat-head-name">
          <strong>{conversation.name}</strong>
          <span data-head-subtitle>{subtitle}</span>
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

/* ── Detail sheet (desktop DetailPanel parity, redesigned
   card layout: identity hero, members, settings card, shared media/files,
   local danger zone) ─────────────────────────────────── */

const ROLE_RANK = { owner: 0, admin: 1, member: 2 } as const;

function GroupHeroAvatar({ members }: { members: NonNullable<Conversation['members']> }) {
  const tones = [...members].sort((a, b) => ROLE_RANK[a.role ?? 'member'] - ROLE_RANK[b.role ?? 'member'])
    .slice(0, 4).map(m => m.tone);
  return (
    <div className="sk-profile-group-avatar" aria-label="群头像">
      {tones.map((tone, i) => <span key={i} style={{ background: tone }} />)}
    </div>
  );
}

export function DetailSheet({ conversation, messages, onClose, onTogglePin, onToggleMute,
  onSearchMessages, onClearHistory, onDeleteConversation, onSimulateIncoming }: {
  conversation: Conversation;
  messages: ChatMessage[];
  onClose: () => void;
  onTogglePin: () => void;
  onToggleMute: () => void;
  onSearchMessages: () => void;
  onClearHistory: () => void;
  onDeleteConversation: () => void;
  onSimulateIncoming?: (kind: CallKind, multiDevice?: boolean) => void;
}) {
  const [confirm, setConfirm] = useState<null | 'clear' | 'delete'>(null);

  const isGroup = conversation.kind === 'group';
  const members = useMemo(() => {
    const list = conversation.members ?? [];
    return [...list].sort((a, b) => ROLE_RANK[a.role ?? 'member'] - ROLE_RANK[b.role ?? 'member']);
  }, [conversation.members]);

  const media = useMemo(() => messages.flatMap(m =>
    (m.attachments ?? []).filter(a => a.kind === 'image' && a.previewUrl)
      .map(a => ({ id: a.id, name: a.name, url: a.previewUrl as string }))), [messages]);
  const files = useMemo(() => messages.flatMap(m =>
    (m.attachments ?? []).filter(a => a.kind === 'file')
      .map(a => ({ id: a.id, name: a.name }))), [messages]);

  const runConfirm = () => {
    if (confirm === 'clear') onClearHistory();
    if (confirm === 'delete') { onDeleteConversation(); return; }
    setConfirm(null);
  };

  return (
    <aside className="sk-side-sheet sk-profile-sheet" aria-label="会话详情" data-detail-panel="true">
      <div className="sk-side-head">
        <strong>{isGroup ? '群聊资料' : '聊天资料'}</strong>
        <IconButton iconId="close" iconSize={15} label="关闭" actionId="chat.info-close"
          emphasis="quiet" density="compact" onActivate={onClose} />
      </div>

      <div className="sk-side-body">
        {/* Identity hero */}
        <section className="sk-profile-hero" data-profile-identity>
          {isGroup
            ? <GroupHeroAvatar members={members} />
            : <Avatar name={conversation.name} background={conversation.tone} size={64}
                style={{ borderRadius: 18 }} />}
          <strong>{conversation.name}</strong>
          <span className="sk-profile-sub">
            {isGroup ? `${members.length} 位成员`
              : conversation.muted ? '免打扰'
                : conversation.online === false ? '离线' : '在线'}
          </span>
        </section>

        {/* Group members */}
        {isGroup && (
          <section className="sk-profile-card" data-profile-members>
            <span className="sk-profile-card-title">群成员 · {members.length}</span>
            <div className="sk-profile-members">
              {members.slice(0, 8).map(member => (
                <div className="sk-member-row sk-profile-member" key={member.name}
                  data-role={member.role ?? 'member'}>
                  <span className="sk-profile-member-avatar">
                    <Avatar name={member.name} background={member.tone} size={38}
                      style={{ borderRadius: 11 }} />
                    {member.role === 'owner' && (
                      <span className="sk-role-badge is-owner" title="群主"><Crown size={9} /></span>
                    )}
                    {member.role === 'admin' && (
                      <span className="sk-role-badge is-admin" title="管理员"><ShieldCheck size={9} /></span>
                    )}
                  </span>
                  <span className="sk-profile-member-name">{member.name}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Settings */}
        <section className="sk-profile-card sk-side-switches" data-profile-settings>
          <Switch checked={!!conversation.muted} label="消息免打扰"
            onCheckedChange={onToggleMute} />
          <Switch checked={!!conversation.pinned} label="置顶会话"
            onCheckedChange={onTogglePin} />
          <button type="button" className="sk-setting-row" data-profile-search
            onClick={onSearchMessages}>
            <span className="sk-setting-icon"><Search size={16} /></span>
            <span>查找聊天记录</span>
            <ChevronRight size={15} className="sk-setting-chevron" />
          </button>
        </section>

        {/* Shared media & files — derived from real message attachments */}
        <section className="sk-profile-card" data-profile-media>
          <span className="sk-profile-card-title">共享媒体 · {media.length}</span>
          {media.length > 0 ? (
            <div className="sk-side-media sk-profile-media-grid">
              {media.slice(0, 6).map(item => (
                <button key={item.id} type="button" className="sk-side-thumb"
                  aria-label={item.name} data-shared-media={item.id}>
                  <img src={item.url} alt={item.name} />
                </button>
              ))}
            </div>
          ) : (
            <span className="sk-profile-empty"><ImageIcon size={13} /> 暂无共享媒体</span>
          )}
          <span className="sk-profile-card-title sk-profile-files-title">文件 · {files.length}</span>
          {files.length > 0 ? (
            <div className="sk-profile-files">
              {files.slice(0, 3).map(item => (
                <span key={item.id} className="sk-profile-file-row" data-shared-file={item.id}>
                  <FileIcon size={14} /> {item.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="sk-profile-empty"><FileIcon size={13} /> 暂无共享文件</span>
          )}
        </section>

        {/* Incoming-call demos (1:1, prototype only) */}
        {conversation.kind === 'person' && onSimulateIncoming && (
          <section className="sk-profile-card sk-side-call-demo">
            <span className="sk-profile-card-title">来电演示（本地原型）</span>
            <div className="sk-side-call-demo-row">
              <Button emphasis="quiet" density="compact" leading={<Phone size={14} />} label="语音"
                aria-label="模拟语音来电"
                actionId="chat.simulate-incoming-audio"
                onActivate={() => { onSimulateIncoming!('audio'); onClose(); }} />
              <Button emphasis="quiet" density="compact" leading={<Video size={14} />} label="视频"
                aria-label="模拟视频来电"
                actionId="chat.simulate-incoming-video"
                onActivate={() => { onSimulateIncoming!('video'); onClose(); }} />
              <Button emphasis="quiet" density="compact" leading={<Smartphone size={14} />} label="多设备"
                aria-label="多设备同响"
                actionId="chat.simulate-incoming-multi"
                onActivate={() => { onSimulateIncoming!('audio', true); onClose(); }} />
            </div>
          </section>
        )}

        {/* Danger zone */}
        <section className="sk-profile-card sk-profile-danger" data-profile-danger>
          <button type="button" className="sk-setting-row" data-action-id="profile.clear-history"
            onClick={() => setConfirm('clear')}>
            <span className="sk-setting-icon"><Eraser size={16} /></span>
            <span>清空聊天记录</span>
          </button>
          <button type="button" className="sk-setting-row is-danger" data-action-id="profile.delete-conversation"
            onClick={() => setConfirm('delete')}>
            <span className="sk-setting-icon"><Trash2 size={16} /></span>
            <span>删除会话</span>
          </button>
        </section>
      </div>

      <Dialog open={confirm !== null} onDismiss={() => setConfirm(null)}
        title={confirm === 'delete' ? '删除这个会话？' : '清空聊天记录？'} width={380} closeLabel="取消"
        description={confirm === 'delete'
          ? '会话将从列表移除（本地示例）；只想隐藏消息时可用「清空聊天记录」。'
          : '仅清空本地视图内的消息，会话仍保留在列表（本地示例）。'}
        footer={
          <>
            <Button actionId="profile.confirm-cancel" emphasis="quiet" label="取消"
              onActivate={() => setConfirm(null)} />
            <Button actionId="profile.confirm-ok" emphasis="primary" tone="danger"
              label={confirm === 'delete' ? '删除' : '清空'} onActivate={runConfirm} />
          </>
        }>
        <span data-profile-confirm={confirm ?? ''} />
      </Dialog>
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
