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
import { CreateGroupDialog, PickPersonDialog } from './ChatDialogs';
import type { CallDirection, CallKind } from './CallOverlay';
import {
  CONVERSATIONS, FRIEND_REQUESTS, PEOPLE, SEED_MESSAGES,
  type ChatMessage, type Conversation, type FriendRequest, type Person,
} from './chat-data';
import { usePrefs, makeTranslate, locTag } from '../prefs';
import './chat.css';

const DELIVERY_DELAY_MS = 700;
const RETRY_DELAY_MS = 900;
const TYPING_MS = 1800;

export type ChatNavigationRequest =
  | { nonce: number; kind: 'conversation'; conversationId: string; messageId?: string }
  | { nonce: number; kind: 'person'; personId: string };

export function ChatFeature({ navigation }: { navigation?: ChatNavigationRequest | null }) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [tab, setTab] = useState<'chats' | 'contacts'>('chats');
  const [sessions, setSessions] = useState<Conversation[]>(CONVERSATIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, ChatMessage[]>>(SEED_MESSAGES);
  const [requests, setRequests] = useState<FriendRequest[]>(FRIEND_REQUESTS);
  const [failedRequests, setFailedRequests] = useState<Set<string>>(new Set());

  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [call, setCall] = useState<{ conversationId: string; kind: CallKind; direction: CallDirection; multi?: boolean } | null>(null);
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
    .map(c => ({ id: c.id, name: c.name, tone: c.tone, station: t('search.recentStation'), bio: c.last }))],
  // t is stable per locale; sessions drive the pool contents.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [sessions, prefs.locale]);
  const existingIds = useMemo(() => new Set(sessions.map(c => c.id)), [sessions]);
  const friends = PEOPLE.filter(p => p.station === '本站');

  const togglePin = (id: string) => setSessions(list =>
    list.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c));
  const toggleMute = (id: string) => setSessions(list =>
    list.map(c => c.id === id ? { ...c, muted: !c.muted } : c));

  const markAsRead = (id: string) => setSessions(list =>
    list.map(c => c.id === id ? { ...c, unread: 0 } : c));

  // External navigation (global search result): open conversation/person.
  const lastNavNonce = useRef(0);
  useEffect(() => {
    if (!navigation || navigation.nonce === lastNavNonce.current) return;
    lastNavNonce.current = navigation.nonce;
    setTab('chats');
    if (navigation.kind === 'conversation') {
      if (sessions.some(c => c.id === navigation.conversationId)) {
        setSelectedId(navigation.conversationId);
        markAsRead(navigation.conversationId);
      }
    } else {
      const person = PEOPLE.find(p => p.id === navigation.personId);
      if (person) openPerson(person);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  const hideConversation = (id: string) => {
    setSessions(list => list.filter(c => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const deleteConversation = (id: string) => {
    setSessions(list => list.filter(c => c.id !== id));
    setMessagesByConv(map => {
      const next = { ...map };
      delete next[id];
      return next;
    });
    if (selectedId === id) setSelectedId(null);
  };

  const clearMessages = (id: string) =>
    setMessagesByConv(map => ({ ...map, [id]: [] }));

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

    const now = new Date().toLocaleTimeString(locTag(prefs.locale), { hour: '2-digit', minute: '2-digit' });
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
      const last = payload.voice ? t('preview.voice')
        : payload.attachments && payload.attachments.length > 0
          ? payload.text || `[${payload.attachments.some(a => a.kind === 'image') ? t('preview.imageBare') : t('preview.fileBare')}]`
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
        id, name: person.name, last: t('conv.start'), lastAt: t('time.justNow'), unread: 0,
        tone: person.tone, kind: 'person',
      }, ...list]);
      setSelectedId(id);
    }
    setTab('chats');
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

  const cancelRequest = (id: string) =>
    setRequests(list => list.filter(r => r.id !== id));

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
    const text = `${t('preview.forwardPrefix')}${message.text}`;
    setMessagesByConv(map => ({ ...map, [conversationId]: [...(map[conversationId] ?? []), {
      id: `local-fwd-${Date.now()}`, from: 'me',
      text,
      at: new Date().toLocaleTimeString(locTag(prefs.locale), { hour: '2-digit', minute: '2-digit' }),
    }] }));
    setSessions(list => list.map(c => c.id === conversationId ? { ...c, last: text } : c));
  };

  const createGroup = (group: Conversation) => {
    setSessions(list => [group, ...list]);
    setSelectedId(group.id);
    setMessagesByConv(map => ({ ...map, [group.id]: [
      { id: 's1', from: 'peer', kind: 'service',
        text: t('group.createdService', { name: group.name }), at: t('time.justNow') },
    ] }));
    setTab('chats');
  };

  // Narrow single-pane swap: the catalog rail owns the screen until a
  // conversation or contact surface opens; the header back control returns.
  const narrowOpen = !!selectedConversation;
  const backToList = () => { setSelectedId(null); };

  return (
    <div className={`sk-chat-feature${narrowOpen ? ' sk-narrow-open' : ''}`}
      data-message-layout={prefs.messageLayout} data-locale={prefs.locale}>
      <ChatRail
        tab={tab} onTabChange={setTab}
        sessions={sessions} selectedId={selectedId}
        onSelect={id => { setSelectedId(id); markAsRead(id); }}
        onTogglePin={togglePin} onToggleMute={toggleMute}
        onMarkRead={markAsRead} onHide={hideConversation} onDelete={deleteConversation}
        requests={requests} friends={friends} selectedContactId={null}
        failedRequestIds={failedRequests}
        onAccept={acceptRequest} onReject={rejectRequest} onCancelRequest={cancelRequest}
        // WeChat parity: tapping a person anywhere (contacts tab, search)
        // opens their conversation directly — no intermediate profile pane.
        onSelectContact={openPerson}
        onFindPeople={() => setPickerOpen(true)}
        onCreateGroup={() => setGroupOpen(true)}
        onPickSearchPerson={openPerson}
      />

      <div className="sk-chat-main">
        {selectedConversation ? (
          <ConversationView
            conversation={selectedConversation}
            messages={messagesByConv[selectedConversation.id] ?? []}
            conversations={sessions}
            call={call && call.conversationId === selectedConversation.id ? call : null}
            peerTyping={typingConvId === selectedConversation.id}
            onEndCall={() => setCall(null)}
            onSimulateIncoming={(kind, multi) => setCall({ conversationId: selectedConversation.id, kind, direction: 'in', multi })}
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
            onClearHistory={clearMessages}
            onDeleteConversation={deleteConversation}
            onForward={forwardMessage}
            onStartCall={kind => setCall({ conversationId: selectedConversation.id, kind, direction: 'out' })} />
        ) : (
          <div className="sk-chat-placeholder">
            <Empty icon={<MessagesSquare size={28} strokeWidth={1.5} />}
              description={tab === 'contacts' ? t('conv.selectContact') : t('conv.selectConversation')} />
          </div>
        )}
      </div>

      <PickPersonDialog open={pickerOpen} people={peoplePool} existingIds={existingIds}
        onDismiss={() => setPickerOpen(false)} onPick={person => { setPickerOpen(false); openPerson(person); }} />
      {/* Candidate pool includes federated contacts: selecting one must hit
          the encrypted-group boundary instead of silently creating a group. */}
      <CreateGroupDialog open={groupOpen} people={PEOPLE} onDismiss={() => setGroupOpen(false)}
        onCreate={createGroup} />
    </div>
  );
}
