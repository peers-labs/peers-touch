// Standalone Node test for DefaultSessionManager.
//
// Imports from the package barrel (../dist/index.js). A fake SessionBackend
// records calls so we can assert delegation, and a spy logger proves the
// sessionId secret is never logged (AGENTS.md logging security).

import assert from 'node:assert/strict';

import { DefaultSessionManager } from '../dist/index.js';

// Fake backend recording every delegated call and its arguments.
function makeBackend() {
  const calls = [];
  return {
    calls,
    async createSession(appletId, instanceId) {
      calls.push({ op: 'create', appletId, instanceId });
      return 'session-secret-token';
    },
    async renewSession(sessionId) {
      calls.push({ op: 'renew', sessionId });
    },
    async destroySession(sessionId) {
      calls.push({ op: 'destroy', sessionId });
    },
  };
}

// Failing backend to exercise the error path.
function makeFailingBackend() {
  return {
    async createSession() {
      throw new Error('gateway unavailable');
    },
    async renewSession() {
      throw new Error('gateway unavailable');
    },
    async destroySession() {
      throw new Error('gateway unavailable');
    },
  };
}

// Spy logger accumulating every message + context for secret-leak assertions.
function makeLogger() {
  const entries = [];
  const push = (level) => (message, context) => entries.push({ level, message, context });
  return {
    entries,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  };
}

// create delegates to backend and returns its token.
{
  const backend = makeBackend();
  const logger = makeLogger();
  const manager = new DefaultSessionManager(backend, logger);

  const token = await manager.create('com.example.app', 'inst-1');
  assert.equal(token, 'session-secret-token');
  assert.deepEqual(backend.calls[0], { op: 'create', appletId: 'com.example.app', instanceId: 'inst-1' });

  // The sessionId secret must never appear in any log entry.
  const serialized = JSON.stringify(logger.entries);
  assert.ok(!serialized.includes('session-secret-token'));
}

// renew and destroy delegate to backend.
{
  const backend = makeBackend();
  const manager = new DefaultSessionManager(backend, makeLogger());

  await manager.renew('session-abc');
  await manager.destroy('session-abc');
  assert.deepEqual(backend.calls, [
    { op: 'renew', sessionId: 'session-abc' },
    { op: 'destroy', sessionId: 'session-abc' },
  ]);
}

// backend failures are logged as error and rethrown.
{
  const backend = makeFailingBackend();
  const logger = makeLogger();
  const manager = new DefaultSessionManager(backend, logger);

  await assert.rejects(() => manager.create('com.example.app', 'inst-1'), /gateway unavailable/);
  await assert.rejects(() => manager.renew('session-abc'), /gateway unavailable/);
  await assert.rejects(() => manager.destroy('session-abc'), /gateway unavailable/);
  assert.equal(logger.entries.filter((e) => e.level === 'error').length, 3);
}

process.stdout.write('PASS session-manager tests\n');
