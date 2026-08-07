#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { prepareAppletFixturePackage } from './lib/applet-readiness-paths.mjs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';

const realHttpGateway = process.argv.includes('--real-http-gateway');
const shellRoute = process.argv.includes('--shell-route');
const productAppMode = process.argv.includes('--product-app');
const expectTextArg = process.argv.find((arg) => arg.startsWith('--expect-text='));
const expectText = expectTextArg ? expectTextArg.slice('--expect-text='.length) : '';
const packageArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const packageDir = packageArg ? path.resolve(packageArg) : prepareAppletFixturePackage('generic-complex-applet');
const rootDir = process.cwd();
const evidenceName = shellRoute
  ? (realHttpGateway ? 'product-shell-real-gateway-gate' : 'product-shell-gate')
  : (realHttpGateway ? 'product-host-real-gateway-gate' : 'product-host-gate');
const evidenceDir = path.resolve('.artifacts/applet-readiness/desktop', evidenceName);
const harnessHtmlPath = path.join(evidenceDir, 'index.html');
const harnessJsPath = path.join(evidenceDir, 'harness.js');
const outputPath = path.resolve('.artifacts/applet-readiness/desktop', `${evidenceName}-output.txt`);
const manifest = JSON.parse(readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
const bundleEntry = manifest.load?.desktop?.entry ?? manifest.entries?.lynx;
const bundlePath = bundleEntry ? path.join(packageDir, bundleEntry) : '';
const staticHits = [];
const pageRegistrySource = readFileSync(path.resolve('apps/desktop/src/pages/registry.ts'), 'utf8');
const pageRouterSource = readFileSync(path.resolve('apps/desktop/src/components/PageRouter.tsx'), 'utf8');
const appletRuntimeDescriptorSource = readFileSync(path.resolve('apps/desktop/src/pages/AppletRuntimePage.descriptor.tsx'), 'utf8');

if (!bundleEntry || !bundlePath) {
  process.stderr.write('FAIL desktop product host gate requires manifest.load.desktop.entry or entries.lynx\n');
  process.exit(1);
}
readFileSync(bundlePath);

if (!pageRegistrySource.includes("import { registerAppletRuntimePage } from './AppletRuntimePage.descriptor'") ||
  !pageRegistrySource.includes('registerAppletRuntimePage();')) {
  process.stderr.write('FAIL product Host kernel registry does not register AppletRuntimePage.descriptor\n');
  process.exit(1);
}

if (!appletRuntimeDescriptorSource.includes("id: 'applet:*'") ||
  !appletRuntimeDescriptorSource.includes("runtimes: ['applets']")) {
  process.stderr.write('FAIL AppletRuntimePage descriptor is not a kernel-owned dynamic applet route\n');
  process.exit(1);
}

if (pageRouterSource.includes("page.startsWith('applet:')") ||
  pageRouterSource.includes('page.startsWith("applet:")')) {
  process.stderr.write('FAIL legacy PageRouter still owns applet:* routing\n');
  process.exit(1);
}

mkdirSync(evidenceDir, { recursive: true });

const realHttpGatewayPort = realHttpGateway ? await freePort() : undefined;
const realHttpGatewayBaseUrl = realHttpGatewayPort ? `http://127.0.0.1:${realHttpGatewayPort}` : '';

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
  'events.poll',
  'skills.register',
  'skills.list',
  'tasks.start',
  'agent.stream',
  'ai.chat',
  'telemetry.track',
];

function readJson(req) {
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

function startControlledUpstream() {
  const requests = [];
  const server = createHttpServer(async (req, res) => {
    if (req.url === '/api/v1/e2e') {
      requests.push({ method: req.method, url: req.url });
      res.writeHead(200, { 'content-type': 'application/json', 'x-applet-e2e': 'network' });
      res.end(JSON.stringify({ message: 'product-real-gateway-network-ok' }));
      return;
    }
    if (req.url === '/api/v1/e2e/echo') {
      const body = await readJson(req);
      requests.push({ method: req.method, url: req.url, body });
      res.writeHead(201, { 'content-type': 'application/json', 'x-applet-e2e': 'network-post' });
      res.end(JSON.stringify({ message: 'product-real-gateway-network-post-ok', echo: body }));
      return;
    }
    if (req.url === '/agent/turn/execute') {
      const body = await readJson(req);
      requests.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messageId: 'product-real-gateway-agent-message', content: 'product-real-gateway-agent-ok' }));
      return;
    }
    if (req.url === '/chat/completions') {
      const body = await readJson(req);
      requests.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'gpt-4o', choices: [{ message: { content: 'product-real-gateway-provider-ok' } }] }));
      return;
    }
    if (req.url?.startsWith('/notification/list')) {
      requests.push({ method: req.method, url: req.url });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ notifications: [], nextCursor: '', totalCount: 0, unreadCount: 0 }));
      return;
    }
    if (req.url === '/notification/unread-counts') {
      requests.push({ method: req.method, url: req.url });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ total: 0, byCategory: {} }));
      return;
    }
    requests.push({ method: req.method, url: req.url });
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', path: req.url }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to allocate local upstream port'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, requests });
    });
  });
}

