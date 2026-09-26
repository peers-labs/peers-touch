#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import {
  isDirectInvocation,
  repoRoot,
} from '../../../tooling/scripts/lib/machine-dev-paths.mjs';
import { inspectGitWorkspace } from '../../../tooling/scripts/local-dev/git-workspace.mjs';
import { buildDevSnapshot } from './status.mjs';

export const DEV_SERVER_KIND = 'peers-touch-dev-server';
export const DEV_SERVER_HOST = '127.0.0.1';
export const DEV_SERVER_PORT = 4177;

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ASSETS_ROOT = path.join(APP_ROOT, 'web');
const ASSET_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const PROBE_BODY_LIMIT = 64 * 1024;

export class PeersDevError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'PeersDevError';
    this.code = code;
    this.detail = detail;
  }
}

function parseArguments(argv) {
  const [action = 'serve', ...rest] = argv;
  const options = {};
  const allowed = new Set(['env-repo', 'home']);
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--') || !allowed.has(token.slice(2))) {
      throw new PeersDevError(
        'DEV_SERVER_ARGUMENT_INVALID',
        `unsupported argument: ${token}`,
      );
    }
    const key = token.slice(2);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new PeersDevError(
        'DEV_SERVER_ARGUMENT_INVALID',
        `missing value for --${key}`,
      );
    }
    options[key] = value;
    index += 1;
  }
  return { action, options };
}

export function buildServerIdentity(options = {}) {
  const sourceRoot = realpathSync(options.sourceRoot ?? repoRoot);
  const host = options.host ?? DEV_SERVER_HOST;
  const port = options.port ?? DEV_SERVER_PORT;
  let source;
  try {
    source = (options.inspectGitWorkspace ?? inspectGitWorkspace)(sourceRoot);
  } catch (error) {
    throw new PeersDevError(
      'DEV_SERVER_SOURCE_IDENTITY_UNAVAILABLE',
      'cannot resolve Peers Dev source identity',
      { cause: error?.stderr?.toString().trim() || error.message },
    );
  }
  return {
    kind: DEV_SERVER_KIND,
    endpoint: `http://${host}:${port}`,
    startedAt: (options.startedAt ?? new Date()).toISOString(),
    source: {
      workspaceId: source.workspaceId,
      branch: source.branch,
      head: source.commit,
      dirty: !source.clean,
      sourceDigest: source.workspaceDigest,
    },
  };
}

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function buildDevSnapshotAsync(options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./status-worker.mjs', import.meta.url), {
      workerData: options,
    });
    let settled = false;
    worker.once('message', (message) => {
      settled = true;
      if (message.ok) {
        resolve(message.snapshot);
        return;
      }
      reject(
        new PeersDevError(
          message.error.code,
          message.error.message,
        ),
      );
    });
    worker.once('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.once('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(
          new PeersDevError(
            'DEV_STATUS_UNAVAILABLE',
            'Development status is unavailable',
            { workerExitCode: code },
          ),
        );
      }
    });
  });
}

export function createDevHttpServer(options) {
  const envRepo = realpathSync(options.envRepo);
  const assetsRoot = realpathSync(options.assetsRoot ?? DEFAULT_ASSETS_ROOT);
  const identity = options.identity;
  const buildSnapshot = options.buildSnapshot ?? buildDevSnapshotAsync;

  return createServer(async (request, response) => {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    const pathname = new URL(request.url, identity.endpoint).pathname;
    if (pathname === '/api/server') {
      sendJson(response, 200, identity);
      return;
    }
    if (pathname === '/api/status') {
      try {
        sendJson(
          response,
          200,
          await buildSnapshot({
            home: options.home,
            envRepo,
            server: identity,
          }),
        );
      } catch (error) {
        sendJson(response, 503, {
          error: error.code ?? 'DEV_STATUS_UNAVAILABLE',
          message: 'Development status is unavailable',
        });
      }
      return;
    }
    const asset = ASSET_FILES.get(pathname);
    if (!asset) {
      sendJson(response, 404, { error: 'NOT_FOUND' });
      return;
    }
    const [fileName, contentType] = asset;
    const file = path.join(assetsRoot, fileName);
    if (!existsSync(file)) {
      sendJson(response, 503, { error: 'DEV_ASSET_MISSING' });
      return;
    }
    const body = readFileSync(file);
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
      'Content-Length': body.length,
    });
    response.end(body);
  });
}

