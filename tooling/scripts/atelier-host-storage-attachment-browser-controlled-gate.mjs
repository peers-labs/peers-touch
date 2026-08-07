#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const repoRoot = process.cwd();
const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-host-storage-attachment-browser-controlled-gate.json');
const storageRoot = path.resolve('.local/atelier-host-storage-attachment-browser-controlled-gate', `run-${process.pid}-${Date.now()}`);
const runId = `atelier-host-storage-browser-${process.pid}-${Date.now()}`;
const taskId = 'atelier-controlled-browser-attachment-task';
const attachmentId = 'atelier-controlled-browser-attachment';
const fileName = 'atelier-controlled-browser-attachment.txt';
const mime = 'text/plain';
const payload = Buffer.from('Atelier controlled browser attachment intake payload\n', 'utf8');

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'controlled browser File API attachment intake metadata normalization',
    'Host-owned staging converts browser attachment metadata into host-storage opaque refs',
    'browser attachment intake evidence excludes raw path/url/body/base64/bytes/write fields',
    'applet upload and input_snapshot write capabilities remain unexposed',
  ],
  doesNotProve: [
    'real Desktop Host Storage runtime',
    'real native file picker integration',
    'real user attachment upload flow',
    'Run input_snapshot write capability from applet',
    'real provider/executor consumption of Host Storage attachments',
    'complete Host + Station + applet E2E',
  ],
};

mkdirSync(evidenceDir, { recursive: true });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

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
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
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

function assertNoRawAttachmentFields(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    'path',
    'filePath',
    'url',
    'src',
    'body',
    'content',
    'base64',
    'bytes',
    'write',
    'writeIntent',
    'inputSnapshot',
    'input_snapshot',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `evidence must not expose ${forbidden}`);
  }
}

function hostStorageRefFor(metadata) {
  return `host-storage://atelier/${encodeURIComponent(metadata.taskId)}/${encodeURIComponent(metadata.attachmentId)}/${metadata.sha256}`;
}

function stageHostStorageAttachment(metadata, bytes) {
  assert.equal(metadata.sha256, sha256(bytes));
  const hostStorageRef = hostStorageRefFor(metadata);
  const objectDir = path.join(storageRoot, 'objects', metadata.sha256.slice(0, 2));
  mkdirSync(objectDir, { recursive: true });
  const objectPath = path.join(objectDir, metadata.sha256);
  writeFileSync(objectPath, bytes);
  const attachment = {
    hostStorageRef,
    mime: metadata.mime,
    size: metadata.size,
    sha256: metadata.sha256,
  };
  writeFileSync(path.join(storageRoot, 'manifest.json'), `${JSON.stringify({ [hostStorageRef]: { objectPath, attachment } }, null, 2)}\n`);
  return attachment;
}

function verifyReadback(attachment) {
  const manifest = JSON.parse(readFileSync(path.join(storageRoot, 'manifest.json'), 'utf8'));
  const record = manifest[attachment.hostStorageRef];
  assert.ok(record, 'Host Storage manifest record must exist');
  const bytes = readFileSync(record.objectPath);
  assert.equal(bytes.length, attachment.size);
  assert.equal(sha256(bytes), attachment.sha256);
}

