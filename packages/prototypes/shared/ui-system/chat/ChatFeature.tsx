/**
 * ChatFeature — full chat surface for the north-star frame. Owns the
 * session/contact/message state once held inline by DesignDirections and
 * adds the increment 10 catalog layer: chats/contacts sub-navigation,
 * friend requests, contact detail, unified search and group creation.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { Empty } from '@peers-touch/ui';
import { ChatRail } from './ChatRail';
import { ConversationView } from './ConversationView';
import { ContactDetailPane, CreateGroupDialog, PickPersonDialog } from './ChatDialogs';
import type { CallDirection, CallKind } from './CallOverlay';
import {
  CONVERSATIONS, FRIEND_REQUESTS, PEOPLE, SEED_MESSAGES,
  type ChatMessage, type Conversation, type FriendRequest, type Person,
} from './chat-data';
import './chat.css';

const DELIVERY_DELAY_MS = 700;
const RETRY_DELAY_MS = 900;
const TYPING_MS = 1800;

export function ChatFeature() {
  const [tab, setTab] = useState<'chats' | 'contacts'>('chats');
  const [sessions, setSessions] = useState<Conversation[]>(CONVERSATIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, ChatMessage[]>>(SEED_MESSAGES);
  const [requests, setRequests] = useState<FriendRequest[]>(FRIEND_REQUESTS);
  const [failedRequests, setFailedRequests] = useState<Set<string>>(new Set());
  const [selectedContact, setSelectedContact] = useState<Person | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [call, setCall] = useState<{ conversationId: string; kind: CallKind; direction: CallDirection } | null>(null);
  const [typingConvId, setTypingConvId] = useState<string | null>(null);
  const timersRef = useRef<number[]>([]);

  useEffect(() => () => {
    timersRef.current.forEach(timer => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const later = (fn: () => void, ms: number) => {
    const timer = window.setTimeout(fn, ms);
    timersRef.current.push(timer);
  };

  const selectedConversation = sessions.find(c => c.id === selectedId) ?? null;
  const peoplePool = useMemo(() => [...PEOPLE, ...sessions
    .filter(c => c.kind === 'person')
    .map(c => ({ id: c.id, name: c.name, tone: c.tone, station: '最近会话', bio: c.last }))], [sessions]);
  const existingIds = useMemo(() => new Set(sessions.map(c => c.id)), [sessions]);
  const friends = PEOPLE.filter(p => p.station === '本站');

  const togglePin = (id: string) => setSessions(list =>
    list.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c));
  const toggleMute = (id: string) => setSessions(list =>
    list.map(c => c.id === id ? { ...c, muted: !c.muted } : c));

  const sendMessage = (payload: {
    text: string;
    attachments: ChatMessage['attachments'];
    voice: { url: string; durationSeconds: number } | null;
    replyTo?: { who: string; text: string };
    editId?: string;
  }) => {
    if (!selectedId) return;

    if (payload.editId) {
      editMessage(selectedId, payload.editId, payload.text);
      return;
    }

    const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const ts = Date.now();
    const msg: ChatMessage = payload.voice
      ? {
          id: `local-${ts}`, from: 'me', text: '',
          at: now, ts, kind: 'voice', status: 'delivered',
          voiceUrl: payload.voice.url, voiceSeconds: payload.voice.durationSeconds,
          replyTo: payload.replyTo,
        }
      : {
          id: `local-${ts}`, from: 'me', text: payload.text,
          at: now, ts, status: 'sending',
          attachments: payload.attachments,
          kind: payload.attachments?.some(a => a.kind === 'image') ? 'image' : 'text',
          replyTo: payload.replyTo,
        };
    setMessagesByConv(map => ({ ...map, [selectedId]: [...(map[selectedId] ?? []), msg] }));
    setSessions(list => list.map(c => {
      if (c.id !== selectedId) return c;
      const last = payload.voice ? '[语音]'
        : payload.attachments && payload.attachments.length > 0
          ? payload.text || `[${payload.attachments.some(a => a.kind === 'image') ? '图片' : '文件'}]`
          : payload.text;
      return { ...c, last, lastTs: ts };
    }));

    // Local delivery simulation: sending → delivered. Voice is recorded live
    // from a granted device, so it lands already delivered.
    if (!payload.voice) {
      later(() => patchMessage(selectedId, msg.id, { status: 'delivered' }), DELIVERY_DELAY_MS);
    }

    // Online friends briefly show "typing…" after a send (production = SSE).
    const conv = sessions.find(c => c.id === selectedId);
    if (conv?.kind === 'person' && conv.online) {
      setTypingConvId(selectedId);
      later(() => setTypingConvId(current => (current === selectedId ? null : current)), TYPING_MS);
    }
  };

  const openPerson = (person: Person) => {
    const existing = sessions.find(c => c.kind === 'person' && (c.id === person.id || c.name === person.name));
    if (existing) {
      setSelectedId(existing.id);
    } else {
      const id = `cv-${person.id}`;
      setSessions(list => [{
        id, name: person.name, last: '开始对话', lastAt: '刚刚', unread: 0,
        tone: person.tone, kind: 'person',
      }, ...list]);
      setSelectedId(id);
    }
    setTab('chats');
    setSelectedContact(null);
  };

  const acceptRequest = (id: string) => {
    // One transient failure, then success — mirrors desktop request error/retry.
    if (!failedRequests.has(id)) {
      setFailedRequests(prev => new Set(prev).add(id));
      setRequests(list => list.map(r => r.id === id ? { ...r } : r));
      return;
    }
    setRequests(list => list.map(r => r.id === id ? { ...r, state: 'accepted' } : r));
    setFailedRequests(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };
  const rejectRequest = (id: string) =>
    setRequests(list => list.map(r => r.id === id ? { ...r, state: 'rejected' } : r));

  const reactToMessage = (messageId: string, emoji: string) => {
    if (!selectedId) return;
    setMessagesByConv(map => ({ ...map, [selectedId]: (map[selectedId] ?? []).map(message => {
      if (message.id !== messageId) return message;
      const reactions = { ...(message.reactions ?? {}) };
      const current = new Set(reactions[emoji] ?? []);
      if (current.has('me')) current.delete('me'); else current.add('me');
      if (current.size === 0) delete reactions[emoji];
      else reactions[emoji] = [...current];
      return { ...message, reactions };
    }) }));
  };

  const patchMessage = (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
    setMessagesByConv(map => ({
      ...map,
      [conversationId]: (map[conversationId] ?? []).map(message =>
        message.id === messageId ? { ...message, ...patch } : message),
    }));
  };

  const editMessage = (conversationId: string, messageId: string, text: string) => {
    patchMessage(conversationId, messageId, { text, edited: true });
    setSessions(list => list.map(c => c.id === conversationId ? { ...c, last: text } : c));
  };

  const recallMessage = (conversationId: string, messageId: string) => {
    patchMessage(conversationId, messageId, {
      recalled: true, text: '', attachments: [], link: undefined, reactions: {},
    });
  };

  const pinMessage = (conversationId: string, messageId: string) => {
    setMessagesByConv(map => ({
      ...map,
      [conversationId]: (map[conversationId] ?? []).map(message =>
        message.id === messageId ? { ...message, pinned: !message.pinned } : message),
    }));
  };

  const retryMessage = (conversationId: string, messageId: string) => {
    patchMessage(conversationId, messageId, { status: 'sending' });
    later(() => patchMessage(conversationId, messageId, { status: 'delivered' }), RETRY_DELAY_MS);
  };

  const deleteMessage = (messageId: string) => {
    if (!selectedId) return;
    setMessagesByConv(map => ({ ...map, [selectedId]: (map[selectedId] ?? []).filter(m => m.id !== messageId) }));
  };
  const forwardMessage = (message: ChatMessage, conversationId: string) => {
    setMessagesByConv(map => ({ ...map, [conversationId]: [...(map[conversationId] ?? []), {
      id: `local-fwd-${Date.now()}`, from: 'me',
      text: `转发：${message.text}`,
      at: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    }] }));
    setSessions(list => list.map(c => c.id === conversationId ? { ...c, last: `转发：${message.text}` } : c));
  };

  const createGroup = (group: Conversation) => {
    setSessions(list => [group, ...list]);
    setSelectedId(group.id);
    setMessagesByConv(map => ({ ...map, [group.id]: [
      { id: 's1', from: 'peer', kind: 'service', text: `群聊「${group.name}」已创建`, at: '刚刚' },
    ] }));
    setTab('chats');
    setSelectedContact(null);
  };

  // Narrow single-pane swap: the catalog rail owns the screen until a
  // conversation or contact surface opens; the header back control returns.
  const narrowOpen = !!selectedConversation || (tab === 'contacts' && !!selectedContact);
  const backToList = () => { setSelectedId(null); setSelectedContact(null); };

  return (
    <div className={`sk-chat-feature${narrowOpen ? ' sk-narrow-open' : ''}`}>
      <ChatRail
        tab={tab} onTabChange={setTab}
        sessions={sessions} selectedId={selectedId} onSelect={id => { setSelectedId(id); setSelectedContact(null); }}
        onTogglePin={togglePin} onToggleMute={toggleMute}
        requests={requests} friends={friends} selectedContactId={selectedContact?.id ?? null}
        failedRequestIds={failedRequests}
        onAccept={acceptRequest} onReject={rejectRequest}
        onSelectContact={setSelectedContact}
        onFindPeople={() => setPickerOpen(true)}
        onCreateGroup={() => setGroupOpen(true)}
        onPickSearchPerson={openPerson}
      />

      <div className="sk-chat-main">
        {tab === 'contacts' && selectedContact ? (
          <ContactDetailPane person={selectedContact} onMessage={openPerson} onBack={backToList} />
        ) : selectedConversation ? (
          <ConversationView
            conversation={selectedConversation}
            messages={messagesByConv[selectedConversation.id] ?? []}
            conversations={sessions}
            call={call && call.conversationId === selectedConversation.id ? call : null}
            peerTyping={typingConvId === selectedConversation.id}
            onEndCall={() => setCall(null)}
            onSimulateIncoming={kind => setCall({ conversationId: selectedConversation.id, kind, direction: 'in' })}
            onBack={backToList}
            onSend={sendMessage}
            onTogglePin={togglePin}
            onToggleMute={toggleMute}
            onReact={reactToMessage}
            onEditMessage={editMessage}
            onRecallMessage={recallMessage}
            onPinMessage={pinMessage}
            onRetryMessage={retryMessage}
            onDelete={deleteMessage}
            onForward={forwardMessage}
            onStartCall={kind => setCall({ conversationId: selectedConversation.id, kind, direction: 'out' })} />
        ) : (
          <div className="sk-chat-placeholder">
            <Empty icon={<MessagesSquare size={28} strokeWidth={1.5} />}
              description={tab === 'contacts' ? '选择一位联系人查看资料' : '选择一个会话，或新建对话'} />
          </div>
        )}
      </div>

      <PickPersonDialog open={pickerOpen} people={peoplePool} existingIds={existingIds}
        onDismiss={() => setPickerOpen(false)} onPick={person => { setPickerOpen(false); openPerson(person); }} />
      <CreateGroupDialog open={groupOpen} people={friends} onDismiss={() => setGroupOpen(false)}
        onCreate={createGroup} />
    </div>
  );
}
