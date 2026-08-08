#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppletError, AppletSDK, StandaloneBridgeAdapter } from '../../packages/applet-sdk/dist/index.js';

const evidenceRoot = path.resolve('.artifacts/applet-readiness');
mkdirSync(path.join(evidenceRoot, 'sdk'), { recursive: true });

function write(relative, content) {
  writeFileSync(path.join(evidenceRoot, relative), `${content.trim()}\n`);
}

class FakeBridgeAdapter {
  name = 'fake';
  invocations = [];
  eventHandlers = new Set();
  bridgeUnsubscribed = false;

  async invoke(method, params) {
    this.invocations.push({ method, params });
    switch (method) {
      case 'app.getContext':
        return {
          appletId: 'sdk-adapter-applet',
          sessionId: 'sdk-adapter-session',
          platform: 'desktop',
          runtime: 'lynx',
        };
      case 'app.getLaunchOptions':
        return { source: 'sdk-adapter-test', query: { tab: 'overview' } };
      case 'system.getInfo':
        return { platform: 'desktop', version: '0.1.0', appName: 'Peers Touch' };
      case 'system.getTheme':
        return 'dark';
      case 'system.getNetworkType':
        return 'wifi';
      case 'config.get':
        return { value: 'config-value' };
      case 'storage.get':
        return { value: 'stored-value' };
      case 'storage.keys':
        return ['alpha', 'alpha.child'];
      case 'storage.getInfo':
        return { quotaBytes: 1024, usedBytes: 128, keys: ['alpha'] };
      case 'network.request':
        return { status: 200, headers: { 'x-sdk-test': 'ok' }, body: { ok: true } };
      case 'network.upload':
        return { status: 201, headers: { 'x-upload': 'ok' }, body: { uploaded: true } };
      case 'network.download':
        return { status: 200, headers: { 'x-download': 'ok' }, file: { path: 'downloads/report.json', sizeBytes: 42 } };
      case 'device.getSafeArea':
        return { top: 1, right: 2, bottom: 3, left: 4 };
      case 'device.getWindowInfo':
        return { width: 390, height: 844, pixelRatio: 3 };
      case 'clipboard.getText':
        return 'clipboard-value';
      case 'file.read':
        return { path: params.path, content: 'file-content', sizeBytes: 12, encoding: 'utf8' };
      case 'file.write':
        return { path: params.path, sizeBytes: String(params.content ?? '').length };
      case 'file.list':
        return [{ path: 'notes/a.txt', kind: 'file', sizeBytes: 12 }];
      case 'file.getInfo':
        return { quotaBytes: 4096, usedBytes: 12, entries: [{ path: 'notes/a.txt', kind: 'file', sizeBytes: 12 }] };
      case 'skills.list':
        return [{ id: 'sdk.echo', title: 'SDK Echo', inputSchema: 'schemas/skill.input.json', streaming: true }];
      case 'skills.invoke':
        if (params.options?.stream === true) {
          this.emit('skill.stream', {
            skillId: params.skillId,
            type: 'chunk',
            payload: { value: params.input },
            sequence: 1,
          });
        }
        return { ok: true, output: { skillId: params.skillId, input: params.input } };
      case 'tasks.start':
        return { taskId: 'task-1', state: 'queued', createdAt: '2026-06-09T00:00:00.000Z' };
      case 'tasks.get':
        return { taskId: params.taskId, state: 'completed', output: { ok: true }, updatedAt: '2026-06-09T00:00:01.000Z' };
      case 'agent.startSession':
        return { sessionId: 'agent-session-1', status: 'active' };
      case 'agent.send':
        return { messageId: 'agent-message-2', content: 'sent' };
      case 'tasks.cancel':
        return { ok: true };
      case 'ui.showModal':
        return { confirmed: true, cancelled: false };
      case 'ui.showActionSheet':
        return { selectedIndex: 0, selectedItem: 'First', cancelled: false };
      case 'ai.generate':
        return { text: 'generated text', usage: { inputTokens: 1, outputTokens: 2 } };
      case 'agent.stream':
        this.emit('agent.stream', {
          requestId: 'agent-request-1',
          type: 'partial',
          payload: { content: 'streamed' },
          sequence: 1,
        });
        return { messageId: 'agent-message-1', content: 'complete' };
      case 'ai.chat':
        throw new AppletError(
          'PERMISSION_DENIED',
          'AI chat denied by fake policy',
          { policy: 'sdk-adapter-test' },
          'request-denied-1',
        );
      default:
        return { ok: true };
    }
  }

  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => {
      this.bridgeUnsubscribed = true;
      this.eventHandlers.delete(handler);
    };
  }

  emit(topic, payload) {
    for (const handler of this.eventHandlers) {
      handler(topic, payload);
    }
  }
}

