import { useChatStore } from '../store/chat';
import { NotesPage } from '../pages/NotesPage';
import { AgentCanvasPage } from '../pages/AgentCanvasPage';
import { AgentProfilePage } from '../pages/AgentProfilePage';
import { getModule } from '../modules/registry';
import { getPage } from '../kernel/page';
import type { Page, Navigation, AppletPins, HashRouter } from '../types/navigation';

interface PageRouterProps {
  page: Page;
  router: HashRouter;
  navigation: Navigation;
  appletPins: AppletPins;
}

export function PageRouter({ page, router, navigation }: PageRouterProps) {
  // Pages owned by the kernel `PageDescriptor` registry are rendered by
  // `<PageHost />`; this fallback router must avoid rendering them again.
  const isKernelOwned = Boolean(getPage(page));

  return (
    <>
      {/* Legacy pages not yet moved to PageDescriptor render only when active. */}
      {!isKernelOwned && (
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
