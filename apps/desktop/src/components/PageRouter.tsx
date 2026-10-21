import { lazy, Suspense } from 'react';

import { getPage } from '../kernel/page';
import type { Page, Navigation, HashRouter } from '../types/navigation';

const AgentCanvasPage = lazy(() => import('../pages/AgentCanvasPage').then((m) => ({ default: m.AgentCanvasPage })));
const AgentProfilePage = lazy(() => import('../pages/AgentProfilePage').then((m) => ({ default: m.AgentProfilePage })));

interface PageRouterProps {
  page: Page;
  router: HashRouter;
  navigation: Navigation;
}

export function PageRouter({ page, router, navigation }: PageRouterProps) {
  const isKernelOwned = Boolean(getPage(page));

  return (
    <>
      {!isKernelOwned && (
        <Suspense fallback={<div style={{ minHeight: '100%' }} />}>
          <EphemeralPage page={page} router={router} navigation={navigation} />
        </Suspense>
      )}
    </>
  );
}

function EphemeralPage({ page, router, navigation }: Pick<PageRouterProps, 'page' | 'router' | 'navigation'>) {
  switch (page) {
    case 'agent-profile':
      return (
        <AgentProfilePage
          agentName={router.profileAgentName}
          onBack={() => navigation.navigateToAgentSurface(router.profileAgentName, 'chat')}
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

    default:
      return null;
  }
}
