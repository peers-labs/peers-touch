import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEV_SERVER_KIND,
  PeersDevError,
  buildServerIdentity,
  buildServerFreshness,
  createDevHttpServer,
  ensureDevServer,
  probeDevServer,
  runCli,
} from './index.mjs';

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

function identity(port, workspaceId = '0123456789abcdef') {
  return {
    kind: DEV_SERVER_KIND,
    endpoint: `http://127.0.0.1:${port}`,
    startedAt: '2026-09-17T00:00:00.000Z',
    source: {
      workspaceId,
      branch: 'feat/peers-dev',
      head: '1'.repeat(40),
      dirty: false,
      workspaceDigest: 'clean',
    },
  };
}

function request(port, method, pathname) {
  return new Promise((resolve, reject) => {
    const call = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.once('end', () => {
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    call.once('error', reject);
    call.end();
  });
}

test('concurrent starts produce one server and one compatible reuse', async () => {
  const envRepo = mkdtempSync(path.join(tmpdir(), 'peers-dev-env-'));
  const port = await freePort();
  const firstIdentity = identity(port, '1111111111111111');
  const secondIdentity = identity(port, '2222222222222222');
  let started;
  try {
    const results = await Promise.all([
      ensureDevServer({ envRepo, port, identity: firstIdentity }),
      ensureDevServer({ envRepo, port, identity: secondIdentity }),
    ]);
    assert.deepEqual(
      results.map((result) => result.state).sort(),
      ['existing', 'started'],
    );
    started = results.find((result) => result.state === 'started');
    const existing = results.find((result) => result.state === 'existing');
    assert.equal(
      existing.identity.source.workspaceId,
      started.identity.source.workspaceId,
    );
    const probe = await probeDevServer({ port });
    assert.equal(probe.state, 'compatible');
    assert.equal(
      probe.server.source.workspaceId,
      started.identity.source.workspaceId,
    );
  } finally {
    if (started?.server) await close(started.server);
    rmSync(envRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('server identity distinguishes clean and dirty source', () => {
  const sourceRoot = mkdtempSync(path.join(tmpdir(), 'peers-dev-source-'));
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: sourceRoot });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], {
      cwd: sourceRoot,
    });
    execFileSync('git', ['config', 'user.name', 'Peers Dev Test'], {
      cwd: sourceRoot,
    });
    writeFileSync(path.join(sourceRoot, 'README.md'), 'fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: sourceRoot });
    execFileSync('git', ['commit', '-m', 'test: initialize'], {
      cwd: sourceRoot,
    });
    assert.equal(buildServerIdentity({ sourceRoot }).source.dirty, false);
    writeFileSync(path.join(sourceRoot, 'dirty.txt'), 'dirty\n');
    assert.equal(buildServerIdentity({ sourceRoot }).source.dirty, true);
  } finally {
    rmSync(sourceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('server freshness requires restart after source identity changes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'peers-dev-freshness-'));
  try {
    execFileSync('git', ['init', '-b', 'feature/dev-ui'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Peers Dev Test'], { cwd: root });
    execFileSync(
      'git',
      ['config', 'user.email', 'peers-dev@test.invalid'],
      { cwd: root },
    );
    writeFileSync(path.join(root, 'README.md'), 'fresh\n');
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'test: initialize source'], {
      cwd: root,
    });
    const server = buildServerIdentity({
      sourceRoot: root,
      port: 4177,
      startedAt: new Date('2026-09-23T01:00:00.000Z'),
    });
    assert.equal(
      buildServerFreshness(server, {
        sourceRoot: root,
        now: new Date('2026-09-23T01:00:01.000Z'),
      }).state,
      'current',
    );
    writeFileSync(path.join(root, 'README.md'), 'dirty\n');
    const freshness = buildServerFreshness(server, {
      sourceRoot: root,
      now: new Date('2026-09-23T01:00:02.000Z'),
    });
    assert.equal(freshness.state, 'restart-required');
    assert.equal(freshness.currentSource.dirty, true);
    const dirtyServer = buildServerIdentity({ sourceRoot: root });
    writeFileSync(path.join(root, 'README.md'), 'dirty again\n');
    assert.equal(
      buildServerFreshness(dirtyServer, {
        sourceRoot: root,
        now: new Date('2026-09-23T01:00:03.000Z'),
      }).state,
      'restart-required',
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('compatible launch is idempotent and HTTP surface is read-only', async () => {
  const envRepo = mkdtempSync(path.join(tmpdir(), 'peers-dev-env-'));
  const port = await freePort();
  let started;
  try {
    started = await ensureDevServer({
      envRepo,
      port,
      identity: identity(port),
      buildSnapshot: async ({ server }) => ({
        kind: 'peers-touch-dev-snapshot',
        server,
      }),
    });
    const reused = await ensureDevServer({
      envRepo,
      port,
      identity: identity(port, 'fedcba9876543210'),
    });
    assert.equal(started.state, 'started');
    assert.equal(reused.state, 'existing');
    assert.equal(
      reused.identity.source.workspaceId,
      started.identity.source.workspaceId,
    );

    const serverResponse = await request(port, 'GET', '/api/server');
    assert.equal(serverResponse.status, 200);
    assert.equal(JSON.parse(serverResponse.body).kind, DEV_SERVER_KIND);
    const statusResponse = await request(port, 'GET', '/api/status');
    assert.equal(statusResponse.status, 200);
    assert.equal(
      JSON.parse(statusResponse.body).server.source.workspaceId,
      started.identity.source.workspaceId,
    );
    assert.equal((await request(port, 'POST', '/api/status')).status, 405);
  } finally {
    if (started?.server) await close(started.server);
    rmSync(envRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('identity probe stays responsive while a status snapshot is pending', async () => {
  const envRepo = mkdtempSync(path.join(tmpdir(), 'peers-dev-env-'));
  const port = await freePort();
  let releaseSnapshot;
  let markSnapshotStarted;
  const snapshotStarted = new Promise((resolve) => {
    markSnapshotStarted = resolve;
  });
  const snapshotPending = new Promise((resolve) => {
    releaseSnapshot = resolve;
  });
  const server = createDevHttpServer({
    envRepo,
    identity: identity(port),
    buildSnapshot() {
      markSnapshotStarted();
      return snapshotPending;
    },
  });
  try {
    await listen(server, port);
    const statusRequest = request(port, 'GET', '/api/status');
    await snapshotStarted;

    const probe = await probeDevServer({ port, timeoutMs: 200 });
    assert.equal(probe.state, 'compatible');

    releaseSnapshot({
      kind: 'peers-touch-dev-snapshot',
    });
    assert.equal((await statusRequest).status, 200);
  } finally {
    await close(server);
    rmSync(envRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('status failures do not expose internal paths', async () => {
  const envRepo = mkdtempSync(path.join(tmpdir(), 'peers-dev-env-'));
  const port = await freePort();
  const server = createDevHttpServer({
    envRepo,
    identity: identity(port),
    buildSnapshot() {
      throw new PeersDevError(
        'DEV_STATUS_UNAVAILABLE',
        '/Users/private/control-plane-state',
      );
    },
  });
  try {
    await listen(server, port);
    const response = await request(port, 'GET', '/api/status');
    assert.equal(response.status, 503);
    assert.equal(response.body.includes('/Users/private'), false);
    assert.deepEqual(JSON.parse(response.body), {
      error: 'DEV_STATUS_UNAVAILABLE',
      message: 'Development status is unavailable',
    });
  } finally {
    await close(server);
    rmSync(envRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('foreign listener fails closed without being replaced', async () => {
  const envRepo = mkdtempSync(path.join(tmpdir(), 'peers-dev-env-'));
  const foreign = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"kind":"not-peers-dev"}\n');
  });
  const port = await listen(foreign);
  try {
    await assert.rejects(
      ensureDevServer({ envRepo, port, identity: identity(port) }),
      (error) => {
        assert.ok(error instanceof PeersDevError);
        assert.equal(error.code, 'DEV_SERVER_PORT_CONFLICT');
        assert.match(error.message, new RegExp(`:${port}$`));
        return true;
      },
    );
    assert.equal((await request(port, 'GET', '/')).status, 200);
  } finally {
    await close(foreign);
    rmSync(envRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('incomplete Peers Dev identity is treated as a foreign listener', async () => {
  const envRepo = mkdtempSync(path.join(tmpdir(), 'peers-dev-env-'));
  const foreign = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      `${JSON.stringify({
        kind: DEV_SERVER_KIND,
      })}\n`,
    );
  });
  const port = await listen(foreign);
  try {
    const probe = await probeDevServer({ port });
    assert.equal(probe.state, 'foreign');
    await assert.rejects(
      ensureDevServer({ envRepo, port, identity: identity(port) }),
      (error) => {
        assert.ok(error instanceof PeersDevError);
        assert.equal(error.code, 'DEV_SERVER_PORT_CONFLICT');
        return true;
      },
    );
  } finally {
    await close(foreign);
    rmSync(envRepo, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('versioned Peers Dev identity is rejected as a foreign listener', async () => {
  let port;
  const foreign = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      `${JSON.stringify({
        ...identity(port),
        schemaVersion: 1,
        protocolVersion: 2,
      })}\n`,
    );
  });
  port = await listen(foreign);
  try {
    const probe = await probeDevServer({ port });
    assert.equal(probe.state, 'foreign');
  } finally {
    await close(foreign);
  }
});

test('public CLI rejects host and port overrides', async () => {
  await assert.rejects(
    runCli(['serve', '--port', '9999']),
    (error) => {
      assert.ok(error instanceof PeersDevError);
      assert.equal(error.code, 'DEV_SERVER_ARGUMENT_INVALID');
      return true;
    },
  );
});

test('browser renderer consumes split work and environment state', () => {
  const app = readFileSync(
    fileURLToPath(new URL('../web/app.js', import.meta.url)),
    'utf8',
  );
  assert.match(app, /item\.workState/);
  assert.match(app, /item\.environmentHealth\.state/);
  assert.match(app, /item\.freshness\.state/);
  assert.match(app, /item\.workflow/);
  assert.match(app, /item\.agentActivity/);
  assert.match(app, /projected\.completedAfter/);
  assert.match(app, /projected\.percentageAfter/);
  assert.match(app, /new EventSource\('\/api\/events'\)/);
  assert.match(app, /schedulePoll/);
  assert.doesNotMatch(app, /item\.issues/);
});

function readFirstSnapshotEvent(port) {
  return new Promise((resolve, reject) => {
    const call = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: '/api/events',
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          const match = body.match(/event: snapshot\ndata: ([^\n]+)\n\n/);
          if (!match) return;
          resolve({
            status: response.statusCode,
            contentType: response.headers['content-type'],
            snapshot: JSON.parse(match[1]),
          });
          response.destroy();
        });
      },
    );
    call.once('error', reject);
    call.end();
  });
}

test('SSE endpoint streams the complete canonical snapshot contract', async () => {
  const envRepo = mkdtempSync(path.join(tmpdir(), 'peers-dev-env-'));
  const port = await freePort();
  const expected = {
    kind: 'peers-touch-dev-snapshot',
    observedAt: '2026-09-26T00:00:00.000Z',
    digest: 'a'.repeat(64),
    serverFreshness: {
      state: 'current',
      checkedAt: '2026-09-26T00:00:00.000Z',
    },
    worktrees: [],
  };
  const server = createDevHttpServer({
    envRepo,
    identity: identity(port),
    buildSnapshot: async () => expected,
  });
  try {
    await listen(server, port);
    const event = await readFirstSnapshotEvent(port);
    assert.equal(event.status, 200);
    assert.match(event.contentType, /^text\/event-stream/);
    assert.equal(event.snapshot.kind, expected.kind);
    assert.equal(event.snapshot.digest, expected.digest);
    assert.equal(event.snapshot.serverFreshness.state, 'current');
    assert.equal(event.snapshot.stream.state, 'live');
  } finally {
    await close(server);
    rmSync(envRepo, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});
