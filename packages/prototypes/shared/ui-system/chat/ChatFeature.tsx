/**
 * ChatFeature — full chat surface for the north-star frame. Owns the
 * session/contact/message state once held inline by DesignDirections and
 * adds the increment 10 catalog layer: chats/contacts sub-navigation,
 * friend requests, contact detail, unified search and group creation.
 */
import { useMemo, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { Empty } from '@peers-touch/ui';
import { ChatRail } from './ChatRail';
import { ConversationView } from './ConversationView';
import { ContactDetailPane, CreateGroupDialog, PickPersonDialog } from './ChatDialogs';
import {
  CONVERSATIONS, FRIEND_REQUESTS, PEOPLE, SEED_MESSAGES,
  type ChatMessage, type Conversation, type FriendRequest, type Person,
} from './chat-data';
import './chat.css';

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

  const sendMessage = (text: string) => {
    if (!selectedId) return;
    const msg: ChatMessage = {
      id: `local-${Date.now()}`, from: 'me', text, at: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    };
    setMessagesByConv(map => ({ ...map, [selectedId]: [...(map[selectedId] ?? []), msg] }));
    setSessions(list => list.map(c => c.id === selectedId ? { ...c, last: text } : c));
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

  const createGroup = (group: Conversation) => {
    setSessions(list => [group, ...list]);
    setSelectedId(group.id);
    setMessagesByConv(map => ({ ...map, [group.id]: [
      { id: 's1', from: 'peer', kind: 'service', text: `群聊「${group.name}」已创建`, at: '刚刚' },
    ] }));
    setTab('chats');
    setSelectedContact(null);
  };

  return (
    <div className="sk-chat-feature">
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
          <ContactDetailPane person={selectedContact} onMessage={openPerson} />
        ) : selectedConversation ? (
          <ConversationView
            conversation={selectedConversation}
            messages={messagesByConv[selectedConversation.id] ?? []}
            onSend={sendMessage} />
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