writeFileSync(harnessHtmlPath, `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Applet Desktop Product Host Gate</title>
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
    <div id="mount" style="width: 800px; height: 600px;"></div>
    <script type="module" src="./harness.js"></script>
  </body>
</html>
`);

writeFileSync(harnessJsPath, `const protocol = 'peers-touch.applet.bridge';
const appletId = ${JSON.stringify(manifest.id)};
const manifestPermissions = ${JSON.stringify(manifest.permissions ?? [])};
const requiredMethods = ${JSON.stringify(requiredMethods)};
const realHttpGateway = ${JSON.stringify(realHttpGateway)};
const realHttpGatewayBaseUrl = ${JSON.stringify(realHttpGatewayBaseUrl)};
const shellRoute = ${JSON.stringify(shellRoute)};
const productAppMode = ${JSON.stringify(productAppMode)};
const expectText = ${JSON.stringify(expectText)};
const status = document.getElementById('status');
const mount = document.getElementById('mount');
const invocations = [];
const storage = new Map();
const files = new Map();
const clipboard = { text: '' };
const hostEvents = [];
const hostUiRequests = [];
const hostDeviceRequests = [];
const eventSubscriptions = new Set();
let shellSessionLoginMethod = '';
let appletListProjection = null;
let skillRegistered = null;
let taskStarted = false;
let completedTaskEventDrained = false;
let activeSessionId = '';
let mountedHost = null;
let lynxEventRecorderInstalled = false;
let hostCommandRecorderInstalled = false;
const kernelRoute = ${JSON.stringify({ descriptorId: 'applet:*', pageKey: `applet:${manifest.id}`, dynamic: true })};

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

function shellStoreProjection(command) {
  const installState = {
    actorId: 'product-shell-gate',
    deviceId: 'product-shell-gate-device',
    appletId,
    version: ${JSON.stringify(manifest.version ?? '0.0.0')},
    channel: 1,
    status: 1,
  };
  if (command === 'applets_store_list_catalog') {
    return ok(command, {
      items: [{
        info: {
          id: appletId,
          name: ${JSON.stringify(manifest.name ?? manifest.id)},
          description: ${JSON.stringify(manifest.description ?? '')},
          iconUrl: ${JSON.stringify(manifest.icon ?? '')},
          developerId: ${JSON.stringify(manifest.author ?? 'product-host-gate')},
          status: 1,
        },
        version: {
          appletId,
          version: ${JSON.stringify(manifest.version ?? '0.0.0')},
          bundleUrl: '/applets-dist/' + appletId + '/' + ${JSON.stringify(bundleEntry)},
          bundleHash: '',
          status: 1,
          channel: 1,
          manifest: {
            manifestJson: ${JSON.stringify(JSON.stringify(manifest))},
            targetPlatforms: ['desktop'],
            permissions: manifestPermissions,
            capabilities: ${JSON.stringify(manifest.capabilities ?? [])},
            runtimeType: 'lynx-web',
          },
        },
        installState,
      }],
      totalCount: 1,
      source: 'station',
      stale: false,
    });
  }
  if (command === 'applets_store_list_installed') {
    return ok(command, {
      states: [installState],
      source: 'station',
      stale: false,
    });
  }
  return null;
}

function responseFor(method, params) {
  switch (method) {
    case 'app.getContext':
      return { appletId, sessionId: activeSessionId, platform: 'desktop', runtime: 'lynx-web', bridgeProtocol: protocol, launchParams: {} };
    case 'app.getLaunchOptions':
      return {};
    case 'lifecycle.reportReady':
    case 'device.vibrate':
    case 'telemetry.track':
      return { ok: true };
    case 'events.subscribe':
      eventSubscriptions.add(String(params?.topic ?? ''));
      return { ok: true };
    case 'events.unsubscribe':
      eventSubscriptions.delete(String(params?.topic ?? ''));
      return { ok: true };
    case 'events.poll':
      if (!taskStarted || completedTaskEventDrained || !eventSubscriptions.has('task.event')) {
        return { ok: true, events: [] };
      }
      completedTaskEventDrained = true;
      return {
        ok: true,
        events: [{
          topic: 'task.event',
          payload: {
            taskId: 'product-host-task',
            requestId: 'product-host-task-request',
            state: 'completed',
            sequence: 2,
          },
        }],
      };
    case 'ui.setNavigationBar':
    case 'ui.showToast':
      return {
        ok: true,
        __hostCommands: [{
          type: 'ui',
          action: method.slice('ui.'.length),
          params: params ?? {},
          returnsResult: false,
        }],
      };
    case 'device.getSafeArea':
      return {
        ok: true,
        __hostCommands: [{
          type: 'device',
          action: 'getSafeArea',
          params: params ?? {},
          returnsResult: true,
        }],
      };
    case 'device.getWindowInfo':
      return {
        ok: true,
        __hostCommands: [{
          type: 'device',
          action: 'getWindowInfo',
          params: params ?? {},
          returnsResult: true,
        }],
      };
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
      return { status: 200, headers: { 'x-applet-product-host-gate': 'network' }, body: { message: 'product-host-network-ok' } };
    case 'network.upload':
      return { status: 201, headers: { 'x-applet-product-host-gate': 'upload' }, body: { message: 'product-host-upload-ok' } };
    case 'network.download':
      return { filePath: params?.filePath ?? 'downloads/e2e.json', sizeBytes: 42, status: 200 };
    case 'skills.register':
      skillRegistered = params?.spec ?? null;
      return { ok: true, skillId: skillRegistered?.id ?? 'runtime-summary' };
    case 'skills.list':
      return skillRegistered ? [skillRegistered] : [];
    case 'tasks.start':
      taskStarted = true;
      return {
        taskId: 'product-host-task',
        requestId: 'product-host-task-request',
        state: 'running',
        updatedAt: new Date(0).toISOString(),
        ...(eventSubscriptions.has('task.event') ? { __events: [{
          topic: 'task.event',
          payload: {
            taskId: 'product-host-task',
            requestId: 'product-host-task-request',
            state: 'progress',
            sequence: 1,
          },
        }] } : {}),
      };
    case 'agent.stream':
      return { requestId: 'product-host-agent-request', message: { id: 'product-host-agent-message', role: 'assistant', content: 'product-host-agent-ok' } };
    case 'ai.chat':
      return { requestId: 'product-host-ai-request', message: { role: 'assistant', content: 'product-host-ai-ok' }, model: 'product-host-model' };
    case 'lifecycle.destroy':
      return { ok: true };
    default:
      throw new Error('Unsupported product host gate method: ' + method);
  }
}

const tauriInternalsBase = {
  transformCallback: (callback) => {
    const id = crypto.randomUUID();
    if (callback) window['_' + id] = callback;
    return id;
  },
  convertFileSrc: (filePath) => filePath,
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
};

window.__TAURI_INTERNALS__ = realHttpGateway ? {
  ...tauriInternalsBase,
  invoke: async (command, args = {}) => {
    const input = args?.input ?? {};
    invocations.push({ command, input, mode: 'real-http-gateway' });
    const shellProjection = shellRoute ? shellStoreProjection(command) : null;
    if (shellProjection) return shellProjection;
    const response = await fetch(realHttpGatewayBaseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: command, args: args ?? {} }),
    });
    if (!response.ok) {
      throw new Error('HTTP Gateway ' + response.status + ': ' + await response.text());
    }
    return response.json();
  },
} : {
  ...tauriInternalsBase,
  invoke: async (command, args = {}) => {
    const input = args?.input ?? {};
    invocations.push({ command, input, mode: 'stub' });
    const shellProjection = shellRoute ? shellStoreProjection(command) : null;
    if (shellProjection) return shellProjection;
    if (command === 'applets_create_session') {
      if (input.id !== appletId || input.manifest?.id !== appletId) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'manifest mismatch' } };
      }
      activeSessionId = 'product-host-session';
      return ok(command, { ok: true, appletId, sessionId: activeSessionId });
    }
    if (command === 'applets_invoke') {
      const action = input.action ? '.' + input.action : '';
      const method = String(input.capability ?? '') + action;
      return ok(command, responseFor(method, input.params ?? {}));
    }
    return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'unsupported command: ' + command } };
  },
};

window.addEventListener('error', (event) => {
  setStatus('FAIL', { error: event.message });
});

window.addEventListener('unhandledrejection', (event) => {
  setStatus('FAIL', { error: String(event.reason?.message ?? event.reason) });
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
    shadowText: view?.shadowRoot?.textContent?.slice(0, 200) ?? '',
    shadowHtml: view?.shadowRoot?.innerHTML?.slice(0, 1200) ?? '',
    pageExists: Boolean(view?.shadowRoot?.querySelector('[part="page"]')),
  };
}

function installLynxEventRecorder() {
  if (lynxEventRecorderInstalled) return;
  const LynxViewElement = customElements.get('lynx-view');
  const originalSendGlobalEvent = LynxViewElement.prototype.sendGlobalEvent;
  LynxViewElement.prototype.sendGlobalEvent = function(name, payload) {
    hostEvents.push({ name, payload });
    return originalSendGlobalEvent.call(this, name, payload);
  };
  lynxEventRecorderInstalled = true;
}

function installHostCommandRecorder() {
  if (hostCommandRecorderInstalled) return;
  const LynxHostElement = customElements.get('lynx-host');
  const originalDispatchHostCommand = LynxHostElement.prototype.dispatchHostCommand;
  LynxHostElement.prototype.dispatchHostCommand = async function(command) {
    if (command && typeof command === 'object' && !Array.isArray(command)) {
      const record = command;
      const action = typeof record.action === 'string' ? record.action : '';
      const params = record.params && typeof record.params === 'object' && !Array.isArray(record.params)
        ? record.params
        : {};
      const request = {
        action,
        params,
        returnsResult: record.returnsResult === true,
      };
      if (record.type === 'ui') hostUiRequests.push(request);
      if (record.type === 'device') hostDeviceRequests.push(request);
    }
    return originalDispatchHostCommand.call(this, command);
  };
  hostCommandRecorderInstalled = true;
}

function permissionGroup(permission) {
  const separator = permission.includes('.') ? '.' : ':';
  return permission.split(separator)[0] || 'unknown';
}

async function assertProductShellAppletListProjection(useAppletsStore) {
  const open = await waitUntil(
    () => document.querySelector('[data-page-descriptor="applets"][data-page="applets"] [data-applet-open="' + appletId + '"]'),
    5000,
    'Product shell did not render the applet tile for the manifest',
  );
  if (open.getAttribute('data-applet-status') !== 'installed') {
    throw new Error('Product shell applet list did not project installed status before launch');
  }
  if (open.getAttribute('data-applet-opened-this-session') !== 'false') {
    throw new Error('Product shell applet list used stale opened-session state before launch');
  }
  if (!(open instanceof HTMLElement)) {
    throw new Error('Product shell applet list did not expose an open control');
  }
  appletListProjection = {
    appletId,
    status: open.getAttribute('data-applet-status'),
    source: open.getAttribute('data-applet-source'),
    openedThisSession: open.getAttribute('data-applet-opened-this-session'),
    permissionGroups: Array.from(new Set(manifestPermissions.map(permissionGroup))).map((group) => ({
      group,
      methods: manifestPermissions.filter((permission) => permissionGroup(permission) === group),
    })),
  };
  open.click();
  const openedProjection = await waitUntil(() => {
    const applet = useAppletsStore.getState().applets.find((item) => item.manifest.id === appletId);
    if (applet?.status === 'active' && applet.lastOpenedAt) {
      return {
        status: applet.status,
        openedThisSession: true,
        lastOpenedAt: applet.lastOpenedAt,
      };
    }
    return null;
  }, 5000, 'Product shell store did not project active/opened state after clicking the applet list open control');
  appletListProjection.afterOpen = openedProjection;
}

async function mountProductShellRoute() {
  setStatus('IMPORTING_PRODUCT_SHELL');
  const [
    { registerAppletElements },
    { ReadyView },
    { useSessionStore },
    { useAppletsStore },
    { initI18n },
    { I18nextProvider },
    { ThemeProvider },
    React,
    ReactDomClient,
  ] = await Promise.all([
    import('/src/applet/register-elements.ts'),
    import('/src/views/ReadyView.tsx'),
    import('/src/store/session.ts'),
    import('/src/store/applets.ts'),
    import('/src/i18n/index.ts'),
    import('react-i18next'),
    import('@lobehub/ui'),
    import('react'),
    import('react-dom/client'),
  ]);
  registerAppletElements();
  await customElements.whenDefined('lynx-host');
  await customElements.whenDefined('lynx-view');
  installLynxEventRecorder();
  installHostCommandRecorder();

  window.history.replaceState(null, '', '#/applets');
  useSessionStore.setState({
    authenticated: true,
    restoring: false,
    currentUser: {
      actorId: 'product-shell-gate',
      name: 'Product Shell Gate',
      email: '',
      loginMethod: 'product-shell-gate',
      loginProvider: 'product-shell-gate',
    },
  });
  shellSessionLoginMethod = useSessionStore.getState().currentUser?.loginMethod ?? '';
  if (shellSessionLoginMethod === 'readiness-probe') {
    throw new Error('Product shell route gate must not use readiness-probe session state');
  }

  await useAppletsStore.getState().refresh();
  const i18n = await initI18n();
  const root = ReactDomClient.createRoot(mount);
  root.render(
    React.createElement(I18nextProvider, { i18n },
      React.createElement(ThemeProvider, null,
        React.createElement(ReadyView, {
          lifecycle: {
            state: 'ready',
            restoredUser: null,
            knownAccounts: [],
            dataReady: true,
            completeLogin: () => undefined,
          },
        }),
      ),
    ),
  );

  await assertProductShellAppletListProjection(useAppletsStore);
  await waitUntil(() => document.querySelector('[data-page-descriptor="applet:*"][data-page="applet:' + appletId + '"]'), 5000, 'Product shell did not route through PageHost applet:* descriptor');
  return root;
}

try {
  let shellRoot = null;
  let productSessionId = '';
  if (shellRoute) {
    shellRoot = await mountProductShellRoute();
  } else {
    setStatus('IMPORTING_PRODUCT_HOST');
    const [{ registerAppletElements }, { default: AppletManager }] = await Promise.all([
      import('/src/applet/register-elements.ts'),
      import('/src/applet/AppletManager.ts'),
    ]);
    registerAppletElements();
    await customElements.whenDefined('lynx-host');
    await customElements.whenDefined('lynx-view');
    installLynxEventRecorder();
    await new Promise((resolve) => setTimeout(resolve, 500));

    setStatus('SCANNING_APPLET_INDEX');
    const manager = AppletManager.getInstance();
    const applets = await manager.scanApplets();
    if (!applets.some((applet) => applet.id === appletId)) {
      throw new Error('Product AppletManager did not discover the fixture package');
    }

    setStatus('CREATING_PRODUCT_SESSION');
    await manager.loadApplet(appletId);
    const sessionId = manager.getSessionId(appletId);
    if (!sessionId) {
      throw new Error('Product AppletManager did not create a gateway session');
    }
    productSessionId = sessionId;

    setStatus('MOUNTING_PRODUCT_LYNX_HOST');
    const host = document.createElement('lynx-host');
    mountedHost = host;
    host.setAttribute('applet-id', appletId);
    host.setAttribute('session-id', sessionId);
    host.setAttribute('url', '/applets-dist/' + appletId + '/' + ${JSON.stringify(bundleEntry)});
    host.style.width = '800px';
    host.style.height = '600px';
    host.uiHandler = (request) => {
      hostUiRequests.push(request);
      return { ok: true };
    };
    host.deviceHandler = (request) => {
      hostDeviceRequests.push(request);
      if (request.action === 'getWindowInfo') return { width: 800, height: 600, pixelRatio: window.devicePixelRatio || 1 };
      if (request.action === 'getSafeArea') return { top: 0, right: 0, bottom: 0, left: 0 };
      return { ok: false, reason: 'unsupported-device-command' };
    };
    mount.appendChild(host);
  }

  if (shellRoute) {
    mountedHost = await waitUntil(() => mount.querySelector('lynx-host'), 5000, 'Product shell did not mount lynx-host');
  }
  const host = mountedHost;
  if (!host) {
    throw new Error('Product Host did not mount lynx-host');
  }

  await waitUntil(() => {
    const state = viewStateFor(host);
    if (!state.pageExists) return null;
    if (productAppMode) {
      const renderedText = state.shadowText.trim();
      if (!renderedText) return null;
      if (expectText && !state.shadowText.includes(expectText)) return null;
      return state;
    }
    return state.shadowText.includes('pass') ? state : null;
  }, 10000, productAppMode ? 'Product lynx-host did not render expected product app content' : 'Product lynx-host did not render pass');

  const seenMethods = new Set(invocations
    .filter((item) => item.command === 'applets_invoke')
    .map((item) => String(item.input.capability ?? '') + (item.input.action ? '.' + item.input.action : '')));
  const missing = requiredMethods.filter((method) => !seenMethods.has(method));
  if (!productAppMode && missing.length > 0) {
    throw new Error('Missing product Host SDK calls: ' + missing.join(', '));
  }

  const frontendFailures = invocations
    .filter((item) => item.command === 'frontend_log')
    .map((item) => item.input ?? {})
    .filter((input) => input.level === 'error' || String(input.message ?? '').includes(' FAIL') || String(input.message ?? '').includes(' ERROR'));
  if (frontendFailures.length > 0) {
    throw new Error('Product shell emitted frontend failure logs: ' + JSON.stringify(frontendFailures.slice(0, 5)));
  }

  const taskEvent = hostEvents.some((event) => event.name === 'applet.event'
    && JSON.stringify(event.payload).includes('task.event'));
  if (!productAppMode && !taskEvent) {
    throw new Error('Product Host did not dispatch Gateway task.event through lynx-view');
  }
  const showEvent = hostEvents.some((event) => event.name === 'applet.event'
    && JSON.stringify(event.payload).includes('"topic":"show"'));
  if (!productAppMode && !showEvent) {
    throw new Error('Product Host did not dispatch lifecycle.show through lynx-view after reportReady');
  }
  if (!productAppMode && !hostUiRequests.some((request) => request.action === 'showToast')) {
    throw new Error('Product Host did not execute Gateway-authorized ui.showToast as a Host UI command');
  }
  if (!productAppMode && (!hostDeviceRequests.some((request) => request.action === 'getWindowInfo') ||
    !hostDeviceRequests.some((request) => request.action === 'getSafeArea'))) {
    throw new Error('Product Host did not execute Gateway-authorized device commands in the Host');
  }

  if (!productAppMode) {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const pauseEvent = await waitUntil(() => hostEvents.some((event) => event.name === 'applet.event'
      && JSON.stringify(event.payload).includes('"topic":"pause"')), 2000, 'Product Host did not map document hidden state to lifecycle.pause');
    if (!pauseEvent) {
      throw new Error('Product Host did not emit lifecycle.pause for document hidden state');
    }

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    const resumeEvent = await waitUntil(() => hostEvents.some((event) => event.name === 'applet.event'
      && JSON.stringify(event.payload).includes('"topic":"resume"')), 2000, 'Product Host did not map document visible state to lifecycle.resume');
    if (!resumeEvent) {
      throw new Error('Product Host did not emit lifecycle.resume for document visible state');
    }
  }

  if (shellRoute) {
    shellRoot?.unmount();
  } else {
    host.remove();
  }
  await waitUntil(() => invocations.some((item) => item.command === 'applets_invoke'
    && item.input.capability === 'lifecycle'
    && item.input.action === 'destroy'), 2000, 'Product Host did not destroy the gateway session on unmount');

  const destroyEvent = hostEvents.some((event) => event.name === 'applet.event'
    && JSON.stringify(event.payload).includes('destroy'));
  const hideEvent = hostEvents.some((event) => event.name === 'applet.event'
    && JSON.stringify(event.payload).includes('"topic":"hide"'));
  if (!productAppMode && !hideEvent) {
    throw new Error('Product Host did not emit lifecycle.hide before unmount');
  }
  if (!productAppMode && !destroyEvent) {
    throw new Error('Product Host did not emit destroy event before unmount');
  }

  setStatus('PASS', {
    appletId,
    sessionId: productSessionId || activeSessionId,
    shellRoute,
    productAppMode,
    expectedTextMatched: Boolean(expectText),
    shellSessionLoginMethod,
    appletListProjection,
    requestCount: seenMethods.size,
    invocations,
    hostEvents,
    hostUiRequests,
    hostDeviceRequests,
    kernelRoute,
    viewState: viewStateFor(host),
  });
} catch (error) {
  setStatus('FAIL', {
    error: error instanceof Error ? error.message : String(error),
    invocations,
    hostEvents,
    hostUiRequests,
    hostDeviceRequests,
    kernelRoute,
    viewState: mountedHost ? viewStateFor(mountedHost) : null,
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
          reject(new Error('Failed to allocate Chrome debugging port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function isKnownNonFatalWorkerConsole(entry) {
  if (entry.type !== 'error') return false;
  const message = entry.args.join(' ');
  return [
    'NYI: profileStart. This is an issue of lynx-core.',
    'NYI: isProfileRecording. This is an issue of lynx-core.',
    'NYI: profileEnd. This is an issue of lynx-core.',
  ].includes(message);
}

function isKnownNonFatalPageConsole(entry) {
  if (entry.type !== 'error') return false;
  const message = entry.args.join(' ');
  return [
    'Warning: [antd: Alert] `message` is deprecated. Please use `title` instead.',
    'Warning: [antd: Spin] `tip` is deprecated. Please use `description` instead.',
  ].includes(message);
}

function toKnownDiagnostic(entry) {
  return {
    level: 'known-nonfatal',
    originalType: entry.type,
    args: entry.args,
  };
}

function browserDiagnosticFailures(diagnostics) {
  const failures = [];
  const pageErrors = diagnostics.console.filter((entry) => entry.type === 'error' && !isKnownNonFatalPageConsole(entry));
  const workerErrors = diagnostics.workerConsole.filter((entry) => entry.type === 'error');
  const httpErrors = diagnostics.responses.filter((entry) => Number(entry.status) >= 400);

  if (pageErrors.length > 0) {
    failures.push({ kind: 'page-console-error', samples: pageErrors.slice(0, 5) });
  }
  if (workerErrors.length > 0) {
    failures.push({ kind: 'worker-console-error', samples: workerErrors.slice(0, 5) });
  }
  if (diagnostics.exceptions.length > 0) {
    failures.push({ kind: 'page-exception', samples: diagnostics.exceptions.slice(0, 5) });
  }
  if (diagnostics.workerExceptions.length > 0) {
    failures.push({ kind: 'worker-exception', samples: diagnostics.workerExceptions.slice(0, 5) });
  }
  if (diagnostics.networkFailures.length > 0) {
    failures.push({ kind: 'network-failure', samples: diagnostics.networkFailures.slice(0, 5) });
  }
  if (httpErrors.length > 0) {
    failures.push({ kind: 'http-error-response', samples: httpErrors.slice(0, 5) });
  }
  return failures;
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

async function invokeHttpGateway(baseUrl, cmd, args = {}) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cmd, args }),
  });
  if (!response.ok) {
    throw new Error(`HTTP Gateway ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function waitForHttpGateway(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await invokeHttpGateway(baseUrl, 'meta_contract_version');
      if (result?.ok === true || result?.data) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for HTTP Gateway at ${baseUrl}`);
}

async function startRustHttpGateway(baseUrl, upstreamBaseUrl) {
  const startupTimeoutMs = Number.parseInt(process.env.PEERS_APPLET_HTTP_GATEWAY_STARTUP_TIMEOUT_MS ?? '120000', 10);
  const child = spawn(
    'cargo',
    [
      'test',
      '--manifest-path',
      'apps/desktop/src-tauri/Cargo.toml',
      'applet_http_gateway_server_for_product_host_gate',
      '--',
      '--ignored',
      '--nocapture',
    ],
    {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PT_GATEWAY_PORT: String(new URL(baseUrl).port),
        PEERS_APPLET_HTTP_GATEWAY_HOLD_MS: '120000',
        PEERS_APPLET_E2E_BASE_URL: upstreamBaseUrl,
        PEERS_STATION_URL: upstreamBaseUrl,
        PEERS_APPLET_SERVICE_PRIMARY_API: upstreamBaseUrl,
        PEERS_APPLET_SERVICE_STATION_API: upstreamBaseUrl,
        PEERS_APPLET_CLIPBOARD_BACKEND: 'memory',
      },
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  function signalGateway(signal) {
    if (exited || !child.pid) return;
    try {
      if (process.platform !== 'win32') {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // The server may have exited between the status check and signal.
    }
  }

  try {
    await waitForHttpGateway(baseUrl, Number.isFinite(startupTimeoutMs) && startupTimeoutMs > 0 ? startupTimeoutMs : 120000);
  } catch (error) {
    signalGateway('SIGTERM');
    throw new Error([
      error instanceof Error ? error.message : String(error),
      stdout,
      stderr,
    ].filter(Boolean).join('\n'));
  }

  return {
    child,
    output: () => ({ stdout, stderr, exited }),
    stop() {
      if (exited) return Promise.resolve();
      signalGateway('SIGTERM');
      return new Promise((resolve) => {
        const forceKill = setTimeout(() => {
          signalGateway('SIGKILL');
        }, 1000);
        const giveUp = setTimeout(resolve, 3000);
        child.once('exit', () => {
          clearTimeout(forceKill);
          clearTimeout(giveUp);
          resolve();
        });
      });
    },
  };
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

async function runChromeProductHostGate(harnessUrl) {
  const debugPort = await freePort();
  const userDataDir = path.resolve('.local/applet-product-host-gate', `chrome-${process.pid}-${Date.now()}`);
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
    bundleResponses: [],
    workerTargets: [],
    workerConsole: [],
    workerExceptions: [],
    knownNonFatalWorkerDiagnostics: [],
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
      const entry = {
        type: params?.type,
        args: (params?.args ?? []).map((arg) => arg.value ?? arg.description).filter(Boolean),
      };
      if (params?.sessionId && isKnownNonFatalWorkerConsole(entry)) {
        diagnostics.knownNonFatalWorkerDiagnostics.push(toKnownDiagnostic(entry));
        return;
      }
      const target = params?.sessionId ? diagnostics.workerConsole : diagnostics.console;
      target.push(entry);
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      const target = params?.sessionId ? diagnostics.workerExceptions : diagnostics.exceptions;
      target.push({
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
      if (diagnostics.responses.length > 120) {
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

    const completed = statusText === 'PASS' || statusText === 'FAIL' || statusText === 'MISSING';
    const browserFailures = browserDiagnosticFailures(diagnostics);
    if (statusText === 'PASS' && browserFailures.length > 0) {
      return {
        statusText: 'FAIL',
        detail: { ...detail, browserFailures, diagnostics },
        stderr,
        timedOut: !completed,
      };
    }
    return { statusText, detail: { ...detail, diagnostics }, stderr, timedOut: !completed };
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

let controlledUpstream;
let rustHttpGateway;
if (realHttpGateway) {
  controlledUpstream = await startControlledUpstream();
  rustHttpGateway = await startRustHttpGateway(realHttpGatewayBaseUrl, controlledUpstream.baseUrl);
}

const vitePort = await freePort();
const server = await createServer({
  root: path.resolve('apps/desktop'),
  logLevel: 'silent',
  plugins: [{
    name: 'applet-product-host-gate-static',
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
        const appletPrefix = `/applets-dist/${manifest.id}/`;
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
  const chrome = await runChromeProductHostGate(harnessUrl);
  const evidenceFailures = [];
  if (realHttpGateway && !productAppMode && chrome.statusText === 'PASS') {
    const echoPosts = controlledUpstream.requests.filter((request) => request.url === '/api/v1/e2e/echo');
    const agentPosts = controlledUpstream.requests.filter((request) => request.url === '/agent/turn/execute');
    const hasNetworkTaskBody = echoPosts.some((request) => request.body?.message === 'task-network');
    const hasNetworkSkillBody = echoPosts.some((request) => request.body?.message === 'skill-network');
    const hasAgentTaskBody = agentPosts.some((request) => request.body?.message === 'task-agent');
    const hasAgentSkillBody = agentPosts.some((request) => request.body?.message === 'skill-agent');
    if (!hasNetworkTaskBody) {
      evidenceFailures.push('controlled upstream did not receive task-network body');
    }
    if (!hasNetworkSkillBody) {
      evidenceFailures.push('controlled upstream did not receive skill-network body');
    }
    if (!hasAgentTaskBody) {
      evidenceFailures.push('controlled upstream did not receive task-agent body');
    }
    if (!hasAgentSkillBody) {
      evidenceFailures.push('controlled upstream did not receive skill-agent body');
    }
  }
  const statusText = evidenceFailures.length > 0 ? 'FAIL' : chrome.statusText;
  const detail = evidenceFailures.length > 0
    ? { ...chrome.detail, evidenceFailures }
    : chrome.detail;

  const output = [
    `Package: ${packageDir}`,
    `Bundle: ${bundleEntry}`,
    `Mode: ${realHttpGateway ? 'real-http-gateway' : 'stubbed-tauri-invoke'}`,
    `Shell route: ${shellRoute ? 'normal-ready-shell' : 'direct-lynx-host'}`,
    realHttpGateway ? `HTTP Gateway: ${realHttpGatewayBaseUrl}` : '',
    controlledUpstream ? `Controlled upstream: ${controlledUpstream.baseUrl}` : '',
    `Harness: ${harnessUrl}`,
    `Product host status: ${statusText}`,
    `Product host detail: ${JSON.stringify(detail)}`,
    controlledUpstream ? `Controlled upstream requests: ${JSON.stringify(controlledUpstream.requests)}` : '',
    rustHttpGateway ? `Rust HTTP Gateway stdout: ${rustHttpGateway.output().stdout}` : '',
    rustHttpGateway ? `Rust HTTP Gateway stderr: ${rustHttpGateway.output().stderr}` : '',
    `Static hits: ${JSON.stringify(staticHits)}`,
    chrome.stderr,
  ].filter(Boolean).join('\n');
  writeFileSync(outputPath, output);

  if (statusText !== 'PASS') {
    process.stderr.write(output);
    process.exit(1);
  }
  process.stdout.write(`PASS desktop ${shellRoute ? 'product shell' : 'product host'} gate evidence written to ${outputPath}\n`);
} finally {
  await server.close();
  await rustHttpGateway?.stop();
  if (controlledUpstream) {
    await new Promise((resolve) => controlledUpstream.server.close(resolve));
  }
}
