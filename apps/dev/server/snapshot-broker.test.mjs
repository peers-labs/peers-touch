import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createSnapshotBroker } from './snapshot-broker.mjs';

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.chunks = [];
    this.destroyed = false;
    this.writableEnded = false;
    this.status = null;
    this.headers = null;
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  write(value) {
    this.chunks.push(String(value));
  }

  end() {
    this.writableEnded = true;
    this.emit('close');
  }

  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
}

function request() {
  return new EventEmitter();
}

function snapshot(digest = 'a'.repeat(64)) {
  return {
    kind: 'peers-touch-dev-snapshot',
    observedAt: '2026-09-26T00:00:00.000Z',
    digest,
    worktrees: [],
  };
}

test('coalesces concurrent snapshot builds', async () => {
  let builds = 0;
  let resolveBuild;
  const pending = new Promise((resolve) => {
    resolveBuild = resolve;
  });
  const broker = createSnapshotBroker({
    buildSnapshot: async () => {
      builds += 1;
      return pending;
    },
  });
  const first = broker.snapshot();
  const second = broker.snapshot();
  resolveBuild(snapshot());
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, secondResult);
  assert.equal(firstResult.stream.state, 'live');
  assert.match(firstResult.stream.lastSuccessAt, /^20/);
  assert.match(firstResult.stream.lastAttemptAt, /^20/);
  assert.equal(builds, 1);
  broker.close();
});

test('deduplicates unchanged SSE snapshots and enforces client capacity', async () => {
  const broker = createSnapshotBroker({
    buildSnapshot: async () => snapshot(),
    maximumClients: 1,
    intervalMs: 60_000,
    keepAliveMs: 60_000,
  });
  const firstRequest = request();
  const firstResponse = new FakeResponse();
  assert.equal(await broker.subscribe(firstRequest, firstResponse), true);
  assert.equal(
    firstResponse.chunks.filter((chunk) =>
      chunk.startsWith('event: snapshot'),
    ).length,
    1,
  );
  await broker.refresh();
  assert.equal(
    firstResponse.chunks.filter((chunk) =>
      chunk.startsWith('event: snapshot'),
    ).length,
    1,
  );
  assert.equal(await broker.subscribe(request(), new FakeResponse()), false);
  firstRequest.emit('aborted');
  broker.close();
});

test('preserves the last valid snapshot when refresh fails', async () => {
  let fail = false;
  const broker = createSnapshotBroker({
    buildSnapshot: async () => {
      if (fail) {
        const error = new Error('offline');
        error.code = 'OWNER_OFFLINE';
        throw error;
      }
      return snapshot();
    },
  });
  const initial = await broker.snapshot();
  assert.equal(initial.stream.state, 'live');
  fail = true;
  const stale = await broker.snapshot();
  assert.equal(stale.stream.state, 'stale');
  assert.equal(stale.stream.errorCode, 'OWNER_OFFLINE');
  assert.equal(stale.digest, initial.digest);
  broker.close();
});

test('rejects oversized snapshots before broadcast', async () => {
  const broker = createSnapshotBroker({
    buildSnapshot: async () => ({
      ...snapshot(),
      payload: 'x'.repeat(1024),
    }),
    maximumBytes: 256,
  });
  await assert.rejects(
    broker.snapshot(),
    (error) => error.code === 'DEV_SNAPSHOT_TOO_LARGE',
  );
  broker.close();
});

test('broadcasts recovery even when the owner digest is unchanged', async () => {
  let fail = false;
  const broker = createSnapshotBroker({
    buildSnapshot: async () => {
      if (fail) {
        const error = new Error('offline');
        error.code = 'OWNER_OFFLINE';
        throw error;
      }
      return snapshot();
    },
    intervalMs: 60_000,
    keepAliveMs: 60_000,
  });
  const response = new FakeResponse();
  const streamRequest = request();
  await broker.subscribe(streamRequest, response);
  fail = true;
  await broker.refresh();
  fail = false;
  await broker.refresh();
  const snapshots = response.chunks
    .filter((chunk) => chunk.startsWith('event: snapshot'))
    .map((chunk) => JSON.parse(chunk.match(/data: ([^\n]+)/)[1]));
  assert.deepEqual(
    snapshots.map((item) => item.stream.state),
    ['live', 'stale', 'live'],
  );
  streamRequest.emit('aborted');
  broker.close();
});
