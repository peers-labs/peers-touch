import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getFrontendRuntimeProfilerEvents,
  installFrontendRuntimeProfiler,
  markInvokeCompleted,
  markInvokeFailed,
  markInvokeStarted,
  markInteractionStarted,
  markOverlayIntent,
  markOverlayVisible,
  markRouteRequested,
  markRouteVisible,
  recordLayoutShiftDetected,
  recordLongTaskDetected,
  recordPaintTimingDetected,
  recordReactCommit,
  recordStoreUpdate,
  teardownFrontendRuntimeProfiler,
} from './frontendRuntimeProfiler';
import { log } from '../utils/logger';

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('frontend runtime profiler interaction correlation', () => {
  afterEach(() => {
    teardownFrontendRuntimeProfiler();
    vi.unstubAllGlobals();
  });

  it('correlates route events with the active interaction id', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    const interactionId = markInteractionStarted('shell', 'primary-nav:settings', {
      pageId: 'settings',
    });
    markRouteRequested('settings');
    markRouteVisible('settings');

    const events = getFrontendRuntimeProfilerEvents();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          interactionId,
          kind: 'interaction.started',
          module: 'primary-nav:settings',
        }),
        expect.objectContaining({
          interactionId,
          kind: 'route.requested',
          module: 'settings',
        }),
        expect.objectContaining({
          interactionId,
          kind: 'route.visible',
          module: 'settings',
        }),
      ]),
    );
  });

  it('correlates contextmenu intent and overlay visible events', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    const interactionId = markOverlayIntent('context-menu:chat:friend:abc', {
      surface: 'chat-conversation-context-menu',
    });
    markOverlayVisible('context-menu:chat:friend:abc', true, {
      surface: 'chat-conversation-context-menu',
    });

    const events = getFrontendRuntimeProfilerEvents();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          interactionId,
          kind: 'contextmenu.intent',
          module: 'context-menu:chat:friend:abc',
        }),
        expect.objectContaining({
          durationMs: expect.any(Number),
          interactionId,
          kind: 'overlay.visible',
          module: 'context-menu:chat:friend:abc',
        }),
      ]),
    );
  });

  it('correlates longtask events with the active interaction id', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    const interactionId = markInteractionStarted('shell', 'primary-nav:chat', {
      pageId: 'chat',
    });
    recordLongTaskDetected({
      duration: 72,
      name: 'self',
      startTime: performance.now(),
    });

    const events = getFrontendRuntimeProfilerEvents();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          durationMs: 72,
          interactionId,
          kind: 'longtask.detected',
          module: 'main-thread',
          phase: 'interaction',
          severity: 'warn',
        }),
      ]),
    );
  });

  it('does not emit sub-threshold longtask events', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    recordLongTaskDetected({
      duration: 49,
      name: 'self',
      startTime: performance.now(),
    });

    expect(getFrontendRuntimeProfilerEvents()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'longtask.detected',
        }),
      ]),
    );
  });

  it('correlates layout shift events with the active interaction id', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    const interactionId = markInteractionStarted('shell', 'primary-nav:settings', {
      pageId: 'settings',
    });
    recordLayoutShiftDetected({
      duration: 0,
      hadRecentInput: false,
      name: 'layout-shift',
      startTime: performance.now(),
      value: 0.12,
    });

    expect(getFrontendRuntimeProfilerEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          durationMs: 0.12,
          interactionId,
          kind: 'layout.shift',
          module: 'main-thread',
          phase: 'interaction',
          severity: 'warn',
          source: 'runtime',
        }),
      ]),
    );
  });

  it('does not emit layout shifts caused by recent input', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    recordLayoutShiftDetected({
      duration: 0,
      hadRecentInput: true,
      name: 'layout-shift',
      startTime: performance.now(),
      value: 0.2,
    });

    expect(getFrontendRuntimeProfilerEvents()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'layout.shift',
        }),
      ]),
    );
  });

  it('records paint timing events as startup evidence without an active interaction', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    recordPaintTimingDetected({
      duration: 0,
      name: 'first-contentful-paint',
      startTime: 123,
    });

    expect(getFrontendRuntimeProfilerEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          durationMs: 123,
          kind: 'paint.timing',
          module: 'main-thread',
          phase: 'startup',
          source: 'runtime',
        }),
      ]),
    );
  });

  it('correlates React commit events with the active interaction id', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    const interactionId = markInteractionStarted('shell', 'primary-nav:settings', {
      pageId: 'settings',
    });
    recordReactCommit({
      actualDuration: 12.5,
      baseDuration: 30,
      commitTime: performance.now(),
      data: { descriptorId: 'settings' },
      id: 'page-frame:settings',
      owner: 'settings',
      pageId: 'settings',
      phase: 'update',
      source: 'page-host',
      startTime: performance.now() - 12.5,
    });

    const events = getFrontendRuntimeProfilerEvents();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          durationMs: 12.5,
          interactionId,
          kind: 'react.commit',
          module: 'page-frame:settings',
          owner: 'settings',
          pageId: 'settings',
          phase: 'interaction',
          source: 'page-host',
        }),
      ]),
    );
  });

  it('correlates store update events with the active interaction id', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    const interactionId = markInteractionStarted('shell', 'primary-nav:chat', {
      pageId: 'chat',
    });
    recordStoreUpdate({
      changedKeys: ['selectedConversationId', 'unreadCount'],
      fanout: 'unknown',
      listenerCount: 'unknown',
      store: 'socialChat',
    });

    const events = getFrontendRuntimeProfilerEvents();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          interactionId,
          kind: 'store.update',
          module: 'socialChat',
          owner: 'unknown',
          phase: 'interaction',
          source: 'store',
        }),
      ]),
    );
  });

  it('correlates invoke events with the active interaction id', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    const interactionId = markInteractionStarted('shell', 'primary-nav:settings', {
      pageId: 'settings',
    });
    const returnedInteractionId = markInvokeStarted('settings_load', {
      source: 'browser-gateway',
    });
    markInvokeCompleted('settings_load', 18, {
      source: 'browser-gateway',
    });
    markInvokeFailed('settings_save', 22, {
      source: 'browser-gateway',
    });

    expect(returnedInteractionId).toBe(interactionId);
    expect(getFrontendRuntimeProfilerEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          interactionId,
          kind: 'invoke.started',
          module: 'settings_load',
          owner: 'settings_load',
          phase: 'interaction',
          source: 'invoke',
        }),
        expect.objectContaining({
          durationMs: 18,
          interactionId,
          kind: 'invoke.completed',
          module: 'settings_load',
          owner: 'settings_load',
          phase: 'interaction',
          source: 'invoke',
        }),
        expect.objectContaining({
          durationMs: 22,
          interactionId,
          kind: 'invoke.failed',
          module: 'settings_save',
          owner: 'settings_save',
          phase: 'interaction',
          severity: 'warn',
          source: 'invoke',
        }),
      ]),
    );
  });

  it('records ready shell React commit source metadata', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    recordReactCommit({
      actualDuration: 8,
      baseDuration: 14,
      commitTime: performance.now(),
      data: { surface: 'ready-shell' },
      id: 'ready-shell',
      owner: 'ready-shell',
      phase: 'mount',
      source: 'shell',
      startTime: performance.now() - 8,
    });

    expect(getFrontendRuntimeProfilerEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          durationMs: 8,
          kind: 'react.commit',
          module: 'ready-shell',
          owner: 'ready-shell',
          phase: 'background',
          source: 'shell',
        }),
      ]),
    );
  });

  it('records overlay host React commit source metadata', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    const interactionId = markOverlayIntent('context-menu:chat:friend:abc');
    recordReactCommit({
      actualDuration: 6,
      baseDuration: 9,
      commitTime: performance.now(),
      data: { surface: 'chat-conversation-context-menu' },
      id: 'overlay-host:context-menu:chat:friend:abc',
      owner: 'context-menu:chat:friend:abc',
      phase: 'update',
      source: 'overlay',
      startTime: performance.now() - 6,
    });

    expect(getFrontendRuntimeProfilerEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          durationMs: 6,
          interactionId,
          kind: 'react.commit',
          module: 'overlay-host:context-menu:chat:friend:abc',
          owner: 'context-menu:chat:friend:abc',
          phase: 'interaction',
          source: 'overlay',
        }),
      ]),
    );
  });

  it('does not route high-frequency profiler events through the logger bridge', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();
    vi.mocked(log.info).mockClear();

    const interactionId = markInteractionStarted('shell', 'primary-nav:settings');
    markRouteRequested('settings');
    recordStoreUpdate({
      changedKeys: ['loading'],
      fanout: 18,
      listenerCount: 18,
      store: 'socialChat',
    });
    recordReactCommit({
      actualDuration: 24,
      baseDuration: 32,
      commitTime: performance.now(),
      id: 'ready-shell',
      owner: 'ready-shell',
      phase: 'update',
      source: 'shell',
      startTime: performance.now() - 24,
    });

    expect(getFrontendRuntimeProfilerEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ interactionId, kind: 'interaction.started' }),
        expect.objectContaining({ interactionId, kind: 'route.requested' }),
        expect.objectContaining({ interactionId, kind: 'store.update' }),
        expect.objectContaining({ interactionId, kind: 'react.commit' }),
      ]),
    );
    expect(log.info).not.toHaveBeenCalled();
  });
});