const adapter = new FakeBridgeAdapter();
const sdk = new AppletSDK(adapter);

const unavailableSdk = new AppletSDK();
assert.equal(unavailableSdk.runtime, 'unavailable');
await assert.rejects(
  () => unavailableSdk.app.getContext(),
  (error) => error instanceof AppletError
    && error.code === 'RUNTIME_LOAD_FAILED'
    && error.details?.standaloneOptIn === '__PEERS_TOUCH_APPLET_STANDALONE__',
);
unavailableSdk.destroy();

globalThis.__PEERS_TOUCH_APPLET_STANDALONE__ = true;
const standaloneAutoSdk = new AppletSDK();
assert.equal(standaloneAutoSdk.runtime, 'standalone');
assert.deepEqual(await standaloneAutoSdk.app.getContext(), {
  appletId: 'standalone',
  sessionId: 'standalone',
  platform: 'standalone',
  runtime: 'standalone',
  sdkVersion: '1.0.0',
  bridgeProtocol: 'peers-touch.applet.bridge',
});
standaloneAutoSdk.destroy();
delete globalThis.__PEERS_TOUCH_APPLET_STANDALONE__;

const explicitStandaloneContext = await new StandaloneBridgeAdapter().invoke('app.getContext');
assert.equal(explicitStandaloneContext.platform, 'standalone');
assert.equal(explicitStandaloneContext.runtime, 'standalone');

const context = await sdk.app.getContext();
assert.equal(context.appletId, 'sdk-adapter-applet');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'app.getContext',
  params: undefined,
});

const launchOptions = await sdk.app.getLaunchOptions();
assert.deepEqual(launchOptions, { source: 'sdk-adapter-test', query: { tab: 'overview' } });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'app.getLaunchOptions',
  params: undefined,
});

await sdk.lifecycle.reportReady();
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'lifecycle.reportReady',
  params: undefined,
});

assert.deepEqual(await sdk.system.getInfo(), { platform: 'desktop', version: '0.1.0', appName: 'Peers Touch' });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'system.getInfo',
  params: undefined,
});

assert.equal(await sdk.system.getTheme(), 'dark');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'system.getTheme',
  params: undefined,
});

assert.equal(await sdk.system.getNetworkType(), 'wifi');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'system.getNetworkType',
  params: undefined,
});

assert.equal(await sdk.config.get('feature.flag'), 'config-value');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'config.get',
  params: { key: 'feature.flag' },
});

const stored = await sdk.storage.get('alpha');
assert.equal(stored, 'stored-value');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'storage.get',
  params: { key: 'alpha' },
});

await sdk.storage.set('alpha', { nested: true });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'storage.set',
  params: { key: 'alpha', value: { nested: true } },
});

await sdk.storage.remove('alpha');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'storage.remove',
  params: { key: 'alpha' },
});

await sdk.storage.clear();
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'storage.clear',
  params: undefined,
});

assert.deepEqual(await sdk.storage.keys('alpha'), ['alpha', 'alpha.child']);
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'storage.keys',
  params: { prefix: 'alpha' },
});

assert.deepEqual(await sdk.storage.getInfo(), { quotaBytes: 1024, usedBytes: 128, keys: ['alpha'] });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'storage.getInfo',
  params: undefined,
});

