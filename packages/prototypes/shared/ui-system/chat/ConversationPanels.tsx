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
import { useT, locTag } from '../prefs';

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
  const { t } = useT();
  const subtitle = conversation.kind === 'group'
    ? t('conv.members', { n: conversation.members?.length ?? 0 })
    : muted
      ? t('conv.muted')
      : conversation.online === false ? t('conv.offline') : t('conv.online');
  return (
    <header className="sk-chat-head" data-conversation-open="true">
      <button type="button" className="sk-chat-back" aria-label={t('conv.back')}
        data-action-id="chat.back-to-list" onClick={onBack}><ChevronLeft size={18} /></button>
      <div className="sk-chat-head-id">
        <div className="sk-chat-head-name">
          <strong>{conversation.name}</strong>
          <span data-head-subtitle>{subtitle}</span>
        </div>
      </div>
      <div className="sk-chat-head-actions">
        <IconButton iconId="phone" iconSize={16} label={t('conv.callAudio')} actionId="chat.call-audio"
          emphasis="quiet" onActivate={onAudio} />
        <IconButton iconId="video" iconSize={16} label={t('conv.callVideo')} actionId="chat.call-video"
          emphasis="quiet" onActivate={onVideo} />
        <IconButton iconId="search" iconSize={16} label={t('conv.searchMessages')} actionId="chat.search-messages"
          emphasis="quiet" onActivate={onSearch} />
        <IconButton iconId="info" iconSize={16} label={t('conv.info')} actionId="chat.open-info"
          emphasis={pinned || muted ? 'primary' : 'quiet'} onActivate={onInfo} />
      </div>
    </header>
  );
}

/* ── Detail sheet (desktop DetailPanel parity, redesigned
   card layout: identity hero, members, settings card, shared media/files,
   local danger zone) ─────────────────────────────────── */

const ROLE_RANK = { owner: 0, admin: 1, member: 2 } as const;

