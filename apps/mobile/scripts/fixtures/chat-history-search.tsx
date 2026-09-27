import { StrictMode, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import type { InvokeArgs } from '@tauri-apps/api/core';
import { mockIPC } from '@tauri-apps/api/mocks';
import type { MobileAuthSession } from '../../src/features/auth/authSession';
import type { ChatConversationKind } from '../../src/features/chat/chatCommands';
import { useChatHistorySearch } from '../../src/features/chat/useChatHistorySearch';
import { useSocialStore } from '../../src/features/social/socialStore';
import type {
  MessagingMessageProjection, messagingSearchMessages,
} from '../../src/services/mobileCommands';

// Component-only regression data, not a native index, Station, or product UI.
// The production hook, dispatcher, adapters, and invoke wrapper are unchanged.
type SearchInput = Parameters<typeof messagingSearchMessages>[0];
type Completion = 'first' | 'second' | 'tail' | 'fresh' | 'stale' | 'empty';
interface PendingCall {
  id: number;
  command: string;
  input: SearchInput;
  status: 'pending' | 'resolved' | 'rejected';
  flushed: boolean;
  resolve: (rows: MessagingMessageProjection[]) => void;
  reject: (error: Error) => void;
}

const calls: PendingCall[] = [];
const unexpectedCommands: string[] = [];
const listeners = new Set<() => void>();
let revision = 0;
let mountSequence = 0;
const notify = () => { revision += 1; listeners.forEach((listener) => listener()); };
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => revision;

function rows(start: number, count: number): MessagingMessageProjection[] {
  return Array.from({ length: count }, (_, index) => ({
    messageId: `indexed-${String(start - index).padStart(4, '0')}`,
    senderPtid: 'ptid:component-sender',
    senderDeviceId: 'component-device',
    plaintext: `Indexed fixture message ${start - index}`,
    timestampUnixMs: 1700000000123,
    attachments: [],
    state: 'accepted',
    retracted: false,
    reactions: [],
    readByPtids: [],
  }));
}

const completions: Record<Completion, MessagingMessageProjection[]> = {
  first: rows(300, 100),
  second: rows(200, 100),
  tail: rows(100, 1),
  fresh: rows(900, 1),
  stale: rows(901, 1),
  empty: [],
};

mockIPC(async <T,>(command: string, payload?: InvokeArgs): Promise<T> => {
  if (command !== 'messaging_search_messages' || !payload || !('input' in payload)) {
    unexpectedCommands.push(command);
    notify();
    throw new Error(`Unexpected component IPC: ${command}`);
  }
  const input = structuredClone(payload.input) as SearchInput;
  return await new Promise<MessagingMessageProjection[]>((resolve, reject) => {
    calls.push({ id: calls.length + 1, command, input, status: 'pending', flushed: false, resolve, reject });
    notify();
  }) as T;
});

function complete(call: PendingCall, completion: Completion, reject: boolean) {
  if (call.status !== 'pending') throw new Error(`Request ${call.id} already completed`);
  call.status = reject ? 'rejected' : 'resolved';
  if (reject) call.reject(new Error('component-index-unavailable'));
  else call.resolve(structuredClone(completions[completion]));
  notify();
  // Let promise continuations and React commits run before checking stale no-ops.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    call.flushed = true;
    notify();
  }));
}

function account(actor: string): MobileAuthSession {
  return {
    stationPeerId: 'component-station',
    stationUrl: 'https://component-only.invalid',
    sessionId: `component-session-${actor}`,
    accessToken: 'component-only-not-a-credential',
    actorRef: { ptid: `ptid:component-${actor}` },
    authenticatedAt: 1,
  };
}

// Set only inert test identity data. Never bind/install/reconcile a runtime.
useSocialStore.setState({ authSession: account('alice'), messages: {}, threadMessages: {} });

