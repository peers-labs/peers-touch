const appletId = 'peers.note';
const bundleEntry = "main.lynx.bundle";
const manifest = {"id":"peers.note","name":"Note","version":"0.1.0","description":"Note official applet","author":"Peers Touch","icon":"assets/icon.png","minPlatformVersion":"0.1.0","targets":["desktop","android","ios","web"],"entries":{"lynx":"main.lynx.bundle"},"load":{"desktop":{"type":"lynx-web","entry":"main.lynx.bundle"},"android":{"type":"lynx-native","entry":"main.lynx.bundle"},"ios":{"type":"lynx-native","entry":"main.lynx.bundle"},"web":{"type":"lynx-web","entry":"main.lynx.bundle"}},"bridge":{"protocol":"peers-touch.applet.bridge","version":"1.0.0"},"permissions":["app.getContext","app.getLaunchOptions","lifecycle.reportReady","network.request","storage.get","storage.set","storage.remove","ui.showToast","ui.showLoading","ui.hideLoading","ui.showModal","navigation.navigateTo","navigation.back","events.emit","events.subscribe","events.unsubscribe","telemetry.track","telemetry.reportError"],"capabilities":[],"services":[{"id":"note","kind":"http","binding":"station-resolved","allowedMethods":["GET","POST","PATCH","DELETE"],"allowedPaths":["/v1/notes","/v1/notes/*","/v1/notes:search"],"publicPathPrefix":"/v1","stationPathPrefix":"/applets/note/v1","streaming":false}],"skills":[],"integrity":{"algorithm":"sha256","files":{"main.lynx.bundle":"sha256:bdb6a956099507087e9e35bc09e4c569e579ea50dd9a2439469e7699d326842b"}}};
const status = document.getElementById('status');
const mount = document.getElementById('mount');
const invocations = [];
const hostEvents = [];
const networkRequests = [];
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
