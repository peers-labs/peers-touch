import { useState, useEffect } from 'react';
import { useChatStore } from '../store/chat';
import { AgentChatPage } from '../pages/AgentChatPage';
import { NotesPage } from '../pages/NotesPage';
import { AgentCanvasPage } from '../pages/AgentCanvasPage';
import { AgentProfilePage } from '../pages/AgentProfilePage';
import { getModule } from '../modules/registry';
import { getPage } from '../kernel/page';
import { scheduleIdle } from '../kernel/boot';
import type { Page, Navigation, AppletPins, HashRouter } from '../types/navigation';

interface PageRouterProps {
  page: Page;
  router: HashRouter;
  navigation: Navigation;
  appletPins: AppletPins;
}

// Heavy pages that stay mounted once visited to avoid expensive teardown / rebuild cycles
// (P2P connections, encryption init, waterfall API calls on every mount).
//
// As pages migrate to the kernel `PageDescriptor` contract they are dropped
// from this set — `PageHost` (kernel/PageHost.tsx) owns their lifecycle now.
// Currently kernel-owned: search, chat, settings, moments.
const KEEP_ALIVE_PAGES = new Set<string>(['agent']);

export function PageRouter({ page, router, navigation }: PageRouterProps) {
  const [mounted, setMounted] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (KEEP_ALIVE_PAGES.has(page)) initial.add(page);
    return initial;
  });

  // Pre-warm every keep-alive page during the first idle window after the
  // app reaches `ready`, plus the page the user just navigated to. Without
  // this, the initial click on a keep-alive page pays the full mount cost
  // (component construction + antd theme + useEffect waterfall) on the
  // click frame and feels laggy. Pre-mounting off-screen
  // (display: none) shifts that cost to idle so the click becomes a pure
  // visibility flip.
  useEffect(() => {
    if (!KEEP_ALIVE_PAGES.has(page)) return;
    const handle = window.requestAnimationFrame(() => {
      setMounted((prev) => {
        if (prev.has(page)) return prev;
        const next = new Set(prev);
        next.add(page);
        return next;
      });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [page]);

  useEffect(() => {
    return scheduleIdle(() => {
      setMounted((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const target of KEEP_ALIVE_PAGES) {
          if (!next.has(target)) {
            next.add(target);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
  }, []);

  // Pages owned by the kernel `PageDescriptor` registry are rendered by
  // `<PageHost />`; this fallback router must avoid rendering them again.
  const isKernelOwned = Boolean(getPage(page));

  return (
    <>
      {/* Keep-alive: AgentChatPage — preserves conversation context */}
      {(mounted.has('agent') || page === 'agent') && (
        <div style={{ display: page === 'agent' ? 'contents' : 'none' }}>
          <AgentChatPage
            onNavigateAgentProfile={(agentName) => {
              navigation.navigateToAgentSurface(agentName, 'profile');
            }}
            onNavigateAgentCanvas={() => navigation.navigateTo('agent-orchestration')}
          />
        </div>
      )}

      {/* Other pages: rendered conditionally (lightweight, no persistent state) */}
      {!KEEP_ALIVE_PAGES.has(page) && !isKernelOwned && (
        <EphemeralPage page={page} router={router} navigation={navigation} />
      )}
    </>
  );
}

// Non-keep-alive pages that mount/unmount on navigation
function EphemeralPage({ page, router, navigation }: Pick<PageRouterProps, 'page' | 'router' | 'navigation'>) {
  switch (page) {
    case 'notes':
      return (
        <NotesPage
          initialDocId={router.getDocIdFromHash()}
          onNavigateChat={(sessionKey) => {
            useChatStore.getState().selectSession(sessionKey);
            navigation.navigateTo('agent');
          }}
        />
      );

    case 'agent-profile':
      return (
        <AgentProfilePage
          agentName={router.profileAgentName}
          onBack={() => navigation.navigateToAgentSurface(router.profileAgentName, 'chat')}
          onOpenOrchestration={() => navigation.navigateTo('agent-orchestration')}
        />
      );

    case 'agent-orchestration': {
      return (
        <AgentCanvasPage
          onBack={() => navigation.navigateTo('agent')}
          onCreateAgent={(agentName) => navigation.navigateToAgentSurface(agentName, 'profile')}
        />
      );
    }

    default: {
      const mod = getModule(page);
      if (mod?.page) {
        const PageComp = mod.page;
        return <PageComp onNavigate={(p: string) => navigation.navigateTo(p)} />;
      }

      return null;
    }
  }
}
