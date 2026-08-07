#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { createServer } from 'vite';
import {
  appletArtifactPath,
  appletEvidenceRoot,
} from './lib/applet-readiness-paths.mjs';

const rootDir = process.cwd();
const packageDir = path.resolve('apps/desktop/applets-dist/peers.note');
const manifest = JSON.parse(readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
const bundleEntry = manifest.load?.desktop?.entry;
const artifactDir = appletArtifactPath('official-applet', 'note-desktop-live-smoke');
const harnessHtmlPath = path.join(artifactDir, 'index.html');
const harnessJsPath = path.join(artifactDir, 'harness.js');
const rawOutputPath = path.join(artifactDir, 'report.json');
const reviewedOutputPath = path.join(
  appletEvidenceRoot,
  'official-applet',
  'note-desktop-live-smoke.json',
);
const staticHits = [];

if (manifest.id !== 'peers.note') {
  throw new Error('Note Desktop live smoke requires apps/desktop/applets-dist/peers.note/manifest.json');
}
if (!bundleEntry) {
  throw new Error('Note Desktop live smoke requires manifest.load.desktop.entry');
}
readFileSync(path.join(packageDir, bundleEntry));

mkdirSync(artifactDir, { recursive: true });
mkdirSync(path.dirname(reviewedOutputPath), { recursive: true });

writeFileSync(harnessHtmlPath, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Note Desktop Live Smoke</title>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
  </head>
  <body>
    <div id="status">PENDING</div>
    <div id="mount" style="width: 900px; height: 640px;"></div>
    <script type="module" src="./harness.js"></script>
  </body>
</html>
`);

writeFileSync(harnessJsPath, `const appletId = 'peers.note';
const bundleEntry = ${JSON.stringify(bundleEntry)};
const manifest = ${JSON.stringify(manifest)};
const status = document.getElementById('status');
const mount = document.getElementById('mount');
const invocations = [];
const hostEvents = [];
const networkRequests = [];
const storage = new Map();
let activeSessionId = '';
let mountedHost = null;

function setStatus(value, detail) {
  status.textContent = value;
  status.setAttribute('data-detail', JSON.stringify(detail ?? {}));
}

function ok(command, result) {
  return {
    ok: true,
    data: {
      command,
      status: JSON.stringify(result),
    },
  };
}

function responseFor(method, params) {
  switch (method) {
    case 'app.getContext':
      return { appletId, sessionId: activeSessionId, platform: 'desktop', runtime: 'lynx-web', bridgeProtocol: 'peers-touch.applet.bridge', launchParams: {} };
    case 'app.getLaunchOptions':
      return {};
    case 'lifecycle.reportReady':
    case 'telemetry.track':
      return { ok: true };
    case 'storage.get':
      return { value: storage.has(params?.key) ? storage.get(params.key) : null };
    case 'storage.set':
      storage.set(params?.key, params?.value ?? null);
      return { ok: true };
    case 'storage.remove':
      storage.delete(params?.key);
      return { ok: true };
    case 'network.request': {
      networkRequests.push(params ?? {});
      if (params?.service !== 'note') {
        throw new Error('Note live smoke expected service=note, got ' + String(params?.service));
      }
      if (params?.path !== '/v1/notes') {
        throw new Error('Note live smoke expected /v1/notes list request, got ' + String(params?.path));
      }
      return {
        status: 200,
        headers: { 'x-note-live-smoke': 'list' },
        body: {
          items: [{
            noteId: 'live-smoke-note',
            ownerId: 'desktop-live-smoke-actor',
            title: 'Live Smoke Note',
            content: 'Loaded through Desktop Lynx Host',
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          }],
          nextPageToken: '',
        },
      };
    }
    case 'lifecycle.destroy':
      return { ok: true };
    default:
      throw new Error('Unsupported Note live smoke method: ' + method);
  }
}

window.__TAURI_INTERNALS__ = {
  transformCallback: (callback) => {
    const id = crypto.randomUUID();
    if (callback) window['_' + id] = callback;
    return id;
  },
  convertFileSrc: (filePath) => filePath,
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  invoke: async (command, args = {}) => {
    const input = args?.input ?? {};
    invocations.push({ command, input });
    if (command === 'applets_create_session') {
      if (input.id !== appletId || input.manifest?.id !== appletId) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'manifest mismatch' } };
      }
      activeSessionId = 'note-live-smoke-session';
      return ok(command, { ok: true, appletId, sessionId: activeSessionId });
    }
    if (command === 'applets_invoke') {
      const method = String(input.capability ?? '') + (input.action ? '.' + input.action : '');
      return ok(command, responseFor(method, input.params ?? {}));
    }
    return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'unsupported command: ' + command } };
  },
};

