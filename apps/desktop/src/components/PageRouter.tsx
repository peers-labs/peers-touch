import { useState, useEffect } from 'react';
import { useChatStore } from '../store/chat';
import { ChatPage } from '../pages/ChatPage';
import { SocialChatPage } from '../pages/SocialChatPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SearchPage } from '../pages/SearchPage';
import { NotesPage } from '../pages/NotesPage';
import { AgentProfilePage } from '../pages/AgentProfilePage';
import { AppletRuntimePage } from '../pages/AppletRuntimePage';
import { getModule } from '../modules/registry';
import { useNavigationBadgeStore } from '../store/navigationBadges';
import type { Page, Navigation, AppletPins, HashRouter } from '../types/navigation';

interface PageRouterProps {
  page: Page;
  router: HashRouter;
  navigation: Navigation;
  appletPins: AppletPins;
}

// Heavy pages that stay mounted once visited to avoid expensive teardown / rebuild cycles
// (P2P connections, encryption init, waterfall API calls on every mount).
const KEEP_ALIVE_PAGES = new Set<string>(['chat', 'agent']);

export function PageRouter({ page, router, navigation, appletPins }: PageRouterProps) {
  const setChatSurfaceVisible = useNavigationBadgeStore((state) => state.setChatSurfaceVisible);
  const [mounted, setMounted] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (KEEP_ALIVE_PAGES.has(page)) initial.add(page);
    return initial;
  });

  // Lazily add keep-alive pages to the mounted set on first visit
  useEffect(() => {
    if (KEEP_ALIVE_PAGES.has(page) && !mounted.has(page)) {
      setMounted((prev) => new Set(prev).add(page));
    }
  }, [page]);

  useEffect(() => {
    setChatSurfaceVisible(page === 'chat');
  }, [page, setChatSurfaceVisible]);

  return (
    <>
      {/* Keep-alive: SocialChatPage — avoids destroying P2P connections on tab switch */}
      {(mounted.has('chat') || page === 'chat') && (
        <div style={{ display: page === 'chat' ? 'contents' : 'none' }}>
          <SocialChatPage />
        </div>
      )}

      {/* Keep-alive: ChatPage (AI agent) — preserves conversation context */}
      {(mounted.has('agent') || page === 'agent') && (
        <div style={{ display: page === 'agent' ? 'contents' : 'none' }}>
          <ChatPage
            onNavigateSettings={() => navigation.navigateToSettings('providers')}
            onNavigateApplets={() => navigation.navigateToSettings('applets')}
            onNavigateSkills={() => navigation.navigateToSettings('skills')}
            onNavigatePages={(docId) => {
              if (docId) {
                window.history.pushState(null, '', `#/notes/${docId}`);
              }
              navigation.navigateTo('notes');
            }}
          />
        </div>
      )}

      {/* Other pages: rendered conditionally (lightweight, no persistent state) */}
      {!KEEP_ALIVE_PAGES.has(page) && (
        <EphemeralPage page={page} router={router} navigation={navigation} appletPins={appletPins} />
      )}
    </>
  );
}

// Non-keep-alive pages that mount/unmount on navigation
function EphemeralPage({ page, router, navigation, appletPins }: PageRouterProps) {
  switch (page) {
    case 'settings':
      return (
        <SettingsPage
          activeTab={navigation.settingsNav.tab}
          highlightId={navigation.settingsNav.highlightId}
          onNavConsumed={() => {}}
        />
      );

    case 'search':
      return <SearchPage onNavigate={navigation.handleSearchNavigate} />;

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
          onBack={() => navigation.navigateTo('agent')}
          onStartChat={(name) => {
            useChatStore.getState().setSelectedAgent(name);
            navigation.navigateTo('agent');
          }}
          onNavigateCron={() => navigation.navigateToSettings('cron')}
          onNavigateSkills={() => navigation.navigateToSettings('skills')}
          onNavigateApplets={() => navigation.navigateToSettings('applets')}
        />
      );

    default: {
      if (page.startsWith('applet:')) {
        const appletId = page.slice('applet:'.length);
        return (
          <AppletRuntimePage
            appletId={appletId}
            onPin={() => appletPins.togglePin(appletId)}
            pinned={appletPins.pinnedApplets.includes(appletId)}
          />
        );
      }

      const mod = getModule(page);
      if (mod?.page) {
        const PageComp = mod.page;
        return <PageComp onNavigate={(p: string) => navigation.navigateTo(p)} />;
      }

      return null;
    }
  }
}
