#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const repoRoot = process.cwd();
const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-runtime-log-stream-controlled-gate.json');
const streamId = `atelier-controlled-log-stream-${process.pid}-${Date.now()}`;
const expectedMessages = [
  { level: 'log', message: 'sandbox booted' },
  { level: 'warn', message: 'sandbox warning' },
  { level: 'error', message: 'sandbox error' },
];
const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'controlled Host sandbox CDP console capture normalization',
    'ordered log/warn/error evidence from a local sandbox harness',
  ],
  doesNotProve: [
    'real Run runtime stream',
    'real provider/executor lifecycle',
    'atelier.logs.subscribe applet capability',
    'runtime.logs.subscribe applet capability',
    'complete Host + Station + applet E2E',
  ],
};

mkdirSync(evidenceDir, { recursive: true });

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return 'google-chrome';
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('failed to allocate port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError instanceof Error ? lastError : new Error(`timed out waiting for ${url}`);
}

async function createPageTarget(debugPort, targetUrl) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
  if (!response.ok) {
    throw new Error(`Chrome DevTools failed to create page target: HTTP ${response.status}`);
  }
  return await response.json();
}

function cdpConnect(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 1;

    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId;
          nextId += 1;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveSend, rejectSend) => {
            pending.set(id, { resolve: resolveSend, reject: rejectSend });
          });
        },
        on(method, handler) {
          const handlers = listeners.get(method) ?? [];
          handlers.push(handler);
          listeners.set(method, handlers);
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method) {
        for (const handler of listeners.get(message.method) ?? []) {
          handler(message.params);
        }
      }
      if (!message.id || !pending.has(message.id)) return;
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        item.reject(new Error(message.error.message ?? 'Chrome DevTools command failed'));
        return;
      }
      item.resolve(message.result);
    });
    socket.addEventListener('error', () => reject(new Error('failed to connect to Chrome DevTools')));
  });
}

function controlledHarnessUrl() {
  const events = JSON.stringify(expectedMessages);
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Atelier Runtime Log Stream Controlled Gate</title></head>
  <body>
    <div id="status">PENDING</div>
    <script>
      const status = document.getElementById('status');
      const events = ${events};
      const streamId = ${JSON.stringify(streamId)};
      for (const event of events) {
        const payload = JSON.stringify({ streamId, level: event.level, message: event.message });
        console[event.level]('ATELIER_CONTROLLED_LOG ' + payload);
      }
      status.textContent = 'PASS';
      status.setAttribute('data-detail', JSON.stringify({ streamId, emitted: events.length }));
    </script>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function normalizeConsoleEntry(params, seq) {
  const raw = (params?.args ?? [])
    .map((arg) => arg.value ?? arg.description ?? '')
    .filter(Boolean)
    .join(' ');
  const marker = 'ATELIER_CONTROLLED_LOG ';
  if (!raw.startsWith(marker)) return null;
  const payload = JSON.parse(raw.slice(marker.length));
  const level = payload.level === 'warn' ? 'warn' : payload.level === 'error' ? 'error' : 'log';
  return {
    streamId: payload.streamId,
    seq,
    level,
    message: payload.message,
    source: 'host_sandbox_cdp',
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
  };
}

async function runGate() {
  const debugPort = await freePort();
  const userDataDir = path.resolve('.local/atelier-runtime-log-stream-controlled-gate', `chrome-${process.pid}-${Date.now()}`);
  mkdirSync(userDataDir, { recursive: true });
  const chromeExecutable = chromePath();
  assert.ok(existsSync(chromeExecutable) || chromeExecutable === 'google-chrome', `Chrome executable not found: ${chromeExecutable}`);
  const chrome = spawn(chromeExecutable, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`,
    'about:blank',
  ], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  const normalized = [];
  const exceptions = [];
  chrome.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  let cdp;
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, 10000);
    const page = await createPageTarget(debugPort, 'about:blank');
    cdp = await cdpConnect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    cdp.on('Runtime.consoleAPICalled', (params) => {
      const entry = normalizeConsoleEntry(params, normalized.length + 1);
      if (entry) normalized.push(entry);
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      exceptions.push({
        text: params?.exceptionDetails?.text,
        description: params?.exceptionDetails?.exception?.description,
      });
    });
    await cdp.send('Page.navigate', { url: controlledHarnessUrl() });

    const deadline = Date.now() + 30000;
    let statusText = 'PENDING';
    let detail = {};
    while (Date.now() < deadline) {
      const result = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const status = document.getElementById('status');
          return {
            text: status?.textContent ?? 'MISSING',
            detail: status?.getAttribute('data-detail') ?? '{}'
          };
        })()`,
        returnByValue: true,
      });
      statusText = result?.result?.value?.text ?? 'MISSING';
      try {
        detail = JSON.parse(result?.result?.value?.detail ?? '{}');
      } catch {
        detail = {};
      }
      if (statusText === 'PASS') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(statusText, 'PASS', `controlled sandbox did not pass, status=${statusText}`);
    assert.deepEqual(normalized.map(({ level, message }) => ({ level, message })), expectedMessages);
    assert.equal(detail.streamId, streamId);
    assert.deepEqual(exceptions, []);

    return {
      ok: true,
      evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
      gate: 'atelier-runtime-log-stream-controlled-gate',
      streamId,
      source: 'host_sandbox_cdp',
      normalized,
      claimBoundary,
      notCovered: claimBoundary.doesNotProve,
    };
  } finally {
    if (cdp) cdp.close();
    if (chrome.exitCode === null && !chrome.killed) {
      chrome.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (chrome.exitCode === null && !chrome.killed) chrome.kill('SIGKILL');
    }
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

try {
  const evidence = await runGate();
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`PASS Atelier runtime log stream controlled gate: ${evidencePath}\n`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-runtime-log-stream-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier runtime log stream controlled gate: ${evidence.error}`);
  process.exit(1);
}
