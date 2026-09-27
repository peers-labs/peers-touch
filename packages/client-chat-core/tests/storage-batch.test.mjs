import assert from 'node:assert/strict';

import { runConversationClearBatch } from '../dist/index.js';

const calls = [];
const progress = [];
let activeCalls = 0;
let maxActiveCalls = 0;
const partial = await runConversationClearBatch({
  conversationIds: [' alpha ', 'beta', 'alpha', '', 'gamma'],
  clearConversation: async (conversationId) => {
    calls.push(conversationId);
    activeCalls += 1;
    maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
    await Promise.resolve();
    activeCalls -= 1;
    if (conversationId === 'beta') return { state: 'failed' };
    return { state: 'succeeded', releasedBytes: 100n };
  },
  onProgress: (value) => progress.push(value),
});

assert.deepEqual(calls, ['alpha', 'beta', 'gamma']);
assert.equal(maxActiveCalls, 1);
assert.equal(partial.status, 'partial_failure');
assert.deepEqual(partial.succeededIds, ['alpha', 'gamma']);
assert.deepEqual(partial.failedIds, ['beta']);
assert.deepEqual(partial.remainingIds, []);
assert.equal(partial.completedCount, 3);
assert.equal(partial.releasedBytes, 200n);
assert.deepEqual(progress, [
  { completedCount: 1, totalCount: 3, conversationId: 'alpha' },
  { completedCount: 2, totalCount: 3, conversationId: 'beta' },
  { completedCount: 3, totalCount: 3, conversationId: 'gamma' },
]);

const abortedCalls = [];
const abortedProgress = [];
const aborted = await runConversationClearBatch({
  conversationIds: ['first', 'scope-switch', 'never-started'],
  clearConversation: async (conversationId) => {
    abortedCalls.push(conversationId);
    return conversationId === 'scope-switch'
      ? { state: 'scope_changed' }
      : { state: 'succeeded', releasedBytes: 25n };
  },
  onProgress: (value) => abortedProgress.push(value),
});

assert.deepEqual(abortedCalls, ['first', 'scope-switch']);
assert.equal(aborted.status, 'scope_changed');
assert.deepEqual(aborted.succeededIds, ['first']);
assert.deepEqual(aborted.failedIds, []);
assert.deepEqual(aborted.remainingIds, ['scope-switch', 'never-started']);
assert.equal(aborted.completedCount, 1);
assert.equal(aborted.releasedBytes, 25n);
assert.deepEqual(abortedProgress, [
  { completedCount: 1, totalCount: 3, conversationId: 'first' },
]);
