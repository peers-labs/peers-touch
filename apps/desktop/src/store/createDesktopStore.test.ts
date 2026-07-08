import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getFrontendRuntimeProfilerEvents,
  installFrontendRuntimeProfiler,
  markInteractionStarted,
  teardownFrontendRuntimeProfiler,
} from '../kernel/frontendRuntimeProfiler';
import { createDesktopStore } from './createDesktopStore';

interface TestStore {
  count: number;
  label: string;
  setCount: (count: number) => void;
  setLabel: (label: string) => void;
}

describe('createDesktopStore instrumentation', () => {
  afterEach(() => {
    teardownFrontendRuntimeProfiler();
    vi.unstubAllGlobals();
  });

  it('preserves store updates and emits changed key plus listener metadata only', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();
    const interactionId = markInteractionStarted('shell', 'primary-nav:test');

    const useTestStore = createDesktopStore<TestStore>('testStore', (set) => ({
      count: 0,
      label: 'initial',
      setCount: (count) => set({ count }),
      setLabel: (label) => set({ label }),
    }));

    const unsubscribe = useTestStore.subscribe(() => undefined);
    useTestStore.getState().setCount(2);

    expect(useTestStore.getState().count).toBe(2);
    expect(getFrontendRuntimeProfilerEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          interactionId,
          kind: 'store.update',
          module: 'testStore',
          owner: 'testStore',
          source: 'store',
          data: expect.objectContaining({
            changedKeys: ['count'],
            fanout: 1,
            listenerCount: 1,
            store: 'testStore',
          }),
        }),
      ]),
    );
    const storeEvent = getFrontendRuntimeProfilerEvents().find((event) => event.kind === 'store.update');
    expect(storeEvent?.data).not.toMatchObject({ count: 2 });
    unsubscribe();
    useTestStore.getState().setLabel('after-unsubscribe');
    const storeEvents = getFrontendRuntimeProfilerEvents().filter((event) => event.kind === 'store.update');
    expect(storeEvents[storeEvents.length - 1]?.data).toMatchObject({
      changedKeys: ['label'],
      fanout: 0,
      listenerCount: 0,
      store: 'testStore',
    });
  });

  it('does not emit when a set call leaves top-level state unchanged', () => {
    vi.stubGlobal('window', {});
    installFrontendRuntimeProfiler();

    const useTestStore = createDesktopStore<TestStore>('testStore', (set) => ({
      count: 0,
      label: 'initial',
      setCount: (count) => set({ count }),
      setLabel: (label) => set({ label }),
    }));

    useTestStore.getState().setCount(0);

    expect(getFrontendRuntimeProfilerEvents()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'store.update',
        }),
      ]),
    );
  });
});