function GroupHeroAvatar({ members, label }: { members: NonNullable<Conversation['members']>; label: string }) {
  const tones = [...members].sort((a, b) => ROLE_RANK[a.role ?? 'member'] - ROLE_RANK[b.role ?? 'member'])
    .slice(0, 4).map(m => m.tone);
  return (
    <div className="sk-profile-group-avatar" aria-label={label}>
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
  const { t } = useT();

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
    <aside className="sk-side-sheet sk-profile-sheet" aria-label={t('conv.info')} data-detail-panel="true">
      <div className="sk-side-head">
        <strong>{isGroup ? t('profile.titleGroup') : t('profile.titlePerson')}</strong>
        <IconButton iconId="close" iconSize={15} label={t('profile.close')} actionId="chat.info-close"
          emphasis="quiet" density="compact" onActivate={onClose} />
      </div>

      <div className="sk-side-body">
        {/* Identity hero */}
        <section className="sk-profile-hero" data-profile-identity>
          {isGroup
            ? <GroupHeroAvatar members={members} label={t('profile.groupAvatar')} />
            : <Avatar name={conversation.name} background={conversation.tone} size={64}
                style={{ borderRadius: 18 }} />}
          <strong>{conversation.name}</strong>
          <span className="sk-profile-sub">
            {isGroup ? t('conv.members', { n: members.length })
              : conversation.muted ? t('conv.muted')
                : conversation.online === false ? t('conv.offline') : t('conv.online')}
          </span>
        </section>

        {/* Group members */}
        {isGroup && (
          <section className="sk-profile-card" data-profile-members>
            <span className="sk-profile-card-title">{t('profile.members', { n: members.length })}</span>
            <div className="sk-profile-members">
              {members.slice(0, 8).map(member => (
                <div className="sk-member-row sk-profile-member" key={member.name}
                  data-role={member.role ?? 'member'}>
                  <span className="sk-profile-member-avatar">
                    <Avatar name={member.name} background={member.tone} size={38}
                      style={{ borderRadius: 11 }} />
                    {member.role === 'owner' && (
                      <span className="sk-role-badge is-owner" title={t('profile.roleOwner')}><Crown size={9} /></span>
                    )}
                    {member.role === 'admin' && (
                      <span className="sk-role-badge is-admin" title={t('profile.roleAdmin')}><ShieldCheck size={9} /></span>
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
          <Switch checked={!!conversation.muted} label={t('profile.mute')}
            onCheckedChange={onToggleMute} />
          <Switch checked={!!conversation.pinned} label={t('profile.pin')}
            onCheckedChange={onTogglePin} />
          <button type="button" className="sk-setting-row" data-profile-search
            onClick={onSearchMessages}>
            <span className="sk-setting-icon"><Search size={16} /></span>
            <span>{t('profile.findMessages')}</span>
            <ChevronRight size={15} className="sk-setting-chevron" />
          </button>
        </section>

        {/* Shared media & files — derived from real message attachments */}
        <section className="sk-profile-card" data-profile-media>
          <span className="sk-profile-card-title">{t('profile.media', { n: media.length })}</span>
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
            <span className="sk-profile-empty"><ImageIcon size={13} /> {t('profile.noMedia')}</span>
          )}
          <span className="sk-profile-card-title sk-profile-files-title">{t('profile.files', { n: files.length })}</span>
          {files.length > 0 ? (
            <div className="sk-profile-files">
              {files.slice(0, 3).map(item => (
                <span key={item.id} className="sk-profile-file-row" data-shared-file={item.id}>
                  <FileIcon size={14} /> {item.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="sk-profile-empty"><FileIcon size={13} /> {t('profile.noFiles')}</span>
          )}
        </section>

        {/* Incoming-call demos (1:1, prototype only) */}
        {conversation.kind === 'person' && onSimulateIncoming && (
          <section className="sk-profile-card sk-side-call-demo">
            <span className="sk-profile-card-title">{t('profile.callDemo')}</span>
            <div className="sk-side-call-demo-row">
              <Button emphasis="quiet" density="compact" leading={<Phone size={14} />} label={t('profile.callDemoAudio')}
                aria-label={t('profile.callDemoAudioAria')}
                actionId="chat.simulate-incoming-audio"
                onActivate={() => { onSimulateIncoming!('audio'); onClose(); }} />
              <Button emphasis="quiet" density="compact" leading={<Video size={14} />} label={t('profile.callDemoVideo')}
                aria-label={t('profile.callDemoVideoAria')}
                actionId="chat.simulate-incoming-video"
                onActivate={() => { onSimulateIncoming!('video'); onClose(); }} />
              <Button emphasis="quiet" density="compact" leading={<Smartphone size={14} />} label={t('profile.callDemoMulti')}
                aria-label={t('profile.callDemoMultiAria')}
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
            <span>{t('profile.clearHistory')}</span>
          </button>
          <button type="button" className="sk-setting-row is-danger" data-action-id="profile.delete-conversation"
            onClick={() => setConfirm('delete')}>
            <span className="sk-setting-icon"><Trash2 size={16} /></span>
            <span>{t('profile.deleteConversation')}</span>
          </button>
        </section>
      </div>

      <Dialog open={confirm !== null} onDismiss={() => setConfirm(null)}
        title={confirm === 'delete' ? t('profile.deleteTitle') : t('profile.clearTitle')} width={380} closeLabel={t('profile.cancel')}
        description={confirm === 'delete' ? t('profile.deleteBody') : t('profile.clearBody')}
        footer={
          <>
            <Button actionId="profile.confirm-cancel" emphasis="quiet" label={t('profile.cancel')}
              onActivate={() => setConfirm(null)} />
            <Button actionId="profile.confirm-ok" emphasis="primary" tone="danger"
              label={confirm === 'delete' ? t('profile.deleteOk') : t('profile.clearOk')} onActivate={runConfirm} />
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
  const { t } = useT();
  const [query, setQuery] = useState('');
  const results = useMemo(() => messages
    .filter(m => m.kind !== 'service')
    .filter(m => m.text.toLowerCase().includes(query.trim().toLowerCase())), [messages, query]);

  return (
    <Dialog open={open} onDismiss={onClose} title={t('ms.title', { name: conversationName })}
      width={460} closeLabel={t('common.close')}
      footer={<Button actionId="search-messages.close" emphasis="quiet" label={t('common.close')} onActivate={onClose} />}>
      <div className="sk-msg-search" data-message-search>
        <input className="sk-msg-search-input" type="search" aria-label={t('ms.aria')}
          placeholder={t('ms.placeholder')} value={query} onChange={e => setQuery(e.target.value)}
          data-search-value={query} />
        <div className="sk-msg-search-list">
          {query.trim() && results.length === 0 && <Empty description={t('ms.empty')} />}
          {(!query.trim() ? messages.filter(m => m.kind !== 'service').slice(-5) : results).map(m => (
            <button key={m.id} type="button" className="sk-msg-search-row"
              data-message-id={m.id}
              onClick={() => { onLocate(m); onClose(); }}>
              <strong>{m.from === 'me' ? t('common.me') : (m.senderName ?? conversationName)}</strong>
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

export function ThreadSheet({ root, peerName, initialReplies, onClose, onReply }: {
  root: ChatMessage;
  peerName: string;
  initialReplies: ThreadReply[];
  onClose: () => void;
  onReply: (text: string) => void;
}) {
  const { t, locale } = useT();
  const [replies, setReplies] = useState<ThreadReply[]>(initialReplies);
  const [draft, setDraft] = useState('');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const reply: ThreadReply = {
      id: `local-${Date.now()}`, from: 'me',
      at: new Date().toLocaleTimeString(locTag(locale), { hour: '2-digit', minute: '2-digit' }), text,
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
    <aside className="sk-side-sheet sk-thread-sheet" aria-label={t('thread.aria')} data-thread-panel="true">
      <div className="sk-side-head">
        <strong>{t('thread.title', { n: replies.length })}</strong>
        <IconButton iconId="close" iconSize={15} label={t('thread.close')} actionId="thread.close"
          emphasis="quiet" density="compact" onActivate={onClose} />
      </div>
      <div className="sk-side-body">
        <div className="sk-thread-root">
          <strong>{root.from === 'me' ? t('common.me') : (root.senderName ?? peerName)}</strong>
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
        <TextArea framing="embedded" minimumRows={1} maximumRows={3} aria-label={t('thread.replyAria')}
          className="sk-thread-input" value={draft} onValueChange={setDraft}
          onEnter={onEnter} placeholder={t('thread.placeholder')} data-thread-draft={draft} />
        <IconButton iconId="send" iconSize={15} label={t('thread.send')} actionId="thread.send"
          emphasis="primary"
          availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: t('thread.sendDisabled') }}
          onActivate={send} />
      </div>
    </aside>
  );
}
