import { afterEach, describe, expect, it, vi } from 'vitest';

interface RegistrationSnapshot {
  hostKind: string;
  pageIds: string[];
  runtimeIds: string[];
}

async function registrationSnapshot(
  host: 'native-tauri' | 'browser',
): Promise<RegistrationSnapshot> {
  vi.resetModules();
  vi.doMock('./MomentsApp', () => ({
    MomentsApp: () => null,
  }));
  const target = Object.assign(new EventTarget(), host === 'native-tauri'
    ? { __TAURI_INTERNALS__: {}, location: { search: '' } }
    : { location: { search: '' } });
  vi.stubGlobal('window', target);

  const hostPolicy = await import('../../kernel/hostPolicy');
  const policy = hostPolicy.initializeDesktopHostPolicy(target);

  const momentsPage = await import('./MomentsApp.descriptor');
  const pageRegistry = await import('../../kernel/page');
  if (policy.nativeSocialEnabled) {
    momentsPage.registerMomentsPage();
  }

  const { momentsRuntime } = await import('../../runtimes/momentsRuntime');
  const runtimeRegistry = await import('../../kernel/runtime');
  if (policy.nativeSocialEnabled) {
    runtimeRegistry.registerRuntime(momentsRuntime);
  }

  return {
    hostKind: policy.kind,
    pageIds: pageRegistry.listPages().map((page) => page.id),
    runtimeIds: runtimeRegistry.listRuntimes().map((runtime) => runtime.id),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Native-only Moments registration', () => {
  it('registers the page and runtime for Tauri', async () => {
    const snapshot = await registrationSnapshot('native-tauri');

    expect(snapshot.hostKind).toBe('native-tauri');
    expect(snapshot.pageIds).toContain('moments');
    expect(snapshot.runtimeIds).toContain('moments');
  });

  it('keeps Browser Social unregistered without a retired gateway path', async () => {
    const snapshot = await registrationSnapshot('browser');

    expect(snapshot.hostKind).toBe('browser');
    expect(snapshot.pageIds).not.toContain('moments');
    expect(snapshot.runtimeIds).not.toContain('moments');
  });
});