const network = await sdk.network.request({
  service: 'primary-api',
  path: '/api/v1/e2e',
  method: 'GET',
});
assert.equal(network.status, 200);
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'network.request',
  params: {
    service: 'primary-api',
    path: '/api/v1/e2e',
    method: 'GET',
  },
});

const upload = await sdk.network.upload({
  service: 'primary-api',
  path: '/api/v1/e2e/upload',
  filePath: 'sandbox/input.json',
});
assert.equal(upload.status, 201);
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'network.upload',
  params: {
    service: 'primary-api',
    path: '/api/v1/e2e/upload',
    filePath: 'sandbox/input.json',
  },
});

const download = await sdk.network.download({
  service: 'primary-api',
  path: '/api/v1/e2e/download',
  filePath: 'downloads/report.json',
});
assert.deepEqual(download.file, { path: 'downloads/report.json', sizeBytes: 42 });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'network.download',
  params: {
    service: 'primary-api',
    path: '/api/v1/e2e/download',
    filePath: 'downloads/report.json',
  },
});

assert.deepEqual(await sdk.device.getSafeArea(), { top: 1, right: 2, bottom: 3, left: 4 });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'device.getSafeArea',
  params: undefined,
});

assert.deepEqual(await sdk.device.getWindowInfo(), { width: 390, height: 844, pixelRatio: 3 });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'device.getWindowInfo',
  params: undefined,
});

await sdk.device.vibrate({ durationMs: 10 });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'device.vibrate',
  params: { durationMs: 10 },
});

assert.equal(await sdk.clipboard.getText(), 'clipboard-value');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'clipboard.getText',
  params: undefined,
});

await sdk.clipboard.setText({ text: 'clipboard-value', userActivated: true });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'clipboard.setText',
  params: { text: 'clipboard-value', userActivated: true },
});

assert.deepEqual(await sdk.file.read({ path: 'notes/a.txt' }), {
  path: 'notes/a.txt',
  content: 'file-content',
  sizeBytes: 12,
  encoding: 'utf8',
});
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'file.read',
  params: { path: 'notes/a.txt' },
});

assert.deepEqual(await sdk.file.write({ path: 'notes/a.txt', content: 'updated' }), {
  path: 'notes/a.txt',
  sizeBytes: 7,
});
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'file.write',
  params: { path: 'notes/a.txt', content: 'updated' },
});

await sdk.file.delete({ path: 'notes/a.txt' });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'file.delete',
  params: { path: 'notes/a.txt' },
});

assert.deepEqual(await sdk.file.list({ path: 'notes' }), [{ path: 'notes/a.txt', kind: 'file', sizeBytes: 12 }]);
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'file.list',
  params: { path: 'notes' },
});

assert.deepEqual(await sdk.file.getInfo(), {
  quotaBytes: 4096,
  usedBytes: 12,
  entries: [{ path: 'notes/a.txt', kind: 'file', sizeBytes: 12 }],
});
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'file.getInfo',
  params: undefined,
});

await sdk.navigation.navigateTo({ page: 'applets' });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'navigation.navigateTo',
  params: { page: 'applets' },
});

await sdk.navigation.openApplet({ appletId: 'generic-complex-applet', launchParams: { source: 'sdk-adapter-test' } });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'navigation.openApplet',
  params: { appletId: 'generic-complex-applet', launchParams: { source: 'sdk-adapter-test' } },
});

await sdk.navigation.redirectTo({ page: 'applet:generic-complex-applet' });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'navigation.redirectTo',
  params: { page: 'applet:generic-complex-applet' },
});

await sdk.navigation.back(2);
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'navigation.back',
  params: { delta: 2 },
});

await sdk.navigation.closeApplet('done');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'navigation.closeApplet',
  params: { reason: 'done' },
});

await sdk.ui.showToast({ message: 'Ready', type: 'success', durationMs: 1000 });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'ui.showToast',
  params: { message: 'Ready', type: 'success', durationMs: 1000 },
});

await sdk.ui.showLoading({ message: 'Loading' });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'ui.showLoading',
  params: { message: 'Loading' },
});

await sdk.ui.hideLoading();
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'ui.hideLoading',
  params: undefined,
});

