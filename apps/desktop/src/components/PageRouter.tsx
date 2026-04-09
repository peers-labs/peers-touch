import { useChatStore } from '../store/chat';
import { ChatPage } from '../pages/ChatPage';
import { SocialChatPage } from '../pages/SocialChatPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SearchPage } from '../pages/SearchPage';
import { NotesPage } from '../pages/NotesPage';
import { AgentProfilePage } from '../pages/AgentProfilePage';
import { AppletRuntimePage } from '../pages/AppletRuntimePage';
import { getModule } from '../modules/registry';
import type { Page, Navigation, AppletPins, HashRouter } from '../types/navigation';

interface PageRouterProps {
  page: Page;
  router: HashRouter;
  navigation: Navigation;
  appletPins: AppletPins;
}

export function PageRouter({ page, router, navigation, appletPins }: PageRouterProps) {
  switch (page) {
    case 'chat':
      return <SocialChatPage />;

    case 'agent':
      return (
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
      );

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
