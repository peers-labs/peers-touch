const protocol = 'peers-touch.applet.bridge';
const appletId = "big-a";
const manifestPermissions = ["network.request","config.get","system.getInfo"];
const requiredMethods = ["app.getContext","app.getLaunchOptions","lifecycle.reportReady","ui.setNavigationBar","ui.showToast","device.getSafeArea","device.getWindowInfo","device.vibrate","clipboard.setText","clipboard.getText","file.write","file.read","file.list","file.getInfo","storage.set","storage.keys","storage.getInfo","network.request","network.upload","network.download","events.subscribe","events.unsubscribe","events.poll","skills.register","skills.list","tasks.start","agent.stream","ai.chat","telemetry.track"];
const realHttpGateway = true;
const realHttpGatewayBaseUrl = "http://127.0.0.1:62586";
const shellRoute = false;
const productAppMode = true;
const expectText = "多维力量分析";
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
const kernelRoute = {"descriptorId":"applet:*","pageKey":"applet:big-a","dynamic":true};

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
  const card = await waitUntil(
    () => document.querySelector('[data-page-descriptor="applets"][data-page="applets"] [data-applet-card="' + appletId + '"]'),
    5000,
    'Product shell did not render the applets list card for the manifest',
  );
  if (card.getAttribute('data-applet-status') !== 'installed') {
    throw new Error('Product shell applet list did not project installed status before launch');
  }
  if (card.getAttribute('data-applet-opened-this-session') !== 'false') {
    throw new Error('Product shell applet list used stale opened-session state before launch');
  }
  const expectedGroups = ['network', 'tasks', 'agent'].filter((item) => manifestPermissions.some((permission) => permissionGroup(permission) === item));
  const permissionGroupEvidence = [];
  for (const group of expectedGroups) {
    const chip = card.querySelector('[data-applet-permission-group="' + group + '"]');
    if (!chip) {
      throw new Error('Product shell applet list did not render permission group: ' + group);
    }
    const rawPermissions = chip.getAttribute('data-applet-permissions') || '';
    const methods = rawPermissions.split(',').filter((permission) => permissionGroup(permission) === group);
    if (!methods.some((permission) => permission.includes('.'))) {
      throw new Error('Product shell permission chip did not retain full-method permission evidence for group: ' + group);
    }
    permissionGroupEvidence.push({ group, methods });
  }
  const open = card.querySelector('[data-applet-open="' + appletId + '"]');
  if (!(open instanceof HTMLElement)) {
    throw new Error('Product shell applet list did not expose an open control');
  }
  appletListProjection = {
    appletId,
    status: card.getAttribute('data-applet-status'),
    openedThisSession: card.getAttribute('data-applet-opened-this-session'),
    permissionGroups: permissionGroupEvidence,
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
    host.setAttribute('url', '/applets-dist/' + appletId + '/' + "main.lynx.bundle");
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