await sdk.ui.setNavigationBar({ title: 'Generic Complex Applet' });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'ui.setNavigationBar',
  params: { title: 'Generic Complex Applet' },
});

const modalResult = await sdk.ui.showModal({ title: 'Confirm', content: 'Proceed' });
assert.deepEqual(modalResult, { confirmed: true, cancelled: false });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'ui.showModal',
  params: { title: 'Confirm', content: 'Proceed' },
});

const actionSheetResult = await sdk.ui.showActionSheet({ title: 'Pick', items: ['First', { label: 'Second', value: 2 }] });
assert.deepEqual(actionSheetResult, { selectedIndex: 0, selectedItem: 'First', cancelled: false });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'ui.showActionSheet',
  params: { title: 'Pick', items: ['First', { label: 'Second', value: 2 }] },
});

await sdk.events.subscribe('task.event');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'events.subscribe',
  params: { topic: 'task.event' },
});

await sdk.events.emit('custom.event', { ok: true });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'events.emit',
  params: { topic: 'custom.event', payload: { ok: true } },
});

const taskEvents = [];
const unsubscribeTask = sdk.tasks.onEvent('task-1', (event) => taskEvents.push(event));
adapter.emit('task.event', { taskId: 'other-task', state: 'progress' });
adapter.emit('task.event', { taskId: 'task-1', state: 'progress', sequence: 1 });
assert.deepEqual(taskEvents, [{ taskId: 'task-1', state: 'progress', sequence: 1 }]);
unsubscribeTask();
adapter.emit('task.event', { taskId: 'task-1', state: 'completed', sequence: 2 });
assert.equal(taskEvents.length, 1);
await sdk.events.unsubscribe('task.event');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'events.unsubscribe',
  params: { topic: 'task.event' },
});

const skillSpec = {
  id: 'sdk.echo',
  title: 'SDK Echo',
  inputSchema: 'schemas/skill.input.json',
  streaming: true,
};
await sdk.skills.register(skillSpec);
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'skills.register',
  params: { spec: skillSpec },
});

assert.deepEqual(await sdk.skills.list(), [skillSpec]);
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'skills.list',
  params: undefined,
});

const skillEvents = [];
const unsubscribeSkill = sdk.skills.onStream('sdk.echo', (event) => skillEvents.push(event));
adapter.emit('skill.stream', { skillId: 'other.skill', type: 'chunk', sequence: 0 });
adapter.emit('skill.stream', { skillId: 'sdk.echo', type: 'chunk', sequence: 1 });
assert.deepEqual(skillEvents, [{ skillId: 'sdk.echo', type: 'chunk', sequence: 1 }]);
unsubscribeSkill();

const streamingSkill = await sdk.skills.invoke('sdk.echo', { value: 1 }, { stream: true });
assert.deepEqual(streamingSkill, { ok: true, output: { skillId: 'sdk.echo', input: { value: 1 } } });
assert.deepEqual(adapter.invocations.slice(-3), [
  { method: 'events.subscribe', params: { topic: 'skill.stream' } },
  { method: 'skills.invoke', params: { skillId: 'sdk.echo', input: { value: 1 }, options: { stream: true } } },
  { method: 'events.unsubscribe', params: { topic: 'skill.stream' } },
]);

const nonStreamingSkill = await sdk.skills.invoke('sdk.echo', { value: 2 });
assert.deepEqual(nonStreamingSkill, { ok: true, output: { skillId: 'sdk.echo', input: { value: 2 } } });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'skills.invoke',
  params: { skillId: 'sdk.echo', input: { value: 2 }, options: undefined },
});

let lifecycleShowCount = 0;
const unsubscribeShow = sdk.lifecycle.onShow(() => {
  lifecycleShowCount += 1;
});
adapter.emit('show', { reason: 'sdk-adapter-test' });
assert.equal(lifecycleShowCount, 1);
unsubscribeShow();
adapter.emit('show', { reason: 'after-unsubscribe' });
assert.equal(lifecycleShowCount, 1);

