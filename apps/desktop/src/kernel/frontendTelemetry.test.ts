import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FRONTEND_TELEMETRY_SCHEMA_VERSION,
  _resetFrontendTelemetryForTests,
  configureFrontendTelemetryUploader,
  emitFrontendTelemetryEvent,
  flushFrontendTelemetryEvents,
  getFrontendTelemetryDroppedCount,
  getFrontendTelemetryEvents,
  installFrontendTelemetryQueue,
} from './frontendTelemetry';

describe('frontend telemetry queue', () => {
  afterEach(() => {
    _resetFrontendTelemetryForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('emits the shared envelope and exposes dev inspection state', () => {
    vi.stubGlobal('window', {});
    installFrontendTelemetryQueue({ runtime: 'browser-gateway' });

    const event = emitFrontendTelemetryEvent({
      kind: 'boot.phase',
      module: 'boot',
      phase: 'startup',
      source: 'runtime',
      data: { state: 'start' },
    });

    expect(event).toMatchObject({
      kind: 'boot.phase',
      module: 'boot',
      runtime: 'browser-gateway',
      schemaVersion: FRONTEND_TELEMETRY_SCHEMA_VERSION,
      source: 'runtime',
    });
    expect(event?.id).toEqual(expect.any(String));
    expect(window.__PT_FRONTEND_TELEMETRY__?.getEvents()).toHaveLength(1);
    expect(window.__PT_FRONTEND_RUNTIME_EVENTS__).toBe(getFrontendTelemetryEvents());
  });

  it('uses epoch-compatible timestamps for Station query ordering', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('performance', {
      timeOrigin: 1_783_503_302_000,
      now: () => 42.5,
    });
    installFrontendTelemetryQueue({ runtime: 'browser-gateway' });

    const event = emitFrontendTelemetryEvent({
      kind: 'route.visible',
      module: 'chat',
      source: 'shell',
    });

    expect(event?.ts).toBe(1_783_503_302_042.5);
  });

  it('bounds the queue and reports dropped event count', () => {
    vi.stubGlobal('window', {});
    installFrontendTelemetryQueue({ maxEvents: 2, runtime: 'browser-gateway' });

    for (const module of ['one', 'two', 'three']) {
      emitFrontendTelemetryEvent({
        kind: 'runtime.install',
        module,
        source: 'runtime',
      });
    }

    expect(getFrontendTelemetryEvents().map((event) => event.module)).toEqual(['two', 'three']);
    expect(getFrontendTelemetryDroppedCount()).toBe(1);
    expect(window.__PT_FRONTEND_TELEMETRY__?.getDroppedCount()).toBe(1);
  });

  it('exposes a contract snapshot with kind and interaction coverage', () => {
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:3210/#/chat' },
    });
    installFrontendTelemetryQueue({ maxEvents: 2, runtime: 'browser-gateway' });

    emitFrontendTelemetryEvent({
      interactionId: 'interaction-1',
      kind: 'interaction.started',
      module: 'primary-nav:chat',
      phase: 'interaction',
      source: 'shell',
    });
    emitFrontendTelemetryEvent({
      interactionId: 'interaction-1',
      kind: 'route.visible',
      module: 'chat',
      phase: 'interaction',
      source: 'shell',
    });
    emitFrontendTelemetryEvent({
      kind: 'paint.timing',
      module: 'main-thread',
      source: 'runtime',
    });

    const snapshot = window.__PT_FRONTEND_TELEMETRY__?.snapshot();

    expect(snapshot).toMatchObject({
      byKind: {
        'paint.timing': 1,
        'route.visible': 1,
      },
      droppedByKind: {
        'interaction.started': 1,
      },
      droppedCount: 1,
      droppedWithInteraction: {
        'interaction.started': 1,
      },
      eventCount: 2,
      maxEvents: 2,
      runtime: 'browser-gateway',
      source: 'window.__PT_FRONTEND_TELEMETRY__',
      url: 'http://localhost:3210/#/chat',
      withInteraction: {
        'route.visible': 1,
      },
    });
    expect(snapshot?.events).toHaveLength(2);
  });

  it('redacts sensitive payload fields before queueing', () => {
    vi.stubGlobal('window', {});
    installFrontendTelemetryQueue({ runtime: 'browser-gateway' });

    const sensitiveKeys = { pw: 'password', sec: 'secret', tok: 'accessToken' };
    const event = emitFrontendTelemetryEvent({
      kind: 'runtime.bootstrap',
      module: 'social',
      source: 'runtime',
      data: {
        actorId: 'actor-1',
        [sensitiveKeys.pw]: 'hunter2',
        nested: { [sensitiveKeys.tok]: 'tk-abc' },
      },
      tags: {
        count: 1,
        [sensitiveKeys.sec]: 'val-xyz',
      },
    });

    expect(event?.data).toMatchObject({
      actorId: 'actor-1',
      [sensitiveKeys.pw]: '[redacted]',
      nested: { [sensitiveKeys.tok]: '[redacted]' },
    });
    expect(event?.tags).toEqual({
      count: 1,
      [sensitiveKeys.sec]: '[redacted]',
    });
  });

  it('classifies a real Tauri WebView runtime separately from the browser gateway polyfill', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    installFrontendTelemetryQueue();

    const nativeEvent = emitFrontendTelemetryEvent({
      kind: 'route.visible',
      module: 'chat',
      source: 'shell',
    });

    expect(nativeEvent?.runtime).toBe('tauri-webview-dev');

    _resetFrontendTelemetryForTests();
    vi.stubGlobal('window', {
      __PT_GATEWAY_BASE__: 'http://127.0.0.1:3030',
      __TAURI_INTERNALS__: {},
    });
    installFrontendTelemetryQueue();

    const gatewayEvent = emitFrontendTelemetryEvent({
      kind: 'route.visible',
      module: 'chat',
      source: 'shell',
    });

    expect(gatewayEvent?.runtime).toBe('browser-gateway');
  });

  it('auto flushes queued events after an uploader is configured', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {});
    installFrontendTelemetryQueue({ runtime: 'browser-gateway' });
    const uploader = vi.fn(async (events) => ({
      accepted: events.length,
      failed: 0,
      rejected: 0,
      uploaded: true,
    }));
    configureFrontendTelemetryUploader(uploader);

    emitFrontendTelemetryEvent({
      kind: 'route.visible',
      module: 'chat',
      source: 'shell',
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(uploader).toHaveBeenCalledTimes(1);
    expect(getFrontendTelemetryEvents()).toHaveLength(1);
    expect(window.__PT_FRONTEND_TELEMETRY__?.getEvents()).toHaveLength(1);
    vi.useRealTimers();
  });

  it('manual flush uses the configured uploader', async () => {
    vi.stubGlobal('window', {});
    installFrontendTelemetryQueue({ runtime: 'browser-gateway' });
    configureFrontendTelemetryUploader(async (events) => ({
      accepted: events.length,
      failed: 0,
      rejected: 0,
      uploaded: true,
    }));

    emitFrontendTelemetryEvent({
      kind: 'overlay.visible',
      module: 'chat',
      source: 'overlay',
    });

    const result = await flushFrontendTelemetryEvents();

    expect(result).toMatchObject({ accepted: 1, uploaded: true });
    expect(getFrontendTelemetryEvents()).toHaveLength(1);
  });

  it('keeps queued events and retries after an upload failure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {});
    installFrontendTelemetryQueue({ runtime: 'tauri-webview-dev' });
    const uploader = vi.fn()
      .mockRejectedValueOnce(new Error('upstream unavailable'))
      .mockResolvedValueOnce({
        accepted: 1,
        failed: 0,
        rejected: 0,
        uploaded: true,
      });
    configureFrontendTelemetryUploader(uploader);

    emitFrontendTelemetryEvent({
      kind: 'route.visible',
      module: 'chat',
      source: 'shell',
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(uploader).toHaveBeenCalledTimes(2);
    expect(getFrontendTelemetryEvents()).toHaveLength(1);
    vi.useRealTimers();
  });
});
