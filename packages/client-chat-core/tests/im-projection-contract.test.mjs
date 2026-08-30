import assert from 'node:assert/strict';

import {
  createAgentChatCache,
  mergeAgentMessages,
  projectIMConversations,
  projectIMMessages,
} from '../dist/index.js';

const conversations = projectIMConversations([
  {
    kind: 'friend',
    id: 'session-1',
    title: 'Alice',
    avatar: 'alice.png',
    lastActivityMs: 2000,
    unread: 3,
    muted: true,
    preview: { content: 'hello', type: 1, senderId: 'alice' },
  },
  {
    kind: 'group',
    id: 'group-1',
    title: 'Design',
    lastActivityMs: 3000,
    unread: 2,
    alertEnabled: true,
    preview: { content: 'ship it', type: 1, senderId: 'bob' },
  },
]);

assert.deepEqual(
  conversations.map((item) => ({
    key: `${item.kind}:${item.id}`,
    visibleUnread: item.visibleUnread,
    syncStatus: item.syncStatus,
  })),
  [
    { key: 'group:group-1', visibleUnread: 2, syncStatus: 'live' },
    { key: 'friend:session-1', visibleUnread: 0, syncStatus: 'live' },
  ],
);

function memoryRepository() {
  const values = new Map();
  return {
    readValue: async (key) => values.get(key) ?? null,
    write: async (key, value) => {
      values.set(key, value);
      return {};
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}

const conversationRepo = memoryRepository();
await conversationRepo.write('agent-1', {
  stale: {
    conversationId: 'stale',
    agentId: 'agent-1',
    ptid: 'ptid:person:owner',
    title: 'Stale',
    status: 'active',
    activeBranchMessageId: '',
    queuedTurnCount: 0,
    version: 1,
    createdAt: '2026-08-18T00:00:00Z',
    updatedAt: '2026-08-18T00:00:00Z',
  },
});
const cache = createAgentChatCache({
  conversationRepo,
  messageRepo: memoryRepository(),
  turnEventRepo: memoryRepository(),
  cursorRepo: memoryRepository(),
  fetcher: {
    listConversations: async () => ({
      conversations: [{
        conversationId: 'current',
        agentId: 'agent-1',
        ptid: 'ptid:person:owner',
        title: 'Current',
        status: 'active',
        activeBranchMessageId: '',
        queuedTurnCount: 0,
        version: 2,
        createdAt: '2026-08-18T00:00:00Z',
        updatedAt: '2026-08-18T01:00:00Z',
      }],
    }),
    listMessages: async () => ({ messages: [] }),
  },
});
const reconciled = await cache.listConversations('agent-1');
assert.deepEqual(reconciled.map((conversation) => conversation.conversationId), ['current']);
assert.deepEqual(Object.keys(await conversationRepo.readValue('agent-1')), ['current']);

const interruptedSnapshot = {
  messageId: 'assistant-1',
  conversationId: 'conversation-1',
  turnId: 'turn-1',
  role: 'assistant',
  status: 'interrupted',
  content: '',
  seq: 5,
  createdAt: '2026-08-30T00:00:00Z',
  updatedAt: '2026-08-30T00:00:02Z',
};
const staleTerminalMessage = {
  ...interruptedSnapshot,
  status: 'failed',
  content: 'stale partial response',
  updatedAt: '2026-08-30T00:00:01Z',
};

const retainedSnapshot = mergeAgentMessages(
  [staleTerminalMessage],
  [interruptedSnapshot],
)[0];
assert.equal(retainedSnapshot.status, 'interrupted');
assert.equal(retainedSnapshot.content, '');
assert.equal(retainedSnapshot.updatedAt, interruptedSnapshot.updatedAt);

const acceptedSnapshot = mergeAgentMessages(
  [interruptedSnapshot],
  [staleTerminalMessage],
)[0];
assert.equal(acceptedSnapshot.status, 'interrupted');
assert.equal(acceptedSnapshot.content, '');
assert.equal(acceptedSnapshot.updatedAt, interruptedSnapshot.updatedAt);
const acceptedNewerMessage = mergeAgentMessages(
  [{ ...staleTerminalMessage, updatedAt: '2026-08-30T00:00:03Z' }],
  [interruptedSnapshot],
)[0];
assert.equal(acceptedNewerMessage.status, 'failed');
assert.equal(acceptedNewerMessage.content, 'stale partial response');
assert.equal(acceptedNewerMessage.updatedAt, '2026-08-30T00:00:03Z');

const messages = projectIMMessages([
  {
    id: 'm-2',
    conversationKind: 'group',
    conversationId: 'group-1',
    senderId: 'bob',
    type: 1,
    content: 'group',
    sentAtMs: 20,
    encrypted: true,
  },
  {
    id: 'm-1',
    conversationKind: 'friend',
    conversationId: 'session-1',
    senderId: 'alice',
    type: 1,
    content: 'friend',
    sentAtMs: 10,
  },
]);

assert.deepEqual(
  messages.map((item) => ({
    key: `${item.conversationKind}:${item.conversationId}:${item.id}`,
    content: item.content,
    encrypted: item.encrypted,
    recalled: item.recalled,
  })),
  [
    { key: 'friend:session-1:m-1', content: 'friend', encrypted: false, recalled: false },
    { key: 'group:group-1:m-2', content: 'group', encrypted: true, recalled: false },
  ],
);
