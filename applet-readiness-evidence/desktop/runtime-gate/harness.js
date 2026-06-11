const protocol = 'peers-touch.applet.bridge';
const appletId = "generic-complex-applet";
const sessionId = 'desktop-runtime-gate-session';
const requiredMethods = ["app.getContext","app.getLaunchOptions","lifecycle.reportReady","ui.setNavigationBar","ui.showToast","device.getSafeArea","device.getWindowInfo","device.vibrate","clipboard.setText","clipboard.getText","file.write","file.read","file.list","file.getInfo","storage.set","storage.keys","storage.getInfo","network.request","network.upload","network.download","events.subscribe","events.unsubscribe","skills.register","skills.list","skills.invoke","tasks.start","agent.stream","ai.chat","telemetry.track"];
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
view.url = "/applets-dist/generic-complex-applet/main.lynx.bundle";

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
