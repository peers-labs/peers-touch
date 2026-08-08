#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { prepareAppletFixturePackage } from './lib/applet-readiness-paths.mjs';

const rootDir = process.cwd();
const packageArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const usesDefaultFixture = !packageArg;
const packageDir = packageArg ? path.resolve(packageArg) : prepareAppletFixturePackage('web-host-certification-applet');
const evidenceDir = path.resolve('.artifacts/applet-readiness/web/web-host-runtime-gate');
const outputPath = path.resolve('.artifacts/applet-readiness/web/web-host-runtime-gate-output.txt');
const harnessHtmlPath = path.join(evidenceDir, 'index.html');
const harnessJsPath = path.join(evidenceDir, 'harness.js');
const sdkDistEntry = path.resolve('packages/applet-sdk/dist/index.js');

mkdirSync(evidenceDir, { recursive: true });

function fail(message, details = []) {
  const output = ['FAIL Applet Web Host runtime gate', message, ...details].filter(Boolean).join('\n');
  writeFileSync(outputPath, `${output}\n`);
  process.stderr.write(`${output}\n`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function verifyIntegrity(manifest) {
  assert.equal(manifest.integrity?.algorithm, 'sha256', 'manifest integrity algorithm must be sha256');
  for (const [relativePath, expected] of Object.entries(manifest.integrity.files ?? {})) {
    const actual = sha256(path.join(packageDir, relativePath));
    assert.equal(actual, expected, `integrity mismatch for ${relativePath}`);
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,PATCH,HEAD,OPTIONS',
    'access-control-allow-headers': 'content-type,x-applet-web-host-gate',
    'content-type': 'application/json',
  });
  res.end(JSON.stringify(body));
}

function startControlledUpstream() {
  const requests = [];
  const server = createHttpServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      writeJson(res, 204, {});
      return;
    }
    requests.push({ method: req.method, url: req.url });
    if (req.url === '/api/v1/e2e') {
      writeJson(res, 200, { message: 'web-host-network-ok' });
      return;
    }
    if (req.url === '/api/v1/e2e/echo') {
      const body = await readBody(req);
      writeJson(res, 201, { message: 'web-host-network-post-ok', echo: body });
      return;
    }
    if (req.url === '/agent/turn/execute') {
      await readBody(req);
      writeJson(res, 200, { messageId: 'web-host-agent-message', content: 'web-host-agent-ok' });
      return;
    }
    if (req.url === '/chat/completions') {
      await readBody(req);
      writeJson(res, 200, {
        model: 'web-host-model',
        choices: [{ message: { role: 'assistant', content: 'web-host-provider-ok' } }],
      });
      return;
    }
    writeJson(res, 404, { error: 'not_found', path: req.url });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to allocate controlled upstream port'));
        return;
      }
      resolve({ server, requests, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
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

async function runBrowserGate(harnessUrl) {
  const debugPort = await freePort();
  const userDataDir = path.resolve('.local/applet-web-host-runtime-gate', `chrome-${process.pid}-${Date.now()}`);
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
  chrome.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const diagnostics = { console: [], exceptions: [], networkFailures: [] };
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
    await cdp.send('Page.navigate', { url: harnessUrl });

    const deadline = Date.now() + 30000;
    let statusText = 'PENDING';
    let detail = {};
    while (Date.now() < deadline) {
      const statusResult = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const status = document.getElementById('status');
          return {
            text: status?.textContent ?? 'MISSING',
            detail: status?.getAttribute('data-detail') ?? '{}'
          };
        })()`,
        returnByValue: true,
      });
      statusText = statusResult?.result?.value?.text ?? 'MISSING';
      try {
        detail = JSON.parse(statusResult?.result?.value?.detail ?? '{}');
      } catch {
        detail = {};
      }
      if (statusText === 'PASS') {
        return { detail, diagnostics, stderr };
      }
      if (statusText === 'FAIL') {
        throw new Error(`harness failed: ${JSON.stringify(detail)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`timed out waiting for PASS, last status=${statusText} detail=${JSON.stringify(detail)}`);
  } finally {
    if (cdp) cdp.close();
    if (chrome.exitCode === null && !chrome.killed) {
      chrome.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (chrome.exitCode === null && !chrome.killed) chrome.kill('SIGKILL');
    }
  }
}