function requestServerIdentity(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const request = httpRequest(
      {
        host,
        port,
        path: '/api/server',
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      (response) => {
        const chunks = [];
        let length = 0;
        response.on('data', (chunk) => {
          length += chunk.length;
          if (length > PROBE_BODY_LIMIT) {
            request.destroy(new Error('probe response exceeds byte limit'));
            return;
          }
          chunks.push(chunk);
        });
        response.once('end', () => {
          let payload = null;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            // A reachable non-Peers-Dev listener is a typed conflict below.
          }
          resolve({
            state: 'reachable',
            status: response.statusCode,
            payload,
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('probe timeout'));
    });
    request.once('error', (error) => {
      if (['ECONNREFUSED', 'EHOSTUNREACH'].includes(error.code)) {
        resolve({ state: 'absent' });
        return;
      }
      resolve({
        state: 'reachable',
        status: null,
        payload: null,
        error: error.message,
      });
    });
    request.end();
  });
}

function compatibleIdentity(probe, host, port) {
  const payload = probe.payload;
  const source = payload?.source;
  const payloadKeys =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? Object.keys(payload).sort()
      : [];
  const sourceKeys =
    source !== null && typeof source === 'object' && !Array.isArray(source)
      ? Object.keys(source).sort()
      : [];
  return (
    probe.state === 'reachable' &&
    probe.status === 200 &&
    JSON.stringify(payloadKeys) ===
      JSON.stringify(['endpoint', 'kind', 'source', 'startedAt']) &&
    JSON.stringify(sourceKeys) ===
      JSON.stringify([
        'branch',
        'dirty',
        'head',
        'sourceDigest',
        'workspaceId',
      ]) &&
    payload.kind === DEV_SERVER_KIND &&
    payload.endpoint === `http://${host}:${port}` &&
    typeof source?.workspaceId === 'string' &&
    source.workspaceId.length > 0 &&
    typeof source.branch === 'string' &&
    source.branch.length > 0 &&
    typeof source.head === 'string' &&
    /^[0-9a-f]{40}$/.test(source.head) &&
    typeof source.dirty === 'boolean' &&
    typeof source.sourceDigest === 'string' &&
    /^(?:clean|sha256:[0-9a-f]{64})$/.test(source.sourceDigest)
  );
}

function sameServerSource(actual, expected) {
  return ['workspaceId', 'branch', 'head', 'dirty', 'sourceDigest'].every(
    (field) => actual?.[field] === expected?.[field],
  );
}

export async function probeDevServer(options = {}) {
  const host = options.host ?? DEV_SERVER_HOST;
  const port = options.port ?? DEV_SERVER_PORT;
  const probe = await requestServerIdentity(
    host,
    port,
    options.timeoutMs ?? 500,
  );
  if (probe.state === 'absent') return probe;
  if (compatibleIdentity(probe, host, port)) {
    return { state: 'compatible', server: probe.payload };
  }
  return {
    state: 'foreign',
    status: probe.status ?? null,
    error: probe.error ?? null,
  };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function portConflict(probe, host, port) {
  return new PeersDevError(
    'DEV_SERVER_PORT_CONFLICT',
    `another process owns http://${host}:${port}`,
    { probe },
  );
}

async function probeAfterBindRace(options) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const probe = await probeDevServer(options);
    if (probe.state !== 'absent') return probe;
    await delay(50);
  }
  return { state: 'absent' };
}

export async function ensureDevServer(options = {}) {
  const host = options.host ?? DEV_SERVER_HOST;
  const port = options.port ?? DEV_SERVER_PORT;
  const endpoint = `http://${host}:${port}`;
  const identity =
    options.identity ??
    buildServerIdentity({
      sourceRoot: options.sourceRoot,
      host,
      port,
    });
  const initialProbe = await probeDevServer({ host, port });
  if (initialProbe.state === 'compatible') {
    if (!sameServerSource(initialProbe.server.source, identity.source)) {
      throw new PeersDevError(
        'DEV_SERVER_SOURCE_MISMATCH',
        'running Peers Dev does not match the requested source',
        {
          expected: identity.source,
          actual: initialProbe.server.source,
        },
      );
    }
    return {
      state: 'existing',
      endpoint,
      identity: initialProbe.server,
      server: null,
    };
  }
  if (initialProbe.state === 'foreign') {
    throw portConflict(initialProbe, host, port);
  }

  const server = createDevHttpServer({
    ...options,
    identity,
  });
  try {
    await listen(server, host, port);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') {
      throw new PeersDevError(
        'DEV_SERVER_START_FAILED',
        `cannot listen on ${endpoint}`,
        { cause: error.message },
      );
    }
    const raceProbe = await probeAfterBindRace({ host, port });
    if (raceProbe.state === 'compatible') {
      if (!sameServerSource(raceProbe.server.source, identity.source)) {
        throw new PeersDevError(
          'DEV_SERVER_SOURCE_MISMATCH',
          'racing Peers Dev does not match the requested source',
          {
            expected: identity.source,
            actual: raceProbe.server.source,
          },
        );
      }
      return {
        state: 'existing',
        endpoint,
        identity: raceProbe.server,
        server: null,
      };
    }
    throw portConflict(raceProbe, host, port);
  }
  return { state: 'started', endpoint, identity, server };
}

export async function runCli(argv) {
  const { action, options } = parseArguments(argv);
  const envRepo = options['env-repo'] ?? path.resolve(repoRoot, '..', 'env');
  if (action === 'snapshot') {
    process.stdout.write(
      `${JSON.stringify(
        await buildDevSnapshot({
          envRepo,
          home: options.home,
          server: null,
        }),
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (action === 'serve') {
    const result = await ensureDevServer({
      envRepo,
      home: options.home,
    });
    const source = result.identity.source;
    if (result.state === 'existing') {
      process.stdout.write(
        `Peers Dev already running: ${result.endpoint} ` +
          `(${source.branch}@${source.head.slice(0, 8)}, ` +
          `${source.workspaceId})\n`,
      );
      return;
    }
    process.stdout.write(
      `Peers Dev: ${result.endpoint} ` +
        `(${source.branch}@${source.head.slice(0, 8)}, ` +
        `${source.workspaceId})\n`,
    );
    return;
  }
  throw new PeersDevError(
    'DEV_SERVER_ARGUMENT_INVALID',
    'action must be snapshot or serve',
  );
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'BLOCKED',
        code: error.code ?? 'DEV_SERVER_FAILED',
        message: error.message,
        detail: error.detail ?? {},
      })}\n`,
    );
    process.exitCode = 1;
  }
}