window.addEventListener('error', (event) => {
  setStatus('FAIL', { error: event.message, invocations, hostEvents, networkRequests });
});

window.addEventListener('unhandledrejection', (event) => {
  setStatus('FAIL', { error: String(event.reason?.message ?? event.reason), invocations, hostEvents, networkRequests });
});

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function viewStateFor(host) {
  const view = host.querySelector('lynx-view');
  return {
    hostExists: Boolean(host),
    lynxViewExists: Boolean(view),
    shadowRoot: Boolean(view?.shadowRoot),
    shadowText: view?.shadowRoot?.textContent?.slice(0, 400) ?? '',
    pageExists: Boolean(view?.shadowRoot?.querySelector('[part="page"]')),
  };
}

function installLynxEventRecorder() {
  const LynxViewElement = customElements.get('lynx-view');
  const originalSendGlobalEvent = LynxViewElement.prototype.sendGlobalEvent;
  LynxViewElement.prototype.sendGlobalEvent = function(name, payload) {
    hostEvents.push({ name, payload });
    return originalSendGlobalEvent.call(this, name, payload);
  };
}

try {
  setStatus('IMPORTING_HOST');
  const [{ registerAppletElements }, { default: AppletManager }] = await Promise.all([
    import('/src/applet/register-elements.ts'),
    import('/src/applet/AppletManager.ts'),
  ]);
  registerAppletElements();
  await customElements.whenDefined('lynx-host');
  await customElements.whenDefined('lynx-view');
  installLynxEventRecorder();

  const manager = AppletManager.getInstance();
  const applets = await manager.scanApplets();
  if (!applets.some((applet) => applet.id === appletId)) {
    throw new Error('AppletManager did not discover peers.note');
  }
  await manager.loadApplet(appletId);
  const sessionId = manager.getSessionId(appletId);
  if (!sessionId) {
    throw new Error('AppletManager did not create peers.note session');
  }

  const host = document.createElement('lynx-host');
  mountedHost = host;
  host.setAttribute('applet-id', appletId);
  host.setAttribute('session-id', sessionId);
  host.setAttribute('url', '/applets-dist/' + appletId + '/' + bundleEntry);
  host.style.width = '900px';
  host.style.height = '640px';
  mount.appendChild(host);

  await waitUntil(() => {
    const state = viewStateFor(host);
    return state.pageExists ? state : null;
  }, 10000, 'Note live smoke did not mount a Lynx page');

  await waitUntil(() => invocations.some((item) => item.command === 'applets_invoke' && item.input.capability === 'lifecycle' && item.input.action === 'reportReady'), 10000, 'Note applet did not call lifecycle.reportReady through Host bridge');
  await waitUntil(() => invocations.some((item) => item.command === 'applets_invoke' && item.input.capability === 'telemetry' && item.input.action === 'track'), 10000, 'Note applet did not call telemetry.track through Host bridge');
  await waitUntil(() => networkRequests.some((request) => request.service === 'note' && request.path === '/v1/notes'), 10000, 'Note applet did not call network.request service=note through Host bridge');

  const showEvent = await waitUntil(() => hostEvents.some((event) => event.name === 'applet.event' && JSON.stringify(event.payload).includes('"topic":"show"')), 5000, 'Note Host did not send lifecycle.show after reportReady');
  if (!showEvent) {
    throw new Error('Note Host lifecycle.show evidence missing');
  }

  host.remove();
  await waitUntil(() => invocations.some((item) => item.command === 'applets_invoke' && item.input.capability === 'lifecycle' && item.input.action === 'destroy'), 5000, 'Note Host did not destroy the Gateway session on unmount');

  setStatus('PASS', {
    appletId,
    sessionId,
    viewState: viewStateFor(host),
    invocations,
    hostEvents,
    networkRequests,
  });
} catch (error) {
  setStatus('FAIL', {
    error: error instanceof Error ? error.message : String(error),
    viewState: mountedHost ? viewStateFor(mountedHost) : null,
    invocations,
    hostEvents,
    networkRequests,
  });
}
`);

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
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${url}`);
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
        send(method, params = {}, sessionId) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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
    socket.addEventListener('error', () => reject(new Error('Failed to connect to Chrome DevTools')));
  });
}

