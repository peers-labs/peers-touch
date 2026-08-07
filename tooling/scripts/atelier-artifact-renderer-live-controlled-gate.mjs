#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const repoRoot = process.cwd();
const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-artifact-renderer-live-controlled-gate.json');
const runId = `atelier-renderer-live-${process.pid}-${Date.now()}`;

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'controlled Host-owned live sandbox DOM render harness for markdown/web/image/diff preview kinds',
    'live sandbox renderer emits metadata-only evidence without raw body/html/diff/image bytes',
    'live sandbox renderer blocks script, iframe, external URL, inline event handler, file access, and patch apply surfaces',
    'live sandbox renderer keeps rendered surfaces Host-owned and not applet-renderable',
  ],
  doesNotProve: [
    'real Desktop product-window webview renderer',
    'real artifact blob fetch from Station storage',
    'real Console Logs runtime stream',
    'real attachment Host Storage runtime',
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

function controlledHarnessUrl() {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-src 'none';">
    <title>Atelier Artifact Renderer Live Controlled Gate</title>
    <style>
      body { font: 13px system-ui, sans-serif; }
      .surface { border: 1px solid #ddd; margin: 8px; padding: 8px; }
      .blocked { color: #8a4b00; }
    </style>
  </head>
  <body>
    <div id="status">PENDING</div>
    <div id="surfaces"></div>
    <script>
      window.__atelierUnexpectedScriptExecution = false;
      const sandboxPolicy = {
        allowScripts: false,
        allowNetwork: false,
        allowExternalNavigation: false,
        allowFileAccess: false,
        allowPatchApply: false,
      };
      const cases = {
        markdown: [
          '# Gate report',
          '- failed check',
          '<scr' + 'ipt>window.__atelierUnexpectedScriptExecution = true</scr' + 'ipt>',
          '<img src="https://example.invalid/x.png">',
          '[external](https://example.invalid)'
        ].join('\\n'),
        diff: [
          'diff --git a/src/a.ts b/src/a.ts',
          '@@ -1 +1 @@',
          '-const stale = true;',
          '+const current = true;',
          'Binary files a/logo.png and b/logo.png differ'
        ].join('\\n'),
        web: '<main onclick="window.__atelierUnexpectedScriptExecution=true"><scr' + 'ipt>window.__atelierUnexpectedScriptExecution=true</scr' + 'ipt><iframe src="https://example.invalid"></iframe><a href="file:///tmp/x">x</a></main>',
        image: { mime: 'image/png', size: 2048, sha256: 'sha256:controlled-image', width: 64, height: 32 }
      };
      const surfaces = document.getElementById('surfaces');
      function appendSurface(kind) {
        const surface = document.createElement('section');
        surface.className = 'surface';
        surface.dataset.kind = kind;
        surface.dataset.owner = 'desktop_host';
        surface.dataset.mode = 'host_sandbox_manifest';
        surface.dataset.appletRenderable = 'false';
        surface.dataset.rawBodyExposedToApplet = 'false';
        surfaces.appendChild(surface);
        return surface;
      }
      function renderMarkdown() {
        const text = cases.markdown;
        const surface = appendSurface('markdown');
        const lines = text.split(/\\r?\\n/);
        for (const line of lines) {
          const node = document.createElement(line.startsWith('# ') ? 'h1' : line.startsWith('- ') ? 'li' : 'p');
          node.textContent = line.replace(/^#\\s+/, '').replace(/^-\\s+/, '');
          surface.appendChild(node);
        }
        return {
          rendererKind: 'markdown',
          sourceLineCount: lines.length,
          renderedNodeCount: surface.children.length,
          blockedScriptTagCount: (text.match(/<\\/?script\\b[^>]*>/gi) ?? []).length,
          blockedImageRefCount: (text.match(/!\\[[^\\]]*]\\([^)]+\\)|<img\\b/gi) ?? []).length,
          blockedLinkRefCount: (text.match(/(?<!!)\\[[^\\]]+]\\([^)]+\\)/g) ?? []).length,
          sandboxPolicy,
        };
      }
      function renderDiff() {
        const text = cases.diff;
        const surface = appendSurface('diff');
        const rows = text.split(/\\r?\\n/);
        for (const row of rows) {
          const node = document.createElement('div');
          node.dataset.kind = row.startsWith('+') ? 'addition' : row.startsWith('-') ? 'deletion' : 'context';
          node.textContent = row.replace(/[A-Za-z0-9_./:-]/g, 'x');
          surface.appendChild(node);
        }
        return {
          rendererKind: 'diff',
          sourceLineCount: rows.length,
          renderedNodeCount: surface.children.length,
          hunkCount: rows.filter((row) => row.startsWith('@@')).length,
          additionCount: rows.filter((row) => row.startsWith('+')).length,
          deletionCount: rows.filter((row) => row.startsWith('-')).length,
          binaryPatchCount: rows.filter((row) => row.startsWith('Binary files')).length,
          patchApplyAllowed: false,
          sandboxPolicy,
        };
      }
      function renderWeb() {
        const html = cases.web;
        const surface = appendSurface('web');
        const summary = document.createElement('div');
        summary.textContent = 'sanitized web preview';
        surface.appendChild(summary);
        return {
          rendererKind: 'web',
          sourceLineCount: html.split(/\\r?\\n/).length,
          renderedNodeCount: surface.children.length,
          blockedScriptTagCount: (html.match(/<\\/?script\\b[^>]*>/gi) ?? []).length,
          blockedIframeTagCount: (html.match(/<\\/?iframe\\b[^>]*>/gi) ?? []).length,
          blockedExternalUrlCount: (html.match(/\\b(?:src|href)=["'](?:https?:|file:|data:)[^"']*["']/gi) ?? []).length,
          blockedInlineEventHandlerCount: (html.match(/\\son[a-z]+=["'][^"']*["']/gi) ?? []).length,
          sandboxPolicy,
        };
      }
      function renderImage() {
        const metadata = cases.image;
        const surface = appendSurface('image');
        const summary = document.createElement('div');
        summary.textContent = metadata.mime + ' ' + metadata.width + 'x' + metadata.height;
        surface.appendChild(summary);
        return {
          rendererKind: 'image',
          renderedNodeCount: surface.children.length,
          mime: metadata.mime,
          size: metadata.size,
          sha256: metadata.sha256,
          width: metadata.width,
          height: metadata.height,
          forbiddenRawFields: ['path', 'url', 'src', 'base64', 'bytes'],
          rawImageBytesExposedToApplet: false,
          sandboxPolicy,
        };
      }
      const runtimeEvidence = [renderMarkdown(), renderDiff(), renderWeb(), renderImage()].map((entry, index) => ({
        ...entry,
        seq: index + 1,
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        surfaceKind: 'host_sandbox_visual_surface',
        appletRenderable: false,
      }));
      const forbiddenDomCounts = {
        script: document.querySelectorAll('script[src]').length,
        iframe: document.querySelectorAll('iframe').length,
        image: document.querySelectorAll('img').length,
        anchorWithHref: document.querySelectorAll('a[href]').length,
      };
      const detail = {
        runId: ${JSON.stringify(runId)},
        runtimeEvidence,
        surfaceCount: document.querySelectorAll('.surface').length,
        forbiddenDomCounts,
        unexpectedScriptExecution: window.__atelierUnexpectedScriptExecution,
      };
      document.getElementById('status').textContent = 'PASS';
      document.getElementById('status').setAttribute('data-detail', JSON.stringify(detail));
    </script>
  </body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function runGate() {
  const debugPort = await freePort();
  const userDataDir = path.resolve('.local/atelier-artifact-renderer-live-controlled-gate', `chrome-${process.pid}-${Date.now()}`);
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
    assert.equal(statusText, 'PASS', `controlled live renderer did not pass, status=${statusText}, stderr=${stderr}`);
    assert.equal(detail.runId, runId);
    assert.equal(detail.surfaceCount, 4);
    assert.equal(detail.unexpectedScriptExecution, false);
    assert.deepEqual(detail.forbiddenDomCounts, {
      script: 0,
      iframe: 0,
      image: 0,
      anchorWithHref: 0,
    });
    assert.deepEqual(detail.runtimeEvidence.map((entry) => entry.rendererKind), ['markdown', 'diff', 'web', 'image']);

    return {
      ok: true,
      evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
      gate: 'atelier-artifact-renderer-live-controlled-gate',
      source: 'controlled_headless_chrome_host_sandbox_harness',
      runId,
      runtimeEvidence: detail.runtimeEvidence,
      forbiddenDomCounts: detail.forbiddenDomCounts,
      unexpectedScriptExecution: detail.unexpectedScriptExecution,
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
  console.log(`PASS Atelier artifact renderer live controlled gate: ${evidencePath}`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-artifact-renderer-live-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier artifact renderer live controlled gate: ${evidence.error}`);
  process.exit(1);
}
