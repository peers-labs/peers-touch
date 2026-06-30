#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { createServer } from 'vite';

const packageDir = path.resolve(process.argv[2] ?? 'applet-readiness-evidence/package/generic-complex-applet');
const productAppMode = process.argv.includes('--product-app');
const expectTextArg = process.argv.find((arg) => arg.startsWith('--expect-text='));
const expectText = expectTextArg ? expectTextArg.slice('--expect-text='.length) : '';
const rootDir = process.cwd();
const harnessDir = path.resolve('apps/desktop/.local/applet-runtime-gate');
const evidenceDir = path.resolve('applet-readiness-evidence/desktop/runtime-gate');
const harnessHtmlPath = path.join(harnessDir, 'index.html');
const harnessJsPath = path.join(harnessDir, 'harness.js');
const outputPath = path.resolve('applet-readiness-evidence/desktop/runtime-gate-output.txt');
const manifest = JSON.parse(readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
const bundleEntry = manifest.load?.desktop?.entry ?? manifest.entries?.lynx;
const bundlePath = bundleEntry ? path.join(packageDir, bundleEntry) : '';
const staticHits = [];

if (!bundleEntry || !bundlePath) {
  process.stderr.write('FAIL desktop runtime gate requires manifest.load.desktop.entry or entries.lynx\n');
  process.exit(1);
}
readFileSync(bundlePath);

mkdirSync(evidenceDir, { recursive: true });
mkdirSync(harnessDir, { recursive: true });

const bundleUrlPath = `/applets-dist/${manifest.id}/${bundleEntry}`;
const requiredMethods = [
  'app.getContext',
  'app.getLaunchOptions',
  'lifecycle.reportReady',
  'ui.setNavigationBar',
  'ui.showToast',
  'device.getSafeArea',
  'device.getWindowInfo',
  'device.vibrate',
  'clipboard.setText',
  'clipboard.getText',
  'file.write',
  'file.read',
  'file.list',
  'file.getInfo',
  'storage.set',
  'storage.keys',
  'storage.getInfo',
  'network.request',
  'network.upload',
  'network.download',
  'events.subscribe',
  'events.unsubscribe',
  'skills.register',
  'skills.list',
  'skills.invoke',
  'tasks.start',
  'agent.stream',
  'ai.chat',
  'telemetry.track',
];

writeFileSync(harnessHtmlPath, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Applet Desktop Runtime Gate</title>
  </head>
  <body>
    <div id="status">PENDING</div>
    <script type="module" src="./harness.js"></script>
  </body>
</html>
`);

writeFileSync(harnessJsPath, `const protocol = 'peers-touch.applet.bridge';
const appletId = ${JSON.stringify(manifest.id)};
const sessionId = 'desktop-runtime-gate-session';
const requiredMethods = ${JSON.stringify(requiredMethods)};
const productAppMode = ${JSON.stringify(productAppMode)};
const expectText = ${JSON.stringify(expectText)};
const status = document.getElementById('status');
const requests = [];
const hostEvents = [];
const storage = new Map();
const files = new Map();
const clipboard = { text: '' };
const eventSubscriptions = new Set();
const registeredSkills = new Map();
let taskCounter = 0;

function setStatus(value, detail) {
  status.textContent = value;
  status.setAttribute('data-detail', JSON.stringify(detail ?? {}));
}

setStatus('IMPORTING_LYNX_RUNTIME');

try {
  await import('@lynx-js/web-core/client');
  await customElements.whenDefined('lynx-view');
  await new Promise((resolve) => setTimeout(resolve, 500));
} catch (error) {
  setStatus('FAIL', { phase: 'import', error: error instanceof Error ? error.message : String(error) });
  throw error;
}

setStatus('MOUNTING_LYNX_VIEW');

function responseFor(method, params) {
  switch (method) {
    case 'app.getContext':
      return { appletId, sessionId, platform: 'desktop', runtime: 'lynx-web', bridgeProtocol: protocol, launchParams: {} };
    case 'app.getLaunchOptions':
      return {};
    case 'lifecycle.reportReady':
    case 'ui.setNavigationBar':
    case 'ui.showToast':
    case 'device.vibrate':
    case 'telemetry.track':
      return { ok: true };
    case 'events.subscribe':
      eventSubscriptions.add(String(params?.topic ?? ''));
      return { ok: true };
    case 'events.unsubscribe':
      eventSubscriptions.delete(String(params?.topic ?? ''));
      return { ok: true };
    case 'device.getSafeArea':
      return { top: 0, right: 0, bottom: 0, left: 0 };
    case 'device.getWindowInfo':
      return { width: 800, height: 600, pixelRatio: 1 };
    case 'clipboard.setText':
      clipboard.text = String(params?.text ?? '');
      return { ok: true };
    case 'clipboard.getText':
      return clipboard.text;
    case 'file.write':
      files.set(params?.path, params?.content ?? '');
      return { ok: true, path: params?.path, sizeBytes: String(params?.content ?? '').length };
    case 'file.read':
      return { path: params?.path, content: files.get(params?.path) ?? '' };
    case 'file.list':
      return Array.from(files.keys()).map((filePath) => ({ path: filePath, kind: 'file', sizeBytes: String(files.get(filePath) ?? '').length }));
    case 'file.getInfo':
      return { path: params?.path ?? '.', exists: true, kind: 'directory', sizeBytes: 0 };
    case 'storage.set':
      storage.set(params?.key, params?.value);
      return { ok: true };
    case 'storage.keys':
      return Array.from(storage.keys()).filter((key) => !params?.prefix || key.startsWith(params.prefix));
    case 'storage.getInfo':
      return { quotaBytes: 10485760, usedBytes: 128, keys: Array.from(storage.keys()) };
    case 'network.request':
      return { status: 200, headers: { 'x-applet-runtime-gate': 'network' }, body: { message: 'runtime-network-ok' } };
    case 'network.upload':
      return { status: 201, headers: { 'x-applet-runtime-gate': 'upload' }, body: { message: 'runtime-upload-ok' } };
    case 'network.download':
      return { filePath: params?.filePath ?? 'downloads/e2e.json', sizeBytes: 42, status: 200 };
    case 'skills.register':
      registeredSkills.set(params?.spec?.id, params?.spec);
      return { ok: true, skillId: params?.spec?.id ?? 'runtime-summary' };
    case 'skills.list':
      return Array.from(registeredSkills.values());
    case 'skills.invoke': {
      const skill = registeredSkills.get(params?.skillId);
      if (!skill) return { ok: false, skillId: params?.skillId, error: 'POLICY_DENIED' };
      const requestId = params?.options?.requestId ?? 'runtime-skill-request';
      const executorType = skill.executor?.type ?? 'runtime';
      const output = executorType === 'agent'
        ? { executor: 'agent', response: { requestId, message: { role: 'assistant', content: 'runtime-skill-agent-ok' } } }
        : { executor: executorType, status: 200, body: { message: 'runtime-skill-network-ok', input: params?.input } };
      if (params?.options?.stream && eventSubscriptions.has('skill.stream')) {
        const skillEvent = {
          protocol,
          kind: 'event',
          appletId,
          sessionId,
          requestId: 'runtime-skill-event',
          topic: 'skill.stream',
          payload: { skillId: params?.skillId, requestId, type: 'final', payload: output, sequence: 1 },
        };
        hostEvents.push(skillEvent);
        view.sendGlobalEvent('applet.event', [skillEvent]);
      }
      return { ok: true, skillId: params?.skillId, requestId, output };
    }
    case 'tasks.start':
      taskCounter += 1;
      return { taskId: 'runtime-task-' + taskCounter, requestId: 'runtime-task-request-' + taskCounter, state: 'completed', updatedAt: new Date(0).toISOString() };
    case 'agent.stream':
      return { requestId: 'runtime-agent-request', message: { id: 'runtime-agent-message', role: 'assistant', content: 'runtime-agent-ok' } };
    case 'ai.chat':
      return { requestId: 'runtime-ai-request', message: { role: 'assistant', content: 'runtime-ai-ok' }, model: 'runtime-model' };
    default:
      throw new Error('Unsupported runtime gate method: ' + method);
  }
}

window.addEventListener('error', (event) => {
  setStatus('FAIL', { error: event.message });
});

window.addEventListener('unhandledrejection', (event) => {
  setStatus('FAIL', { error: String(event.reason?.message ?? event.reason) });
});

const view = document.createElement('lynx-view');
view.globalProps = { appletId, sessionId, protocol };
view.onNativeModulesCall = (methodName, data, moduleName) => {
  const method = data?.method;
  requests.push({ moduleName, methodName, method });
  try {
    const result = responseFor(method, data?.params ?? {});
    if (method === 'lifecycle.reportReady') {
      const readyEvent = {
        protocol,
        kind: 'event',
        appletId,
        sessionId,
        requestId: 'runtime-lifecycle-ready',
        topic: 'ready',
        payload: { sessionId, state: 'active' },
      };
      const showEvent = {
        protocol,
        kind: 'event',
        appletId,
        sessionId,
        requestId: 'runtime-lifecycle-show',
        topic: 'show',
        payload: { sessionId, reason: 'runtime-visible' },
      };
      hostEvents.push(readyEvent, showEvent);
      view.sendGlobalEvent('applet.event', [readyEvent]);
      view.sendGlobalEvent('applet.event', [showEvent]);
    }
    if (method === 'tasks.start' && eventSubscriptions.has('task.event')) {
      const taskEvent = {
        protocol,
        kind: 'event',
        appletId,
        sessionId,
        requestId: 'runtime-task-event',
        topic: 'task.event',
        payload: {
          taskId: result.taskId,
          requestId: result.requestId,
          state: 'completed',
          sequence: 1,
        },
      };
      setTimeout(() => {
        hostEvents.push(taskEvent);
        view.sendGlobalEvent('applet.event', [taskEvent]);
      }, 50);
    }
    return {
      protocol,
      kind: 'response',
      appletId,
      sessionId,
      requestId: data?.requestId ?? 'runtime-gate-request',
      ok: true,
      result,
    };
  } catch (error) {
    return {
      protocol,
      kind: 'response',
      appletId,
      sessionId,
      requestId: data?.requestId ?? 'runtime-gate-request',
      ok: false,
      error: { code: 'CAPABILITY_FAILED', message: error instanceof Error ? error.message : String(error) },
    };
  }
};
view.style.width = '800px';
view.style.height = '600px';
document.body.appendChild(view);
view.url = ${JSON.stringify(bundleUrlPath)};

setTimeout(() => {
  const seen = new Set(requests.map((request) => request.method));
  const missing = requiredMethods.filter((method) => !seen.has(method));
  const viewState = {
    defined: Boolean(customElements.get('lynx-view')),
    constructorName: view.constructor?.name,
    url: view.url,
    attrUrl: view.getAttribute('url'),
    connected: view.isConnected,
    shadowRoot: Boolean(view.shadowRoot),
    shadowChildNodeCount: view.shadowRoot?.childNodes.length ?? 0,
    shadowText: view.shadowRoot?.textContent?.slice(0, 200) ?? '',
    shadowHtml: view.shadowRoot?.innerHTML?.slice(0, 1200) ?? '',
    pageExists: Boolean(view.shadowRoot?.querySelector('[part="page"]')),
    childNodeCount: view.childNodes.length,
    iframeState: (() => {
      const frame = view.shadowRoot?.querySelector('iframe');
      const frameWindow = frame?.contentWindow;
      const frameDocument = frame?.contentDocument;
      return {
        exists: Boolean(frame),
        hasRenderPage: typeof frameWindow?.renderPage === 'function',
        hasFlushElementTree: typeof frameWindow?.__FlushElementTree === 'function',
        bodyText: frameDocument?.body?.textContent?.slice(0, 200) ?? '',
      };
    })(),
  };
  if (productAppMode) {
    const renderedText = viewState.shadowText.trim();
    if (!viewState.pageExists || renderedText.length === 0) {
      setStatus('FAIL', { missing: ['lynx.ui.render'], requests, viewState, productAppMode });
      return;
    }
    if (expectText && !viewState.shadowText.includes(expectText)) {
      setStatus('FAIL', { missing: ['lynx.ui.expectedText'], expectText, requests, viewState, productAppMode });
      return;
    }
    setStatus('PASS', { requests, hostEvents, viewState, productAppMode, expectedTextMatched: Boolean(expectText) });
    return;
  }
  if (missing.length > 0) {
    setStatus('FAIL', { missing, requests, viewState });
    return;
  }
  if (!viewState.pageExists || !viewState.shadowText.includes('pass')) {
    setStatus('FAIL', { missing: ['lynx.ui.render'], requests, viewState });
    return;
  }
  setStatus('PASS', { requests, hostEvents, viewState });
}, 6000);
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
          reject(new Error('Failed to allocate Chrome debugging port'));
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

async function waitForPageTarget(debugPort, harnessUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`, 2000);
    const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && item.url === harnessUrl);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Chrome DevTools did not expose the runtime harness page target');
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
        const eventParams = message.sessionId
          ? { ...(message.params ?? {}), sessionId: message.sessionId }
          : message.params;
        for (const handler of listeners.get(message.method) ?? []) {
          handler(eventParams);
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

async function runChromeRuntimeGate(harnessUrl) {
  const debugPort = await freePort();
  const userDataDir = path.resolve('.local/applet-runtime-gate', `chrome-${process.pid}-${Date.now()}`);
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
    bundleResponses: [],
    responses: [],
    workerTargets: [],
    workerConsole: [],
    workerExceptions: [],
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
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    cdp.on('Target.attachedToTarget', async (params) => {
      const sessionId = params?.sessionId;
      const targetInfo = params?.targetInfo ?? {};
      diagnostics.workerTargets.push({
        type: targetInfo.type,
        url: targetInfo.url,
        title: targetInfo.title,
      });
      if (!sessionId || targetInfo.type !== 'worker') return;
      try {
        await cdp.send('Runtime.enable', {}, sessionId);
        await cdp.send('Log.enable', {}, sessionId);
      } catch (error) {
        diagnostics.workerExceptions.push({
          text: 'Failed to enable worker diagnostics',
          description: error instanceof Error ? error.message : String(error),
        });
      }
    });
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params?.sessionId) {
        diagnostics.workerConsole.push({
          type: params?.type,
          args: (params?.args ?? []).map((arg) => arg.value ?? arg.description).filter(Boolean),
        });
        return;
      }
      diagnostics.console.push({
        type: params?.type,
        args: (params?.args ?? []).map((arg) => arg.value ?? arg.description).filter(Boolean),
      });
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      if (params?.sessionId) {
        diagnostics.workerExceptions.push({
          text: params?.exceptionDetails?.text,
          description: params?.exceptionDetails?.exception?.description,
          stack: params?.exceptionDetails?.stackTrace,
        });
        return;
      }
      diagnostics.exceptions.push({
        text: params?.exceptionDetails?.text,
        description: params?.exceptionDetails?.exception?.description,
        stack: params?.exceptionDetails?.stackTrace,
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
      const url = params?.response?.url ?? '';
      diagnostics.responses.push({
        url,
        status: params?.response?.status,
        mimeType: params?.response?.mimeType,
      });
      if (diagnostics.responses.length > 80) {
        diagnostics.responses.shift();
      }
      if (url.includes('.lynx.bundle') || url.includes('.wasm') || url.includes('decode.worker') || url.includes('LynxViewInstance')) {
        diagnostics.bundleResponses.push({
          url,
          status: params?.response?.status,
          mimeType: params?.response?.mimeType,
        });
      }
    });
    await cdp.send('Page.navigate', { url: harnessUrl });

    const deadline = Date.now() + 20000;
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

    return { statusText, detail: { ...detail, diagnostics }, stderr, timedOut: statusText === 'PENDING' };
  } catch (error) {
    return {
      statusText: 'FAIL',
      detail: {
        error: error instanceof Error ? error.message : String(error),
        diagnostics,
      },
      stderr,
      timedOut: false,
    };
  } finally {
    cdp?.close();
    chrome.kill('SIGTERM');
    setTimeout(() => {
      if (!chrome.killed) chrome.kill('SIGKILL');
    }, 1000).unref();
  }
}

const vitePort = await freePort();
const server = await createServer({
  root: path.resolve('apps/desktop'),
  logLevel: 'silent',
  plugins: [{
    name: 'applet-runtime-gate-wasm',
    configureServer(viteServer) {
      viteServer.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const appletPrefix = `/applets-dist/${manifest.id}/`;
        if (url.pathname.startsWith(appletPrefix)) {
          const relativePath = decodeURIComponent(url.pathname.slice(appletPrefix.length));
          if (!relativePath || relativePath.includes('..') || relativePath.includes('\\')) {
            res.statusCode = 400;
            res.end('invalid applet asset path');
            return;
          }
          const assetPath = path.join(packageDir, relativePath);
          try {
            const bytes = readFileSync(assetPath);
            staticHits.push({ kind: relativePath.endsWith('.lynx.bundle') ? 'lynx.bundle' : 'applet.asset', path: assetPath, bytes: bytes.length });
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
  const chrome = await runChromeRuntimeGate(harnessUrl);

  const output = [
    `Package: ${packageDir}`,
    `Bundle: ${bundleEntry}`,
    `Harness: ${harnessUrl}`,
    `Runtime status: ${chrome.statusText}`,
    `Runtime detail: ${JSON.stringify(chrome.detail)}`,
    `Static hits: ${JSON.stringify(staticHits)}`,
    chrome.stderr,
  ].join('\n');
  writeFileSync(outputPath, output);

  if (chrome.statusText !== 'PASS') {
    process.stderr.write(output);
    process.exit(1);
  }
  process.stdout.write(`PASS desktop runtime gate evidence written to ${outputPath}\n`);
} finally {
  await server.close();
}
