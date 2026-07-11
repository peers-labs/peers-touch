const protocol = 'peers-touch.applet.bridge';
const manifest = {"id":"web-host-certification-applet","name":"Web Host Certification Applet","version":"1.0.0","description":"External-style Web Host certification fixture for Applet runtime readiness evidence.","author":"External Producer","targets":["desktop","web"],"entries":{"lynx":"main.lynx.bundle"},"load":{"desktop":{"type":"lynx-web","entry":"main.lynx.bundle"},"web":{"type":"lynx-web","entry":"main.lynx.bundle"}},"bridge":{"protocol":"peers-touch.applet.bridge","version":"1.0.0"},"permissions":["app.getContext","app.getLaunchOptions","lifecycle.onShow","lifecycle.onHide","lifecycle.onPause","lifecycle.onResume","lifecycle.reportReady","lifecycle.destroy","network.request","network.upload","network.download","storage.get","storage.set","storage.remove","storage.clear","storage.keys","storage.getInfo","config.get","system.getInfo","device.getSafeArea","device.getWindowInfo","device.vibrate","ui.showToast","ui.setNavigationBar","clipboard.getText","clipboard.setText","file.read","file.write","file.delete","file.list","file.getInfo","events.subscribe","events.unsubscribe","events.poll","skills.register","skills.list","skills.invoke","tasks.start","tasks.get","tasks.cancel","agent.startSession","agent.send","agent.stream","ai.generate","ai.chat","telemetry.track","telemetry.reportError"],"services":[{"id":"primary-api","kind":"http","binding":"station-resolved","allowedMethods":["GET","POST"],"allowedPaths":["/api/v1/*"],"streaming":true}],"skills":[{"id":"generic-skill","inputSchema":"schemas/skill.input.json","streaming":true}],"integrity":{"algorithm":"sha256","files":{"main.lynx.bundle":"sha256:6230efdb993437adbb75cfdad8aa2c567d35c38fdf9d99a50511e80b9c8eff63","schemas/skill.input.json":"sha256:c4d95b9b646af64737800ef34eddcffa4b955b3584b4def475f09a49c3910c43"}}};
const upstreamBaseUrl = "http://127.0.0.1:53175";
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
  const sdkModule = await import("/@fs//Users/bytedance/Documents/Projects/peers-touch/peers-touch-applet/packages/applet-sdk/dist/index.js");
  assertHost(sdkModule.sdk.runtime === 'web-host', 'SDK did not detect WebHostBridgeAdapter');
  const appletModule = await import("/@fs//Users/bytedance/Documents/Projects/peers-touch/peers-touch-applet/applet-readiness-evidence/package/web-host-certification-applet/src/main.ts");
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