async function runChrome(harnessUrl) {
  const debugPort = await freePort();
  const userDataDir = path.join(artifactDir, `chrome-${process.pid}-${Date.now()}`);
  mkdirSync(userDataDir, { recursive: true });

  const chrome = spawn(chromePath(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let stderr = '';
  const diagnostics = {
    console: [],
    exceptions: [],
    networkFailures: [],
    responses: [],
  };
  chrome.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  let cdp;
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, 10000);
    const page = await createPageTarget(debugPort, 'about:blank');
    cdp = await cdpConnect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    cdp.on('Runtime.consoleAPICalled', (params) => {
      diagnostics.console.push({
        type: params?.type,
        args: (params?.args ?? []).map((arg) => arg.value ?? arg.description).filter(Boolean),
      });
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      diagnostics.exceptions.push({
        text: params?.exceptionDetails?.text,
        description: params?.exceptionDetails?.exception?.description,
      });
    });
    cdp.on('Network.loadingFailed', (params) => {
      diagnostics.networkFailures.push({
        requestId: params?.requestId,
        errorText: params?.errorText,
        type: params?.type,
      });
    });
    cdp.on('Network.responseReceived', (params) => {
      diagnostics.responses.push({
        url: params?.response?.url ?? '',
        status: params?.response?.status,
        mimeType: params?.response?.mimeType,
      });
      if (diagnostics.responses.length > 120) diagnostics.responses.shift();
    });
    await cdp.send('Page.navigate', { url: harnessUrl });

    const deadline = Date.now() + 60000;
    let statusText = 'PENDING';
    let detail = {};
    while (Date.now() < deadline) {
      const statusResult = await cdp.send('Runtime.evaluate', {
        expression: "document.getElementById('status')?.textContent ?? 'MISSING'",
        returnByValue: true,
      });
      statusText = statusResult.result?.value ?? 'MISSING';
      const detailResult = await cdp.send('Runtime.evaluate', {
        expression: "document.getElementById('status')?.getAttribute('data-detail') ?? '{}'",
        returnByValue: true,
      });
      try {
        detail = JSON.parse(detailResult.result?.value ?? '{}');
      } catch {
        detail = { raw: detailResult.result?.value };
      }
      if (statusText === 'PASS' || statusText === 'FAIL' || statusText === 'MISSING') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { statusText, detail: { ...detail, diagnostics }, stderr };
  } catch (error) {
    return {
      statusText: 'FAIL',
      detail: {
        error: error instanceof Error ? error.message : String(error),
        diagnostics,
      },
      stderr,
    };
  } finally {
    cdp?.close();
    chrome.kill('SIGTERM');
    setTimeout(() => {
      if (!chrome.killed) chrome.kill('SIGKILL');
    }, 1000).unref();
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function reviewedReport(rawReport) {
  const invocations = rawReport.detail?.invocations ?? [];
  const hostEvents = rawReport.detail?.hostEvents ?? [];
  const diagnostics = rawReport.detail?.diagnostics ?? {};
  const rawJson = `${JSON.stringify(rawReport, null, 2)}\n`;

  return {
    status: rawReport.status,
    evidenceClass: rawReport.evidenceClass,
    appletId: rawReport.appletId,
    packageDir: rawReport.packageDir,
    bundle: rawReport.bundle,
    artifactReport: path.relative(rootDir, rawOutputPath),
    artifactReportSha256: sha256(rawJson),
    detail: {
      sessionId: rawReport.detail?.sessionId ?? '',
      viewState: rawReport.detail?.viewState ?? null,
      invocationCount: invocations.length,
      invokedCapabilities: [
        ...new Set(
          invocations
            .filter((item) => item.command === 'applets_invoke')
            .map((item) => `${item.input?.capability}.${item.input?.action}`),
        ),
      ].sort(),
      hostEventTopics: [
        ...new Set(
          hostEvents.flatMap((item) =>
            (Array.isArray(item.payload) ? item.payload : [item.payload])
              .map((payload) => payload?.topic)
              .filter(Boolean),
          ),
        ),
      ].sort(),
      networkRequests: rawReport.detail?.networkRequests ?? [],
      diagnostics: {
        consoleCount: diagnostics.console?.length ?? 0,
        exceptionCount: diagnostics.exceptions?.length ?? 0,
        networkFailureCount: diagnostics.networkFailures?.length ?? 0,
        responseCount: diagnostics.responses?.length ?? 0,
      },
    },
    staticHitCounts: Object.fromEntries(
      Object.entries(
        rawReport.staticHits.reduce((counts, item) => {
          counts[item.kind] = (counts[item.kind] ?? 0) + 1;
          return counts;
        }, {}),
      ).sort(([left], [right]) => left.localeCompare(right)),
    ),
    chromeStderr: {
      bytes: Buffer.byteLength(rawReport.chromeStderr),
      sha256: sha256(rawReport.chromeStderr),
    },
  };
}

const vitePort = await freePort();
// Inherit the desktop product Vite config (apps/desktop/vite.config.ts) verbatim:
// do NOT add web-core/web-elements aliases here. Custom aliases let the same
// web-core entry resolve under multiple module ids, instantiating two
// `templateManager` singletons (double bundle fetch + double wasm allocator
// init) and breaking the lepus handoff. The smoke must exercise the real
// product resolution path; we only layer a static-asset middleware on top.
const server = await createServer({
  root: path.resolve('apps/desktop'),
  logLevel: 'silent',
  plugins: [{
    name: 'note-desktop-live-smoke-static',
    configureServer(viteServer) {
      viteServer.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname === '/applets-dist/index.json') {
          const body = JSON.stringify({
            version: 1,
            generatedAt: new Date(0).toISOString(),
            applets: [manifest],
          });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(body);
          return;
        }
        const appletPrefix = '/applets-dist/peers.note/';
        if (url.pathname.startsWith(appletPrefix)) {
          const relativePath = decodeURIComponent(url.pathname.slice(appletPrefix.length));
          if (!relativePath || relativePath.includes('..') || relativePath.includes('\\\\')) {
            res.statusCode = 400;
            res.end('invalid applet asset path');
            return;
          }
          try {
            const bytes = readFileSync(path.join(packageDir, relativePath));
            staticHits.push({ kind: relativePath.endsWith('.lynx.bundle') ? 'lynx.bundle' : 'applet.asset', path: relativePath, bytes: bytes.length });
            res.statusCode = 200;
            res.setHeader('Content-Type', relativePath.endsWith('.json') ? 'application/json' : 'application/octet-stream');
            res.setHeader('Content-Length', String(bytes.length));
            res.end(bytes);
          } catch {
            next();
          }
          return;
        }
        if (!url.pathname.endsWith('.wasm')) {
          next();
          return;
        }
        let wasmPath = '';
        if (url.pathname.startsWith('/@fs/')) {
          wasmPath = url.pathname.slice('/@fs/'.length);
        } else if (url.pathname.includes('client_legacy')) {
          wasmPath = path.resolve('apps/desktop/node_modules/@lynx-js/web-core/binary/client_legacy/client_bg.wasm');
        } else if (url.pathname.endsWith('/client_bg.wasm')) {
          wasmPath = path.resolve('apps/desktop/node_modules/@lynx-js/web-core/binary/client/client_bg.wasm');
        }
        if (!wasmPath) {
          next();
          return;
        }
        try {
          const bytes = readFileSync(wasmPath);
          staticHits.push({ kind: 'wasm', path: wasmPath, bytes: bytes.length });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/wasm');
          res.setHeader('Content-Length', String(bytes.length));
          res.end(bytes);
        } catch {
          next();
        }
      });
    },
  }],
  server: {
    host: '127.0.0.1',
    port: vitePort,
    strictPort: false,
    fs: { allow: [rootDir] },
  },
});

try {
  await server.listen();
  const baseUrl = server.resolvedUrls?.local?.[0];
  if (!baseUrl) throw new Error('Vite server did not expose a local URL');
  const harnessUrl = new URL(`/@fs/${harnessHtmlPath}`, baseUrl).toString();
  const chrome = await runChrome(harnessUrl);
  const report = {
    status: chrome.statusText === 'PASS' ? 'PASS' : 'FAIL',
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: 'peers.note',
    packageDir: path.relative(rootDir, packageDir),
    bundle: bundleEntry,
    harness: harnessUrl,
    detail: chrome.detail,
    staticHits,
    chromeStderr: chrome.stderr,
  };
  writeFileSync(rawOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  const reviewed = reviewedReport(report);
  writeFileSync(reviewedOutputPath, `${JSON.stringify(reviewed, null, 2)}\n`);
  if (report.status !== 'PASS') {
    process.stderr.write(`${JSON.stringify(reviewed, null, 2)}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(reviewed, null, 2)}\n`);
} finally {
  await server.close();
}