function SearchProbe({ kind, conversationId }: {
  kind: ChatConversationKind;
  conversationId: string;
}) {
  const session = useSocialStore((state) => state.authSession);
  const search = useChatHistorySearch(session, kind, conversationId);
  const [instance] = useState(() => ++mountSequence);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(true);
  const state = {
    query: search.query,
    loading: search.loading,
    error: search.error,
    index: search.index,
    cursors: search.cursors.map((cursor) => cursor ?? null),
    page: search.page === null ? null : {
      messages: search.page.messages.map((message) => ({
        id: message.ulid,
        content: message.content,
        conversationId: 'sessionUlid' in message ? message.sessionUlid : message.groupUlid,
      })),
      nextCursor: search.page.nextCursor,
    },
  };
  return (
    <section aria-label="Search probe" data-instance={instance}>
      {open ? (
        <>
          <form aria-label="History search" onSubmit={(event) => {
            event.preventDefault();
            search.search(draft);
          }}>
            <label>
              Search query
              <input value={draft} onChange={(event) => setDraft(event.target.value)} />
            </label>
            <button type="submit">Search</button>
            <button type="button" onClick={() => { setDraft(''); search.clear(); }}>Clear search</button>
            <button type="button" onClick={() => {
              setOpen(false);
              setDraft('');
              search.clear();
            }}>Close search</button>
          </form>
          <p role="status" aria-label="Search status">
            {search.loading ? 'Loading' : search.error ? 'Failed'
              : search.page ? (search.page.messages.length ? 'Results' : 'No results') : 'Idle'}
          </p>
          {search.error ? <p role="alert">Search failed; retry is available.</p> : null}
          <div>
            <button disabled={search.loading || search.index === 0} onClick={search.previous}>Previous</button>
            <button disabled={search.loading || !search.page?.nextCursor} onClick={search.next}>Next</button>
            <button disabled={search.loading || !search.error} onClick={search.retry}>Retry</button>
          </div>
          <ol aria-label="Search results" style={{ maxHeight: 160, overflowY: 'auto' }}>
            {search.page?.messages.map((message) => (
              <li key={message.ulid} data-message-id={message.ulid}>{message.content}</li>
            ))}
          </ol>
        </>
      ) : <button onClick={() => setOpen(true)}>Open search</button>}
      {/* Remains observable while closed: hiding results cannot satisfy a fence. */}
      <pre aria-label="Search snapshot">{JSON.stringify(state)}</pre>
    </section>
  );
}

function IpcControls() {
  useSyncExternalStore(subscribe, snapshot);
  const [completion, setCompletion] = useState<Completion>('fresh');
  const socialMessages = useSocialStore((state) => state.messages);
  const socialThreads = useSocialStore((state) => state.threadMessages);
  return (
    <section aria-label="Component IPC controls">
      <label>
        Completion data
        <select value={completion} onChange={(event) => setCompletion(event.target.value as Completion)}>
          {Object.keys(completions).map((key) => <option key={key} value={key}>{key}</option>)}
        </select>
      </label>
      <ol aria-label="IPC requests">
        {calls.map((call) => (
          <li key={call.id} data-request-id={call.id} data-flushed={call.flushed}>
            <span>Request {call.id}: {call.input.query} ({call.status})</span>
            <button disabled={call.status !== 'pending'}
              onClick={() => complete(call, completion, false)}>Resolve request {call.id}</button>
            <button disabled={call.status !== 'pending'}
              onClick={() => complete(call, completion, true)}>Reject request {call.id}</button>
          </li>
        ))}
      </ol>
      <pre aria-label="IPC snapshot">{JSON.stringify(calls.map(({ id, command, input, status, flushed }) => ({
        id, command, input, status, flushed,
      })))}</pre>
      <pre aria-label="Unexpected IPC">{JSON.stringify(unexpectedCommands)}</pre>
      <pre aria-label="Projection keys">{JSON.stringify({
        socialMessages: Object.keys(socialMessages), socialThreads: Object.keys(socialThreads),
      })}</pre>
    </section>
  );
}

function Fixture() {
  const [kind, setKind] = useState<ChatConversationKind>('friend');
  const [conversationId, setConversationId] = useState('conversation-a');
  const [mounted, setMounted] = useState(true);
  const session = useSocialStore((state) => state.authSession);
  return (
    <main>
      <h1>Chat history search regression</h1>
      <p>Component-only IPC data. No real native index, Station, API, or product acceptance evidence.</p>
      <fieldset>
        <legend>Component scope</legend>
        <label>Account
          <select value={session?.actorRef.ptid ?? 'none'} onChange={(event) => {
            const value = event.target.value;
            useSocialStore.setState({
              authSession: value === 'none' ? null : account(value === 'ptid:component-alice' ? 'alice' : 'bob'),
            });
          }}>
            <option value="ptid:component-alice">Alice fixture</option>
            <option value="ptid:component-bob">Bob fixture</option>
            <option value="none">No account</option>
          </select>
        </label>
        <button disabled={!session} onClick={() => {
          if (session) useSocialStore.setState({ authSession: { ...session } });
        }}>Replace session object</button>
        <label>Conversation
          <select value={conversationId} onChange={(event) => setConversationId(event.target.value)}>
            <option value="conversation-a">Conversation A</option>
            <option value="conversation-b">Conversation B</option>
          </select>
        </label>
        <label>Conversation kind
          <select value={kind} onChange={(event) => setKind(event.target.value as ChatConversationKind)}>
            <option value="friend">Direct</option>
            <option value="group">Group</option>
          </select>
        </label>
        <button onClick={() => setMounted((value) => !value)}>{mounted ? 'Unmount search' : 'Mount search'}</button>
      </fieldset>
      {/* No scope key or corrective effect: the production hook must fence replacements. */}
      {mounted ? <SearchProbe kind={kind} conversationId={conversationId} /> : <p>Search unmounted</p>}
      <IpcControls />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
