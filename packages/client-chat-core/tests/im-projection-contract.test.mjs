import assert from 'node:assert/strict';

import {
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
