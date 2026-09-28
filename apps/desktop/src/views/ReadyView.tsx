import {
  Profiler,
  useEffect,
  type ProfilerOnRenderCallback,
  type ReactElement,
  type ReactNode,
} from 'react';

import { listen } from '@tauri-apps/api/event';
import { GlobalLayout } from '../components/GlobalLayout';
import { AppSideNav } from '../components/AppSideNav';
import { AgentCreateDialogHost } from '../components/agent/create';
import { PageRouter } from '../components/PageRouter';
import { CommandMenu } from '../components/CommandMenu';
import { useHashRouter } from '../hooks/useHashRouter';
import { useNavigation } from '../hooks/useNavigation';
import { useAppletPins } from '../hooks/useAppletPins';
import { useCommandMenuShortcut } from '../hooks/useCommandMenuShortcut';
import { notifyActiveAppletPage } from '../runtimes/appletsRuntime';
import { PageHost } from '../kernel/PageHost';
import { PageContextProvider } from '../kernel/PageContext';
import { markPhaseEnd, markPhaseStart } from '../kernel/boot';
import { recordReactCommit, isReactCommitProfilingEnabled } from '../kernel/frontendRuntimeProfiler';
import { registerKernelPages } from '../pages/registry';
import { useNavigationBadgeStore } from '../store/navigationBadges';
import type { AppLifecycle } from '../types/navigation';

interface ReadyViewProps {
  lifecycle: AppLifecycle;
}

// Idempotent — safe under StrictMode double-invocation.
registerKernelPages();

export function ReadyView({ lifecycle: _lifecycle }: ReadyViewProps) {
  const router = useHashRouter();
  const navigation = useNavigation(router);
  const appletPins = useAppletPins();
  const setChatSurfaceVisible = useNavigationBadgeStore((s) => s.setChatSurfaceVisible);
  const standaloneApplet = isStandaloneAppletShell() && router.page.startsWith('applet:');

  useCommandMenuShortcut();

  useEffect(() => {
    markPhaseStart('firstPaint');
    // The browser commits this paint after the current task resolves;
    // mark the end on the next frame so the duration captures real
    // first-paint cost rather than just descriptor scheduling.
    const handle = window.requestAnimationFrame(() => markPhaseEnd('firstPaint'));
    return () => window.cancelAnimationFrame(handle);
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void import('../applet/useProductWindowLifecycleE2E').then(({ startProductWindowLifecycleE2E }) => {
      if (cancelled) return;
      cleanup = startProductWindowLifecycleE2E(navigation);
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [navigation]);

  // Track chat surface visibility regardless of whether chat is rendered
  // by the kernel host or the legacy router fallback. The badge store
  // uses this to suppress unread bumps for the active conversation.
  useEffect(() => {
    setChatSurfaceVisible(router.page === 'chat');
  }, [router.page, setChatSurfaceVisible]);

  // Active-page bridge (§6.3): report the shown page to the applets runtime so
  // the Applet Kernel can background the previous applet (hide → hidden-warm,
  // kept alive) and foreground the entered one (show). Applet page frames are
  // keepAlive:'forever', so PageHost never emits a release on switch — this is
  // the sole driver of the applet hide/show visibility axis.
  useEffect(() => {
    notifyActiveAppletPage(router.page);
  }, [router.page]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ providerId?: string }>('provider:open-settings', () => {
      navigation.navigateTo('settings');
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [navigation]);

  const sideNav = standaloneApplet ? null : (
    <ShellCommitProfiler owner="shell:side-nav" surface="side-nav">
      <AppSideNav
        page={router.page}
        router={router}
        navigation={navigation}
        appletPins={appletPins}
      />
    </ShellCommitProfiler>
  );

  return wrapReadyShellCommitProfiler(
    <PageContextProvider value={{ router, navigation, appletPins }}>
      <GlobalLayout sideNav={sideNav}>
        <ShellCommitProfiler owner="shell:page-host" surface="page-host">
          <PageHost
            page={router.page}
            fallback={
              <PageRouter
                page={router.page}
                router={router}
                navigation={navigation}
                appletPins={appletPins}
              />
            }
          />
        </ShellCommitProfiler>
      </GlobalLayout>
      <CommandMenu
        navigateTo={navigation.navigateTo}
        navigateToAgentSurface={navigation.navigateToAgentSurface}
        navigateToSettings={navigation.navigateToSettings}
      />
      <AgentCreateDialogHost />
    </PageContextProvider>,
  );
}

function ShellCommitProfiler({
  children,
  owner,
  surface,
}: {
  children: ReactNode;
  owner: string;
  surface: string;
}): ReactElement {
  if (!isReactCommitProfilingEnabled()) return <>{children}</>;
  const onRender: ProfilerOnRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    recordReactCommit({
      actualDuration,
      baseDuration,
      commitTime,
      data: { surface },
      id,
      owner,
      phase,
      source: 'shell',
      startTime,
    });
  };
  return (
    <Profiler id={owner} onRender={onRender}>
      {children}
    </Profiler>
  );
}

function wrapReadyShellCommitProfiler(content: ReactElement): ReactElement {
  if (!isReactCommitProfilingEnabled()) return content;
  const onRender: ProfilerOnRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
  ) => {
    recordReactCommit({
      actualDuration,
      baseDuration,
      commitTime,
      data: { surface: 'ready-shell' },
      id,
      owner: 'ready-shell',
      phase,
      source: 'shell',
      startTime,
    });
  };
  return (
    <Profiler id="ready-shell" onRender={onRender}>
      {content}
    </Profiler>
  );
}

function isStandaloneAppletShell(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('appletStandalone') === '1';
}