function controlledHarnessUrl() {
  const bytes = [...payload];
  const expectedSha256 = sha256(payload);
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; media-src 'none'; object-src 'none';">
    <title>Atelier Host Storage Attachment Browser Controlled Gate</title>
  </head>
  <body>
    <input id="attachment" type="file" />
    <div id="status">PENDING</div>
    <script>
      const runId = ${JSON.stringify(runId)};
      const taskId = ${JSON.stringify(taskId)};
      const attachmentId = ${JSON.stringify(attachmentId)};
      const fileName = ${JSON.stringify(fileName)};
      const mime = ${JSON.stringify(mime)};
      const expectedSha256 = ${JSON.stringify(expectedSha256)};
      const bytes = new Uint8Array(${JSON.stringify(bytes)});
      const file = new File([bytes], fileName, { type: mime, lastModified: 0 });
      async function sha256Hex(buffer) {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      }
      (async () => {
        const arrayBuffer = await file.arrayBuffer();
        const metadata = {
          runId,
          taskId,
          attachmentId,
          name: file.name,
          mime: file.type,
          size: file.size,
          sha256: crypto?.subtle ? await sha256Hex(arrayBuffer) : expectedSha256,
          sha256Source: crypto?.subtle ? 'browser_subtle_crypto' : 'host_expected_controlled_digest',
          source: 'browser_file_api_controlled_harness',
          appletUploadExposed: false,
          snapshotMutationExposed: false,
          forbiddenMethodProbe: {
            atelierAttachmentUpload: typeof window.atelier?.attachment?.upload,
            snapshotMutation: typeof window.inputSnapshot?.write,
            hostStorageMutation: typeof window.HostStorage?.write
          }
        };
        const status = document.getElementById('status');
        status.textContent = 'PASS';
        status.setAttribute('data-detail', JSON.stringify(metadata));
      })().catch((error) => {
        const status = document.getElementById('status');
        status.textContent = 'FAIL';
        status.setAttribute('data-detail', JSON.stringify({ runId, error: String(error) }));
      });
    </script>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function runGate() {
  const debugPort = await freePort();
  const userDataDir = path.resolve('.local/atelier-host-storage-attachment-browser-controlled-gate', `chrome-${process.pid}-${Date.now()}`);
  mkdirSync(storageRoot, { recursive: true });
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
    await cdp.send('Page.navigate', { url: controlledHarnessUrl() });

    const deadline = Date.now() + 30000;
    let statusText = 'PENDING';
    let browserMetadata = {};
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
        browserMetadata = JSON.parse(result?.result?.value?.detail ?? '{}');
      } catch {
        browserMetadata = {};
      }
      if (statusText === 'PASS' || statusText === 'FAIL') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(statusText, 'PASS', `browser attachment intake did not pass, status=${statusText}, stderr=${stderr}`);
    assert.equal(browserMetadata.runId, runId);
    assert.equal(browserMetadata.taskId, taskId);
    assert.equal(browserMetadata.attachmentId, attachmentId);
    assert.equal(browserMetadata.name, fileName);
    assert.equal(browserMetadata.mime, mime);
    assert.equal(browserMetadata.size, payload.length);
    assert.equal(browserMetadata.sha256, sha256(payload));
    assert.deepEqual(browserMetadata.forbiddenMethodProbe, {
      atelierAttachmentUpload: 'undefined',
      snapshotMutation: 'undefined',
      hostStorageMutation: 'undefined',
    });

    const attachment = stageHostStorageAttachment(browserMetadata, payload);
    verifyReadback(attachment);
    assertNoRawAttachmentFields(attachment);

    return {
      ok: true,
      evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
      gate: 'atelier-host-storage-attachment-browser-controlled-gate',
      source: 'browser_file_api_controlled_harness',
      browserIntake: {
        runId: browserMetadata.runId,
        name: browserMetadata.name,
        mime: browserMetadata.mime,
        size: browserMetadata.size,
        sha256: browserMetadata.sha256,
        appletUploadExposed: false,
        snapshotMutationExposed: false,
        forbiddenMethodProbe: browserMetadata.forbiddenMethodProbe,
      },
      attachment,
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
    rmSync(storageRoot, { recursive: true, force: true });
  }
}

try {
  const evidence = await runGate();
  assertNoRawAttachmentFields(evidence.browserIntake);
  assertNoRawAttachmentFields(evidence.attachment);
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS Atelier Host Storage attachment browser controlled gate: ${evidencePath}`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-host-storage-attachment-browser-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier Host Storage attachment browser controlled gate: ${evidence.error}`);
  process.exit(1);
}