const taskHandle = await sdk.tasks.start({ kind: 'readiness', input: { value: 1 } });
assert.deepEqual(taskHandle, { taskId: 'task-1', state: 'queued', createdAt: '2026-06-09T00:00:00.000Z' });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'tasks.start',
  params: { kind: 'readiness', input: { value: 1 } },
});

await sdk.tasks.start({ taskType: 'agent', input: { message: 'task-agent' } });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'tasks.start',
  params: { taskType: 'agent', input: { message: 'task-agent' } },
});

const taskSnapshot = await sdk.tasks.get('task-1');
assert.deepEqual(taskSnapshot, {
  taskId: 'task-1',
  state: 'completed',
  output: { ok: true },
  updatedAt: '2026-06-09T00:00:01.000Z',
});
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'tasks.get',
  params: { taskId: 'task-1' },
});

await sdk.tasks.cancel('task-1');
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'tasks.cancel',
  params: { taskId: 'task-1' },
});

assert.deepEqual(await sdk.agent.startSession({ topic: 'sdk-adapter-test' }), {
  sessionId: 'agent-session-1',
  status: 'active',
});
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'agent.startSession',
  params: { topic: 'sdk-adapter-test' },
});

assert.deepEqual(await sdk.agent.send({ sessionId: 'agent-session-1', message: 'send through adapter' }), {
  messageId: 'agent-message-2',
  content: 'sent',
});
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'agent.send',
  params: { sessionId: 'agent-session-1', message: 'send through adapter' },
});

const agentEvents = [];
const agentResult = await sdk.agent.stream(
  { message: 'stream through fake adapter' },
  (event) => agentEvents.push(event),
);
assert.deepEqual(agentResult, { messageId: 'agent-message-1', content: 'complete' });
assert.equal(agentEvents.length, 1);
assert.equal(agentEvents[0].type, 'partial');
assert.deepEqual(adapter.invocations.slice(-3), [
  { method: 'events.subscribe', params: { topic: 'agent.stream' } },
  { method: 'agent.stream', params: { message: 'stream through fake adapter' } },
  { method: 'events.unsubscribe', params: { topic: 'agent.stream' } },
]);

assert.deepEqual(await sdk.ai.generate({ prompt: 'generate this' }), {
  text: 'generated text',
  usage: { inputTokens: 1, outputTokens: 2 },
});
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'ai.generate',
  params: { prompt: 'generate this' },
});

await assert.rejects(
  () => sdk.ai.chat({ messages: [{ role: 'user', content: 'deny me' }] }),
  (error) => {
    assert.ok(error instanceof AppletError);
    assert.equal(error.code, 'PERMISSION_DENIED');
    assert.equal(error.requestId, 'request-denied-1');
    assert.deepEqual(error.details, { policy: 'sdk-adapter-test' });
    return true;
  },
);

await sdk.telemetry.track({ name: 'sdk.adapter.ready', properties: { ok: true } });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'telemetry.track',
  params: { event: { name: 'sdk.adapter.ready', properties: { ok: true } } },
});

await sdk.telemetry.reportError({ code: 'SDK_TEST', message: 'diagnostic' });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'telemetry.reportError',
  params: { error: { code: 'SDK_TEST', message: 'diagnostic' } },
});

await sdk.telemetry.mark({ name: 'sdk.adapter.mark', startTimeMs: 1, durationMs: 2 });
assert.deepEqual(adapter.invocations.at(-1), {
  method: 'telemetry.mark',
  params: { name: 'sdk.adapter.mark', startTimeMs: 1, durationMs: 2 },
});

const refAdapter = new FakeBridgeAdapter();
const refSdk = new AppletSDK(refAdapter);
await refSdk.events.subscribe('agent.stream');
await refSdk.events.subscribe('agent.stream');
assert.deepEqual(refAdapter.invocations, [
  { method: 'events.subscribe', params: { topic: 'agent.stream' } },
]);
await refSdk.events.unsubscribe('agent.stream');
assert.deepEqual(refAdapter.invocations, [
  { method: 'events.subscribe', params: { topic: 'agent.stream' } },
]);
await refSdk.events.unsubscribe('agent.stream');
assert.deepEqual(refAdapter.invocations, [
  { method: 'events.subscribe', params: { topic: 'agent.stream' } },
  { method: 'events.unsubscribe', params: { topic: 'agent.stream' } },
]);
refSdk.destroy();