function writeHarness(manifest, upstreamBaseUrl) {
  const packageMainPath = path.join(packageDir, 'src/main.ts');
  assert.ok(existsSync(packageMainPath), 'Web Host gate requires package src/main.ts developer entry');
  writeFileSync(harnessHtmlPath, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Applet Web Host Runtime Gate</title>
  </head>
  <body>
    <div id="status">PENDING</div>
    <script type="module" src="./harness.js"></script>
  </body>
</html>
`);

  writeFileSync(harnessJsPath, `const protocol = 'peers-touch.applet.bridge';
const manifest = ${JSON.stringify(manifest)};
const upstreamBaseUrl = ${JSON.stringify(upstreamBaseUrl)};
const status = document.getElementById('status');

function setStatus(value, detail) {
  status.textContent = value;
  status.setAttribute('data-detail', JSON.stringify(detail ?? {}));
}

function assertHost(condition, message) {
  if (!condition) throw new Error(message);
}

function pathMatches(pattern, value) {
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

function errorEnvelope(base, code, message, details) {
  return {
    ...base,
    kind: 'response',
    ok: false,
    error: { code, message, requestId: base.requestId, details },
  };
}

class WebHostRuntime {
  constructor(inputManifest) {
    this.manifest = inputManifest;
    this.sessionId = 'web-host-' + inputManifest.id + '-' + Date.now();
    this.destroyed = false;
    this.audit = [];
    this.handlers = new Set();
    this.subscriptions = new Set();
    this.storage = new Map();
    this.files = new Map();
    this.clipboard = '';
    this.skills = new Map();
    this.tasks = new Map();
    this.telemetry = [];
  }

  install() {
    this.validateManifest();
    globalThis.__PEERS_TOUCH_APPLET_HOST__ = {
      invoke: (method, params) => this.invoke(method, params),
      onEvent: (handler) => {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
      },
      getContext: () => this.context(),
    };
  }

  validateManifest() {
    assertHost(this.manifest.bridge?.protocol === protocol, 'manifest bridge protocol mismatch');
    assertHost(Array.isArray(this.manifest.targets) && this.manifest.targets.includes('web'), 'manifest must target web');
    assertHost(this.manifest.load?.web?.type === 'lynx-web', 'manifest load.web.type must be lynx-web');
    assertHost(Boolean(this.manifest.load?.web?.entry), 'manifest load.web.entry is required');
    assertHost(Array.isArray(this.manifest.permissions), 'manifest permissions must be an array');
  }

  context() {
    return {
      appletId: this.manifest.id,
      sessionId: this.sessionId,
      platform: 'web',
      runtime: 'web-host',
      sdkVersion: 'gate',
      bridgeProtocol: protocol,
      launchParams: { source: 'web-host-runtime-gate' },
    };
  }

  emit(topic, payload) {
    for (const handler of this.handlers) {
      handler(topic, payload);
    }
  }

  envelope(method, params) {
    return {
      protocol,
      appletId: this.manifest.id,
      sessionId: this.sessionId,
      requestId: params?.options?.requestId ?? method + '-' + (this.audit.length + 1),
    };
  }

  async invoke(method, params = {}) {
    const base = this.envelope(method, params);
    if (this.destroyed && method !== 'lifecycle.destroy') {
      this.audit.push({ method, outcome: 'invalid_session' });
      return errorEnvelope(base, 'INVALID_SESSION', 'Web Host applet session is destroyed');
    }
    if (!this.manifest.permissions.includes(method)) {
      this.audit.push({ method, outcome: 'permission_denied' });
      return errorEnvelope(base, 'PERMISSION_DENIED', 'Capability is not granted by manifest');
    }
    try {
      const result = await this.dispatch(method, params);
      this.audit.push({ method, outcome: 'allowed' });
      return { ...base, kind: 'response', ok: true, result };
    } catch (error) {
      const code = error?.code ?? 'CAPABILITY_FAILED';
      this.audit.push({ method, outcome: code.toLowerCase() });
      return errorEnvelope(base, code, error instanceof Error ? error.message : String(error), error?.details);
    }
  }

  async dispatch(method, params) {
    switch (method) {
      case 'app.getContext':
        return this.context();
      case 'app.getLaunchOptions':
        return this.context().launchParams;
      case 'lifecycle.reportReady':
        this.emit('ready', { sessionId: this.sessionId });
        this.emit('show', { sessionId: this.sessionId, reason: 'web-host-visible' });
        return { ok: true };
      case 'lifecycle.destroy':
        this.destroyed = true;
        this.emit('destroy', { sessionId: this.sessionId });
        return { ok: true };
      case 'ui.setNavigationBar':
      case 'ui.showToast':
      case 'device.vibrate':
        return { ok: true };
      case 'device.getSafeArea':
        return { top: 0, right: 0, bottom: 0, left: 0 };
      case 'device.getWindowInfo':
        return { width: 1024, height: 768, pixelRatio: window.devicePixelRatio || 1 };
      case 'clipboard.setText':
        this.clipboard = String(params.text ?? '');
        return { ok: true };
      case 'clipboard.getText':
        return this.clipboard;
      case 'file.write':
        this.files.set(params.path, String(params.content ?? ''));
        return { ok: true, path: params.path, sizeBytes: String(params.content ?? '').length };
      case 'file.read':
        return { path: params.path, content: this.files.get(params.path) ?? '' };
      case 'file.list':
        return Array.from(this.files.entries()).map(([filePath, content]) => ({ path: filePath, kind: 'file', sizeBytes: content.length }));
      case 'file.getInfo':
        return { quotaBytes: 10485760, usedBytes: Array.from(this.files.values()).join('').length, entries: [] };
      case 'storage.set':
        this.storage.set(params.key, params.value);
        return { ok: true };
      case 'storage.keys':
        return Array.from(this.storage.keys()).filter((key) => !params.prefix || key.startsWith(params.prefix));
      case 'storage.getInfo':
        return { quotaBytes: 10485760, usedBytes: 128, keys: Array.from(this.storage.keys()) };
      case 'network.request':
        return this.requestNetwork(params, false);
      case 'network.upload':
        return this.requestNetwork(params, true);
      case 'network.download': {
        const response = await this.requestNetwork(params, false);
        return { filePath: params.filePath, sizeBytes: JSON.stringify(response.body).length, status: response.status };
      }
      case 'events.subscribe':
        this.subscriptions.add(params.topic);
        return { ok: true };
      case 'events.unsubscribe':
        this.subscriptions.delete(params.topic);
        return { ok: true };
      case 'skills.register':
        this.skills.set(params.spec?.id, params.spec);
        return { ok: true };
      case 'skills.list':
        return Array.from(this.skills.values());
      case 'skills.invoke':
        return this.invokeSkill(params);
      case 'tasks.start':
        return this.startTask(params);
      case 'agent.stream':
      case 'agent.send':
        return this.requestAgent(params, method === 'agent.stream');
      case 'ai.chat': {
        const response = await fetch(upstreamBaseUrl + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
        });
        const body = await response.json();
        return { requestId: 'web-host-ai-chat', message: body.choices[0].message, model: body.model };
      }
      case 'telemetry.track':
        this.telemetry.push(params.event);
        return { ok: true };
      default: {
        const error = new Error('Capability is not implemented by Web Host gate');
        error.code = 'CAPABILITY_NOT_FOUND';
        throw error;
      }
    }
  }

  async invokeSkill(params) {
    const skill = this.skills.get(params.skillId);
    if (!skill) return { ok: false, skillId: params.skillId, error: 'POLICY_DENIED' };
    const requestId = params.options?.requestId ?? 'skill-' + Date.now();
    const executor = skill.executor;
    if (executor?.type === 'network') {
      const response = await this.requestNetwork({ ...executor.request, body: params.input }, false);
      const output = { executor: 'network', status: response.status, headers: response.headers, body: response.body };
      if (params.options?.stream && this.subscriptions.has('skill.stream')) {
        this.emit('skill.stream', { skillId: params.skillId, requestId, type: 'final', payload: output, sequence: 1 });
      }
      return { ok: true, skillId: params.skillId, requestId, output };
    }
    if (executor?.type === 'agent') {
      const response = await this.requestAgent(params.input ?? {}, false);
      const output = { executor: 'agent', response };
      if (params.options?.stream && this.subscriptions.has('skill.stream')) {
        this.emit('skill.stream', { skillId: params.skillId, requestId, type: 'final', payload: output, sequence: 1 });
      }
      return { ok: true, skillId: params.skillId, requestId, output };
    }
    return { ok: false, skillId: params.skillId, error: 'CAPABILITY_FAILED: product skill executor is required' };
  }

  async startTask(params) {
    const task = {
      taskId: 'web-host-task-' + Date.now() + '-' + this.tasks.size,
      requestId: 'web-host-task-request',
      state: 'running',
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(task.taskId, task);
    if (params.taskType === 'network') {
      const request = params.input?.request ?? params.request ?? params.input;
      const response = await this.requestNetwork(request, false);
      return this.completeTask(task, { executor: 'network', status: response.status, headers: response.headers, body: response.body });
    }
    if (params.taskType === 'agent') {
      const response = await this.requestAgent(params.input ?? params.request ?? {}, false);
      return this.completeTask(task, { executor: 'agent', response });
    }
    setTimeout(() => {
      const completed = { ...task, state: 'completed', sequence: 1 };
      this.tasks.set(task.taskId, completed);
      if (this.subscriptions.has('task.event')) this.emit('task.event', completed);
    }, Math.max(0, Number(params.completeAfterMs ?? 100)));
    return task;
  }

  completeTask(task, output) {
    const completed = { ...task, state: 'completed', output, updatedAt: new Date().toISOString(), sequence: 1 };
    this.tasks.set(task.taskId, completed);
    if (this.subscriptions.has('task.event')) this.emit('task.event', completed);
    return completed;
  }

  async requestAgent(params, stream) {
    if (stream && this.subscriptions.has('agent.stream')) {
      this.emit('agent.stream', { requestId: 'web-host-agent-stream', type: 'partial', payload: { content: 'web-host-agent-partial' }, sequence: 1 });
    }
    const response = await fetch(upstreamBaseUrl + '/agent/turn/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await response.json();
  }

  serviceFor(params) {
    if (params.url) {
      const error = new Error('Raw URL is not allowed for Web Host applet network calls');
      error.code = 'INVALID_PARAMS';
      throw error;
    }
    const service = this.manifest.services.find((item) => item.id === params.service);
    if (!service) {
      const error = new Error('Service is not declared by manifest');
      error.code = 'SERVICE_NOT_FOUND';
      throw error;
    }
    const method = String(params.method ?? 'GET').toUpperCase();
    if (!service.allowedMethods.includes(method) || !service.allowedPaths.some((pattern) => pathMatches(pattern, params.path))) {
      const error = new Error('Service method or path is outside manifest policy');
      error.code = 'POLICY_DENIED';
      throw error;
    }
    return { service, method };
  }

  async requestNetwork(params, upload) {
    const { method } = this.serviceFor(params);
    const response = await fetch(upstreamBaseUrl + params.path, {
      method: upload ? 'POST' : method,
      headers: { 'content-type': 'application/json', 'x-applet-web-host-gate': '1' },
      body: upload || !['GET', 'HEAD'].includes(method) ? JSON.stringify(params.body ?? {}) : undefined,
    });
    const body = await response.json();
    return {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
      body,
    };
  }
}

try {
  setStatus('INSTALLING_HOST');
  const runtime = new WebHostRuntime(manifest);
  runtime.install();
  const sdkModule = await import(${JSON.stringify(`/@fs/${sdkDistEntry}`)});
  assertHost(sdkModule.sdk.runtime === 'web-host', 'SDK did not detect WebHostBridgeAdapter');
  const appletModule = await import(${JSON.stringify(`/@fs/${packageMainPath}`)});
  setStatus('RUNNING_APPLET');
  await appletModule.runAppletReadinessFlow();

  const sdk = new sdkModule.AppletSDK(new sdkModule.WebHostBridgeAdapter());
  const deniedPermission = await sdk.invoke('navigation.back').then(
    () => ({ ok: false }),
    (error) => ({ ok: error instanceof sdkModule.AppletError && error.code === 'PERMISSION_DENIED', code: error.code }),
  );
  assertHost(deniedPermission.ok, 'Web Host did not preserve PERMISSION_DENIED');
  const rawUrlDenied = await sdk.invoke('network.request', { url: 'https://example.invalid', method: 'GET' }).then(
    () => ({ ok: false }),
    (error) => ({ ok: error instanceof sdkModule.AppletError && error.code === 'INVALID_PARAMS', code: error.code }),
  );
  assertHost(rawUrlDenied.ok, 'Web Host did not reject raw network URLs');
  await sdk.invoke('lifecycle.destroy');
  const destroyedDenied = await sdk.invoke('app.getContext').then(
    () => ({ ok: false }),
    (error) => ({ ok: error instanceof sdkModule.AppletError && error.code === 'INVALID_SESSION', code: error.code }),
  );
  assertHost(destroyedDenied.ok, 'Web Host did not reject invoke after session destroy');

  const methods = new Set(runtime.audit.map((record) => record.method));
  const requiredMethods = [
    'app.getContext',
    'lifecycle.reportReady',
    'network.request',
    'network.upload',
    'network.download',
    'skills.invoke',
    'tasks.start',
    'agent.stream',
    'ai.chat',
    'telemetry.track',
  ];
  const missing = requiredMethods.filter((method) => !methods.has(method));
  assertHost(missing.length === 0, 'missing Web Host method evidence: ' + missing.join(','));
  assertHost(runtime.telemetry.some((event) => event?.name === 'applet.readiness.flow.completed'), 'missing readiness telemetry event');
  setStatus('PASS', { audit: runtime.audit, telemetry: runtime.telemetry });
} catch (error) {
  setStatus('FAIL', { error: error instanceof Error ? error.message : String(error), stack: error?.stack });
}
`);
}

let viteServer = null;
let controlledUpstream = null;

try {
  if (usesDefaultFixture) {
    run('node', [
      'tooling/scripts/create-generic-complex-applet.mjs',
      packageDir,
      '--id',
      'web-host-certification-applet',
      '--name',
      'Web Host Certification Applet',
      '--package-name',
      '@external/web-host-certification-applet',
      '--description',
      'External-style Web Host certification fixture for Applet runtime readiness evidence.',
      '--author',
      'External Producer',
      '--targets',
      'desktop,web',
    ]);
  }

  const contract = await import('../../packages/applet-contract/dist/index.js');
  const manifest = readJson(path.join(packageDir, 'manifest.json'));
  const validation = contract.validateManifest(manifest);
  assert.equal(validation.valid, true, `manifest validation failed: ${validation.errors.join('; ')}`);
  assert.ok(validation.manifest.targets.includes('web'), 'Web Host runtime gate requires manifest target web');
  verifyIntegrity(manifest);

  controlledUpstream = await startControlledUpstream();
  writeHarness(validation.manifest, controlledUpstream.baseUrl);
  viteServer = await createViteServer({
    root: evidenceDir,
    logLevel: 'silent',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      fs: { allow: [rootDir] },
    },
  });
  await viteServer.listen();
  const address = viteServer.httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Vite did not expose a TCP address');
  }
  const harnessUrl = `http://127.0.0.1:${address.port}/index.html`;
  const browserResult = await runBrowserGate(harnessUrl);

  const hitUrls = new Set(controlledUpstream.requests.map((request) => request.url));
  for (const requiredUrl of ['/api/v1/e2e', '/api/v1/e2e/echo', '/agent/turn/execute', '/chat/completions']) {
    assert.ok(hitUrls.has(requiredUrl), `controlled upstream did not receive ${requiredUrl}`);
  }

  const output = [
    'PASS Applet Web Host runtime gate',
    `Package: ${packageDir}`,
    `Harness: ${harnessUrl}`,
    `Controlled upstream: ${controlledUpstream.baseUrl}`,
    `Controlled upstream requests: ${JSON.stringify(controlledUpstream.requests)}`,
    `Browser evidence: ${JSON.stringify(browserResult.detail)}`,
  ].join('\n');
  writeFileSync(outputPath, `${output}\n`);
  process.stdout.write(`${output}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), [
    controlledUpstream ? `Controlled upstream requests: ${JSON.stringify(controlledUpstream.requests)}` : '',
  ]);
} finally {
  if (viteServer) await viteServer.close();
  if (controlledUpstream) {
    await new Promise((resolve) => controlledUpstream.server.close(resolve));
  }
}
