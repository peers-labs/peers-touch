import { afterEach, describe, expect, it, vi } from 'vitest';

interface RegistrationSnapshot {
  hostKind: string;
  moduleIds: string[];
  pageIds: string[];
  runtimeIds: string[];
  sidebarIds: string[];
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
  if (host === 'browser') {
    const { installBrowserGateway } = await import('../../kernel/gateway');
    installBrowserGateway();
  }

  const momentsModule = await import('../../modules/moments');
  const moduleRegistry = await import('../../modules/registry');
  if (policy.nativeSocialEnabled) {
    momentsModule.registerMomentsModule();
  }

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
    moduleIds: moduleRegistry.getModulesWithPages().map((module) => module.id),
    pageIds: pageRegistry.listPages().map((page) => page.id),
    runtimeIds: runtimeRegistry.listRuntimes().map((runtime) => runtime.id),
    sidebarIds: moduleRegistry.getModulesWithSidebar().map((module) => module.id),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Native-only Moments registration', () => {
  it('registers the module, page, runtime, navigation, and actions for Tauri', async () => {
    const snapshot = await registrationSnapshot('native-tauri');

    expect(snapshot.hostKind).toBe('native-tauri');
    expect(snapshot.moduleIds).toContain('moments');
    expect(snapshot.pageIds).toContain('moments');
    expect(snapshot.runtimeIds).toContain('moments');
    expect(snapshot.sidebarIds).toContain('moments');
  });

  it('keeps Browser Social unregistered after the gateway polyfill is installed', async () => {
    const snapshot = await registrationSnapshot('browser');

    expect(snapshot.hostKind).toBe('browser');
    expect(snapshot.moduleIds).not.toContain('moments');
    expect(snapshot.pageIds).not.toContain('moments');
    expect(snapshot.runtimeIds).not.toContain('moments');
    expect(snapshot.sidebarIds).not.toContain('moments');
  });
});
