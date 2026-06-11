import { useEffect } from 'react';

import { GlobalLayout } from '../components/GlobalLayout';
import { AppSideNav } from '../components/AppSideNav';
import { PageRouter } from '../components/PageRouter';
import { useHashRouter } from '../hooks/useHashRouter';
import { useNavigation } from '../hooks/useNavigation';
import { useAppletPins } from '../hooks/useAppletPins';
import { PageHost } from '../kernel/PageHost';
import { PageContextProvider } from '../kernel/PageContext';
import { markPhaseEnd, markPhaseStart } from '../kernel/boot';
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

  useEffect(() => {
    markPhaseStart('firstPaint');
    // The browser commits this paint after the current task resolves;
    // mark the end on the next frame so the duration captures real
    // first-paint cost rather than just descriptor scheduling.
    const handle = window.requestAnimationFrame(() => markPhaseEnd('firstPaint'));
    return () => window.cancelAnimationFrame(handle);
  }, []);

  // Track chat surface visibility regardless of whether chat is rendered
  // by the kernel host or the legacy router fallback. The badge store
  // uses this to suppress unread bumps for the active conversation.
  useEffect(() => {
    setChatSurfaceVisible(router.page === 'chat');
  }, [router.page, setChatSurfaceVisible]);

  return (
    <PageContextProvider value={{ router, navigation, appletPins }}>
      <GlobalLayout
        sideNav={
          <AppSideNav
            page={router.page}
            router={router}
            navigation={navigation}
            appletPins={appletPins}
          />
        }
      >
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
      </GlobalLayout>
    </PageContextProvider>
  );
}