sdk.destroy();
assert.equal(adapter.bridgeUnsubscribed, true);

const sdkCoreTypes = readFileSync(path.resolve('packages/applet-sdk/dist/capabilities/core.d.ts'), 'utf8');
const sdkNetworkTypes = readFileSync(path.resolve('packages/applet-sdk/dist/capabilities/network.d.ts'), 'utf8');
const sdkDeviceTypes = readFileSync(path.resolve('packages/applet-sdk/dist/capabilities/device.d.ts'), 'utf8');
const sdkFileTypes = readFileSync(path.resolve('packages/applet-sdk/dist/capabilities/file.d.ts'), 'utf8');
const sdkIndexTypes = readFileSync(path.resolve('packages/applet-sdk/dist/index.d.ts'), 'utf8');
assert.match(sdkCoreTypes, /openApplet\(input: OpenAppletInput\): Promise<void>/);
assert.match(sdkCoreTypes, /navigateTo\(input: NavigateToInput\): Promise<void>/);
assert.match(sdkCoreTypes, /showToast\(input: ToastOptions\): Promise<void>/);
assert.match(sdkCoreTypes, /showModal\(input: ModalOptions\): Promise<ModalResult>/);
assert.match(sdkCoreTypes, /showActionSheet\(input: ActionSheetOptions\): Promise<ActionSheetResult>/);
assert.match(sdkCoreTypes, /startSession\(input: AgentSessionInput\): Promise<AgentSession>/);
assert.match(sdkCoreTypes, /generate\(input: GenerateInput\): Promise<GenerateResult>/);
assert.match(sdkCoreTypes, /track\(event: TelemetryEvent\): Promise<void>/);
assert.doesNotMatch(sdkCoreTypes, /showModal\(input: Record<string, unknown>\): Promise<unknown>/);
assert.match(sdkNetworkTypes, /upload<TBody = unknown>\(options: NetworkUploadOptions\): Promise<NetworkUploadResult<TBody>>/);
assert.match(sdkNetworkTypes, /download<TBody = unknown>\(options: NetworkDownloadOptions\): Promise<NetworkDownloadResult<TBody>>/);
assert.match(sdkDeviceTypes, /getSafeArea\(\): Promise<SafeArea>/);
assert.match(sdkFileTypes, /write\(input: FileWriteOptions\): Promise<FileWriteResult>/);
assert.match(sdkIndexTypes, /readonly clipboard: ClipboardAPI/);
assert.match(sdkIndexTypes, /readonly file: FileAPI/);

write('sdk/adapter-test-output.txt', [
  'PASS SDK maps app, lifecycle, system, config, storage, network, device, clipboard, file, navigation, UI, events, skills, tasks, agent, AI, and telemetry APIs to canonical BridgeAdapter methods.',
  'PASS SDK no longer auto-falls back to standalone when no Lynx/WebHost bridge exists.',
  'PASS SDK standalone runtime requires explicit opt-in or explicit StandaloneBridgeAdapter construction.',
  'PASS SDK standalone context reports standalone platform/runtime and does not masquerade as Web Host.',
  'PASS SDK exposes typed navigation, UI, network upload/download, device, file, agent, AI, and telemetry models in generated declarations.',
  'PASS SDK maps explicit event subscribe/unsubscribe calls to Gateway capabilities.',
  'PASS SDK reference-counts duplicate topic subscriptions before Gateway unsubscribe.',
  'PASS SDK skill stream invocation brackets event delivery with Gateway subscription state.',
  'PASS SDK agent stream brackets event delivery with Gateway subscription state.',
  'PASS SDK event helpers filter skill/task/lifecycle events and unsubscribe correctly.',
  'PASS SDK preserves canonical AppletError code, details, and requestId.',
  'PASS SDK destroy unsubscribes the underlying bridge event listener.',
].join('\n'));

process.stdout.write('PASS applet SDK adapter tests\n');
